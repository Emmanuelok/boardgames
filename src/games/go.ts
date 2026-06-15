import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Go (a.k.a. Weiqi / Baduk) on a 9×9 board — the smallest size that still plays
 * a real game and the classic teaching board. Two players alternately place
 * stones on the line *intersections*; Black moves first. The aim is not to make
 * a line but to surround **territory** — empty points that only your stones can
 * reach — while capturing enemy stones that you fully enclose.
 *
 * Three rules give Go its astonishing depth from almost nothing:
 *   • A stone (or solidly-connected group) is captured when it has no adjacent
 *     empty points ("liberties") left. Your capture of the opponent is resolved
 *     *before* your own group is checked, so you may fill your last liberty to
 *     take theirs.
 *   • You may not play a *suicide* — a stone that, after captures, leaves your
 *     own group with no liberties.
 *   • The *ko* rule forbids immediately recreating the previous position, so a
 *     single-stone recapture loop cannot repeat forever.
 *
 * The game ends when both players pass in succession; the board is then scored
 * by **area** (Chinese) counting: stones on the board plus surrounded territory,
 * with White receiving a 6.5-point *komi* to offset Black's first-move edge —
 * which also guarantees no draws.
 *
 * Go's branching factor is enormous (81 legal points early on), so the bundled
 * alpha-beta engine stays deliberately shallow and only considers sensible
 * candidate points (near existing stones, not filling its own eyes, not obvious
 * self-atari). The rules below are exact; the AI is a friendly heuristic player.
 */

export interface GoState {
  board: (Player | null)[]; // 81 intersections, row-major (row 0 = top)
  turn: Player;
  passes: number;           // consecutive passes (2 ⇒ game over)
  ko: number;               // forbidden point for the immediate reply, or -1
  captures: [number, number]; // stones captured by [Black, White] over the game
}
interface GoMove extends MoveBase {}

const SIZE = 9;
const CELLS = SIZE * SIZE; // 81
const KOMI = 6.5;          // White's compensation for moving second

/** Go column letters skip 'I' by tradition: A B C D E F G H J. */
const COLS = 'ABCDEFGHJ';

const rc = (i: number): [number, number] => [Math.floor(i / SIZE), i % SIZE];
const idx = (r: number, c: number) => r * SIZE + c;
const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

const sideName = (p: Player) => (p === 0 ? 'Black' : 'White');
const other = (p: Player) => (p ^ 1) as Player;

/** Human point name, e.g. cell (row 8, col 3) → "D1". Files A–J (no I), rows
 *  1–9 counted from the BOTTOM, so display row label = SIZE − r. */
function pointName(i: number): string {
  if (i < 0) return 'pass';
  const [r, c] = rc(i);
  return `${COLS[c]}${SIZE - r}`;
}

/** The four orthogonal neighbours of cell i, in-bounds only. */
function neighbors(i: number): number[] {
  const [r, c] = rc(i);
  const out: number[] = [];
  if (r > 0) out.push(idx(r - 1, c));
  if (r < SIZE - 1) out.push(idx(r + 1, c));
  if (c > 0) out.push(idx(r, c - 1));
  if (c < SIZE - 1) out.push(idx(r, c + 1));
  return out;
}

/* ---------------------- Groups, liberties, capture -------------------- */

/**
 * Flood-fill the maximal solidly-connected group of one colour containing
 * `start`, returning the group's stone indices and its set of liberty points
 * (distinct empty neighbours). Orthogonal connectivity only — diagonals do not
 * connect stones in Go.
 */
function groupAt(board: (Player | null)[], start: number): { stones: number[]; liberties: Set<number> } {
  const color = board[start];
  const stones: number[] = [];
  const liberties = new Set<number>();
  if (color === null) return { stones, liberties };
  const seen = new Uint8Array(CELLS);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    stones.push(cur);
    for (const n of neighbors(cur)) {
      const v = board[n];
      if (v === null) liberties.add(n);
      else if (v === color && !seen[n]) { seen[n] = 1; stack.push(n); }
    }
  }
  return { stones, liberties };
}

/** Liberty count of the group containing `i` (fast — counts distinct empties). */
function libertyCount(board: (Player | null)[], i: number): number {
  return groupAt(board, i).liberties.size;
}

/**
 * Result of placing `color` at `cell` on `board` (which must be empty there):
 * the resulting board, the captured opponent indices, and whether the move is
 * legal at all (suicide is rejected). Capturing is resolved BEFORE the placed
 * group's own liberties are checked, so a move filling your last liberty is
 * legal precisely when it captures something.
 *
 * Ko is NOT checked here (it depends on history); callers layer it on top.
 */
