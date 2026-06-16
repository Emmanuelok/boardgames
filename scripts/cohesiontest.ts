/** Cohesion (original): placement, largest-cluster scoring, knockout, AI, termination. */
import def, { initialState, largestCluster, evaluate } from '../src/games/cohesion';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const N = 6;
const sqToIdx = (s: string) => (N - +s[1]) * N + (s.charCodeAt(0) - 97);
function pos(list: [string, 0 | 1][], turn: 0 | 1) {
  const board: (0 | 1 | null)[] = Array(N * N).fill(null);
  for (const [s, p] of list) board[sqToIdx(s)] = p;
  return { board, turn };
}

const init = initialState();
ok(init.board.every((v) => v === null) && init.turn === 0, 'initial: empty board, Teal to move');
ok(def.getLegalMoves(init, null).length === 36, 'initial: 36 placements available');

// Largest cluster counts only edge-connected groups (not diagonals).
ok(largestCluster(pos([['a6', 0], ['b6', 0], ['c6', 0]], 0).board, 0) === 3, 'a straight trio is a cluster of 3');
ok(largestCluster(pos([['a6', 0], ['b5', 0]], 0).board, 0) === 1, 'diagonal stones do NOT connect (largest = 1)');

// Placing the bridging stone merges two groups (and can win by knockout).
{
  // Teal group A: row6 (a6..f6) + a5  = 7 ; group B: row3 (a3..f3) = 6 ; gap at a4 bridges them → 14.
  const teal: [string, 0 | 1][] = [['a6', 0], ['b6', 0], ['c6', 0], ['d6', 0], ['e6', 0], ['f6', 0], ['a5', 0], ['a3', 0], ['b3', 0], ['c3', 0], ['d3', 0], ['e3', 0], ['f3', 0]];
  const s = pos([...teal, ['f5', 1], ['f4', 1]], 0);
  ok(def.getStatus(s).kind === 'playing' && largestCluster(s.board, 0) === 7, 'pre-bridge: two Teal groups, largest is 7');
  const m = def.getLegalMoves(s, null).find((x) => x.to === sqToIdx('a4'))!;
  ok(!!m, 'the bridging square a4 is playable');
  if (m) {
    const after = def.applyMove(s, m);
    ok(largestCluster(after.board, 0) === 14 && (def.getStatus(after) as any).winner === 0, 'bridging at a4 makes a cluster of 14 — knockout win');
  }
}

ok(JSON.stringify(def.deserialize(def.serialize(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// AI + termination (board always fills).
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now(); const m = def.chooseMove(init, d); const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) → ${m?.notation} (${dt}ms)`);
}
{
  let s = init, plies = 0, status = def.getStatus(s); const t0 = Date.now();
  while (status.kind === 'playing' && plies < 60) { const m = def.chooseMove(s, 'medium'); if (!m) break; s = def.applyMove(s, m); status = def.getStatus(s); plies++; }
  const r = status.kind === 'win' ? `${def.players[(status as any).winner].name} (clusters ${largestCluster(s.board, 0)}-${largestCluster(s.board, 1)})` : status.kind === 'draw' ? 'draw' : `capped ${plies}`;
  ok(status.kind === 'win' || status.kind === 'draw', `AI vs AI ends: ${plies} plies → ${r} (${Date.now() - t0}ms)`);
}

// ---- Tutorial setups ----
const cluster = pos([['b5', 0], ['c5', 0], ['c4', 0], ['d4', 0], ['e3', 1], ['e4', 1]], 0);
ok(largestCluster(cluster.board, 0) === 4, 'CLUSTER illustration: a 4-stone Teal cluster');
console.log(`     __CLUSTER_SETUP__ = ${def.serialize(cluster)}`);

{
  const teal: [string, 0 | 1][] = [['a6', 0], ['b6', 0], ['c6', 0], ['d6', 0], ['e6', 0], ['f6', 0], ['a5', 0], ['a3', 0], ['b3', 0], ['c3', 0], ['d3', 0], ['e3', 0], ['f3', 0]];
  const s = pos([...teal, ['f5', 1], ['f4', 1]], 0);
  const sol = def.getLegalMoves(s, null).filter((m) => (def.getStatus(def.applyMove(s, m)) as any).winner === 0);
  ok(sol.length > 0, `C1 puzzle: winning bridge = ${sol.map((m) => m.notation).join(', ')}`);
  console.log(`     __C1_SETUP__ = ${def.serialize(s)}`);
  console.log(`     __C1_SOL__ = ${JSON.stringify(sol.map((m) => m.notation))}`);
}
void evaluate;

console.log(fail === 0 ? '\n✅ COHESION OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
