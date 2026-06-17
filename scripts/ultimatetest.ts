/** Ultimate Tic-Tac-Toe: send mechanic, sub/meta wins, AI, termination, timing. */
import {
  initialState, applyMove, chooseMove, legalMoves, winnerOf, playableBoards, evaluate,
  type UTTTState, type Mark,
} from '../src/games/ultimate/logic';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const init = initialState();
ok(init.cells.length === 81 && init.cells.every((v) => v === null), 'initial: 81 empty cells');
ok(init.boards.length === 9 && init.boards.every((b) => b === null) && init.active === -1 && init.turn === 0, 'initial: 9 open boards, play anywhere, X first');
ok(legalMoves(init).length === 81, 'opening: 81 legal moves (any cell of any board)');

// The send mechanic: the CELL index chosen forces the opponent's next board.
{
  const s1 = applyMove(init, { id: 'm', board: 4, cell: 2, notation: '' }); // X plays cell 2 of centre board
  ok(s1.cells[4 * 9 + 2] === 0 && s1.turn === 1, 'a move marks the chosen cell and passes turn');
  ok(s1.active === 2, 'the chosen cell (2) sends the opponent to board 2');
  ok(playableBoards(s1).length === 1 && playableBoards(s1)[0] === 2, 'opponent is forced to the top-right board');
}

// Winning a small board, and being sent to a decided board frees the choice.
{
  let s: UTTTState = { cells: Array(81).fill(null), boards: Array(9).fill(null), active: 0, turn: 0 };
  s.cells[0] = 0; s.cells[1] = 0; // two X in board 0
  s = applyMove(s, { id: 'w', board: 0, cell: 2, notation: '' }); // X completes board 0 (cells 0,1,2)
  ok(s.boards[0] === 0, 'three-in-a-row wins the small board for X');
  // X's last cell was 2 → would send O to board 2 (still open) → active 2
  ok(s.active === 2, 'after winning a board, the cell still dictates the next board');
  // Now craft: O is sent to board 0 (already won) → may play anywhere.
  const s2 = applyMove({ ...s, cells: s.cells.slice(), active: -1, turn: 1 }, { id: 'x', board: 5, cell: 0, notation: '' });
  ok(s2.active === -1, 'being sent to a decided board (0) means play anywhere');
}

// Meta win: three small boards in a row wins the game.
{
  const boards: (Mark | 'draw' | null)[] = Array(9).fill(null);
  boards[0] = 0; boards[1] = 0; boards[2] = 0; // top meta-row all X
  ok(winnerOf({ cells: Array(81).fill(null), boards, active: -1, turn: 1 }) === 0, 'three boards in a meta-row wins the game');
  const boards2: (Mark | 'draw' | null)[] = [0, 1, 0, 1, 0, 1, 1, 0, 1].map((v) => v as Mark);
  ok(winnerOf({ cells: Array(81).fill(0), boards: boards2, active: -1, turn: 0 }) === 'draw', 'all boards decided, no meta-line → draw');
  ok(winnerOf({ cells: Array(81).fill(null), boards: [0, 1, 'draw', null, null, null, null, null, null], active: -1, turn: 0 }) === null, 'game continues while boards remain open');
}

// evaluate: owning the centre board favours X (player 0); contested meta-lines are neutralish.
{
  const b1: (Mark | 'draw' | null)[] = Array(9).fill(null); b1[4] = 0;
  ok(evaluate({ cells: Array(81).fill(null), boards: b1, active: -1, turn: 1 }) > 0, 'owning the centre board scores for X');
  const b2: (Mark | 'draw' | null)[] = Array(9).fill(null); b2[4] = 1;
  ok(evaluate({ cells: Array(81).fill(null), boards: b2, active: -1, turn: 0 }) < 0, 'owning the centre board for O scores negative');
}

// AI returns a move at every difficulty, deterministically.
for (const d of ['easy', 'medium', 'hard'] as const) ok(!!chooseMove(init, d), `chooseMove(${d}) → ${chooseMove(init, d)?.notation}`);
{
  const s1 = applyMove(init, { id: 'm', board: 4, cell: 4, notation: '' }); // O now forced into centre board
  ok(chooseMove(s1, 'hard')?.id === chooseMove(s1, 'hard')?.id, 'chooseMove is deterministic');
  const t0 = Date.now(); chooseMove(s1, 'hard'); const ms = Date.now() - t0;
  ok(ms < 2500, `hard reply to a forced board in ${ms}ms (<2500)`);
}

// Worst case: a wide "play anywhere" position mid-game (adaptive depth keeps it fast).
{
  let s = init; const seq = [[4, 0], [0, 4], [4, 1], [1, 4], [4, 8]]; // build toward a free choice
  for (const [b, c] of seq) s = applyMove(s, { id: 'x', board: b, cell: c, notation: '' });
  const t0 = Date.now(); const m = chooseMove(s, 'hard'); const ms = Date.now() - t0;
  ok(!!m && ms < 3000, `hard move in a ${legalMoves(s).length}-move position: ${ms}ms (<3000)`);
}

// Termination is structural: a full game fills ≤81 cells and ends decisively.
{
  let s = init, plies = 0; const t0 = Date.now();
  while (winnerOf(s) === null && plies < 90) { const m = chooseMove(s, 'medium'); if (!m) break; s = applyMove(s, m); plies++; }
  const w = winnerOf(s);
  ok(w !== null && plies <= 81, `AI vs AI ends in ${plies} plies (≤81) → ${w === 'draw' ? 'draw' : w === 0 ? 'X' : 'O'} (${Date.now() - t0}ms total)`);
}

console.log(fail === 0 ? '\n✅ ULTIMATE OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
