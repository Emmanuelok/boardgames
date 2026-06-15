/**
 * Promise-based client for the engine Web Worker. Falls back to running on the
 * main thread if Workers are unavailable (e.g. during SSR or old browsers).
 */
import type { Difficulty, GameDefinition, LiveEval, MoveBase, MoveExplanation } from './types';
import { GAME_MAP } from './registry';

interface Pending { resolve: (v: any) => void; reject: (e: any) => void; }

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: any; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => { /* fall through to main-thread on next call */ };
  } catch {
    worker = null;
  }
  return worker;
}

function call<T>(payload: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  if (!w) return mainThread<T>(payload); // graceful fallback
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...payload });
  });
}

// Synchronous fallback (blocks, but keeps the app functional without workers).
function mainThread<T>(payload: Record<string, any>): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const g = GAME_MAP[payload.gameId] as GameDefinition;
      if (payload.type === 'choose') resolve(g.chooseMove(payload.state, payload.difficulty) as T);
      else if (payload.type === 'explain') resolve(g.explainMove(payload.before, payload.move, payload.after) as T);
      else if (payload.type === 'hint') resolve(g.hint(payload.state) as T);
      else if (payload.type === 'analyze') resolve((g.liveEval ? g.liveEval(payload.state) : { score: g.evaluate(payload.state), depth: 0 }) as T);
    }, 10);
  });
}

export const engine = {
  choose: (gameId: string, state: unknown, difficulty: Difficulty) =>
    call<MoveBase | null>({ type: 'choose', gameId, state, difficulty }),
  explain: (gameId: string, before: unknown, move: MoveBase, after: unknown) =>
    call<MoveExplanation>({ type: 'explain', gameId, before, move, after }),
  hint: (gameId: string, state: unknown) =>
    call<{ move: MoveBase; text: string } | null>({ type: 'hint', gameId, state }),
  analyze: (gameId: string, state: unknown) =>
    call<LiveEval>({ type: 'analyze', gameId, state }),
};
