import { create } from 'zustand';

export const LEARNING_MEMORY_STORAGE_KEY = 'gm-learning-v1';
export const LEARNING_MEMORY_VERSION = 1 as const;
export const MAX_LEARNING_EVENTS = 300;

export const MISSION_STAGES = ['observe', 'learn', 'practice', 'play', 'reflect'] as const;
export type MissionStage = (typeof MISSION_STAGES)[number];

export const LEARNING_EVENT_KINDS = [
  'lesson_completed',
  'puzzle_attempted',
  'puzzle_solved',
  'match_completed',
  'review_opened',
  'reflection_completed',
] as const;
export type LearningEventKind = (typeof LEARNING_EVENT_KINDS)[number];

export type LearningEventOutcome = 'success' | 'failed' | 'complete';
export type MissionStepStatus = 'locked' | 'active' | 'complete';

/**
 * The exact piece of evidence a mission stage expects. `sourceId` is deliberately
 * opaque: it can identify a lesson, puzzle, match session, review, or review
 * moment without coupling this store to any one feature.
 */
export interface MissionTarget {
  stage: MissionStage;
  kind: LearningEventKind;
  sourceId: string;
  href?: string;
}

export interface MissionStep {
  stage: MissionStage;
  target: MissionTarget;
  status: MissionStepStatus;
  completedAt?: number;
  evidenceEventId?: string;
}

export interface ActiveLearningMission {
  id: string;
  gameId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'complete';
  currentStage: MissionStage | null;
  steps: MissionStep[];
}

export interface LearningEvent {
  id: string;
  at: number;
  kind: LearningEventKind;
  missionId: string;
  gameId: string;
  stage: MissionStage;
  sourceId: string;
  outcome?: LearningEventOutcome;
}

export interface CreateLearningMissionInput {
  id: string;
  gameId: string;
  targets: readonly MissionTarget[];
  createdAt?: number;
}

export interface LearningMemoryData {
  version: typeof LEARNING_MEMORY_VERSION;
  activeMission: ActiveLearningMission | null;
  events: LearningEvent[];
}

export interface LearningMemoryState extends LearningMemoryData {
  /**
   * Starts a mission unless one is already active. A completed mission may be
   * replaced; an in-progress mission is always preserved.
   */
  startMission: (mission: ActiveLearningMission) => ActiveLearningMission;
  /**
   * Explicitly activates a newly authored route. Existing evidence is retained,
   * while the previous in-progress route is replaced by the learner's choice.
   */
  activateMission: (mission: ActiveLearningMission) => ActiveLearningMission;
  /**
   * Records a unique event and returns whether it was accepted. An accepted
   * event may still be unrelated evidence and therefore not advance the mission.
   */
  recordEvent: (event: LearningEvent) => boolean;
  refreshFromStorage: () => void;
  reset: () => void;
}

const MISSION_STAGE_SET = new Set<string>(MISSION_STAGES);
const EVENT_KIND_SET = new Set<string>(LEARNING_EVENT_KINDS);

const DEFAULT_KIND_BY_STAGE: Record<MissionStage, LearningEventKind> = {
  observe: 'review_opened',
  learn: 'lesson_completed',
  practice: 'puzzle_solved',
  play: 'match_completed',
  reflect: 'reflection_completed',
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 256 ? id : null;
}