function tryPlace(
  board: (Player | null)[],
  cell: number,
  color: Player,
): { board: (Player | null)[]; captured: number[]; legal: boolean } {
  if (board[cell] !== null) return { board, captured: [], legal: false };
  const opp = other(color);
  const next = board.slice();
  next[cell] = color;

  // Remove any opponent group adjacent to the new stone that is now captured
  // (zero liberties). Resolve captures first.
  const captured: number[] = [];
  const checkedOpp = new Uint8Array(CELLS);
  for (const n of neighbors(cell)) {
    if (next[n] === opp && !checkedOpp[n]) {
      const grp = groupAt(next, n);
      for (const s of grp.stones) checkedOpp[s] = 1;
      if (grp.liberties.size === 0) {
        for (const s of grp.stones) { next[s] = null; captured.push(s); }
      }
    }
  }

  // Now check our own group: if it has no liberties after captures, it is
  // suicide and therefore illegal.
  const mine = groupAt(next, cell);
  if (mine.liberties.size === 0) return { board, captured: [], legal: false };

  return { board: next, captured, legal: true };
}

/**
 * The simple-ko forbidden point produced by a placement, or -1. By the standard
 * convention a ko ban arises only when exactly one stone is captured by a move
 * that itself ends as a lone stone with exactly one liberty — the textbook
 * single-stone recapture. The banned point is the captured stone's location.
 */
function koPointAfter(
  nextBoard: (Player | null)[],
  cell: number,
  captured: number[],
): number {
  if (captured.length !== 1) return -1;
  const grp = groupAt(nextBoard, cell);
  if (grp.stones.length === 1 && grp.liberties.size === 1) return captured[0];
  return -1;
}

/* --------------------------- Move generation -------------------------- */

const PASS_MOVE: GoMove = { id: 'pass', to: -1, notation: 'pass' };

function placeMove(s: GoState, i: number, captured: number[]): GoMove {
  const cap = captured.length;
  const note = `${sideName(s.turn)} ${pointName(i)}` + (cap ? ` (captures ${cap})` : '');
  const m: GoMove = { id: `p${i}`, to: i, notation: note };
  if (cap) { m.affected = captured.slice(); m.capture = true; }
  return m;
}

/** Every LEGAL placement (not suicide, not ko) for the side to move. */
function legalPlacements(s: GoState): GoMove[] {
  const moves: GoMove[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (s.board[i] !== null) continue;
    if (i === s.ko) continue; // simple-ko ban
    const r = tryPlace(s.board, i, s.turn);
    if (!r.legal) continue;
    moves.push(placeMove(s, i, r.captured));
  }
  return moves;
}

/** Public + search move list: all legal placements, plus the always-legal pass. */
function legalMoves(s: GoState): GoMove[] {
  if (s.passes >= 2) return [];
  return [...legalPlacements(s), PASS_MOVE];
}

/* ------------------------------ Apply --------------------------------- */

function apply(s: GoState, m: GoMove): GoState {
  // A pass: increment the pass counter, clear any ko, switch turns.
  if (m.to === -1) {
    return {
      board: s.board.slice(),
      turn: other(s.turn),
      passes: s.passes + 1,
      ko: -1,
      captures: [s.captures[0], s.captures[1]],
    };
  }

  const r = tryPlace(s.board, m.to, s.turn);
  // Illegal placements should never reach here; fall back to a pass-like no-op
  // so the engine never crashes on a stray move.
  if (!r.legal) {
    return {
      board: s.board.slice(),
      turn: other(s.turn),
      passes: s.passes,
      ko: -1,
      captures: [s.captures[0], s.captures[1]],
    };
  }

  const captures: [number, number] = [s.captures[0], s.captures[1]];
  captures[s.turn] += r.captured.length;
  const ko = koPointAfter(r.board, m.to, r.captured);

  return {
    board: r.board,
    turn: other(s.turn),
    passes: 0, // a real placement resets the consecutive-pass counter
    ko,
    captures,
  };
}

/* ------------------------------ Scoring ------------------------------- */

interface AreaScore {
  black: number;       // Black area (stones + Black-only territory)
  white: number;       // White area, BEFORE komi
  blackTerr: number;   // Black-only empty territory
  whiteTerr: number;   // White-only empty territory
  dame: number;        // neutral empty points (reach both / neither)
}

/**
 * Chinese (area) scoring. Each maximal empty region is flooded; if every stone
 * bordering it is one colour, that whole region is that colour's territory,
 * otherwise it is neutral (dame). Area score = your stones on the board + your
 * territory. White then adds komi at comparison time.
 */
