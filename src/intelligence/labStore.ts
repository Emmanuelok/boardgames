import { GAME_MAP } from '../engine/registry';
import { isStrategyConceptId, type StrategyConceptId } from './strategyConcepts';
import type { PuzzleSkillEvidence } from './strategyProfile';

export const LAB_STORAGE_KEY = 'gm-intelligence-lab-v1';
export const LAB_CHANGED_EVENT = 'gm-intelligence-lab-changed';
export const LAB_STATE_VERSION = 1 as const;
export const MAX_LAB_ANNOTATIONS = 160;
export const MAX_GENERATED_DRILLS = 120;
export const MAX_COMPLETED_DRILLS = 400;
/** Keeps ample room for the profile, review and progression stores. */
export const MAX_LAB_STORAGE_BYTES = 420_000;

const MAX_ID = 180;
const MAX_NOTE = 1_500;
const MAX_TITLE = 160;
const MAX_PROMPT = 1_200;
const MAX_HREF = 1_024;
const MAX_ATTEMPTS = 100;
const MAX_DURATION_SECONDS = 86_400;
const DRILL_SOURCES = ['review', 'coach', 'transfer', 'replay', 'manual'] as const;

export type GeneratedDrillSource = (typeof DRILL_SOURCES)[number];
export type DrillVerification = 'engine' | 'self-reported';

export interface LabAnnotation {
  id: string;
  reviewId: string;
  gameId: string;
  frameIndex: number;
  /** Replay-facing alias of frameIndex. */
  ply: number;
  conceptId?: StrategyConceptId;
  note: string;
  /** Replay-facing alias of note. */
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface GeneratedDrill {
  id: string;
  gameId: string;
  conceptId: StrategyConceptId;
  title: string;
  prompt: string;
  source: GeneratedDrillSource;
  sourceId?: string;
  reviewId?: string;
  sourcePly?: number;
  puzzleId?: string;
  href: string;
  createdAt: number;
}

export interface CompletedDrill {
  id: string;
  drillId: string;
  gameId: string;
  conceptId: StrategyConceptId;
  success: boolean;
  /** Only engine-verified results are eligible for Strategy DNA evidence. */
  verification: DrillVerification;
  attempts: number;
  completedAt: number;
  durationSeconds?: number;
}

export interface LabState {
  version: typeof LAB_STATE_VERSION;
  annotations: LabAnnotation[];
  generatedDrills: GeneratedDrill[];
  completedDrills: CompletedDrill[];
}

export interface UpsertLabAnnotationInput {
  id?: string;
  reviewId: string;
  gameId: string;
  frameIndex?: number;
  ply?: number;
  conceptId?: StrategyConceptId;
  note?: string;
  text?: string;
  at?: number;
}

export interface AddGeneratedDrillInput {
  id?: string;
  gameId: string;
  conceptId: StrategyConceptId;
  title: string;
  prompt: string;
  source?: GeneratedDrillSource;
  sourceId?: string;
  reviewId?: string;
  sourcePly?: number;
  puzzleId?: string;
  href?: string;
  createdAt?: number;
}

export interface RecordCompletedDrillInput {
  id?: string;
  drillId: string;
  gameId: string;
  conceptId: StrategyConceptId;
  success?: boolean;
  verification?: DrillVerification;
  attempts?: number;
  completedAt?: number;
  durationSeconds?: number;
}

export interface LabStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim().slice(0, max);
  return result ? result : null;
}

function cleanId(value: unknown): string | null {
  return cleanText(value, MAX_ID);
}

function cleanTimestamp(value: unknown, fallback?: number): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
  }
  return fallback === undefined ? null : fallback;
}

function cleanInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function cleanGameId(value: unknown): string | null {
  const id = cleanId(value);
  return id && GAME_MAP[id] ? id : null;
}

function cleanHref(value: unknown, gameId: string, conceptId: StrategyConceptId): string {
  if (typeof value === 'string') {
    const href = value.trim().slice(0, MAX_HREF);
    // Lab links are always in-app. Reject protocols and protocol-relative URLs.
    if (href.startsWith('/') && !href.startsWith('//')) return href;
  }
  return `/puzzles?game=${gameId}&concept=${conceptId}`;
}

function normalizeAnnotation(value: unknown): LabAnnotation | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = cleanId(raw.id);
  const reviewId = cleanId(raw.reviewId);
  const gameId = cleanGameId(raw.gameId);
  const frameIndex = cleanInteger(raw.frameIndex ?? raw.ply, 0, 100_000);
  const note = cleanText(raw.note ?? raw.text, MAX_NOTE);
  const createdAt = cleanTimestamp(raw.createdAt);
  if (!id || !reviewId || !gameId || frameIndex === null || !note || createdAt === null) return null;
  const updatedAt = Math.max(createdAt, cleanTimestamp(raw.updatedAt, createdAt)!);
  const conceptId = isStrategyConceptId(raw.conceptId) ? raw.conceptId : undefined;
  return {
    id,
    reviewId,
    gameId,
    frameIndex,
    ply: frameIndex,
    ...(conceptId ? { conceptId } : {}),
    note,
    text: note,
    createdAt,
    updatedAt,
  };
}