function finiteTimestamp(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function isMissionStage(value: unknown): value is MissionStage {
  return typeof value === 'string' && MISSION_STAGE_SET.has(value);
}

function isLearningEventKind(value: unknown): value is LearningEventKind {
  return typeof value === 'string' && EVENT_KIND_SET.has(value);
}

function normaliseOutcome(value: unknown): LearningEventOutcome | undefined {
  if (value === 'success' || value === 'complete' || value === 'failed') return value;
  // Legacy aliases accepted only at the persistence/runtime boundary.
  if (value === 'completed') return 'complete';
  if (value === 'failure') return 'failed';
  return undefined;
}

function normaliseTarget(value: unknown, fallbackStage?: MissionStage): MissionTarget | null {
  const target = asRecord(value);
  if (!target) return null;
  const stage = isMissionStage(target.stage) ? target.stage : fallbackStage;
  if (!stage) return null;
  const sourceId = cleanId(target.sourceId) ?? cleanId(target.id) ?? cleanId(target.source);
  if (!sourceId) return null;
  const kind = isLearningEventKind(target.kind) ? target.kind : DEFAULT_KIND_BY_STAGE[stage];
  const href = typeof target.href === 'string' && target.href.length <= 2_048
    ? target.href
    : undefined;
  return { stage, kind, sourceId, ...(href ? { href } : {}) };
}

function normaliseEvent(value: unknown): LearningEvent | null {
  const event = asRecord(value);
  if (!event) return null;
  const id = cleanId(event.id);
  const missionId = cleanId(event.missionId) ?? cleanId(event.mission);
  const gameId = cleanId(event.gameId) ?? cleanId(event.game);
  const sourceId = cleanId(event.sourceId) ?? cleanId(event.source);
  const stage = isMissionStage(event.stage) ? event.stage : null;
  const kind = isLearningEventKind(event.kind) ? event.kind : null;
  if (!id || !missionId || !gameId || !sourceId || !stage || !kind) return null;
  const at = finiteTimestamp(event.at, finiteTimestamp(event.timestamp, 0));
  const outcome = normaliseOutcome(event.outcome ?? event.result);
  return {
    id,
    at,
    kind,
    missionId,
    gameId,
    stage,
    sourceId,
    ...(outcome ? { outcome } : {}),
  };
}

function targetForStage(
  sourceSteps: unknown[],
  sourceTargets: unknown,
  stage: MissionStage,
): { target: MissionTarget; rawStep: UnknownRecord | null } | null {
  const rawStep = sourceSteps
    .map(asRecord)
    .find((step) => step && (step.stage === stage || asRecord(step.target)?.stage === stage)) ?? null;

  const targetCollection = Array.isArray(sourceTargets) ? sourceTargets : [];
  const targetFromArray = targetCollection
    .map((target) => normaliseTarget(target))
    .find((target) => target?.stage === stage);
  const targetFromRecord = asRecord(sourceTargets)?.[stage];
  const rawTarget = rawStep?.target ?? targetFromArray ?? targetFromRecord;
  const target = normaliseTarget(rawTarget, stage);
  return target ? { target, rawStep } : null;
}

/**
 * Runtime-safe mission migration. Persisted v0 payloads used `mission`,
 * `targets`, and `completedStages`; all are accepted and normalised here.
 */
function normaliseMission(value: unknown): ActiveLearningMission | null {
  const mission = asRecord(value);
  if (!mission) return null;
  const id = cleanId(mission.id);
  const gameId = cleanId(mission.gameId) ?? cleanId(mission.game);
  if (!id || !gameId) return null;

  const createdAt = finiteTimestamp(mission.createdAt, finiteTimestamp(mission.startedAt, 0));
  const updatedAt = Math.max(
    createdAt,
    finiteTimestamp(mission.updatedAt, createdAt),
  );
  const sourceSteps = Array.isArray(mission.steps) ? mission.steps : [];
  const completedStages = new Set(
    Array.isArray(mission.completedStages)
      ? mission.completedStages.filter(isMissionStage)
      : [],
  );
  const legacyComplete = mission.status === 'complete' || mission.completed === true;

  const resolved = MISSION_STAGES.map((stage) => targetForStage(
    sourceSteps,
    mission.targets,
    stage,
  ));
  if (resolved.some((entry) => entry === null)) return null;

  let prefixIsComplete = true;
  const steps: MissionStep[] = resolved.map((entry, index) => {
    const stage = MISSION_STAGES[index];
    const rawStep = entry!.rawStep;
    const requestedComplete = legacyComplete
      || completedStages.has(stage)
      || rawStep?.status === 'complete';
    const isComplete = prefixIsComplete && requestedComplete;
    if (!isComplete) prefixIsComplete = false;

    const completedAt = isComplete
      ? finiteTimestamp(rawStep?.completedAt, updatedAt)
      : undefined;
    const evidenceEventId = isComplete
      ? cleanId(rawStep?.evidenceEventId) ?? undefined
      : undefined;
    return {
      stage,
      target: entry!.target,
      status: isComplete ? 'complete' : 'locked',
      ...(completedAt !== undefined ? { completedAt } : {}),
      ...(evidenceEventId ? { evidenceEventId } : {}),
    };
  });

  const firstIncomplete = steps.findIndex((step) => step.status !== 'complete');
  if (firstIncomplete >= 0) steps[firstIncomplete] = { ...steps[firstIncomplete], status: 'active' };
  const complete = firstIncomplete < 0;

  return {
    id,
    gameId,
    createdAt,
    updatedAt,
    status: complete ? 'complete' : 'active',
    currentStage: complete ? null : steps[firstIncomplete].stage,
    steps,
  };
}

/** Build a validated, ordered mission with Observe active and later stages locked. */
export function createLearningMission(input: CreateLearningMissionInput): ActiveLearningMission {
  const id = cleanId(input.id);
  const gameId = cleanId(input.gameId);
  if (!id || !gameId) throw new Error('A learning mission requires non-empty id and gameId values.');

  const byStage = new Map<MissionStage, MissionTarget>();
  for (const rawTarget of input.targets) {
    const target = normaliseTarget(rawTarget);
    if (!target) throw new Error('Every mission target requires a valid stage, event kind, and sourceId.');
    if (byStage.has(target.stage)) throw new Error(`Duplicate mission target for stage "${target.stage}".`);
    byStage.set(target.stage, target);
  }
  for (const stage of MISSION_STAGES) {
    if (!byStage.has(stage)) throw new Error(`Missing mission target for stage "${stage}".`);
  }

  const createdAt = finiteTimestamp(input.createdAt, Date.now());
  return {
    id,
    gameId,
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    currentStage: 'observe',
    steps: MISSION_STAGES.map((stage, index) => ({
      stage,
      target: byStage.get(stage)!,
      status: index === 0 ? 'active' : 'locked',
    })),
  };
}

/** Create an empty, schema-current data value without touching browser globals. */
export function createLearningMemoryData(): LearningMemoryData {
  return {
    version: LEARNING_MEMORY_VERSION,
    activeMission: null,
    events: [],
  };
}

/**
 * Pure mission start transition. An in-progress mission wins over a newly
 * proposed one so route mounts, StrictMode effects, and reloads cannot reset it.
 */
export function startMissionData(
  data: LearningMemoryData,
  proposedMission: ActiveLearningMission,
): LearningMemoryData {
  if (data.activeMission?.status === 'active') return data;
  const mission = normaliseMission(proposedMission);
  if (!mission) throw new Error('Cannot start an invalid learning mission.');
  return {
    ...data,
    version: LEARNING_MEMORY_VERSION,
    activeMission: mission,
  };
}

/**
 * Pure explicit route activation. Unlike {@link startMissionData}, this is only
 * used after a learner deliberately launches a new Studio blueprint.
 */
export function activateMissionData(
  data: LearningMemoryData,
  proposedMission: ActiveLearningMission,
): LearningMemoryData {
  const mission = normaliseMission(proposedMission);
  if (!mission) throw new Error('Cannot activate an invalid learning mission.');
  return {
    ...data,
    version: LEARNING_MEMORY_VERSION,
    activeMission: mission,
  };
}

function eventCompletesCurrentStage(
  mission: ActiveLearningMission,
  event: LearningEvent,
): boolean {
  if (mission.status !== 'active' || mission.currentStage === null) return false;
  if (event.kind === 'puzzle_attempted' || event.outcome === 'failed') return false;
  if (event.at < mission.createdAt) return false;
  if (
    event.missionId !== mission.id
    || event.gameId !== mission.gameId
    || event.stage !== mission.currentStage
  ) return false;

  const step = mission.steps.find((candidate) => candidate.stage === mission.currentStage);
  return !!step
    && step.status === 'active'
    && event.kind === step.target.kind
    && event.sourceId === step.target.sourceId;
}

function advanceMission(
  mission: ActiveLearningMission,
  event: LearningEvent,
): ActiveLearningMission {
  const currentIndex = mission.steps.findIndex((step) => step.stage === mission.currentStage);
  if (currentIndex < 0) return mission;

  const steps = mission.steps.map((step, index): MissionStep => {
    if (index === currentIndex) {
      return {
        ...step,
        status: 'complete',
        completedAt: event.at,
        evidenceEventId: event.id,
      };
    }
    if (index === currentIndex + 1) return { ...step, status: 'active' };
    return step;
  });
  const completedReflect = mission.currentStage === 'reflect';
  return {
    ...mission,
    updatedAt: Math.max(mission.updatedAt, event.at),
    status: completedReflect ? 'complete' : 'active',
    currentStage: completedReflect ? null : MISSION_STAGES[currentIndex + 1] ?? null,
    steps,
  };
}

/**
 * Pure event reducer. Every unique, valid event is retained (up to the cap),
 * while mission progress changes only for exact, ordered target evidence.
 */
export function reduceLearningEvent(
  data: LearningMemoryData,
  proposedEvent: LearningEvent,
): LearningMemoryData {
  const event = normaliseEvent(proposedEvent);
  if (!event || data.events.some((existing) => existing.id === event.id)) return data;

  const mission = data.activeMission;
  // Do not retain evidence submitted early for this mission. Otherwise a
  // deterministic producer id could be consumed while the stage is locked and
  // then be rejected as a duplicate when that stage actually becomes active.
  if (
    mission?.status === 'active'
    && event.missionId === mission.id
    && event.gameId === mission.gameId
    && event.stage !== mission.currentStage
  ) return data;

  const events = [...data.events, event].slice(-MAX_LEARNING_EVENTS);
  const activeMission = mission && eventCompletesCurrentStage(mission, event)
    ? advanceMission(mission, event)
    : mission;
  return {
    ...data,
    version: LEARNING_MEMORY_VERSION,
    activeMission,
    events,
  };
}

function dedupeAndCapEvents(values: unknown[]): LearningEvent[] {
  const seen = new Set<string>();
  const newestFirst: LearningEvent[] = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const event = normaliseEvent(values[index]);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    newestFirst.push(event);
    if (newestFirst.length >= MAX_LEARNING_EVENTS) break;
  }
  return newestFirst.reverse();
}

