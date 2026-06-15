import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Xiangqi — Chinese Chess on a 9×10 board of intersections.                  */
/*                                                                            */
/*  Pieces sit on the 90 *points* where the lines cross. A horizontal "river" */
/*  splits the board between rows 4 and 5; each side owns a 3×3 "palace" that  */
/*  the General and Advisors may never leave. Red (player 0) sits on the       */
/*  bottom three ranks and moves FIRST, marching its Soldiers up toward row 0; */
/*  Black (player 1) sits along the top and marches down toward row 9.         */
/*                                                                            */
/*  The famous quirks: the Cannon moves like a rook but may only CAPTURE by    */
/*  leaping exactly one "screen" piece; Horses are "hobbled" when the point    */
/*  they step through is blocked; Elephants cannot cross the river and are     */
/*  blocked at the "elephant's eye"; and the two Generals may never face one   */
/*  another down an open file — the "flying general" rule. You win by          */
/*  delivering checkmate (or by leaving the opponent with no legal move).      */
/* -------------------------------------------------------------------------- */

const COLS = 9;
const ROWS = 10;
const N = COLS * ROWS; // 90

export type PieceType = 'G' | 'A' | 'E' | 'H' | 'R' | 'C' | 'S';

export interface Piece {
  type: PieceType;
  player: Player;
}

export interface XiangqiState {
  board: (Piece | null)[]; // 90 cells, row-major, row 0 = top (Black's edge)
  turn: Player;
}

export interface XiangqiMove extends MoveBase {
  /** Piece type that moved, for tutor/notation convenience. */
  kind: PieceType;
}

const idx = (row: number, col: number) => row * COLS + col;
const rowOf = (i: number) => Math.floor(i / COLS);
const colOf = (i: number) => i % COLS;
const onBoard = (row: number, col: number) => row >= 0 && row < ROWS && col >= 0 && col < COLS;

/** The palace columns are 3..5 for both sides; rows differ. */
const inPalace = (player: Player, row: number, col: number): boolean => {
  if (col < 3 || col > 5) return false;
  return player === 0 ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
};

/** A side's own half of the board (before crossing the river). */
const ownHalf = (player: Player, row: number): boolean =>
  player === 0 ? row >= 5 : row <= 4;

/** Has a piece on `row` crossed the river into the enemy half? */
const crossedRiver = (player: Player, row: number): boolean =>
  player === 0 ? row <= 4 : row >= 5;

/* ------------------------------- Notation -------------------------------- */
// Readable algebraic-ish coordinates: files a–i left→right (col 0→8), ranks
// 1–10 from the bottom (Red's edge) up, so rank 1 is row 9 and rank 10 is row 0.
// "H b1–c3" for a step, "R b1×b8" for a capture, trailing "+" marks a check.
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
const sq = (i: number) => `${FILES[colOf(i)]}${ROWS - rowOf(i)}`;
const sideName = (p: Player) => (p === 0 ? 'Red' : 'Black');

const PIECE_NAME: Record<PieceType, string> = {
  G: 'General', A: 'Advisor', E: 'Elephant', H: 'Horse', R: 'Chariot', C: 'Cannon', S: 'Soldier',
};

// Red glyph / Black glyph for each type.
const GLYPH: Record<PieceType, [string, string]> = {
  G: ['帥', '將'],
  A: ['仕', '士'],
  E: ['相', '象'],
  H: ['傌', '馬'],
  R: ['俥', '車'],
  C: ['炮', '砲'],
  S: ['兵', '卒'],
};

const glyphFor = (type: PieceType, player: Player) => GLYPH[type][player === 0 ? 0 : 1];

/* --------------------------- State construction -------------------------- */

function createInitialState(): XiangqiState {
  const board: (Piece | null)[] = Array(N).fill(null);
  const place = (row: number, col: number, type: PieceType, player: Player) => {
    board[idx(row, col)] = { type, player };
  };

  const backRow: PieceType[] = ['R', 'H', 'E', 'A', 'G', 'A', 'E', 'H', 'R'];

  // Black (player 1) along the top.
  for (let col = 0; col < COLS; col++) place(0, col, backRow[col], 1);
  place(2, 1, 'C', 1);
  place(2, 7, 'C', 1);
  for (const col of [0, 2, 4, 6, 8]) place(3, col, 'S', 1);

  // Red (player 0) mirrors along the bottom.
  for (const col of [0, 2, 4, 6, 8]) place(6, col, 'S', 0);
  place(7, 1, 'C', 0);
  place(7, 7, 'C', 0);
  for (let col = 0; col < COLS; col++) place(9, col, backRow[col], 0);

  return { board, turn: 0 };
}

function cloneState(s: XiangqiState): XiangqiState {
  return {
    board: s.board.map((p) => (p ? { type: p.type, player: p.player } : null)),
    turn: s.turn,
  };
}

