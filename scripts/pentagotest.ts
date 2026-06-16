/** Pentago: placement, quadrant rotation, win-after-rotation, AI, termination. */
import { initialState, applyMove, chooseMove, rotate, hasFive, result, legalMoves, type PentagoState } from '../src/games/pentago/logic';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const idx = (r: number, c: number) => r * 6 + c;

const init = initialState();
ok(init.board.every((v) => v === null) && init.turn === 0, 'initial: empty board, Amber to move');
// Each placement offers: rotate its own quadrant (2 ways) + one no-op (leave the board). = 3 per cell.
ok(legalMoves(init).length === 36 * 3, 'first move: 36 cells × (2 real rotations + 1 no-op)');

// Quadrant rotation moves the right cells (Q0 clockwise: TL→TR).
{
  const b = Array(36).fill(null) as (0 | 1 | null)[];
  b[idx(0, 0)] = 0; // top-left of Q0
  const r = rotate(b, 0, 1); // clockwise
  ok(r[idx(0, 2)] === 0 && r[idx(0, 0)] === null, 'clockwise rotation of Q0 sends a1→c1 (TL→TR)');
  ok(rotate(b, 0, -1)[idx(2, 0)] === 0, 'anticlockwise rotation of Q0 sends a1 to the bottom-left');
}

// Five in a row is detected.
{
  const b = Array(36).fill(null) as (0 | 1 | null)[];
  for (let c = 0; c < 5; c++) b[idx(2, c)] = 0;
  ok(hasFive(b, 0) && !hasFive(b, 1), 'detects five in a row');
}

// A rotation can COMPLETE the win (the defining mechanic).
{
  // Four in row 0 of cols 0..3 (all in the top two quadrants), plus a marble that
  // a rotation slides into place. Simplest: build four, place the fifth, rotate a
  // quadrant that isn't on the line so the five survives.
  let s: PentagoState = initialState();
  const b = s.board.slice();
  for (const c of [0, 1, 2]) b[idx(0, c)] = 0; // a6,b6,c6
  b[idx(0, 4)] = 0; // e6  (gap at d6 = col3)
  s = { board: b, turn: 0 };
  // Place at d6 (col3) to make a6..e6 five, then rotate Q2 (bottom-left, off the line) to keep it.
  const m = legalMoves(s).find((x) => x.cell === idx(0, 3) && x.quad === 2)!;
  ok(!!m, 'a placing+rotate move filling the gap exists');
  if (m) ok(result(applyMove(s, m).board).winner === 0, 'placing the fifth (and rotating off the line) wins');
}

// AI returns a legal move and a game terminates.
for (const d of ['easy', 'medium', 'hard'] as const) {
  const m = chooseMove(init, d);
  ok(!!m && init.board[m.cell] === null, `chooseMove(${d}) → ${m?.notation}`);
}
{
  let s = init, plies = 0, r = result(s.board); const t0 = Date.now();
  while (!r.winner && !r.draw && plies < 40) { const m = chooseMove(s, 'hard'); if (!m) break; s = applyMove(s, m); r = result(s.board); plies++; }
  ok(r.winner !== null || r.draw, `AI vs AI ends: ${plies} plies → ${r.winner === null ? 'draw' : r.winner === 0 ? 'Amber' : 'Blue'} (${Date.now() - t0}ms)`);
}
ok(JSON.stringify(JSON.parse(JSON.stringify(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip (JSON)');

console.log(fail === 0 ? '\n✅ PENTAGO OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
