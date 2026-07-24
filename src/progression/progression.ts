import { create } from 'zustand';

/**
 * Progression & economy store — the "chase": XP, levels, coins, daily quests,
 * cosmetic unlocks and the Pro feature flag.
 *
 * Deliberately standalone (imports only `zustand`) so it stays Node/SSR-safe and
 * unit-testable, and so {@link ../profile/profile} can call into it from
 * `recordResult` without creating an import cycle. Pure reward/level math is
 * exported separately from the store for direct testing.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Difficulty = 'tutor' | 'easy' | 'medium' | 'hard' | 'master';
export type ResultKind = 'win' | 'loss' | 'draw';

export interface Reward { xp: number; coins: number; }
/** A transient "you just earned…" payload the toast renders, then clears. */
export interface RewardFlash extends Reward { id: number; label: string; icon: string; levelUp?: number; }

export interface QuestDef { id: string; label: string; icon: string; goal: number; track: QuestTrack; reward: Reward; }
type QuestTrack = 'win' | 'distinct' | 'puzzle' | 'xp' | 'hardwin' | 'daily';
export interface QuestProgress { id: string; progress: number; claimed: boolean; }

export type CosmeticSlot = 'wallpaper' | 'title' | 'frame';
export interface Cosmetic { id: string; slot: CosmeticSlot; name: string; icon: string; price: number; value: string; pro?: boolean; }

// ─────────────────────────────────────────────────────────────────────────────
// Level curve (pure)
// ─────────────────────────────────────────────────────────────────────────────

/** Defensive ceilings for corrupted or manually edited browser storage. */
export const MAX_XP = 1_000_000_000;
export const MAX_COINS = 1_000_000_000;

function boundedCounter(value: unknown, max: number, fallback = 0): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

/** XP required to advance *from* `level` to `level + 1`. Gentle linear ramp. */
export function xpToNext(level: number): number { return 80 + Math.max(0, level - 1) * 45; }

/** Cumulative XP consumed after advancing `count` complete levels. */
function xpForCompletedLevels(count: number): number {
  return count * (45 * count + 115) / 2;
}

/** Resolve a cumulative XP total into a level and progress within that level. */
export function levelFromXp(total: number): { level: number; into: number; span: number } {
  const safeTotal = boundedCounter(total, MAX_XP);
  // Sum(80 + 45k, k=0..n-1) = n(45n + 115)/2. Solving that
  // quadratic avoids an attacker-controlled or corrupted-XP loop.
  let completed = Math.max(0, Math.floor((-115 + Math.sqrt(13_225 + 360 * safeTotal)) / 90));
  // Protect exact threshold values from floating-point rounding.
  while (completed > 0 && xpForCompletedLevels(completed) > safeTotal) completed--;
  while (xpForCompletedLevels(completed + 1) <= safeTotal) completed++;
  const level = completed + 1;
  return { level, into: safeTotal - xpForCompletedLevels(completed), span: xpToNext(level) };
}

