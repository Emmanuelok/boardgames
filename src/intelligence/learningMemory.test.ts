import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEARNING_MEMORY_STORAGE_KEY,
  MAX_LEARNING_EVENTS,
  MISSION_STAGES,
  activateMissionData,
  createLearningMemoryData,
  createLearningMission,
  mergeLearningMemoryData,
  parseLearningMemory,
  reduceLearningEvent,
  startMissionData,
  useLearningMemory,
  type ActiveLearningMission,
  type LearningEvent,
  type LearningEventKind,
  type LearningMemoryData,
  type MissionStage,
  type MissionTarget,
} from './learningMemory';

const KIND_BY_STAGE: Record<MissionStage, LearningEventKind> = {
  observe: 'review_opened',
  learn: 'lesson_completed',
  practice: 'puzzle_solved',
  play: 'match_completed',
  reflect: 'reflection_completed',
};

function targets(gameId = 'chess'): MissionTarget[] {
  return MISSION_STAGES.map((stage) => ({
    stage,
    kind: KIND_BY_STAGE[stage],
    sourceId: `${gameId}:${stage}`,
    href: `/${stage}/${gameId}`,
  }));
}

function mission(id = 'mission-1', gameId = 'chess'): ActiveLearningMission {
  return createLearningMission({
    id,
    gameId,
    createdAt: 100,
    targets: targets(gameId),
  });
}

function event(
  stage: MissionStage,
  id = `event-${stage}`,
  overrides: Partial<LearningEvent> = {},
): LearningEvent {
  return {
    id,
    at: 101,
    kind: KIND_BY_STAGE[stage],
    missionId: 'mission-1',
    gameId: 'chess',
    stage,
    sourceId: `chess:${stage}`,
    outcome: 'complete',
    ...overrides,
  };
}

function withMission(value = mission()): LearningMemoryData {
  return startMissionData(createLearningMemoryData(), value);
}

describe('learning mission creation and start', () => {
  it('creates the five ordered stages with Observe active', () => {
    const created = mission();
    expect(created.status).toBe('active');
    expect(created.currentStage).toBe('observe');
    expect(created.steps.map((step) => step.stage)).toEqual(MISSION_STAGES);
    expect(created.steps.map((step) => step.status)).toEqual([
      'active',
      'locked',
      'locked',
      'locked',
      'locked',
    ]);
  });

  it('preserves an existing active mission instead of replacing it', () => {
    const first = withMission();
    const second = mission('mission-2', 'go');
    const result = startMissionData(first, second);

    expect(result).toBe(first);
    expect(result.activeMission?.id).toBe('mission-1');
  });

  it('allows a completed mission to be replaced', () => {
    let data = withMission();
    for (const stage of MISSION_STAGES) data = reduceLearningEvent(data, event(stage));
    expect(data.activeMission?.status).toBe('complete');

    const result = startMissionData(data, mission('mission-2', 'go'));
    expect(result.activeMission?.id).toBe('mission-2');
    expect(result.activeMission?.currentStage).toBe('observe');
  });

  it('replaces an active route only through explicit activation and keeps evidence', () => {
    let first = withMission();
    first = reduceLearningEvent(first, event('observe', 'preserved-evidence'));
    const result = activateMissionData(first, mission('studio-route', 'go'));

    expect(result.activeMission?.id).toBe('studio-route');
    expect(result.activeMission?.currentStage).toBe('observe');
    expect(result.events.map((item) => item.id)).toContain('preserved-evidence');
  });
});

