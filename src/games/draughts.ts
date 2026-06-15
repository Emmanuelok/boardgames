import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  International Draughts — the world game, played on a 10×10 board.           */
/*                                                                            */
/*  Also called Polish draughts, this is the variant of the World Draughts    */
/*  Federation and the European game. Twenty men a side line up on the dark   */
/*  squares — those where (row + col) is odd. White (player 0) sits along the */
/*  bottom four rows and marches up; Black (player 1) sits along the top four  */
/*  rows and marches down. Three rules set it apart from English checkers:    */
/*    • MEN capture both forwards AND backwards (they only *step* forwards).   */
/*    • KINGS are FLYING — they glide any distance along a diagonal and        */
/*      capture a lone enemy from afar, landing on any free square beyond.     */
/*    • Captures are MANDATORY and you must take the MAXIMUM number of pieces  */
/*      (the "majority rule"); among the longest sequences you choose freely.  */
/*  A man promotes to King only if it *stops* on the far row at the end of its */
/*  move; merely passing over the far row mid-capture does not crown it. A     */
/*  full multi-capture is carried as a single Move whose `path` lists every    */
/*  landing square and whose `affected` lists every captured square.          */
/* -------------------------------------------------------------------------- */

const SIZE = 10;
const N = SIZE * SIZE; // 100

export interface Piece {
  player: Player;
  king: boolean;
}

export interface DraughtsState {
  squares: (Piece | null)[]; // 100 cells, row-major, row 0 = top
  turn: Player;
}

/** A move carries the full landing path so multi-captures replay as one action. */
export interface DraughtsMove extends MoveBase {
  /** Squares the moving piece lands on, in order (excludes the start square). */
  path: number[];
}

const idx = (row: number, col: number) => row * SIZE + col;
const rowOf = (i: number) => Math.floor(i / SIZE);
const colOf = (i: number) => i % SIZE;
const onBoard = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const isPlayable = (row: number, col: number) => (row + col) % 2 === 1;

/** The far row a man must reach to be crowned. White (0) crowns on row 0 (top). */
const crownRow = (player: Player) => (player === 0 ? 0 : SIZE - 1);

/** Forward row delta for a man. White moves up (−1); Black moves down (+1). */
const manForward = (player: Player): number => (player === 0 ? -1 : 1);
/** The four diagonal directions, as [dRow, dCol]. */
const DIAGS: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/* ------------------------------- Notation -------------------------------- */
// Coordinate notation: files a–j left→right (col 0→9), ranks 1–10 bottom→top
// (so rank 1 is row index 9). "W c3-d4" for a step, "W c3×e5" for a capture.
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const sq = (i: number) => `${FILES[colOf(i)]}${SIZE - rowOf(i)}`;
const sideLetter = (p: Player) => (p === 0 ? 'W' : 'B');

/* --------------------------- State construction -------------------------- */

function createInitialState(): DraughtsState {
  const squares: (Piece | null)[] = Array(N).fill(null);
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!isPlayable(row, col)) continue;
      if (row <= 3) squares[idx(row, col)] = { player: 1, king: false }; // Black top (rows 0–3)
      else if (row >= 6) squares[idx(row, col)] = { player: 0, king: false }; // White bottom (rows 6–9)
    }
  }
  return { squares, turn: 0 };
}

function cloneState(s: DraughtsState): DraughtsState {
  return {
    squares: s.squares.map((p) => (p ? { player: p.player, king: p.king } : null)),
    turn: s.turn,
  };
}

/* ----------------------------- Move generation --------------------------- */

/**
 * All simple (non-capturing) diagonal moves for the piece at `from`.
 * A man steps one square diagonally forward; a flying King glides any number of
 * empty squares along any of the four diagonals. Simple moves are only legal
 * when the side has no capture available — the caller enforces that.
 */
function simpleSteps(squares: (Piece | null)[], from: number): DraughtsMove[] {
  const piece = squares[from];
  if (!piece) return [];
  const r = rowOf(from);
  const c = colOf(from);
  const moves: DraughtsMove[] = [];

  if (piece.king) {
    // Flying king: slide along each diagonal until blocked.
    for (const [dr, dc] of DIAGS) {
      let nr = r + dr;
      let nc = c + dc;
      while (onBoard(nr, nc) && squares[idx(nr, nc)] === null) {
        const to = idx(nr, nc);
        moves.push({
          id: `m${from}-${to}`,
          from,
          to,
          notation: `${sideLetter(piece.player)} ${sq(from)}-${sq(to)}`,
          path: [to],
        });
        nr += dr;
        nc += dc;
      }
    }
  } else {
    // Man: one square diagonally forward only.
    const dr = manForward(piece.player);
    for (const dc of [-1, 1]) {
      const nr = r + dr;
      const nc = c + dc;
      if (!onBoard(nr, nc)) continue;
      const to = idx(nr, nc);
      if (squares[to] !== null) continue; // must be empty
      moves.push({
        id: `m${from}-${to}`,
        from,
        to,
        notation: `${sideLetter(piece.player)} ${sq(from)}-${sq(to)}`,
        path: [to],
      });
    }
  }
  return moves;
}

