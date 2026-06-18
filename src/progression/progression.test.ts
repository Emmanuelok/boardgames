import { describe, it, expect, beforeEach } from 'vitest';
import {
  xpToNext, levelFromXp, levelTier, gameReward, accuracyBonus,
  pickDailyQuests, questDef, useProgression, COSMETICS, cosmetic,
} from './progression';

describe('level curve', () => {
  it('xpToNext ramps with level', () => {
    expect(xpToNext(1)).toBe(80);
    expect(xpToNext(2)).toBe(125);
    expect(xpToNext(3)).toBe(170);
  });

  it('levelFromXp is the inverse of the cumulative curve', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, span: 80 });
    expect(levelFromXp(79).level).toBe(1);
    expect(levelFromXp(80)).toMatchObject({ level: 2, into: 0 });
    // 80 (L1) + 125 (L2) = 205 → level 3 at 0 into
    expect(levelFromXp(205)).toMatchObject({ level: 3, into: 0 });
    expect(levelFromXp(210)).toMatchObject({ level: 3, into: 5 });
  });

  it('clamps negatives and gives playful tiers', () => {
    expect(levelFromXp(-50).level).toBe(1);
    expect(levelTier(1).name).toBe('Apprentice');
    expect(levelTier(40).name).toBe('Legend');
  });
});

describe('reward calculators', () => {
  it('scales game reward by result and difficulty', () => {
    expect(gameReward('win', 'easy')).toEqual({ xp: 50, coins: 20 });
    expect(gameReward('loss', 'easy')).toEqual({ xp: 12, coins: 5 });
    // master multiplier (2.2) on a win
    expect(gameReward('win', 'master')).toEqual({ xp: 110, coins: 44 });
    // a draw still pays out
    expect(gameReward('draw', 'medium').xp).toBeGreaterThan(0);
  });

  it('rewards accuracy only above thresholds', () => {
    expect(accuracyBonus(96).xp).toBe(30);
    expect(accuracyBonus(88).xp).toBe(15);
    expect(accuracyBonus(70)).toEqual({ xp: 0, coins: 0 });
  });
});

describe('daily quests', () => {
  it('picks 3 distinct quests deterministically per date', () => {
    const a = pickDailyQuests('2026-06-18');
    const b = pickDailyQuests('2026-06-18');
    const c = pickDailyQuests('2026-06-19');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((q) => q.id)).size).toBe(3);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id)); // stable within a day
    // Different day very likely yields a different set (not a hard guarantee, but holds here).
    expect(a.map((q) => q.id).join()).not.toBe(c.map((q) => q.id).join());
  });
});

describe('progression store', () => {
  beforeEach(() => { localStorage.clear(); useProgression.getState().reset(); });

  it('grants XP + coins on a game and flashes', () => {
    const s = useProgression.getState();
    s.recordGame({ gameId: 'chess', result: 'win', difficulty: 'easy' });
    const after = useProgression.getState();
    // 50 (win) + 40 (first-time discovery) = 90 XP → crosses into level 2.
    expect(after.xp).toBe(90);
    // coins: 20 (win) + 25 (discovery) + 25 (level-up bonus) = 70.
    expect(after.coins).toBe(70);
    expect(after.flash?.levelUp).toBe(2);
    expect(after.seenGames).toContain('chess');
  });

  it('only pays the discovery bonus once per game', () => {
    const s = useProgression.getState();
    s.recordGame({ gameId: 'go', result: 'loss', difficulty: 'easy' }); // 12 + 40 discovery
    const xp1 = useProgression.getState().xp;
    s.recordGame({ gameId: 'go', result: 'loss', difficulty: 'easy' }); // 12 only
    expect(useProgression.getState().xp).toBe(xp1 + 12);
  });

  it('advances a daily quest via gameplay and pays out exactly on claim', () => {
    const reward = questDef('win2')!.reward;
    useProgression.setState({ quests: [{ id: 'win2', progress: 0, claimed: false }] });
    useProgression.getState().recordGame({ gameId: 'chess', result: 'win', difficulty: 'easy' });
    useProgression.getState().recordGame({ gameId: 'go', result: 'win', difficulty: 'easy' });
    expect(useProgression.getState().quests.find((x) => x.id === 'win2')!.progress).toBe(2);
    // Park XP mid-level (300 → L3, +60 stays in L3) so the payout isn't padded by a level-up bonus.
    useProgression.setState({ xp: 300, coins: 0 });
    useProgression.getState().claimQuest('win2');
    expect(useProgression.getState().coins).toBe(reward.coins);
    expect(useProgression.getState().quests.find((x) => x.id === 'win2')!.claimed).toBe(true);
    // Double-claim is a no-op.
    useProgression.getState().claimQuest('win2');
    expect(useProgression.getState().coins).toBe(reward.coins);
  });

  it('buys and equips a cosmetic, enforcing affordability', () => {
    const liquid = cosmetic('wp-liquid')!;
    useProgression.setState({ coins: 100 });
    expect(useProgression.getState().buyCosmetic('wp-liquid')).toBe(false); // 100 < 300
    useProgression.setState({ coins: 1000 });
    expect(useProgression.getState().buyCosmetic('wp-liquid')).toBe(true);
    expect(useProgression.getState().coins).toBe(1000 - liquid.price);
    expect(useProgression.getState().owned).toContain('wp-liquid');
    useProgression.getState().equipCosmetic('wallpaper', 'wp-liquid');
    expect(useProgression.getState().equipped.wallpaper).toBe('wp-liquid');
    expect(localStorage.getItem('gm-wallpaper')).toBe(liquid.value);
  });

  it('blocks buying pro cosmetics until Pro, then Pro grants the catalogue', () => {
    useProgression.setState({ coins: 5000 });
    expect(useProgression.getState().buyCosmetic('wp-crystal')).toBe(false); // pro-locked
    useProgression.getState().setPro(true);
    const owned = useProgression.getState().owned;
    expect(useProgression.getState().pro).toBe(true);
    expect(COSMETICS.every((c) => owned.includes(c.id))).toBe(true);
  });

  it('persists across store re-hydration', () => {
    useProgression.getState().recordGame({ gameId: 'chess', result: 'win', difficulty: 'hard' });
    const xp = useProgression.getState().xp;
    expect(JSON.parse(localStorage.getItem('gm-progression')!).xp).toBe(xp);
  });
});