describe('learning event reduction', () => {
  it('requires exact mission, game, current stage, event kind, source, and timestamp', () => {
    let data = withMission();
    const rejected: LearningEvent[] = [
      event('observe', 'wrong-mission', { missionId: 'mission-other' }),
      event('observe', 'wrong-game', { gameId: 'go' }),
      event('learn', 'wrong-stage'),
      event('observe', 'wrong-kind', { kind: 'lesson_completed' }),
      event('observe', 'wrong-source', { sourceId: 'chess:some-other-review' }),
      event('observe', 'stale-event', { at: 99 }),
    ];

    for (const evidence of rejected) {
      data = reduceLearningEvent(data, evidence);
      expect(data.activeMission?.currentStage).toBe('observe');
    }
    // The early Learn event is discarded so its deterministic id can be used
    // when Learn is actually active; other non-matching evidence is retained.
    expect(data.events).toHaveLength(rejected.length - 1);

    data = reduceLearningEvent(data, event('observe', 'exact'));
    expect(data.activeMission?.currentStage).toBe('learn');
    expect(data.activeMission?.steps[0]).toMatchObject({
      status: 'complete',
      evidenceEventId: 'exact',
    });
  });

  it('records attempts and failures without completing a stage', () => {
    let data = withMission();
    data = reduceLearningEvent(data, event('observe'));
    data = reduceLearningEvent(data, event('learn'));
    expect(data.activeMission?.currentStage).toBe('practice');

    data = reduceLearningEvent(data, event('practice', 'attempt', {
      kind: 'puzzle_attempted',
      outcome: 'success',
    }));
    expect(data.activeMission?.currentStage).toBe('practice');

    data = reduceLearningEvent(data, event('practice', 'failed', {
      outcome: 'failed',
    }));
    expect(data.activeMission?.currentStage).toBe('practice');

    data = reduceLearningEvent(data, event('practice', 'solved', {
      outcome: 'success',
    }));
    expect(data.activeMission?.currentStage).toBe('play');
  });

  it('is idempotent by event id', () => {
    const start = withMission();
    const evidence = event('observe', 'same-event');
    const once = reduceLearningEvent(start, evidence);
    const twice = reduceLearningEvent(once, evidence);

    expect(twice).toBe(once);
    expect(twice.events).toHaveLength(1);
    expect(twice.activeMission?.currentStage).toBe('learn');
  });

  it('discards early evidence and accepts that id once its stage becomes active', () => {
    let data = withMission();
    const earlyLearn = event('learn', 'early-learn');
    data = reduceLearningEvent(data, earlyLearn);
    expect(data.activeMission?.currentStage).toBe('observe');
    expect(data.events).toHaveLength(0);

    data = reduceLearningEvent(data, event('observe'));
    expect(data.activeMission?.currentStage).toBe('learn');

    data = reduceLearningEvent(data, earlyLearn);
    expect(data.activeMission?.currentStage).toBe('practice');
    expect(data.events.at(-1)?.id).toBe('early-learn');
  });

  it('completes the mission only after Reflect completes', () => {
    let data = withMission();
    for (let index = 0; index < MISSION_STAGES.length; index += 1) {
      const stage = MISSION_STAGES[index];
      data = reduceLearningEvent(data, event(stage));
      if (stage !== 'reflect') {
        expect(data.activeMission?.status).toBe('active');
        expect(data.activeMission?.currentStage).toBe(MISSION_STAGES[index + 1]);
      }
    }

    expect(data.activeMission?.status).toBe('complete');
    expect(data.activeMission?.currentStage).toBeNull();
    expect(data.activeMission?.steps.every((step) => step.status === 'complete')).toBe(true);
  });

  it('caps retained events at the newest 300', () => {
    let data = createLearningMemoryData();
    for (let index = 0; index < MAX_LEARNING_EVENTS + 5; index += 1) {
      data = reduceLearningEvent(data, event('observe', `event-${index}`, {
        missionId: 'unrelated-mission',
        at: 1_000 + index,
      }));
    }

    expect(data.events).toHaveLength(MAX_LEARNING_EVENTS);
    expect(data.events[0].id).toBe('event-5');
    expect(data.events.at(-1)?.id).toBe(`event-${MAX_LEARNING_EVENTS + 4}`);
  });

  it('merges cross-tab snapshots without regressing mission progress or losing events', () => {
    let local = withMission();
    local = reduceLearningEvent(local, event('observe', 'local-observe'));
    const stale = withMission();
    const incoming = reduceLearningEvent(stale, event('observe', 'remote-wrong-source', {
      sourceId: 'unrelated',
    }));

    const merged = mergeLearningMemoryData(local, incoming);
    expect(merged.activeMission?.currentStage).toBe('learn');
    expect(merged.events.map((item) => item.id)).toEqual(
      expect.arrayContaining(['local-observe', 'remote-wrong-source']),
    );
  });
});