/** Playful tier name for a level, for flair on the profile. */
export function levelTier(level: number): { name: string; icon: string } {
  if (level >= 40) return { name: 'Legend', icon: '🌟' };
  if (level >= 30) return { name: 'Grandmaster', icon: '👑' };
  if (level >= 20) return { name: 'Master', icon: '💎' };
  if (level >= 12) return { name: 'Expert', icon: '🔥' };
  if (level >= 6) return { name: 'Adept', icon: '⚔️' };
  return { name: 'Apprentice', icon: '🌱' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reward calculators (pure)
// ─────────────────────────────────────────────────────────────────────────────

const DIFF_MULT: Record<Difficulty, number> = { tutor: 0.8, easy: 1, medium: 1.3, hard: 1.7, master: 2.2 };

/** Learning progress never accelerates because of a purchase. */
export const PRO_BONUS = 0;

/**
 * Quest swaps are intentionally free. Kept as an exported zero for backwards
 * compatibility with older UI/tests that displayed a reroll cost.
 */
export const REROLL_COST = 0;

export function gameReward(result: ResultKind, difficulty: Difficulty): Reward {
  const baseXp = result === 'win' ? 50 : result === 'draw' ? 25 : 12;
  const baseCoins = result === 'win' ? 20 : result === 'draw' ? 10 : 5;
  const m = DIFF_MULT[difficulty] ?? 1;
  return { xp: Math.round(baseXp * m), coins: Math.round(baseCoins * m) };
}

export const DISCOVERY_REWARD: Reward = { xp: 40, coins: 25 };

/** Bonus for a clean game (only the generic engine path knows accuracy). */
export function accuracyBonus(acc: number): Reward {
  if (acc >= 95) return { xp: 30, coins: 10 };
  if (acc >= 85) return { xp: 15, coins: 5 };
  return { xp: 0, coins: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily quests (pure generation)
// ─────────────────────────────────────────────────────────────────────────────

export const QUEST_POOL: QuestDef[] = [
  { id: 'win2', label: 'Win 2 games', icon: '🏆', goal: 2, track: 'win', reward: { xp: 60, coins: 40 } },
  { id: 'play3', label: 'Play 3 different games', icon: '🎲', goal: 3, track: 'distinct', reward: { xp: 50, coins: 35 } },
  { id: 'puzzle3', label: 'Solve 3 puzzles', icon: '🧩', goal: 3, track: 'puzzle', reward: { xp: 50, coins: 35 } },
  { id: 'xp200', label: 'Earn 200 XP', icon: '⚡', goal: 200, track: 'xp', reward: { xp: 0, coins: 60 } },
  { id: 'hard1', label: 'Beat a Hard+ opponent', icon: '🔥', goal: 1, track: 'hardwin', reward: { xp: 80, coins: 50 } },
  { id: 'daily1', label: 'Complete the Daily Challenge', icon: '📅', goal: 1, track: 'daily', reward: { xp: 40, coins: 30 } },
];

/** Calendar key in the player's local timezone. Daily goals must not reset in
 * the late afternoon for players west of UTC. */
export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday-anchored local week key, e.g. "2026-06-15". */
export function weekStr(d = new Date()): string {
  const dt = new Date(d);
  dt.setHours(12, 0, 0, 0); // stable across DST boundaries
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return todayStr(dt);
}

/** Deterministic seeded pick of `n` quests from `pool`, stable for a given key. */
function seededPick(pool: QuestDef[], key: string, n: number): QuestDef[] {
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  const p = [...pool];
  const out: QuestDef[] = [];
  for (let i = 0; i < n && p.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out.push(p.splice(seed % p.length, 1)[0]);
  }
  return out;
}

/** Deterministically pick 3 daily quests for a date so they're stable all day. */
export function pickDailyQuests(dateStr: string): QuestDef[] { return seededPick(QUEST_POOL, dateStr, 3); }

/** Bigger, slower goals for the week — chunkier rewards, picked stably per week. */
export const WEEKLY_POOL: QuestDef[] = [
  { id: 'w-win10', label: 'Win 10 games', icon: '🏆', goal: 10, track: 'win', reward: { xp: 300, coins: 250 } },
  { id: 'w-play6', label: 'Play 6 different games', icon: '🎲', goal: 6, track: 'distinct', reward: { xp: 250, coins: 220 } },
  { id: 'w-puzzle12', label: 'Solve 12 puzzles', icon: '🧩', goal: 12, track: 'puzzle', reward: { xp: 250, coins: 220 } },
  { id: 'w-xp1500', label: 'Earn 1500 XP', icon: '⚡', goal: 1500, track: 'xp', reward: { xp: 0, coins: 300 } },
  { id: 'w-hard5', label: 'Beat 5 Hard+ opponents', icon: '🔥', goal: 5, track: 'hardwin', reward: { xp: 350, coins: 280 } },
  { id: 'w-daily4', label: 'Complete 4 Daily Challenges', icon: '📅', goal: 4, track: 'daily', reward: { xp: 300, coins: 250 } },
];

/** Deterministically pick 3 weekly quests for a week so they're stable all week. */
export function pickWeeklyQuests(weekKey: string): QuestDef[] { return seededPick(WEEKLY_POOL, weekKey, 3); }

// ─────────────────────────────────────────────────────────────────────────────
// Cosmetics catalogue
// ─────────────────────────────────────────────────────────────────────────────

export const COSMETICS: Cosmetic[] = [
  // wallpapers (value = ShaderField variant id consumed by the Home hero)
  { id: 'wp-aurora', slot: 'wallpaper', name: 'Aurora', icon: '🌌', price: 0, value: 'aurora' },
  { id: 'wp-lattice', slot: 'wallpaper', name: 'Lattice', icon: '🔷', price: 0, value: 'lattice' },
  { id: 'wp-liquid', slot: 'wallpaper', name: 'Liquid Glass', icon: '🌊', price: 300, value: 'liquid' },
  { id: 'wp-grid', slot: 'wallpaper', name: 'Neon Grid', icon: '🟪', price: 300, value: 'grid' },
  { id: 'wp-warp', slot: 'wallpaper', name: 'Warp', icon: '🌠', price: 600, value: 'warp', pro: true },
  { id: 'wp-crystal', slot: 'wallpaper', name: 'Crystal', icon: '🔮', price: 900, value: 'crystal', pro: true },
  // titles (value = the badge text shown on the profile)
  { id: 'ti-rookie', slot: 'title', name: 'Rookie', icon: '🔰', price: 0, value: 'Rookie' },
  { id: 'ti-tactician', slot: 'title', name: 'Tactician', icon: '🎯', price: 250, value: 'Tactician' },
  { id: 'ti-strategist', slot: 'title', name: 'Strategist', icon: '🧠', price: 500, value: 'Strategist' },
  { id: 'ti-legend', slot: 'title', name: 'Living Legend', icon: '🌟', price: 1200, value: 'Living Legend', pro: true },
  // avatar frames (value = a CSS accent colour for the ring)
  { id: 'fr-none', slot: 'frame', name: 'None', icon: '⚪', price: 0, value: '' },
  { id: 'fr-gold', slot: 'frame', name: 'Gold Ring', icon: '🟡', price: 400, value: '#f5c451' },
  { id: 'fr-emerald', slot: 'frame', name: 'Emerald Ring', icon: '🟢', price: 400, value: '#34d399' },
  { id: 'fr-mythic', slot: 'frame', name: 'Mythic Ring', icon: '🟣', price: 900, value: '#c084fc', pro: true },
];

export function cosmetic(id: string): Cosmetic | undefined { return COSMETICS.find((c) => c.id === id); }

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgressionState {
  xp: number;
  coins: number;
  seenGames: string[];
  owned: string[];
  equipped: Partial<Record<CosmeticSlot, string>>;
  pro: boolean;
  questDate: string;
  quests: QuestProgress[];
  xpToday: number;
  gamesToday: string[];
  weekKey: string;
  weekly: QuestProgress[];
  xpThisWeek: number;
  gamesThisWeek: string[];
  flash: RewardFlash | null;

  recordGame: (e: { gameId: string; result: ResultKind; difficulty: Difficulty }) => void;
  awardAccuracy: (acc: number) => void;
  recordPuzzle: (streak?: number) => void;
  recordDaily: (streak?: number) => void;
  recordLesson: (gameId: string) => void;
  awardAchievement: (title: string) => void;
  claimQuest: (id: string) => void;
  rerollQuest: (id: string) => boolean;
  buyCosmetic: (id: string) => boolean;
  equipCosmetic: (slot: CosmeticSlot, id: string) => void;
  setPro: (v: boolean) => void;
  clearFlash: () => void;
  reset: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'gm-progression';
const FREE_COSMETICS = COSMETICS.filter((c) => c.price === 0).map((c) => c.id);
const COSMETIC_IDS = new Set(COSMETICS.map((c) => c.id));
const MAX_STORED_IDS = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, maxItems = MAX_STORED_IDS): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 96) continue;
    unique.add(item);
    if (unique.size >= maxItems) break;
  }
  return [...unique];
}

function freshQuests(date: string): { questDate: string; quests: QuestProgress[]; xpToday: number; gamesToday: string[] } {
  return { questDate: date, quests: pickDailyQuests(date).map((q) => ({ id: q.id, progress: 0, claimed: false })), xpToday: 0, gamesToday: [] };
}

function freshWeekly(week: string): { weekKey: string; weekly: QuestProgress[]; xpThisWeek: number; gamesThisWeek: string[] } {
  return { weekKey: week, weekly: pickWeeklyQuests(week).map((q) => ({ id: q.id, progress: 0, claimed: false })), xpThisWeek: 0, gamesThisWeek: [] };
}

export type PersistShape = Pick<ProgressionState, 'xp' | 'coins' | 'seenGames' | 'owned' | 'equipped' | 'pro' | 'questDate' | 'quests' | 'xpToday' | 'gamesToday' | 'weekKey' | 'weekly' | 'xpThisWeek' | 'gamesThisWeek'>;

function fresh(now = new Date()): PersistShape {
  return {
    xp: 0,
    coins: 0,
    seenGames: [],
    owned: [...FREE_COSMETICS],
    equipped: { wallpaper: 'wp-aurora', title: 'ti-rookie', frame: 'fr-none' },
    pro: false,
    ...freshQuests(todayStr(now)),
    ...freshWeekly(weekStr(now)),
  };
}

function normalizeQuestList(value: unknown, pool: QuestDef[], fallback: QuestProgress[]): QuestProgress[] {
  const definitions = new Map(pool.map((def) => [def.id, def]));
  const normalized: QuestProgress[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isRecord(item) || typeof item.id !== 'string' || seen.has(item.id)) continue;
      const def = definitions.get(item.id);
      if (!def) continue;
      const progress = boundedCounter(item.progress, def.goal);
      normalized.push({ id: def.id, progress, claimed: item.claimed === true && progress >= def.goal });
      seen.add(def.id);
      if (normalized.length >= 3) break;
    }
  }
  for (const item of fallback) {
    if (normalized.length >= 3) break;
    if (!seen.has(item.id)) normalized.push({ ...item });
  }
  return normalized;
}

