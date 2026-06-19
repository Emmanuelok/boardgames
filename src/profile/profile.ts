import { create } from 'zustand';
import { useProgression } from '../progression/progression';

/**
 * Self-contained, localStorage-backed player profile + Elo rating system.
 *
 * This module is intentionally standalone: it imports nothing from the rest of
 * the app so it stays importable in Node/SSR without side effects. The only
 * runtime dependency is {@link create} from `zustand` (already a project dep).
 *
 * Persistence is manual (no `persist` middleware) to keep full control over the
 * shape we read/write and to mirror the plain-store style used elsewhere in the
 * codebase. Every mutation writes through {@link save}; the store hydrates once
 * from {@link STORAGE_KEY} when it is created.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type Difficulty = 'tutor' | 'easy' | 'medium' | 'hard' | 'master';
export type ResultKind = 'win' | 'loss' | 'draw';

export interface Tally {
  played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
}

export interface ProfileState {
  name: string;
  /** Overall Elo rating. */
  rating: number;
  /** Per-game tallies, keyed by game id. */
  stats: Record<string, Tally>;
  /** Aggregate tally across every game. */
  totals: Tally;
  /** Unlocked achievement ids. */
  achievements: string[];
  /** Most recently unlocked achievement id, for a toast; null when nothing new. */
  lastUnlocked: string | null;
  /** Difficulties the player has beaten at least once (for "Giant Slayer" etc.). */
  beatenDifficulties: Difficulty[];

  // actions
  setName: (name: string) => void;
  recordResult: (gameId: string, result: ResultKind, difficulty: Difficulty) => void;
  clearLastUnlocked: () => void;
  reset: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Elo
// ─────────────────────────────────────────────────────────────────────────────

/** K-factor for the Elo update. */
const K = 32;
/** Lowest possible rating. */
const RATING_FLOOR = 100;
/** Starting rating for a fresh profile. */
const DEFAULT_RATING = 800;

/** Notional opponent strength by difficulty, used as the Elo opponent rating. */
export const OPPONENT_RATING: Record<Difficulty, number> = {
  tutor: 900,
  easy: 600,
  medium: 1000,
  hard: 1400,
  master: 1800,
};

/** Score awarded for a result, from the player's perspective. */
const SCORE: Record<ResultKind, number> = { win: 1, draw: 0.5, loss: 0 };

/**
 * Standard Elo update. Returns the new rating, rounded and floored.
 * @param rating   the player's current rating
 * @param opponent the opponent's rating
 * @param score    actual score (1 win / 0.5 draw / 0 loss)
 */
function nextRating(rating: number, opponent: number, score: number): number {
  const expected = 1 / (1 + Math.pow(10, (opponent - rating) / 400));
  const updated = rating + K * (score - expected);
  return Math.max(RATING_FLOOR, Math.round(updated));
}

// ─────────────────────────────────────────────────────────────────────────────
// Rank labels
// ─────────────────────────────────────────────────────────────────────────────

/** Human-readable rank label for a rating. */
export function ratingTitle(rating: number): string {
  if (rating < 600) return 'Novice';
  if (rating < 900) return 'Casual';
  if (rating < 1200) return 'Club';
  if (rating < 1500) return 'Expert';
  if (rating < 1800) return 'Master';
  return 'Grandmaster';
}

// ─────────────────────────────────────────────────────────────────────────────
// Achievements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Game-id → category map. Kept local so this module stays self-contained and
 * does not pull in the game engine at import time. Mirrors the `category`
 * field on each {@link GameDefinition} in the engine registry.
 */
const GAME_CATEGORY: Record<string, string> = {
  chess: 'Classic',
  xiangqi: 'Strategy',
  checkers: 'Classic',
  draughts: 'Classic',
  'nine-mens-morris': 'Classic',
  reversi: 'Strategy',
  'connect-four': 'Family',
  mancala: 'Family',
  go: 'Abstract',
  gomoku: 'Abstract',
  pente: 'Abstract',
  hex: 'Abstract',
  'tic-tac-toe': 'Family',
};

/** Every distinct category in the catalogue. */
const ALL_CATEGORIES: readonly string[] = ['Classic', 'Strategy', 'Abstract', 'Family'];

