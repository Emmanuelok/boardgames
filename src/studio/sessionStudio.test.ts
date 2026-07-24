import { describe, expect, it } from 'vitest';
import {
  buildStudioPlan,
  loadStudioPlans,
  MAX_STUDIO_PLANS,
  missionTargetsForStudioPlan,
  parseStudioPlans,
  saveStudioPlan,
  STUDIO_DURATIONS,
  STUDIO_STORAGE_KEY,
  type StudioGameSignal,
} from './sessionStudio';

const game: StudioGameSignal = {
  id: 'hex',
  name: 'Hex',
  emoji: '⬡',
  category: 'Abstract',
  depth: 4,
  practiceAvailable: true,
  hasReview: false,
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('Strategy Studio session planning', () => {
  it.each(STUDIO_DURATIONS)('builds a complete %i-minute learning loop', (duration) => {
    const plan = buildStudioPlan(game, 'planning', duration, 'hard', {
      id: `plan-${duration}`,
      createdAt: duration,
    });
    expect(plan.steps.map((step) => step.stage)).toEqual(['observe', 'learn', 'practice', 'play', 'reflect']);
    expect(plan.steps.reduce((total, step) => total + step.minutes, 0)).toBe(duration);
    expect(plan.steps[2].href).toBe('/puzzles?game=hex');
    expect(plan.steps[3].href).toBe('/play/hex?difficulty=hard');
  });

  it('falls back to a coached game when no authored practice position exists', () => {
    const plan = buildStudioPlan(
      { ...game, id: 'domineering', name: 'Domineering', practiceAvailable: false },
      'foundation',
      30,
      'master',
      { id: 'fallback', createdAt: 10 },
    );
    expect(plan.steps[2].title).toMatch(/live coaching/i);
    expect(plan.steps[2].href).toBe('/play/domineering?difficulty=hard');
  });

  it('maps every stage to exact evidence producers', () => {
    const plan = buildStudioPlan({ ...game, hasReview: true }, 'tactics', 30, 'medium', {
      id: 'targets',
      createdAt: 20,
    });
    expect(missionTargetsForStudioPlan(plan)).toEqual([
      { stage: 'observe', kind: 'review_opened', sourceId: 'review:hex', href: '/reviews' },
      { stage: 'learn', kind: 'lesson_completed', sourceId: 'course:hex', href: '/learn/hex' },
      { stage: 'practice', kind: 'puzzle_solved', sourceId: 'puzzle:hex', href: '/puzzles?game=hex' },
      { stage: 'play', kind: 'match_completed', sourceId: 'match:hex:medium', href: '/play/hex?difficulty=medium' },
      { stage: 'reflect', kind: 'reflection_completed', sourceId: 'reflection:hex:after-play', href: '/reviews' },
    ]);
  });

  it('persists newest plans first, deduplicates, and caps history', () => {
    const storage = memoryStorage();
    for (let index = 0; index < MAX_STUDIO_PLANS + 3; index += 1) {
      saveStudioPlan(buildStudioPlan(game, 'exploration', 15, 'easy', {
        id: `plan-${index}`,
        createdAt: index,
      }), storage);
    }
    const plans = loadStudioPlans(storage);
    expect(plans).toHaveLength(MAX_STUDIO_PLANS);
    expect(plans[0].id).toBe(`plan-${MAX_STUDIO_PLANS + 2}`);
    expect(plans.at(-1)?.id).toBe('plan-3');
    expect(JSON.parse(storage.getItem(STUDIO_STORAGE_KEY) ?? '{}').version).toBe(1);
  });

  it('rejects malformed, unsafe, and partial stored values', () => {
    const good = buildStudioPlan(game, 'foundation', 15, 'tutor', {
      id: 'good',
      createdAt: 100,
    });
    const unsafe = {
      ...good,
      id: 'unsafe',
      steps: good.steps.map((step, index) => index === 1 ? { ...step, href: 'javascript:alert(1)' } : step),
    };
    expect(parseStudioPlans(JSON.stringify({ plans: [unsafe, good, null, { id: 'partial' }] })))
      .toEqual([good]);
    expect(parseStudioPlans('{bad json')).toEqual([]);
  });
});
