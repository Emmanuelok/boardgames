import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Difficulty, GameDefinition } from '../engine/types';
import { GAMES, GAME_MAP } from '../engine/registry';
import { loadRecords } from '../engine/reviewSummary';
import { PUZZLE_GAME_IDS } from '../puzzles/allPuzzles';
import { useProfile, ratingTitle } from '../profile/profile';
import { levelFromXp, useProgression } from '../progression/progression';
import { createLearningMission, useLearningMemory } from '../intelligence/learningMemory';
import { withMissionContext } from '../intelligence/missionRouting';
import {
  buildStudioPlan,
  createStudioPlanId,
  loadStudioPlans,
  missionTargetsForStudioPlan,
  saveStudioPlan,
  STUDIO_DURATIONS,
  STUDIO_GOALS,
  STUDIO_GOAL_META,
  type StudioDuration,
  type StudioGameSignal,
  type StudioGoal,
  type StudioPlan,
} from '../studio/sessionStudio';
import './StrategyStudio.css';

const DIFFICULTIES: { id: Difficulty; label: string; description: string }[] = [
  { id: 'tutor', label: 'Tutor', description: 'Maximum guidance' },
  { id: 'easy', label: 'Easy', description: 'Calm rehearsal' },
  { id: 'medium', label: 'Medium', description: 'Balanced test' },
  { id: 'hard', label: 'Hard', description: 'Serious resistance' },
  { id: 'master', label: 'Master', description: 'Deepest search' },
];

function recommendedDifficulty(rating: number): Difficulty {
  if (rating < 600) return 'tutor';
  if (rating < 900) return 'easy';
  if (rating < 1250) return 'medium';
  if (rating < 1600) return 'hard';
  return 'master';
}

function gameDifficulties(game: GameDefinition): typeof DIFFICULTIES {
  return game.custom
    ? DIFFICULTIES.filter((item) => item.id === 'easy' || item.id === 'medium' || item.id === 'hard')
    : DIFFICULTIES;
}