/**
 * Normalize persisted progression data without trusting its shape. Existing,
 * well-formed values are preserved; malformed counters and catalogue ids are
 * repaired before they can reach UI math.
 */
export function normalizeProgressionData(value: unknown, now = new Date()): PersistShape {
  const base = fresh(now);
  if (!isRecord(value)) return base;
  const today = todayStr(now);
  const week = weekStr(now);
  const dailyCurrent = value.questDate === today;
  const weeklyCurrent = value.weekKey === week;

  const owned = Array.from(new Set([
    ...FREE_COSMETICS,
    ...stringList(value.owned).filter((id) => COSMETIC_IDS.has(id)),
  ]));
  const equippedSource = isRecord(value.equipped) ? value.equipped : {};
  const equipped: PersistShape['equipped'] = { ...base.equipped };
  for (const slot of ['wallpaper', 'title', 'frame'] as const) {
    const id = equippedSource[slot];
    const item = typeof id === 'string' ? cosmetic(id) : undefined;
    if (item?.slot === slot && owned.includes(item.id)) equipped[slot] = item.id;
  }

  return {
    xp: boundedCounter(value.xp, MAX_XP),
    coins: boundedCounter(value.coins, MAX_COINS),
    seenGames: stringList(value.seenGames),
    owned,
    equipped,
    pro: value.pro === true,
    ...(dailyCurrent ? {
      questDate: today,
      quests: normalizeQuestList(value.quests, QUEST_POOL, base.quests),
      xpToday: boundedCounter(value.xpToday, MAX_XP),
      gamesToday: stringList(value.gamesToday, 128),
    } : freshQuests(today)),
    ...(weeklyCurrent ? {
      weekKey: week,
      weekly: normalizeQuestList(value.weekly, WEEKLY_POOL, base.weekly),
      xpThisWeek: boundedCounter(value.xpThisWeek, MAX_XP),
      gamesThisWeek: stringList(value.gamesThisWeek, 128),
    } : freshWeekly(week)),
  };
}