/**
 * Enumerate every capture sequence for the piece at `start`, returning only the
 * MAXIMAL ones (those that capture the most pieces) — the majority rule. Each
 * result is a single Move: `to` is the final landing square, `path` lists every
 * landing square in order, and `affected` lists every captured square.
 *
 * Men capture in all four diagonal directions (forward and backward) to an
 * adjacent enemy with the very next square empty. Flying Kings capture by gliding
 * over empty squares to a single enemy, then landing on any empty square beyond
 * it before the next obstruction. A captured piece is *not removed* until the
 * whole sequence completes, so it stays on the board as a blocker — but the same
 * piece may never be jumped twice. Crowning only happens if the man *stops* on
 * the far row at the very end, so a man keeps capturing through the far row here.
 */
function captureSequences(squares: (Piece | null)[], start: number): DraughtsMove[] {
  const piece = squares[start];
  if (!piece) return [];
  const results: DraughtsMove[] = [];
  let maxLen = 0;

  // Walk the capture tree. `captured` already-jumped squares remain on the board
  // (as blockers) but may not be jumped again; the moving piece is treated as
  // sitting at `at`. `king` is fixed for the whole sequence (a man does not fly
  // mid-capture even if it crosses the far row).
  const walk = (at: number, captured: number[], path: number[]) => {
    const r = rowOf(at);
    const c = colOf(at);
    let extended = false;

    for (const [dr, dc] of DIAGS) {
      if (piece.king) {
        // Flying capture: glide over empty squares to the first piece on the
        // diagonal; if it is a not-yet-captured enemy and at least one empty
        // square lies beyond it, we may land on any such square.
        let nr = r + dr;
        let nc = c + dc;
        // Advance over empty squares (a still-standing captured piece blocks us).
        while (onBoard(nr, nc) && squares[idx(nr, nc)] === null && !captured.includes(idx(nr, nc))) {
          nr += dr;
          nc += dc;
        }
        if (!onBoard(nr, nc)) continue;
        const mid = idx(nr, nc);
        const victim = squares[mid];
        // Must be a standing enemy we have not already captured.
        if (!victim || victim.player === piece.player || captured.includes(mid)) continue;
        // Scan landing squares beyond the victim (each must be empty & unused).
        let lr = nr + dr;
        let lc = nc + dc;
        while (onBoard(lr, lc) && squares[idx(lr, lc)] === null && !captured.includes(idx(lr, lc))) {
          const land = idx(lr, lc);
          extended = true;
          walk(land, [...captured, mid], [...path, land]);
          lr += dr;
          lc += dc;
        }
      } else {
        // Man: jump an adjacent enemy (any direction) onto the empty square just
        // beyond it. The intervening square must hold a standing, uncaptured enemy.
        const midR = r + dr;
        const midC = c + dc;
        const landR = r + 2 * dr;
        const landC = c + 2 * dc;
        if (!onBoard(landR, landC)) continue;
        const mid = idx(midR, midC);
        const land = idx(landR, landC);
        const victim = squares[mid];
        if (!victim || victim.player === piece.player) continue; // standing enemy
        if (captured.includes(mid)) continue; // never jump the same man twice
        // Landing square must be empty and not occupied by a standing captured man.
        if (squares[land] !== null || captured.includes(land)) continue;
        extended = true;
        walk(land, [...captured, mid], [...path, land]);
      }
    }

    if (path.length > 0) {
      if (!extended) {
        // A leaf of the capture tree completes a full sequence.
        results.push(buildCapture(piece.player, start, path, captured));
      }
      // (Non-leaf nodes are not legal stopping points: a capture must continue
      //  while another capture from the current square exists.)
    }
  };

  walk(start, [], []);

  // Apply the MAJORITY (maximum-capture) rule: keep only the longest sequences.
  for (const m of results) maxLen = Math.max(maxLen, m.affected!.length);
  return results.filter((m) => m.affected!.length === maxLen);
}

