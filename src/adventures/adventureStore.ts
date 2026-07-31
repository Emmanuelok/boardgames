import { create } from 'zustand';
import { ADVENTURES, findAdventure, findChapter } from './catalogue';

export const ADVENTURE_STORAGE_KEY = 'gm-adventures-v1';
const VERSION = 1 as const;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ActiveAdventure {
  adventureId: string;
  chapterId: string;
  missionId: string;
  startedAt: number;
}

export interface AdventureData {
  version: typeof VERSION;
  completed: Record<string, string[]>;
  active: ActiveAdventure | null;
}

interface AdventureState extends AdventureData {
  activate: (active: ActiveAdventure) => void;
  complete: (adventureId: string, chapterId: string) => boolean;
  reset: () => void;
}

function emptyData(): AdventureData {
  return { version: VERSION, completed: {}, active: null };
}

function safeTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function validActive(value: unknown): ActiveAdventure | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const adventureId = typeof raw.adventureId === 'string' ? raw.adventureId : '';
  const chapterId = typeof raw.chapterId === 'string' ? raw.chapterId : '';
  const missionId = typeof raw.missionId === 'string' ? raw.missionId.trim().slice(0, 256) : '';
  if (!ID.test(adventureId) || !ID.test(chapterId) || !missionId || !findChapter(adventureId, chapterId)) return null;
  return { adventureId, chapterId, missionId, startedAt: safeTime(raw.startedAt) };
}

export function normalizeAdventureData(value: unknown): AdventureData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyData();
  const raw = value as Record<string, unknown>;
  const completed: Record<string, string[]> = {};
  const source = raw.completed && typeof raw.completed === 'object' && !Array.isArray(raw.completed)
    ? raw.completed as Record<string, unknown>
    : {};
  for (const adventure of ADVENTURES) {
    const values = Array.isArray(source[adventure.id]) ? source[adventure.id] as unknown[] : [];
    const allowed = new Set(adventure.chapters.map((chapter) => chapter.id));
    completed[adventure.id] = Array.from(new Set(
      values.filter((item): item is string => typeof item === 'string' && allowed.has(item)),
    )).slice(0, adventure.chapters.length);
  }
  return { version: VERSION, completed, active: validActive(raw.active) };
}

function load(): AdventureData {
  if (typeof window === 'undefined') return emptyData();
  try {
    return normalizeAdventureData(JSON.parse(window.localStorage.getItem(ADVENTURE_STORAGE_KEY) || '{}'));
  } catch {
    return emptyData();
  }
}

function save(data: AdventureData): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADVENTURE_STORAGE_KEY, JSON.stringify(normalizeAdventureData(data)));
  } catch {
    // Storage can be unavailable or full; the active session remains usable.
  }
}

export function chapterUnlocked(data: AdventureData, adventureId: string, chapterId: string): boolean {
  const adventure = findAdventure(adventureId);
  const index = adventure?.chapters.findIndex((chapter) => chapter.id === chapterId) ?? -1;
  return index === 0 || (index > 0 && !!data.completed[adventureId]?.includes(adventure!.chapters[index - 1].id));
}

export const useAdventureStore = create<AdventureState>((set, get) => ({
  ...load(),
  activate(active) {
    const normalized = validActive(active);
    if (!normalized || !chapterUnlocked(get(), normalized.adventureId, normalized.chapterId)) return;
    set({ active: normalized });
    save(get());
  },
  complete(adventureId, chapterId) {
    if (!findChapter(adventureId, chapterId) || !chapterUnlocked(get(), adventureId, chapterId)) return false;
    if (get().completed[adventureId]?.includes(chapterId)) return false;
    set((state) => ({
      completed: {
        ...state.completed,
        [adventureId]: [...(state.completed[adventureId] ?? []), chapterId],
      },
      active: state.active?.adventureId === adventureId && state.active.chapterId === chapterId
        ? null
        : state.active,
    }));
    save(get());
    return true;
  },
  reset() {
    const next = emptyData();
    set(next);
    save(next);
  },
}));
