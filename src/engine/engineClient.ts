/**
 * Promise-based client for the engine Web Worker. Falls back to running on the
 * main thread if Workers are unavailable (e.g. during SSR or old browsers).
 */
import type { Difficulty, GameDefinition, LiveEval, MoveBase, MoveExplanation } from './types';
import { GAME_MAP } from './registry';

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const WORKER_TIMEOUT_MS = 30_000;
const WORKER_RECOVERY_COOLDOWN_MS = 5_000;
let workerCooldownUntil = 0;

function errorFrom(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === 'string' && reason ? reason : fallback);
}

/** Retire a failed worker and settle every request that was assigned to it. */
function failWorker(failedWorker: Worker, reason: unknown): void {
  if (worker !== failedWorker) return;

  worker = null;
  workerCooldownUntil = Date.now() + WORKER_RECOVERY_COOLDOWN_MS;
  failedWorker.onmessage = null;
  failedWorker.onerror = null;
  failedWorker.onmessageerror = null;
  try { failedWorker.terminate(); } catch { /* already stopped */ }

  const error = errorFrom(reason, 'The game engine worker stopped unexpectedly.');
  const requests = [...pending.values()];
  pending.clear();
  for (const request of requests) {
    clearTimeout(request.timer);
    request.reject(error);
  }
}

function ensureWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  if (Date.now() < workerCooldownUntil) return null;

  try {
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker = created;
    created.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const message = e.data;
      if (!message || !Number.isSafeInteger(message.id) || typeof message.ok !== 'boolean') {
        failWorker(created, new Error('The game engine returned an invalid response.'));
        return;
      }

      const p = pending.get(message.id);
      if (!p) return;
      pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.ok) p.resolve(message.result);
      else p.reject(new Error(message.error || 'The game engine could not complete the request.'));
    };
    created.onerror = (event) => {
      event.preventDefault();
      failWorker(created, new Error(event.message || 'The game engine worker crashed.'));
    };
    created.onmessageerror = () => {
      failWorker(created, new Error('The game engine returned unreadable data.'));
    };
  } catch {
    worker = null;
    workerCooldownUntil = Date.now() + WORKER_RECOVERY_COOLDOWN_MS;
  }
  return worker;
}

function call<T>(payload: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  if (!w) return mainThread<T>(payload); // graceful fallback
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      failWorker(w, new Error(`The game engine timed out after ${WORKER_TIMEOUT_MS / 1000} seconds.`));
    }, WORKER_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });

    try {
      w.postMessage({ id, ...payload });
    } catch (error) {
      failWorker(w, errorFrom(error, 'The game engine request could not be sent.'));
    }
  });
}

// Synchronous fallback (blocks, but keeps the app functional without workers).
function mainThread<T>(payload: Record<string, any>): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const g = GAME_MAP[payload.gameId] as GameDefinition | undefined;
        if (!g) throw new Error(`Unknown game "${String(payload.gameId)}".`);

        if (payload.type === 'choose') resolve(g.chooseMove(payload.state, payload.difficulty) as T);
        else if (payload.type === 'explain') resolve(g.explainMove(payload.before, payload.move, payload.after) as T);
        else if (payload.type === 'hint') resolve(g.hint(payload.state) as T);
        else if (payload.type === 'analyze') resolve((g.liveEval ? g.liveEval(payload.state) : { score: g.evaluate(payload.state), depth: 0 }) as T);
        else if (payload.type === 'threats') resolve((g.threats ? g.threats(payload.state) : []) as T);
        else throw new Error(`Unknown engine request "${String(payload.type)}".`);
      } catch (error) {
        reject(errorFrom(error, 'The game engine could not complete the request.'));
      }
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
  threats: (gameId: string, state: unknown) =>
    call<string[]>({ type: 'threats', gameId, state }),
};
