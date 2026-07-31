import { create } from 'zustand';
import { GAME_MAP, GAMES } from '../engine/registry';
import type { Difficulty } from '../engine/types';

export const CREATOR_STORAGE_KEY = 'gm-creator-v1';
const VERSION = 1 as const;
const MAX_CREATIONS = 24;
const MAX_SHARE_BYTES = 24_000;

export type CreationKind = 'puzzle-pack' | 'guided-course' | 'challenge-variant';
export type CreationStatus = 'draft' | 'published';

export interface CourseStep {
  id: string;
  title: string;
  body: string;
}

export interface Creation {
  version: typeof VERSION;
  id: string;
  kind: CreationKind;
  status: CreationStatus;
  title: string;
  description: string;
  gameId: string;
  setup: string;
  prompt: string;
  solutions: string[];
  hints: string[];
  steps: CourseStep[];
  objective: string;
  difficulty: Difficulty;
  timeLimitMinutes: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreatorData {
  version: typeof VERSION;
  creations: Creation[];
}

interface CreatorState extends CreatorData {
  saveCreation: (creation: Creation) => Creation | null;
  publishCreation: (creation: Creation) => { creation: Creation | null; errors: string[] };
  removeCreation: (id: string) => void;
  reset: () => void;
}

const text = (value: unknown, max: number): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
  : '';
const idText = (value: unknown): string => text(value, 96).replace(/[^a-zA-Z0-9:_-]/g, '');
const time = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const difficulty = (value: unknown): Difficulty => (
  value === 'tutor' || value === 'easy' || value === 'medium' || value === 'hard' || value === 'master'
) ? value : 'medium';
const kind = (value: unknown): CreationKind | null => value === 'puzzle-pack' || value === 'guided-course' || value === 'challenge-variant' ? value : null;
const normMove = (value: string): string => value.replace(/[+#]/g, '').replace(/\s+/g, '').toLocaleLowerCase();

function list(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

/**
 * Hints are positional: an author may intentionally leave Hint 1 blank while
 * drafting Hint 2. Preserve empty slots, but trim unused slots at the end.
 */
function hintList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hints = value.slice(0, 8).map((item) => text(item, 240));
  while (hints.length && !hints[hints.length - 1]) hints.pop();
  return hints;
}

export function normalizeCreation(value: unknown): Creation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const creationKind = kind(raw.kind);
  const gameId = text(raw.gameId, 64);
  const id = idText(raw.id);
  if (!creationKind || !id || !GAME_MAP[gameId] || GAME_MAP[gameId].custom) return null;
  const steps: CourseStep[] = [];
  if (Array.isArray(raw.steps)) {
    for (const item of raw.steps.slice(0, 12)) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const step = item as Record<string, unknown>;
      const title = text(step.title, 100);
      const body = text(step.body, 900);
      if (!title || !body) continue;
      steps.push({ id: idText(step.id) || `step-${steps.length + 1}`, title, body });
    }
  }
  return {
    version: VERSION,
    id,
    kind: creationKind,
    status: raw.status === 'published' ? 'published' : 'draft',
    title: text(raw.title, 90),
    description: text(raw.description, 500),
    gameId,
    setup: typeof raw.setup === 'string' ? raw.setup.slice(0, 120_000) : '',
    prompt: text(raw.prompt, 500),
    solutions: list(raw.solutions, 12, 180),
    hints: hintList(raw.hints),
    steps,
    objective: text(raw.objective, 500),
    difficulty: difficulty(raw.difficulty),
    timeLimitMinutes: Math.max(2, Math.min(120, Number(raw.timeLimitMinutes) || 15)),
    createdAt: time(raw.createdAt),
    updatedAt: time(raw.updatedAt),
  };
}

export function createDraft(kindValue: CreationKind = 'puzzle-pack', gameId = 'chess'): Creation {
  const safeGame = GAME_MAP[gameId] && !GAME_MAP[gameId].custom ? gameId : 'chess';
  const now = Date.now();
  return {
    version: VERSION,
    id: `creation:${now.toString(36)}:${Math.random().toString(36).slice(2, 7)}`,
    kind: kindValue,
    status: 'draft',
    title: '',
    description: '',
    gameId: safeGame,
    setup: GAME_MAP[safeGame].serialize(GAME_MAP[safeGame].createInitialState()),
    prompt: '',
    solutions: [],
    hints: [],
    steps: [
      { id: 'step-1', title: 'See the idea', body: 'Introduce the strategic pattern in plain language.' },
      { id: 'step-2', title: 'Try the idea', body: 'Give the learner one focused decision to make.' },
    ],
    objective: '',
    difficulty: 'medium',
    timeLimitMinutes: 15,
    createdAt: now,
    updatedAt: now,
  };
}

export function legalMoveOptions(creation: Creation): string[] {
  const def = GAME_MAP[creation.gameId];
  if (!def || def.custom) return [];
  try {
    const state = creation.setup ? def.deserialize(creation.setup) : def.createInitialState();
    return Array.from(new Set(def.getLegalMoves(state, null).map((move) => text(move.notation, 180)).filter(Boolean))).slice(0, 300);
  } catch {
    return [];
  }
}

export function validateCreation(value: Creation, forPublish = true): string[] {
  const creation = normalizeCreation(value);
  if (!creation) return ['This creation has an invalid game or data shape.'];
  const errors: string[] = [];
  if (creation.title.length < 3) errors.push('Add a title with at least 3 characters.');
  if (creation.description.length < 12) errors.push('Add a clear description with at least 12 characters.');
  if (/[<>]/.test(creation.title + creation.description + creation.prompt + creation.objective)) errors.push('Use plain text only; markup is not supported.');
  const def = GAME_MAP[creation.gameId];
  try {
    const state = creation.setup ? def.deserialize(creation.setup) : def.createInitialState();
    const board = def.getBoardView(state);
    const turn = def.getTurn(state);
    if (
      !Number.isInteger(board.rows)
      || !Number.isInteger(board.cols)
      || board.rows <= 0
      || board.cols <= 0
      || board.cells.length !== board.rows * board.cols
      || (turn !== 0 && turn !== 1)
    ) throw new Error('Malformed engine position.');
    // These engine calls exercise the position's invariants (including kings,
    // turn data and move-generation state) before it can be published/shared.
    def.getStatus(state);
    def.getLegalMoves(state, null);
    def.serialize(state);
  } catch {
    errors.push('The saved position cannot be opened by the selected game engine.');
  }
  if (!forPublish) return errors;
  if (creation.kind === 'puzzle-pack') {
    if (creation.prompt.length < 8) errors.push('Add a focused puzzle prompt.');
    if (creation.solutions.length === 0) errors.push('Choose at least one accepted move.');
    const legal = new Set(legalMoveOptions(creation).map(normMove));
    if (creation.solutions.some((move) => !legal.has(normMove(move)))) errors.push('Every accepted move must be legal in the saved position.');
  }
  if (creation.kind === 'guided-course') {
    if (creation.steps.length < 2) errors.push('A guided course needs at least two complete steps.');
  }
  if (creation.kind === 'challenge-variant' && creation.objective.length < 8) errors.push('Describe the challenge objective.');
  return errors;
}

export function normalizeCreatorData(value: unknown): CreatorData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: VERSION, creations: [] };
  const raw = value as Record<string, unknown>;
  const creations: Creation[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.creations)) {
    for (const item of raw.creations.slice(0, MAX_CREATIONS * 3)) {
      const creation = normalizeCreation(item);
      if (!creation || seen.has(creation.id)) continue;
      seen.add(creation.id);
      creations.push(creation);
      if (creations.length >= MAX_CREATIONS) break;
    }
  }
  return { version: VERSION, creations: creations.sort((a, b) => b.updatedAt - a.updatedAt) };
}

