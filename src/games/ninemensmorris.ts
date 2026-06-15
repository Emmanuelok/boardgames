import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Nine Men's Morris — the ancient "mill" game on a 7×7 lattice of points.     */
/*                                                                            */
/*  Two players each command nine men. The game unfolds in three phases:       */
/*    1. PLACING  — players take turns dropping their nine men onto empty      */
/*                  points of the board.                                       */
/*    2. MOVING   — once all eighteen men are down, a player slides one man    */
/*                  along a line to an adjacent empty point.                   */
/*    3. FLYING   — when a side is ground down to exactly three men, that side */
/*                  may "fly" a man to ANY empty point, not just an adjacent   */
/*                  one — a last, desperate freedom.                           */
/*                                                                            */
/*  Whenever a placement or a slide completes a MILL — three of your men in a  */
/*  straight line — you remove one of the opponent's men (one not itself in a  */
/*  mill, unless every enemy man is milled). A player reduced to two men, or   */
/*  left with no legal move, loses.                                            */
/*                                                                            */
/*  Only 24 of the 49 grid cells are real points; the rest are dead padding    */
/*  that never holds a piece. The board's lines are supplied to the renderer   */
/*  as explicit `connections`, and those very same segments form the           */
/*  adjacency graph used for sliding moves.                                    */
/* -------------------------------------------------------------------------- */

const COLS = 7;
const N = COLS * COLS; // 49
const MEN = 9; // men per player

const rowOf = (i: number) => Math.floor(i / COLS);
const colOf = (i: number) => i % COLS;

/* ------------------------------- Geometry -------------------------------- */

/** The 24 playable points (cell indices) across the three concentric rings. */
const POINTS: number[] = [
  // Outer ring
  0, 3, 6, 21, 27, 42, 45, 48,
  // Middle ring
  8, 10, 12, 22, 26, 36, 38, 40,
  // Inner ring
  16, 17, 18, 23, 25, 30, 31, 32,
];
const POINT_SET = new Set(POINTS);

/**
 * The board's lines — these are BOTH the segments drawn by the renderer and the
 * adjacency graph for sliding moves. Two points are neighbours iff a single
 * segment joins them.
 */
const CONNECTIONS: Array<[number, number]> = [
  // Outer square
  [0, 3], [3, 6], [6, 27], [27, 48], [48, 45], [45, 42], [42, 21], [21, 0],
  // Middle square
  [8, 10], [10, 12], [12, 26], [26, 40], [40, 38], [38, 36], [36, 22], [22, 8],
  // Inner square
  [16, 17], [17, 18], [18, 25], [25, 32], [32, 31], [31, 30], [30, 23], [23, 16],
  // Cross spokes joining the three rings along the mid-lines
  [3, 10], [10, 17], [21, 22], [22, 23], [25, 26], [26, 27], [31, 38], [38, 45],
];

/** Adjacency list: for each point, the points one line-segment away. */
const ADJ: Map<number, number[]> = (() => {
  const m = new Map<number, number[]>();
  for (const p of POINTS) m.set(p, []);
  for (const [a, b] of CONNECTIONS) {
    m.get(a)!.push(b);
    m.get(b)!.push(a);
  }
  return m;
})();

/** The 16 mills — every straight three-in-a-line on the board. */
const MILLS: number[][] = [
  // Horizontal lines (top to bottom)
  [0, 3, 6], [8, 10, 12], [16, 17, 18],
  [42, 45, 48], [36, 38, 40], [30, 31, 32],
  // Vertical lines (left to right)
  [0, 21, 42], [8, 22, 36], [16, 23, 30],
  [6, 27, 48], [12, 26, 40], [18, 25, 32],
  // Cross-spoke lines
  [3, 10, 17], [21, 22, 23], [25, 26, 27], [31, 38, 45],
];

/** For each point, the mills that pass through it (precomputed for speed). */
const MILLS_THROUGH: Map<number, number[][]> = (() => {
  const m = new Map<number, number[][]>();
  for (const p of POINTS) m.set(p, []);
  for (const line of MILLS) {
    for (const p of line) m.get(p)!.push(line);
  }
  return m;
})();

/** How many of the 16 mills a point belongs to (cross-points belong to two). */
const MILL_MEMBERSHIP: Map<number, number> = (() => {
  const m = new Map<number, number>();
  for (const p of POINTS) m.set(p, MILLS_THROUGH.get(p)!.length);
  return m;
})();

