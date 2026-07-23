import type { GameRecord } from '../engine/reviewSummary';
import type { Tally } from '../profile/profile';

export type LearningStage = 'observe' | 'learn' | 'practice' | 'play' | 'reflect';

export interface GameSignal {
  id: string;
  name: string;
  emoji: string;
  category: string;
  depth: number;
  /** False when the game has no authored puzzle position yet. */
  practiceAvailable?: boolean;
  /** Bespoke engines currently expose Easy, Medium and Hard only. */
  threeTierDifficulty?: boolean;
}

export interface LearnerSnapshot {
  name: string;
  rating: number;
  stats: Record<string, Tally>;
  totalPlayed: number;
  totalWins: number;
  xp: number;
  seenGames: string[];
  gamesToday: string[];
  dailyStreak: number;
  puzzlesSolved: number;
  puzzleStreak: number;
  reviews: GameRecord[];
}

export interface MissionStep {
  id: LearningStage;
  agent: string;
  icon: string;
  title: string;
  detail: string;
  to: string;
  minutes: number;
  state: 'recommended' | 'ready' | 'complete';
}

export interface AgentInsight {
  id: string;
  name: string;
  role: string;
  icon: string;
  status: 'watching' | 'ready' | 'working';
  finding: string;
  evidence: string;
}

export interface LearningMission {
  focus: GameSignal;
  headline: string;
  rationale: string;
  difficulty: 'Tutor' | 'Easy' | 'Medium' | 'Hard' | 'Master';
  duration: number;
  confidence: number;
  steps: MissionStep[];
  agents: AgentInsight[];
  concepts: { name: string; score: number; note: string }[];
}

const safeRate = (t: Tally | undefined): number => !t?.played ? 0.5 : t.wins / t.played;

function chooseFocus(
  snapshot: LearnerSnapshot,
  games: GameSignal[],
  preferredGameId?: string,
): GameSignal {
  const fallback = games.find((g) => g.id === 'chess') ?? games[0];
  if (!fallback) throw new Error('At least one game is required to build a learning mission.');
  const preferred = preferredGameId
    ? games.find((game) => game.id === preferredGameId)
    : undefined;
  if (preferred) return preferred;

  const played = games.filter((g) => snapshot.stats[g.id]?.played);
  if (!played.length) return fallback;

  const latestId = snapshot.reviews[0]?.gameId;
  return played
    .map((game) => {
      const tally = snapshot.stats[game.id];
      const winGap = 1 - safeRate(tally);
      const evidence = Math.min(1, tally.played / 8);
      const recent = game.id === latestId ? 0.24 : 0;
      const unseenToday = snapshot.gamesToday.includes(game.id) ? 0 : 0.08;
      return { game, score: winGap * 0.58 + evidence * 0.1 + recent + unseenToday };
    })
    .sort((a, b) => b.score - a.score)[0].game;
}

function difficultyFor(rating: number): LearningMission['difficulty'] {
  if (rating < 600) return 'Tutor';
  if (rating < 900) return 'Easy';
  if (rating < 1250) return 'Medium';
  if (rating < 1600) return 'Hard';
  return 'Master';
}

function diagnosticAgent(snapshot: LearnerSnapshot, focus: GameSignal): AgentInsight {
  const tally = snapshot.stats[focus.id];
  const recent = snapshot.reviews.find((r) => r.gameId === focus.id);
  const rate = Math.round(safeRate(tally) * 100);
  if (!tally?.played) {
    return {
      id: 'diagnostic', name: 'Diagnostician', role: 'Reads your current evidence', icon: '◉', status: 'working',
      finding: `${focus.name} is the clearest starting point for a baseline session.`,
      evidence: 'No prior match evidence yet · confidence grows after each coached game',
    };
  }
  return {
    id: 'diagnostic', name: 'Diagnostician', role: 'Reads your current evidence', icon: '◉', status: 'working',
    finding: recent?.key.length
      ? `${recent.key.length} decisive moment${recent.key.length === 1 ? '' : 's'} can become targeted practice.`
      : `${focus.name} offers the best balance of challenge and useful repetition now.`,
    evidence: `${tally.played} games · ${rate}% wins${recent ? ` · latest review ${recent.graded?.[0] === 0 ? 'analysis pending' : `${recent.acc[0]}% / ${recent.acc[1]}%`}` : ''}`,
  };
}

