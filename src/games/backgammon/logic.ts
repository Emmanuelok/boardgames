/**
 * Backgammon — self-contained rules + AI logic module.
 *
 * Standard backgammon, 2 players, 15 checkers each.
 *   Player 0 = "White": home = points 0–5, bears off toward index 0,
 *                       moves from HIGH index toward LOW  (to = from - die).
 *   Player 1 = "Black": home = points 18–23, bears off toward index 23,
 *                       moves from LOW  index toward HIGH (to = from + die).
 *
 * `points` is a length-24 array where a positive value is that many White
 * checkers on the point, a negative value is that many Black checkers, and 0
 * is empty. The bar and the borne-off trays are tracked separately, always as
 * non-negative counts, indexed [white, black].
 *
 * Everything here is pure: no module-level mutable state, no I/O. Functions
 * never mutate their arguments — they return fresh state objects.
 */

import type { Player } from '../../engine/types';

const WHITE: Player = 0;
const BLACK: Player = 1;
const NUM_POINTS = 24;
const CHECKERS_PER_SIDE = 15;

export interface BgState {
  points: number[]; // length 24; >0 = White count, <0 = Black count, 0 = empty
  bar: [number, number]; // [white, black] checkers on the bar
  off: [number, number]; // [white, black] checkers borne off
  turn: Player;
  dice: number[]; // remaining dice to play this turn (doubles → 4 entries); [] before a roll
}

export interface BgMove {
  from: number | 'bar';
  to: number | 'off';
  die: number;
}

/* --------------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------------ */

/** Deep-ish clone of a state (arrays copied, scalars by value). */
function cloneState(s: BgState): BgState {
  return {
    points: s.points.slice(),
    bar: [s.bar[0], s.bar[1]],
    off: [s.off[0], s.off[1]],
    turn: s.turn,
    dice: s.dice.slice(),
  };
}

/** +1 for White checkers' sign, -1 for Black's sign on the `points` array. */
function sign(player: Player): number {
  return player === WHITE ? 1 : -1;
}

/** How many of `player`'s checkers sit on point `p` (always ≥ 0). */
function countAt(points: number[], player: Player, p: number): number {
  const v = points[p];
  return player === WHITE ? Math.max(0, v) : Math.max(0, -v);
}

/** How many ENEMY checkers (relative to `player`) sit on point `p` (≥ 0). */
function enemyCountAt(points: number[], player: Player, p: number): number {
  const v = points[p];
  return player === WHITE ? Math.max(0, -v) : Math.max(0, v);
}

/** True if `player` may land on point `p` (open / own / a single enemy blot). */
function canLandOn(points: number[], player: Player, p: number): boolean {
  return enemyCountAt(points, player, p) <= 1;
}

/** The destination index for a normal move of `player` from `from` using `die`. */
function destOf(player: Player, from: number, die: number): number {
  return player === WHITE ? from - die : from + die;
}

/** Index of the point a bar checker re-enters on for `player` using `die`. */
function entryPoint(player: Player, die: number): number {
  // White enters into Black's home (18–23) on point 24 - die.
  // Black enters into White's home (0–5)  on point die - 1.
  return player === WHITE ? NUM_POINTS - die : die - 1;
}

/** The home-board point range [lo, hi] (inclusive) for `player`. */
function homeRange(player: Player): [number, number] {
  return player === WHITE ? [0, 5] : [18, 23];
}

/**
 * Distance (in pips) a checker on point `p` is from being borne off, for the
 * given player. White bears off point p with die p+1; Black with die 24-p.
 */
function bearOffDie(player: Player, p: number): number {
  return player === WHITE ? p + 1 : NUM_POINTS - p;
}

/** True if every one of `player`'s checkers is in the home board (none on bar). */
function allHome(s: BgState, player: Player): boolean {
  if (s.bar[player] > 0) return false;
  const [lo, hi] = homeRange(player);
  let homeCount = s.off[player];
  for (let p = lo; p <= hi; p++) homeCount += countAt(s.points, player, p);
  return homeCount === CHECKERS_PER_SIDE;
}