/* ------------------------------- Notation -------------------------------- */
// Coordinate notation: files a–g left→right (col 0→6), ranks 7–1 top→bottom
// (rank = 7 − row), matching the app's "top row = highest rank" convention.
// "White places g4", "Black d2–d3", "White ×e4 (removes)".
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const sq = (i: number) => `${FILES[colOf(i)]}${COLS - rowOf(i)}`;
const sideName = (p: Player) => (p === 0 ? 'White' : 'Black');

/* ------------------------------ Game state ------------------------------- */

export interface NmmState {
  /** 49-cell board; only the 24 points are ever non-null. */
  board: (Player | null)[];
  turn: Player;
  /** Men already placed by each player during the placing phase (0..9). */
  placed: [number, number];
  /** True when the mover has just formed a mill and must remove an enemy man.
   *  While set, the turn does NOT pass and getLegalMoves yields removals. */
  removing: boolean;
}

export interface NmmMove extends MoveBase {
  /** Tag the move's nature so the tutor and renderer can reason about it. */
  kind?: 'place' | 'move' | 'remove';
}

/* --------------------------- State construction -------------------------- */

function createInitialState(): NmmState {
  return {
    board: Array(N).fill(null),
    turn: 0,
    placed: [0, 0],
    removing: false,
  };
}

function cloneState(s: NmmState): NmmState {
  return {
    board: s.board.slice(),
    turn: s.turn,
    placed: [s.placed[0], s.placed[1]],
    removing: s.removing,
  };
}

/* ------------------------------- Helpers --------------------------------- */

function countMen(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const p of POINTS) if (board[p] === player) n++;
  return n;
}

/** Total men a player still has "in hand" plus on the board. */
function totalMen(s: NmmState, player: Player): number {
  return countMen(s.board, player) + (MEN - s.placed[player]);
}

/** Are both players done placing all nine of their men? */
function placingDone(s: NmmState): boolean {
  return s.placed[0] >= MEN && s.placed[1] >= MEN;
}

/** Is it still the placing phase for the player to move? */
function isPlacingPhase(s: NmmState): boolean {
  return !placingDone(s);
}

/** Does `player` get to fly (exactly three men on the board, placing done)? */
function isFlying(s: NmmState, player: Player): boolean {
  return placingDone(s) && countMen(s.board, player) === 3;
}

/**
 * Returns true if, on `board`, the point `at` (owned by `player`) is part of a
 * completed mill. Checks only mills that pass through `at` — exactly what we
 * need right after a man lands on `at`.
 */
function formsMill(board: (Player | null)[], at: number, player: Player): boolean {
  for (const line of MILLS_THROUGH.get(at)!) {
    if (line[0] !== at && board[line[0]] !== player) continue;
    if (line[1] !== at && board[line[1]] !== player) continue;
    if (line[2] !== at && board[line[2]] !== player) continue;
    if (board[line[0]] === player && board[line[1]] === player && board[line[2]] === player) {
      return true;
    }
  }
  return false;
}

/** Is the man at `at` currently sitting inside any completed mill? */
function inAnyMill(board: (Player | null)[], at: number): boolean {
  const owner = board[at];
  if (owner === null) return false;
  for (const line of MILLS_THROUGH.get(at)!) {
    if (board[line[0]] === owner && board[line[1]] === owner && board[line[2]] === owner) {
      return true;
    }
  }
  return false;
}

/** Total number of completed mills `player` currently holds. */
function countMills(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const line of MILLS) {
    if (board[line[0]] === player && board[line[1]] === player && board[line[2]] === player) n++;
  }
  return n;
}

/**
 * Number of "near-mills" for `player`: lines holding two of the player's men
 * with the third point empty (one move from closing — a live threat).
 */
function countNearMills(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const line of MILLS) {
    let mine = 0;
    let empty = 0;
    for (const p of line) {
      if (board[p] === player) mine++;
      else if (board[p] === null) empty++;
    }
    if (mine === 2 && empty === 1) n++;
  }
  return n;
}

/** The empty point that would complete a two-man line for `player`, or -1. */
function nearMillGap(board: (Player | null)[], line: number[], player: Player): number {
  let mine = 0;
  let gap = -1;
  for (const p of line) {
    if (board[p] === player) mine++;
    else if (board[p] === null) gap = p;
    else return -1; // an enemy man blocks the line
  }
  return mine === 2 && gap !== -1 ? gap : -1;
}