/** The unlockable catalogue, surfaced for badge grids / toasts. */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', title: 'First Blood', desc: 'Win your very first game.', icon: '🩸' },
  { id: 'beat-medium', title: 'Holding Your Own', desc: 'Beat a Medium opponent.', icon: '🛡️' },
  { id: 'beat-hard', title: 'Tough Customer', desc: 'Beat a Hard opponent.', icon: '🔥' },
  { id: 'beat-master', title: 'Giant Slayer', desc: 'Beat a Master opponent.', icon: '🗡️' },
  { id: 'win-10', title: 'On a Roll', desc: 'Win 10 games in total.', icon: '🎲' },
  { id: 'play-25', title: 'Dedicated', desc: 'Play 25 games in total.', icon: '⏳' },
  { id: 'polymath', title: 'Polymath', desc: 'Win in 5 different games.', icon: '🧠' },
  { id: 'flawless', title: 'Flawless Victory', desc: 'Win a game without a single blunder.', icon: '💎' },
  { id: 'expert', title: 'Expert', desc: 'Reach a rating of 1200.', icon: '⭐' },
  { id: 'rating-master', title: 'Master', desc: 'Reach a rating of 1600.', icon: '👑' },
  { id: 'all-rounder', title: 'All-Rounder', desc: 'Play a game from every category.', icon: '🌈' },
];

/** Number of distinct games the player has at least one win in. */
function distinctGamesWon(stats: Record<string, Tally>): number {
  let n = 0;
  for (const id in stats) if (stats[id].wins > 0) n += 1;
  return n;
}

/** Number of distinct categories the player has played at least once. */
function distinctCategoriesPlayed(stats: Record<string, Tally>): number {
  const seen = new Set<string>();
  for (const id in stats) {
    if (stats[id].played > 0) {
      const cat = GAME_CATEGORY[id];
      if (cat) seen.add(cat);
    }
  }
  return seen.size;
}

/**
 * The full set of achievement ids the profile currently satisfies. Pure: it
 * derives only from the persisted state, so it is order-independent and safe to
 * re-run on every result. `flawless` is left unsatisfiable for now (no blunder
 * tracking yet) — the hook is wired so it can light up later without a schema
 * change.
 */
function earnedAchievements(s: ProfileState): Set<string> {
  const earned = new Set<string>();
  if (s.totals.wins >= 1) earned.add('first-win');
  if (s.beatenDifficulties.includes('medium')) earned.add('beat-medium');
  if (s.beatenDifficulties.includes('hard')) earned.add('beat-hard');
  if (s.beatenDifficulties.includes('master')) earned.add('beat-master');
  if (s.totals.wins >= 10) earned.add('win-10');
  if (s.totals.played >= 25) earned.add('play-25');
  if (distinctGamesWon(s.stats) >= 5) earned.add('polymath');
  // 'flawless' — intentionally not computable yet; hook left for blunder tracking.
  if (s.rating >= 1200) earned.add('expert');
  if (s.rating >= 1600) earned.add('rating-master');
  if (distinctCategoriesPlayed(s.stats) >= ALL_CATEGORIES.length) earned.add('all-rounder');
  return earned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'gm-profile';

const emptyTally = (): Tally => ({ played: 0, wins: 0, losses: 0, draws: 0 });

/** A fresh, default profile (data fields only). */
function freshProfile(): Pick<
  ProfileState,
  'name' | 'rating' | 'stats' | 'totals' | 'achievements' | 'lastUnlocked' | 'beatenDifficulties'
> {
  return {
    name: 'You',
    rating: DEFAULT_RATING,
    stats: {},
    totals: emptyTally(),
    achievements: [],
    lastUnlocked: null,
    beatenDifficulties: [],
  };
}

type PersistShape = ReturnType<typeof freshProfile>;

/** Best-effort hydration from localStorage; never throws (SSR/Node-safe). */
function load(): PersistShape {
  const base = freshProfile();
  if (typeof window === 'undefined' || !window.localStorage) return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PersistShape> | null;
    if (!parsed || typeof parsed !== 'object') return base;

    // Re-normalise tallies so a partial/old payload can't produce NaN holes.
    const stats: Record<string, Tally> = {};
    if (parsed.stats && typeof parsed.stats === 'object') {
      for (const id in parsed.stats) {
        const t = parsed.stats[id] as Partial<Tally> | undefined;
        stats[id] = {
          played: Number(t?.played) || 0,
          wins: Number(t?.wins) || 0,
          losses: Number(t?.losses) || 0,
          draws: Number(t?.draws) || 0,
        };
      }
    }
    const totals: Tally = {
      played: Number(parsed.totals?.played) || 0,
      wins: Number(parsed.totals?.wins) || 0,
      losses: Number(parsed.totals?.losses) || 0,
      draws: Number(parsed.totals?.draws) || 0,
    };

    return {
      name: typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : base.name,
      rating: Number.isFinite(parsed.rating as number)
        ? Math.max(RATING_FLOOR, Math.round(parsed.rating as number))
        : base.rating,
      stats,
      totals,
      achievements: Array.isArray(parsed.achievements)
        ? parsed.achievements.filter((x): x is string => typeof x === 'string')
        : [],
      lastUnlocked: typeof parsed.lastUnlocked === 'string' ? parsed.lastUnlocked : null,
      beatenDifficulties: Array.isArray(parsed.beatenDifficulties)
        ? (parsed.beatenDifficulties.filter(
            (x): x is Difficulty =>
              x === 'tutor' || x === 'easy' || x === 'medium' || x === 'hard' || x === 'master',
          ) as Difficulty[])
        : [],
    };
  } catch {
    return base;
  }
}

