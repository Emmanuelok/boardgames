import type { GameRecord } from '../engine/reviewSummary';
import { GAME_MAP } from '../engine/registry';
import type { Player } from '../engine/types';
import type { Tally } from '../profile/profile';
import {
  affinitiesForGame,
  isStrategyConceptId,
  STRATEGY_CONCEPTS,
  type StrategyConcept,
  type StrategyConceptId,
} from './strategyConcepts';

const MAX_COUNT = 100_000;
const PRIOR_WEIGHT = 4;

export interface PersistedConceptEvidence {
  id: StrategyConceptId | string;
  label?: string;
  attempts?: number;
  strong?: number;
  needsWork?: number;
  moves?: number | readonly unknown[];
}

/**
 * Structural extension used while older GameRecord rows are still in storage.
 * The core review type may add these fields without this module needing a
 * migration or an unsafe cast at each call site.
 */
export type StrategyGameRecord = GameRecord & {
  concepts?: readonly PersistedConceptEvidence[];
  humanColor?: Player;
};

export interface PuzzleSkillEvidence {
  id?: string;
  gameId: string;
  conceptIds?: readonly StrategyConceptId[];
  solved: boolean;
  /** Number of submitted attempts represented by this row. Defaults to one. */
  attempts?: number;
  at?: number;
}

export interface StrategyProfileInput {
  reviews?: readonly StrategyGameRecord[];
  /** Pass the real profile store or a persisted subset of it. */
  profile?: {
    rating?: number;
    stats?: Record<string, Tally>;
  };
  /** Convenient override for callers that already selected the stats field. */
  stats?: Record<string, Tally>;
  puzzleEvidence?: readonly PuzzleSkillEvidence[];
  now?: number;
}

export interface ConceptSourceCounts {
  /** Engine-graded or explicitly classified move decisions. */
  moves: number;
  /** Completed match results from the player profile. */
  matches: number;
  /** Submitted puzzle/drill attempts. */
  puzzles: number;
  /** Review sessions containing direct concept evidence. */
  reviews: number;
}

export interface ConceptGameEvidence {
  gameId: string;
  gameName: string;
  evidenceCount: number;
  score: number;
}

export interface StrategyDimension {
  id: StrategyConceptId;
  concept: StrategyConcept;
  /**
   * Calibrated 0–100 score. It starts at 50 and moves away from the prior only
   * when actual evidence exists; it is not a percentile or rank.
   */
  score: number;
  /** 0–97: how much evidence supports the score, never a claim of certainty. */
  confidence: number;
  /** Actual concept-relevant observations, before affinity weighting. */
  evidenceCount: number;
  strongCount: number;
  needsWorkCount: number;
  sources: ConceptSourceCounts;
  games: ConceptGameEvidence[];
  state: 'unmeasured' | 'emerging' | 'developing' | 'established';
}

export interface StrategyProfileDataQuality {
  reviewRecords: number;
  directConceptReviews: number;
  legacyReviews: number;
  attributedReviewMoves: number;
  matches: number;
  puzzles: number;
}

export interface StrategyProfile {
  generatedAt: number;
  rating: number | null;
  dimensions: StrategyDimension[];
  strengths: StrategyDimension[];
  growthAreas: StrategyDimension[];
  totalEvidence: number;
  measuredConcepts: number;
  dataQuality: StrategyProfileDataQuality;
}

interface Accumulator {
  weightedEvidence: number;
  weightedScore: number;
  evidenceCount: number;
  strongCount: number;
  needsWorkCount: number;
  sources: ConceptSourceCounts;
  games: Map<string, { evidence: number; weightedEvidence: number; weightedScore: number }>;
}

function cleanCount(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(MAX_COUNT, Math.floor(value))
    : fallback;
}

function emptyAccumulator(): Accumulator {
  return {
    weightedEvidence: 0,
    weightedScore: 0,
    evidenceCount: 0,
    strongCount: 0,
    needsWorkCount: 0,
    sources: { moves: 0, matches: 0, puzzles: 0, reviews: 0 },
    games: new Map(),
  };
}

function recordEvidence(
  bucket: Accumulator,
  gameId: string,
  observations: number,
  quality: number,
  weight: number,
  source: keyof Omit<ConceptSourceCounts, 'reviews'>,
  strong = 0,
  needsWork = 0,
): void {
  const count = cleanCount(observations);
  if (!count || !Number.isFinite(quality) || !Number.isFinite(weight) || weight <= 0) return;
  const safeQuality = Math.max(0, Math.min(1, quality));
  const safeWeight = Math.max(0.1, Math.min(1, weight));
  const weighted = count * safeWeight;
  bucket.evidenceCount = Math.min(MAX_COUNT, bucket.evidenceCount + count);
  bucket.weightedEvidence += weighted;
  bucket.weightedScore += safeQuality * weighted;
  bucket.sources[source] = Math.min(MAX_COUNT, bucket.sources[source] + count);
  bucket.strongCount = Math.min(MAX_COUNT, bucket.strongCount + Math.min(count, cleanCount(strong)));
  bucket.needsWorkCount = Math.min(MAX_COUNT, bucket.needsWorkCount + Math.min(count, cleanCount(needsWork)));

  const game = bucket.games.get(gameId) ?? { evidence: 0, weightedEvidence: 0, weightedScore: 0 };
  game.evidence = Math.min(MAX_COUNT, game.evidence + count);
  game.weightedEvidence += weighted;
  game.weightedScore += safeQuality * weighted;
  bucket.games.set(gameId, game);
}