/* ----------------------------- Move geometry ----------------------------- */
// Pseudo-legal generation (ignores leaving one's own general in check / flying
// general); the legality filter below removes the illegal ones.

const ORTHO: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Pseudo-legal destinations for the piece at `from` (as bare cell indices). */
function pseudoTargets(board: (Piece | null)[], from: number): number[] {
  const piece = board[from];
  if (!piece) return [];
  const { type, player } = piece;
  const r = rowOf(from);
  const c = colOf(from);
  const out: number[] = [];

  const friendly = (i: number) => board[i] !== null && board[i]!.player === player;

  switch (type) {
    case 'G': {
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inPalace(player, nr, nc)) continue;
        const to = idx(nr, nc);
        if (!friendly(to)) out.push(to);
      }
      break;
    }
    case 'A': {
      for (const [dr, dc] of DIAG) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inPalace(player, nr, nc)) continue;
        const to = idx(nr, nc);
        if (!friendly(to)) out.push(to);
      }
      break;
    }
    case 'E': {
      // Two points diagonally; midpoint ("eye") must be empty; never cross river.
      for (const [dr, dc] of DIAG) {
        const nr = r + 2 * dr;
        const nc = c + 2 * dc;
        if (!onBoard(nr, nc)) continue;
        if (!ownHalf(player, nr)) continue; // elephant stays on its own bank
        const eye = idx(r + dr, c + dc);
        if (board[eye] !== null) continue; // blocked at the eye
        const to = idx(nr, nc);
        if (!friendly(to)) out.push(to);
      }
      break;
    }
    case 'H': {
      // One orthogonal step (which must be empty — the "hobble" point) then one
      // diagonal step outward.
      for (const [dr, dc] of ORTHO) {
        const legR = r + dr;
        const legC = c + dc;
        if (!onBoard(legR, legC)) continue;
        if (board[idx(legR, legC)] !== null) continue; // hobbled
        // Two diagonal extensions consistent with this leg direction.
        if (dr !== 0) {
          for (const ddc of [-1, 1]) {
            const nr = legR + dr;
            const nc = legC + ddc;
            if (!onBoard(nr, nc)) continue;
            const to = idx(nr, nc);
            if (!friendly(to)) out.push(to);
          }
        } else {
          for (const ddr of [-1, 1]) {
            const nr = legR + ddr;
            const nc = legC + dc;
            if (!onBoard(nr, nc)) continue;
            const to = idx(nr, nc);
            if (!friendly(to)) out.push(to);
          }
        }
      }
      break;
    }
    case 'R': {
      // Rook: slide until a blocker; may capture an enemy blocker.
      for (const [dr, dc] of ORTHO) {
        let nr = r + dr;
        let nc = c + dc;
        while (onBoard(nr, nc)) {
          const to = idx(nr, nc);
          const occ = board[to];
          if (occ === null) {
            out.push(to);
          } else {
            if (occ.player !== player) out.push(to); // capture
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;
    }
    case 'C': {
      // Cannon: move like a rook to EMPTY squares; capture by jumping exactly
      // one screen piece (any colour) onto an enemy.
      for (const [dr, dc] of ORTHO) {
        let nr = r + dr;
        let nc = c + dc;
        // Phase 1: travel over empty squares (quiet moves).
        while (onBoard(nr, nc) && board[idx(nr, nc)] === null) {
          out.push(idx(nr, nc));
          nr += dr;
          nc += dc;
        }
        // Phase 2: we hit the screen (first piece). Look past it for a target.
        if (onBoard(nr, nc)) {
          nr += dr;
          nc += dc;
          while (onBoard(nr, nc)) {
            const occ = board[idx(nr, nc)];
            if (occ !== null) {
              if (occ.player !== player) out.push(idx(nr, nc)); // capture over screen
              break;
            }
            nr += dr;
            nc += dc;
          }
        }
      }
      break;
    }
    case 'S': {
      // Forward one step; sideways one step only after crossing the river.
      const forward = player === 0 ? -1 : 1; // Red moves up (toward row 0)
      const fr = r + forward;
      if (onBoard(fr, c) && !friendly(idx(fr, c))) out.push(idx(fr, c));
      if (crossedRiver(player, r)) {
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (onBoard(r, nc) && !friendly(idx(r, nc))) out.push(idx(r, nc));
        }
      }
      break;
    }
  }
  return out;
}

/* --------------------------- Check / legality ---------------------------- */

/** Find the cell index of `player`'s general, or -1 if captured. */
function generalCell(board: (Piece | null)[], player: Player): number {
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p && p.type === 'G' && p.player === player) return i;
  }
  return -1;
}

/**
 * The two generals "see" each other when they share a file with no piece in
 * between — the flying-general configuration, which is always illegal.
 */