function buildCapture(player: Player, start: number, path: number[], captured: number[]): DraughtsMove {
  const end = path[path.length - 1];
  return {
    id: `j${start}-${path.join('-')}`,
    from: start,
    to: end,
    notation: `${sideLetter(player)} ${sq(start)}×${sq(end)}`,
    capture: true,
    affected: captured.slice(),
    path: path.slice(),
  };
}

/**
 * Legal moves for the side to move. Captures are mandatory and, across the whole
 * board, only the sequences that capture the MAXIMUM number of pieces are legal
 * (the majority rule). With `fromCell` set, results are filtered to moves
 * originating there (used by the UI to show one piece's destinations).
 */
function legalMoves(s: DraughtsState, fromCell?: number | null): DraughtsMove[] {
  const { squares, turn } = s;

  // Gather every capture sequence; each piece already reports only its own maxima.
  const captures: DraughtsMove[] = [];
  for (let i = 0; i < N; i++) {
    const p = squares[i];
    if (p && p.player === turn) captures.push(...captureSequences(squares, i));
  }

  let moves: DraughtsMove[];
  if (captures.length > 0) {
    // Enforce the board-wide maximum: only the globally longest captures stand.
    let maxLen = 0;
    for (const m of captures) maxLen = Math.max(maxLen, m.affected!.length);
    moves = captures.filter((m) => m.affected!.length === maxLen);
  } else {
    const steps: DraughtsMove[] = [];
    for (let i = 0; i < N; i++) {
      const p = squares[i];
      if (p && p.player === turn) steps.push(...simpleSteps(squares, i));
    }
    moves = steps;
  }

  if (fromCell !== undefined && fromCell !== null) {
    return moves.filter((m) => m.from === fromCell);
  }
  return moves;
}

/* ------------------------------- Apply move ------------------------------ */

function applyMove(s: DraughtsState, m: DraughtsMove): DraughtsState {
  const squares = s.squares.map((p) => (p ? { player: p.player, king: p.king } : null));
  const piece = squares[m.from!];
  if (!piece) return { squares, turn: (s.turn ^ 1) as Player }; // defensive; shouldn't happen

  // Relocate the moving piece to its final landing square first.
  squares[m.from!] = null;
  const moved: Piece = { player: piece.player, king: piece.king };
  squares[m.to] = moved;

  // Remove every captured man — done only after the whole sequence completes.
  if (m.affected) {
    for (const c of m.affected) {
      if (c !== m.to) squares[c] = null;
    }
  }

  // Crown a man that *stopped* on its far row (passing over it does not crown).
  if (!moved.king && rowOf(m.to) === crownRow(moved.player)) {
    moved.king = true;
  }

  return { squares, turn: (s.turn ^ 1) as Player };
}

/* ------------------------------- Evaluation ------------------------------ */

const MAN = 100;
const KING = 300; // flying kings dominate the open board, worth roughly three men

// Centre-distance weighting: squares nearer the middle are worth a touch more.
// Chebyshev distance from the 4.5 centre of a 10×10 board, scaled small.
function centreBonus(row: number, col: number): number {
  const dr = Math.abs(row - 4.5);
  const dc = Math.abs(col - 4.5);
  const dist = Math.max(dr, dc); // 0.5 .. 4.5
  return (4.5 - dist) * 1.6; // ~0 at the rim, ~6.4 in the middle
}

/**
 * Static evaluation from White (player 0)'s perspective; positive favours White.
 * Material dominates; on top of it we reward advancing men, holding the back
 * row (which denies the enemy easy crownings), central occupation, king
 * centralisation, keeping men off the rim, and a small mobility / tempo edge.
 */
function evaluate(s: DraughtsState): number {
  const { squares } = s;
  let whiteCount = 0;
  let blackCount = 0;
  let score = 0;

  for (let i = 0; i < N; i++) {
    const p = squares[i];
    if (!p) continue;
    const r = rowOf(i);
    const c = colOf(i);
    const sign = p.player === 0 ? 1 : -1;
    if (p.player === 0) whiteCount++;
    else blackCount++;

    if (p.king) {
      score += sign * KING;
      // Kings want the centre, where their flying reach commands the most squares.
      score += sign * centreBonus(r, c) * 1.5;
    } else {
      score += sign * MAN;
      // Advancement: men closer to promotion are worth a little more.
      // White advances toward row 0, Black toward row 9.
      const advance = p.player === 0 ? SIZE - 1 - r : r; // 0 (home) .. 9 (far)
      score += sign * advance * 2.5;
      // Hold the back row: home-row men guard against enemy crownings.
      const backRow = p.player === 0 ? SIZE - 1 : 0;
      if (r === backRow) score += sign * 5;
      // Central files are stronger than the rim for men too.
      score += sign * centreBonus(r, c) * 0.5;
      // The side columns are passive — a small penalty for clinging to the rim.
      if (c === 0 || c === SIZE - 1) score -= sign * 4;
    }
  }

  // Material wipeout is decisive.
  if (whiteCount === 0) return -WIN;
  if (blackCount === 0) return WIN;

  // Small mobility / tempo term: more available moves is a modest plus, scored
  // for the side to move (cheap to compute) and signed to the right player.
  const mobility = legalMoves(s).length;
  score += (s.turn === 0 ? 1 : -1) * mobility * 1.2;

  return score;
}

