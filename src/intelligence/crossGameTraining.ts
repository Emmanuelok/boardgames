import { GAMES, GAME_MAP } from '../engine/registry';
import { ALL_PUZZLES, type Puzzle } from '../puzzles/allPuzzles';
import {
  affinitiesForGame,
  classifyPrinciples,
  isStrategyConceptId,
  STRATEGY_CONCEPT_BY_ID,
  STRATEGY_CONCEPTS,
  type StrategyConcept,
  type StrategyConceptId,
} from './strategyConcepts';
import type { StrategyProfile } from './strategyProfile';

export type TrainingStopRole = 'anchor' | 'guided-practice' | 'transfer';

export interface CrossGameTrainingStop {
  role: TrainingStopRole;
  gameId: string;
  gameName: string;
  emoji: string;
  /** UI-friendly alias retained for route cards. */
  gameEmoji: string;
  category: string;
  depth: number;
  /** Authored fit of this concept to the game, from 0 to 100. */
  conceptFit: number;
  /** Normalized 0–1 alias for compact visual meters. */
  fit: number;
  /** Puzzles in the current catalogue that train this concept in this game. */
  puzzleCount: number;
  href: string;
  actionLabel: string;
  reason: string;
}

export interface CrossGameRoute {
  id: string;
  conceptId: StrategyConceptId;
  concept: StrategyConcept;
  headline: string;
  rationale: string;
  priority: number;
  sourceGameId?: string;
  stops: CrossGameTrainingStop[];
  totalPuzzles: number;
  estimatedMinutes: number;
}

export interface TransferRouteOptions {
  fromGameId?: string;
  /** Avoid games the learner does not want in this route. */
  excludeGameIds?: readonly string[];
  /** Prefer these games without ever allowing an unregistered id. */
  preferredGameIds?: readonly string[];
  maxStops?: number;
  priority?: number;
}

export interface CrossGameTrainingOptions extends TransferRouteOptions {
  limit?: number;
  conceptIds?: readonly StrategyConceptId[];
}

interface Candidate {
  gameId: string;
  affinity: number;
  primary: boolean;
  puzzleCount: number;
}

/**
 * Tags a puzzle with canonical ideas. Authored puzzle text wins; course
 * challenges whose text is deliberately minimal inherit the game's primary
 * concept fingerprint.
 */
export function puzzleConceptIds(puzzle: Pick<Puzzle, 'gameId' | 'theme' | 'prompt'>): StrategyConceptId[] {
  const classified = classifyPrinciples([puzzle.theme, puzzle.prompt]).map((concept) => concept.id);
  if (classified.length) return classified;
  return affinitiesForGame(puzzle.gameId)
    .filter((entry) => entry.role === 'primary')
    .slice(0, 3)
    .map((entry) => entry.conceptId);
}

const PUZZLES_BY_GAME_AND_CONCEPT = (() => {
  const index = new Map<string, Set<string>>();
  for (const puzzle of ALL_PUZZLES) {
    if (!GAME_MAP[puzzle.gameId]) continue;
    for (const conceptId of puzzleConceptIds(puzzle)) {
      const key = `${puzzle.gameId}:${conceptId}`;
      const ids = index.get(key) ?? new Set<string>();
      ids.add(puzzle.id);
      index.set(key, ids);
    }
  }
  return index;
})();

export function conceptPuzzleCount(gameId: string, conceptId: StrategyConceptId): number {
  return PUZZLES_BY_GAME_AND_CONCEPT.get(`${gameId}:${conceptId}`)?.size ?? 0;
}

function candidatesFor(conceptId: StrategyConceptId, excluded: Set<string>): Candidate[] {
  return GAMES.flatMap((game): Candidate[] => {
    if (excluded.has(game.id)) return [];
    const affinity = affinitiesForGame(game.id).find((entry) => entry.conceptId === conceptId);
    return affinity ? [{
      gameId: game.id,
      affinity: affinity.weight,
      primary: affinity.role === 'primary',
      puzzleCount: conceptPuzzleCount(game.id, conceptId),
    }] : [];
  });
}

