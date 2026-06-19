import { describe, it, expect, beforeEach } from 'vitest';
import { useProfile, ratingTitle } from './profile';
import { useProgression } from '../progression/progression';

// The profile store feeds the progression store on every result, so reset both.
const reset = () => { localStorage.clear(); useProfile.getState().reset(); useProgression.getState().reset(); };

describe('profile · Elo rating', () => {
  beforeEach(reset);

  it('raises rating on a win and lowers it on a loss', () => {
    const start = useProfile.getState().rating;
    useProfile.getState().recordResult('chess', 'win', 'medium');
    expect(useProfile.getState().rating).toBeGreaterThan(start);
    reset();
    useProfile.getState().recordResult('chess', 'loss', 'medium');
    expect(useProfile.getState().rating).toBeLessThan(start);
  });

  it('never drops below the rating floor', () => {
    useProfile.setState({ rating: 110 });
    for (let i = 0; i < 40; i++) useProfile.getState().recordResult('chess', 'loss', 'master');
    expect(useProfile.getState().rating).toBeGreaterThanOrEqual(100);
  });

  it('labels ratings by band', () => {
    expect(ratingTitle(500)).toBe('Novice');
    expect(ratingTitle(1300)).toBe('Expert');
    expect(ratingTitle(2000)).toBe('Grandmaster');
  });
});

describe('profile · tallies', () => {
  beforeEach(reset);

  it('accumulates per-game and aggregate tallies', () => {
    const p = useProfile.getState();
    p.recordResult('chess', 'win', 'easy');
    p.recordResult('chess', 'loss', 'easy');
    p.recordResult('go', 'draw', 'easy');
    const s = useProfile.getState();
    expect(s.stats.chess).toMatchObject({ played: 2, wins: 1, losses: 1, draws: 0 });
    expect(s.stats.go).toMatchObject({ played: 1, draws: 1 });
    expect(s.totals).toMatchObject({ played: 3, wins: 1, losses: 1, draws: 1 });
  });
});

describe('profile · achievements', () => {
  beforeEach(reset);

  it('unlocks First Blood on the first win and tracks lastUnlocked', () => {
    useProfile.getState().recordResult('chess', 'win', 'easy');
    const s = useProfile.getState();
    expect(s.achievements).toContain('first-win');
    expect(s.lastUnlocked).toBe('first-win');
  });

  it('unlocks difficulty + volume milestones', () => {
    useProfile.getState().recordResult('chess', 'win', 'medium');
    expect(useProfile.getState().achievements).toContain('beat-medium');
    for (let i = 0; i < 10; i++) useProfile.getState().recordResult('chess', 'win', 'easy');
    expect(useProfile.getState().achievements).toContain('win-10');
  });

  it('unlocks Polymath after winning five different games', () => {
    for (const g of ['chess', 'go', 'gomoku', 'hex', 'reversi']) useProfile.getState().recordResult(g, 'win', 'easy');
    expect(useProfile.getState().achievements).toContain('polymath');
  });

  it('unlocks All-Rounder after playing every category', () => {
    // chess=Classic, reversi=Strategy, go=Abstract, connect-four=Family
    for (const g of ['chess', 'reversi', 'go', 'connect-four']) useProfile.getState().recordResult(g, 'loss', 'easy');
    expect(useProfile.getState().achievements).toContain('all-rounder');
  });
});

describe('profile · progression hook', () => {
  beforeEach(reset);

  it('feeds the progression economy and pays an achievement bonus', () => {
    useProfile.getState().recordResult('chess', 'win', 'easy');
    const prog = useProgression.getState();
    expect(prog.seenGames).toContain('chess'); // recordGame fired
    // First-win achievement paid its bonus on top of the game reward.
    expect(prog.coins).toBeGreaterThan(0);
    expect(prog.xp).toBeGreaterThan(0);
  });
});