/* --------------------------------- Search -------------------------------- */

function searchAdapter(_state: DraughtsState) {
  return {
    getLegalMoves: (s: DraughtsState) => legalMoves(s),
    applyMove,
    getTurn: (s: DraughtsState) => s.turn,
    // A side with no legal move has lost — that is the terminal condition.
    isTerminal: (s: DraughtsState) => legalMoves(s).length === 0,
    evaluate,
    // Try the biggest captures first to sharpen alpha-beta pruning.
    order: (_s: DraughtsState, m: DraughtsMove) =>
      (m.affected ? m.affected.length * 10 : 0),
  };
}

// Mandatory maximum-capture keeps the branching factor small, so we can search
// deep. Tutor analyses at full strength; the ladder of difficulties below mixes
// search depth with a dose of randomness for the gentler levels.
const DEPTH: Record<Difficulty, number> = { tutor: 5, easy: 3, medium: 5, hard: 6, master: 8 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.35, hard: 0.07, master: 0 };

function pieceCount(s: DraughtsState): number {
  let n = 0;
  for (const p of s.squares) if (p) n++;
  return n;
}

function chooseMove(s: DraughtsState, difficulty: Difficulty): DraughtsMove | null {
  const res = searchBestMove(s, searchAdapter(s), DEPTH[difficulty], {
    randomness: RAND[difficulty],
    rng: mulberry32((pieceCount(s) + s.turn + 1) * 2654435761),
  });
  return res.move;
}

/* ---------------------------- Status & helpers --------------------------- */

function materialOf(s: DraughtsState): { white: number; black: number } {
  let white = 0;
  let black = 0;
  for (const p of s.squares) {
    if (!p) continue;
    const v = p.king ? KING : MAN;
    if (p.player === 0) white += v;
    else black += v;
  }
  return { white, black };
}

function countPieces(s: DraughtsState, player: Player): number {
  let n = 0;
  for (const p of s.squares) if (p && p.player === player) n++;
  return n;
}

function getStatus(s: DraughtsState): GameStatus {
  const white = countPieces(s, 0);
  const black = countPieces(s, 1);
  if (white === 0) return { kind: 'win', winner: 1, reason: 'no pieces left' };
  if (black === 0) return { kind: 'win', winner: 0, reason: 'no pieces left' };
  if (legalMoves(s).length === 0) {
    return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'no moves left' };
  }
  return { kind: 'playing' };
}

/* ------------------------------- Board view ------------------------------ */