function candidateScore(
  candidate: Candidate,
  role: TrainingStopRole,
  anchorCategory: string | undefined,
  preferred: Set<string>,
): number {
  const game = GAME_MAP[candidate.gameId];
  const puzzleBoost = Math.min(18, candidate.puzzleCount * 3);
  const preference = preferred.has(candidate.gameId) ? 12 : 0;
  const primary = candidate.primary ? 8 : 0;
  const variety = anchorCategory && game.category !== anchorCategory ? 7 : 0;
  const depthFit = role === 'guided-practice'
    ? Math.max(0, 12 - Math.abs(game.depth - 2) * 4)
      : role === 'transfer'
      ? game.depth * 2.5
      : Math.max(0, 10 - game.depth * 2);
  return candidate.affinity * 55 + puzzleBoost + preference + primary + variety + depthFit;
}

function chooseCandidate(
  candidates: Candidate[],
  role: TrainingStopRole,
  used: Set<string>,
  anchorCategory: string | undefined,
  preferred: Set<string>,
  requirePuzzle: boolean,
): Candidate | undefined {
  return candidates
    .filter((candidate) => !used.has(candidate.gameId) && (!requirePuzzle || candidate.puzzleCount > 0))
    .slice()
    .sort((a, b) =>
      candidateScore(b, role, anchorCategory, preferred)
      - candidateScore(a, role, anchorCategory, preferred)
      || a.gameId.localeCompare(b.gameId))[0];
}

function toStop(candidate: Candidate, role: TrainingStopRole, concept: StrategyConcept): CrossGameTrainingStop {
  const game = GAME_MAP[candidate.gameId];
  const hasPuzzle = candidate.puzzleCount > 0;
  const href = role === 'anchor'
    ? `/learn/${game.id}?concept=${concept.id}`
    : hasPuzzle
      ? `/puzzles?game=${game.id}&concept=${concept.id}`
      : `/play/${game.id}?difficulty=tutor&focus=${concept.id}`;
  const actionLabel = role === 'anchor'
    ? 'Review the idea'
    : hasPuzzle
      ? `Solve ${candidate.puzzleCount} position${candidate.puzzleCount === 1 ? '' : 's'}`
      : 'Apply it with the coach';
  const reason = role === 'anchor'
    ? `Name the ${concept.shortLabel.toLocaleLowerCase()} decisions you already recognise in ${game.name}.`
    : role === 'guided-practice'
      ? `${game.name} makes the pattern visible in a compact, guided position.`
      : `${game.name} changes the board and win condition, proving the idea can transfer.`;
  return {
    role,
    gameId: game.id,
    gameName: game.name,
    emoji: game.emoji,
    gameEmoji: game.emoji,
    category: game.category,
    depth: game.depth,
    conceptFit: Math.round(candidate.affinity * 100),
    fit: candidate.affinity,
    puzzleCount: candidate.puzzleCount,
    href,
    actionLabel,
    reason,
  };
}

