import type { Difficulty } from '../engine/types';
import type { MissionStage, MissionTarget } from '../intelligence/learningMemory';

export const STUDIO_STORAGE_KEY = 'gm-strategy-studio-v1';
export const STUDIO_PLAN_VERSION = 1 as const;
export const MAX_STUDIO_PLANS = 8;

export const STUDIO_GOALS = ['foundation', 'tactics', 'planning', 'endgame', 'exploration'] as const;
export type StudioGoal = (typeof STUDIO_GOALS)[number];
export const STUDIO_DURATIONS = [15, 30, 45, 60] as const;
export type StudioDuration = (typeof STUDIO_DURATIONS)[number];

export interface StudioGoalMeta {
  label: string;
  short: string;
  description: string;
  principle: string;
  icon: string;
}

export const STUDIO_GOAL_META: Record<StudioGoal, StudioGoalMeta> = {
  foundation: {
    label: 'Build foundations',
    short: 'Foundations',
    description: 'Clarify the rules, purpose of each move and one dependable plan.',
    principle: 'purpose before speed',
    icon: '◇',
  },
  tactics: {
    label: 'Sharpen tactics',
    short: 'Tactics',
    description: 'Recognize forcing patterns, compare candidates and calculate cleanly.',
    principle: 'checks, threats and forcing replies',
    icon: '✦',
  },
  planning: {
    label: 'Plan deeper',
    short: 'Planning',
    description: 'Connect position features to a multi-move plan and useful trade-offs.',
    principle: 'position, plan, then move',
    icon: '⌁',
  },
  endgame: {
    label: 'Control endings',
    short: 'Endgames',
    description: 'Convert small advantages through tempo, mobility and precise sequencing.',
    principle: 'simplify with a reason',
    icon: '◎',
  },
  exploration: {
    label: 'Explore a new world',
    short: 'Exploration',
    description: 'Build a fast mental model, then discover which ideas transfer.',
    principle: 'compare patterns across boards',
    icon: '⬡',
  },
};

export interface StudioGameSignal {
  id: string;
  name: string;
  emoji: string;
  category: string;
  depth: number;
  practiceAvailable: boolean;
  hasReview: boolean;
}

export interface StudioPlanStep {
  stage: MissionStage;
  agent: string;
  icon: string;
  title: string;
  detail: string;
  href: string;
  minutes: number;
}

export interface StudioPlan {
  version: typeof STUDIO_PLAN_VERSION;
  id: string;
  createdAt: number;
  gameId: string;
  gameName: string;
  gameEmoji: string;
  category: string;
  goal: StudioGoal;
  duration: StudioDuration;
  difficulty: Difficulty;
  practiceAvailable: boolean;
  steps: StudioPlanStep[];
}

interface StudioPlanIdentity {
  id?: string;
  createdAt?: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STAGES: readonly MissionStage[] = ['observe', 'learn', 'practice', 'play', 'reflect'];
const DIFFICULTIES: readonly Difficulty[] = ['tutor', 'easy', 'medium', 'hard', 'master'];
const STEP_MINUTES: Record<StudioDuration, readonly [number, number, number, number, number]> = {
  15: [2, 3, 3, 5, 2],
  30: [3, 6, 6, 11, 4],
  45: [5, 8, 9, 17, 6],
  60: [6, 11, 12, 23, 8],
};

function safeIdPart(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 64);
}

export function createStudioPlanId(gameId: string, now = Date.now()): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2, 10);
  return `studio:${safeIdPart(gameId)}:${now.toString(36)}:${random}`;
}