function getBoardView(s: DraughtsState): BoardView {
  const cells = s.squares.map((p, i) => {
    const row = rowOf(i);
    const col = colOf(i);
    const playable = isPlayable(row, col);
    return {
      index: i,
      row,
      col,
      playable,
      piece: p === null ? null : {
        id: `c${i}`,
        kind: p.king ? 'king' : 'man',
        player: p.player,
        crowned: p.king,
        glyph: p.king ? '♚' : '⛂',
      },
    };
  });
  return {
    rows: SIZE,
    cols: SIZE,
    cells,
    fileLabels: FILES.slice(),
    rankLabels: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'],
  };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

/** Does `player` have ANY capture available right now? */
function anyCapture(s: DraughtsState, player: Player): boolean {
  for (let i = 0; i < N; i++) {
    const p = s.squares[i];
    if (p && p.player === player && captureSequences(s.squares, i).length > 0) return true;
  }
  return false;
}

/** The largest single capture `player` can make in position `s` (0 if none). */
function maxCaptureFor(s: DraughtsState, player: Player): number {
  let best = 0;
  for (let i = 0; i < N; i++) {
    const p = s.squares[i];
    if (p && p.player === player) {
      for (const seq of captureSequences(s.squares, i)) {
        best = Math.max(best, seq.affected!.length);
      }
    }
  }
  return best;
}

/** How many of `player`'s back-row home squares are still occupied by men? */
function backRankIntact(s: DraughtsState, player: Player): number {
  const backRow = player === 0 ? SIZE - 1 : 0;
  let n = 0;
  for (let col = 0; col < SIZE; col++) {
    if (!isPlayable(backRow, col)) continue;
    const p = s.squares[idx(backRow, col)];
    if (p && p.player === player && !p.king) n++;
  }
  return n;
}

function isCentral(i: number): boolean {
  const r = rowOf(i);
  const c = colOf(i);
  return r >= 3 && r <= 6 && c >= 3 && c <= 6;
}

function explainMove(before: DraughtsState, move: DraughtsMove, after: DraughtsState): MoveExplanation {
  const mover = before.turn;
  const opp = (mover ^ 1) as Player;
  const side = mover === 0 ? 'White' : 'Black';
  const adapter = searchAdapter(before);

  // Grade by comparing the played move to the engine's best line. Find the move
  // that was actually played inside the ranked list (by id) to get its score;
  // the loss is how far short of the best it falls, from the mover's viewpoint.
  const res = searchBestMove(before, adapter, DEPTH.tutor);
  const bestScore = res.ranked[0]?.score ?? evaluate(after);
  const playedEntry = res.ranked.find((r) => r.move.id === move.id);
  const playedScore = playedEntry ? playedEntry.score : evaluate(after);
  const moverBest = mover === 0 ? bestScore : -bestScore;
  const moverPlayed = mover === 0 ? playedScore : -playedScore;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const captures = move.affected ? move.affected.length : 0;
  const piece = before.squares[move.from!];
  const wasMan = piece ? !piece.king : false;
  const wasKing = piece ? piece.king : false;
  const crowned = wasMan && rowOf(move.to) === crownRow(mover);

  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;

  // Material picture before and after (from the mover's side).
  const matBefore = materialOf(before);
  const matAfter = materialOf(after);
  const myMatBefore = mover === 0 ? matBefore.white : matBefore.black;
  const oppMatBefore = mover === 0 ? matBefore.black : matBefore.white;
  const aheadBefore = myMatBefore - oppMatBefore; // >0 means mover is up material
  const myMatAfter = mover === 0 ? matAfter.white : matAfter.black;
  const myLoss = myMatBefore - myMatAfter; // material the mover shed this turn

  if (won) {
    insights.push({ tag: 'Winning move', detail: `Leaves ${opp === 0 ? 'White' : 'Black'} with no legal reply — game over.`, tone: 'good' as const });
  }

  // Capturing — celebrate big multi-captures.
  if (captures >= 3) {
    insights.push({
      tag: `Grand slam ×${captures}!`,
      detail: `One flowing sequence sweeps ${captures} enemy pieces off the board — a devastating material swing.`,
      tone: 'good' as const,
    });
    principles.push('Hunt for long capturing chains — a single move can clear several pieces at once.');
  } else if (captures === 2) {
    insights.push({
      tag: 'Double capture ×2!',
      detail: 'A chained capture takes two enemy pieces in one move — a clean tactical gain.',
      tone: 'good' as const,
    });
    principles.push('Look for chained captures — one move can take several pieces at once.');
  } else if (captures === 1) {
    insights.push({ tag: 'Capture', detail: 'Takes an enemy piece and wins material.', tone: 'good' as const });
  }

  // The majority rule: was this the maximum capture available?
  if (captures >= 1) {
    const maxAvail = maxCaptureFor(before, mover);
    if (captures === maxAvail && maxAvail >= 2) {
      insights.push({
        tag: 'Majority rule',
        detail: `This is the maximum capture on the board (${maxAvail}). When you can capture, the rules force you to take the most pieces.`,
        tone: 'info' as const,
      });
      principles.push('Captures are compulsory and you must take the maximum — count every branch before committing.');
    }
  }

  // Flying-king tactics.
  if (wasKing && captures >= 1) {
    insights.push({
      tag: 'Flying king strike',
      detail: 'The king swoops along the diagonal, takes a distant enemy, and lands free beyond it — the signature weapon of the long game.',
      tone: 'good' as const,
    });
    principles.push('A flying king attacks the whole diagonal — use its reach to pick off loose men from afar.');
  } else if (wasKing && captures === 0 && Math.abs(rowOf(move.to) - rowOf(move.from!)) >= 3) {
    insights.push({ tag: 'King repositions', detail: 'The flying king glides across the board to a more active diagonal.', tone: 'info' as const });
  }

  // Crowning a king.
  if (crowned) {
    insights.push({
      tag: 'Crowned a King!',
      detail: 'Stopping on the far row promotes this man to a flying King — it now glides any distance along the diagonals in every direction.',
      tone: 'good' as const,
    });
    principles.push('Race men to the far row: a flying King controls whole diagonals and is worth roughly three men.');
    threats.push(`${side}'s new King can swoop along the long diagonals.`);
  }

  // Mandatory-capture awareness (defensive — the generator already forbids this).
  if (anyCapture(before, mover) && captures === 0) {
    insights.push({ tag: 'Capture was forced', detail: 'A capture was available and captures are mandatory.', tone: 'info' as const });
  }

  // Trading: does this capture invite an immediate recapture, and is that wise?
  const oppCaptureAfter = anyCapture(after, opp);
  if (captures >= 1 && oppCaptureAfter) {
    if (aheadBefore > 0) {
      insights.push({
        tag: 'Trade while ahead',
        detail: 'Exchanging material while you lead simplifies toward a winning endgame.',
        tone: 'good' as const,
      });
      principles.push('When ahead, trade pieces — fewer men on the board magnifies your lead.');
    } else if (aheadBefore < 0) {
      insights.push({
        tag: 'Trade while behind',
        detail: 'Swapping pieces when you are down material only sharpens the opponent\'s edge — keep men on instead.',
        tone: 'bad' as const,
      });
      principles.push('When behind, keep pieces on — avoid trades that simplify into a lost endgame.');
    }
  }

  // Central control.
  if (!crowned && captures === 0 && wasMan && isCentral(move.to) && !isCentral(move.from!)) {
    insights.push({ tag: 'Takes the center', detail: 'Occupying the central squares gives a man the most influence and the safest formation.', tone: 'good' as const });
    principles.push('Control the center — a strong central phalanx is hard to break and dictates play.');
  }

  // Keeping the back row early.
  const movesPlayed = N - pieceCount(before); // proxy for how far the game has progressed
  const earlyGame = movesPlayed < 8;
  const backWasIntact = backRankIntact(before, mover);
  const backNowIntact = backRankIntact(after, mover);
  if (earlyGame && wasMan && backWasIntact > backNowIntact) {
    insights.push({
      tag: 'Back row loosened',
      detail: 'Advancing a back-row man this early opens a lane an enemy man could exploit to promote.',
      tone: 'bad' as const,
    });
    principles.push('Keep your back row intact early — it blocks the squares where enemy men would crown.');
  }

  // Does the played move hang material — can the opponent reply with a bigger
  // capture than they had before? Compare to the engine's best reply.
  const oppMaxBefore = maxCaptureFor(before, opp);
  const oppBest = searchBestMove(after, searchAdapter(after), DEPTH.medium);
  if (!won && oppBest.move) {
    const oppGain = oppBest.move.affected?.length ?? 0;
    // A genuine hang: the opponent can now take more than they could before, and
    // more than we shed in our own move (i.e. not merely a recapture in a swap).
    if (oppGain > 0 && oppGain > oppMaxBefore && oppGain * MAN > myLoss + 60) {
      if (oppGain >= 2) {
        insights.push({ tag: 'Allows a multi-capture', detail: `The opponent can answer with a ${oppGain}-piece chain — a costly oversight.`, tone: 'bad' as const });
      } else {
        insights.push({ tag: 'Hangs a piece', detail: 'This exposes a piece the opponent can capture for free next turn.', tone: 'bad' as const });
      }
      threats.push(`${opp === 0 ? 'White' : 'Black'} can reply with ${oppBest.move.notation}.`);
    }
  }

  const winningBig = Math.abs(moverPlayed) > 250;
  const band = won ? 'best' : gradeByLoss(loss, winningBig);

  if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
    insights.push({ tag: 'Loses ground', detail: 'A sharper move was available; this one concedes material or position.', tone: 'bad' as const });
  }
  if (insights.length === 0) {
    insights.push({ tag: 'Develops', detail: 'A sound, quiet move that keeps the position balanced.', tone: 'info' as const });
  }

  const summary =
    won ? `${side} leaves the opponent with no move and wins!`
    : crowned && captures >= 1 ? `${side} captures into the far row and crowns a King.`
    : captures >= 3 ? `${side} sweeps a ${captures}-piece chain off the board.`
    : captures === 2 ? `${side} chains a double capture.`
    : captures === 1 ? `${side} captures a piece (${sq(move.from!)}×${sq(move.to)}).`
    : crowned ? `${side} stops on the far row and crowns a King.`
    : wasKing ? `${side}'s King glides to ${sq(move.to)}.`
    : `${side} steps ${sq(move.from!)}-${sq(move.to)}.`;

  return {
    summary,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length ? threats : undefined,
    betterIdea: loss > 60 && res.move && res.move.id !== move.id
      ? `Stronger was ${res.move.notation}${(res.move.affected?.length ?? 0) >= 2 ? ' — a multi-capture' : (res.move.affected?.length ?? 0) === 1 ? ' — a capture' : ''}.`
      : undefined,
  };
}