function curriculumAgent(snapshot: LearnerSnapshot, focus: GameSignal): AgentInsight {
  const newGame = !snapshot.seenGames.includes(`lesson:${focus.id}`);
  return {
    id: 'curriculum', name: 'Curriculum Guide', role: 'Sequences the right lesson', icon: '◇', status: 'ready',
    finding: newGame
      ? `Begin with the essential rules, then prove one idea on the board.`
      : `Use a short refresher before independent calculation.`,
    evidence: `${focus.category} family · depth ${focus.depth}/5 · prerequisite-aware route`,
  };
}

function practiceAgent(snapshot: LearnerSnapshot, focus: GameSignal): AgentInsight {
  const warmed = snapshot.puzzleStreak > 0;
  return {
    id: 'practice', name: 'Practice Builder', role: 'Selects the next useful position', icon: '✦', status: warmed ? 'working' : 'ready',
    finding: warmed
      ? `Keep the ${snapshot.puzzleStreak}-position streak alive with a ${focus.name} pattern.`
      : `Start with one guided position, then remove the hints.`,
    evidence: `${snapshot.puzzlesSolved} solved · adapts by game, depth and recent review`,
  };
}

function sparringAgent(snapshot: LearnerSnapshot, focus: GameSignal, difficulty: LearningMission['difficulty']): AgentInsight {
  const tally = snapshot.stats[focus.id];
  return {
    id: 'sparring', name: 'Sparring Director', role: 'Sets a fair, revealing match', icon: '⬡', status: 'ready',
    finding: `${difficulty} strength will test the idea without making the session noisy.`,
    evidence: tally?.played ? `${tally.wins}W · ${tally.losses}L · ${tally.draws}D` : 'First match becomes your placement evidence',
  };
}

function reviewAgent(snapshot: LearnerSnapshot, focus: GameSignal): AgentInsight {
  const records = snapshot.reviews.filter((r) => r.gameId === focus.id);
  return {
    id: 'review', name: 'Review Analyst', role: 'Turns mistakes into the next drill', icon: '⌁', status: records.length ? 'working' : 'watching',
    finding: records.length
      ? `Your next review will compare the new game with ${records.length} saved ${focus.name} record${records.length === 1 ? '' : 's'}.`
      : `It will preserve the key moments from your first completed game.`,
    evidence: `${snapshot.reviews.length} total reviews · evaluation, accuracy and key moments`,
  };
}

function buildConcepts(snapshot: LearnerSnapshot, focus: GameSignal) {
  const tally = snapshot.stats[focus.id];
  const experience = Math.min(100, Math.round((tally?.played ?? 0) * 11 + snapshot.puzzlesSolved * 1.5));
  const consistency = Math.min(100, Math.round(safeRate(tally) * 62 + Math.min(38, snapshot.dailyStreak * 5)));
  const reflection = Math.min(100, Math.round(snapshot.reviews.length * 12 + (snapshot.totalPlayed ? 18 : 0)));
  return [
    { name: 'Pattern recognition', score: Math.max(8, experience), note: `${snapshot.puzzlesSolved} positions solved` },
    { name: 'Decision quality', score: Math.max(10, consistency), note: `${Math.round(safeRate(tally) * 100)}% ${focus.name} win rate` },
    { name: 'Reflective practice', score: Math.max(5, reflection), note: `${snapshot.reviews.length} reviews available` },
  ];
}

