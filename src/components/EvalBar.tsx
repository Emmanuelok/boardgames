/**
 * The live advantage bar — a slim vertical gauge beside the board that shows,
 * in real time, who the engine thinks is winning. White fills from one end,
 * Black from the other; the numeric label is the evaluation from White's point
 * of view (or a mate count). It reads the searched eval the store keeps fresh.
 */
import type { GameStatus, LiveEval } from '../engine/types';
import './EvalBar.css';

export default function EvalBar({
  info, loading, status, flipped, scale = 400,
}: { info: LiveEval | null; loading: boolean; status: GameStatus; flipped: boolean; scale?: number }) {
  let whiteFrac = 0.5; // share of the bar belonging to White (player 0)
  let label = '…';
  let decisive = false;

  if (status.kind === 'win') {
    whiteFrac = status.winner === 0 ? 1 : 0;
    label = status.winner === 0 ? '1–0' : '0–1';
    decisive = true;
  } else if (status.kind === 'draw') {
    whiteFrac = 0.5;
    label = '½–½';
  } else if (info) {
    if (info.mate !== undefined && info.mate !== 0) {
      whiteFrac = info.mate > 0 ? 1 : 0;
      label = `M${Math.abs(info.mate)}`;
      decisive = true;
    } else {
      // Logistic map from the score to a win-probability-like share.
      whiteFrac = 1 / (1 + Math.pow(10, -info.score / scale));
      const pawns = info.score / 100;
      label = `${pawns >= 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`;
    }
  }

  // Keep a sliver of each colour visible unless the game is actually decided.
  const shown = decisive ? whiteFrac : Math.min(0.97, Math.max(0.03, whiteFrac));
  const whiteLeads = whiteFrac >= 0.5;

  return (
    <div className={`eval-bar${flipped ? ' flipped' : ''}${loading && !decisive ? ' thinking' : ''}`} title="Engine evaluation — who is winning right now">
      <div className="eval-track">
        <div className="eval-fill" style={{ height: `${(shown * 100).toFixed(1)}%` }} />
        <div className="eval-mid" />
      </div>
      <div className={`eval-label ${whiteLeads ? 'w' : 'b'}`}>{label}</div>
    </div>
  );
}
