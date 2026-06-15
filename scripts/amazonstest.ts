/** Amazons: rules, AI, guaranteed termination, and an illustration setup. */
import def, { initialState, evaluate } from '../src/games/amazons';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const N = 8;
const sqToIdx = (s: string) => (N - +s[1]) * N + (s.charCodeAt(0) - 97);
function pos(list: [string, number][], turn: 0 | 1) {
  const board: (number | null)[] = Array(64).fill(null);
  for (const [s, v] of list) board[sqToIdx(s)] = v;
  return { board, turn };
}
const moves = (s: any) => def.getLegalMoves(s, null) as any[];

// ---- Rules ----
const init = initialState();
ok(init.board.filter((v) => v === 0).length === 4 && init.board.filter((v) => v === 1).length === 4, 'initial: 4 amazons each');
ok(def.getStatus(init).kind === 'playing' && init.turn === 0 && moves(init).length > 100, `initial: White to move, many moves (${moves(init).length})`);

// A lone amazon moves like a queen and then shoots like a queen.
{
  const s = pos([['d4', 0], ['a8', 1]], 0);
  const ms = moves(s);
  ok(ms.length > 100, `lone amazon has move+shoot combos (${ms.length})`);
  const m = ms.find((x) => x.from === sqToIdx('d4') && x.to === sqToIdx('d5') && x.arrow === sqToIdx('d6'));
  ok(!!m, 'a queen move d4-d5 with arrow d6 exists');
  if (m) {
    const after = def.applyMove(s, m);
    ok(after.board[sqToIdx('d4')] === null && after.board[sqToIdx('d5')] === 0 && after.board[sqToIdx('d6')] === 2, 'apply: amazon moves and the arrow blocks its square');
  }
}
// An arrow blocks movement through it.
{
  const s = pos([['d4', 0], ['d6', 2], ['a8', 1]], 0); // arrow at d6
  const ms = moves(s);
  ok(ms.some((x) => x.from === sqToIdx('d4') && x.to === sqToIdx('d5')), 'amazon can move up to d5');
  ok(!ms.some((x) => x.from === sqToIdx('d4') && x.to === sqToIdx('d7')), 'amazon cannot pass through the arrow at d6');
}
// A walled-in side to move loses.
{
  const s = pos([['a8', 0], ['b8', 2], ['a7', 2], ['b7', 2], ['d4', 1]], 0); // White a8 fully boxed
  ok((def.getStatus(s) as any).winner === 1, 'a player with no move loses (opponent wins)');
}
ok(JSON.stringify(def.deserialize(def.serialize(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// ---- AI + guaranteed termination (each move blocks one square) ----
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now(); const m = def.chooseMove(init, d); const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) → ${(m as any)?.notation} (${dt}ms)`);
}
{
  let s = init, plies = 0, status = def.getStatus(s); const t0 = Date.now();
  while (status.kind === 'playing' && plies < 120) { const m = def.chooseMove(s, 'medium'); if (!m) break; s = def.applyMove(s, m); status = def.getStatus(s); plies++; }
  const res = status.kind === 'win' ? `${def.players[(status as any).winner].name}` : `capped ${plies}`;
  ok(status.kind === 'win', `AI vs AI terminates: ${plies} plies → ${res} (${Date.now() - t0}ms)`);
}

// ---- Illustration setup (validate it renders) ----
const shoot = pos([['d6', 0], ['f6', 2], ['c8', 1], ['g3', 3]], 0);
ok(def.getBoardView(shoot).cells.length === 64, 'SHOOT illustration renders to a 64-cell board');
console.log(`     __SHOOT_SETUP__ = ${def.serialize(shoot)}`);
void evaluate;

console.log(fail === 0 ? '\n✅ AMAZONS OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