function generalsFacing(board: (Piece | null)[]): boolean {
  const g0 = generalCell(board, 0);
  const g1 = generalCell(board, 1);
  if (g0 < 0 || g1 < 0) return false;
  if (colOf(g0) !== colOf(g1)) return false;
  const col = colOf(g0);
  const lo = Math.min(rowOf(g0), rowOf(g1));
  const hi = Math.max(rowOf(g0), rowOf(g1));
  for (let r = lo + 1; r < hi; r++) {
    if (board[idx(r, col)] !== null) return false; // a piece screens them
  }
  return true;
}

/**
 * Is `player`'s general attacked on this board (or are the generals facing,
 * which counts as the enemy general attacking down the open file)?
 */
function inCheckBoard(board: (Piece | null)[], player: Player): boolean {
  const gc = generalCell(board, player);
  if (gc < 0) return true; // general gone — treat as check (lost)
  if (generalsFacing(board)) return true;
  const enemy = (player ^ 1) as Player;
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p || p.player !== enemy) continue;
    // Generals' direct attack is covered by generalsFacing; skip its targets
    // here to avoid double work (its quiet steps never reach the enemy general
    // anyway since palaces don't overlap).
    if (p.type === 'G') continue;
    const targets = pseudoTargets(board, i);
    for (const t of targets) if (t === gc) return true;
  }
  return false;
}

function inCheck(s: XiangqiState, player: Player): boolean {
  return inCheckBoard(s.board, player);
}

/** Apply a from→to displacement on a board copy (capturing). */
function makeBoard(board: (Piece | null)[], from: number, to: number): (Piece | null)[] {
  const next = board.slice();
  next[to] = next[from];
  next[from] = null;
  return next;
}

/* ----------------------------- Move generation --------------------------- */

function buildMove(board: (Piece | null)[], from: number, to: number, check: boolean): XiangqiMove {
  const piece = board[from]!;
  const capture = board[to] !== null;
  const letter = piece.type; // G A E H R C S
  const notation = `${letter} ${sq(from)}${capture ? '×' : '–'}${sq(to)}${check ? '+' : ''}`;
  return {
    id: `${from}-${to}`,
    from,
    to,
    notation,
    capture,
    kind: piece.type,
  };
}

/**
 * Legal moves for the side to move. A move is legal iff, after playing it, the
 * mover's own general is neither attacked nor facing the enemy general.
 * With `fromCell` set, results are filtered to moves starting there.
 */
function legalMoves(s: XiangqiState, fromCell?: number | null): XiangqiMove[] {
  const { board, turn } = s;
  const moves: XiangqiMove[] = [];

  const sources: number[] = [];
  if (fromCell !== undefined && fromCell !== null) {
    const p = board[fromCell];
    if (p && p.player === turn) sources.push(fromCell);
  } else {
    for (let i = 0; i < N; i++) {
      const p = board[i];
      if (p && p.player === turn) sources.push(i);
    }
  }

  for (const from of sources) {
    for (const to of pseudoTargets(board, from)) {
      const next = makeBoard(board, from, to);
      if (inCheckBoard(next, turn)) continue; // leaves/forces own general in check
      // Does this move give check to the opponent? (for notation)
      const givesCheck = inCheckBoard(next, (turn ^ 1) as Player);
      moves.push(buildMove(board, from, to, givesCheck));
    }
  }
  return moves;
}

/** Fast existence check: does the side to move have ANY legal reply? */
function hasAnyLegalMove(s: XiangqiState): boolean {
  const { board, turn } = s;
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p || p.player !== turn) continue;
    for (const to of pseudoTargets(board, i)) {
      const next = makeBoard(board, i, to);
      if (!inCheckBoard(next, turn)) return true;
    }
  }
  return false;
}

/* ------------------------------- Apply move ------------------------------ */

function applyMove(s: XiangqiState, m: XiangqiMove): XiangqiState {
  const board = s.board.map((p) => (p ? { type: p.type, player: p.player } : null));
  board[m.to] = board[m.from!];
  board[m.from!] = null;
  return { board, turn: (s.turn ^ 1) as Player };
}

/* ------------------------------- Evaluation ------------------------------ */

const VALUE: Record<PieceType, number> = {
  R: 900, C: 450, H: 400, A: 200, E: 200, S: 100, G: 10000,
};