function isDrillSource(value: unknown): value is GeneratedDrillSource {
  return typeof value === 'string' && (DRILL_SOURCES as readonly string[]).includes(value);
}

function normalizeGeneratedDrill(value: unknown): GeneratedDrill | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = cleanId(raw.id);
  const gameId = cleanGameId(raw.gameId);
  const conceptId = isStrategyConceptId(raw.conceptId) ? raw.conceptId : null;
  const title = cleanText(raw.title, MAX_TITLE);
  const prompt = cleanText(raw.prompt, MAX_PROMPT);
  const source = isDrillSource(raw.source)
    ? raw.source
    : cleanId(raw.reviewId)
      ? 'review'
      : 'transfer';
  const createdAt = cleanTimestamp(raw.createdAt);
  if (!id || !gameId || !conceptId || !title || !prompt || !source || createdAt === null) return null;
  const sourceId = cleanId(raw.sourceId) ?? undefined;
  const reviewId = cleanId(raw.reviewId) ?? undefined;
  const sourcePly = cleanInteger(raw.sourcePly, 0, 100_000) ?? undefined;
  const puzzleId = cleanId(raw.puzzleId) ?? undefined;
  return {
    id,
    gameId,
    conceptId,
    title,
    prompt,
    source,
    ...(sourceId ? { sourceId } : {}),
    ...(reviewId ? { reviewId } : {}),
    ...(sourcePly !== undefined ? { sourcePly } : {}),
    ...(puzzleId ? { puzzleId } : {}),
    href: cleanHref(raw.href, gameId, conceptId),
    createdAt,
  };
}

function normalizeCompletedDrill(value: unknown): CompletedDrill | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = cleanId(raw.id);
  const drillId = cleanId(raw.drillId);
  const gameId = cleanGameId(raw.gameId);
  const conceptId = isStrategyConceptId(raw.conceptId) ? raw.conceptId : null;
  const completedAt = cleanTimestamp(raw.completedAt);
  const attempts = cleanInteger(raw.attempts, 1, MAX_ATTEMPTS);
  if (!id || !drillId || !gameId || !conceptId || completedAt === null || attempts === null) return null;
  const durationSeconds = cleanInteger(raw.durationSeconds, 0, MAX_DURATION_SECONDS) ?? undefined;
  return {
    id,
    drillId,
    gameId,
    conceptId,
    success: raw.success !== false,
    verification: raw.verification === 'engine' ? 'engine' : 'self-reported',
    attempts,
    completedAt,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
  };
}

function newestUnique<T>(
  values: unknown,
  normalize: (value: unknown) => T | null,
  time: (value: T) => number,
  id: (value: T) => string,
  max: number,
): T[] {
  if (!Array.isArray(values)) return [];
  const normalized = values.map(normalize).filter((value): value is T => value !== null);
  normalized.sort((a, b) => time(b) - time(a) || id(a).localeCompare(id(b)));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of normalized) {
    if (seen.has(id(value))) continue;
    seen.add(id(value));
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
}

export function emptyLabState(): LabState {
  return {
    version: LAB_STATE_VERSION,
    annotations: [],
    generatedDrills: [],
    completedDrills: [],
  };
}

export function normalizeLabState(value: unknown): LabState {
  const raw = asRecord(value);
  if (!raw) return emptyLabState();
  return {
    version: LAB_STATE_VERSION,
    annotations: newestUnique(
      raw.annotations,
      normalizeAnnotation,
      (annotation) => annotation.updatedAt,
      (annotation) => annotation.id,
      MAX_LAB_ANNOTATIONS,
    ),
    generatedDrills: newestUnique(
      raw.generatedDrills,
      normalizeGeneratedDrill,
      (drill) => drill.createdAt,
      (drill) => drill.id,
      MAX_GENERATED_DRILLS,
    ),
    completedDrills: newestUnique(
      raw.completedDrills,
      normalizeCompletedDrill,
      (drill) => drill.completedAt,
      (drill) => drill.id,
      MAX_COMPLETED_DRILLS,
    ),
  };
}

function browserStorage(): LabStorage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  // UTF-16 is a safe upper estimate in older environments.
  return value.length * 2;
}

/**
 * Enforces a total byte budget after field and row caps. Old completion events
 * go first, then old generated drills, then annotations. At least the newest
 * rows of each kind are retained whenever possible.
 */
