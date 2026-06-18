import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, applyMove, chooseMove, available, winnerOf, attr, moveComment, coachTip, gradeMove,
  type QuartoState, type QuartoMove,
} from '../games/quarto/logic';
import qdef from '../games/quarto';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import CoachPanel, { type CoachMsg } from './CoachPanel';
import GameReview from './GameReview';
import type { LogEntry } from '../store/useGameStore';
import './QuartoGame.css';

const qNote = (m: QuartoMove) => {
  if (m.cell < 0) return `give #${m.give}`;
  const c = `${String.fromCharCode(97 + (m.cell % 4))}${4 - ((m.cell / 4) | 0)}`;
  return m.give >= 0 ? `${c} →#${m.give}` : `${c} ✦`;
};

/** A Quarto piece, drawn from its four binary traits. */
function QPiece({ p, big }: { p: number; big?: boolean }) {
  const tall = attr(p, 0), dark = attr(p, 1), round = attr(p, 2), hollow = attr(p, 3);
  const base = big ? 56 : 40;
  const dim = tall ? base : base * 0.62;
  const bg = dark
    ? 'radial-gradient(circle at 36% 30%, #6b7280, #111827)'
    : 'radial-gradient(circle at 36% 30%, #fff6d8, #d97706)';
  return (
    <span className="qp" style={{ width: dim, height: dim, borderRadius: round ? '50%' : '16%', background: bg, boxShadow: `0 2px 6px rgba(0,0,0,0.5), inset 0 -2px 5px rgba(0,0,0,0.35)` }}>
      {hollow === 1 && <span className="qp-hole" style={{ borderRadius: round ? '50%' : '14%' }} />}
    </span>
  );
}

export default function QuartoGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<QuartoState>(() => initialState());
  const [tentative, setTentative] = useState<number | null>(null); // cell where the held piece is tentatively placed
  const [log, setLog] = useState<CoachMsg[]>([]);
  const [review, setReview] = useState<LogEntry[]>([]);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);
  const w = winnerOf(s);
  const over = w !== null;
  const humanTurn = s.turn === 0 && !over;
  const placePhase = humanTurn && s.held !== null && tentative === null;
  const givePhase = humanTurn && !placePhase;

  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(w === 0 ? 'win' : w === 1 ? 'lose' : 'draw');
    if (w === 0 || w === 1) recordResult('quarto', w === 0 ? 'win' : 'loss', aiDifficulty as any);
  }, [over, w, recorded, recordResult, aiDifficulty]);

  // Owl (AI) does place + give as one move.
  useEffect(() => {
    if (over || s.turn !== 1) return;
    const t = setTimeout(() => {
      const m = chooseMove(s, aiDifficulty);
      if (!m) return;
      const after = applyMove(s, m);
      playSound(winnerOf(after) === 1 ? 'win' : 'move');
      setLog((l) => [...l, moveComment(s, m, after)]);
      setReview((r) => [...r, { ply: r.length + 1, player: 1, notation: qNote(m), explanation: gradeMove(s, m, after) }]);
      setS(after);
    }, 560);
    return () => clearTimeout(t);
  }, [s, over, aiDifficulty]);

  const clickCell = (idx: number) => {
    resumeAudio();
    if (!placePhase || s.board[idx] !== null) return;
    // Winning placement ends the turn immediately (no piece to give matters).
    const winMove: QuartoMove = { id: 'w', cell: idx, give: -1, notation: '' };
    const win = applyMove(s, winMove);
    if (winnerOf(win) === 0) {
      playSound('win');
      setLog((l) => [...l, moveComment(s, { ...winMove, notation: `${String.fromCharCode(97 + idx % 4)}${4 - ((idx / 4) | 0)} ✦` }, win)]);
      setReview((r) => [...r, { ply: r.length + 1, player: 0, notation: qNote(winMove), explanation: gradeMove(s, winMove, win) }]);
      setS(win); setTentative(null); return;
    }
    playSound('select');
    setTentative(idx);
  };

  const giveClick = (g: number) => {
    if (!givePhase) return;
    const m: QuartoMove = { id: `${tentative ?? -1}-${g}`, cell: tentative ?? -1, give: g, notation: '' };
    const after = applyMove(s, m);
    playSound('move');
    setLog((l) => [...l, moveComment(s, m, after)]);
    setReview((r) => [...r, { ply: r.length + 1, player: 0, notation: qNote(m), explanation: gradeMove(s, m, after) }]);
    setS(after); setTentative(null);
  };

  const newGame = () => { setS(initialState()); setTentative(null); setLog([]); setReview([]); setRecorded(false); };
  const avail = available(s);

  return (
    <div className="play-area">
      <div className="board-col quarto">
        <div className="q-status">
          {over ? <strong className="q-result">{w === 'draw' ? 'Draw' : w === 0 ? 'You win! 🏆' : 'Owl wins'}</strong>
            : s.turn === 1 ? <span>Owl is thinking…</span>
            : placePhase ? <span className="q-place">Place this piece →</span>
            : <span>{s.held === null ? 'Choose a piece to hand Owl' : 'Now hand Owl a piece'}</span>}
          {placePhase && s.held !== null && <span className="q-held"><QPiece p={s.held} big /></span>}
        </div>

        <div className="q-board">
          {s.board.map((p, i) => (
            <button key={i} className={`q-cell ${p === null && placePhase ? 'live' : ''} ${tentative === i ? 'tent' : ''}`} onClick={() => clickCell(i)} aria-label="cell">
              {p !== null && <QPiece p={p} />}
              {p === null && tentative === i && s.held !== null && <span className="q-ghost"><QPiece p={s.held} /></span>}
            </button>
          ))}
        </div>

        <div className={`q-tray ${givePhase ? 'active' : ''}`}>
          <span className="q-tray-label">{givePhase ? 'Hand a piece to Owl:' : 'Pieces left'}</span>
          <div className="q-tray-pieces">
            {avail.map((p) => (
              <button key={p} className="q-tray-piece" disabled={!givePhase} onClick={() => giveClick(p)} title="Give this piece"><QPiece p={p} /></button>
            ))}
          </div>
        </div>

        <div className="q-controls">
          <button className="btn sm" onClick={newGame}>↻ New game</button>
          <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <Link className="btn sm ghost" to="/learn/quarto">📖 Rules</Link>
        </div>
      </div>

      <aside className="side-col">
        {over && review.length > 0 && <GameReview def={qdef} log={review} status={qdef.getStatus(s)} />}
        <CoachPanel title="AI Coach" subtitle="Quarto commentary" messages={log} tip={coachTip(s)} />
      </aside>
    </div>
  );
}