function recentDate(timestamp: number): string {
  if (!timestamp) return 'Preview';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

export default function StrategyStudio() {
  const navigate = useNavigate();
  const profile = useProfile();
  const progression = useProgression();
  const activeMission = useLearningMemory((state) => state.activeMission);
  const activateMission = useLearningMemory((state) => state.activateMission);
  const events = useLearningMemory((state) => state.events);
  const reviews = useMemo(loadRecords, []);
  const practiceGames = useMemo(() => new Set(PUZZLE_GAME_IDS), []);
  const reviewedGames = useMemo(() => new Set(reviews.map((record) => record.gameId)), [reviews]);
  const initialGameId = activeMission?.gameId
    ?? Object.entries(profile.stats).sort(([, a], [, b]) => b.played - a.played)[0]?.[0]
    ?? 'chess';
  const [gameId, setGameId] = useState(GAME_MAP[initialGameId] ? initialGameId : 'chess');
  const [goal, setGoal] = useState<StudioGoal>(profile.totals.played ? 'planning' : 'foundation');
  const [duration, setDuration] = useState<StudioDuration>(30);
  const [difficulty, setDifficulty] = useState<Difficulty>(recommendedDifficulty(profile.rating));
  const [recentPlans, setRecentPlans] = useState(() => (
    loadStudioPlans().filter((plan) => !!GAME_MAP[plan.gameId])
  ));
  const [savedMessage, setSavedMessage] = useState('');
  const game = GAME_MAP[gameId] ?? GAMES[0];
  const allowedDifficulties = gameDifficulties(game);
  const effectiveDifficulty = allowedDifficulties.some((item) => item.id === difficulty)
    ? difficulty
    : 'medium';

  const signal: StudioGameSignal = useMemo(() => ({
    id: game.id,
    name: game.name,
    emoji: game.emoji,
    category: game.category,
    depth: game.depth,
    practiceAvailable: practiceGames.has(game.id),
    hasReview: reviewedGames.has(game.id),
  }), [game, practiceGames, reviewedGames]);

  const draft = useMemo(() => buildStudioPlan(signal, goal, duration, effectiveDifficulty, {
    id: `studio-preview:${signal.id}`,
    createdAt: 0,
  }), [signal, goal, duration, effectiveDifficulty]);
  const goalMeta = STUDIO_GOAL_META[goal];
  const tally = profile.stats[game.id];
  const gameReviews = reviews.filter((record) => record.gameId === game.id);
  const confidence = Math.min(96, 44
    + Math.min(24, (tally?.played ?? 0) * 4)
    + Math.min(16, gameReviews.length * 4)
    + Math.min(12, events.filter((event) => event.gameId === game.id).length * 2));
  const { level } = levelFromXp(progression.xp);
  const relatedGames = useMemo(() => GAMES
    .filter((candidate) => candidate.id !== game.id && candidate.category === game.category)
    .sort((a, b) => Math.abs(a.depth - game.depth) - Math.abs(b.depth - game.depth))
    .slice(0, 3), [game]);
  const activeProgress = activeMission
    ? activeMission.steps.filter((step) => step.status === 'complete').length
    : 0;

  const createCurrentPlan = (): StudioPlan => buildStudioPlan(
    signal,
    goal,
    duration,
    effectiveDifficulty,
    { id: createStudioPlanId(game.id), createdAt: Date.now() },
  );

  const saveBlueprint = () => {
    const plan = createCurrentPlan();
    setRecentPlans(saveStudioPlan(plan));
    setSavedMessage(`${plan.gameName} blueprint saved.`);
  };

  const launchPlan = (plan: StudioPlan) => {
    const saved = plan.createdAt ? plan : createCurrentPlan();
    if (!GAME_MAP[saved.gameId]) return;
    setRecentPlans(saveStudioPlan(saved));
    const mission = createLearningMission({
      id: `mission:${saved.id}`,
      gameId: saved.gameId,
      targets: missionTargetsForStudioPlan(saved),
    });
    activateMission(mission);
    const first = saved.steps[0];
    navigate(withMissionContext(first.href, mission.id, first.stage));
  };

  const restorePlan = (plan: StudioPlan) => {
    if (!GAME_MAP[plan.gameId]) return;
    setGameId(plan.gameId);
    setGoal(plan.goal);
    setDuration(plan.duration);
    setDifficulty(plan.difficulty);
    setSavedMessage(`${plan.gameName} blueprint loaded.`);
    document.getElementById('studio-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const chooseGame = (nextId: string) => {
    const nextGame = GAME_MAP[nextId];
    if (!nextGame) return;
    setGameId(nextId);
    if (!gameDifficulties(nextGame).some((item) => item.id === difficulty)) setDifficulty('medium');
    setSavedMessage('');
  };

  return (
    <div className="studio-page">
      <header className="studio-hero" aria-labelledby="studio-title">
        <img
          className="studio-hero-art"
          src="/assets/strategy-studio.webp"
          alt=""
          width="1800"
          height="1013"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="studio-hero-veil" />
        <div className="studio-hero-copy">
          <span className="studio-kicker"><i aria-hidden="true" /> Strategy Studio · session intelligence</span>
          <h1 id="studio-title">Design one session. Mobilize the whole platform.</h1>
          <p>Choose the board, learning goal, time and resistance. The Studio coordinates diagnosis, lessons, practice, sparring and review into one evidence-tracked route.</p>
          <div className="studio-hero-actions">
            <button
              className="btn primary lg glow"
              type="button"
              onClick={() => document.getElementById('studio-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Build a session
            </button>
            <Link className="btn lg studio-quiet" to="/path">Continue adaptive path</Link>
          </div>
        </div>
        <aside className="studio-live glass-soft" aria-label="Studio system status">
          <span><i aria-hidden="true" /> System online</span>
          <strong>{activeMission?.status === 'active' ? `${activeProgress}/5 signals collected` : 'Ready for a new blueprint'}</strong>
          <small>{events.length} learning events · {reviews.length} reviews · level {level}</small>
        </aside>
      </header>

      <section className="studio-snapshot" aria-label="Current learner evidence" role="list">
        <div role="listitem"><span>Strategy rating</span><strong>{profile.rating}</strong><small>{ratingTitle(profile.rating)}</small></div>
        <div role="listitem"><span>{game.name} evidence</span><strong>{tally?.played ?? 0}</strong><small>{gameReviews.length} saved review{gameReviews.length === 1 ? '' : 's'}</small></div>
        <div role="listitem"><span>Blueprint confidence</span><strong>{confidence}%</strong><small>Based on available evidence</small></div>
        <div role="listitem"><span>Session span</span><strong>{duration} min</strong><small>Five connected stages</small></div>
      </section>

      <section className="studio-builder" id="studio-builder" aria-labelledby="builder-title">
        <div className="studio-builder-head">
          <div>
            <span className="section-overline">Session architect</span>
            <h2 id="builder-title">What do you want this session to change?</h2>
            <p>Every choice updates the route immediately. Starting it makes this blueprint your active learning path while preserving all prior evidence.</p>
          </div>
          <div className="studio-pulse" aria-label={`${confidence}% blueprint confidence`}>
            <span style={{ '--studio-confidence': `${confidence * 3.6}deg` } as CSSProperties}><b>{confidence}</b></span>
            <small>evidence<br />confidence</small>
          </div>
        </div>

        <div className="studio-controls">
          <label className="studio-select">
            <span>Game world</span>
            <select value={game.id} onChange={(event) => chooseGame(event.target.value)}>
              {GAMES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.category}</option>)}
            </select>
          </label>
          <label className="studio-select">
            <span>Session length</span>
            <select value={duration} onChange={(event) => setDuration(Number(event.target.value) as StudioDuration)}>
              {STUDIO_DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
            </select>
          </label>
          <label className="studio-select">
            <span>Sparring strength</span>
            <select value={effectiveDifficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
              {allowedDifficulties.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.description}</option>)}
            </select>
          </label>
        </div>

        <fieldset className="studio-goals">
          <legend>Strategic objective</legend>
          <div>
            {STUDIO_GOALS.map((item) => {
              const meta = STUDIO_GOAL_META[item];
              return (
                <button type="button" key={item} className={goal === item ? 'on' : ''} aria-pressed={goal === item} onClick={() => setGoal(item)}>
                  <span aria-hidden="true">{meta.icon}</span>
                  <strong>{meta.label}</strong>
                  <small>{meta.description}</small>
                </button>
              );
            })}
          </div>
        </fieldset>
      </section>

      <section className="studio-plan" aria-labelledby="plan-title">
        <div className="studio-plan-head">
          <div>
            <span className="section-overline">Live blueprint · {game.category}</span>
            <h2 id="plan-title"><span aria-hidden="true">{game.emoji}</span> {game.name}: {goalMeta.short}</h2>
            <p>{duration} focused minutes at {effectiveDifficulty} strength. Each completed stage unlocks the next and returns evidence to the shared learner model.</p>
          </div>
          <div className="studio-plan-actions">
            <button className="btn" type="button" onClick={saveBlueprint}>Save blueprint</button>
            <button className="btn primary glow" type="button" onClick={() => launchPlan(draft)}>Start connected session →</button>
          </div>
        </div>
        {savedMessage && <p className="studio-saved" role="status">{savedMessage}</p>}
        <ol className="studio-route">
          {draft.steps.map((step, index) => (
            <li key={step.stage}>
              <div className="studio-route-top"><span>{String(index + 1).padStart(2, '0')}</span><b>{step.minutes} min</b></div>
              <span className="studio-route-icon" aria-hidden="true">{step.icon}</span>
              <small>{step.agent}</small>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
              <Link to={step.href}>Preview stage <span aria-hidden="true">→</span></Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="studio-intelligence">
        <div className="studio-lens" aria-labelledby="lens-title">
          <div className="studio-section-head">
            <div><span className="section-overline">Transfer lens</span><h2 id="lens-title">Carry the idea to another board.</h2></div>
            <span className="studio-signal"><i aria-hidden="true" /> Same learner memory</span>
          </div>
          <p>The Studio compares strategic structure, not just visual similarity. These {game.category.toLowerCase()} games sit closest to {game.name} in learning depth.</p>
          <div className="studio-related">
            {relatedGames.map((candidate) => (
              <button type="button" key={candidate.id} onClick={() => chooseGame(candidate.id)}>
                <span aria-hidden="true">{candidate.emoji}</span>
                <div><strong>{candidate.name}</strong><small>Depth {candidate.depth}/5 · {candidate.tagline}</small></div>
                <b aria-hidden="true">→</b>
              </button>
            ))}
          </div>
        </div>

        <aside className="studio-context" aria-labelledby="context-title">
          <span className="section-overline">Evidence continuity</span>
          <h2 id="context-title">{activeMission?.status === 'active' ? 'A route is already learning from you.' : 'Your first route is ready to begin.'}</h2>
          <p>{activeMission?.status === 'active'
            ? `Your current ${GAME_MAP[activeMission.gameId]?.name ?? 'strategy'} mission is ${activeProgress}/5 complete. A Studio launch deliberately changes the active route, but its collected evidence stays in memory.`
            : 'Launching this blueprint starts ordered evidence tracking across every surface.'}</p>
          {activeMission?.status === 'active' && <Link className="btn" to="/path">Open current route</Link>}
          <div className="studio-context-grid">
            <div><strong>{events.length}</strong><span>learning signals</span></div>
            <div><strong>{progression.seenGames.filter((id) => !id.startsWith('lesson:')).length}</strong><span>boards explored</span></div>
          </div>
        </aside>
      </section>

      {recentPlans.length > 0 && (
        <section className="studio-history" aria-labelledby="history-title">
          <div className="studio-section-head">
            <div><span className="section-overline">Recent blueprints</span><h2 id="history-title">Return to a proven session design.</h2></div>
            <small>Saved only on this device</small>
          </div>
          <div className="studio-history-grid">
            {recentPlans.slice(0, 4).map((plan) => (
              <article key={plan.id}>
                <span className="studio-history-emoji" aria-hidden="true">{plan.gameEmoji}</span>
                <small>{recentDate(plan.createdAt)} · {plan.duration} min</small>
                <h3>{plan.gameName}</h3>
                <p>{STUDIO_GOAL_META[plan.goal].label} · {plan.difficulty} strength</p>
                <div>
                  <button type="button" onClick={() => restorePlan(plan)}>Load</button>
                  <button type="button" onClick={() => launchPlan(plan)}>Launch →</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
