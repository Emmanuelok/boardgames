import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STARTERS, SURPRISE_IDS } from '../engine/catalogueMeta';
import type { Difficulty } from '../engine/types';
import './Onboarding.css';

const KEY = 'gm-onboarded';

const LEVELS: { id: Difficulty; label: string; desc: string; icon: string }[] = [
  { id: 'easy', label: 'New to this', desc: 'Gentle opponents and plenty of room to learn.', icon: '🌱' },
  { id: 'medium', label: 'Casual', desc: 'A fair challenge while you find your feet.', icon: '🙂' },
  { id: 'hard', label: 'Confident', desc: 'Sharp play that punishes loose moves.', icon: '🔥' },
  { id: 'master', label: 'Bring it on', desc: 'The engine at full strength.', icon: '🐉' },
];

/** Persist the chosen level the same way the game store reads it (no store import,
 *  to keep the registry out of the landing bundle). */
const saveDifficulty = (d: Difficulty) => { try { localStorage.setItem('gm-difficulty', d); } catch { /* ignore */ } };

export default function Onboarding() {
  const nav = useNavigate();
  const [visible, setVisible] = useState(() => { try { return !localStorage.getItem(KEY); } catch { return false; } });
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<Difficulty>('medium');

  if (!visible) return null;

  const dismiss = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setVisible(false); };
  const pickLevel = (d: Difficulty) => { setLevel(d); saveDifficulty(d); setStep(1); };
  const start = (id: string) => { saveDifficulty(level); dismiss(); nav(`/play/${id}`); };
  const surprise = () => start(SURPRISE_IDS[Math.floor(Math.random() * SURPRISE_IDS.length)]);

  return (
    <div className="ob-scrim" role="dialog" aria-modal="true" aria-label="Welcome">
      <div className="ob-card glass">
        <button className="ob-skip" onClick={dismiss} aria-label="Skip">Skip ✕</button>
        <div className="ob-dots"><span className={step === 0 ? 'on' : ''} /><span className={step === 1 ? 'on' : ''} /></div>

        {step === 0 ? (
          <>
            <div className="ob-mark">♞</div>
            <h1 className="ob-title">Welcome to <span className="gradient-text">GrandMaster</span></h1>
            <p className="ob-sub">The AI game center that doesn’t just beat you — it <strong>teaches you</strong>, move by move, across 26 games. First, how strong an opponent do you want?</p>
            <div className="ob-levels">
              {LEVELS.map((l) => (
                <button key={l.id} className="ob-level" onClick={() => pickLevel(l.id)}>
                  <span className="ob-level-ic">{l.icon}</span>
                  <strong>{l.label}</strong>
                  <span className="ob-level-desc">{l.desc}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <button className="ob-back" onClick={() => setStep(0)}>← level</button>
            <div className="ob-mark small">🎯</div>
            <h1 className="ob-title">Pick a game to start</h1>
            <p className="ob-sub">You’re set to <strong>{LEVELS.find((l) => l.id === level)?.label}</strong> — change it anytime. Every game ships with a step-by-step tutor and full post-game review. Try one:</p>
            <div className="ob-games">
              {STARTERS.map((g) => (
                <button key={g.id} className="ob-game" onClick={() => start(g.id)}>
                  <span className="ob-game-emoji">{g.emoji}</span>
                  <div className="col">
                    <strong>{g.name}</strong>
                    <span className="ob-game-tag">{g.tagline}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="ob-actions">
              <button className="btn" onClick={surprise}>🎲 Surprise me</button>
              <button className="btn ghost" onClick={dismiss}>I’ll explore on my own</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