/** Every empty point that would complete a mill for `player` right now. */
function millCompletions(board: (Player | null)[], player: Player): Set<number> {
  const out = new Set<number>();
  for (const line of MILLS) {
    const gap = nearMillGap(board, line, player);
    if (gap !== -1) out.add(gap);
  }
  return out;
}

/** Men of `player` that can be legally removed (not in a mill, unless all are). */
function removableMen(board: (Player | null)[], player: Player): number[] {
  const all: number[] = [];
  const free: number[] = [];
  for (const p of POINTS) {
    if (board[p] !== player) continue;
    all.push(p);
    if (!inAnyMill(board, p)) free.push(p);
  }
  return free.length > 0 ? free : all;
}

/* ----------------------------- Move generation --------------------------- */

function placementMoves(s: NmmState): NmmMove[] {
  const moves: NmmMove[] = [];
  const side = sideName(s.turn);
  for (const p of POINTS) {
    if (s.board[p] !== null) continue;
    moves.push({
      id: `p${p}`,
      to: p, // placement: `from` omitted
      notation: `${side} places ${sq(p)}`,
      kind: 'place',
    });
  }
  return moves;
}

function relocationMoves(s: NmmState, fromCell?: number | null): NmmMove[] {
  const moves: NmmMove[] = [];
  const fly = isFlying(s, s.turn);
  const side = sideName(s.turn);

  const sources = fromCell !== undefined && fromCell !== null
    ? (s.board[fromCell] === s.turn ? [fromCell] : [])
    : POINTS.filter((p) => s.board[p] === s.turn);

  for (const from of sources) {
    const dests = fly ? POINTS : ADJ.get(from)!;
    for (const to of dests) {
      if (to === from) continue;
      if (s.board[to] !== null) continue;
      moves.push({
        id: `m${from}-${to}`,
        from,
        to,
        notation: `${side} ${sq(from)}–${sq(to)}`,
        kind: 'move',
      });
    }
  }
  return moves;
}

function removalMoves(s: NmmState): NmmMove[] {
  const opp = (s.turn ^ 1) as Player;
  const side = sideName(s.turn);
  const targets = removableMen(s.board, opp);
  return targets.map((p) => ({
    id: `x${p}`,
    to: p, // removal: `from` omitted, targets an enemy man
    notation: `${side} ×${sq(p)} (removes)`,
    capture: true,
    kind: 'remove',
  }));
}

/**
 * Legal moves for the side to move. The state machine routes by phase:
 *   • removing flag set → removals only (turn stays put until one is played).
 *   • placing phase     → placements on empty points.
 *   • otherwise         → slides/flies, optionally restricted to `fromCell`.
 */
function legalMoves(s: NmmState, fromCell?: number | null): NmmMove[] {
  if (getStatus(s).kind !== 'playing') return [];
  if (s.removing) return removalMoves(s);
  if (isPlacingPhase(s)) return placementMoves(s);
  return relocationMoves(s, fromCell);
}

/* ------------------------------- Apply move ------------------------------ */

function applyMove(s: NmmState, m: NmmMove): NmmState {
  const next = cloneState(s);
  const mover = s.turn;

  if (s.removing) {
    // Resolve the pending capture, then pass the turn.
    next.board[m.to] = null;
    next.removing = false;
    next.turn = (mover ^ 1) as Player;
    return next;
  }

  if (m.from === undefined) {
    // PLACEMENT during the placing phase.
    next.board[m.to] = mover;
    next.placed[mover] = s.placed[mover] + 1;
  } else {
    // RELOCATION (slide or fly).
    next.board[m.from] = null;
    next.board[m.to] = mover;
  }

  // A mill formed through the just-occupied point hands the mover a removal.
  if (formsMill(next.board, m.to, mover)) {
    const opp = (mover ^ 1) as Player;
    // Only enter the removal sub-phase if there is in fact a man to take.
    if (removableMen(next.board, opp).length > 0) {
      next.removing = true;
      next.turn = mover; // turn stays with the mover for the capture
      return next;
    }
  }

  next.turn = (mover ^ 1) as Player;
  return next;
}

/* ------------------------------- Evaluation ------------------------------ */

// Tuned weights — material dominates, structure and freedom refine.
const W_MAN = 100;       // each man (placed) is the backbone of the score
const W_MILL = 28;       // a completed mill: a standing removal threat to swing
const W_NEAR = 14;       // a two-in-a-line one move from a mill
const W_MOBILITY = 4;    // per available slide (in the moving phase)
const W_BLOCKED = 6;     // per enemy man with no free neighbour (pinned)
const W_DOUBLE = 10;     // bonus for points sitting on two mills (cross-points)

