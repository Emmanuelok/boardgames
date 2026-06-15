/** Clobber: rules, AI, guaranteed termination, and tutorial-setup generation. */
import def, { initialState, evaluate } from '../src/games/clobber';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const COLS = 6, ROWS = 6;
type P = 0 | 1 | null;
const sqToIdx = (s: string) => (ROWS - +s[1]) * COLS + (s.charCodeAt(0) - 97);
function pos(list: [string, 0 | 1][], turn: 0 | 1) {
  const board: P[] = Array(ROWS * COLS).fill(null);
  for (const [s, p] of list) board[sqToIdx(s)] = p;
  return { board, turn };
}
const notes = (s: any) => def.getLegalMoves(s, null).map((m) => m.notation);

// ---- Rules ----
const init = initialState();
ok(init.board.filter((v) => v === 0).length === 18 && init.board.filter((v) => v === 1).length === 18, 'initial: 18 stones each, board full');
ok(def.getStatus(init).kind === 'playing' && init.turn === 0 && notes(init).length > 0, 'initial: Black to move with clobbers available');

{ // a single clobber onto an adjacent enemy
  const s = pos([['b2', 0], ['c2', 1]], 0);
  ok(notes(s).includes('b2xc2'), 'clobber: move onto an adjacent enemy');
  const m = def.getLegalMoves(s, null).find((x) => x.notation === 'b2xc2')!;
  const after = def.applyMove(s, m);
  ok(after.board[sqToIdx('b2')] === null && after.board[sqToIdx('c2')] === 0, 'clobber removes the enemy and takes its square');
}
ok(!notes(pos([['b2', 0], ['d2', 1]], 0)).includes('b2'), 'no move onto a non-adjacent or empty square');
ok(!notes(pos([['b2', 0], ['c3', 1]], 0)).some((n) => n.startsWith('b2')), 'no diagonal clobber');
ok((def.getStatus(pos([['a1', 0], ['f6', 1]], 0)) as any).winner === 1, 'no clobber available → side to move loses (last move wins)');
ok(JSON.stringify(def.deserialize(def.serialize(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// ---- AI + guaranteed termination ----
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now(); const m = def.chooseMove(init, d); const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) → ${m?.notation} (${dt}ms)`);
}
for (const diff of ['medium', 'master'] as Difficulty[]) {
  let s = init, plies = 0, status = def.getStatus(s); const t0 = Date.now();
  while (status.kind === 'playing' && plies < 60) { const m = def.chooseMove(s, diff); if (!m) break; s = def.applyMove(s, m); status = def.getStatus(s); plies++; }
  const res = status.kind === 'win' ? `${def.players[(status as any).winner].name}` : `capped ${plies}`;
  ok(status.kind === 'win', `AI vs AI (${diff}) terminates: ${plies} plies → ${res} (${Date.now() - t0}ms)`);
}

// ---- Tutorial setups (generate + print) ----
const moveSetup = pos([['c3', 0], ['d3', 1], ['c4', 1], ['e5', 0], ['a1', 1]], 0);
ok(notes(moveSetup).includes('c3xd3'), 'MOVE illustration: c3xd3 available');
console.log(`     __MOVE_SETUP__ = ${def.serialize(moveSetup)}`);

// C1: Black has one clobber that leaves White with no neighbour to attack.
function killer(list: [string, 0 | 1][]) {
  const s = pos(list, 0);
  if (def.getStatus(s).kind !== 'playing') return null;
  const wins = def.getLegalMoves(s, null).filter((m) => { const st = def.getStatus(def.applyMove(s, m)); return st.kind === 'win' && (st as any).winner === 0; });
  return { s, wins };
}
// Black a1, White b1 (only contact). Black a1xb1 removes White's only stone → White stuck.
const c1 = killer([['a1', 0], ['b1', 1], ['f6', 0]]);
ok(!!c1 && c1.wins.length > 0, `C1 puzzle: winning move(s) = ${c1?.wins.map((m) => m.notation).join(', ') || 'none'}`);
if (c1) {
  console.log(`     __C1_SETUP__ = ${def.serialize(c1.s)}`);
  console.log(`     __C1_SOL__ = ${JSON.stringify(c1.wins.map((m) => m.notation))}`);
}

console.log(fail === 0 ? '\n✅ CLOBBER OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