/**
 * Parse current, malformed, or legacy persisted data without throwing. Zustand
 * `persist`-shaped `{ state: ... }`, a v0 `{ mission: ... }`, and a legacy event
 * array are all migrated into the current shape.
 */
export function parseLearningMemory(raw: string | null): LearningMemoryData {
  if (!raw) return createLearningMemoryData();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        ...createLearningMemoryData(),
        events: dedupeAndCapEvents(parsed),
      };
    }
    const container = asRecord(parsed);
    if (!container) return createLearningMemoryData();
    const state = asRecord(container.state) ?? container;
    const events = Array.isArray(state.events) ? dedupeAndCapEvents(state.events) : [];
    const mission = normaliseMission(state.activeMission ?? state.mission);
    return {
      version: LEARNING_MEMORY_VERSION,
      activeMission: mission,
      events,
    };
  } catch {
    return createLearningMemoryData();
  }
}

function storedData(): LearningMemoryData {
  if (typeof window === 'undefined') return createLearningMemoryData();
  try {
    const storage = window.localStorage;
    return storage
      ? parseLearningMemory(storage.getItem(LEARNING_MEMORY_STORAGE_KEY))
      : createLearningMemoryData();
  } catch {
    return createLearningMemoryData();
  }
}

function persist(data: LearningMemoryData): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    if (!storage) return;
    storage.setItem(LEARNING_MEMORY_STORAGE_KEY, JSON.stringify({
      version: LEARNING_MEMORY_VERSION,
      activeMission: data.activeMission,
      events: data.events.slice(-MAX_LEARNING_EVENTS),
    }));
  } catch {
    // Storage can be unavailable or full. Learning must remain usable in-memory.
  }
}

