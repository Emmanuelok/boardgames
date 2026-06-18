import { useMemo, useState } from 'react';
import type { OpeningInfo } from '../games/chess/openings';
import type { BoardTheme } from '../themes/boardThemes';
import chess from '../games/chess';
import InteractiveLesson from './InteractiveLesson';
import { playSound } from '../audio/sound';
import './OpeningTrainer.css';

const clean = (s: string) => s.replace(/[+#!?]/g, '');

/** FEN after each ply of a SAN line (fens[0] = start, fens[k] = after k moves). */
function replay(moves: string[]): string[] {
  const fens: string[] = [];
  let s = chess.createInitialState();
  fens.push(chess.serialize(s));
  for (const san of moves) {
    const m = chess.getLegalMoves(s).find((mv) => clean(mv.notation) === clean(san));
    if (!m) break;
    s = chess.applyMove(s, m);
    fens.push(chess.serialize(s));
  }
  return fens;
}

const moveNo = (ply: number) => Math.floor(ply / 2) + 1;

export default function OpeningTrainer({ opening, theme, onExit }: { opening: OpeningInfo; theme: BoardTheme; onExit: () => void }) {
  const fens = useMemo(() => replay(opening.moves), [opening]);
  const [side, setSide] = useState<0 | 1>(0); // which colour you train
  const myPlies = useMemo(() => opening.moves.map((_, i) => i).filter((i) => i % 2 === side), [opening, side]);
  const [stepIdx, setStepIdx] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [misses, setMisses] = useState(0);
  const [reply, setReply] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [missedThisStep, setMissedThisStep] = useState(false);

  const restart = (nextSide: 0 | 1 = side) => { setSide(nextSide); setStepIdx(0); setCorrect(0); setMisses(0); setReply(null); setDone(false); setMissedThisStep(false); };

  const ply = myPlies[stepIdx];
  // Opening White move shown when you train Black and the first move is the opponent's.
  const leadMove = side === 1 && stepIdx === 0 && opening.moves.length > 0 ? opening.moves[0] : null;

  const onSolved = () => {
    if (!missedThisStep) setCorrect((c) => c + 1);
    playSound('move');
    const oppPly = ply + 1;
    const advance = () => {
      setReply(null);
      setMissedThisStep(false);
      if (stepIdx + 1 < myPlies.length) setStepIdx((i) => i + 1);
      else { setDone(true); playSound('win'); }
    };
    if (oppPly < opening.moves.length) { setReply(`${side === 0 ? 'Black' : 'White'} replies ${opening.moves[oppPly]}`); setTimeout(advance, 1150); }
    else setTimeout(advance, 700);
  };
  const onFailed = () => { setMisses((m) => m + 1); setMissedThisStep(true); };

  if (myPlies.length === 0) {
    return (
      <section className="op-detail glass ot">
        <div className="ot-head"><h2>Train: {opening.name}</h2><button className="btn sm ghost" onClick={onExit}>✕ Explore</button></div>
        <p className="ot-note">This short line has no {side === 0 ? 'White' : 'Black'} moves to drill. Switch side to train it.</p>
        <div className="ot-side"><button className={`ot-side-btn ${side === 0 ? 'on' : ''}`} onClick={() => restart(0)}>♔ White</button><button className={`ot-side-btn ${side === 1 ? 'on' : ''}`} onClick={() => restart(1)}>♚ Black</button></div>
      </section>
    );
  }

  return (
    <section className="op-detail glass ot">
      <div className="ot-head">
        <div><span className="chip op-chip">{opening.eco}</span> <strong className="ot-name">Train: {opening.name}</strong></div>
        <button className="btn sm ghost" onClick={onExit}>✕ Explore</button>
      </div>

      <div className="ot-bar">
        <div className="ot-side">
          <button className={`ot-side-btn ${side === 0 ? 'on' : ''}`} onClick={() => restart(0)}>♔ White</button>
          <button className={`ot-side-btn ${side === 1 ? 'on' : ''}`} onClick={() => restart(1)}>♚ Black</button>
        </div>
        <div className="ot-score">✓ {correct}/{myPlies.length}{misses > 0 && <span className="ot-miss"> · {misses} miss{misses === 1 ? '' : 'es'}</span>}</div>
      </div>

      {done ? (
        <div className="ot-done">
          <div className="ot-done-badge">{misses === 0 ? '🏆' : '✓'}</div>
          <h3>{misses === 0 ? 'Perfect line!' : 'Line complete'}</h3>
          <p className="muted">You played {correct} of {myPlies.length} book moves as {side === 0 ? 'White' : 'Black'}{misses === 0 ? ' with no slips' : `, with ${misses} retr${misses === 1 ? 'y' : 'ies'}`}.</p>
          <div className="row gap-sm" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => restart()}>↻ Again</button>
            <button className="btn" onClick={() => restart(side === 0 ? 1 : 0)}>Train {side === 0 ? 'Black' : 'White'}</button>
            <button className="btn ghost" onClick={onExit}>Explore</button>
          </div>
        </div>
      ) : (
        <>
          {leadMove && <div className="ot-lead">White opens with <b>{leadMove}</b> — your reply:</div>}
          {reply ? <div className="ot-reply">{reply}</div> : null}
          <InteractiveLesson
            key={`${opening.eco}-${opening.name}-${side}-${stepIdx}`}
            def={chess as any}
            setup={fens[ply]}
            challenge={{ prompt: `Play ${side === 0 ? 'White' : 'Black'}'s book move (${moveNo(ply)}${side === 0 ? '.' : '...'})`, solution: [opening.moves[ply]], success: '✓ Book move!' }}
            theme={theme}
            onSolved={onSolved}
            onFailed={onFailed}
          />
          <p className="ot-hint faint">Make the move on the board. Forgotten it? The Explorer shows the whole line.</p>
        </>
      )}
    </section>
  );
}
