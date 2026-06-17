import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, applyMove, chooseMove, winnerOf, playableBoards, moveComment, coachTip,
  type UTTTState, type Mark,
} from '../games/ultimate/logic';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import CoachPanel, { type CoachMsg } from './CoachPanel';
import './UltimateGame.css';

function Glyph({ v, big }: { v: Mark; big?: boolean }) {
  return <span className={`utt-mark ${v === 0 ? 'x' : 'o'} ${big ? 'big' : ''}`}>{v === 0 ? '✕' : '◯'}</span>;
}

export default function UltimateGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<UTTTState>(() => initialState());
  const [last, setLast] = useState<number | null>(null); // last cell flat index
  const [hover, setHover] = useState<number | null>(null); // hovered cell index → previews where it sends
  const [log, setLog] = useState<CoachMsg[]>([]);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);

  const w = winnerOf(s);
  const over = w !== null;
  const humanTurn = s.turn === 0 && !over;
  const playable = useMemo(() => new Set(playableBoards(s)), [s]);
  // While hovering a cell, the opponent would be sent to the board with that cell index (unless it's decided).
  const sendTarget = hover !== null && humanTurn ? (s.boards[hover % 9] === null ? hover % 9 : -1) : null;

  useEffect(() => {
    if (!over || recorded) return;
    setRecorded(true);
    playSound(w === 0 ? 'win' : w === 1 ? 'lose' : 'draw');
    if (w === 0 || w === 1) recordResult('ultimate', w === 0 ? 'win' : 'loss', aiDifficulty as any);
  }, [over, w, recorded, recordResult, aiDifficulty]);

  useEffect(() => {
    if (over || s.turn !== 1) return;
    const t = setTimeout(() => {
      const m = chooseMove(s, aiDifficulty);
      if (!m) return;
      const after = applyMove(s, m);
      playSound(winnerOf(after) === 1 ? 'win' : 'move');
      setLast(m.board * 9 + m.cell);
      setLog((l) => [...l, moveComment(s, m, after)]);
      setS(after);
    }, 520);
    return () => clearTimeout(t);
  }, [s, over, aiDifficulty]);

  const clickCell = (b: number, c: number) => {
    resumeAudio();
    if (!humanTurn || !playable.has(b) || s.cells[b * 9 + c] !== null) return;
    const m = { id: `${b}.${c}`, board: b, cell: c, notation: '' };
    const after = applyMove(s, m);
    playSound(winnerOf(after) === 0 ? 'win' : 'select');
    setLast(b * 9 + c);
    setLog((l) => [...l, moveComment(s, m, after)]);
    setS(after);
  };

  const newGame = () => { setS(initialState()); setLast(null); setHover(null); setLog([]); setRecorded(false); };

  const status = over
    ? (w === 'draw' ? 'Draw — no meta-line' : w === 0 ? 'You win the game! 🏆' : 'Nova wins the game')
    : s.turn === 1 ? 'Nova is thinking…'
    : s.active >= 0 ? 'Your move — play in the highlighted board' : 'Your move — play in any open board';

  return (
    <div className="play-area">
      <div className="board-col utt">
        <div className="utt-status"><span className={`utt-role ${over ? (w === 0 ? 'win' : w === 1 ? 'lose' : '') : ''}`}>{status}</span></div>

        <div className="utt-meta" onMouseLeave={() => setHover(null)}>
          {Array.from({ length: 9 }, (_, b) => {
            const res = s.boards[b];
            const isPlayable = humanTurn && playable.has(b);
            const cls = [
              'utt-sub',
              res === 0 ? 'won-x' : res === 1 ? 'won-o' : res === 'draw' ? 'drawn' : '',
              isPlayable ? 'active' : '',
              sendTarget === b ? 'target' : '',
            ].join(' ');
            return (
              <div className={cls} key={b}>
                {Array.from({ length: 9 }, (_, c) => {
                  const v = s.cells[b * 9 + c] as Mark | null;
                  const idx = b * 9 + c;
                  const live = humanTurn && isPlayable && v === null;
                  return (
                    <button
                      key={c}
                      className={`utt-cell ${live ? 'live' : ''} ${last === idx ? 'last' : ''}`}
                      onClick={() => clickCell(b, c)}
                      onMouseEnter={() => live && setHover(idx)}
                      disabled={!live}
                      aria-label={`board ${b + 1} cell ${c + 1}`}
                    >
                      {v !== null && <Glyph v={v} />}
                    </button>
                  );
                })}
                {(res === 0 || res === 1) && <div className="utt-sub-overlay"><Glyph v={res} big /></div>}
                {res === 'draw' && <div className="utt-sub-overlay draw">½</div>}
              </div>
            );
          })}
        </div>

        <div className="utt-legend">
          <span className="utt-hint">{sendTarget !== null && sendTarget >= 0 ? `↳ sends Nova to the ${['top-left', 'top', 'top-right', 'left', 'centre', 'right', 'bottom-left', 'bottom', 'bottom-right'][sendTarget]} board` : sendTarget === -1 ? '↳ sends Nova anywhere (that board is decided)' : 'Hover a square to see where it sends Nova'}</span>
        </div>

        <div className="utt-controls">
          <button className="btn sm" onClick={newGame}>↻ New game</button>
          <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <Link className="btn sm ghost" to="/learn/ultimate">📖 Rules</Link>
        </div>
      </div>

      <aside className="side-col">
        <CoachPanel title="AI Coach" subtitle="Ultimate Tic-Tac-Toe commentary" messages={log} tip={coachTip(s)} />
      </aside>
    </div>
  );
}
