import { create } from 'zustand';
import { GAME_MAP } from '../engine/registry';
import {
  createKnockout,
  createRoundRobin,
  reportMatch,
  type TournamentBracket,
  type TournamentFormat,
} from './brackets';

export const COMMUNITY_STORAGE_KEY = 'gm-community-v1';
const VERSION = 1 as const;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ClubSession {
  id: string;
  title: string;
  gameId: string;
  startsAt: number;
  durationMinutes: number;
}

export interface Club {
  id: string;
  name: string;
  description: string;
  focusGameIds: string[];
  inviteCode: string;
  joined: boolean;
  createdAt: number;
  sessions: ClubSession[];
}

export interface Tournament {
  id: string;
  name: string;
  gameId: string;
  format: TournamentFormat;
  createdAt: number;
  status: 'draft' | 'active' | 'complete';
  bracket: TournamentBracket;
  fixedRecognition: string;
}

export interface CommunityData {
  version: typeof VERSION;
  clubs: Club[];
  tournaments: Tournament[];
}

interface CommunityState extends CommunityData {
  joinClub: (club: Omit<Club, 'joined' | 'sessions'> & { sessions?: ClubSession[] }) => void;
  leaveClub: (clubId: string) => void;
  scheduleSession: (clubId: string, input: Omit<ClubSession, 'id'>) => void;
  createTournament: (name: string, gameId: string, format: TournamentFormat, participantNames: string[]) => Tournament | null;
  reportResult: (tournamentId: string, matchId: string, winnerId: string | null) => void;
  reset: () => void;
}

const clean = (value: unknown, max: number): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max)
  : '';
const time = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const makeId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function emptyData(): CommunityData {
  return { version: VERSION, clubs: [], tournaments: [] };
}

function normalizeClub(value: unknown): Club | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = clean(raw.id, 80);
  const name = clean(raw.name, 70);
  if (!SAFE_ID.test(id) || !name) return null;
  const games = Array.isArray(raw.focusGameIds)
    ? Array.from(new Set(raw.focusGameIds.filter((game): game is string => typeof game === 'string' && !!GAME_MAP[game]))).slice(0, 8)
    : [];
  const sessions: ClubSession[] = [];
  if (Array.isArray(raw.sessions)) {
    for (const value of raw.sessions.slice(0, 20)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const session = value as Record<string, unknown>;
      const sessionId = clean(session.id, 90);
      const title = clean(session.title, 80);
      const gameId = clean(session.gameId, 50);
      const durationMinutes = Math.max(10, Math.min(180, Number(session.durationMinutes) || 30));
      if (!sessionId || !title || !GAME_MAP[gameId]) continue;
      sessions.push({ id: sessionId, title, gameId, startsAt: time(session.startsAt), durationMinutes });
    }
  }
  return {
    id,
    name,
    description: clean(raw.description, 240),
    focusGameIds: games.length ? games : ['chess'],
    inviteCode: clean(raw.inviteCode, 16).toUpperCase() || `GM-${id.slice(0, 5).toUpperCase()}`,
    joined: raw.joined === true,
    createdAt: time(raw.createdAt),
    sessions,
  };
}

function normalizeTournament(value: unknown): Tournament | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = clean(raw.id, 90);
  const name = clean(raw.name, 80);
  const gameId = clean(raw.gameId, 50);
  const format = raw.format === 'round-robin' ? 'round-robin' : raw.format === 'knockout' ? 'knockout' : null;
  const bracket = raw.bracket as TournamentBracket | undefined;
  if (!SAFE_ID.test(id) || !name || !GAME_MAP[gameId] || !format || !bracket || bracket.format !== format || !Array.isArray(bracket.participants) || !Array.isArray(bracket.rounds)) return null;
  const participantNames = bracket.participants.map((participant) => clean(participant?.name, 48)).filter(Boolean);
  try {
    let rebuilt = format === 'knockout' ? createKnockout(participantNames) : createRoundRobin(participantNames);
    const completed = bracket.rounds.flat().filter((match) => match?.status === 'complete'
      && (typeof match.winnerId === 'string' || (format === 'round-robin' && match.winnerId === null)));
    for (const match of completed) {
      const score = Number.isFinite(match.scoreA) && Number.isFinite(match.scoreB)
        ? [Number(match.scoreA), Number(match.scoreB)] as [number, number]
        : undefined;
      rebuilt = reportMatch(rebuilt, clean(match.id, 32), match.winnerId, score);
    }
    const complete = rebuilt.rounds.flat().every((match) => match.status === 'complete');
    return {
      id,
      name,
      gameId,
      format,
      createdAt: time(raw.createdAt),
      status: complete ? 'complete' : raw.status === 'draft' ? 'draft' : 'active',
      bracket: rebuilt,
      fixedRecognition: clean(raw.fixedRecognition, 80) || 'Community Champion badge',
    };
  } catch {
    return null;
  }
}