// Piece-square style nudges, small relative to material, all from the listed
// player's own viewpoint (table indexed by that player's forward orientation).
function positionalBonus(type: PieceType, player: Player, row: number, col: number): number {
  // Central files (closest to col 4) are generally stronger for mobile pieces.
  const centreCol = 4 - Math.abs(col - 4); // 0 at the rim, 4 in the centre file
  let b = 0;
  switch (type) {
    case 'S': {
      // Soldiers grow much stronger as they advance toward (and past) the river.
      const adv = player === 0 ? 9 - row : row; // 0 at home rank, 9 at far edge
      b += adv * 4;
      if (crossedRiver(player, row)) b += 20 + centreCol * 3; // pressure deep in enemy half
      break;
    }
    case 'H':
      b += centreCol * 3;
      if (ownHalf(player, row) ? false : true) b += 4; // a developed horse is active
      break;
    case 'C':
      b += centreCol * 2;
      break;
    case 'R':
      b += centreCol * 3;
      break;
    case 'E':
    case 'A':
      // Defenders are happiest at home guarding the palace; mild central nudge.
      b += centreCol;
      break;
    case 'G':
      // Keep the general tucked back, off the open central file where possible.
      b -= centreCol;
      break;
  }
  return b;
}

/**
 * Static evaluation from Red (player 0)'s perspective; positive favours Red.
 * Material dominates; on top of it we add piece-square nudges and a small
 * mobility edge for the side to move.
 */
function evaluate(s: XiangqiState): number {
  const { board } = s;
  let redGeneral = false;
  let blackGeneral = false;
  let score = 0;

  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (!p) continue;
    const sign = p.player === 0 ? 1 : -1;
    if (p.type === 'G') {
      if (p.player === 0) redGeneral = true;
      else blackGeneral = true;
    }
    score += sign * VALUE[p.type];
    score += sign * positionalBonus(p.type, p.player, rowOf(i), colOf(i));
  }

  // A missing general is decisive (should be caught by terminal status first).
  if (!redGeneral) return -WIN;
  if (!blackGeneral) return WIN;

  // Modest mobility term for the side to move (cheap pseudo-mobility count).
  let mob = 0;
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p && p.player === s.turn) mob += pseudoTargets(board, i).length;
  }
  score += (s.turn === 0 ? 1 : -1) * mob * 0.5;

  return score;
}

/* --------------------------------- Search -------------------------------- */

function captureValue(board: (Piece | null)[], to: number): number {
  const victim = board[to];
  return victim ? VALUE[victim.type] : 0;
}

function searchAdapter() {
  return {
    getLegalMoves: (s: XiangqiState) => legalMoves(s),
    applyMove,
    getTurn: (s: XiangqiState) => s.turn,
    // Terminal = the side to move has no legal reply (checkmate or stalemate);
    // either way that side has lost in Xiangqi.
    isTerminal: (s: XiangqiState) => !hasAnyLegalMove(s),
    evaluate,
    // Try captures (most valuable first) before quiet moves to sharpen pruning.
    order: (s: XiangqiState, m: XiangqiMove) =>
      (m.capture ? 1000 + captureValue(s.board, m.to) : 0),
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 3, easy: 2, medium: 3, hard: 4, master: 4 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.5, medium: 0.25, hard: 0.06, master: 0 };

function pieceCount(s: XiangqiState): number {
  let n = 0;
  for (const p of s.board) if (p) n++;
  return n;
}

function chooseMove(s: XiangqiState, difficulty: Difficulty): XiangqiMove | null {
  const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
    randomness: RAND[difficulty],
    rng: mulberry32((pieceCount(s) + s.turn + 1) * 2654435761),
  });
  return res.move;
}

/* ---------------------------- Status & helpers --------------------------- */

function getStatus(s: XiangqiState): GameStatus {
  const hasMove = hasAnyLegalMove(s);
  const checked = inCheck(s, s.turn);
  if (!hasMove) {
    // No legal move: checkmate if in check, stalemate otherwise — both lose.
    const winner = (s.turn ^ 1) as Player;
    return { kind: 'win', winner, reason: checked ? 'checkmate' : 'stalemate (no legal move)' };
  }
  if (checked) return { kind: 'check', player: s.turn };
  return { kind: 'playing' };
}

/* ------------------------------- Board view ------------------------------ */

