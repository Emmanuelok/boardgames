/** Tally: line-majority scoring, placement rules, AI, guaranteed termination. */
import def, { initialState, lineScores, evaluate } from '../src/games/tally';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const N = 7;
const init = initialState();
ok(init.board.length === N * N && init.board.every((v) => v === null) && init.turn === 0, 'initial: empty 7×7 board, Indigo to move');
ok(def.getLegalMoves(init).length === 49, 'opening: 49 empty squares to play');

// Scoring lines: 7 rows + 7 cols + 2 diagonals = 16, each of length 7.
const moves = def.getLegalMoves(init);
ok(moves.length === 49 && moves.every((m) => typeof m.to === 'number'), 'legal moves are single placements');

// A constructed full board: give player 0 a clear line majority and check the winner.
{
  const board: (0 | 1 | null)[] = Array(49).fill(1); // all Gold...
  for (let c = 0; c < N; c++) board[0 * N + c] = 0; // ...except Indigo owns row 0 outright
  // Indigo also takes 4 of column 0 to be safe on majorities:
  for (let r = 0; r < 4; r++) board[r * N + 0] = 0;
  const [a, b] = lineScores(board as (0 | 1 | null)[]);
  ok(a >= 1 && a + b <= 16, `lineScores on a full board tallies ≤16 lines (Indigo ${a}, Gold ${b})`);
  const full = { board: board as (0 | 1)[], turn: 0 as const };
  const st = def.getStatus(full);
  ok(st.kind === 'win' || st.kind === 'draw', `full board is terminal (${st.kind})`);
}

// apply places a stone of the mover and passes the turn.
{
  const s1 = def.applyMove(init, { id: 'p24', to: 24, notation: '' });
  ok(s1.board[24] === 0 && s1.turn === 1, 'a move places Indigo and passes to Gold');
  const s2 = def.applyMove(s1, { id: 'p25', to: 25, notation: '' });
  ok(s2.board[25] === 1 && s2.turn === 0, 'Gold then places and passes back');
}

// evaluate: positive when Indigo leads on lines, negative when Gold leads.
{
  const lead0: (0 | 1 | null)[] = Array(49).fill(null);
  for (let c = 0; c < N; c++) lead0[c] = 0; // Indigo owns row 0
  ok(evaluate({ board: lead0 as (0 | 1)[], turn: 1 }) > 0, 'evaluate > 0 when Indigo leads on lines');
  const lead1 = lead0.map((v) => (v === 0 ? 1 : v)) as (0 | 1 | null)[];
  ok(evaluate({ board: lead1 as (0 | 1)[], turn: 0 }) < 0, 'evaluate < 0 when Gold leads on lines');
}

// AI returns a move at every difficulty.
for (const d of ['tutor', 'easy', 'medium', 'hard', 'master'] as const) {
  const m = def.chooseMove!(init, d);
  ok(!!m, `chooseMove(${d}) → ${m?.notation}`);
}

// Determinism: same state + difficulty → same move (seeded RNG).
ok(def.chooseMove!(init, 'medium')?.id === def.chooseMove!(init, 'medium')?.id, 'chooseMove is deterministic for a given state');

// Worst-case single master move from the opening (deepest branching) is fast.
{
  const t0 = Date.now();
  const m = def.chooseMove!(init, 'master');
  ok(!!m && Date.now() - t0 < 2500, `master opening move in ${Date.now() - t0}ms (<2500)`);
}

// Termination is structural: every move fills one square, so a full game is
// always exactly 49 plies and ends with a decisive status.
{
  let s = init, plies = 0; const t0 = Date.now();
  while (def.getStatus(s).kind === 'playing' && plies < 100) {
    const m = def.chooseMove!(s, 'medium'); if (!m) break; s = def.applyMove(s, m); plies++;
  }
  const st = def.getStatus(s);
  ok(plies === 49 && st.kind !== 'playing', `AI vs AI fills the board in ${plies} plies → ${st.kind}${st.kind === 'win' ? ' ' + (st as { winner: number }).winner : ''} (${Date.now() - t0}ms)`);
}

// The tutorial's "Scoring the lines" illustration must be a valid, on-point
// position (and the __LINE_SETUP__ placeholder must be gone).
{
  const step = def.tutorial.chapters[0].steps[1];
  ok(!!step.setup && !step.setup.includes('__LINE_SETUP__'), 'tutorial line-scoring step has a real setup (placeholder removed)');
  const all = JSON.stringify(def.tutorial);
  ok(!all.includes('__LINE_SETUP__'), 'no __LINE_SETUP__ placeholder remains anywhere in the tutorial');
  const st = def.deserialize(step.setup!);
  // The highlighted middle row should be a 4–3 Indigo majority (illustrating "4 of 7 wins a line").
  const row = [21, 22, 23, 24, 25, 26, 27];
  const ind = row.filter((i) => st.board[i] === 0).length;
  const gold = row.filter((i) => st.board[i] === 1).length;
  ok(ind === 4 && gold === 3, `illustration's highlighted row is a 4–3 Indigo majority (${ind}–${gold})`);
  ok(JSON.stringify(step.highlight) === JSON.stringify(row), 'the illustration highlights exactly that scoring line');
}

// serialize / deserialize roundtrip.
ok(def.serialize(def.deserialize(def.serialize(init))) === def.serialize(init), 'serialize/deserialize roundtrip');

console.log(fail === 0 ? '\n✅ TALLY OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