function stateData(state: LearningMemoryState): LearningMemoryData {
  return {
    version: LEARNING_MEMORY_VERSION,
    activeMission: state.activeMission,
    events: state.events,
  };
}

function missionProgress(mission: ActiveLearningMission): number {
  return mission.steps.filter((step) => step.status === 'complete').length;
}

function pickMission(
  local: ActiveLearningMission | null,
  incoming: ActiveLearningMission | null,
): ActiveLearningMission | null {
  if (!local) return incoming;
  if (!incoming) return local;
  if (local.id === incoming.id) {
    const localProgress = missionProgress(local);
    const incomingProgress = missionProgress(incoming);
    if (incomingProgress !== localProgress) return incomingProgress > localProgress ? incoming : local;
    return incoming.updatedAt > local.updatedAt ? incoming : local;
  }
  if (local.status !== incoming.status) return local.status === 'active' ? local : incoming;
  if (local.status === 'active') {
    if (local.createdAt !== incoming.createdAt) return local.createdAt < incoming.createdAt ? local : incoming;
    return local.id.localeCompare(incoming.id) <= 0 ? local : incoming;
  }
  return incoming.updatedAt > local.updatedAt ? incoming : local;
}

/**
 * Merge a cross-tab snapshot without letting an older writer regress ordered
 * mission progress or discard unique evidence. An explicit empty reset still
 * wins so reset/clear actions propagate across tabs.
 */