/** Count enemy men that are completely blocked (every neighbour occupied). */
function blockedMen(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const p of POINTS) {
    if (board[p] !== player) continue;
    let free = false;
    for (const q of ADJ.get(p)!) {
      if (board[q] === null) { free = true; break; }
    }
    if (!free) n++;
  }
  return n;
}

/** Sum of two-mill ("cross") points a player occupies — structural value. */
function crossControl(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const p of POINTS) {
    if (board[p] === player && MILL_MEMBERSHIP.get(p)! >= 2) n++;
  }
  return n;
}

/**
 * Static evaluation from White (player 0)'s perspective; positive favours White.
 * Material (men still in the game) dominates; on top we reward completed mills,
 * live near-mills, mobility, control of the double-mill cross-points, and the
 * number of enemy men we have pinned.
 */
function evaluate(s: NmmState): number {
  // Terminal positions are decisive.
  const st = getStatus(s);
  if (st.kind === 'win') return st.winner === 0 ? WIN : -WIN;

  const board = s.board;
  let score = 0;

  // Material: men on the board plus men still to be placed.
  const whiteMen = totalMen(s, 0);
  const blackMen = totalMen(s, 1);
  score += (whiteMen - blackMen) * W_MAN;

  // Completed mills (each a removal lever).
  score += (countMills(board, 0) - countMills(board, 1)) * W_MILL;

  // Live near-mills (threats to close next turn).
  score += (countNearMills(board, 0) - countNearMills(board, 1)) * W_NEAR;

  // Control of the cross-points that belong to two mills at once.
  score += (crossControl(board, 0) - crossControl(board, 1)) * W_DOUBLE;

  // Pinning the opponent: their blocked men count against them.
  score += (blockedMen(board, 1) - blockedMen(board, 0)) * W_BLOCKED;

  // Mobility matters only once we are sliding men around.
  if (placingDone(s)) {
    const whiteMob = relocationMovesCount(s, 0);
    const blackMob = relocationMovesCount(s, 1);
    score += (whiteMob - blackMob) * W_MOBILITY;
  }

  return score;
}

/** Slide/fly count for `player` regardless of whose turn it is (for eval). */
function relocationMovesCount(s: NmmState, player: Player): number {
  const fly = placingDone(s) && countMen(s.board, player) === 3;
  let n = 0;
  for (const from of POINTS) {
    if (s.board[from] !== player) continue;
    const dests = fly ? POINTS : ADJ.get(from)!;
    for (const to of dests) {
      if (to !== from && s.board[to] === null) n++;
    }
  }
  return n;
}

/* ---------------------------- Status & winning --------------------------- */

function getStatus(s: NmmState): GameStatus {
  // Loss conditions only bite once the placing phase is over.
  if (placingDone(s)) {
    const whiteMen = countMen(s.board, 0);
    const blackMen = countMen(s.board, 1);
    if (whiteMen <= 2) return { kind: 'win', winner: 1, reason: 'reduced to two men' };
    if (blackMen <= 2) return { kind: 'win', winner: 0, reason: 'reduced to two men' };

    // A player to move (moving phase, not flying, not mid-capture) who is
    // completely stuck loses. Flyers can always reach an empty point, so they
    // are never stalemated while above two men.
    if (!s.removing) {
      const mover = s.turn;
      if (!isFlying(s, mover) && relocationMovesCount(s, mover) === 0) {
        return { kind: 'win', winner: (mover ^ 1) as Player, reason: 'no moves left' };
      }
    }
  }
  return { kind: 'playing' };
}

/* ------------------------------- Board view ------------------------------ */

function getBoardView(s: NmmState): BoardView {
  const cells = s.board.map((owner, i) => {
    const playable = POINT_SET.has(i);
    return {
      index: i,
      row: rowOf(i),
      col: colOf(i),
      playable,
      piece: !playable || owner === null ? null : {
        id: `pt${i}`,
        kind: 'disc',
        player: owner,
        glyph: owner === 0 ? '⚪' : '⚫',
      },
    };
  });
  return {
    rows: COLS,
    cols: COLS,
    cells,
    fileLabels: FILES.slice(),
    rankLabels: ['7', '6', '5', '4', '3', '2', '1'],
  };
}