function hint(s: DraughtsState): { move: DraughtsMove; text: string } | null {
  const res = searchBestMove(s, searchAdapter(s), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move;
  const mover = s.turn;
  const after = applyMove(s, m);
  const piece = s.squares[m.from!];
  const wasMan = piece ? !piece.king : false;
  const wasKing = piece ? piece.king : false;
  const crowned = wasMan && rowOf(m.to) === crownRow(mover);
  const captures = m.affected ? m.affected.length : 0;
  const status = getStatus(after);

  const text =
    status.kind === 'win' && status.winner === mover
      ? `Play ${m.notation} — it leaves the opponent with no reply and wins.`
    : captures >= 3 ? `Play ${m.notation} — a forced ${captures}-piece chain that sweeps the board.`
    : captures === 2 ? `Play ${m.notation} — a double capture; remember you must take the maximum.`
    : captures === 1 && crowned ? `Play ${m.notation} — capture and crown a King in one move.`
    : captures === 1 && wasKing ? `Play ${m.notation} — a flying-king strike picks off a loose man.`
    : crowned ? `Play ${m.notation} to stop on the far row and crown a King.`
    : captures === 1 ? `Play ${m.notation} — captures are mandatory and this one wins material.`
    : wasKing ? `Play ${m.notation} — reposition the King to a more active diagonal.`
    : isCentral(m.to) ? `Play ${m.notation} — claim the center to build a strong formation.`
    : `${m.notation} is the strongest move here.`;
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<DraughtsState, DraughtsMove> = {
  id: 'draughts',
  name: 'International Draughts',
  tagline: 'The 10×10 world game — flying kings, forced captures, and the merciless majority rule.',
  blurb: 'International Draughts is the grand version of the game played across Europe and contested at the world championship. On a sweeping 10×10 board, twenty men a side hunt along the diagonals: men capture forwards and backwards, captures are compulsory, and the majority rule forces you to take the maximum number of pieces every time. Promote a man on the far row and it becomes a FLYING KING — gliding the length of a diagonal to strike distant enemies from afar. Deeper, sharper, and more combinational than the 8×8 game, it rewards calculation, sacrifice, and the relentless logic of the longest capture.',
  category: 'Classic',
  depth: 4,
  emoji: '⛀',
  accent: '#94a3b8',
  players: [
    { id: 0, name: 'White', short: 'W', color: '#e2e8f0' },
    { id: 1, name: 'Black', short: 'B', color: '#1f2937' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },

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
  deserialize: (str) => JSON.parse(str) as DraughtsState,

  tutorial: {
    overview: 'International Draughts — also called Polish draughts — is the world\'s premier draughts game, played on a 10×10 board with twenty pieces a side. It looks like checkers grown large, but three rules give it far greater depth: men capture both forwards and backwards, kings FLY any distance along the diagonals, and you must always make the capture that takes the MOST pieces. The result is a deeply combinational game of long forced sequences, sacrifices and breakthroughs.',
    objective: 'Capture or trap every one of your opponent\'s pieces. You win the moment your opponent has no legal move — because they have no pieces left, or because every piece they own is blocked.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          {
            title: 'A bigger board, dark squares only',
            body: 'Play happens solely on the **dark squares** of the 10×10 board — 50 of them. **White** lines up twenty men on the four rows nearest you and moves **up** the board; **Black** lines up twenty on the four far rows and moves **down**. White moves first, then players alternate.',
          },
          {
            title: 'Men step diagonally forward',
            body: 'An ordinary piece — a **man** — slides one square diagonally **forward** onto an empty dark square. For quiet moves, men never go sideways, straight, or backward.',
            highlight: [idx(6, 3), idx(5, 2), idx(5, 4)],
          },
          {
            title: 'Men capture BOTH ways',
            body: 'Here is the first big difference from checkers: a **man captures in any diagonal direction — forwards *and* backwards**. Jump over an adjacent enemy onto the empty square just beyond, in whichever of the four diagonals the capture is available, and remove the jumped piece.',
            highlight: [idx(5, 4), idx(4, 3), idx(3, 2)],
            arrows: [{ from: idx(5, 4), to: idx(3, 2), tone: 'good' }],
          },
          {
            title: 'Captures are mandatory',
            body: 'If you can capture, you **must** — a quiet move is illegal whenever any capture exists. Captures continue in a chain: after a jump, if the same piece can capture again it carries on, taking piece after piece, and the whole chain is your single move.',
            highlight: [idx(5, 4), idx(4, 3), idx(2, 3)],
          },
          {
            title: 'The majority rule',
            body: 'The second big difference: when several captures are possible you must play one that takes the **maximum number of pieces**. If one line wins three men and another wins two, you are **forced** to take the three. Among lines that capture the same maximum, you may choose freely.',
            highlight: [idx(4, 3), idx(3, 4), idx(3, 2), idx(1, 4), idx(1, 2)],
          },
          {
            title: 'Captured pieces stay until the end',
            body: 'During a multi-capture the jumped pieces are **not removed until the whole sequence finishes** — they remain on the board as blockers, and you may **never jump the same piece twice**. This subtlety decides which long chains are actually legal.',
          },
          {
            title: 'Promotion — only if you STOP there',
            body: 'When a man **stops** on the far row at the end of its move, it is **crowned a King**. Crucially, if a man only **passes over** the far row in the middle of a capture and lands elsewhere, it is **not** promoted — it stays a man. Plan your captures so they end on the crowning row.',
            highlight: [idx(0, 1), idx(0, 3), idx(0, 5), idx(0, 7), idx(0, 9)],
          },
          {
            title: 'Flying Kings rule the diagonals',
            body: 'The third big difference: a **King flies**. It glides **any number of empty squares** along a diagonal in any of the four directions. To capture, it sails over empty squares to a single enemy and lands on **any** empty square beyond — striking from clear across the board.',
            highlight: [idx(7, 2), idx(5, 4), idx(3, 6), idx(2, 7)],
            arrows: [{ from: idx(7, 2), to: idx(2, 7), tone: 'good' }],
          },
          {
            title: 'How you win',
            body: 'You win when your opponent has **no legal move** — every piece captured, or every remaining piece blocked. Because the board is large and kings are powerful, even a modest material edge usually decides the game.',
          },
        ],
      },
      {
        title: 'Winning Strategy', icon: '🧠',
        steps: [
          {
            title: 'Fight for the centre',
            body: 'Men in the **centre** support one another and influence the most squares, while edge men are passive and easily cut off. Build a solid central formation in the opening and avoid drifting your men to the rim without reason.',
            highlight: [idx(5, 4), idx(5, 6), idx(4, 3), idx(4, 5)],
          },
          {
            title: 'Count before you capture',
            body: 'Because the **majority rule** forces the longest capture, calculation is everything. Before you offer or accept a piece, trace every branch of the resulting chain — for both sides. The line that *looks* winning may force *you* into giving back even more.',
            highlight: [idx(4, 5), idx(3, 4), idx(2, 3)],
          },
          {
            title: 'The long diagonal',
            body: 'The great corner-to-corner **long diagonal** (a1–j10) is the highway of the flying king. Controlling it lets your king reach almost anywhere and threaten both wings at once. Fighting for the long diagonal is a recurring strategic theme of the master game.',
            highlight: [idx(9, 0), idx(7, 2), idx(5, 4), idx(3, 6), idx(0, 9)],
          },
          {
            title: 'Engineer a breakthrough',
            body: 'A **breakthrough** sacrifices one or two men to shove a runner through a gap in the enemy line and crown it. Because promotion needs only that you *stop* on the last row, a well-timed sacrifice that clears the path can turn a man into a board-dominating king.',
            highlight: [idx(2, 3), idx(1, 2), idx(1, 4), idx(0, 3)],
          },
          {
            title: 'The power of Kings',
            body: 'A **flying King** is worth roughly **three men**: it rakes entire diagonals, captures from a distance, and shepherds your own men. Getting the first king is often decisive — race to promote, then use the king\'s reach to harvest loose enemy pieces and steer the endgame.',
            highlight: [idx(0, 3)],
          },
          {
            title: 'Trade with the lead, hold when behind',
            body: 'When you are **up material**, exchange pieces at every fair chance — each swap shrinks the board and magnifies your edge toward a won endgame. When you are **behind**, do the opposite: keep pieces on, complicate, and seek a saving combination before the simplification finishes you off.',
          },
        ],
      },
    ],
  },
};

export default def;