function areaScore(board: (Player | null)[]): AreaScore {
  let blackStones = 0, whiteStones = 0;
  for (const v of board) {
    if (v === 0) blackStones++;
    else if (v === 1) whiteStones++;
  }

  let blackTerr = 0, whiteTerr = 0, dame = 0;
  const seen = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== null || seen[i]) continue;
    // Flood this empty region, recording which colours border it.
    const region: number[] = [];
    const stack = [i];
    seen[i] = 1;
    let touchesBlack = false, touchesWhite = false;
    while (stack.length) {
      const cur = stack.pop()!;
      region.push(cur);
      for (const n of neighbors(cur)) {
        const v = board[n];
        if (v === null) {
          if (!seen[n]) { seen[n] = 1; stack.push(n); }
        } else if (v === 0) touchesBlack = true;
        else touchesWhite = true;
      }
    }
    if (touchesBlack && !touchesWhite) blackTerr += region.length;
    else if (touchesWhite && !touchesBlack) whiteTerr += region.length;
    else dame += region.length;
  }

  return {
    black: blackStones + blackTerr,
    white: whiteStones + whiteTerr,
    blackTerr,
    whiteTerr,
    dame,
  };
}

const isTerminal = (s: GoState) => s.passes >= 2;

/* ----------------------------- Evaluation ----------------------------- */

/**
 * Static evaluation from player 0 (Black)'s perspective; positive favours Black.
 *
 * A terminal position (two passes) is decided by the final area margin, returned
 * as a large ±value scaled by that margin so the engine prefers winning lines.
 *
 * Otherwise we blend cheap heuristics: the stone-count difference, captured
 * stones, a liberty/influence term (groups with breathing room are healthier),
 * and a fast territory estimate counting each empty point adjacent to stones of
 * only one colour. White's komi is subtracted throughout so the engine plays for
 * the real, komi-adjusted result.
 */
function evaluate(s: GoState): number {
  const b = s.board;

  if (isTerminal(s)) {
    const sc = areaScore(b);
    const margin = sc.black - (sc.white + KOMI); // + ⇒ Black wins
    return margin > 0 ? WIN + margin * 100 : -WIN + margin * 100;
  }

  let blackStones = 0, whiteStones = 0;
  for (const v of b) {
    if (v === 0) blackStones++;
    else if (v === 1) whiteStones++;
  }

  // Liberty / influence: sum liberties of each group (counts breathing room).
  // Atari (1-liberty) groups are fragile, so penalise them; stones in atari are
  // a liability for their owner.
  let libTerm = 0;
  const visited = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (b[i] === null || visited[i]) continue;
    const color = b[i] as Player;
    const grp = groupAt(b, i);
    for (const st of grp.stones) visited[st] = 1;
    const libs = grp.liberties.size;
    const sign = color === 0 ? 1 : -1;
    libTerm += sign * libs;
    if (libs === 1) libTerm -= sign * grp.stones.length * 3; // group in atari is bad
  }

  // Fast territory estimate: each empty point adjacent to stones of only one
  // colour leans toward that colour.
  let terr = 0;
  for (let i = 0; i < CELLS; i++) {
    if (b[i] !== null) continue;
    let nb = false, nw = false;
    for (const n of neighbors(i)) {
      if (b[n] === 0) nb = true;
      else if (b[n] === 1) nw = true;
    }
    if (nb && !nw) terr += 1;
    else if (nw && !nb) terr -= 1;
  }

  const stoneDiff = blackStones - whiteStones;
  const capDiff = s.captures[0] - s.captures[1];

  // Scaled so a point of territory/stone ≈ 10 "centi" units, matching the
  // grading bands (loss thresholds ~20/55/120 → roughly 2/5/12 points).
  const score = stoneDiff * 10 + terr * 9 + libTerm * 1.5 + capDiff * 12;
  return score - KOMI * 10; // White's komi, in the same scaled units
}

/* ------------------------ AI candidate generation --------------------- */

/**
 * Is `i` an empty point completely surrounded (orthogonally) by `color`'s own
 * stones — i.e. a one-point eye for `color`? Filling such a point is almost
 * always self-destructive, so the AI never offers it as a candidate.
 */
function isOwnEye(board: (Player | null)[], i: number, color: Player): boolean {
  if (board[i] !== null) return false;
  for (const n of neighbors(i)) {
    if (board[n] !== color) return false;
  }
  return true;
}

/** Empty points orthogonally OR diagonally adjacent to any stone. */
function nearStones(board: (Player | null)[]): Set<number> {
  const near = new Set<number>();
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === null) continue;
    const [r, c] = rc(i);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r2 = r + dr, c2 = c + dc;
        if (inBounds(r2, c2)) {
          const j = idx(r2, c2);
          if (board[j] === null) near.add(j);
        }
      }
    }
  }
  return near;
}

const STAR_POINTS = [idx(2, 2), idx(2, 6), idx(6, 2), idx(6, 6), idx(4, 4)]; // 9×9 hoshi + tengen

/**
 * Sensible AI candidate moves: legal points that (a) do not fill the AI's own
 * one-point eyes, (b) sit near existing stones, and (c) are not obvious
 * self-atari (placing into a group left with a single liberty without a
 * capture). On an (almost) empty board we seed the star points. PASS is always
 * appended so the search can choose to end the game when nothing constructive
 * remains.
 */