function load(): PersistShape {
  const base = fresh();
  if (typeof window === 'undefined' || !window.localStorage) return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProgressionData(JSON.parse(raw)) : base;
  } catch { return base; }
}

function save(s: ProgressionState): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const payload = normalizeProgressionData({
      xp: s.xp,
      coins: s.coins,
      seenGames: s.seenGames,
      owned: s.owned,
      equipped: s.equipped,
      pro: s.pro,
      questDate: s.questDate,
      quests: s.quests,
      xpToday: s.xpToday,
      gamesToday: s.gamesToday,
      weekKey: s.weekKey,
      weekly: s.weekly,
      xpThisWeek: s.xpThisWeek,
      gamesThisWeek: s.gamesThisWeek,
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reward application (pure-ish helpers over a state slice)
// ─────────────────────────────────────────────────────────────────────────────

let flashSeq = 1;

/** Roll the daily and weekly quest sets over when the day / week changes. */
function rollPeriods(s: ProgressionState): ProgressionState {
  let next = s;
  const today = todayStr();
  if (next.questDate !== today) next = { ...next, ...freshQuests(today) };
  const week = weekStr();
  if (next.weekKey !== week) next = { ...next, ...freshWeekly(week) };
  return next;
}

/** Advance any quests tracking `track` by `amount` (distinct uses absolute value). */
function bumpQuests(quests: QuestProgress[], track: QuestTrack, amount: number, absolute = false): QuestProgress[] {
  return quests.map((q) => {
    const def = questDef(q.id);
    if (!def || def.track !== track) return q;
    const progress = Math.min(def.goal, absolute ? amount : q.progress + amount);
    return { ...q, progress };
  });
}

export function questDef(id: string): QuestDef | undefined { return QUEST_POOL.find((d) => d.id === id) ?? WEEKLY_POOL.find((d) => d.id === id); }
export function questComplete(q: QuestProgress): boolean { const d = questDef(q.id); return !!d && q.progress >= d.goal; }

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useProgression = create<ProgressionState>()((set, get) => {
  /** Core mutation: grant a reward, advance the XP quest + daily counter, detect level-ups, raise a flash. */
  const grant = (reward: Reward, label: string, icon: string, countDaily = true) => {
    set((s) => {
      // Supporter status is cosmetic; learning rewards stay identical for all users.
      const mult = s.pro ? 1 + PRO_BONUS : 1;
      const gainedXp = boundedCounter(Math.round(Math.max(0, reward.xp) * mult), MAX_XP);
      const gainedCoins = boundedCounter(Math.round(Math.max(0, reward.coins) * mult), MAX_COINS);
      const currentXp = boundedCounter(s.xp, MAX_XP);
      const currentCoins = boundedCounter(s.coins, MAX_COINS);
      const before = levelFromXp(currentXp).level;
      const xp = Math.min(MAX_XP, currentXp + gainedXp);
      const after = levelFromXp(xp).level;
      const levelUp = after > before ? after : undefined;
      // Level-up pays a (flat) coin bonus and is the headline of the flash.
      const levelBonus = levelUp ? 25 * (levelUp - before) : 0;
      let next: ProgressionState = { ...s, xp, coins: Math.min(MAX_COINS, currentCoins + gainedCoins + levelBonus) };
      if (countDaily && gainedXp > 0) {
        const xpToday = Math.min(MAX_XP, boundedCounter(s.xpToday, MAX_XP) + gainedXp);
        const xpThisWeek = Math.min(MAX_XP, boundedCounter(s.xpThisWeek, MAX_XP) + gainedXp);
        next = { ...next, xpToday, xpThisWeek, quests: bumpQuests(s.quests, 'xp', xpToday, true), weekly: bumpQuests(s.weekly, 'xp', xpThisWeek, true) };
      }
      next.flash = { id: flashSeq++, xp: gainedXp, coins: gainedCoins + levelBonus, label, icon, levelUp };
      return next;
    });
    save(get());
  };

  return {
    ...load(),
    flash: null,

    recordGame({ gameId, result, difficulty }) {
      set((s) => rollPeriods(s));
      const s = get();
      const isNew = !s.seenGames.includes(gameId);
      const hard = difficulty === 'hard' || difficulty === 'master';
      const base = gameReward(result, difficulty);
      const total: Reward = isNew ? { xp: base.xp + DISCOVERY_REWARD.xp, coins: base.coins + DISCOVERY_REWARD.coins } : base;
      // Quest tracking (before granting, on the freshest slice) — daily + weekly.
      const gamesToday = s.gamesToday.includes(gameId) ? s.gamesToday : [...s.gamesToday, gameId];
      let quests = bumpQuests(s.quests, 'distinct', gamesToday.length, true);
      if (result === 'win') quests = bumpQuests(quests, 'win', 1);
      if (result === 'win' && hard) quests = bumpQuests(quests, 'hardwin', 1);
      const gamesThisWeek = s.gamesThisWeek.includes(gameId) ? s.gamesThisWeek : [...s.gamesThisWeek, gameId];
      let weekly = bumpQuests(s.weekly, 'distinct', gamesThisWeek.length, true);
      if (result === 'win') weekly = bumpQuests(weekly, 'win', 1);
      if (result === 'win' && hard) weekly = bumpQuests(weekly, 'hardwin', 1);
      set({ seenGames: isNew ? [...s.seenGames, gameId] : s.seenGames, gamesToday, quests, gamesThisWeek, weekly });
      grant(total, isNew ? `New game! ${result === 'win' ? 'Win' : 'Played'}` : result === 'win' ? 'Victory' : result === 'draw' ? 'Draw' : 'Game played', result === 'win' ? '🏆' : '🎮');
    },

    awardAccuracy(acc) {
      const bonus = accuracyBonus(acc);
      if (bonus.xp > 0) grant(bonus, acc >= 95 ? `Precision · ${Math.round(acc)}% accuracy` : `Sharp · ${Math.round(acc)}% accuracy`, '🎯');
    },

    recordPuzzle(streak = 0) {
      set((s) => rollPeriods(s));
      set((s) => ({ quests: bumpQuests(s.quests, 'puzzle', 1), weekly: bumpQuests(s.weekly, 'puzzle', 1) }));
      grant({ xp: 20 + Math.min(streak, 10) * 2, coins: 8 }, 'Puzzle solved', '🧩');
    },

    recordDaily(streak = 1) {
      set((s) => rollPeriods(s));
      set((s) => ({ quests: bumpQuests(s.quests, 'daily', 1), weekly: bumpQuests(s.weekly, 'daily', 1) }));
      grant({ xp: 60 + Math.min(streak, 8) * 5, coins: 30 }, `Daily Challenge · 🔥${streak}`, '📅');
    },

    recordLesson(gameId) {
      const key = `lesson:${gameId}`;
      const s = get();
      if (s.seenGames.includes(key)) return; // first completion only
      set({ seenGames: [...s.seenGames, key] });
      grant({ xp: 35, coins: 15 }, 'Lesson complete', '📖');
    },

    awardAchievement(title) {
      // Milestones (First Blood, Giant Slayer, …) pay into the chase too.
      grant({ xp: 75, coins: 60 }, `Achievement: ${title}`, '🏅');
    },

    claimQuest(id) {
      const s = get();
      const def = questDef(id);
      const inDaily = s.quests.some((x) => x.id === id);
      const q = (inDaily ? s.quests : s.weekly).find((x) => x.id === id);
      if (!q || !def || q.claimed || q.progress < def.goal) return;
      const mark = (list: QuestProgress[]) => list.map((x) => (x.id === id ? { ...x, claimed: true } : x));
      set(inDaily ? { quests: mark(s.quests) } : { weekly: mark(s.weekly) });
      grant(def.reward, `Quest: ${def.label}`, '✅', false);
    },

    rerollQuest(id) {
      const s = get();
      const cur = s.quests.find((x) => x.id === id);
      if (!cur || cur.claimed) return false;
      // Choose the next unused definition in catalogue order. A quest swap is a
      // transparent preference control, never a paid or chance-based mechanic.
      const inUse = new Set(s.quests.map((q) => q.id));
      const currentIndex = Math.max(0, QUEST_POOL.findIndex((definition) => definition.id === id));
      let pick: QuestDef | undefined;
      for (let offset = 1; offset <= QUEST_POOL.length; offset += 1) {
        const candidate = QUEST_POOL[(currentIndex + offset) % QUEST_POOL.length];
        if (!inUse.has(candidate.id)) {
          pick = candidate;
          break;
        }
      }
      if (!pick) return false;
      set({ quests: s.quests.map((q) => (q.id === id ? { id: pick.id, progress: 0, claimed: false } : q)) });
      save(get());
      return true;
    },

    buyCosmetic(id) {
      const c = cosmetic(id);
      const s = get();
      if (!c || s.owned.includes(id)) return false;
      if (c.pro && !s.pro) return false;
      if (s.coins < c.price) return false;
      set({ coins: s.coins - c.price, owned: [...s.owned, id] });
      save(get());
      return true;
    },

    equipCosmetic(slot, id) {
      const c = cosmetic(id);
      const s = get();
      if (!c || c.slot !== slot || !s.owned.includes(id)) return;
      set({ equipped: { ...s.equipped, [slot]: id } });
      // Equipping a wallpaper drives the Home hero, which reads this key on mount.
      if (slot === 'wallpaper') { try { localStorage.setItem('gm-wallpaper', c.value); } catch { /* ignore */ } }
      save(get());
    },

    setPro(v) {
      // Pro grants ownership of the whole cosmetic catalogue (kept on downgrade).
      set((s) => ({ pro: v, owned: v ? Array.from(new Set([...s.owned, ...COSMETICS.map((c) => c.id)])) : s.owned }));
      save(get());
    },
    clearFlash() { set({ flash: null }); },
    reset() { set({ ...fresh(), flash: null }); save(get()); },
  };
});