/**
 * Highest-pip occupied home point for the player, expressed as the bear-off die
 * it would require (i.e. the largest `bearOffDie` among occupied home points).
 * Returns 0 if the home board is empty. Used for the "bear off with a higher
 * die only if no checkers sit on higher points" rule.
 */
function maxHomeBearDie(s: BgState, player: Player): number {
  const [lo, hi] = homeRange(player);
  let maxDie = 0;
  for (let p = lo; p <= hi; p++) {
    if (countAt(s.points, player, p) > 0) {
      const d = bearOffDie(player, p);
      if (d > maxDie) maxDie = d;
    }
  }
  return maxDie;
}

/* --------------------------------------------------------------------------
 * Initial position & dice
 * ------------------------------------------------------------------------ */

/**
 * Canonical opening position.
 * White (positive): 2 on point 23, 5 on point 12, 3 on point 7, 5 on point 5.
 * Black (negative): mirror image at 23-p → 2 on 0, 5 on 11, 3 on 16, 5 on 18.
 * Each side totals 15 checkers; dice empty; White (0) to move.
 */
export function initialState(): BgState {
  const points = new Array<number>(NUM_POINTS).fill(0);
  // White
  points[23] = 2;
  points[12] = 5;
  points[7] = 3;
  points[5] = 5;
  // Black (mirror)
  points[0] = -2;
  points[11] = -5;
  points[16] = -3;
  points[18] = -5;
  return {
    points,
    bar: [0, 0],
    off: [0, 0],
    turn: WHITE,
    dice: [],
  };
}

/**
 * Roll two six-sided dice. On doubles, returns four copies (e.g. [3,3,3,3]).
 * `rng` should return a float in [0,1); defaults to Math.random.
 */
export function rollDice(rng: () => number = Math.random): number[] {
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  if (d1 === d2) return [d1, d1, d1, d1];
  return [d1, d2];
}

/** Set the remaining dice for the turn (does NOT change whose turn it is). */
export function withRoll(s: BgState, dice: number[]): BgState {
  const next = cloneState(s);
  next.dice = dice.slice();
  return next;
}

/* --------------------------------------------------------------------------
 * Legal move generation
 * ------------------------------------------------------------------------ */

/**
 * Generate every single-checker move the side to move could play RIGHT NOW
 * with one of the remaining dice, *before* the must-use-both/larger-die
 * filtering. Each distinct die value is considered once (duplicates of the
 * same destination are de-duplicated).
 */
function rawMoves(s: BgState): BgMove[] {
  const player = s.turn;
  const moves: BgMove[] = [];
  const seen = new Set<string>();
  const dieValues = uniqueDice(s.dice);

  const push = (m: BgMove) => {
    const key = `${m.from}|${m.to}|${m.die}`;
    if (!seen.has(key)) {
      seen.add(key);
      moves.push(m);
    }
  };

  // 1) Bar re-entry is mandatory while any checker is on the bar.
  if (s.bar[player] > 0) {
    for (const die of dieValues) {
      const p = entryPoint(player, die);
      if (p >= 0 && p < NUM_POINTS && canLandOn(s.points, player, p)) {
        push({ from: 'bar', to: p, die });
      }
    }
    return moves;
  }

  const canBear = allHome(s, player);
  const maxBearDie = canBear ? maxHomeBearDie(s, player) : 0;

  // 2) Normal moves and bear-offs from every point holding our checkers.
  for (let from = 0; from < NUM_POINTS; from++) {
    if (countAt(s.points, player, from) === 0) continue;
    for (const die of dieValues) {
      const to = destOf(player, from, die);
      if (to >= 0 && to < NUM_POINTS) {
        if (canLandOn(s.points, player, to)) push({ from, to, die });
      } else if (canBear) {
        // Destination is off the board → potential bear-off.
        const exact = bearOffDie(player, from);
        if (die === exact) {
          // Exact bear-off: the die matches this point precisely.
          push({ from, to: 'off', die });
        } else if (die > exact && exact === maxBearDie) {
          // Overshoot: a larger die may bear a checker off only when this is
          // the highest occupied home point (no checkers sit on a higher pip).
          push({ from, to: 'off', die });
        }
      }
    }
  }
  return moves;
}