function candidateMoves(s: GoState): GoMove[] {
  if (s.passes >= 2) return [];
  const me = s.turn;
  const board = s.board;

  let stones = 0;
  for (const v of board) if (v !== null) stones++;

  const near = nearStones(board);
  // Opening: very few stones → offer the classic 9×9 points.
  const pool: number[] = [];
  if (stones < 4) {
    for (const p of STAR_POINTS) if (board[p] === null) pool.push(p);
  }
  for (const p of near) pool.push(p);
  // De-dup while preserving order.
  const seen = new Set<number>();
  const ordered = pool.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));

  const moves: GoMove[] = [];
  for (const i of ordered) {
    if (board[i] !== null) continue;
    if (i === s.ko) continue;
    if (isOwnEye(board, i, me)) continue; // never fill our own eye
    const r = tryPlace(board, i, me);
    if (!r.legal) continue;
    // Reject self-atari: the placed group ends with a single liberty and we did
    // not capture anything (a capturing self-atari can still be good, so allow).
    if (r.captured.length === 0 && libertyCount(r.board, i) === 1) continue;
    moves.push(placeMove(s, i, r.captured));
  }

  // If nothing constructive remains, fall back to any legal placement (so the
  // AI isn't forced to pass while real points are still on the table), then pass.
  if (moves.length === 0) {
    for (let i = 0; i < CELLS; i++) {
      if (board[i] !== null || i === s.ko) continue;
      if (isOwnEye(board, i, me)) continue;
      const r = tryPlace(board, i, me);
      if (!r.legal) continue;
      moves.push(placeMove(s, i, r.captured));
    }
  }

  moves.push(PASS_MOVE);
  return moves;
}

/* ------------------------------ Search -------------------------------- */

/** Capture-aware ordering hint for a candidate placement (higher tried first). */
function orderScore(s: GoState, m: GoMove): number {
  if (m.to === -1) return -100000; // examine pass last
  const me = s.turn;
  const opp = other(me);
  const board = s.board;

  let sc = 0;
  const r = tryPlace(board, m.to, me);
  if (r.legal) {
    sc += r.captured.length * 1000; // captures are very attractive
    const myLibs = libertyCount(r.board, m.to);
    sc += Math.min(myLibs, 6) * 8; // breathing room is good

    // Putting an adjacent opponent group into atari (down to one liberty) is a
    // strong, forcing threat.
    const checked = new Uint8Array(CELLS);
    for (const n of neighbors(m.to)) {
      if (r.board[n] === opp && !checked[n]) {
        const grp = groupAt(r.board, n);
        for (const st of grp.stones) checked[st] = 1;
        if (grp.liberties.size === 1) sc += 120 + grp.stones.length * 20;
      }
    }
  }

  // Mild bias toward the centre-weighted star area early; edges/corners are
  // fine but the 9×9 game lives around the 3-3 and tengen points.
  const [rr, cc] = rc(m.to);
  const distC = Math.abs(rr - 4) + Math.abs(cc - 4);
  sc += (8 - distC);
  return sc;
}

function searchAdapter() {
  return {
    getLegalMoves: (s: GoState): GoMove[] => candidateMoves(s),
    applyMove: apply,
    getTurn: (s: GoState) => s.turn,
    isTerminal,
    evaluate,
    order: (s: GoState, m: GoMove): number => orderScore(s, m),
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 2, easy: 1, medium: 1, hard: 2, master: 2 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.8, medium: 0.45, hard: 0.1, master: 0 };

function stoneCount(board: (Player | null)[]): number {
  let n = 0;
  for (const v of board) if (v !== null) n++;
  return n;
}

/* ---------------------------- Tutor helpers --------------------------- */

interface PlayInfo {
  captured: number[];                 // stones this move captured
  atariGroups: { rep: number; size: number }[]; // opponent groups now in atari
  selfAtari: boolean;                 // our own group left with one liberty
  selfGroupSize: number;              // size of our group after the move
  filledEye: boolean;                 // did we fill our own one-point eye?
  myLibs: number;                     // liberties of our group after the move
}

/** Describe the tactical effect of placing `mover`'s stone at `cell` on `board`. */
function describePlay(board: (Player | null)[], cell: number, mover: Player): PlayInfo {
  const opp = other(mover);
  const filledEye = isOwnEye(board, cell, mover);
  const r = tryPlace(board, cell, mover);
  if (!r.legal) {
    return { captured: [], atariGroups: [], selfAtari: false, selfGroupSize: 0, filledEye, myLibs: 0 };
  }
  const myGrp = groupAt(r.board, cell);
  const myLibs = myGrp.liberties.size;

  const atariGroups: { rep: number; size: number }[] = [];
  const checked = new Uint8Array(CELLS);
  for (const n of neighbors(cell)) {
    if (r.board[n] === opp && !checked[n]) {
      const grp = groupAt(r.board, n);
      for (const st of grp.stones) checked[st] = 1;
      if (grp.liberties.size === 1) atariGroups.push({ rep: n, size: grp.stones.length });
    }
  }

  return {
    captured: r.captured,
    atariGroups,
    selfAtari: r.captured.length === 0 && myLibs === 1,
    selfGroupSize: myGrp.stones.length,
    filledEye,
    myLibs,
  };
}

/** Is `cell` in a board corner / on an edge? Used for opening/territory talk. */
function regionOf(cell: number): 'corner' | 'side' | 'center' {
  const [r, c] = rc(cell);
  const edgeR = r === 0 || r === SIZE - 1;
  const edgeC = c === 0 || c === SIZE - 1;
  if ((r <= 2 || r >= SIZE - 3) && (c <= 2 || c >= SIZE - 3)) {
    if (edgeR && edgeC) return 'corner';
    return 'corner';
  }
  if (edgeR || edgeC) return 'side';
  return 'center';
}

/** Does the opponent currently have any group in atari (capturable next move)? */
function opponentInAtari(board: (Player | null)[], opp: Player): boolean {
  const visited = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== opp || visited[i]) continue;
    const grp = groupAt(board, i);
    for (const st of grp.stones) visited[st] = 1;
    if (grp.liberties.size === 1) return true;
  }
  return false;
}

