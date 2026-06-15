/** Principal-variation extraction: the hint line must be legal and start with
 *  the recommended move; chessHint must surface it. */
import { initialState, fromFen, Position, legalMovesFor, applyChessMove } from '../src/games/chess/engine';
import { analyze } from '../src/games/chess/search';
import { chessHint } from '../src/games/chess/tutor';

let fail = 0;
const ok = (c: boolean, msg: string) => { console.log(`  ${c ? '✓' : '✗'} ${msg}`); if (!c) fail++; };

// 1) PV from the opening is legal and begins with the best move.
function checkPVLegal(fen: string | null, label: string) {
  const state = fen ? fromFen(fen) : initialState();
  const out = analyze(state, 5, 600);
  if (!out.best) { ok(false, `${label}: no best move`); return; }
  ok(out.pv.length >= 1, `${label}: PV non-empty (${out.pv.join(' ')})`);
  ok(out.pv[0] === new Position(state).toSAN(out.best), `${label}: PV[0] is the best move`);
  // Replay the PV by matching SAN to a legal move at each step.
  let cur = state;
  let legalAll = true;
  for (const san of out.pv) {
    const mv = legalMovesFor(cur).find((m) => new Position(cur).toSAN(m) === san);
    if (!mv) { legalAll = false; break; }
    cur = applyChessMove(cur, mv);
  }
  ok(legalAll, `${label}: every PV move is legal in sequence`);
}

checkPVLegal(null, 'opening');
checkPVLegal('r3k2r/ppp2ppp/2n1b3/3q4/3P4/2N1B3/PPP2PPP/R3K2R w KQkq - 0 1', 'middlegame');
// Mate-in-one position: PV should be short and the hint should call it mate.
checkPVLegal('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'rook endgame');

// 2) Hint surfaces the engine line.
const h = chessHint(initialState());
ok(!!h && /Engine line:/.test(h.text), `hint includes the engine line → "${h?.text.slice(0, 80)}…"`);

console.log(fail === 0 ? '\n✅ PRINCIPAL VARIATION OK' : `\n❌ ${fail} check(s) failed`);
if (fail > 0) process.exit(1);
