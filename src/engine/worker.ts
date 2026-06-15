/// <reference lib="webworker" />
/**
 * The thinking happens here, off the main thread, so the UI never janks while
 * the AI searches or the tutor analyses a move. The worker bundles the full
 * game registry and answers three kinds of request: choose (AI move),
 * explain (tutor) and hint.
 */
import { GAME_MAP } from './registry';

export type WorkerRequest =
  | { id: number; type: 'choose'; gameId: string; state: unknown; difficulty: string }
  | { id: number; type: 'explain'; gameId: string; before: unknown; move: unknown; after: unknown }
  | { id: number; type: 'hint'; gameId: string; state: unknown }
  | { id: number; type: 'analyze'; gameId: string; state: unknown };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  const game = GAME_MAP[msg.gameId];
  try {
    if (!game) throw new Error(`unknown game ${msg.gameId}`);
    let result: unknown;
    if (msg.type === 'choose') result = game.chooseMove(msg.state, msg.difficulty as any);
    else if (msg.type === 'explain') result = game.explainMove(msg.before, msg.move as any, msg.after);
    else if (msg.type === 'hint') result = game.hint(msg.state);
    else if (msg.type === 'analyze') result = game.liveEval ? game.liveEval(msg.state) : { score: game.evaluate(msg.state), depth: 0 };
    (self as unknown as Worker).postMessage({ id: msg.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
