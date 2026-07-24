import { useEffect, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { GAMES } from '../engine/registry';
import { loadRecords } from '../engine/reviewSummary';
import { PUZZLE_GAME_IDS } from '../puzzles/allPuzzles';
import { useProfile, ratingTitle } from '../profile/profile';
import { levelFromXp, useProgression } from '../progression/progression';
import { buildLearningMission, type LearnerSnapshot } from '../intelligence/orchestrator';
import {
  createLearningMission,
  useLearningMemory,
  type MissionStage,
  type MissionTarget,
} from '../intelligence/learningMemory';
import { withMissionContext } from '../intelligence/missionRouting';
import './Path.css';

interface TrainingData {
  dailyStreak: number;
  puzzlesSolved: number;
  puzzleStreak: number;
}

function readTraining(): TrainingData {
  try {
    const daily = JSON.parse(localStorage.getItem('gm-daily') || '{}');
    const puzzles = JSON.parse(localStorage.getItem('gm-puzzles') || '{}');
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const liveStreak = daily.lastDate === localKey(today) || daily.lastDate === localKey(yesterday) ? Number(daily.streak) || 0 : 0;
    return {
      dailyStreak: liveStreak,
      puzzlesSolved: Number(puzzles.solved) || 0,
      puzzleStreak: Number(puzzles.streak) || 0,
    };
  } catch {
    return { dailyStreak: 0, puzzlesSolved: 0, puzzleStreak: 0 };
  }
}

function newMissionId(gameId: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `mission:${gameId}:${random}`;
}

function targetForStage(
  stage: MissionStage,
  gameId: string,
  href: string,
): MissionTarget {
  const matchSource = () => {
    const query = href.split('?')[1] ?? '';
    const requested = new URLSearchParams(query).get('difficulty');
    const difficulty = requested === 'tutor' || requested === 'easy' || requested === 'medium' || requested === 'hard' || requested === 'master'
      ? requested
      : 'medium';
    return `match:${gameId}:${difficulty}`;
  };
  switch (stage) {
    case 'observe':
      return href.startsWith('/reviews')
        ? { stage, kind: 'review_opened', sourceId: `review:${gameId}`, href }
        : { stage, kind: 'match_completed', sourceId: matchSource(), href };
    case 'learn':
      return { stage, kind: 'lesson_completed', sourceId: `course:${gameId}`, href };
    case 'practice':
      return href.startsWith('/play/')
        ? { stage, kind: 'match_completed', sourceId: matchSource(), href }
        : { stage, kind: 'puzzle_solved', sourceId: `puzzle:${gameId}`, href };
    case 'play':
      return { stage, kind: 'match_completed', sourceId: matchSource(), href };
    case 'reflect':
      return { stage, kind: 'reflection_completed', sourceId: `reflection:${gameId}:after-play`, href };
  }
}

export default function Path() {
  const profile = useProfile();
  const progression = useProgression();
  const activeMission = useLearningMemory((state) => state.activeMission);
  const startMission = useLearningMemory((state) => state.startMission);
  const training = useMemo(readTraining, []);
  const reviews = useMemo(loadRecords, []);
  const { level, into, span } = levelFromXp(progression.xp);

  const snapshot: LearnerSnapshot = useMemo(() => ({
    name: profile.name,
    rating: profile.rating,
    stats: profile.stats,
    totalPlayed: profile.totals.played,
    totalWins: profile.totals.wins,
    xp: progression.xp,
    seenGames: progression.seenGames,
    gamesToday: progression.gamesToday,
    dailyStreak: training.dailyStreak,
    puzzlesSolved: training.puzzlesSolved,
    puzzleStreak: training.puzzleStreak,
    reviews,
  }), [profile.name, profile.rating, profile.stats, profile.totals.played, profile.totals.wins, progression.xp, progression.seenGames, progression.gamesToday, training, reviews]);

  const games = useMemo(() => {
    const practiceGames = new Set(PUZZLE_GAME_IDS);
    return GAMES.map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      category: g.category,
      depth: g.depth,
      practiceAvailable: practiceGames.has(g.id),
      threeTierDifficulty: !!g.custom,
    }));
  }, []);
  const pinnedFocus = activeMission?.status === 'active' ? activeMission.gameId : undefined;
  const mission = useMemo(
    () => buildLearningMission(snapshot, games, pinnedFocus),
    [snapshot, games, pinnedFocus],
  );
  const missionDraft = useMemo(() => createLearningMission({
    id: newMissionId(mission.focus.id),
    gameId: mission.focus.id,
    targets: mission.steps.map((step) => targetForStage(step.id, mission.focus.id, step.to)),
  }), [mission.focus.id, mission.steps]);

  useEffect(() => {
    if (!activeMission || activeMission.status === 'complete') startMission(missionDraft);
  }, [activeMission, missionDraft, startMission]);

  const trackedMission = activeMission?.status === 'active' ? activeMission : missionDraft;
  const trackedSteps = mission.steps.map((step) => {
    const tracked = trackedMission.steps.find((candidate) => candidate.stage === step.id);
    const state = tracked?.status === 'complete'
      ? 'complete'
      : tracked?.status === 'active'
        ? 'recommended'
        : 'locked';
    const to = tracked?.target.href ?? step.to;
    const copy = step.id === 'observe'
      ? to.startsWith('/play/')
        ? { title: 'Establish your baseline', detail: 'Play a short coached game so the system can measure real decisions.' }
        : { title: 'Revisit one key moment', detail: 'See what changed the evaluation and name the idea before moving on.' }
      : step.id === 'practice' && to.startsWith('/play/')
        ? { title: 'Rehearse in a coached game', detail: 'Apply the course idea on the full board with explanations switched on.' }
        : { title: step.title, detail: step.detail };
    return { ...step, ...copy, to, state, tracked };
  });
  const firstAction = trackedSteps.find((step) => step.state === 'recommended')
    ?? trackedSteps.find((step) => step.state !== 'complete')
    ?? trackedSteps[0];
  const completed = trackedMission.steps.filter((step) => step.status === 'complete').length;
  const remainingMinutes = trackedSteps
    .filter((step) => step.state !== 'complete')
    .reduce((sum, step) => sum + step.minutes, 0);
  const xpPct = Math.round((into / span) * 100);
  const begin = () => { startMission(trackedMission); };
  const missionHref = (href: string, stage: MissionStage) => (
    withMissionContext(href, trackedMission.id, stage)
  );
  const courseHref = trackedMission.currentStage === 'learn'
    ? missionHref(`/learn/${mission.focus.id}`, 'learn')
    : `/learn/${mission.focus.id}`;
  const activeTrackedStep = trackedMission.steps.find((step) => step.status === 'active');
  const activeTargetHref = activeTrackedStep?.target.href;
  const focusPlayIsMission = !!activeTargetHref?.startsWith(`/play/${mission.focus.id}`);
  const focusPlayHref = focusPlayIsMission && activeTrackedStep && activeTargetHref
    ? missionHref(activeTargetHref, activeTrackedStep.stage)
    : `/play/${mission.focus.id}`;

  return (
    <div className="path-page">
      <section className="path-hero" aria-labelledby="path-title">
        <img
          src="./assets/learning-journey.webp"
          alt=""
          className="path-hero-image"
          width="1774"
          height="887"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="path-hero-veil" />
        <div className="path-hero-copy">
          <span className="path-kicker"><i aria-hidden="true" /> Adaptive strategy path · refreshed from your evidence</span>
          <h1 id="path-title">{mission.headline}</h1>
          <p>{mission.rationale}</p>
          <div className="path-hero-actions">
            <Link className="btn primary lg glow" onClick={begin} to={missionHref(firstAction.to, firstAction.id)}>
              {completed ? 'Continue with' : 'Start with'} {firstAction.title.toLowerCase()} →
            </Link>
            <Link className="btn lg path-quiet" onClick={begin} to={courseHref}>
              View {mission.focus.name} course
            </Link>
          </div>
        </div>
        <div className="path-hero-score glass-soft">
          <div
            className="path-ring"
            role="progressbar"
            aria-label="Recommendation confidence"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={mission.confidence}
            style={{ '--path-score': `${mission.confidence * 3.6}deg` } as CSSProperties}
          >
            <strong>{mission.confidence}%</strong>
          </div>
          <div><span>Recommendation confidence</span><b>{Math.max(3, remainingMinutes)} min remaining</b></div>
        </div>
      </section>

      <section className="path-metrics" aria-label="Current learning snapshot" role="list">
        <Metric label="Strategy rating" value={profile.rating} note={ratingTitle(profile.rating)} icon="♜" />
        <Metric label="Learning level" value={`Lv ${level}`} note={`${into}/${span} XP`} icon="↗" progress={xpPct} />
        <Metric label="Practice streak" value={`${training.dailyStreak}d`} note={`${training.puzzlesSolved} positions solved`} icon="✦" />
        <Metric label="Evidence base" value={profile.totals.played + reviews.length} note={`${profile.totals.played} games · ${reviews.length} reviews`} icon="◉" />
      </section>

      <section className="path-section" aria-labelledby="mission-title">
        <div className="path-section-head">
          <div>
            <span className="section-overline">One connected session</span>
            <h2 id="mission-title">Today’s learning route</h2>
          </div>
          <span className="path-completion">{completed}/{mission.steps.length} signals ready</span>
        </div>
        <div className="mission-track">
          {trackedSteps.map((step, index) => {
            const content = (
              <>
              <div className="mission-step-top">
                <span className="mission-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="mission-state">{step.state === 'complete' ? '✓ evidence' : step.state === 'recommended' ? 'active now' : 'locked'}</span>
              </div>
              <span className="mission-icon" aria-hidden="true">{step.icon}</span>
              <span className="mission-agent">{step.agent}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
              <span className="mission-go">
                {step.state === 'locked' ? 'Complete the previous stage' : 'Open stage'} {step.state !== 'locked' && <b>→</b>}
              </span>
              </>
            );
            return step.state === 'locked' ? (
              <article className="mission-step locked" aria-disabled="true" key={step.id}>{content}</article>
            ) : (
              <Link
                to={missionHref(step.to, step.id)}
                onClick={begin}
                className={`mission-step ${step.state}`}
                aria-current={step.state === 'recommended' ? 'step' : undefined}
                key={step.id}
              >
                {content}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="path-grid">
        <div className="path-section path-agents" aria-labelledby="agents-title">
          <div className="path-section-head compact">
            <div>
              <span className="section-overline">Shared learner model</span>
              <h2 id="agents-title">Five specialists, one memory</h2>
            </div>
            <span className="agent-live"><i aria-hidden="true" /> Coordinated</span>
          </div>
          <p className="path-intro">Each specialist works from the same games, lessons, puzzles, reviews and progress record. Their recommendations change together—not as disconnected tools.</p>
          <div className="agent-list">
            {mission.agents.map((agent) => (
              <article className="agent-row" key={agent.id}>
                <span className="agent-symbol" aria-hidden="true">{agent.icon}</span>
                <div className="agent-main">
                  <div className="agent-name"><strong>{agent.name}</strong><span>{agent.role}</span></div>
                  <p>{agent.finding}</p>
                  <small>{agent.evidence}</small>
                </div>
                <span className={`agent-status ${agent.status}`}>{agent.status}</span>
              </article>
            ))}
          </div>
        </div>

        <aside className="path-section mastery-panel" aria-labelledby="mastery-title">
          <span className="section-overline">Live learner signals</span>
          <h2 id="mastery-title">What the system sees</h2>
          <p className="path-intro">Confidence is earned from evidence. Nothing here is a permanent label.</p>
          <div className="mastery-list">
            {mission.concepts.map((concept) => (
              <div className="mastery-item" key={concept.name}>
                <div className="mastery-label"><strong>{concept.name}</strong><span>{concept.score}%</span></div>
                <div className="mastery-bar" role="progressbar" aria-label={concept.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={concept.score}><i style={{ width: `${concept.score}%` }} /></div>
                <small>{concept.note}</small>
              </div>
            ))}
          </div>
          <div className="focus-card">
            <span className="focus-emoji" aria-hidden="true">{mission.focus.emoji}</span>
            <div><small>Current focus</small><strong>{mission.focus.name}</strong><span>{mission.focus.category} · depth {mission.focus.depth}/5</span></div>
            <Link onClick={begin} to={focusPlayHref} aria-label={`Play ${mission.focus.name}${focusPlayIsMission ? ' as part of this mission' : ''}`}>→</Link>
          </div>
        </aside>
      </section>
    </div>
  );
}

function Metric({ label, value, note, icon, progress }: { label: string; value: string | number; note: string; icon: string; progress?: number }) {
  return (
    <div className="path-metric glass-soft" role="listitem">
      <span className="path-metric-icon" aria-hidden="true">{icon}</span>
      <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
      {progress != null && <div className="path-mini-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>}
    </div>
  );
}