export function buildStudioPlan(
  game: StudioGameSignal,
  goal: StudioGoal,
  duration: StudioDuration,
  difficulty: Difficulty,
  identity: StudioPlanIdentity = {},
): StudioPlan {
  const goalMeta = STUDIO_GOAL_META[goal];
  const minutes = STEP_MINUTES[duration];
  const playHref = `/play/${game.id}?difficulty=${difficulty}`;
  const practiceHref = game.practiceAvailable
    ? `/puzzles?game=${game.id}`
    : `/play/${game.id}?difficulty=${difficulty === 'master' ? 'hard' : difficulty}`;

  const steps: StudioPlanStep[] = [
    game.hasReview
      ? {
        stage: 'observe', agent: 'Diagnostician', icon: '◉',
        title: 'Read your last turning point',
        detail: `Reopen one ${game.name} decision and name what the position demanded.`,
        href: '/reviews', minutes: minutes[0],
      }
      : {
        stage: 'observe', agent: 'Diagnostician', icon: '◉',
        title: 'Establish a quick baseline',
        detail: `Play a short coached position so the system can read your current ${game.name} decisions.`,
        href: playHref, minutes: minutes[0],
      },
    {
      stage: 'learn', agent: 'Curriculum Guide', icon: '◇',
      title: `Study the ${goalMeta.short.toLowerCase()} lens`,
      detail: `${goalMeta.description} Keep one rule in view: ${goalMeta.principle}.`,
      href: `/learn/${game.id}`, minutes: minutes[1],
    },
    game.practiceAvailable
      ? {
        stage: 'practice', agent: 'Practice Builder', icon: '✦',
        title: 'Prove it in a focused position',
        detail: `Calculate one ${game.name} pattern with support, then solve it independently.`,
        href: practiceHref, minutes: minutes[2],
      }
      : {
        stage: 'practice', agent: 'Practice Builder', icon: '✦',
        title: 'Rehearse with live coaching',
        detail: `Apply the idea on the full ${game.name} board while move explanations stay visible.`,
        href: practiceHref, minutes: minutes[2],
      },
    {
      stage: 'play', agent: 'Sparring Director', icon: '⬡',
      title: `Test the idea at ${difficulty} strength`,
      detail: `Play one purposeful game. Pause before each move to compare two candidate plans.`,
      href: playHref, minutes: minutes[3],
    },
    {
      stage: 'reflect', agent: 'Review Analyst', icon: '⌁',
      title: 'Turn the game into the next lesson',
      detail: 'Save the decisive moment, explain the better idea and feed that evidence back into your path.',
      href: '/reviews', minutes: minutes[4],
    },
  ];

  const createdAt = Number.isFinite(identity.createdAt) && (identity.createdAt ?? 0) >= 0
    ? Math.floor(identity.createdAt!)
    : Date.now();
  return {
    version: STUDIO_PLAN_VERSION,
    id: identity.id || createStudioPlanId(game.id, createdAt),
    createdAt,
    gameId: game.id,
    gameName: game.name,
    gameEmoji: game.emoji,
    category: game.category,
    goal,
    duration,
    difficulty,
    practiceAvailable: game.practiceAvailable,
    steps,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validShortString(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseStep(value: unknown, expectedStage: MissionStage): StudioPlanStep | null {
  if (!isRecord(value) || value.stage !== expectedStage) return null;
  if (
    !validShortString(value.agent, 80)
    || !validShortString(value.icon, 8)
    || !validShortString(value.title, 160)
    || !validShortString(value.detail, 420)
    || !validShortString(value.href, 300)
    || !value.href.startsWith('/')
    || typeof value.minutes !== 'number'
    || !Number.isInteger(value.minutes)
    || value.minutes < 1
    || value.minutes > 60
  ) return null;
  return {
    stage: expectedStage,
    agent: value.agent,
    icon: value.icon,
    title: value.title,
    detail: value.detail,
    href: value.href,
    minutes: value.minutes,
  };
}

function parsePlan(value: unknown): StudioPlan | null {
  if (!isRecord(value) || value.version !== STUDIO_PLAN_VERSION) return null;
  if (
    !validShortString(value.id, 256)
    || !validShortString(value.gameId, 96)
    || !validShortString(value.gameName, 120)
    || !validShortString(value.gameEmoji, 12)
    || !validShortString(value.category, 80)
    || !STUDIO_GOALS.includes(value.goal as StudioGoal)
    || !STUDIO_DURATIONS.includes(value.duration as StudioDuration)
    || !DIFFICULTIES.includes(value.difficulty as Difficulty)
    || typeof value.practiceAvailable !== 'boolean'
    || typeof value.createdAt !== 'number'
    || !Number.isFinite(value.createdAt)
    || value.createdAt < 0
    || !Array.isArray(value.steps)
    || value.steps.length !== STAGES.length
  ) return null;
  const rawSteps = value.steps as unknown[];
  const steps = STAGES.map((stage, index) => parseStep(rawSteps[index], stage));
  if (steps.some((step) => !step)) return null;
  const duration = value.duration as StudioDuration;
  if (steps.reduce((sum, step) => sum + (step?.minutes ?? 0), 0) !== duration) return null;
  return {
    version: STUDIO_PLAN_VERSION,
    id: value.id,
    createdAt: Math.floor(value.createdAt),
    gameId: value.gameId,
    gameName: value.gameName,
    gameEmoji: value.gameEmoji,
    category: value.category,
    goal: value.goal as StudioGoal,
    duration,
    difficulty: value.difficulty as Difficulty,
    practiceAvailable: value.practiceAvailable,
    steps: steps as StudioPlanStep[],
  };
}

export function parseStudioPlans(raw: string | null): StudioPlan[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.plans)
        ? parsed.plans
        : [];
    const plans: StudioPlan[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates.slice(0, MAX_STUDIO_PLANS * 8)) {
      const plan = parsePlan(candidate);
      if (!plan || seen.has(plan.id)) continue;
      seen.add(plan.id);
      plans.push(plan);
    }
    return plans
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_STUDIO_PLANS);
  } catch {
    return [];
  }
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadStudioPlans(storage: StorageLike | null = browserStorage()): StudioPlan[] {
  if (!storage) return [];
  try {
    return parseStudioPlans(storage.getItem(STUDIO_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveStudioPlan(
  plan: StudioPlan,
  storage: StorageLike | null = browserStorage(),
): StudioPlan[] {
  const current = storage ? loadStudioPlans(storage) : [];
  const next = [plan, ...current.filter((item) => item.id !== plan.id)]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_STUDIO_PLANS);
  if (storage) {
    try {
      storage.setItem(STUDIO_STORAGE_KEY, JSON.stringify({ version: STUDIO_PLAN_VERSION, plans: next }));
    } catch {
      // A full or unavailable store must not make the planner unusable.
    }
  }
  return next;
}

function matchSourceId(plan: StudioPlan, href: string): string {
  const query = href.split('?')[1] ?? '';
  const requested = new URLSearchParams(query).get('difficulty');
  const difficulty = DIFFICULTIES.includes(requested as Difficulty)
    ? requested
    : plan.difficulty;
  return `match:${plan.gameId}:${difficulty}`;
}

export function missionTargetsForStudioPlan(plan: StudioPlan): MissionTarget[] {
  return plan.steps.map((step): MissionTarget => {
    switch (step.stage) {
      case 'observe':
        return step.href.startsWith('/reviews')
          ? { stage: step.stage, kind: 'review_opened', sourceId: `review:${plan.gameId}`, href: step.href }
          : { stage: step.stage, kind: 'match_completed', sourceId: matchSourceId(plan, step.href), href: step.href };
      case 'learn':
        return { stage: step.stage, kind: 'lesson_completed', sourceId: `course:${plan.gameId}`, href: step.href };
      case 'practice':
        return step.href.startsWith('/play/')
          ? { stage: step.stage, kind: 'match_completed', sourceId: matchSourceId(plan, step.href), href: step.href }
          : { stage: step.stage, kind: 'puzzle_solved', sourceId: `puzzle:${plan.gameId}`, href: step.href };
      case 'play':
        return { stage: step.stage, kind: 'match_completed', sourceId: matchSourceId(plan, step.href), href: step.href };
      case 'reflect':
        return { stage: step.stage, kind: 'reflection_completed', sourceId: `reflection:${plan.gameId}:after-play`, href: step.href };
    }
  });
}
