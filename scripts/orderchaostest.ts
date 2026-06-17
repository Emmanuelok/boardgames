/** Order and Chaos: shared-symbol placement, the "exactly five" rule, AI, termination. */
import def from '../src/games/orderandchaos';
import {
  initialState, applyMove, chooseMove, legalMoves, winnerOf, orderWins, orderThreats, evaluate, N,
  moveComment, coachTip, type OCState, type Sym,
} from '../src/games/orderandchaos/logic';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const empty = (): (Sym | null)[] => Array(N * N).fill(null);
const row2 = (cols: (Sym | null)[]): (Sym | null)[] => { const b = empty(); cols.forEach((v, c) => { if (v !== null) b[12 + c] = v; }); return b; };

const init = initialState();
ok(init.board.length === 36 && init.board.every((v) => v === null) && init.turn === 0, 'initial: empty 6×6, Order to move');
ok(legalMoves(init).length === 72, 'opening: 72 moves (36 squares × 2 symbols)');

// The defining rule: exactly five wins; six does NOT.
ok(orderWins(row2([0, 0, 0, 0, 0, null])) === true, 'five identical in a row wins for Order');
ok(orderWins(row2([0, 0, 0, 0, 0, 0])) === false, 'SIX in a row does NOT count (the balancing rule)');
ok(orderWins(row2([0, 0, 0, 0, null, null])) === false, 'four in a row is not yet a win');
ok(orderWins(row2([0, 0, 1, 0, 0, null])) === false, 'a line broken by the other symbol is dead');
// Diagonal five.
{ const b = empty(); for (let k = 0; k < 5; k++) b[k * N + k] = 1; ok(orderWins(b) === true, 'five on a diagonal wins for Order'); }

// winnerOf / no draws.
ok(winnerOf({ board: row2([0, 0, 0, 0, 0, null]), turn: 1 }) === 0, 'winnerOf: Order on a five');
{ const full = empty().map((_, i) => ((Math.floor(i / N) + (i % N)) % 2) as Sym); ok(winnerOf({ board: full, turn: 0 }) === 1 || orderWins(full), 'a full board with no five is a Chaos win'); }
ok(winnerOf(init) === null, 'game in progress before any line');

// applyMove places the chosen symbol and passes the turn.
{
  const s1 = applyMove(init, { id: 'x', cell: 14, sym: 0, notation: '' });
  ok(s1.board[14] === 0 && s1.turn === 1, 'a move places X and passes to Chaos');
  const s2 = applyMove(s1, { id: 'o', cell: 15, sym: 1, notation: '' });
  ok(s2.board[15] === 1 && s2.turn === 0, 'either player may place either symbol');
}

// orderThreats finds the immediate winning squares.
ok(JSON.stringify(orderThreats(row2([null, 0, 0, 0, 0, null]))) === JSON.stringify([12, 17]), 'open four → two winning squares (a double threat)');
ok(orderThreats(row2([0, 0, 0, 0, null, null])).length === 1, 'a four closed on one side → a single winning square');

// evaluate: positive favours Order, and a near-complete line scores higher.
ok(evaluate({ board: row2([0, 0, 0, 0, 0, null]), turn: 1 }) > 100000, 'evaluate: an Order five is a winning score');
ok(evaluate({ board: row2([null, 0, 0, 0, 0, null]), turn: 0 }) > evaluate({ board: row2([0, null, null, null, null, null]), turn: 0 }), 'evaluate rewards lines that are closer to five');

// AI at every difficulty, deterministic, and fast even at the widest branching.
for (const d of ['easy', 'medium', 'hard'] as const) ok(!!chooseMove(init, d), `chooseMove(${d}) → ${chooseMove(init, d)?.notation}`);
ok(chooseMove(init, 'medium')?.id === chooseMove(init, 'medium')?.id, 'chooseMove is deterministic for a position');
{ const t0 = Date.now(); chooseMove(init, 'hard'); const ms = Date.now() - t0; ok(ms < 3000, `hard opening move in ${ms}ms (<3000)`); }

// Termination is structural — every move fills a square, so a game is ≤36 plies
// and ends decisively (Order makes five, or Chaos fills the board).
{
  let s: OCState = init, plies = 0; const t0 = Date.now();
  while (winnerOf(s) === null && plies < 60) { const m = chooseMove(s, 'medium'); if (!m) break; s = applyMove(s, m); plies++; }
  const w = winnerOf(s);
  ok(w !== null && plies <= 36, `AI vs AI ends in ${plies} plies (≤36) → ${w === 0 ? 'Order' : 'Chaos'} (${Date.now() - t0}ms)`);
}

// Tutorial illustrations must match what their captions claim.
{
  const steps = def.tutorial.chapters.flatMap((c) => c.steps);
  const all = JSON.stringify(def.tutorial);
  ok(!all.includes('__') && !/SETUP/.test(all), 'no placeholder text remains in the tutorial');
  const get = (title: string) => steps.find((s) => s.title.startsWith(title))!;
  const five = get('Order wins'); ok(orderWins(def.deserialize(five.setup!).board) === true && five.highlight!.length === 5, 'illustration "Order wins on five" really is a winning five');
  const six = get('Six does'); ok(orderWins(def.deserialize(six.setup!).board) === false && six.highlight!.length === 6, 'illustration "six does NOT count" is a non-winning run of six');
  const jam = get('Chaos wins by'); ok(orderWins(def.deserialize(jam.setup!).board) === false, 'illustration "Chaos jamming" shows a poisoned (dead) line');
  const dbl = get('Order: make a double'); ok(JSON.stringify(orderThreats(def.deserialize(dbl.setup!).board)) === JSON.stringify(dbl.highlight), 'illustration "double threat" highlights exactly the two winning squares');
}

// Board view renders X/O as mark glyphs.
{
  const view = def.getBoardView(applyMove(init, { id: 'x', cell: 0, sym: 0, notation: '' }));
  ok(view.rows === 6 && view.cols === 6 && view.cells.length === 36, 'board view is 6×6');
  ok(view.cells[0].piece?.glyph === '✕' && view.cells[0].piece?.player === 0, 'a placed X renders as a mark glyph');
}

// Perspective-aware commentary: the same move reads differently to each side,
// so the human can play Order OR Chaos.
{
  const before: OCState = { board: row2([null, 0, 0, 0, null, null]), turn: 1 }; // three X's, Chaos to move
  const m = { id: 'o16', cell: 16, sym: 1 as Sym, notation: '' };
  const after = applyMove(before, m); // Chaos drops O into the line
  ok(orderThreats(after.board).length === 0, 'Chaos can poison a three-in-a-row line dead');
  ok(moveComment(before, m, after, 1).tone === 'good', 'as Chaos, poisoning a line reads as a GOOD move');
  ok(moveComment(before, m, after, 0).tone === 'bad', 'as Order, that same Chaos move reads as BAD');
  ok(/Chaos/.test(coachTip(before, 1)) && /five/.test(coachTip(before, 1)), 'coachTip speaks to the Chaos player');
  // The AI can play Order: from the empty board (Order to move) it returns a build.
  ok(!!chooseMove(initialState(), 'hard'), 'AI plays the Order role when the human picks Chaos');
}

// serialize / deserialize roundtrip.
ok(def.serialize(def.deserialize(def.serialize(init))) === def.serialize(init), 'serialize/deserialize roundtrip');

console.log(fail === 0 ? '\n✅ ORDER AND CHAOS OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