/* --------------------------- Definition ------------------------------- */

const def: GameDefinition<GoState, GoMove> = {
  id: 'go',
  name: 'Go',
  tagline: 'Surround territory on the 9×9 board — the deepest game ever devised.',
  blurb: 'Go (Weiqi in China, Baduk in Korea) is the oldest board game still played in its original form, and by common consent the deepest. From a single rule — surround to capture — emerges a game of breathtaking scope: you place stones to map out frameworks, invade and reduce your opponent\'s, and win by enclosing more of the board than they do. This 9×9 board is where everyone learns: small enough to finish quickly, yet large enough for every essential idea — liberties, capture, life with two eyes, ko, and the eternal balance of territory against influence. White is given a 6.5-point komi to offset Black\'s first move, so there are no draws — only the sharper player.',
  category: 'Abstract',
  depth: 5,
  emoji: '⚫',
  accent: '#0f766e',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#0f172a' },
    { id: 1, name: 'White', short: 'W', color: '#f8fafc' },
  ],
  interaction: { type: 'place' },
  canPass: true,
  render: { pieceStyle: 'stone', showCoordinates: true, checkered: false, intersections: true },

  createInitialState: (): GoState => ({
    board: Array(CELLS).fill(null),
    turn: 0,
    passes: 0,
    ko: -1,
    captures: [0, 0],
  }),
  cloneState: (s): GoState => ({
    board: s.board.slice(),
    turn: s.turn,
    passes: s.passes,
    ko: s.ko,
    captures: [s.captures[0], s.captures[1]],
  }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / SIZE), col: i % SIZE,
      piece: p === null ? null : { id: `c${i}`, kind: 'stone', player: p, glyph: p === 0 ? '⚫' : '⚪' },
    }));
    const fileLabels = COLS.split('');
    // Row 0 is the top; ranks count 1–9 from the bottom, so labels read 9…1.
    const rankLabels = Array.from({ length: SIZE }, (_, i) => String(SIZE - i));
    return { rows: SIZE, cols: SIZE, cells, fileLabels, rankLabels };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (isTerminal(s)) {
      const sc = areaScore(s.board);
      const blackScore = sc.black;
      const whiteScore = sc.white + KOMI;
      // The half-point komi guarantees a decisive result — no draws.
      const winner: Player = blackScore > whiteScore ? 0 : 1;
      const bStr = blackScore.toFixed(blackScore % 1 ? 1 : 0);
      const wStr = whiteScore.toFixed(1);
      return {
        kind: 'win',
        winner,
        reason: `both players passed — area score Black ${bStr}, White ${wStr} (incl. 6.5 komi)`,
      };
    }
    return { kind: 'playing' };
  },

  // Public + engine move list: every legal placement plus the always-legal pass.
  getLegalMoves: (s, _from) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    if (isTerminal(s)) return null;
    const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
      randomness: RAND[difficulty],
      rng: mulberry32((stoneCount(s.board) + 1) * 2654435761),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opp = other(mover);
    const side = sideName(mover);
    const adapter = searchAdapter();

    // Grade by comparing the played move to the best candidate (shallow search,
    // matching the engine's depth). We find the played move in the ranked list
    // by id; a far-flung human placement that wasn't a candidate falls back to a
    // static eval of the resulting position.
    const res = searchBestMove(before, adapter, 2, {
      rng: mulberry32((stoneCount(before.board) + 1) * 2654435761),
    });
    const playedEntry = res.ranked.find((r) => r.move.id === move.id);
    const playedEval = playedEntry ? playedEntry.score : evaluate(after);
    const bestEval = res.ranked[0]?.score ?? playedEval;
    const moverPlayed = mover === 0 ? playedEval : -playedEval;
    const moverBest = mover === 0 ? bestEval : -bestEval;
    const loss = Math.max(0, moverBest - moverPlayed);

    const insights: MoveInsight[] = [];
    const principles: string[] = [];
    const threats: string[] = [];

    const isPass = move.to === -1;
    const gameOver = isTerminal(after);

    if (isPass) {
      insights.push({
        tag: 'Pass',
        detail: gameOver
          ? 'A second consecutive pass — both players agree there is nothing left worth playing, so the game ends and the board is scored.'
          : `${side} passes, declining to play a stone. If ${sideName(opp)} also passes, the game ends and territory is counted.`,
        tone: 'info',
      });
      principles.push('Pass only when no point on the board gains you anything — every constructive move is worth more than a pass.');

      if (gameOver) {
        const sc = areaScore(after.board);
        const bs = sc.black, ws = sc.white + KOMI;
        const won = (mover === 0 ? bs > ws : ws > bs);
        insights.push({
          tag: won ? 'Game won' : 'Game lost',
          detail: `Final area score: Black ${bs}, White ${ws.toFixed(1)} (with 6.5 komi). ${won ? side : sideName(opp)} wins.`,
          tone: won ? 'good' : 'bad',
        });
      }

      const band: MoveExplanation['band'] = 'book';
      return {
        summary: gameOver ? `${side} passes; both have passed, so the game ends and is scored.` : `${side} passes.`,
        band,
        evalBefore: evaluate(before), evalAfter: evaluate(after),
        insights, principles,
        threats: undefined,
        betterIdea: !gameOver
          ? 'If you still have a stone that surrounds territory, captures, or saves a group, play it rather than passing.'
          : undefined,
      };
    }

    const play = describePlay(before.board, move.to, mover);
    const region = regionOf(move.to);
    const stones = stoneCount(before.board);
    const isKo = after.ko !== -1;

    // Captures.
    if (play.captured.length > 0) {
      insights.push({
        tag: 'Capture!',
        detail: `Removes ${play.captured.length} ${sideName(opp)} stone${play.captured.length === 1 ? '' : 's'} from the board — they had run out of liberties.`,
        tone: 'good',
      });
      principles.push('A group with no liberties is captured and lifted off the board.');
      threats.push(`${play.captured.length} captured stone${play.captured.length === 1 ? '' : 's'} also count toward your area at the end.`);
    }

    // Atari — threatening to capture next.
    if (play.atariGroups.length > 0) {
      const biggest = play.atariGroups.reduce((a, b) => (b.size > a.size ? b : a));
      insights.push({
        tag: 'Atari',
        detail: `Puts a ${sideName(opp)} group (${biggest.size} stone${biggest.size === 1 ? '' : 's'}) in atari — it has just one liberty left and can be captured next move unless it runs or connects.`,
        tone: 'good',
      });
      principles.push('Atari is a direct threat to capture — it usually forces a reply.');
      threats.push(`Threatens to capture the ${sideName(opp)} group in atari.`);
    }

    // Self-atari — almost always bad.
    if (play.selfAtari) {
      insights.push({
        tag: 'Self-atari',
        detail: `Leaves your own ${play.selfGroupSize === 1 ? 'stone' : `${play.selfGroupSize}-stone group`} with only one liberty — the opponent can capture it immediately. Self-atari is almost always a mistake.`,
        tone: 'bad',
      });
      principles.push('Avoid self-atari: never leave your own group on a single liberty without good reason.');
    }

    // Filling your own eye — bad: eyes are how groups live.
    if (play.filledEye) {
      insights.push({
        tag: 'Fills your own eye',
        detail: 'This point was a one-point eye of your own. Filling your eyes destroys the very thing that keeps a group alive — you generally never want to do this.',
        tone: 'bad',
      });
      principles.push('Never fill your own eyes — two real eyes are what make a group unconditionally alive.');
    }

    // Ko.
    if (isKo) {
      insights.push({
        tag: 'Ko',
        detail: `This single-stone capture starts a ko: ${sideName(opp)} may not immediately recapture at ${pointName(after.ko)} and must first play a threat elsewhere.`,
        tone: 'info',
      });
      principles.push('The ko rule forbids immediately recreating the previous position — fight ko by making threats.');
    }

    // Territory / framework talk when the move is quiet (no tactics fired).
    const quiet = play.captured.length === 0 && play.atariGroups.length === 0 && !play.selfAtari && !play.filledEye;
    if (quiet) {
      if (stones < 6 && (region === 'corner')) {
        insights.push({
          tag: 'Takes a corner',
          detail: 'Staking out a corner early is the most efficient way to make territory — corners need the fewest stones to enclose, then sides, then the centre.',
          tone: 'good',
        });
        principles.push('Play the corners first, then the sides, then the centre — that order is the most efficient.');
      } else if (stones < 10 && region === 'side') {
        insights.push({
          tag: 'Extends along the side',
          detail: 'Building along a side after the corners is sound — you sketch out a framework (moyo) that is hard for the opponent to erase.',
          tone: 'good',
        });
        principles.push('After the corners, extend along the sides to build a framework.');
      } else if (play.myLibs >= 4) {
        insights.push({
          tag: 'Solid shape',
          detail: 'A calm, connected move with plenty of liberties — it strengthens your position and keeps your stones working together.',
          tone: 'good',
        });
        principles.push('Stay connected and keep liberties — strong groups dictate the game.');
      } else {
        insights.push({
          tag: 'Develops',
          detail: 'A reasonable point that extends your influence and keeps your options open.',
          tone: 'info',
        });
      }
    }

    const winningBig = Math.abs(moverPlayed) > WIN / 2;
    let band: MoveExplanation['band'] = gradeByLoss(loss, winningBig);
    // Reward strong, clean tactics; punish clear self-damage.
    if (play.captured.length >= 2 && loss <= 20) band = 'great';
    if ((play.selfAtari || play.filledEye) && loss > 55) band = loss > 320 ? 'blunder' : 'mistake';

    if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
      insights.push({ tag: 'Loses ground', detail: 'A stronger move was available; this one concedes points or initiative.', tone: 'bad' });
    }

    const summary =
      play.captured.length > 0
        ? `${side} plays ${pointName(move.to)} and captures ${play.captured.length} stone${play.captured.length === 1 ? '' : 's'}.`
      : play.selfAtari ? `${side} plays ${pointName(move.to)}, but leaves the group in self-atari.`
      : play.filledEye ? `${side} plays ${pointName(move.to)}, filling its own eye.`
      : play.atariGroups.length > 0 ? `${side} plays ${pointName(move.to)} and ataris a ${sideName(opp)} group.`
      : `${side} plays ${pointName(move.to)}.`;

    const betterIdea =
      loss > 120 && res.move && res.move.to !== move.to && res.move.to !== -1
        ? `Stronger was ${pointName(res.move.to)} — ${
            opponentInAtari(before.board, opp) ? 'it answers the tactics on the board more sharply' : 'it makes points more efficiently and keeps your groups strong'
          }.`
        : undefined;

    return {
      summary, band,
      evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles,
      threats: threats.length ? threats : undefined,
      betterIdea,
    };
  },

  hint(s) {
    if (isTerminal(s)) return null;
    const res = searchBestMove(s, searchAdapter(), 2, {
      rng: mulberry32((stoneCount(s.board) + 1) * 2654435761),
    });
    if (!res.move) return null;

    if (res.move.to === -1) {
      return { move: res.move, text: 'There is nothing constructive left to play — you can pass; if your opponent also passes, the game is scored.' };
    }

    const mover = s.turn;
    const opp = other(mover);
    const play = describePlay(s.board, res.move.to, mover);
    const region = regionOf(res.move.to);
    const stones = stoneCount(s.board);

    let text: string;
    if (play.captured.length > 0) {
      text = `Play ${pointName(res.move.to)} — it captures ${play.captured.length} stone${play.captured.length === 1 ? '' : 's'}.`;
    } else if (play.atariGroups.length > 0) {
      text = `Play ${pointName(res.move.to)} — it puts a ${sideName(opp)} group in atari, threatening to capture it.`;
    } else if (stones < 6 && region === 'corner') {
      text = `Play ${pointName(res.move.to)} — take a corner; corners make territory most efficiently.`;
    } else if (stones < 12 && region === 'side') {
      text = `Play ${pointName(res.move.to)} — extend along the side to build a framework.`;
    } else {
      text = `Play ${pointName(res.move.to)} — the strongest, most solid point here.`;
    }
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Go — Weiqi in China, Baduk in Korea — is the oldest strategy game still played in its original form, and widely held to be the deepest. The rules are almost nothing: place a stone, surround to capture, surround empty points to make territory. From that seed grows a game so vast that mastering it is the work of a lifetime. This 9×9 board is the universal classroom: a full game takes minutes, yet every fundamental idea — liberties, capture, eyes and life, ko, and territory versus influence — appears on it.',
    objective: 'Control more of the board than your opponent. Your score is the area you hold — your stones on the board plus the empty points only your stones surround (your territory). White adds a 6.5-point komi for moving second, so there are no ties: the higher score wins.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          {
            title: 'Stones and the board',
            body: 'Play on the **intersections** of the 9×9 grid — 81 points. **Black** plays first, then players alternate, placing one stone per turn on any empty point. Stones never move once placed; they are only removed by capture.',
          },
          {
            title: 'Liberties',
            body: 'The empty points **orthogonally adjacent** to a stone are its **liberties** — its breathing space. A lone stone in the centre has four liberties; on a side, three; in a corner, just two. Stones of the same colour that touch along the lines form a single **group** and share all of their liberties.',
            highlight: [idx(4, 4)],
          },
          {
            title: 'Capture',
            body: 'When a group\'s **last liberty is filled** by the opponent, the whole group is **captured** — every stone is lifted off the board. You capture by completely surrounding, not by lining up. Captured points become empty again and may be played on later.',
          },
          {
            title: 'Capture resolves first',
            body: 'Your opponent\'s capture is checked **before** your own group\'s liberties. So you may play your group\'s last liberty *if that very move* captures an enemy group — removing their stones gives your stone fresh liberties. Surrounding beats being surrounded, in that order.',
          },
          {
            title: 'No suicide',
            body: 'You may **not** play a stone that would leave your own group with no liberties — unless it captures an opponent group first. A move that only kills your own stones is illegal and simply not allowed.',
          },
          {
            title: 'The ko rule',
            body: 'After a single-stone capture, your opponent may **not** immediately recapture to recreate the exact previous position — that would loop forever. This is **ko**. They must play somewhere else (often a *ko threat*) first; only then may they take back. Ko fights are among the most exciting moments in Go.',
          },
          {
            title: 'Passing and the end',
            body: 'On your turn you may **pass** instead of playing. When **both players pass in succession**, the game is over. The board is then scored — so you only pass once nothing on the board is worth more than nothing.',
          },
          {
            title: 'Area scoring',
            body: 'We use **area (Chinese) scoring**: your score is your **stones on the board** plus the **empty points only you surround** (your territory). Neutral points touching both colours count for neither. **White adds 6.5 komi**. The higher total wins — and the half-point means there are never draws.',
          },
        ],
      },
      {
        title: 'Life & Death', icon: '🫁',
        steps: [
          {
            title: 'An eye',
            body: 'An **eye** is an empty point completely surrounded by one colour\'s stones. The opponent cannot play inside it without committing suicide (it would have no liberty), so they can never fill it from the outside alone.',
          },
          {
            title: 'Two eyes mean life',
            body: 'A group with **two separate eyes** is **alive forever**. The opponent would have to fill both eyes to capture it, but filling the second-to-last liberty is illegal suicide — so they can never fill even one. Making two eyes (or sharing enough space to make them) is how groups live.',
          },
          {
            title: 'One eye is not enough',
            body: 'A group with only **one** eye, or none, can be killed: the opponent fills the outside liberties and finally the single eye, capturing everything. When two weak groups fight, the one that makes **two eyes first** lives and the other usually dies.',
          },
          {
            title: 'Never fill your own eyes',
            body: 'Because eyes give life, **filling your own eye is almost always a blunder** — you may turn a living group into a dead one. At the end of the game you leave your eyes empty; they are not territory you need to fill.',
          },
        ],
      },
      {
        title: 'Strategy', icon: '🧠',
        steps: [
          {
            title: 'Corners, then sides, then centre',
            body: 'Territory in the **corner** needs the fewest stones to enclose — two edges do half the work. The **side** is next most efficient, and the **centre** the hardest. So good openings stake out corners first, extend along sides, and only then fight over the middle.',
            highlight: STAR_POINTS,
          },
          {
            title: 'Build frameworks (moyo)',
            body: 'Rather than walling off small, sure territory at once, strong players sketch a large **framework** — a loose moyo — and invite the opponent to invade, profiting by attacking the invasion. Balance sure profit against big, influence-based potential.',
          },
          {
            title: 'Atari and ladders',
            body: 'An **atari** reduces a group to one liberty, threatening capture. Chase a stone with repeated ataris and you may drive it in a **ladder** — a zig-zag to the edge where it dies. But beware: if a friendly stone (a *ladder breaker*) waits along the path, the ladder fails and the hunter is left with weak stones.',
          },
          {
            title: 'Strong groups, then attack',
            body: 'Keep your own groups **connected and alive**; weak groups are a liability the opponent attacks for profit. Once your stones are strong, lean on the opponent\'s weak groups — attacking is the surest way to make territory while you chase.',
          },
          {
            title: 'Knowing when to pass',
            body: 'In the endgame, every point matters: play out the boundaries and the last reductions. **Pass only when no move gains you anything** — filling a neutral point in area scoring is fine, but a wasted move can hand the initiative away. When both sides agree it is over, both pass and the result is counted.',
          },
        ],
      },
    ],
  },
};

export default def;