describe('learning memory persistence and migration', () => {
  beforeEach(() => {
    localStorage.clear();
    useLearningMemory.getState().reset();
  });

  it('persists the active mission and events, then refreshes them after an in-memory reset', () => {
    const started = useLearningMemory.getState().startMission(mission());
    expect(started.id).toBe('mission-1');
    expect(useLearningMemory.getState().recordEvent(event('observe', 'persisted-event'))).toBe(true);

    const persisted = JSON.parse(localStorage.getItem(LEARNING_MEMORY_STORAGE_KEY)!);
    expect(persisted.activeMission.currentStage).toBe('learn');
    expect(persisted.events).toHaveLength(1);

    useLearningMemory.setState({ activeMission: null, events: [] });
    useLearningMemory.getState().refreshFromStorage();
    expect(useLearningMemory.getState().activeMission?.currentStage).toBe('learn');
    expect(useLearningMemory.getState().events[0].id).toBe('persisted-event');
  });

  it('keeps the persisted active mission when startMission is called again', () => {
    useLearningMemory.getState().startMission(mission());
    const returned = useLearningMemory.getState().startMission(mission('mission-2', 'go'));

    expect(returned.id).toBe('mission-1');
    expect(useLearningMemory.getState().activeMission?.id).toBe('mission-1');
    expect(JSON.parse(localStorage.getItem(LEARNING_MEMORY_STORAGE_KEY)!).activeMission.id).toBe('mission-1');
  });

  it('persists an explicitly activated Studio route without discarding evidence', () => {
    useLearningMemory.getState().startMission(mission());
    useLearningMemory.getState().recordEvent(event('observe', 'route-evidence'));
    useLearningMemory.getState().activateMission(mission('studio-route', 'go'));

    const persisted = JSON.parse(localStorage.getItem(LEARNING_MEMORY_STORAGE_KEY)!);
    expect(persisted.activeMission.id).toBe('studio-route');
    expect(persisted.events.map((item: LearningEvent) => item.id)).toContain('route-evidence');
  });

  it('returns safe empty data for corrupt or structurally invalid payloads', () => {
    expect(parseLearningMemory('{not-json')).toEqual(createLearningMemoryData());
    expect(parseLearningMemory(JSON.stringify({ activeMission: { id: 42 }, events: 'bad' })))
      .toEqual(createLearningMemoryData());

    localStorage.setItem(LEARNING_MEMORY_STORAGE_KEY, '{broken');
    useLearningMemory.getState().refreshFromStorage();
    expect(useLearningMemory.getState().activeMission).toBeNull();
    expect(useLearningMemory.getState().events).toEqual([]);
  });

  it('migrates a legacy mission payload, event aliases, and duplicate ids', () => {
    const legacyMission: any = JSON.parse(JSON.stringify(mission()));
    legacyMission.targets = legacyMission.steps.map((step: any) => {
      const target = { ...step.target };
      delete target.kind; // v0 inferred event kinds from the stage
      return target;
    });
    delete legacyMission.steps;
    delete legacyMission.currentStage;

    const legacyEvent = {
      id: 'legacy-event',
      timestamp: 101,
      kind: 'review_opened',
      mission: 'mission-1',
      game: 'chess',
      stage: 'observe',
      source: 'chess:observe',
      result: 'completed',
    };
    const parsed = parseLearningMemory(JSON.stringify({
      schemaVersion: 0,
      mission: legacyMission,
      events: [legacyEvent, { ...legacyEvent }, { id: 12 }],
    }));

    expect(parsed.version).toBe(1);
    expect(parsed.activeMission?.currentStage).toBe('observe');
    expect(parsed.activeMission?.steps.map((step) => step.target.kind)).toEqual([
      'review_opened',
      'lesson_completed',
      'puzzle_solved',
      'match_completed',
      'reflection_completed',
    ]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      id: 'legacy-event',
      at: 101,
      outcome: 'complete',
    });
  });

  it('refreshes from a matching storage event', () => {
    const incoming = startMissionData(createLearningMemoryData(), mission('from-other-tab'));
    window.dispatchEvent(new StorageEvent('storage', {
      key: LEARNING_MEMORY_STORAGE_KEY,
      newValue: JSON.stringify(incoming),
    }));

    expect(useLearningMemory.getState().activeMission?.id).toBe('from-other-tab');
  });
});
