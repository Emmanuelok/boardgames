import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getGame } from '../engine/registry';
import { useProgression } from '../progression/progression';
import { getTheme } from '../themes/boardThemes';
import MiniBoard from '../components/MiniBoard';
import InteractiveLesson from '../components/InteractiveLesson';
import JourneyContext from '../components/JourneyContext';
import { useLearningMemory } from '../intelligence/learningMemory';
import { readMissionContext, withMissionContext } from '../intelligence/missionRouting';
import type { TutorialStep } from '../engine/types';
import './Learn.css';

export default function Learn() {
  const { gameId } = useParams();
  const [searchParams] = useSearchParams();
  const def = getGame(gameId);
  const [cur, setCur] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [solvedChallenges, setSolvedChallenges] = useState<Set<number>>(() => new Set());
  const theme = getTheme('tournament-green');
  const missionContext = readMissionContext(searchParams);
  const activeMission = useLearningMemory((state) => state.activeMission);

  const steps = useMemo(() => {
    if (!def) return [];
    const flat: Array<{ chapter: string; icon: string; step: TutorialStep; chapterStart: boolean }> = [];
    def.tutorial.chapters.forEach((ch) => {
      ch.steps.forEach((step, i) => flat.push({ chapter: ch.title, icon: ch.icon, step, chapterStart: i === 0 }));
    });
    return flat;
  }, [def]);

  useEffect(() => {
    setCur(0);
    setVisited(new Set([0]));
    setSolvedChallenges(new Set());
  }, [def?.id]);

  if (!def) return <div className="loading">Game not found. <Link to="/">Back to hub</Link></div>;

  const active = steps[cur];
  const challengeIndices = steps
    .map((step, index) => step.step.challenge ? index : -1)
    .filter((index) => index >= 0);
  const visitedEveryLesson = steps.length > 0 && visited.size >= steps.length;
  const solvedCourseChallenge = challengeIndices.length === 0
    || challengeIndices.some((index) => solvedChallenges.has(index));
  const courseReady = visitedEveryLesson && solvedCourseChallenge;
  const completionRequirement = !visitedEveryLesson
    ? `Visit all ${steps.length} lessons to complete the course.`
    : !solvedCourseChallenge
      ? 'Solve one interactive course challenge to complete the course.'
      : '';
  const isMissionCourse = (
    missionContext?.stage === 'learn'
    && activeMission?.id === missionContext.missionId
    && activeMission.gameId === def.id
    && activeMission.currentStage === 'learn'
  );
  const nextMissionStep = isMissionCourse
    ? activeMission.steps.find((step) => step.stage === 'practice')
    : null;
  const completionHref = nextMissionStep?.target.href
    ? withMissionContext(nextMissionStep.target.href, activeMission!.id, 'practice')
    : `/play/${def.id}`;

  const completeCourse = () => {
    if (!courseReady) return;
    try { useProgression.getState().recordLesson(def.id); } catch { /* non-critical reward */ }
    if (!isMissionCourse) return;
    useLearningMemory.getState().recordEvent({
      id: `lesson:${activeMission.id}:${def.id}`,
      at: Date.now(),
      kind: 'lesson_completed',
      missionId: activeMission.id,
      gameId: def.id,
      stage: 'learn',
      sourceId: `course:${def.id}`,
      outcome: 'complete',
    });
  };
  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, index));
    setCur(next);
    setVisited((current) => new Set(current).add(next));
  };
  const markChallengeSolved = () => {
    setSolvedChallenges((current) => new Set(current).add(cur));
  };

  return (
    <div className="learn">
      <JourneyContext gameId={def.id} gameName={def.name} gameEmoji={def.emoji} stage="learn" />
      <header className="learn-hero" aria-labelledby="learn-title">
        <img
          className="learn-hero-art"
          src="/assets/course-evolution.webp"
          alt=""
          width="1600"
          height="800"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="learn-hero-veil" />
        <div className="learn-top">
          <Link to="/games" className="btn ghost sm">← Library</Link>
          <span className="learn-route"><span aria-hidden="true">{def.emoji}</span> Guided {def.name} course</span>
          <Link className="btn primary sm" to={`/play/${def.id}`}>Play now →</Link>
        </div>
        <div className="learn-copy">
          <span className="section-overline">Course evolution · {steps.length} focused lessons</span>
          <h1 id="learn-title">Learn {def.name} from first principle to fluent play.</h1>
          <p className="learn-overview">{def.tutorial.overview}</p>
          <div className="learn-objective"><strong>Goal.</strong> {def.tutorial.objective}</div>
        </div>
      </header>

      <div className="learn-body">
        <aside className="learn-nav glass-soft" aria-label={`${def.name} course lessons`}>
          {steps.map((s, i) => (
            <div key={i}>
              {s.chapterStart && <div className="nav-chapter">{s.icon} {s.chapter}</div>}
              <button type="button" className={`nav-step ${i === cur ? 'on' : ''}`} aria-current={i === cur ? 'step' : undefined} onClick={() => goTo(i)}>
                {s.step.title}
              </button>
            </div>
          ))}
        </aside>

        <section className="learn-content glass" aria-labelledby="lesson-title">
          {active && (
            <div className="lesson fade-in" key={cur}>
              <div className="lesson-chapter">{active.icon} {active.chapter}</div>
              <h2 id="lesson-title">{active.step.title}</h2>
              <div className={`lesson-grid ${showBoard(active.step) ? 'with-board' : ''}`}>
                <p className="lesson-body"><Rich text={active.step.body} /></p>
                {active.step.challenge ? (
                  <InteractiveLesson key={cur} def={def} setup={active.step.setup} challenge={active.step.challenge} theme={theme} onSolved={markChallengeSolved} />
                ) : showBoard(active.step) && (
                  <div className="lesson-board">
                    <MiniBoard def={def} setup={active.step.setup} highlight={active.step.highlight} arrows={active.step.arrows} theme={theme} />
                  </div>
                )}
              </div>

              <div className="lesson-nav">
                <button type="button" className="btn" onClick={() => goTo(cur - 1)} disabled={cur === 0}>← Previous</button>
                <span className="faint">{cur + 1} / {steps.length}</span>
                {cur < steps.length - 1
                  ? <button type="button" className="btn primary" onClick={() => goTo(cur + 1)}>Next →</button>
                  : courseReady ? (
                    <Link className="btn primary" to={completionHref} onClick={completeCourse}>
                      {isMissionCourse ? 'Complete course & practise →' : 'Complete course & play →'}
                    </Link>
                  ) : (
                    <button className="btn primary" type="button" disabled title={completionRequirement}>Course evidence incomplete</button>
                  )}
              </div>
              {cur === steps.length - 1 && completionRequirement && (
                <p className="lesson-requirement" role="status">{completionRequirement}</p>
              )}
            </div>
          )}
        </section>
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