/** Best-effort persist of the data fields; never throws. */
function save(s: ProfileState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const payload: PersistShape = {
      name: s.name,
      rating: s.rating,
      stats: s.stats,
      totals: s.totals,
      achievements: s.achievements,
      lastUnlocked: s.lastUnlocked,
      beatenDifficulties: s.beatenDifficulties,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* storage unavailable / quota — ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useProfile = create<ProfileState>()((set, get) => ({
  ...load(),

  setName(name) {
    set({ name });
    save(get());
  },

  recordResult(gameId, result, difficulty) {
    let unlocked: string[] = [];
    set((s) => {
      // 1. Elo update.
      const rating = nextRating(s.rating, OPPONENT_RATING[difficulty], SCORE[result]);

      // 2. Per-game tally + aggregate totals.
      const prev = s.stats[gameId] ?? emptyTally();
      const tally: Tally = {
        played: prev.played + 1,
        wins: prev.wins + (result === 'win' ? 1 : 0),
        losses: prev.losses + (result === 'loss' ? 1 : 0),
        draws: prev.draws + (result === 'draw' ? 1 : 0),
      };
      const stats = { ...s.stats, [gameId]: tally };
      const totals: Tally = {
        played: s.totals.played + 1,
        wins: s.totals.wins + (result === 'win' ? 1 : 0),
        losses: s.totals.losses + (result === 'loss' ? 1 : 0),
        draws: s.totals.draws + (result === 'draw' ? 1 : 0),
      };

      // 3. Track beaten difficulties (wins only).
      const beatenDifficulties =
        result === 'win' && !s.beatenDifficulties.includes(difficulty)
          ? [...s.beatenDifficulties, difficulty]
          : s.beatenDifficulties;

      // 4. Evaluate achievements against the *updated* snapshot.
      const updated: ProfileState = { ...s, rating, stats, totals, beatenDifficulties };
      const earned = earnedAchievements(updated);
      const have = new Set(s.achievements);
      const newlyUnlocked = [...earned].filter((id) => !have.has(id));
      const achievements = newlyUnlocked.length > 0 ? [...s.achievements, ...newlyUnlocked] : s.achievements;
      const lastUnlocked = newlyUnlocked.length > 0 ? newlyUnlocked[newlyUnlocked.length - 1] : null;
      unlocked = newlyUnlocked;

      return { rating, stats, totals, beatenDifficulties, achievements, lastUnlocked };
    });
    save(get());
    // Feed the progression economy (XP, coins, quests) and pay out any achievement
    // this result unlocked. Decoupled + best-effort.
    try {
      const prog = useProgression.getState();
      prog.recordGame({ gameId, result, difficulty });
      for (const id of unlocked) {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (a) prog.awardAchievement(a.title);
      }
    } catch { /* ignore */ }
  },

  clearLastUnlocked() {
    set({ lastUnlocked: null });
    save(get());
  },

  reset() {
    set({ ...freshProfile() });
    save(get());
  },
}));
