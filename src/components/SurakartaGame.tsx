import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, legalMoves, applyMove, winnerOf, chooseMove, gradeMove, moveComment, coachTip,
  rowOf, colOf, SIZE, type SkState, type SkMove,
} from '../games/surakarta/logic';
import sdef from '../games/surakarta';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import CoachPanel, { type CoachMsg } from './CoachPanel';
import GameReview from './GameReview';
import { summarize, saveRecord } from '../engine/reviewSummary';
import type { LogEntry } from '../store/useGameStore';
import './SurakartaGame.css';

const S = 58, M = 74, E = 30;            // cell spacing, outer margin, loop extension
const W = 2 * M + (SIZE - 1) * S;
const px = (c: number) => M + c * S;
const py = (r: number) => M + r * S;
const COLOR = ['#fbbf24', '#38bdf8'];

// A loop arc: connect two line-tips with a quadratic curve bulging to the corner.
const loop = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
// Corners: [cornerRow, cornerCol, outwardX(-1/1), outwardY]; loops pair rows/cols (0,5)=outer, (1,4)=inner.
const LOOPS: string[] = (() => {
  const out: string[] = [];
  const corners: [number, number, number, number][] = [[0, 0, -1, -1], [0, 5, 1, -1], [5, 0, -1, 1], [5, 5, 1, 1]];
  for (const [cr, cc, ox, oy] of corners) {
    const ctlX = px(cc) + ox * E, ctlY = py(cr) + oy * E;
    // outer loop: row cr ↔ col cc (the edge lines)
    out.push(loop(px(cc) + ox * E, py(cr), px(cc), py(cr) + oy * E, ctlX, ctlY));
    // inner loop: row (cr==0?1:4) ↔ col (cc==0?1:4)
    const ir = cr === 0 ? 1 : 4, ic = cc === 0 ? 1 : 4;
    out.push(loop(px(cc) + ox * E, py(ir), px(ic), py(cr) + oy * E, ctlX, ctlY));
  }
  return out;
})();