/* --------------------------------- Search -------------------------------- */

function searchAdapter() {
  return {
    getLegalMoves: (s: NmmState) => legalMoves(s),
    applyMove,
    getTurn: (s: NmmState) => s.turn,
    isTerminal: (s: NmmState) => getStatus(s).kind !== 'playing',
    evaluate,
    // Search captures and mill-forming moves first to sharpen alpha-beta.
    order: (s: NmmState, m: NmmMove) => {
      if (m.kind === 'remove') return 1000;
      const test = s.board.slice();
      if (m.from !== undefined) test[m.from] = null;
      test[m.to] = s.turn;
      let sc = 0;
      if (formsMill(test, m.to, s.turn)) sc += 500;
      // Prefer landing on cross-points (two-mill squares).
      sc += (MILL_MEMBERSHIP.get(m.to) ?? 0) * 5;
      return sc;
    },
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 4, easy: 2, medium: 3, hard: 4, master: 5 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.6, medium: 0.3, hard: 0.07, master: 0 };

/** A per-turn seed so easy/medium play is reproducible within a position. */
function seedOf(s: NmmState): number {
  const placedTotal = s.placed[0] + s.placed[1];
  const onBoard = countMen(s.board, 0) + countMen(s.board, 1);
  return ((placedTotal * 53 + onBoard * 131 + s.turn + (s.removing ? 7 : 0)) >>> 0) * 2654435761;
}

function chooseMove(s: NmmState, difficulty: Difficulty): NmmMove | null {
  const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
    randomness: RAND[difficulty],
    rng: mulberry32(seedOf(s)),
  });
  return res.move;
}

/* ------------------------- Tutor: explain & hint ------------------------- */

/** The mill line newly completed by a man landing on `at`, or null. */
function newMillLine(board: (Player | null)[], at: number, player: Player): number[] | null {
  for (const line of MILLS_THROUGH.get(at)!) {
    if (board[line[0]] === player && board[line[1]] === player && board[line[2]] === player) {
      return line;
    }
  }
  return null;
}

/**
 * Detect a "double mill" / "running mill" forming around `at`: a man that, by
 * occupying `at`, sits on two lines each holding a mill or one-from-a-mill,
 * letting it swing back and forth to re-make a mill every move.
 */
function isRunningMill(board: (Player | null)[], at: number, player: Player): boolean {
  if (MILL_MEMBERSHIP.get(at)! < 2) return false;
  let strong = 0;
  for (const line of MILLS_THROUGH.get(at)!) {
    let mine = 0;
    let empty = 0;
    for (const p of line) {
      if (board[p] === player) mine++;
      else if (board[p] === null) empty++;
    }
    if (mine === 3 || (mine === 2 && empty === 1)) strong++;
  }
  return strong >= 2;
}

/** Does `player` have a man that can slide next turn to close a mill? */
function hasSwingThreat(s: NmmState, player: Player): boolean {
  if (!placingDone(s)) return false;
  const fly = isFlying(s, player);
  for (const from of POINTS) {
    if (s.board[from] !== player) continue;
    const dests = fly ? POINTS : ADJ.get(from)!;
    for (const to of dests) {
      if (to === from || s.board[to] !== null) continue;
      const test = s.board.slice();
      test[from] = null;
      test[to] = player;
      if (formsMill(test, to, player)) return true;
    }
  }
  return false;
}