function load(): CreatorData {
  if (typeof window === 'undefined') return { version: VERSION, creations: [] };
  try { return normalizeCreatorData(JSON.parse(localStorage.getItem(CREATOR_STORAGE_KEY) || '{}')); }
  catch { return { version: VERSION, creations: [] }; }
}

function persist(data: CreatorData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CREATOR_STORAGE_KEY, JSON.stringify(normalizeCreatorData(data))); }
  catch { /* leave the editor usable if storage is full */ }
}

export const useCreatorStore = create<CreatorState>((set, get) => ({
  ...load(),
  saveCreation(value) {
    const creation = normalizeCreation({ ...value, status: value.status ?? 'draft', updatedAt: Date.now() });
    if (!creation) return null;
    set((state) => ({ creations: [creation, ...state.creations.filter((item) => item.id !== creation.id)].slice(0, MAX_CREATIONS) }));
    persist(get());
    return creation;
  },
  publishCreation(value) {
    const errors = validateCreation(value, true);
    if (errors.length) return { creation: null, errors };
    const creation = get().saveCreation({ ...value, status: 'published', updatedAt: Date.now() });
    return { creation, errors: [] };
  },
  removeCreation(id) {
    set((state) => ({ creations: state.creations.filter((creation) => creation.id !== id) }));
    persist(get());
  },
  reset() {
    const next = { version: VERSION, creations: [] };
    set(next);
    persist(next);
  },
}));

function checksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function exportCreation(value: Creation): string {
  const creation = normalizeCreation(value);
  if (!creation) throw new Error('Cannot export an invalid creation.');
  const errors = validateCreation(creation, true);
  if (errors.length) throw new Error(`Finish validation before export: ${errors.join(' ')}`);
  const payload = JSON.stringify({ v: VERSION, creation });
  if (new TextEncoder().encode(payload).byteLength > MAX_SHARE_BYTES) throw new Error('This creation is too large to share as a code.');
  return `GM1.${checksum(payload)}.${toBase64Url(payload)}`;
}

export function importCreation(code: string): Creation {
  const [prefix, expected, encoded] = code.trim().split('.');
  if (prefix !== 'GM1' || !expected || !encoded || encoded.length > MAX_SHARE_BYTES * 2) throw new Error('That share code is not valid.');
  const payload = fromBase64Url(encoded);
  if (checksum(payload) !== expected) throw new Error('The share code is incomplete or has been changed.');
  const parsed = JSON.parse(payload) as { v?: unknown; creation?: unknown };
  if (parsed.v !== VERSION) throw new Error('That share code uses an unsupported version.');
  const creation = normalizeCreation(parsed.creation);
  if (!creation) throw new Error('The shared creation did not pass validation.');
  return { ...creation, id: `creation:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`, status: 'draft', createdAt: Date.now(), updatedAt: Date.now() };
}

export const CREATOR_GAMES = GAMES.filter((game) => !game.custom);
