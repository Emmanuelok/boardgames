import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getGame } from '../engine/registry';
import { getTheme } from '../themes/boardThemes';
import MiniBoard from '../components/MiniBoard';
import InteractiveLesson from '../components/InteractiveLesson';
import type { TutorialStep } from '../engine/types';
import './Learn.css';

export default function Learn() {
  const { gameId } = useParams();
  const def = getGame(gameId);
  const [cur, setCur] = useState(0);
  const theme = getTheme('tournament-green');

  const steps = useMemo(() => {
    if (!def) return [];
    const flat: Array<{ chapter: string; icon: string; step: TutorialStep; chapterStart: boolean }> = [];
    def.tutorial.chapters.forEach((ch) => {
      ch.steps.forEach((step, i) => flat.push({ chapter: ch.title, icon: ch.icon, step, chapterStart: i === 0 }));
    });
    return flat;
  }, [def]);

  if (!def) return <div className="loading">Game not found. <Link to="/">Back to hub</Link></div>;

  const active = steps[cur];

  return (
    <div className="learn">
      <header className="learn-top">
        <Link to="/" className="btn ghost sm">← Hub</Link>
        <div className="gs-title">
          <span className="gs-emoji">{def.emoji}</span>
          <div className="col"><strong>How to play {def.name}</strong><span className="faint" style={{ fontSize: 12 }}>{steps.length} lessons</span></div>
        </div>
        <Link className="btn primary sm" to={`/play/${def.id}`}>Play now →</Link>
      </header>

      <div className="learn-hero glass">
        <span className="eyebrow">The course</span>
        <p className="learn-overview">{def.tutorial.overview}</p>
        <div className="learn-objective"><strong>🎯 Goal.</strong> {def.tutorial.objective}</div>
      </div>

      <div className="learn-body">
        <aside className="learn-nav glass-soft">
          {steps.map((s, i) => (
            <div key={i}>
              {s.chapterStart && <div className="nav-chapter">{s.icon} {s.chapter}</div>}
              <button className={`nav-step ${i === cur ? 'on' : ''}`} onClick={() => setCur(i)}>
                {s.step.title}
              </button>
            </div>
          ))}
        </aside>

        <main className="learn-content glass">
          {active && (
            <div className="lesson fade-in" key={cur}>
              <div className="lesson-chapter">{active.icon} {active.chapter}</div>
              <h2>{active.step.title}</h2>
              <div className={`lesson-grid ${showBoard(active.step) ? 'with-board' : ''}`}>
                <p className="lesson-body"><Rich text={active.step.body} /></p>
                {active.step.challenge ? (
                  <InteractiveLesson key={cur} def={def} setup={active.step.setup} challenge={active.step.challenge} theme={theme} />
                ) : showBoard(active.step) && (
                  <div className="lesson-board">
                    <MiniBoard def={def} setup={active.step.setup} highlight={active.step.highlight} arrows={active.step.arrows} theme={theme} />
                  </div>
                )}
              </div>

              <div className="lesson-nav">
                <button className="btn" onClick={() => setCur((c) => Math.max(0, c - 1))} disabled={cur === 0}>← Previous</button>
                <span className="faint">{cur + 1} / {steps.length}</span>
                {cur < steps.length - 1
                  ? <button className="btn primary" onClick={() => setCur((c) => Math.min(steps.length - 1, c + 1))}>Next →</button>
                  : <Link className="btn primary" to={`/play/${def.id}`}>Start playing →</Link>}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function showBoard(step: TutorialStep): boolean {
  return !!(step.challenge || step.setup || (step.highlight && step.highlight.length) || (step.arrows && step.arrows.length));
}

/** Minimal inline markdown: **bold** and `code`. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="ic">{p.slice(1, -1)}</code>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