export default function SurakartaGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<SkState>(() => initialState());
  const [sel, setSel] = useState<number | null>(null);
  const [last, setLast] = useState<{ from: number; to: number } | null>(null);
  const [log, setLog] = useState<CoachMsg[]>([]);
  const [review, setReview] = useState<LogEntry[]>([]);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);

  const w = winnerOf(s);
  const over = w !== null;
  const humanTurn = s.turn === 0 && !over;
  const dests = useMemo(() => (sel != null && humanTurn ? legalMoves(s, sel) : []), [s, sel, humanTurn]);
  const destMap = useMemo(() => new Map(dests.map((m) => [m.to, m])), [dests]);

  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(w === 0 ? 'win' : w === 1 ? 'lose' : 'draw');
    if (w === 0 || w === 1) recordResult('surakarta', w === 0 ? 'win' : 'loss', aiDifficulty as any);
    if (review.length >= 4) try { saveRecord(summarize(sdef, review, sdef.getStatus(s), 0)); } catch { /* ignore */ }
  }, [over, w, recorded, recordResult, aiDifficulty]);

  useEffect(() => {
    if (over || s.turn !== 1) return;
    const t = setTimeout(() => {
      const m = chooseMove(s, aiDifficulty);
      if (!m) return;
      const after = applyMove(s, m);
      playSound(m.capture ? 'capture' : 'move');
      setLast({ from: m.from, to: m.to });
      setLog((l) => [...l, moveComment(s, m, after)]);
      setReview((r) => [...r, { ply: r.length + 1, player: 1, notation: m.notation, explanation: gradeMove(s, m, after) }]);
      setS(after); setSel(null);
    }, 540);
    return () => clearTimeout(t);
  }, [s, over, aiDifficulty]);

  const play = (m: SkMove) => {
    const after = applyMove(s, m);
    playSound(m.capture ? 'capture' : 'select');
    setLast({ from: m.from, to: m.to });
    setLog((l) => [...l, moveComment(s, m, after)]);
    setReview((r) => [...r, { ply: r.length + 1, player: 0, notation: m.notation, explanation: gradeMove(s, m, after) }]);
    setS(after); setSel(null);
  };

  const clickPoint = (i: number) => {
    resumeAudio();
    if (!humanTurn) return;
    const m = destMap.get(i);
    if (sel != null && m) { play(m); return; }
    if (s.points[i] === 0) { setSel(i); playSound('select'); }
    else setSel(null);
  };

  const newGame = () => { setS(initialState()); setSel(null); setLast(null); setLog([]); setReview([]); setRecorded(false); };

  const status = over
    ? (w === 'draw' ? 'Draw — no capture in 40 moves' : w === 0 ? 'You win — board cleared! 🏆' : 'Sphinx wins')
    : s.turn === 1 ? 'Sphinx is tracing the loops…'
    : sel != null ? 'Choose a destination — dots are steps, rings are loop-captures' : 'Your move — tap a gold piece';

  return (
    <div className="play-area">
      <div className="board-col surakarta">
        <div className="sk-status"><span className={`sk-role ${over ? (w === 0 ? 'win' : w === 1 ? 'lose' : '') : ''}`}>{status}</span></div>

        <div className="sk-board-wrap">
          <svg viewBox={`0 0 ${W} ${W}`} className="sk-svg" role="img" aria-label="Surakarta board">
            {/* extended grid lines (rows/cols 0,1,4,5 reach out to their loops) */}
            {Array.from({ length: SIZE }, (_, r) => { const ext = r === 0 || r === 1 || r === 4 || r === 5; return <line key={`h${r}`} x1={px(0) - (ext ? E : 0)} y1={py(r)} x2={px(5) + (ext ? E : 0)} y2={py(r)} className="sk-line" />; })}
            {Array.from({ length: SIZE }, (_, c) => { const ext = c === 0 || c === 1 || c === 4 || c === 5; return <line key={`v${c}`} x1={px(c)} y1={py(0) - (ext ? E : 0)} x2={px(c)} y2={py(5) + (ext ? E : 0)} className="sk-line" />; })}
            {/* the eight corner loops */}
            {LOOPS.map((d, i) => <path key={i} d={d} className="sk-loop" fill="none" />)}

            {/* point dots */}
            {Array.from({ length: SIZE * SIZE }, (_, i) => <circle key={`p${i}`} cx={px(colOf(i))} cy={py(rowOf(i))} r={2.5} className="sk-dot" />)}

            {/* last-move trail */}
            {last && <line x1={px(colOf(last.from))} y1={py(rowOf(last.from))} x2={px(colOf(last.to))} y2={py(rowOf(last.to))} className="sk-last" />}

            {/* pieces */}
            {s.points.map((p, i) => p === null ? null : (
              <g key={`g${i}`}>
                <circle cx={px(colOf(i))} cy={py(rowOf(i))} r={S * 0.34} fill={COLOR[p]} className={`sk-piece ${sel === i ? 'sel' : ''}`} />
                {sel === i && <circle cx={px(colOf(i))} cy={py(rowOf(i))} r={S * 0.44} className="sk-selring" fill="none" />}
              </g>
            ))}

            {/* move targets */}
            {dests.map((m) => m.capture
              ? <circle key={`c${m.to}`} cx={px(colOf(m.to))} cy={py(rowOf(m.to))} r={S * 0.46} className="sk-captring" fill="none" />
              : <circle key={`d${m.to}`} cx={px(colOf(m.to))} cy={py(rowOf(m.to))} r={S * 0.16} className="sk-movedot" />)}

            {/* click hit-areas */}
            {Array.from({ length: SIZE * SIZE }, (_, i) => (
              <circle key={`h${i}`} cx={px(colOf(i))} cy={py(rowOf(i))} r={S * 0.46} fill="transparent"
                style={{ cursor: humanTurn && (s.points[i] === 0 || destMap.has(i)) ? 'pointer' : 'default' }} onClick={() => clickPoint(i)} />
            ))}
          </svg>
        </div>

        <div className="sk-controls">
          <button className="btn sm" onClick={newGame}>↻ New game</button>
          <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <Link className="btn sm ghost" to="/learn/surakarta">📖 Rules</Link>
        </div>
      </div>

      <aside className="side-col">
        {over && review.length > 0 && <GameReview def={sdef} log={review} status={sdef.getStatus(s)} />}
        <CoachPanel title="AI Coach" subtitle="Surakarta commentary" messages={log} tip={coachTip(s)} />
      </aside>
    </div>
  );
}
