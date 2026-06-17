import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, applyMove, chooseMove, winnerOf, orderThreats, N,
  moveComment, coachTip, type OCState, type Sym,
} from '../games/orderandchaos/logic';
import type { Player } from '../engine/types';
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
  const [side, setSide] = useState<Player>(0); // which role the human plays: 0 = Order, 1 = Chaos
  const [s, setS] = useState<OCState>(() => initialState());
  const [sel, setSel] = useState<Sym>(0); // the symbol the human will place
  const [last, setLast] = useState<number | null>(null);
  const [log, setLog] = useState<CoachMsg[]>([]);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);

  const w = winnerOf(s);
  const over = w !== null;
  const humanTurn = s.turn === side && !over;
  // Order's winning squares: when you're Order they show where to win; when you're Chaos they show what to block.
  const threats = useMemo(() => (humanTurn ? new Set(orderThreats(s.board)) : new Set<number>()), [s, humanTurn]);

  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(w === side ? 'win' : 'lose');
    recordResult('order-and-chaos', w === side ? 'win' : 'loss', aiDifficulty as any);
  }, [over, w, side, recorded, recordResult, aiDifficulty]);

  // The AI plays whichever role the human did not pick.
  useEffect(() => {
    if (over || s.turn === side) return;
    const t = setTimeout(() => {
      const m = chooseMove(s, aiDifficulty);
      if (!m) return;
      const after = applyMove(s, m);
      const res = winnerOf(after);
      playSound(res === side ? 'win' : res !== null ? 'lose' : 'move');
      setLast(m.cell);
      setLog((l) => [...l, moveComment(s, m, after, side)]);
      setS(after);
    }, 520);
    return () => clearTimeout(t);
  }, [s, over, side, aiDifficulty]);

  const clickCell = (i: number) => {
    resumeAudio();
    if (!humanTurn || s.board[i] !== null) return;
    const m = { id: `${i}${sel}`, cell: i, sym: sel, notation: `${sqName(i)}=${sel === 0 ? 'X' : 'O'}` };
    const after = applyMove(s, m);
    const res = winnerOf(after);
    playSound(res === side ? 'win' : res !== null ? 'lose' : 'select');
    setLast(i);
    setLog((l) => [...l, moveComment(s, m, after, side)]);
    setS(after);
  };

  const reset = (nextSide: Player) => { setSide(nextSide); setS(initialState()); setSel(0); setLast(null); setLog([]); setRecorded(false); };

  const status = over
    ? (w === side ? 'You win! 🏆' : w === 0 ? 'Order wins — five in a row.' : 'Chaos wins — no line of five.')
    : !humanTurn ? `${side === 0 ? 'Chaos' : 'Order'} (AI) is thinking…`
    : threats.size > 0
      ? (side === 0 ? 'You can win now — play on a glowing square!' : 'Block the glowing square — Order is about to make five!')
      : (side === 0 ? 'Your move, Order — place X or O.' : 'Your move, Chaos — jam a line with X or O.');

  return (
    <div className="play-area">
      <div className="board-col oc">
        <div className="oc-sidepick" role="group" aria-label="Choose your side">
          <span className="oc-picker-label">You play:</span>
          <button className={`oc-side ${side === 0 ? 'on' : ''}`} onClick={() => reset(0)} aria-pressed={side === 0}>Order · make five</button>
          <button className={`oc-side ${side === 1 ? 'on' : ''}`} onClick={() => reset(1)} aria-pressed={side === 1}>Chaos · block five</button>
        </div>

        <div className="oc-status">
          <span className={`oc-role ${over ? (w === side ? 'win' : 'lose') : ''}`}>{status}</span>
        </div>

        <div className="oc-picker" role="group" aria-label="Choose a symbol to place">
          <span className="oc-picker-label">Place:</span>
          <button className={`oc-pick x ${sel === 0 ? 'on' : ''}`} disabled={!humanTurn} onClick={() => setSel(0)} aria-pressed={sel === 0}>✕ X</button>
          <button className={`oc-pick o ${sel === 1 ? 'on' : ''}`} disabled={!humanTurn} onClick={() => setSel(1)} aria-pressed={sel === 1}>◯ O</button>
        </div>

        <div className="oc-board" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
          {s.board.map((v, i) => {
            const dark = (Math.floor(i / N) + (i % N)) % 2 === 1;
            const hot = threats.has(i) ? (side === 0 ? 'win-sq' : 'block-sq') : '';
            return (
              <button
                key={i}
                className={`oc-cell ${dark ? 'dark' : 'light'} ${last === i ? 'last' : ''} ${hot} ${humanTurn && v === null ? 'live' : ''}`}
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
          <button className="btn sm" onClick={() => reset(side)}>↻ New game</button>
          <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <Link className="btn sm ghost" to="/learn/order-and-chaos">📖 Rules</Link>
        </div>
      </div>

      <aside className="side-col">
        <CoachPanel title="AI Coach" subtitle="Order and Chaos commentary" messages={log} tip={coachTip(s, side)} />
      </aside>
    </div>
  );
}
