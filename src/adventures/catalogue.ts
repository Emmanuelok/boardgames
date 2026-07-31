import type { MissionTarget } from '../intelligence/learningMemory';
import { PUZZLE_GAME_IDS } from '../puzzles/allPuzzles';

export interface AdventureChapter {
  id: string;
  title: string;
  gameId: string;
  concept: string;
  summary: string;
  briefing: string;
  accent: string;
  badge: string;
  minutes: number;
}

export interface Adventure {
  id: string;
  title: string;
  overline: string;
  description: string;
  outcome: string;
  accent: string;
  chapters: AdventureChapter[];
}

export const ADVENTURES: Adventure[] = [
  {
    id: 'threads-of-territory',
    title: 'Threads of Territory',
    overline: 'Connection expedition',
    description: 'Learn how a single link becomes a network, a network becomes influence, and influence becomes control.',
    outcome: 'Read connection strength across boards that look completely different.',
    accent: '#4de2c5',
    chapters: [
      {
        id: 'bridge-the-hex',
        title: 'Bridge the Hex',
        gameId: 'hex',
        concept: 'Connection',
        summary: 'Build virtual links before your stones physically touch.',
        briefing: 'Track two possible routes at once. A resilient connection survives one interruption.',
        accent: '#4de2c5',
        badge: 'Bridge Builder',
        minutes: 24,
      },
      {
        id: 'shape-the-influence',
        title: 'Shape the Influence',
        gameId: 'go',
        concept: 'Influence',
        summary: 'Balance local security with reach across the whole board.',
        briefing: 'Treat every stone as part of a wider field. Ask what it strengthens beyond its own point.',
        accent: '#f4c35a',
        badge: 'Field Reader',
        minutes: 32,
      },
      {
        id: 'move-as-one',
        title: 'Move as One',
        gameId: 'lines-of-action',
        concept: 'Cohesion',
        summary: 'Turn scattered forces into one connected formation.',
        briefing: 'Every move changes both mobility and group structure. Prefer progress that does two jobs.',
        accent: '#7cb7ff',
        badge: 'Network Strategist',
        minutes: 28,
      },
    ],
  },
  {
    id: 'tempo-atlas',
    title: 'The Tempo Atlas',
    overline: 'Initiative expedition',
    description: 'Follow the hidden currency of time through development, pressure, breakthrough and conversion.',
    outcome: 'Recognize when one useful move is worth more than immediate material.',
    accent: '#9f84ff',
    chapters: [
      {
        id: 'wake-the-pieces',
        title: 'Wake the Pieces',
        gameId: 'chess',
        concept: 'Development',
        summary: 'Coordinate pieces quickly and make every early move carry purpose.',
        briefing: 'Count active pieces, not moves made. Development matters when it creates choices and pressure.',
        accent: '#9f84ff',
        badge: 'Tempo Keeper',
        minutes: 30,
      },
      {
        id: 'cross-the-line',
        title: 'Cross the Line',
        gameId: 'breakthrough',
        concept: 'Initiative',
        summary: 'Create threats that force replies while preserving your route forward.',
        briefing: 'A forcing move is valuable only when the next position still supports your advance.',
        accent: '#ff8d72',
        badge: 'Initiative Pilot',
        minutes: 24,
      },
      {
        id: 'convert-the-window',
        title: 'Convert the Window',
        gameId: 'teeko',
        concept: 'Conversion',
        summary: 'Turn a brief alignment into a decisive geometric threat.',
        briefing: 'Look for moves that create two completion points. One threat can be blocked; two shape the game.',
        accent: '#f0d36c',
        badge: 'Conversion Architect',
        minutes: 22,
      },
    ],
  },
  {
    id: 'guardians-and-gateways',
    title: 'Guardians & Gateways',
    overline: 'Route-planning expedition',
    description: 'Study escape lanes, blockades and circular capture routes across three asymmetric worlds.',
    outcome: 'Plan routes by controlling gateways rather than chasing individual pieces.',
    accent: '#ff79b7',
    chapters: [
      {
        id: 'hold-the-throne',
        title: 'Hold the Throne',
        gameId: 'tafl',
        concept: 'Asymmetry',
        summary: 'Coordinate an escape plan while the surrounding force closes in.',
        briefing: 'The two sides have different goals. Evaluate every square by what it opens or closes for the king.',
        accent: '#ff79b7',
        badge: 'Throne Guardian',
        minutes: 30,
      },
      {
        id: 'seal-the-corridor',
        title: 'Seal the Corridor',
        gameId: 'fox-and-hounds',
        concept: 'Blockade',
        summary: 'Build a moving wall without creating a gap behind it.',
        briefing: 'A blockade succeeds as a formation. Keep the line connected while reducing escape choices.',
        accent: '#ffab63',
        badge: 'Corridor Keeper',
        minutes: 20,
      },
      {
        id: 'read-the-circuit',
        title: 'Read the Circuit',
        gameId: 'surakarta',
        concept: 'Route planning',
        summary: 'See capture paths that travel beyond the obvious local neighbourhood.',
        briefing: 'Trace the full circuit before moving. The important square may be far from the captured piece.',
        accent: '#62d2ff',
        badge: 'Circuit Reader',
        minutes: 26,
      },
    ],
  },
];

export function findAdventure(adventureId: string | undefined): Adventure | undefined {
  return ADVENTURES.find((adventure) => adventure.id === adventureId);
}

export function findChapter(adventureId: string | undefined, chapterId: string | undefined): AdventureChapter | undefined {
  return findAdventure(adventureId)?.chapters.find((chapter) => chapter.id === chapterId);
}

export function adventureMissionTargets(chapter: AdventureChapter): MissionTarget[] {
  const tutorMatch = `/play/${chapter.gameId}?difficulty=tutor`;
  const mediumMatch = `/play/${chapter.gameId}?difficulty=medium`;
  const practice: MissionTarget = PUZZLE_GAME_IDS.includes(chapter.gameId)
    ? { stage: 'practice', kind: 'puzzle_solved', sourceId: `puzzle:${chapter.gameId}`, href: `/puzzles?game=${chapter.gameId}` }
    : { stage: 'practice', kind: 'match_completed', sourceId: `match:${chapter.gameId}:easy`, href: `/play/${chapter.gameId}?difficulty=easy` };
  return [
    { stage: 'observe', kind: 'match_completed', sourceId: `match:${chapter.gameId}:tutor`, href: tutorMatch },
    { stage: 'learn', kind: 'lesson_completed', sourceId: `course:${chapter.gameId}`, href: `/learn/${chapter.gameId}` },
    practice,
    { stage: 'play', kind: 'match_completed', sourceId: `match:${chapter.gameId}:medium`, href: mediumMatch },
    { stage: 'reflect', kind: 'reflection_completed', sourceId: `reflection:${chapter.gameId}:after-play`, href: '/reviews' },
  ];
}
