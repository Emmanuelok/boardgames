import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, applyMove, chooseMove, winnerOf, orderThreats, N,
  moveComment, coachTip, type OCState, type Sym,
} from '../games/orderandchaos/logic';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import CoachPanel, { type CoachMsg } from './CoachPanel';
import './OrderChaosGame.css';

const sqName = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;

/** A drawn X or O matching the board/tutorial palette (X emerald, O rose). */
function Mark({ sym, ghost }: { sym: Sym; ghost?: boolean }) {
  return <span className={`oc-mark ${sym === 0 ? 'x' : 'o'} ${ghost ? 'ghost' : ''}`}>{sym === 0 ? '✕' : '◯'}</span>;
}

export default function OrderChaosGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<OCState>(() => initialState());
  const [sel, setSel] = useState<Sym>(0); // the symbol the human will place
  const [last, setLast] = useState<number | null>(null);
  const [log, setLog] = useState<CoachMsg[]>([]);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);

  const w = winnerOf(s);
  const over = w !== null;
  const humanTurn = s.turn === 0 && !over; // human is Order (player 0)
  const threats = useMemo(() => (humanTurn ? new Set(orderThreats(s.board)) : new Set<number>()), [s, humanTurn]);

  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(w === 0 ? 'win' : 'lose');
    recordResult('order-and-chaos', w === 0 ? 'win' : 'loss', aiDifficulty as any);
  }, [over, w, recorded, recordResult, aiDifficulty]);

  // Chaos (the AI) replies.
  useEffect(() => {
    if (over || s.turn !== 1) return;
    const t = setTimeout(() => {
      const m = chooseMove(s, aiDifficulty);
      if (!m) return;
      const after = applyMove(s, m);
      playSound(winnerOf(after) === 0 ? 'win' : 'move');
      setLast(m.cell);
      setLog((l) => [...l, moveComment(s, m, after)]);
      setS(after);
    }, 520);
    return () => clearTimeout(t);
  }, [s, over, aiDifficulty]);

  const clickCell = (i: number) => {
    resumeAudio();
    if (!humanTurn || s.board[i] !== null) return;
    const m = { id: `${i}${sel}`, cell: i, sym: sel, notation: `${sqName(i)}=${sel === 0 ? 'X' : 'O'}` };
    const after = applyMove(s, m);
    playSound(winnerOf(after) === 0 ? 'win' : 'select');
    setLast(i);
    setLog((l) => [...l, moveComment(s, m, after)]);
    setS(after);
  };

  const newGame = () => { setS(initialState()); setSel(0); setLast(null); setLog([]); setRecorded(false); };

  const status = over
    ? (w === 0 ? 'Order wins — you made five! 🏆' : 'Chaos wins — no line of five.')
    : s.turn === 1 ? 'Chaos is thinking…'
    : threats.size > 0 ? `You can win now — play on a glowing square!`
    : 'Your move, Order — place X or O.';

  return (
    <div className="play-area">
      <div className="board-col oc">
        <div className="oc-status">
          <span className={`oc-role ${over ? (w === 0 ? 'win' : 'lose') : ''}`}>{status}</span>
        </div>

        <div className="oc-picker" role="group" aria-label="Choose a symbol to place">
          <span className="oc-picker-label">Place:</span>
          <button className={`oc-pick x ${sel === 0 ? 'on' : ''}`} disabled={!humanTurn} onClick={() => setSel(0)} aria-pressed={sel === 0}>✕ X</button>
          <button className={`oc-pick o ${sel === 1 ? 'on' : ''}`} disabled={!humanTurn} onClick={() => setSel(1)} aria-pressed={sel === 1}>◯ O</button>
        </div>

        <div className="oc-board" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
          {s.board.map((v, i) => {
            const dark = (Math.floor(i / N) + (i % N)) % 2 === 1;
            return (
              <button
                key={i}
                className={`oc-cell ${dark ? 'dark' : 'light'} ${last === i ? 'last' : ''} ${threats.has(i) ? 'win-sq' : ''} ${humanTurn && v === null ? 'live' : ''}`}
                onClick={() => clickCell(i)}
                aria-label={`${sqName(i)}${v === null ? '' : v === 0 ? ' X' : ' O'}`}
              >
                {v !== null
                  ? <Mark sym={v} />
                  : (humanTurn && <Mark sym={sel} ghost />)}
              </button>
            );
          })}
        </div>

        <div className="oc-controls">
          <button className="btn sm" onClick={newGame}>↻ New game</button>
          <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <Link className="btn sm ghost" to="/learn/order-and-chaos">📖 Rules</Link>
        </div>
      </div>

      <aside className="side-col">
        <CoachPanel title="AI Coach" subtitle="Order and Chaos commentary" messages={log} tip={coachTip(s)} />
      </aside>
    </div>
  );
}