export function buildLearningMission(
  snapshot: LearnerSnapshot,
  games: GameSignal[],
  preferredGameId?: string,
): LearningMission {
  const focus = chooseFocus(snapshot, games, preferredGameId);
  const recommendedDifficulty = difficultyFor(snapshot.rating);
  const difficulty = focus.threeTierDifficulty
    ? recommendedDifficulty === 'Tutor' || recommendedDifficulty === 'Easy'
      ? 'Easy'
      : recommendedDifficulty === 'Medium'
        ? 'Medium'
        : 'Hard'
    : recommendedDifficulty;
  const difficultyParam = difficulty.toLowerCase();
  const tally = snapshot.stats[focus.id];
  const hasReview = snapshot.reviews.some((r) => r.gameId === focus.id);
  const hasPuzzlePractice = focus.practiceAvailable !== false;
  const firstStep: MissionStep = hasReview
    ? { id: 'observe', agent: 'Diagnostician', icon: '◉', title: 'Revisit one key moment', detail: 'See what changed the evaluation and name the idea before moving on.', to: '/reviews', minutes: 3, state: 'recommended' }
    : { id: 'observe', agent: 'Diagnostician', icon: '◉', title: 'Establish your baseline', detail: 'Play a short coached game so the system can measure real decisions.', to: `/play/${focus.id}?difficulty=${difficultyParam}`, minutes: 6, state: 'recommended' };

  const steps: MissionStep[] = [
    firstStep,
    { id: 'learn', agent: 'Curriculum Guide', icon: '◇', title: `Study one ${focus.name} idea`, detail: 'A short lesson with an interactive board and a proof position.', to: `/learn/${focus.id}`, minutes: 5, state: 'ready' },
    hasPuzzlePractice
      ? { id: 'practice', agent: 'Practice Builder', icon: '✦', title: 'Solve with fading support', detail: 'Start guided, then calculate the same pattern independently.', to: `/puzzles?game=${focus.id}`, minutes: 4, state: 'ready' }
      : { id: 'practice', agent: 'Practice Builder', icon: '✦', title: 'Rehearse in a coached game', detail: 'Apply the course idea on the full board with explanations switched on.', to: `/play/${focus.id}?difficulty=${difficultyParam}`, minutes: 6, state: 'ready' },
    { id: 'play', agent: 'Sparring Director', icon: '⬡', title: `Test it at ${difficulty} strength`, detail: 'The opponent level is matched to your current rating evidence.', to: `/play/${focus.id}?difficulty=${difficultyParam}`, minutes: 8, state: 'ready' },
    { id: 'reflect', agent: 'Review Analyst', icon: '⌁', title: 'Close the learning loop', detail: 'Keep the decisive moments and turn them into tomorrow’s route.', to: '/reviews', minutes: 3, state: 'ready' },
  ];

  const confidence = Math.min(96, 48 + Math.min(24, (tally?.played ?? 0) * 4) + Math.min(16, snapshot.reviews.length * 4) + Math.min(8, snapshot.puzzlesSolved));
  const duration = steps.filter((s) => s.state !== 'complete').reduce((sum, s) => sum + s.minutes, 0);
  const firstName = snapshot.name.trim() && snapshot.name !== 'You' ? `, ${snapshot.name.trim()}` : '';
  const rationale = !tally?.played
    ? `${focus.name} gives the system a strong first read across rules, patterns and decision quality.`
    : `Your recent ${focus.name} evidence shows the greatest immediate learning value here.`;

  return {
    focus,
    headline: `Your next best move${firstName}: ${focus.name}`,
    rationale,
    difficulty,
    duration: Math.max(3, duration),
    confidence,
    steps,
    agents: [
      diagnosticAgent(snapshot, focus),
      curriculumAgent(snapshot, focus),
      practiceAgent(snapshot, focus),
      sparringAgent(snapshot, focus, difficulty),
      reviewAgent(snapshot, focus),
    ],
    concepts: buildConcepts(snapshot, focus),
  };
}