function explainMove(before: NmmState, move: NmmMove, after: NmmState): MoveExplanation {
  const mover = before.turn;
  const opp = (mover ^ 1) as Player;
  const side = sideName(mover);
  const adapter = searchAdapter();

  // Grade by locating the played move within the engine's ranked root list.
  const res = searchBestMove(before, adapter, DEPTH.tutor);
  const played = res.ranked.find((r) => r.move.id === move.id);
  const playedScore = played ? played.score : evaluate(after);
  const bestScore = res.ranked[0]?.score ?? playedScore;
  const moverPlayed = mover === 0 ? playedScore : -playedScore;
  const moverBest = mover === 0 ? bestScore : -bestScore;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;

  const isPlacement = move.kind === 'place';
  const isRemoval = move.kind === 'remove';
  const isSlide = move.kind === 'move';

  // --- Removal moves --------------------------------------------------------
  if (isRemoval) {
    const removed = move.to;
    insights.push({
      tag: 'Removes a man',
      detail: `Having closed a mill, ${side} lifts the enemy man on ${sq(removed)} off the board.`,
      tone: 'good',
    });
    // Did we deny the opponent a near-mill, or pick the most valuable target?
    const wasCross = (MILL_MEMBERSHIP.get(removed) ?? 0) >= 2;
    if (wasCross) {
      insights.push({
        tag: 'Takes a key point',
        detail: `${sq(removed)} sat on two mill lines — removing it from that cross-point hurts most.`,
        tone: 'good',
      });
      principles.push('When you remove, prefer enemy men on the cross-points that feed two mills.');
    }
    // Closing in on flying / loss?
    const oppLeft = countMen(after.board, opp);
    if (oppLeft === 3) {
      insights.push({ tag: 'Down to flying', detail: `${sideName(opp)} now has just three men and may start to fly.`, tone: 'info' });
    } else if (oppLeft <= 2) {
      insights.push({ tag: 'Decisive!', detail: `${sideName(opp)} is reduced to two men and loses.`, tone: 'good' });
    }
    principles.push('A mill is only as good as the man it lets you remove — choose that target with care.');

    const band = won ? 'best' : gradeByLoss(loss, Math.abs(moverPlayed) > 250);
    return {
      summary: won
        ? `${side} removes ${sq(removed)} and wins!`
        : `${side} removes the enemy man on ${sq(removed)}.`,
      band,
      evalBefore: evaluate(before),
      evalAfter: evaluate(after),
      insights,
      principles,
      threats: threats.length ? threats : undefined,
      betterIdea: loss > 60 && res.move && res.move.id !== move.id
        ? `Removing ${sq(res.move.to)} was stronger here.`
        : undefined,
    };
  }

  // --- Placements and slides ------------------------------------------------
  const millLine = newMillLine(after.board, move.to, mover);
  const madeMill = millLine !== null;

  if (won) {
    insights.push({ tag: 'Winning move', detail: `Leaves ${sideName(opp)} with no answer — the game is over.`, tone: 'good' });
  }

  if (madeMill) {
    insights.push({
      tag: 'Mill!',
      detail: `Three ${side.toLowerCase()} men line up on ${millLine!.map(sq).join('-')} — ${side} now removes an enemy man.`,
      tone: 'good',
    });
    principles.push('Completing a mill lets you capture: it is the engine of the whole game.');
    threats.push(`${side} will lift one of ${sideName(opp)}'s men off the board.`);

    if (isRunningMill(after.board, move.to, mover)) {
      insights.push({
        tag: 'Running mill',
        detail: 'This man sits on two mill lines at once — slide it out and back to re-form a mill, capturing every single turn.',
        tone: 'good',
      });
      principles.push('A double/running mill that re-makes itself each move is often game-winning.');
    }
  }

  // Blocking an opponent's imminent mill: was there a near-mill gap the move filled?
  const oppGapsBefore = millCompletions(before.board, opp);
  if (!madeMill && oppGapsBefore.has(move.to)) {
    insights.push({
      tag: 'Blocks a mill',
      detail: `${sideName(opp)} was one move from a mill on ${sq(move.to)}; ${side} plugs the gap just in time.`,
      tone: 'good',
    });
    principles.push('Watch the opponent\'s two-in-a-lines and occupy the open third point to deny the mill.');
  }

  // Building toward a mill / taking a strong point.
  if (!madeMill) {
    const cross = (MILL_MEMBERSHIP.get(move.to) ?? 0) >= 2;
    if (cross) {
      insights.push({
        tag: 'Key cross-point',
        detail: `${sq(move.to)} belongs to two mill lines — controlling it doubles your chances to form a mill.`,
        tone: 'good',
      });
      principles.push('Grab the cross-points (each feeds two mills); they are the most valuable squares.');
    }
    const myNearBefore = countNearMills(before.board, mover);
    const myNearAfter = countNearMills(after.board, mover);
    if (myNearAfter > myNearBefore) {
      insights.push({
        tag: 'Builds a threat',
        detail: 'Lines up two men with the third point open — a mill now looms next turn.',
        tone: 'good',
      });
    }
  }

  // Did we leave an enemy mill open for free next move (a tactical lapse)?
  if (!madeMill && !won) {
    const oppGapsAfter = millCompletions(after.board, opp);
    // Threats the opponent can actually reach: placement gap, or a man that can slide in.
    let reachable = false;
    if (isPlacingPhase(after) && oppGapsAfter.size > 0) {
      reachable = true;
    } else if (placingDone(after)) {
      reachable = hasSwingThreat(after, opp);
    }
    if (reachable) {
      insights.push({
        tag: 'Allows a mill',
        detail: `${sideName(opp)} can close a mill next move and remove one of ${side}'s men.`,
        tone: 'bad',
      });
      threats.push(`${sideName(opp)} threatens to complete a mill.`);
    }
  }

  // Reducing the opponent toward flying / loss is captured on the removal move,
  // but flag when a slide sets up a swing (running) mill threat of our own.
  if (isSlide && !madeMill && hasSwingThreat(after, mover)) {
    insights.push({
      tag: 'Sets up a mill',
      detail: 'After this slide one of your men is poised to swing in and close a mill next turn.',
      tone: 'good',
    });
  }

  const winningBig = Math.abs(moverPlayed) > 250;
  const band = won ? 'best' : gradeByLoss(loss, winningBig);

  if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
    insights.push({ tag: 'Loses ground', detail: 'A stronger move was available; this one concedes structure or a man.', tone: 'bad' });
  }
  if (insights.length === 0) {
    insights.push({ tag: isPlacement ? 'Develops' : 'Maneuvers', detail: 'A sound, quiet move that keeps the position healthy.', tone: 'info' });
  }

  const summary =
    won ? `${side} plays the winning ${madeMill ? 'mill' : 'move'}.`
    : madeMill && isPlacement ? `${side} places ${sq(move.to)} and forms a mill.`
    : madeMill ? `${side} slides ${sq(move.from!)}–${sq(move.to)} and forms a mill.`
    : isPlacement ? `${side} places a man on ${sq(move.to)}.`
    : `${side} slides ${sq(move.from!)}–${sq(move.to)}.`;

  return {
    summary,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length ? threats : undefined,
    betterIdea: loss > 60 && res.move && res.move.id !== move.id
      ? `Stronger was ${res.move.notation.replace(/^\w+\s/, '')}.`
      : undefined,
  };
}