function fitStorageBudget(value: LabState): LabState {
  const state = normalizeLabState(value);
  let serialized = JSON.stringify(state);
  while (byteLength(serialized) > MAX_LAB_STORAGE_BYTES) {
    if (state.completedDrills.length > 24) state.completedDrills.pop();
    else if (state.generatedDrills.length > 16) state.generatedDrills.pop();
    else if (state.annotations.length > 16) state.annotations.pop();
    else if (state.completedDrills.length) state.completedDrills.pop();
    else if (state.generatedDrills.length) state.generatedDrills.pop();
    else if (state.annotations.length) state.annotations.pop();
    else break;
    serialized = JSON.stringify(state);
  }
  return state;
}

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new Event(LAB_CHANGED_EVENT)); }
  catch { /* event construction can be unavailable in non-browser runtimes */ }
}

export function loadLabState(storage: LabStorage | null = browserStorage()): LabState {
  if (!storage) return emptyLabState();
  try {
    const rawText = storage.getItem(LAB_STORAGE_KEY);
    if (!rawText) return emptyLabState();
    const raw = JSON.parse(rawText);
    const normalized = fitStorageBudget(normalizeLabState(raw));
    const nextText = JSON.stringify(normalized);
    if (nextText !== rawText) storage.setItem(LAB_STORAGE_KEY, nextText);
    return normalized;
  } catch {
    return emptyLabState();
  }
}

export function saveLabState(
  value: LabState,
  storage: LabStorage | null = browserStorage(),
): LabState {
  const normalized = fitStorageBudget(value);
  if (!storage) return normalized;
  try {
    storage.setItem(LAB_STORAGE_KEY, JSON.stringify(normalized));
    emitChanged();
  } catch {
    // A storage implementation may have a smaller quota. Do not destroy the
    // previously persisted value; the normalized result remains useful in RAM.
  }
  return normalized;
}

function makeId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${suffix}`.slice(0, MAX_ID);
}

function inputTimestamp(value: unknown): number {
  return cleanTimestamp(value) ?? Date.now();
}

export function upsertLabAnnotation(
  input: UpsertLabAnnotationInput,
  storage: LabStorage | null = browserStorage(),
): LabState {
  const current = loadLabState(storage);
  const existing = input.id
    ? current.annotations.find((annotation) => annotation.id === input.id)
    : undefined;
  const at = inputTimestamp(input.at);
  const next = normalizeAnnotation({
    ...input,
    id: input.id ?? makeId('note'),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  });
  if (!next) return current;
  return saveLabState({
    ...current,
    annotations: [next, ...current.annotations.filter((annotation) => annotation.id !== next.id)],
  }, storage);
}

export function removeLabAnnotation(
  id: string,
  storage: LabStorage | null = browserStorage(),
): LabState {
  const current = loadLabState(storage);
  const clean = cleanId(id);
  if (!clean) return current;
  return saveLabState({
    ...current,
    annotations: current.annotations.filter((annotation) => annotation.id !== clean),
  }, storage);
}

export function addGeneratedDrill(
  input: AddGeneratedDrillInput,
  storage: LabStorage | null = browserStorage(),
): LabState {
  const current = loadLabState(storage);
  const next = normalizeGeneratedDrill({
    ...input,
    id: input.id ?? makeId('drill'),
    createdAt: inputTimestamp(input.createdAt),
  });
  if (!next) return current;
  return saveLabState({
    ...current,
    generatedDrills: [next, ...current.generatedDrills.filter((drill) => drill.id !== next.id)],
  }, storage);
}

export function recordCompletedDrill(
  input: RecordCompletedDrillInput,
  storage: LabStorage | null = browserStorage(),
): LabState {
  const current = loadLabState(storage);
  const next = normalizeCompletedDrill({
    ...input,
    id: input.id ?? makeId('complete'),
    success: input.success ?? true,
    attempts: input.attempts ?? 1,
    completedAt: inputTimestamp(input.completedAt),
  });
  if (!next) return current;
  return saveLabState({
    ...current,
    completedDrills: [next, ...current.completedDrills.filter((drill) => drill.id !== next.id)],
  }, storage);
}

/** Converts completed lab work directly into Strategy DNA puzzle evidence. */
export function completedDrillsAsSkillEvidence(state: LabState): PuzzleSkillEvidence[] {
  return normalizeLabState(state).completedDrills
    .filter((drill) => drill.verification === 'engine')
    .map((drill) => ({
    id: drill.id,
    gameId: drill.gameId,
    conceptIds: [drill.conceptId],
    solved: drill.success,
    attempts: drill.attempts,
    at: drill.completedAt,
    }));
}

export function clearLabState(storage: LabStorage | null = browserStorage()): LabState {
  if (storage) {
    try { storage.removeItem(LAB_STORAGE_KEY); }
    catch { /* ignore storage failures */ }
  }
  emitChanged();
  return emptyLabState();
}