function getBoardView(s: XiangqiState): BoardView {
  const cells = s.board.map((p, i) => ({
    index: i,
    row: rowOf(i),
    col: colOf(i),
    piece: p === null ? null : {
      id: `x${i}`,
      kind: p.type,
      player: p.player,
      glyph: glyphFor(p.type, p.player),
    },
  }));
  return {
    rows: ROWS,
    cols: COLS,
    cells,
    fileLabels: FILES.slice(),
    rankLabels: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

function materialOf(s: XiangqiState): { red: number; black: number } {
  let red = 0;
  let black = 0;
  for (const p of s.board) {
    if (!p || p.type === 'G') continue; // exclude the priceless general from "material"
    if (p.player === 0) red += VALUE[p.type];
    else black += VALUE[p.type];
  }
  return { red, black };
}

/** Is the piece moving from→to a cannon making a screen capture? */
function isCannonScreenCapture(board: (Piece | null)[], from: number, to: number): boolean {
  const piece = board[from];
  if (!piece || piece.type !== 'C') return false;
  if (board[to] === null) return false; // not a capture
  // There must be exactly one piece strictly between from and to on the line.
  const r0 = rowOf(from);
  const c0 = colOf(from);
  const r1 = rowOf(to);
  const c1 = colOf(to);
  const dr = Math.sign(r1 - r0);
  const dc = Math.sign(c1 - c0);
  let between = 0;
  let r = r0 + dr;
  let c = c0 + dc;
  while (r !== r1 || c !== c1) {
    if (board[idx(r, c)] !== null) between++;
    r += dr;
    c += dc;
  }
  return between === 1;
}

/** Was the horse at `from` hobbled in any direction on `board` (some leg blocked)? */
function horseHasBlockedLeg(board: (Piece | null)[], from: number): boolean {
  const r = rowOf(from);
  const c = colOf(from);
  for (const [dr, dc] of ORTHO) {
    const lr = r + dr;
    const lc = c + dc;
    if (onBoard(lr, lc) && board[idx(lr, lc)] !== null) return true;
  }
  return false;
}

function explainMove(before: XiangqiState, move: XiangqiMove, after: XiangqiState): MoveExplanation {
  const mover = before.turn;
  const opp = (mover ^ 1) as Player;
  const side = sideName(mover);
  const adapter = searchAdapter();

  // Grade the played move against the engine's best at tutor depth.
  const res = searchBestMove(before, adapter, DEPTH.tutor);
  const playedRanked = res.ranked.find((r) => r.move.id === move.id);
  const playedScore = playedRanked ? playedRanked.score : evaluate(after);
  const bestScore = res.ranked[0]?.score ?? playedScore;
  const moverPlayed = mover === 0 ? playedScore : -playedScore;
  const moverBest = mover === 0 ? bestScore : -bestScore;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const piece = before.board[move.from!];
  const movedType: PieceType = piece ? piece.type : move.kind;
  const captured = before.board[move.to];

  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;
  const givesCheck = inCheck(after, opp);

  // Material picture.
  const matBefore = materialOf(before);
  const matAfter = materialOf(after);
  const myBefore = mover === 0 ? matBefore.red : matBefore.black;
  const oppBefore = mover === 0 ? matBefore.black : matBefore.red;
  const aheadBefore = myBefore - oppBefore;
  const oppAfter = mover === 0 ? matAfter.black : matAfter.red;

  if (won) {
    insights.push({
      tag: 'Checkmate!',
      detail: `${sideName(opp)}'s general has no escape — the game is over.`,
      tone: 'good',
    });
  }

  // Captures.
  if (captured) {
    if (isCannonScreenCapture(before.board, move.from!, move.to)) {
      insights.push({
        tag: 'Cannon screen capture',
        detail: `The cannon leaps a single screen piece to blast the ${PIECE_NAME[captured.type].toLowerCase()} — capturing a ${VALUE[captured.type]}-point unit.`,
        tone: 'good',
      });
      principles.push('A cannon captures only by jumping exactly one screen piece — line up a screen and a target on the same file or rank.');
    } else {
      insights.push({
        tag: `Wins a ${PIECE_NAME[captured.type]}`,
        detail: `Captures the enemy ${PIECE_NAME[captured.type].toLowerCase()} (${VALUE[captured.type]} points) and shifts the material balance.`,
        tone: 'good',
      });
    }
  }

  // Check.
  if (givesCheck && !won) {
    insights.push({
      tag: 'Check!',
      detail: `Attacks ${sideName(opp)}'s general — the opponent must answer the threat at once.`,
      tone: 'good',
    });
    threats.push(`${side} threatens the enemy general; it must be defended immediately.`);
  }

  // Piece-specific colour.
  if (movedType === 'H') {
    if (horseHasBlockedLeg(after.board, move.to)) {
      insights.push({
        tag: 'Horse partly hobbled',
        detail: 'A neighbouring piece blocks one of the horse\'s legs, so some of its jumps are denied — keep its stepping-points clear.',
        tone: 'info',
      });
    } else {
      insights.push({
        tag: 'Horse activated',
        detail: 'With all four legs free, the horse covers the maximum number of points from here.',
        tone: 'good',
      });
    }
    principles.push('A horse is "hobbled" when the orthogonal point it steps through is occupied — develop horses where their legs stay open.');
  }
  if (movedType === 'S') {
    if (!crossedRiver(mover, rowOf(move.from!)) && crossedRiver(mover, rowOf(move.to))) {
      insights.push({
        tag: 'Soldier crosses the river',
        detail: 'Across the river the soldier gains the right to step sideways — it is now roughly twice as dangerous.',
        tone: 'good',
      });
      principles.push('Push soldiers across the river: they double in strength once they can also move left and right.');
    } else if (crossedRiver(mover, rowOf(move.to))) {
      insights.push({
        tag: 'Soldier presses forward',
        detail: 'A soldier deep in enemy territory cramps the opposing palace and supports an attack.',
        tone: 'good',
      });
    }
  }
  if ((movedType === 'E' || movedType === 'A')) {
    insights.push({
      tag: `${PIECE_NAME[movedType]} guards the palace`,
      detail: movedType === 'E'
        ? 'The elephant shores up the defence — remember it can never cross the river, so it lives to protect home.'
        : 'The advisor stays beside the general, screening the palace against chariots and cannons.',
      tone: 'info',
    });
    principles.push('Advisors and elephants are defenders — keep them home to shield the general.');
  }
  if (movedType === 'R' && !move.capture) {
    insights.push({
      tag: 'Chariot seeks an open file',
      detail: 'The chariot is the strongest piece; on an open file or rank it rakes the board from edge to edge.',
      tone: 'info',
    });
    principles.push('Develop your chariots to open files — they are worth far more than any other piece.');
  }
  if (movedType === 'C' && !move.capture) {
    insights.push({
      tag: 'Cannon takes aim',
      detail: 'Position the cannon behind a screen so it can later leap it to capture along the file or rank.',
      tone: 'info',
    });
  }

  // Flying-general awareness: did this move open (or threaten to open) the
  // central file between the generals?
  const gMover = generalCell(after.board, mover);
  const gOpp = generalCell(after.board, opp);
  if (gMover >= 0 && gOpp >= 0 && colOf(gMover) === colOf(gOpp)) {
    let blockers = 0;
    const col = colOf(gMover);
    const lo = Math.min(rowOf(gMover), rowOf(gOpp));
    const hi = Math.max(rowOf(gMover), rowOf(gOpp));
    for (let r = lo + 1; r < hi; r++) if (after.board[idx(r, col)] !== null) blockers++;
    if (blockers === 1) {
      insights.push({
        tag: 'Flying-general tension',
        detail: 'Only one piece now stands between the two generals on this file — if it ever moves, the "flying general" rule wins on the spot.',
        tone: 'info',
      });
      threats.push('Clearing the last piece on the generals\' file would deliver a flying-general mate.');
      principles.push('The two generals may never face each other on an open file — exploit this to pin pieces or to threaten a flying-general win.');
    }
  }

  // Trading guidance.
  const myLoss = (mover === 0 ? matBefore.red : matBefore.black) - (mover === 0 ? matAfter.red : matAfter.black);
  const tookValue = captured ? VALUE[captured.type] : 0;
  if (tookValue > 0 && oppAfter < oppBefore) {
    if (aheadBefore > 0 && myLoss === 0) {
      principles.push('When ahead in material, trade pieces freely — a thinner board magnifies your lead.');
    } else if (aheadBefore < 0 && myLoss > 0) {
      principles.push('When behind, avoid even trades; keep pieces on to retain attacking chances.');
    }
  }

  // Did the played move blunder material — can the opponent grab a piece for
  // less than they gave? Compare against the best reply.
  if (!won) {
    const reply = searchBestMove(after, adapter, Math.max(2, DEPTH.medium - 1));
    if (reply.move && reply.move.capture) {
      const replyState = applyMove(after, reply.move);
      const matReply = materialOf(replyState);
      const myAfter2 = mover === 0 ? matReply.red : matReply.black;
      const myNow = mover === 0 ? matAfter.red : matAfter.black;
      const netLoss = myNow - myAfter2; // material the reply strips from us
      if (netLoss >= 200 && netLoss > tookValue) {
        insights.push({
          tag: 'Hangs material',
          detail: `This lets ${sideName(opp)} reply with ${reply.move.notation}, winning material the move did not have to concede.`,
          tone: 'bad',
        });
        threats.push(`${sideName(opp)} can play ${reply.move.notation}.`);
      }
    }
  }

  const winningBig = Math.abs(moverPlayed) > 600;
  const band = won ? 'best' : gradeByLoss(loss, winningBig);

  if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
    insights.push({
      tag: 'Loses ground',
      detail: 'A stronger move was available; this one concedes material or initiative.',
      tone: 'bad',
    });
  }
  if (insights.length === 0) {
    insights.push({
      tag: 'Develops',
      detail: 'A sound, quiet move that improves a piece and keeps the position sound.',
      tone: 'info',
    });
  }

  const summary =
    won ? `${side} delivers checkmate with ${PIECE_NAME[movedType].toLowerCase()} ${sq(move.from!)}${move.capture ? '×' : '–'}${sq(move.to)}!`
    : captured && givesCheck ? `${side} captures with check (${move.notation}).`
    : captured ? `${side} captures the ${PIECE_NAME[captured.type].toLowerCase()} (${sq(move.from!)}×${sq(move.to)}).`
    : givesCheck ? `${side} gives check with the ${PIECE_NAME[movedType].toLowerCase()} (${sq(move.from!)}–${sq(move.to)})+.`
    : `${side} plays ${PIECE_NAME[movedType].toLowerCase()} ${sq(move.from!)}–${sq(move.to)}.`;

  return {
    summary,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length ? threats : undefined,
    betterIdea: loss > 80 && res.move && res.move.id !== move.id
      ? `Stronger was ${res.move.notation}${res.move.capture ? ' — winning material' : ''}.`
      : undefined,
  };
}

function hint(s: XiangqiState): { move: XiangqiMove; text: string } | null {
  const res = searchBestMove(s, searchAdapter(), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move;
  const mover = s.turn;
  const after = applyMove(s, m);
  const status = getStatus(after);
  const captured = s.board[m.to];
  const givesCheck = inCheck(after, (mover ^ 1) as Player);

  const text =
    status.kind === 'win' && status.winner === mover
      ? `Play ${m.notation} — it is checkmate.`
    : isCannonScreenCapture(s.board, m.from!, m.to)
      ? `Play ${m.notation} — the cannon jumps a screen to capture the ${PIECE_NAME[captured!.type].toLowerCase()}.`
    : captured && givesCheck
      ? `Play ${m.notation} — a capture that also checks the general.`
    : givesCheck
      ? `Play ${m.notation} — it puts the enemy general in check.`
    : captured
      ? `Play ${m.notation} — it wins the ${PIECE_NAME[captured.type].toLowerCase()}.`
    : `${m.notation} is the strongest move here.`;
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<XiangqiState, XiangqiMove> = {
  id: 'xiangqi',
  name: 'Xiangqi',
  tagline: 'Chinese Chess — cannons that leap, a river to cross, and the deadly flying general.',
  blurb:
    'Xiangqi, the chess of China and one of the most-played games on Earth, is a brilliant clash of cavalry, chariots and gunpowder. Cannons capture only by leaping a screen, horses can be hobbled in their tracks, soldiers grow twice as fierce once they ford the central river, and the two generals — penned in their palaces — may never look each other in the eye down an open file. Hunt the enemy general and force checkmate.',
  category: 'Strategy',
  depth: 5,
  emoji: '🀄',
  accent: '#dc2626',
  players: [
    { id: 0, name: 'Red', short: 'R', color: '#c81e1e' },
    { id: 1, name: 'Black', short: 'B', color: '#1f2937' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'xiangqi', showCoordinates: true, checkered: false, intersections: true },

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
  deserialize: (str) => JSON.parse(str) as XiangqiState,

  tutorial: {
    overview:
      'Xiangqi — Chinese Chess — is played on the lines of a 9×10 grid, with the pieces resting on the intersections. A horizontal "river" divides the two armies, and each commander is confined with two advisors to a 3×3 "palace". It shares chess\'s goal — trap the enemy king — but its cannons, river and palace give it a flavour all its own, and it is among the most widely played games in the world.',
    objective:
      'Checkmate the enemy General: attack it so that it cannot escape capture. You also win if your opponent has no legal move at all. There is no draw by stalemate — a side with no move simply loses.',
    chapters: [
      {
        title: 'The Pieces & Rules', icon: '🀄',
        steps: [
          {
            title: 'The board, the river and the palace',
            body: 'Pieces sit on the **points** of a 9×10 grid. A central **river** runs between the two halves; some pieces may not cross it. In the middle of each back edge a 3×3 **palace** (the crossed square) cages the **General** and its **Advisors** — they may never step outside it. **Red** moves first.',
            highlight: [idx(0, 3), idx(0, 4), idx(0, 5), idx(1, 3), idx(1, 4), idx(1, 5), idx(2, 3), idx(2, 4), idx(2, 5)],
          },
          {
            title: 'The General',
            body: 'The **General** (帥/將) moves **one point** orthogonally — never diagonally — and can never leave its palace. Lose it and you lose the game, so it is also worth, in effect, everything.',
            highlight: [idx(9, 4), idx(8, 4), idx(9, 3), idx(9, 5)],
          },
          {
            title: 'The flying general',
            body: 'The two Generals may **never face each other** along a file with no piece between them. Consequently a General "attacks" straight down any open file, and any move that would leave the two Generals staring at each other is **illegal**. This can even deliver mate — clear the last piece off their shared file and the game ends.',
            highlight: [idx(0, 4), idx(9, 4)],
            arrows: [{ from: idx(9, 4), to: idx(0, 4), tone: 'bad' }],
          },
          {
            title: 'The Advisor',
            body: 'The **Advisor** (仕/士) moves exactly **one point diagonally** and, like the General, stays inside the palace. The two advisors are the General\'s personal bodyguards.',
            highlight: [idx(9, 3), idx(8, 4), idx(9, 5)],
          },
          {
            title: 'The Elephant',
            body: 'The **Elephant** (相/象) moves exactly **two points diagonally**. It is blocked if the **midpoint** — the "elephant\'s eye" — is occupied, and it may **never cross the river**, so it stays home as a heavy defender.',
            highlight: [idx(9, 2), idx(7, 0), idx(7, 4), idx(8, 3)],
            arrows: [{ from: idx(9, 2), to: idx(7, 4), tone: 'info' }, { from: idx(9, 2), to: idx(7, 0), tone: 'info' }],
          },
          {
            title: 'The Horse',
            body: 'The **Horse** (傌/馬) moves like a knight: **one point orthogonally, then one point diagonally outward**. Crucially it is **"hobbled"** — blocked — if the orthogonal point it steps through is occupied. Keep your horses\' legs clear, and block the enemy\'s.',
            highlight: [idx(9, 1), idx(7, 0), idx(7, 2), idx(8, 1)],
            arrows: [{ from: idx(9, 1), to: idx(7, 0), tone: 'info' }, { from: idx(9, 1), to: idx(7, 2), tone: 'info' }],
          },
          {
            title: 'The Chariot',
            body: 'The **Chariot** (俥/車) is the rook of Xiangqi: it moves and captures **any distance orthogonally** along clear lines. It is the strongest piece on the board — get it onto open files early.',
            highlight: [idx(9, 0)],
            arrows: [{ from: idx(9, 0), to: idx(5, 0), tone: 'good' }, { from: idx(9, 0), to: idx(9, 2), tone: 'good' }],
          },
          {
            title: 'The Cannon',
            body: 'The **Cannon** (炮/砲) **moves** like a chariot along empty lines — but to **capture** it must **leap exactly one piece** (the "screen", of either colour) and land on an enemy beyond it. This unique jump-capture is the signature weapon of Xiangqi.',
            highlight: [idx(7, 1), idx(7, 4), idx(0, 1)],
            arrows: [{ from: idx(7, 1), to: idx(0, 1), tone: 'good' }],
          },
          {
            title: 'The Soldier',
            body: 'The **Soldier** (兵/卒) steps **one point forward** and never back. Once it has **crossed the river** it also gains the ability to step **one point sideways** — a soldier deep in the enemy camp is a real threat.',
            highlight: [idx(6, 4), idx(5, 4), idx(4, 4)],
            arrows: [{ from: idx(6, 4), to: idx(5, 4), tone: 'info' }],
          },
          {
            title: 'Check and checkmate',
            body: 'When the General is attacked it is in **check** and must be saved. If there is no legal way to save it, that is **checkmate** and the game is lost. Unlike Western chess there is **no stalemate draw**: a side with no legal move loses outright.',
          },
        ],
      },
      {
        title: 'Strategy', icon: '🧠',
        steps: [
          {
            title: 'Develop chariots and cannons',
            body: 'Your **chariots** are by far your most powerful pieces — bring them to **open files** quickly. **Cannons** are strongest early, when the crowded board gives them plenty of screens to jump; the classic opening places a cannon on the **central file** to bear down on the enemy palace.',
            highlight: [idx(9, 0), idx(9, 8), idx(7, 4)],
          },
          {
            title: 'Keep your horses free',
            body: 'A horse is only as good as its legs. Place horses where their stepping-points stay **clear**, and look to **hobble** the enemy\'s horses by occupying the point they need to step through. A well-placed central horse is worth as much as a cannon.',
            highlight: [idx(9, 1), idx(9, 7)],
          },
          {
            title: 'Mind the central file',
            body: 'The file in front of your General is a highway for enemy chariots and cannons — and the line of the **flying general**. Guard it, and use your own General\'s "x-ray" down an open file as a hidden weapon to pin or to threaten mate.',
            highlight: [idx(0, 4), idx(9, 4)],
            arrows: [{ from: idx(9, 4), to: idx(0, 4), tone: 'bad' }],
          },
          {
            title: 'Defend with advisors and elephants',
            body: 'Your **advisors** and **elephants** cannot attack far, but they are essential **defenders** — a General stripped of its guards is fatally exposed to chariots and cannons. Keep at least one advisor and the elephant pair intact around the palace.',
            highlight: [idx(9, 3), idx(9, 5), idx(9, 2), idx(9, 6)],
          },
          {
            title: 'March the soldiers',
            body: 'Advance soldiers to **cross the river**, where they gain sideways movement and start to cramp the enemy. A pair of soldiers working with a chariot or cannon near the enemy palace often decides the game.',
            highlight: [idx(6, 4), idx(6, 2), idx(6, 6)],
          },
          {
            title: 'Attack the palace',
            body: 'Wins come from massing force against the enemy **palace**: a chariot on the back rank, a cannon checking over a screen, a soldier or horse delivering the final blow — and always the threat of the flying general lurking down the central file. Coordinate two or three attackers and the General will have nowhere to run.',
            highlight: [idx(0, 3), idx(0, 4), idx(0, 5)],
          },
        ],
      },
    ],
  },
};

export default def;