function countMoves(value: PersistedConceptEvidence['moves']): number {
  if (Array.isArray(value)) return Math.min(MAX_COUNT, value.length);
  return cleanCount(value);
}

function directConceptEvidence(
  review: StrategyGameRecord,
  buckets: Record<StrategyConceptId, Accumulator>,
): boolean {
  if (!Array.isArray(review.concepts) || review.concepts.length === 0) return false;
  const seen = new Set<StrategyConceptId>();
  let accepted = false;
  for (const raw of review.concepts) {
    if (!raw || !isStrategyConceptId(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const strong = cleanCount(raw.strong);
    const needsWork = cleanCount(raw.needsWork);
    const attempts = Math.max(
      cleanCount(raw.attempts),
      countMoves(raw.moves),
      Math.min(MAX_COUNT, strong + needsWork),
    );
    if (!attempts) continue;
    const boundedStrong = Math.min(attempts, strong);
    const boundedNeeds = Math.min(attempts - boundedStrong, needsWork);
    const neutral = attempts - boundedStrong - boundedNeeds;
    const quality = (boundedStrong + neutral * .62 + boundedNeeds * .18) / attempts;
    const bucket = buckets[raw.id];
    recordEvidence(bucket, review.gameId, attempts, quality, 1, 'moves', boundedStrong, boundedNeeds);
    bucket.sources.reviews = Math.min(MAX_COUNT, bucket.sources.reviews + 1);
    accepted = true;
  }
  return accepted;
}

function reviewMoveEvidence(
  review: StrategyGameRecord,
  buckets: Record<StrategyConceptId, Accumulator>,
): number {
  if ((review.humanColor !== 0 && review.humanColor !== 1) || !review.graded) return 0;
  const attempts = cleanCount(review.graded[review.humanColor]);
  if (!attempts) return 0;
  const accuracy = Math.max(0, Math.min(100, Number(review.acc[review.humanColor]) || 0)) / 100;
  for (const affinity of affinitiesForGame(review.gameId)) {
    const bucket = buckets[affinity.conceptId];
    recordEvidence(bucket, review.gameId, attempts, accuracy, affinity.weight, 'moves');
    bucket.sources.reviews = Math.min(MAX_COUNT, bucket.sources.reviews + 1);
  }
  return attempts;
}

function addMatchEvidence(
  stats: Record<string, Tally>,
  buckets: Record<StrategyConceptId, Accumulator>,
): number {
  let total = 0;
  for (const [gameId, raw] of Object.entries(stats)) {
    if (!GAME_MAP[gameId] || !raw || typeof raw !== 'object') continue;
    const wins = cleanCount(raw.wins);
    const losses = cleanCount(raw.losses);
    const draws = cleanCount(raw.draws);
    const recordedOutcomes = Math.min(MAX_COUNT, wins + losses + draws);
    const declaredPlayed = cleanCount(raw.played);
    const played = Math.max(declaredPlayed, recordedOutcomes);
    if (!played) continue;
    const unclassified = Math.max(0, played - Math.min(played, recordedOutcomes));
    const quality = (
      Math.min(wins, played)
      + Math.min(draws, Math.max(0, played - wins)) * .55
      + Math.min(losses, Math.max(0, played - wins - draws)) * .22
      + unclassified * .5
    ) / played;
    total = Math.min(MAX_COUNT, total + played);
    for (const affinity of affinitiesForGame(gameId)) {
      recordEvidence(buckets[affinity.conceptId], gameId, played, quality, affinity.weight, 'matches');
    }
  }
  return total;
}

function addPuzzleEvidence(
  evidence: readonly PuzzleSkillEvidence[],
  buckets: Record<StrategyConceptId, Accumulator>,
): number {
  let total = 0;
  for (const row of evidence.slice(0, 10_000)) {
    if (!row || !GAME_MAP[row.gameId]) continue;
    const attempts = Math.max(1, cleanCount(row.attempts, 1));
    const concepts = Array.from(new Set(
      row.conceptIds?.filter(isStrategyConceptId)
      ?? affinitiesForGame(row.gameId).slice(0, 2).map((entry) => entry.conceptId),
    ));
    if (!concepts.length) continue;
    // Solving after several submissions is still positive evidence, but the
    // score reflects that the pattern was not recognised immediately.
    const quality = row.solved
      ? Math.max(.58, 1 - Math.max(0, attempts - 1) * .08)
      : .18;
    total = Math.min(MAX_COUNT, total + attempts);
    for (const conceptId of concepts) {
      const weight = affinitiesForGame(row.gameId)
        .find((entry) => entry.conceptId === conceptId)?.weight ?? 1;
      recordEvidence(
        buckets[conceptId],
        row.gameId,
        attempts,
        quality,
        weight,
        'puzzles',
        row.solved ? 1 : 0,
        row.solved ? 0 : 1,
      );
    }
  }
  return total;
}

function dimensionState(confidence: number): StrategyDimension['state'] {
  if (confidence === 0) return 'unmeasured';
  if (confidence < 25) return 'emerging';
  if (confidence < 60) return 'developing';
  return 'established';
}

function toDimension(concept: StrategyConcept, bucket: Accumulator): StrategyDimension {
  const evidenceScore = bucket.weightedEvidence > 0
    ? bucket.weightedScore / bucket.weightedEvidence
    : .5;
  const score = Math.round(
    ((evidenceScore * bucket.weightedEvidence + .5 * PRIOR_WEIGHT)
      / (bucket.weightedEvidence + PRIOR_WEIGHT)) * 100,
  );
  const confidence = bucket.weightedEvidence <= 0
    ? 0
    : Math.min(97, Math.round((1 - Math.exp(-bucket.weightedEvidence / 18)) * 100));
  const games = Array.from(bucket.games.entries())
    .map(([gameId, game]): ConceptGameEvidence => ({
      gameId,
      gameName: GAME_MAP[gameId]?.name ?? gameId,
      evidenceCount: game.evidence,
      score: Math.round((game.weightedScore / Math.max(.0001, game.weightedEvidence)) * 100),
    }))
    .sort((a, b) => b.evidenceCount - a.evidenceCount || b.score - a.score || a.gameName.localeCompare(b.gameName));
  return {
    id: concept.id,
    concept,
    score,
    confidence,
    evidenceCount: bucket.evidenceCount,
    strongCount: bucket.strongCount,
    needsWorkCount: bucket.needsWorkCount,
    sources: { ...bucket.sources },
    games,
    state: dimensionState(confidence),
  };
}

export function buildStrategyProfile(input: StrategyProfileInput = {}): StrategyProfile {
  const buckets = Object.fromEntries(
    STRATEGY_CONCEPTS.map((concept) => [concept.id, emptyAccumulator()]),
  ) as Record<StrategyConceptId, Accumulator>;
  const reviews = Array.isArray(input.reviews) ? input.reviews.slice(0, 1_000) : [];
  let directConceptReviews = 0;
  let legacyReviews = 0;
  let attributedReviewMoves = 0;

  for (const review of reviews) {
    if (directConceptEvidence(review, buckets)) {
      directConceptReviews += 1;
      continue;
    }
    const moves = reviewMoveEvidence(review, buckets);
    if (moves > 0) attributedReviewMoves = Math.min(MAX_COUNT, attributedReviewMoves + moves);
    else legacyReviews += 1;
  }

  const stats = input.stats ?? input.profile?.stats ?? {};
  const matches = addMatchEvidence(stats, buckets);
  const puzzles = addPuzzleEvidence(input.puzzleEvidence ?? [], buckets);
  const dimensions = STRATEGY_CONCEPTS.map((concept) => toDimension(concept, buckets[concept.id]));
  const measured = dimensions.filter((dimension) => dimension.evidenceCount > 0);
  const rankable = measured.filter((dimension) => dimension.confidence >= 12);
  const strengths = rankable
    .slice()
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, 3);
  const growthAreas = rankable
    .slice()
    .sort((a, b) => a.score - b.score || b.confidence - a.confidence)
    .slice(0, 3);
  return {
    generatedAt: typeof input.now === 'number' && Number.isFinite(input.now) && input.now >= 0
      ? input.now
      : Date.now(),
    rating: typeof input.profile?.rating === 'number' && Number.isFinite(input.profile.rating)
      ? Math.max(0, Math.round(input.profile.rating))
      : null,
    dimensions,
    strengths,
    growthAreas,
    totalEvidence: dimensions.reduce((sum, dimension) => sum + dimension.evidenceCount, 0),
    measuredConcepts: measured.length,
    dataQuality: {
      reviewRecords: reviews.length,
      directConceptReviews,
      legacyReviews,
      attributedReviewMoves,
      matches,
      puzzles,
    },
  };
}

export function strategyDimension(
  profile: StrategyProfile,
  conceptId: StrategyConceptId,
): StrategyDimension {
  return profile.dimensions.find((dimension) => dimension.id === conceptId)
    ?? toDimension(
      STRATEGY_CONCEPTS.find((concept) => concept.id === conceptId)!,
      emptyAccumulator(),
    );
}