/** Distinct die values among the remaining dice (order preserved by value). */
function uniqueDice(dice: number[]): number[] {
  const set = new Set<number>();
  for (const d of dice) set.add(d);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * All single-checker moves playable right now, AFTER applying the standard
 * "use as many dice as possible / must use the larger if only one fits"
 * restriction. This is what the UI and AI should consume.
 */
export function legalMoves(s: BgState): BgMove[] {
  if (s.dice.length === 0) return [];
  const candidates = rawMoves(s);
  if (candidates.length === 0) return [];

  // Determine the maximum number of dice that CAN be played from here over the
  // rest of the turn. A move is only legal if playing it keeps open a line that
  // achieves that maximum (so we never throw away a die we were able to use).
  const maxPlayable = maxDiceSequence(s);
  if (maxPlayable <= 0) return [];

  const allowed: BgMove[] = [];
  for (const m of candidates) {
    const after = applyMoveRaw(s, m);
    // After playing m we must still be able to play (maxPlayable - 1) dice.
    if (1 + maxDiceSequence(after) >= maxPlayable) {
      allowed.push(m);
    }
  }

  // Edge case: with non-doubles where only one of the two dice can ever be
  // played, the rules require playing the LARGER die if a choice exists.
  if (maxPlayable === 1 && s.dice.length === 2 && s.dice[0] !== s.dice[1]) {
    const playableDice = new Set(allowed.map((m) => m.die));
    if (playableDice.size === 2) {
      const larger = Math.max(s.dice[0], s.dice[1]);
      return allowed.filter((m) => m.die === larger);
    }
  }

  return allowed.length > 0 ? allowed : candidates;
}

/**
 * The greatest number of dice that can be consumed from state `s` by some
 * legal sequence of single-checker moves. Used to enforce "play as many dice
 * as possible". Bounded recursion (≤ 4 dice) so this is cheap.
 */
function maxDiceSequence(s: BgState): number {
  if (s.dice.length === 0) return 0;
  const moves = rawMoves(s);
  if (moves.length === 0) return 0;
  let best = 0;
  for (const m of moves) {
    const after = applyMoveRaw(s, m);
    const depth = 1 + maxDiceSequence(after);
    if (depth > best) best = depth;
    if (best >= s.dice.length) break; // can't do better than using every die
  }
  return best;
}

/* --------------------------------------------------------------------------
 * Applying moves
 * ------------------------------------------------------------------------ */

/**
 * Core move application without legality re-checking (assumes `m` came from a
 * generated move list). Consumes one matching die, relocates the checker,
 * sends a hit blot to the bar, or bears the checker off.
 */
function applyMoveRaw(s: BgState, m: BgMove): BgState {
  const next = cloneState(s);
  const player = next.turn;
  const sgn = sign(player);

  // Consume one die of the matching value.
  const idx = next.dice.indexOf(m.die);
  if (idx >= 0) next.dice.splice(idx, 1);

  // Remove the checker from its source.
  if (m.from === 'bar') {
    next.bar[player] -= 1;
  } else {
    next.points[m.from] -= sgn;
  }

  // Place it at the destination.
  if (m.to === 'off') {
    next.off[player] += 1;
  } else {
    const dest = m.to;
    // Hit a lone enemy blot, if present.
    if (enemyCountAt(next.points, player, dest) === 1) {
      const enemy: Player = player === WHITE ? BLACK : WHITE;
      next.points[dest] = 0; // remove the lone blot
      next.bar[enemy] += 1;
    }
    next.points[dest] += sgn;
  }

  return next;
}

/**
 * Public move application. Plays one checker move, returning a fresh state.
 * Mirrors {@link applyMoveRaw}; kept separate so callers always go through a
 * stable, documented entry point.
 */
export function applyMove(s: BgState, m: BgMove): BgState {
  return applyMoveRaw(s, m);
}

/* --------------------------------------------------------------------------
 * Turn flow
 * ------------------------------------------------------------------------ */

/** True if the dice are exhausted OR no legal move remains. */
export function turnIsOver(s: BgState): boolean {
  if (s.dice.length === 0) return true;
  return legalMoves(s).length === 0;
}

/** Switch the turn and clear the dice (the caller then rolls). */
export function endTurn(s: BgState): BgState {
  const next = cloneState(s);
  next.turn = (s.turn ^ 1) as Player;
  next.dice = [];
  return next;
}

/** A player who has borne off all 15 checkers, else null. */
export function winner(s: BgState): Player | null {
  if (s.off[WHITE] >= CHECKERS_PER_SIDE) return WHITE;
  if (s.off[BLACK] >= CHECKERS_PER_SIDE) return BLACK;
  return null;
}

/* --------------------------------------------------------------------------
 * Evaluation
 * ------------------------------------------------------------------------ */

/**
 * Pip count for a player: total pips needed to bring every checker home and
 * bear it off. Lower is better for that player. Bar checkers count as the full
 * 25 pips (entry point distance + home distance).
 */
function pipCount(s: BgState, player: Player): number {
  let pips = s.bar[player] * 25;
  for (let p = 0; p < NUM_POINTS; p++) {
    const c = countAt(s.points, player, p);
    if (c > 0) pips += c * bearOffDie(player, p);
  }
  // Borne-off checkers contribute 0.
  return pips;
}

/** Count of points where `player` has a "made point" (≥ 2 checkers). */
function madePoints(s: BgState, player: Player): number {
  let made = 0;
  for (let p = 0; p < NUM_POINTS; p++) {
    if (countAt(s.points, player, p) >= 2) made += 1;
  }
  return made;
}

/** Count of exposed blots (exactly one checker) for `player`. */
function blotCount(s: BgState, player: Player): number {
  let blots = 0;
  for (let p = 0; p < NUM_POINTS; p++) {
    if (countAt(s.points, player, p) === 1) blots += 1;
  }
  return blots;
}

/**
 * "Back checkers" still deep in the opponent's territory — these are the
 * runners that need to escape. For White, points 18–23; for Black, points 0–5.
 */
function backCheckers(s: BgState, player: Player): number {
  const [lo, hi] = player === WHITE ? [18, 23] : [0, 5];
  let n = 0;
  for (let p = lo; p <= hi; p++) n += countAt(s.points, player, p);
  return n;
}

/**
 * Static evaluation. Positive favours White (player 0), negative favours Black.
 * Combines pip-count race (dominant term) with structural bonuses: made points,
 * fewer exposed blots, checkers already borne off, and escaping back checkers.
 */
export function evaluate(s: BgState): number {
  const w = winner(s);
  if (w === WHITE) return 100000;
  if (w === BLACK) return -100000;

  const pipW = pipCount(s, WHITE);
  const pipB = pipCount(s, BLACK);

  // Race: being ahead in the pip count is the core of the position.
  let score = (pipB - pipW) * 1.0;

  // Borne-off checkers are concretely good.
  score += (s.off[WHITE] - s.off[BLACK]) * 3.0;

  // Structure: made points add board control; blots are liabilities.
  score += (madePoints(s, WHITE) - madePoints(s, BLACK)) * 2.0;
  score -= (blotCount(s, WHITE) - blotCount(s, BLACK)) * 2.5;

  // Being stuck on the bar is bad; escaping back checkers is good.
  score -= (s.bar[WHITE] - s.bar[BLACK]) * 6.0;
  score -= (backCheckers(s, WHITE) - backCheckers(s, BLACK)) * 1.5;

  return score;
}

/* --------------------------------------------------------------------------
 * AI
 * ------------------------------------------------------------------------ */

/** A tiny deterministic PRNG (mulberry32) so AI behaviour is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Candidate {
  moves: BgMove[];
  state: BgState;
}

/**
 * Enumerate full move sequences for the turn. Because doubles cap the turn at
 * four checker moves and each ply has only a handful of choices, the tree is
 * tiny — but we still cap the number of leaves to stay fast and avoid path;
 * sequences are de-duplicated by resulting board signature.
 */
function enumerateSequences(s: BgState, cap: number): Candidate[] {
  const results: Candidate[] = [];
  const seenStates = new Set<string>();

  const recurse = (cur: BgState, path: BgMove[]) => {
    if (results.length >= cap) return;
    const moves = legalMoves(cur);
    if (moves.length === 0 || cur.dice.length === 0) {
      const key = stateKey(cur);
      if (!seenStates.has(key)) {
        seenStates.add(key);
        results.push({ moves: path.slice(), state: cur });
      }
      return;
    }
    for (const m of moves) {
      if (results.length >= cap) break;
      recurse(applyMoveRaw(cur, m), [...path, m]);
    }
  };

  recurse(s, []);
  // If the player legitimately has no move at all, return the unchanged state.
  if (results.length === 0) results.push({ moves: [], state: cloneState(s) });
  return results;
}

/** Compact signature of the board for sequence de-duplication. */
function stateKey(s: BgState): string {
  return `${s.points.join(',')}|${s.bar[0]},${s.bar[1]}|${s.off[0]},${s.off[1]}`;
}

/**
 * Choose and play a full turn for the side to move, given a state whose dice
 * are already rolled. Returns the chosen move sequence and the resulting state
 * (BEFORE endTurn — the caller switches turns).
 *
 * Heuristic: enumerate candidate sequences, score each resulting position with
 * {@link evaluate} from the mover's perspective, and pick a good one. Higher
 * difficulty plays more greedily (closer to the maximum); lower difficulty
 * mixes in randomness so it sometimes picks a weaker sequence.
 */
export function aiPlayTurn(
  s: BgState,
  difficulty: 'easy' | 'medium' | 'hard',
  rng: () => number = Math.random,
): { moves: BgMove[]; state: BgState } {
  const player = s.turn;
  // Perspective multiplier: White wants evaluate high, Black wants it low.
  const persp = player === WHITE ? 1 : -1;

  const cap = difficulty === 'hard' ? 600 : difficulty === 'medium' ? 300 : 150;
  const candidates = enumerateSequences(s, cap);

  // Score each candidate from the mover's point of view.
  const scored = candidates.map((c) => ({
    cand: c,
    score: evaluate(c.state) * persp + tieBreak(c, player),
  }));
  scored.sort((a, b) => b.score - a.score);

  let chosenIdx = 0;
  if (difficulty === 'easy') {
    // Easy: pick randomly among a wide band of the better sequences.
    const band = Math.max(1, Math.ceil(scored.length * 0.6));
    chosenIdx = Math.floor(rng() * band);
  } else if (difficulty === 'medium') {
    // Medium: mostly best, occasionally a small slip.
    if (scored.length > 1 && rng() < 0.25) {
      const band = Math.max(1, Math.ceil(scored.length * 0.25));
      chosenIdx = Math.floor(rng() * band);
    }
  } // hard: always the top-scoring sequence.

  if (chosenIdx >= scored.length) chosenIdx = scored.length - 1;
  const chosen = scored[chosenIdx].cand;
  return { moves: chosen.moves, state: chosen.state };
}

/**
 * Small structural tie-breaker added to the evaluation so that, among equally
 * scored end positions, the AI prefers to hit, make points, and advance back
 * checkers. Expressed from the mover's perspective (always added, never sign;
 * because it reflects the mover's own gains during the sequence).
 */
function tieBreak(c: Candidate, player: Player): number {
  let bonus = 0;
  const enemy: Player = player === WHITE ? BLACK : WHITE;
  for (const m of c.moves) {
    // Reward bearing off and re-entering from the bar (progress).
    if (m.to === 'off') bonus += 0.5;
    if (m.from === 'bar') bonus += 0.3;
  }
  // Reward sending enemy checkers to the bar over the whole sequence.
  // (c.state already reflects the result; compare via blot/bar deltas.)
  bonus += c.state.bar[enemy] * 0.4;
  return bonus;
}
