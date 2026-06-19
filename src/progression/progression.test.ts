import { describe, it, expect, beforeEach } from 'vitest';
import {
  xpToNext, levelFromXp, levelTier, gameReward, accuracyBonus,
  pickDailyQuests, pickWeeklyQuests, questDef, useProgression, COSMETICS, cosmetic, PRO_BONUS, REROLL_COST,
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

describe('weekly quests', () => {
  it('picks 3 distinct weekly quests deterministically per week', () => {
    const a = pickWeeklyQuests('2026-06-15');
    const b = pickWeeklyQuests('2026-06-15');
    expect(a).toHaveLength(3);
    expect(new Set(a.map((q) => q.id)).size).toBe(3);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
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

  it('awards a finished course once, then never again', () => {
    expect(useProgression.getState().xp).toBe(0);
    useProgression.getState().recordLesson('chess');
    expect(useProgression.getState().xp).toBe(35);
    useProgression.getState().recordLesson('chess'); // repeat is a no-op
    expect(useProgression.getState().xp).toBe(35);
  });

  it('applies the Pro bonus to every earn', () => {
    // Park XP exactly at a level start so a small gain can't add a level-up coin bonus.
    useProgression.setState({ xp: 2340, coins: 0, seenGames: ['chess'], pro: true });
    useProgression.getState().recordGame({ gameId: 'chess', result: 'win', difficulty: 'easy' }); // base 50 XP / 20 coins
    expect(useProgression.getState().coins).toBe(Math.round(20 * (1 + PRO_BONUS))); // 24
    expect(useProgression.getState().xp).toBe(2340 + Math.round(50 * (1 + PRO_BONUS))); // +60, no level-up
  });

  it('offers two free wallpapers, owned from the start', () => {
    const freeWallpapers = COSMETICS.filter((c) => c.slot === 'wallpaper' && c.price === 0).map((c) => c.id).sort();
    expect(freeWallpapers).toEqual(['wp-aurora', 'wp-lattice']);
    const owned = useProgression.getState().owned;
    expect(owned).toContain('wp-aurora');
    expect(owned).toContain('wp-lattice');
  });

  it('pays a flat bonus for unlocking an achievement', () => {
    useProgression.setState({ xp: 2340, coins: 0, pro: false }); // level start → no level-up coin bonus
    useProgression.getState().awardAchievement('First Blood');
    expect(useProgression.getState().coins).toBe(60);
    expect(useProgression.getState().xp).toBe(2340 + 75);
    expect(useProgression.getState().flash?.label).toContain('First Blood');
  });

  it('tracks weekly quests in parallel with daily, past the daily cap', () => {
    useProgression.setState({
      quests: [{ id: 'win2', progress: 0, claimed: false }],
      weekly: [{ id: 'w-win10', progress: 0, claimed: false }],
    });
    for (let i = 0; i < 3; i++) useProgression.getState().recordGame({ gameId: 'chess', result: 'win', difficulty: 'easy' });
    expect(useProgression.getState().quests.find((x) => x.id === 'win2')!.progress).toBe(2);   // daily caps at goal
    expect(useProgression.getState().weekly.find((x) => x.id === 'w-win10')!.progress).toBe(3); // weekly keeps counting
  });

  it('claims a completed weekly quest exactly once', () => {
    const reward = questDef('w-win10')!.reward;
    useProgression.setState({ weekly: [{ id: 'w-win10', progress: 10, claimed: false }], xp: 2340, coins: 0 });
    useProgression.getState().claimQuest('w-win10');
    expect(useProgression.getState().coins).toBe(reward.coins);
    expect(useProgression.getState().weekly.find((x) => x.id === 'w-win10')!.claimed).toBe(true);
    useProgression.getState().claimQuest('w-win10'); // no double-claim
    expect(useProgression.getState().coins).toBe(reward.coins);
  });

  it('rerolls a daily quest for coins, swapping it for a fresh one', () => {
    const before = useProgression.getState().quests.map((q) => q.id);
    useProgression.setState({ coins: 100 });
    expect(useProgression.getState().rerollQuest(before[0])).toBe(true);
    expect(useProgression.getState().coins).toBe(100 - REROLL_COST);
    const after = useProgression.getState().quests.map((q) => q.id);
    expect(after).not.toContain(before[0]); // swapped out
    expect(after).toHaveLength(3);
    expect(new Set(after).size).toBe(3);    // no duplicates
  });

  it('refuses to reroll without enough coins', () => {
    useProgression.setState({ coins: 10 });
    const id = useProgression.getState().quests[0].id;
    expect(useProgression.getState().rerollQuest(id)).toBe(false);
    expect(useProgression.getState().coins).toBe(10);
  });
});
