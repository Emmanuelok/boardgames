import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, applyMove, chooseMove, result, moveComment, coachTip,
  type PentagoState, type PentagoMove,
} from '../games/pentago/logic';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import CoachPanel, { type CoachMsg } from './CoachPanel';
import './PentagoGame.css';

const COLORS = ['#f59e0b', '#3b82f6']; // Amber (you), Blue (AI)
const QORIGIN = [[0, 0], [0, 3], [3, 0], [3, 3]];

export default function PentagoGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<PentagoState>(() => initialState());
  const [placed, setPlaced] = useState<number | null>(null); // tentative marble awaiting a rotation
  const [log, setLog] = useState<CoachMsg[]>([]);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);
  const res = result(s.board);
  const over = res.winner !== null || res.draw;
  const myTurn = s.turn === 0 && !over;

  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(res.winner === 0 ? 'win' : res.winner === 1 ? 'lose' : 'draw');
    if (res.winner !== null) recordResult('pentago', res.winner === 0 ? 'win' : 'loss', aiDifficulty as any);
  }, [over, res.winner, recorded, recordResult, aiDifficulty]);

  // AI (Blue) does place + rotate as one move.
  useEffect(() => {
    if (over || s.turn !== 1) return;
    const t = setTimeout(() => {
      const m = chooseMove(s, aiDifficulty);
      if (!m) return;
      const after = applyMove(s, m);
      playSound(result(after.board).winner === 1 ? 'win' : 'move');
      setLog((l) => [...l, moveComment(s, m, after)]);
      setS(after);
    }, 520);
    return () => clearTimeout(t);
  }, [s, over, aiDifficulty]);

  const clickCell = (idx: number) => {
    resumeAudio();
    if (!myTurn || s.board[idx] !== null) return;
    playSound('select');
    setPlaced(idx); // choose / re-choose where to place; now pick a rotation
  };

  const doRotate = (quad: number, dir: 1 | -1) => {
    if (!myTurn || placed === null) return;
    const m: PentagoMove = { id: `${placed}-${quad}-${dir}`, cell: placed, quad, dir, notation: '' };
    const after = applyMove(s, m);
    playSound(result(after.board).winner === 0 ? 'win' : 'move');
    setLog((l) => [...l, moveComment(s, m, after)]);
    setS(after);
    setPlaced(null);
  };

  const newGame = () => { setS(initialState()); setPlaced(null); setLog([]); setRecorded(false); };

  return (
    <div className="play-area">
      <div className="board-col pentago">
        <div className="pg-status">
          {over
            ? <strong className="pg-result">{res.draw ? 'Draw' : res.winner === 0 ? 'You win! 🏆' : 'Blue wins'}</strong>
            : myTurn
              ? <span>{placed === null ? 'Your turn — place a marble' : 'Now rotate a quadrant ↻'}</span>
              : <span>Blue is thinking…</span>}
        </div>

        <div className="pg-board">
          {[0, 1, 2, 3].map((q) => {
            const [or, oc] = QORIGIN[q];
            return (
              <div className="pg-quad" key={q}>
                {Array.from({ length: 9 }).map((_, k) => {
                  const r = (k / 3) | 0, c = k % 3;
                  const idx = (or + r) * 6 + (oc + c);
                  const v = s.board[idx];
                  return (
                    <button key={idx} className={`pg-cell ${v === null && myTurn ? 'live' : ''}`} onClick={() => clickCell(idx)} aria-label="cell">
                      {v !== null && <span className="pg-marble" style={{ background: `radial-gradient(circle at 35% 30%, #fff6, ${COLORS[v]})` }} />}
                      {v === null && placed === idx && <span className="pg-marble ghost" style={{ background: `radial-gradient(circle at 35% 30%, #fff6, ${COLORS[0]})` }} />}
                    </button>
                  );
                })}
                {myTurn && placed !== null && (
                  <div className="pg-rot">
                    <button onClick={() => doRotate(q, -1)} title="Rotate anticlockwise">↺</button>
                    <button onClick={() => doRotate(q, 1)} title="Rotate clockwise">↻</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="pg-controls">
          <button className="btn sm" onClick={newGame}>↻ New game</button>
          <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <Link className="btn sm ghost" to="/learn/pentago">📖 Rules</Link>
          {placed !== null && !over && <span className="faint" style={{ fontSize: 13 }}>Pick a quadrant’s ↺ / ↻ to spin it and end your turn.</span>}
        </div>
      </div>

      <aside className="side-col">
        <CoachPanel title="AI Coach" subtitle="Pentago commentary" messages={log} tip={coachTip(s)} />
      </aside>
    </div>
  );
}