export function normalizeCommunityData(value: unknown): CommunityData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyData();
  const raw = value as Record<string, unknown>;
  const clubs = Array.isArray(raw.clubs) ? raw.clubs.map(normalizeClub).filter((club): club is Club => !!club).slice(0, 20) : [];
  const tournaments = Array.isArray(raw.tournaments) ? raw.tournaments.map(normalizeTournament).filter((item): item is Tournament => !!item).slice(0, 16) : [];
  return { version: VERSION, clubs, tournaments };
}

function load(): CommunityData {
  if (typeof window === 'undefined') return emptyData();
  try { return normalizeCommunityData(JSON.parse(localStorage.getItem(COMMUNITY_STORAGE_KEY) || '{}')); }
  catch { return emptyData(); }
}

function persist(data: CommunityData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(COMMUNITY_STORAGE_KEY, JSON.stringify(normalizeCommunityData(data))); }
  catch { /* keep the live session usable */ }
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  ...load(),
  joinClub(input) {
    const proposed = normalizeClub({ ...input, joined: true, sessions: input.sessions ?? [] });
    if (!proposed) return;
    set((state) => ({ clubs: [proposed, ...state.clubs.filter((club) => club.id !== proposed.id)].slice(0, 20) }));
    persist(get());
  },
  leaveClub(clubId) {
    set((state) => ({ clubs: state.clubs.filter((club) => club.id !== clubId) }));
    persist(get());
  },
  scheduleSession(clubId, input) {
    if (!GAME_MAP[input.gameId]) return;
    const session: ClubSession = {
      ...input,
      id: makeId('session'),
      title: clean(input.title, 80),
      startsAt: time(input.startsAt),
      durationMinutes: Math.max(10, Math.min(180, Math.floor(input.durationMinutes))),
    };
    if (!session.title) return;
    set((state) => ({
      clubs: state.clubs.map((club) => club.id === clubId
        ? { ...club, sessions: [session, ...club.sessions].slice(0, 20) }
        : club),
    }));
    persist(get());
  },
  createTournament(name, gameId, format, participantNames) {
    if (!GAME_MAP[gameId]) return null;
    try {
      const bracket = format === 'knockout' ? createKnockout(participantNames) : createRoundRobin(participantNames);
      const tournament: Tournament = {
        id: makeId('tournament'),
        name: clean(name, 80) || `${GAME_MAP[gameId].name} Community Cup`,
        gameId,
        format,
        createdAt: Date.now(),
        status: 'active',
        bracket,
        fixedRecognition: 'Community Champion badge',
      };
      set((state) => ({ tournaments: [tournament, ...state.tournaments].slice(0, 16) }));
      persist(get());
      return tournament;
    } catch {
      return null;
    }
  },
  reportResult(tournamentId, matchId, winnerId) {
    set((state) => ({
      tournaments: state.tournaments.map((tournament) => {
        if (tournament.id !== tournamentId) return tournament;
        const bracket = reportMatch(tournament.bracket, matchId, winnerId);
        const complete = bracket.rounds.flat().every((match) => match.status === 'complete');
        return { ...tournament, bracket, status: complete ? 'complete' : 'active' };
      }),
    }));
    persist(get());
  },
  reset() {
    const next = emptyData();
    set(next);
    persist(next);
  },
}));

export const CURATED_CLUBS: Array<Omit<Club, 'joined' | 'sessions'>> = [
  {
    id: 'connection-lab',
    name: 'Connection Lab',
    description: 'Weekly Hex, Go and Lines of Action sessions focused on shape, influence and connected play.',
    focusGameIds: ['hex', 'go', 'lines-of-action'],
    inviteCode: 'GM-CONNECT',
    createdAt: 0,
  },
  {
    id: 'classic-table',
    name: 'The Classic Table',
    description: 'A calm, welcoming room for Chess, Checkers, Morris and Mancala study matches.',
    focusGameIds: ['chess', 'checkers', 'nine-mens-morris', 'mancala'],
    inviteCode: 'GM-CLASSIC',
    createdAt: 0,
  },
  {
    id: 'abstract-explorers',
    name: 'Abstract Explorers',
    description: 'Short-form geometric games, collaborative post-match notes and rotating weekend challenges.',
    focusGameIds: ['quarto', 'pentago', 'teeko', 'squava'],
    inviteCode: 'GM-ABSTRACT',
    createdAt: 0,
  },
];
