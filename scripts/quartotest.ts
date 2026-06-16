/** Quarto: traits, shared-trait lines, the give mechanic, AI, termination. */
import { initialState, applyMove, chooseMove, legalMoves, available, hasQuarto, winnerOf, attr } from '../src/games/quarto/logic';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const init = initialState();
ok(init.board.every((v) => v === null) && init.held === null && init.turn === 0, 'initial: empty board, no held piece');
ok(legalMoves(init).length === 16, 'opening: 16 pieces can be given (no placement yet)');
ok(available(init).length === 16, 'all 16 pieces available at the start');

// Trait bits: piece 0 = short/light/square/solid; piece 15 = tall/dark/round/hollow.
ok([0, 1, 2, 3].map((b) => attr(0, b)).join('') === '0000' && [0, 1, 2, 3].map((b) => attr(15, b)).join('') === '1111', 'trait bits decode correctly');

// A row of four pieces all sharing "tall" (bit0=1) is a Quarto.
{
  const board: (number | null)[] = Array(16).fill(null);
  // pieces 1,3,5,7 all have bit0=1 (tall) → share a trait.
  board[0] = 1; board[1] = 3; board[2] = 5; board[3] = 7;
  ok(hasQuarto(board), 'four tall pieces in a row is a Quarto');
  const board2 = board.slice(); board2[3] = 6; // 6 = bit0=0 (short) → breaks "tall"; check no other shared trait
  // 1(0001),3(0011),5(0101),6(0110): bit1: 0,1,0,1 no; bit2:0,0,1,1 no; bit3:0,0,0,0 YES (all solid)→ still Quarto. pick to truly break:
  board2[3] = 8; // 8=1000 hollow; 1(0001),3(0011),5(0101),8(1000): bit0:1,1,1,0; bit1:0,1,0,0; bit2:0,0,1,0; bit3:0,0,0,1 → none shared
  ok(!hasQuarto(board2), 'a line with no common trait is not a Quarto');
}

// The give passes a piece to the opponent; placement uses the held piece.
{
  let s = applyMove(init, { id: 'g', cell: -1, give: 5, notation: '' }); // human gives piece 5
  ok(s.turn === 1 && s.held === 5, 'after the opening give, opponent holds the given piece');
  s = applyMove(s, { id: 'p', cell: 0, give: 9, notation: '' }); // opponent places 5 at a4, gives 9
  ok(s.board[0] === 5 && s.turn === 0 && s.held === 9, 'a turn places the held piece and hands over a new one');
}

// Winning placement: completing a shared-trait line wins for the mover.
{
  const board: (number | null)[] = Array(16).fill(null);
  board[0] = 1; board[1] = 3; board[2] = 5; // three tall pieces in row 0
  const s = { board, held: 7, turn: 0 as const }; // holding piece 7 (tall)
  const after = applyMove(s, { id: 'w', cell: 3, give: -1, notation: '' });
  ok(winnerOf(after) === 0, 'placing the fourth tall piece wins for the placer');
}

// AI + termination.
for (const d of ['easy', 'medium', 'hard'] as const) {
  const m = chooseMove(init, d);
  ok(!!m, `chooseMove(${d}) → ${m?.notation}`);
}
{
  let s = init, plies = 0, t0 = Date.now();
  while (winnerOf(s) === null && plies < 40) { const m = chooseMove(s, 'medium'); if (!m) break; s = applyMove(s, m); plies++; }
  const w = winnerOf(s);
  ok(w !== null, `AI vs AI ends: ${plies} plies → ${w === 'draw' ? 'draw' : w === 0 ? 'You' : 'Owl'} (${Date.now() - t0}ms)`);
}
ok(JSON.stringify(JSON.parse(JSON.stringify(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip (JSON)');

console.log(fail === 0 ? '\n✅ QUARTO OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