function hint(s: NmmState): { move: NmmMove; text: string } | null {
  const res = searchBestMove(s, searchAdapter(), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move;
  const mover = s.turn;
  const after = applyMove(s, m);
  const status = getStatus(after);

  let text: string;
  if (s.removing) {
    const cross = (MILL_MEMBERSHIP.get(m.to) ?? 0) >= 2;
    text = cross
      ? `Remove ${sq(m.to)} — it sits on a cross-point feeding two mills.`
      : `Remove ${sq(m.to)} to do the most damage.`;
  } else {
    const millLine = newMillLine(after.board, m.to, mover);
    if (status.kind === 'win' && status.winner === mover) {
      text = `Play ${m.notation} — it wins on the spot.`;
    } else if (millLine) {
      text = `Play ${m.notation} — it completes a mill and lets you remove an enemy man.`;
    } else if (millCompletions(s.board, (mover ^ 1) as Player).has(m.to)) {
      text = `Play ${m.notation} — it blocks the opponent's looming mill.`;
    } else if ((MILL_MEMBERSHIP.get(m.to) ?? 0) >= 2) {
      text = `Play ${m.notation} — claim the cross-point that feeds two mills.`;
    } else {
      text = `${m.notation} is the strongest move here.`;
    }
  }
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<NmmState, NmmMove> = {
  id: 'nine-mens-morris',
  name: "Nine Men's Morris",
  tagline: 'An ancient duel of mills — line up three, capture, and grind your foe down to two.',
  blurb: "Nine Men's Morris is one of the oldest board games on earth, carved into temple steps and cathedral cloisters for over two thousand years. Each side drops nine men onto the board's twenty-four points, racing to line up three in a row — a \"mill\" — and snatch an enemy man each time. Once every man is placed, the men come alive, sliding along the lines; build a swinging \"running mill\" that re-forms every turn and your opponent will melt away. Reduce a player to two men, or leave them with no move, and the game is won.",
  category: 'Classic',
  depth: 3,
  emoji: '🎯',
  accent: '#a78bfa',
  players: [
    { id: 0, name: 'White', short: 'W', color: '#f1f5f9' },
    { id: 1, name: 'Black', short: 'B', color: '#334155' },
  ],
  interaction: { type: 'adaptive' },
  render: {
    pieceStyle: 'disc',
    showCoordinates: false,
    checkered: false,
    connections: CONNECTIONS,
  },

  createInitialState,
  cloneState,
  getBoardView,
  getTurn: (s) => s.turn,
  getStatus,
  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove,
  chooseMove,
  evaluate,
  explainMove,
  hint,

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str) as NmmState,

  tutorial: {
    overview: "Nine Men's Morris is an ancient strategy game for two players, played on a board of three nested squares joined by cross-lines — twenty-four points in all. Despite its simple look it hides real depth: the whole struggle revolves around the \"mill\", a line of three of your own men. Form one and you remove an enemy man; chain mills together and you can dismantle your opponent piece by piece.",
    objective: "Reduce your opponent to just two men, or leave them with no legal move. You whittle the enemy down by forming mills — three of your men in a straight line — each of which lets you take one of their men off the board.",
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          {
            title: 'The board and the men',
            body: "The board has **24 points** where the lines of three nested squares meet and cross. Each player has **nine men**. **White** moves first; players then alternate. A man sits on a point, and only one man may occupy a point at a time.",
            highlight: POINTS.slice(),
          },
          {
            title: 'Phase 1 — placing your men',
            body: "The game opens with the **placing phase**: on your turn you drop one of your men onto any **empty point**. You keep placing, turn by turn, until both players have put down all **nine** of their men.",
            highlight: [0, 6, 42, 48],
          },
          {
            title: 'Make a mill, remove a man',
            body: "Line up **three of your men** along one straight line and you have a **mill**. The moment a placement or a move completes a mill, you immediately **remove one enemy man** from the board. You must take a man that is **not** itself in a mill — unless **all** of the opponent's men are in mills, in which case any may be taken.",
            highlight: [0, 3, 6],
            arrows: [{ from: 3, to: 6, tone: 'good' }],
          },
          {
            title: 'Phase 2 — moving along the lines',
            body: "Once all eighteen men are placed, the **moving phase** begins. On your turn you slide **one man** along a line to an **adjacent empty point**. You may only move to a point directly connected to the one you leave — and forming a mill still removes an enemy man.",
            highlight: [3, 10],
            arrows: [{ from: 3, to: 10, tone: 'info' }],
          },
          {
            title: 'Phase 3 — flying at three men',
            body: "When you are worn down to exactly **three men**, you gain the power to **fly**: instead of sliding to a neighbour, you may move a man to **any empty point** on the board. It is a last lifeline that lets a cornered player keep fighting.",
            highlight: [16, 23, 30],
          },
          {
            title: 'How the game ends',
            body: "You **win** when your opponent is reduced to **two men** — too few to ever form a mill — or when it is their turn and they have **no legal move** at all. Mills are the engine that drives the game toward that finish.",
          },
        ],
      },
      {
        title: 'Strategy', icon: '🧠',
        steps: [
          {
            title: 'Seize the cross-points',
            body: "Four points lie where lines cross and belong to **two mills at once** — the mid-points of each side (such as **d2, b4, f4, d6**). A man there threatens twice as many mills and is far more useful than a man in a corner. Grab these points early.",
            highlight: [10, 22, 26, 38],
          },
          {
            title: 'Build two threats at once',
            body: "Aim to create a position where you threaten to close **two different mills** on your next move. Your opponent can only block one — so the other goes through, and you capture. Two simultaneous threats are how mills are forced.",
            highlight: [21, 22, 23, 26],
          },
          {
            title: 'The double (running) mill',
            body: "The strongest weapon in the game is a **running mill**: a man positioned so that sliding it one way breaks a mill, and sliding it back **re-forms** one. Each swing closes a mill again and removes another enemy man — turn after turn, your opponent crumbles.",
            highlight: [3, 10, 17, 16, 18],
          },
          {
            title: 'Block before you build',
            body: "Always check the opponent's **two-in-a-lines** first. If they are one move from a mill, occupy the open third point to **deny** it — a mill conceded is a man lost. Defense and offense often share the same key point.",
            highlight: [42, 45, 48],
          },
          {
            title: 'Mobility and the squeeze',
            body: "In the moving phase, a man with no empty neighbour is **dead weight**, and a player with no move **loses outright**. Keep your own men breathing while you cramp the enemy — pinning their men against the edge can win without a single capture.",
          },
          {
            title: 'Choose your captures well',
            body: "When a mill lets you remove a man, take the one that **hurts most**: an enemy man on a cross-point, or one about to complete a mill of its own. Steering the opponent toward three men (and the desperation of flying) — then toward two — is the path to victory.",
          },
        ],
      },
    ],
  },
};

export default def;
