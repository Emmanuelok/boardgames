/** Alquerque: lattice adjacency, mandatory chain captures, win/draw, AI, termination. */
import def, { CONNECTIONS, legalMoves, applyMove, winnerOf, createInitialState, type AlqState, type AlqMove } from '../src/games/alquerque';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const st = (points: (0 | 1 | null)[], turn: 0 | 1 = 0, sinceCapture = 0): AlqState => ({ points, turn, sinceCapture });
const empty = (): (0 | 1 | null)[] => Array(25).fill(null);

const init = createInitialState();
ok(init.points.filter((v) => v === 0).length === 12 && init.points.filter((v) => v === 1).length === 12, 'starts with 12 pieces each');
ok(init.points[12] === null, 'the centre point starts empty');
ok(init.turn === 0, 'Gold moves first');
ok(legalMoves(init).length === 4, 'opening: the four pieces around the empty centre can step in');

// The diagonal lattice: strong points (row+col even) carry diagonals, weak ones don't.
{
  // A lone Gold piece on a strong point (centre, index 12) has 8 line-neighbours.
  const a = legalMoves(st((() => { const p = empty(); p[12] = 0; return p; })()));
  ok(a.length === 8, 'a piece on a strong point (centre) has 8 moves');
  // A lone Gold piece on a weak point (index 11 = (2,1), sum 3 odd) has only 4.
  const b = legalMoves(st((() => { const p = empty(); p[11] = 0; return p; })()));
  ok(b.length === 4, 'a piece on a weak point has only 4 (orthogonal) moves');
}

// Mandatory capture: with a jump available, only captures are legal.
{
  const p = empty(); p[12] = 0; p[11] = 1; // Gold c3 (centre), Silver b3 to its left
  const moves = legalMoves(st(p));
  ok(moves.length === 1 && moves[0].notation === 'c3×a3' && moves[0].capture === true, 'a forced single capture: c3×a3');
  const after = applyMove(st(p), moves[0]);
  ok(after.points[11] === null && after.points[10] === 0 && after.sinceCapture === 0, 'the jump removes the enemy and resets the no-capture counter');
}

// Chains: a single move can sweep two pieces.
{
  const p = empty(); p[12] = 0; p[11] = 1; p[6] = 1; // Gold c3; Silver at b3 and at b4(1,1)
  const moves = legalMoves(st(p));
  const chain = moves.find((m) => (m.affected?.length ?? 0) === 2);
  ok(!!chain, 'a two-piece chain capture is found');
  if (chain) { const after = applyMove(st(p), chain); ok(after.points.filter((v) => v === 1).length === 0, 'the chain removes both enemy pieces'); }
}

// Win / draw conditions.
ok(winnerOf(st((() => { const p = empty(); p[0] = 0; return p; })(), 1)) === 0, 'a side with no pieces loses');
ok(winnerOf(st((() => { const p = empty(); p[0] = 0; p[24] = 1; return p; })(), 0, 30)) === 'draw', '30 moves with no capture is a draw');

// Board connections: a sane lattice (orthogonal + diagonals on strong points).
ok(CONNECTIONS.length === 40 + 16, `lattice has ${CONNECTIONS.length} line segments (40 orthogonal + 16 diagonal)`);

// AI at every difficulty, deterministic, fast.
for (const d of ['easy', 'medium', 'hard', 'master'] as const) ok(!!def.chooseMove!(init, d), `chooseMove(${d}) → ${(def.chooseMove!(init, d) as AlqMove)?.notation}`);
ok((def.chooseMove!(init, 'master') as AlqMove)?.id === (def.chooseMove!(init, 'master') as AlqMove)?.id, 'chooseMove is deterministic');
{ const t0 = Date.now(); def.chooseMove!(init, 'master'); const ms = Date.now() - t0; ok(ms < 3000, `master opening move in ${ms}ms (<3000)`); }

// Termination: a full AI-vs-AI game ends (capture-out or the no-capture draw rule).
{
  let s: AlqState = init, plies = 0; const t0 = Date.now();
  while (def.getStatus(s).kind === 'playing' && plies < 400) { const m = def.chooseMove!(s, 'medium'); if (!m) break; s = def.applyMove(s, m); plies++; }
  const k = def.getStatus(s).kind;
  ok(k !== 'playing' && plies < 400, `AI vs AI ends in ${plies} plies → ${k} (${Date.now() - t0}ms)`);
}

// Trainer puzzle is valid and has no leftover placeholder.
{
  const step = def.tutorial.chapters.flatMap((c) => c.steps).find((s) => !!s.challenge)!;
  ok(!JSON.stringify(def.tutorial).includes('__'), 'no placeholder remains in the tutorial');
  const ms = legalMoves(def.deserialize(step.setup!));
  ok(ms.length === 1 && ms[0].notation === step.challenge!.solution[0], 'trainer position has exactly the puzzle solution as its forced move');
}

ok(def.serialize(def.deserialize(def.serialize(init))) === def.serialize(init), 'serialize/deserialize roundtrip');

console.log(fail === 0 ? '\n✅ ALQUERQUE OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