export function buildTransferRoute(
  conceptId: StrategyConceptId,
  options: TransferRouteOptions = {},
): CrossGameRoute | null {
  if (!isStrategyConceptId(conceptId)) return null;
  const concept = STRATEGY_CONCEPT_BY_ID[conceptId];
  const excluded = new Set(
    (options.excludeGameIds ?? []).filter((gameId) => typeof gameId === 'string'),
  );
  const preferred = new Set(
    (options.preferredGameIds ?? []).filter((gameId) => Boolean(GAME_MAP[gameId])),
  );
  const all = candidatesFor(conceptId, excluded);
  if (all.length < 2) return null;
  const requestedAnchor = options.fromGameId && GAME_MAP[options.fromGameId]
    ? all.find((candidate) => candidate.gameId === options.fromGameId)
    : undefined;
  const anchor = requestedAnchor
    ?? chooseCandidate(all, 'anchor', new Set(), undefined, preferred, true)
    ?? chooseCandidate(all, 'anchor', new Set(), undefined, preferred, false);
  if (!anchor) return null;
  const anchorCategory = GAME_MAP[anchor.gameId].category;
  const used = new Set([anchor.gameId]);
  const practice = chooseCandidate(all, 'guided-practice', used, anchorCategory, preferred, true)
    ?? chooseCandidate(all, 'guided-practice', used, anchorCategory, preferred, false);
  if (practice) used.add(practice.gameId);
  const transfer = chooseCandidate(all, 'transfer', used, anchorCategory, preferred, true)
    ?? chooseCandidate(all, 'transfer', used, anchorCategory, preferred, false);
  if (transfer) used.add(transfer.gameId);

  const selected: Array<[Candidate, TrainingStopRole]> = [[anchor, 'anchor']];
  if (practice) selected.push([practice, 'guided-practice']);
  if (transfer) selected.push([transfer, 'transfer']);
  const maxStops = Math.max(2, Math.min(3, Math.floor(options.maxStops ?? 3)));
  const stops = selected.slice(0, maxStops).map(([candidate, role]) => toStop(candidate, role, concept));
  if (stops.length < 2) return null;
  const sourceName = GAME_MAP[anchor.gameId].name;
  const destinationName = stops[stops.length - 1].gameName;
  return {
    id: `${conceptId}:${stops.map((stop) => stop.gameId).join(':')}`,
    conceptId,
    concept,
    headline: `${concept.label}: ${sourceName} → ${destinationName}`,
    rationale: `Recognise the idea in ${sourceName}, isolate it in practice, then apply it under a different ruleset.`,
    priority: Math.max(0, Math.min(100, Math.round(options.priority ?? 50))),
    sourceGameId: anchor.gameId,
    stops,
    totalPuzzles: stops.reduce((sum, stop) => sum + stop.puzzleCount, 0),
    estimatedMinutes: stops.reduce((sum, stop) => sum + (stop.role === 'anchor' ? 4 : stop.puzzleCount ? 6 : 9), 0),
  };
}

function defaultConceptOrder(): StrategyConceptId[] {
  return STRATEGY_CONCEPTS
    .slice()
    .sort((a, b) => {
      const aPuzzles = GAMES.reduce((sum, game) => sum + conceptPuzzleCount(game.id, a.id), 0);
      const bPuzzles = GAMES.reduce((sum, game) => sum + conceptPuzzleCount(game.id, b.id), 0);
      return bPuzzles - aPuzzles || a.label.localeCompare(b.label);
    })
    .map((concept) => concept.id);
}

export function buildCrossGameRoutes(
  profile: StrategyProfile,
  options: CrossGameTrainingOptions = {},
): CrossGameRoute[] {
  const requested = Array.from(new Set(
    options.conceptIds?.filter(isStrategyConceptId)
    ?? profile.dimensions
      .slice()
      .sort((a, b) => {
        const aNeed = (100 - a.score) * (a.confidence / 100) + (a.confidence === 0 ? 18 : 0);
        const bNeed = (100 - b.score) * (b.confidence / 100) + (b.confidence === 0 ? 18 : 0);
        return bNeed - aNeed || b.evidenceCount - a.evidenceCount;
      })
      .map((dimension) => dimension.id),
  ));
  const concepts = requested.length ? requested : defaultConceptOrder();
  const limit = Math.max(1, Math.min(8, Math.floor(options.limit ?? 4)));
  const routes: CrossGameRoute[] = [];
  for (const conceptId of concepts) {
    const dimension = profile.dimensions.find((item) => item.id === conceptId);
    const sourceGameId = options.fromGameId
      ?? dimension?.games[0]?.gameId;
    const priority = dimension
      ? Math.round(Math.min(100, (100 - dimension.score) * .7 + dimension.confidence * .3))
      : 40;
    const route = buildTransferRoute(conceptId, { ...options, fromGameId: sourceGameId, priority });
    if (route) routes.push(route);
    if (routes.length >= limit) break;
  }
  return routes;
}
