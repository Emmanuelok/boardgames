/** Kōnane: rules, AI, guaranteed termination, and tutorial-setup generation. */
import def, { initialState, evaluate } from '../src/games/konane';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const N = 8;
type P = 0 | 1 | null;
const sqToIdx = (s: string) => (N - +s[1]) * N + (s.charCodeAt(0) - 97);
function pos(list: [string, 0 | 1][], turn: 0 | 1) {
  const board: P[] = Array(64).fill(null);
  for (const [s, p] of list) board[sqToIdx(s)] = p;
  return { board, turn };
}
const notes = (s: any) => def.getLegalMoves(s, null).map((m) => m.notation);

// ---- Rules ----
const init = initialState();
ok(init.board.filter((v) => v === 0).length === 31 && init.board.filter((v) => v === 1).length === 31, 'initial: 31 stones each (2 lifted)');
ok(init.board[sqToIdx('d4')] === null && init.board[sqToIdx('e4')] === null, 'initial: centre opening pre-applied');
ok(def.getStatus(init).kind === 'playing' && init.turn === 0 && notes(init).length > 0, 'initial: Black to move with legal jumps');

// Every move is a capture; a simple single jump.
{ // Black c4 jumps White d4 into empty e4
  const s = pos([['c4', 0], ['d4', 1]], 0);
  ok(notes(s).includes('c4xe4'), 'single jump captures the enemy between');
  const m = def.getLegalMoves(s, null).find((x) => x.notation === 'c4xe4')!;
  const after = def.applyMove(s, m);
  ok(after.board[sqToIdx('d4')] === null && after.board[sqToIdx('e4')] === 0, 'jump removes the captured stone and lands beyond');
}
// Chain in a straight line (capture two), but not around corners.
{ // Black a4 over b4(W) to c4(empty), then over d4(W) to e4(empty)
  const s = pos([['a4', 0], ['b4', 1], ['d4', 1]], 0);
  ok(notes(s).includes('a4xc4') && notes(s).includes('a4xe4'), 'straight-line chain offers stop-after-1 and stop-after-2');
  const m2 = def.getLegalMoves(s, null).find((x) => x.notation === 'a4xe4')!;
  ok(m2.affected!.length === 2, 'the 2-jump move captures two stones');
}
ok(!notes(pos([['c4', 0], ['d4', 1]], 0)).includes('c4-d4'), 'no non-capturing moves exist');

// Win: the side to move with no capture loses.
ok((def.getStatus(pos([['a1', 0], ['h8', 1]], 0)) as any).winner === 1, 'no legal capture → side to move loses (last move wins)');

ok(JSON.stringify(def.deserialize(def.serialize(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// ---- AI + guaranteed termination (board only ever empties) ----
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now(); const m = def.chooseMove(init, d); const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) → ${m?.notation} (${dt}ms)`);
}
for (const diff of ['medium', 'master'] as Difficulty[]) {
  let s = init, plies = 0, status = def.getStatus(s); const t0 = Date.now();
  while (status.kind === 'playing' && plies < 100) { const m = def.chooseMove(s, diff); if (!m) break; s = def.applyMove(s, m); status = def.getStatus(s); plies++; }
  const res = status.kind === 'win' ? `${def.players[(status as any).winner].name}` : `capped ${plies}`;
  ok(status.kind === 'win', `AI vs AI (${diff}) terminates: ${plies} plies → ${res} (${Date.now() - t0}ms)`);
}

// ---- Tutorial setups (generate + print) ----
const jumpSetup = pos([['c4', 0], ['d4', 1], ['f4', 1], ['a2', 1], ['h7', 0]], 0);
ok(notes(jumpSetup).includes('c4xe4'), 'JUMP illustration: c4xe4 available');
console.log(`     __JUMP_SETUP__ = ${def.serialize(jumpSetup)}`);

// C1: a tiny endgame where one Black capture leaves White with no move.
function findKiller(list: [string, 0 | 1][]) {
  const s = pos(list, 0);
  if (def.getStatus(s).kind !== 'playing') return null;
  const wins = def.getLegalMoves(s, null).filter((m) => def.getStatus(def.applyMove(s, m)).kind === 'win' && (def.getStatus(def.applyMove(s, m)) as any).winner === 0);
  return { s, wins };
}
// Black a1 can jump b1(W)→c1; that removes White's only stone-with-a-move, leaving White stuck.
const c1 = findKiller([['a1', 0], ['b1', 1], ['h8', 0]]);
ok(!!c1 && c1.wins.length > 0, `C1 puzzle: winning move(s) = ${c1?.wins.map((m) => m.notation).join(', ') || 'none'}`);
if (c1) {
  console.log(`     __C1_SETUP__ = ${def.serialize(c1.s)}`);
  console.log(`     __C1_SOL__ = ${JSON.stringify(c1.wins.map((m) => m.notation))}`);
}

console.log(fail === 0 ? '\n✅ KONANE OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
