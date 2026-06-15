import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, applyEdge, chooseMove, legalEdges, winner, isOver,
  R, C, hIdx, vIdx, type DbState,
} from '../games/dotsandboxes/logic';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import './DotsAndBoxesGame.css';

const COLORS = ['#3b82f6', '#ef4444']; // Blue (you), Red (AI)
const NAMES = ['Blue', 'Red'];

export default function DotsAndBoxesGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<DbState>(() => initialState());
  const [last, setLast] = useState<number | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);
  const win = winner(s);
  const over = isOver(s);

  // Record the result once.
  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(win === 0 ? 'win' : 'lose');
    recordResult('dots-and-boxes', win === 0 ? 'win' : 'loss', aiDifficulty as any);
  }, [over, win, recorded, recordResult, aiDifficulty]);

  // AI (Red) plays — it keeps moving while completing boxes keeps the turn.
  useEffect(() => {
    if (over || s.turn !== 1) return;
    const t = setTimeout(() => {
      const before = s.scores[1];
      const e = chooseMove(s, aiDifficulty);
      const ns = applyEdge(s, e);
      playSound(ns.scores[1] > before ? 'capture' : 'move');
      setLast(e);
      setS(ns);
    }, 480);
    return () => clearTimeout(t);
  }, [s, over, aiDifficulty]);

  const drawEdge = (edge: number) => {
    resumeAudio();
    if (over || s.turn !== 0 || s.edges[edge]) return;
    const before = s.scores[0];
    const ns = applyEdge(s, edge);
    playSound(ns.scores[0] > before ? 'capture' : 'move');
    setLast(edge);
    setS(ns);
  };

  const claimable = useMemo(() => new Set(legalEdges(s)), [s]);

  const dots = [];
  for (let i = 0; i <= R; i++) for (let j = 0; j <= C; j++) {
    dots.push(<span key={`d${i}-${j}`} className="db-dot" style={{ gridRow: 2 * i + 1, gridColumn: 2 * j + 1 }} />);
  }
  const hedges = [];
  for (let r = 0; r <= R; r++) for (let c = 0; c < C; c++) {
    const e = hIdx(r, c);
    hedges.push(<button key={`h${e}`} className={`db-edge h ${s.edges[e] ? 'on' : ''} ${last === e ? 'last' : ''} ${claimable.has(e) && s.turn === 0 && !over ? 'live' : ''}`}
      style={{ gridRow: 2 * r + 1, gridColumn: 2 * c + 2 }} onClick={() => drawEdge(e)} aria-label="edge" />);
  }
  const vedges = [];
  for (let r = 0; r < R; r++) for (let c = 0; c <= C; c++) {
    const e = vIdx(r, c);
    vedges.push(<button key={`v${e}`} className={`db-edge v ${s.edges[e] ? 'on' : ''} ${last === e ? 'last' : ''} ${claimable.has(e) && s.turn === 0 && !over ? 'live' : ''}`}
      style={{ gridRow: 2 * r + 2, gridColumn: 2 * c + 1 }} onClick={() => drawEdge(e)} aria-label="edge" />);
  }
  const boxes = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const owner = s.owner[r * C + c];
    boxes.push(<div key={`b${r}-${c}`} className={`db-box ${owner !== null ? 'owned' : ''}`}
      style={{ gridRow: 2 * r + 2, gridColumn: 2 * c + 2, ['--bc' as any]: owner !== null ? COLORS[owner] : 'transparent' }}>
      {owner !== null && <span className="db-init">{NAMES[owner][0]}</span>}
    </div>);
  }

  return (
    <div className="db-game">
      <div className="db-hud">
        <Score name="You" color={COLORS[0]} score={s.scores[0]} active={s.turn === 0 && !over} />
        <div className="db-center">
          {over ? <div className="db-result">{win === 0 ? 'You win! 🏆' : 'Red wins'}</div>
            : <div className="db-turn">{s.turn === 0 ? 'Your turn — draw a line' : 'Red is thinking…'}</div>}
        </div>
        <Score name="Red" color={COLORS[1]} score={s.scores[1]} active={s.turn === 1 && !over} ai />
      </div>

      <div className="db-board" style={{ ['--gn' as any]: C }}>
        {boxes}{dots}{hedges}{vedges}
      </div>

      <div className="db-controls">
        <button className="btn sm" onClick={() => { setS(initialState()); setLast(null); setRecorded(false); }}>↻ New game</button>
        <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
        <Link className="btn sm ghost" to="/learn/dots-and-boxes">📖 Rules</Link>
        <span className="faint" style={{ fontSize: 13 }}>Complete the 4th side of a box to claim it — and move again.</span>
      </div>
    </div>
  );
}

function Score({ name, color, score, active, ai }: { name: string; color: string; score: number; active: boolean; ai?: boolean }) {
  return (
    <div className={`db-score ${active ? 'active' : ''}`}>
      <span className="db-swatch" style={{ background: color }} />
      <div className="col" style={{ lineHeight: 1.15 }}>
        <strong>{name}</strong>
        <span className="faint" style={{ fontSize: 11 }}>{ai ? 'AI' : 'You'} · {score} boxes</span>
      </div>
    </div>
  );
}