export function mergeLearningMemoryData(
  local: LearningMemoryData,
  incoming: LearningMemoryData,
): LearningMemoryData {
  if (!incoming.activeMission && incoming.events.length === 0) return incoming;
  const events = dedupeAndCapEvents([...local.events, ...incoming.events]);
  return {
    version: LEARNING_MEMORY_VERSION,
    activeMission: pickMission(local.activeMission, incoming.activeMission),
    events,
  };
}

export const useLearningMemory = create<LearningMemoryState>((set, get) => ({
  ...storedData(),

  startMission(mission) {
    const current = stateData(get());
    const next = startMissionData(current, mission);
    if (next !== current) {
      set(next);
      persist(next);
    }
    return next.activeMission!;
  },

  activateMission(mission) {
    const next = activateMissionData(stateData(get()), mission);
    set(next);
    persist(next);
    return next.activeMission!;
  },

  recordEvent(event) {
    const current = stateData(get());
    const next = reduceLearningEvent(current, event);
    if (next === current) return false;
    set(next);
    persist(next);
    return true;
  },

  refreshFromStorage() {
    set(mergeLearningMemoryData(stateData(get()), storedData()));
  },

  reset() {
    const next = createLearningMemoryData();
    set(next);
    persist(next);
  },
}));

// Keep multiple open tabs coherent. `newValue` is preferred because it is the
// exact write that triggered the event and avoids an unnecessary second read.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== LEARNING_MEMORY_STORAGE_KEY) return;
    const local = stateData(useLearningMemory.getState());
    useLearningMemory.setState(mergeLearningMemoryData(local, parseLearningMemory(event.newValue)));
  });
}
