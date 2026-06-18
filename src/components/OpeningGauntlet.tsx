import { useMemo, useState } from 'react';
import { OPENINGS, type OpeningInfo } from '../games/chess/openings';
import type { BoardTheme } from '../themes/boardThemes';
import chess from '../games/chess';
import InteractiveLesson from './InteractiveLesson';
import { playSound } from '../audio/sound';
import './OpeningGauntlet.css';

const clean = (s: string) => s.replace(/[+#!?]/g, '');
const N_QUESTIONS = 8;
const BEST_KEY = 'gm-gauntlet-best';

/** FEN after `k` plies of a SAN line. */
function fenAfter(moves: string[], k: number): string {
  let s = chess.createInitialState();
  for (let i = 0; i < k; i++) {
    const m = chess.getLegalMoves(s).find((mv) => clean(mv.notation) === clean(moves[i]));
    if (!m) break;
    s = chess.applyMove(s, m);
  }
  return chess.serialize(s);
}

interface Q { opening: OpeningInfo; ply: number; fen: string }

function buildQuiz(): Q[] {
  const pool = OPENINGS.filter((o) => o.moves.length >= 3);
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, N_QUESTIONS);
  // Ask for the deepest move of each line (its defining continuation).
  return shuffled.map((o) => { const ply = o.moves.length - 1; return { opening: o, ply, fen: fenAfter(o.moves, ply) }; });
}

const loadBest = (): number => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };

export default function OpeningGauntlet({ theme, onExit }: { theme: BoardTheme; onExit: () => void }) {
  const [quiz, setQuiz] = useState<Q[]>(() => buildQuiz());
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [phase, setPhase] = useState<'play' | 'reveal' | 'done'>('play');
  const [best, setBest] = useState(loadBest);

  const q = quiz[i];
  const side = q ? (q.ply % 2 === 0 ? 'White' : 'Black') : 'White';
  const answer = q ? q.opening.moves[q.ply] : '';

  const advance = (was: boolean) => {
    const nextResults = [...results, was];
    setResults(nextResults);
    if (i + 1 < quiz.length) { setI(i + 1); setPhase('play'); }
    else {
      setPhase('done');
      const finalScore = score + (was ? 1 : 0);
      if (finalScore > best) { setBest(finalScore); try { localStorage.setItem(BEST_KEY, String(finalScore)); } catch { /* ignore */ } }
      playSound(finalScore >= quiz.length * 0.75 ? 'win' : 'move');
    }
  };
  const onSolved = () => { if (phase !== 'play') return; playSound('move'); setScore((s) => s + 1); setPhase('reveal'); setTimeout(() => advance(true), 850); };
  const onFailed = () => { if (phase !== 'play') return; playSound('illegal'); setPhase('reveal'); setTimeout(() => advance(false), 1700); };

  const restart = () => { setQuiz(buildQuiz()); setI(0); setScore(0); setResults([]); setPhase('play'); };

  return (
    <section className="op-detail glass gauntlet">
      <div className="gx-head">
        <div><span className="gx-badge">⚡ Gauntlet</span> <strong className="gx-title">Openings rapid-fire</strong></div>
        <button className="btn sm ghost" onClick={onExit}>✕ Explore</button>
      </div>

      {phase === 'done' ? (
        <div className="gx-done">
          <div className="gx-done-badge">{score === quiz.length ? '🏆' : score >= quiz.length * 0.6 ? '🎯' : '📚'}</div>
          <h3>{score} / {quiz.length} correct</h3>
          <p className="muted">{score === quiz.length ? 'Flawless — you know your theory cold.' : score >= quiz.length * 0.6 ? 'Solid recall. A few to brush up on below.' : 'Plenty to learn — study these in the Explorer.'} {best > 0 && <>Best: {best}/{quiz.length}.</>}</p>
          <div className="gx-review">
            {quiz.map((qq, k) => (
              <div key={k} className={`gx-rev ${results[k] ? 'ok' : 'no'}`}>
                <span>{results[k] ? '✓' : '✗'}</span>
                <span className="gx-rev-name">{qq.opening.name}</span>
                <span className="gx-rev-move">{qq.opening.moves[qq.ply]}</span>
              </div>
            ))}
          </div>
          <div className="row gap-sm" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={restart}>↻ New gauntlet</button>
            <button className="btn ghost" onClick={onExit}>Explore</button>
          </div>
        </div>
      ) : (
        <>
          <div className="gx-progress">
            {quiz.map((_, k) => <span key={k} className={`gx-pip ${k < i ? (results[k] ? 'ok' : 'no') : k === i ? 'cur' : ''}`} />)}
            <span className="gx-count">{i + 1}/{quiz.length}</span>
          </div>
          <div className="gx-q">You’re playing the <strong>{q.opening.name}</strong>. {side} to move — what’s the book continuation?</div>
          <InteractiveLesson
            key={`${i}-${q.opening.eco}-${q.opening.name}`}
            def={chess as any}
            setup={q.fen}
            challenge={{ prompt: `${side}'s book move?`, solution: [answer], success: '✓ Correct!' }}
            theme={theme}
            onSolved={onSolved}
            onFailed={onFailed}
          />
          {phase === 'reveal' && <div className="gx-reveal">The book move is <b>{answer}</b></div>}
        </>
      )}
    </section>
  );
}
