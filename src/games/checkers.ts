import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Checkers — English / American draughts on an 8×8 board.                    */
/*                                                                            */
/*  Only the dark squares — those where (row + col) is odd — are ever used.   */
/*  Red (player 0) sits along the bottom three ranks and marches up the       */
/*  board; Black (player 1) sits along the top three ranks and marches down.  */
/*  Men step one square diagonally forward and capture by jumping a forward   */
/*  neighbour; a man reaching the far rank is crowned a King and may then     */
/*  move and capture in all four diagonal directions. Captures are mandatory  */
/*  and a jump that can continue must continue — a full multi-jump is carried */
/*  as a single Move whose `path` lists each landing square and whose         */
/*  `affected` lists every captured square.                                   */
/* -------------------------------------------------------------------------- */

const SIZE = 8;
const N = SIZE * SIZE; // 64

export interface Piece {
  player: Player;
  king: boolean;
}

export interface CheckersState {
  squares: (Piece | null)[]; // 64 cells, row-major, row 0 = top
  turn: Player;
}

/** A move carries the full landing path so multi-jumps replay as one action. */
export interface CheckersMove extends MoveBase {
  /** Squares the moving piece lands on, in order (excludes the start square). */
  path: number[];
}

const idx = (row: number, col: number) => row * SIZE + col;
const rowOf = (i: number) => Math.floor(i / SIZE);
const colOf = (i: number) => i % SIZE;
const onBoard = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const isPlayable = (row: number, col: number) => (row + col) % 2 === 1;

/** The far rank a man must reach to be crowned. Red (0) crowns on row 0 (top). */
const crownRow = (player: Player) => (player === 0 ? 0 : SIZE - 1);

/** Forward row deltas for a man. Red moves up (−1); Black moves down (+1). */
const manRowDirs = (player: Player): number[] => (player === 0 ? [-1] : [1]);
const KING_ROW_DIRS = [-1, 1];
const COL_DIRS = [-1, 1];

/* ------------------------------- Notation -------------------------------- */
// Coordinate notation: files a–h left→right (col 0→7), ranks 1–8 bottom→top
// (so rank 1 is row index 7). "R c3–d4" for a step, "R c3×e5" for a jump.
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const sq = (i: number) => `${FILES[colOf(i)]}${SIZE - rowOf(i)}`;
const sideLetter = (p: Player) => (p === 0 ? 'R' : 'B');

/* --------------------------- State construction -------------------------- */

function createInitialState(): CheckersState {
  const squares: (Piece | null)[] = Array(N).fill(null);
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!isPlayable(row, col)) continue;
      if (row <= 2) squares[idx(row, col)] = { player: 1, king: false }; // Black top
      else if (row >= 5) squares[idx(row, col)] = { player: 0, king: false }; // Red bottom
    }
  }
  return { squares, turn: 0 };
}

function cloneState(s: CheckersState): CheckersState {
  return {
    squares: s.squares.map((p) => (p ? { player: p.player, king: p.king } : null)),
    turn: s.turn,
  };
}

/* ----------------------------- Move generation --------------------------- */

/** Row directions a piece may travel given its colour and crown. */
function rowDirsFor(piece: Piece): number[] {
  return piece.king ? KING_ROW_DIRS : manRowDirs(piece.player);
}

/**
 * All simple (non-capturing) diagonal steps for the piece at `from`.
 * A simple step is never legal when any capture exists for the side — the
 * caller enforces that — so this only encodes geometry.
 */
function simpleSteps(squares: (Piece | null)[], from: number): CheckersMove[] {
  const piece = squares[from];
  if (!piece) return [];
  const r = rowOf(from);
  const c = colOf(from);
  const moves: CheckersMove[] = [];
  for (const dr of rowDirsFor(piece)) {
    for (const dc of COL_DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!onBoard(nr, nc)) continue;
      const to = idx(nr, nc);
      if (squares[to] !== null) continue; // must be empty
      moves.push({
        id: `m${from}-${to}`,
        from,
        to,
        notation: `${sideLetter(piece.player)} ${sq(from)}–${sq(to)}`,
        path: [to],
      });
    }
  }
  return moves;
}

/**
 * Enumerate every maximal capture sequence for the piece at `start`.
 * Each result is a single Move: `to` is the final landing square, `path` lists
 * every landing square in order, and `affected` lists every jumped square.
 *
 * Per American draughts in this variant: a man jumps only forward, and crowning
 * ends the move — once a man lands on its far rank the sequence stops even if a
 * further jump would exist (a man does not jump again "as a king" on the same
 * turn). Kings jump in all four diagonal directions.
 */
function captureSequences(squares: (Piece | null)[], start: number): CheckersMove[] {
  const piece = squares[start];
  if (!piece) return [];
  const results: CheckersMove[] = [];

  // Walk the jump tree. `board` is a working copy with captured men removed and
  // the moving piece relocated to `at`; `king` tracks the (fixed) crown state.
  const walk = (
    board: (Piece | null)[],
    at: number,
    king: boolean,
    captured: number[],
    path: number[],
  ) => {
    const rowDirs = king ? KING_ROW_DIRS : manRowDirs(piece.player);
    const r = rowOf(at);
    const c = colOf(at);
    let extended = false;

    for (const dr of rowDirs) {
      for (const dc of COL_DIRS) {
        const midR = r + dr;
        const midC = c + dc;
        const landR = r + 2 * dr;
        const landC = c + 2 * dc;
        if (!onBoard(landR, landC)) continue;
        const mid = idx(midR, midC);
        const land = idx(landR, landC);
        const victim = board[mid];
        if (!victim || victim.player === piece.player) continue; // must jump an enemy
        if (board[land] !== null) continue; // landing square must be empty
        if (captured.includes(mid)) continue; // never jump the same man twice

        extended = true;
        const next = board.slice();
        next[mid] = null; // remove captured man
        next[at] = null;
        next[land] = piece; // (reference reuse is fine; we never mutate it)

        const nextCaptured = [...captured, mid];
        const nextPath = [...path, land];

        // Crowning ends the move: a man that reaches its far rank stops here.
        const crowned = !king && land === idx(crownRow(piece.player), landC);
        if (crowned) {
          results.push(buildJump(piece.player, start, nextPath, nextCaptured));
        } else {
          walk(next, land, king, nextCaptured, nextPath);
        }
      }
    }

    // A leaf of the jump tree (no further jump available) completes a sequence.
    if (!extended && path.length > 0) {
      results.push(buildJump(piece.player, start, path, captured));
    }
  };

  walk(squares, start, piece.king, [], []);
  return results;
}

function buildJump(player: Player, start: number, path: number[], captured: number[]): CheckersMove {
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
 * Legal moves for the side to move. Captures are mandatory: if any capture
 * exists, only captures are returned. With `fromCell` set, results are filtered
 * to moves originating there (used by the UI to show one piece's destinations).
 */
function legalMoves(s: CheckersState, fromCell?: number | null): CheckersMove[] {
  const { squares, turn } = s;

  // Gather captures first — they take precedence over quiet moves.
  const captures: CheckersMove[] = [];
  for (let i = 0; i < N; i++) {
    const p = squares[i];
    if (p && p.player === turn) captures.push(...captureSequences(squares, i));
  }

  let moves: CheckersMove[];
  if (captures.length > 0) {
    moves = captures;
  } else {
    const steps: CheckersMove[] = [];
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

function applyMove(s: CheckersState, m: CheckersMove): CheckersState {
  const squares = s.squares.map((p) => (p ? { player: p.player, king: p.king } : null));
  const piece = squares[m.from!];
  if (!piece) return { squares, turn: (s.turn ^ 1) as Player }; // defensive; shouldn't happen

  // Remove every captured man.
  if (m.affected) {
    for (const c of m.affected) squares[c] = null;
  }

  // Relocate the moving piece to its final landing square.
  squares[m.from!] = null;
  const moved: Piece = { player: piece.player, king: piece.king };
  squares[m.to] = moved;

  // Crown a man that reached its far rank.
  if (!moved.king && rowOf(m.to) === crownRow(moved.player)) {
    moved.king = true;
  }

  return { squares, turn: (s.turn ^ 1) as Player };
}

/* ------------------------------- Evaluation ------------------------------ */

const MAN = 100;
const KING = 175;

// Centre-distance weighting: squares nearer the middle are worth a touch more.
// Measured as 3 − Chebyshev distance from the 3.5 centre, scaled small.
function centreBonus(row: number, col: number): number {
  const dr = Math.abs(row - 3.5);
  const dc = Math.abs(col - 3.5);
  const dist = Math.max(dr, dc); // 0.5 .. 3.5
  return (3.5 - dist) * 2; // ~0 at the rim, ~6 in the middle
}

/**
 * Static evaluation from Red (player 0)'s perspective; positive favours Red.
 * Material dominates; on top of it we reward advancing men, holding the back
 * rank (which denies the enemy easy crownings), central occupation, king
 * centralisation, and a small mobility edge.
 */
function evaluate(s: CheckersState): number {
  const { squares } = s;
  let redCount = 0;
  let blackCount = 0;
  let score = 0;

  for (let i = 0; i < N; i++) {
    const p = squares[i];
    if (!p) continue;
    const r = rowOf(i);
    const c = colOf(i);
    const sign = p.player === 0 ? 1 : -1;
    if (p.player === 0) redCount++;
    else blackCount++;

    if (p.king) {
      score += sign * KING;
      // Kings want the centre, where they command the most squares.
      score += sign * centreBonus(r, c) * 1.5;
    } else {
      score += sign * MAN;
      // Advancement: men closer to promotion are worth a little more.
      // Red advances toward row 0, Black toward row 7.
      const advance = p.player === 0 ? SIZE - 1 - r : r; // 0 (home) .. 7 (far)
      score += sign * advance * 3;
      // Hold the back rank: the two home-rank squares guard against crownings.
      const backRow = p.player === 0 ? SIZE - 1 : 0;
      if (r === backRow) score += sign * 6;
      // Central files are stronger than the rim for men too.
      score += sign * centreBonus(r, c) * 0.6;
    }
  }

  // Wipeout / no-material terminal is handled in the search via isTerminal, but
  // make material loss decisive here too.
  if (redCount === 0) return -WIN;
  if (blackCount === 0) return WIN;

  // Small mobility term: more available moves is a modest plus. Computed for the
  // side to move only (cheap), signed to the right player.
  const mobility = legalMoves(s).length;
  score += (s.turn === 0 ? 1 : -1) * mobility * 1.5;

  return score;
}

/* --------------------------------- Search -------------------------------- */

function searchAdapter(_state: CheckersState) {
  return {
    getLegalMoves: (s: CheckersState) => legalMoves(s),
    applyMove,
    getTurn: (s: CheckersState) => s.turn,
    // A side with no legal move has lost — that is the terminal condition.
    isTerminal: (s: CheckersState) => legalMoves(s).length === 0,
    evaluate,
    // Try captures (and longer captures) first to sharpen alpha-beta pruning.
    order: (_s: CheckersState, m: CheckersMove) =>
      (m.affected ? m.affected.length * 10 : 0),
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 6, easy: 3, medium: 5, hard: 7, master: 8 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.35, hard: 0.07, master: 0 };

function pieceCount(s: CheckersState): number {
  let n = 0;
  for (const p of s.squares) if (p) n++;
  return n;
}

function chooseMove(s: CheckersState, difficulty: Difficulty): CheckersMove | null {
  const res = searchBestMove(s, searchAdapter(s), DEPTH[difficulty], {
    randomness: RAND[difficulty],
    rng: mulberry32((pieceCount(s) + s.turn + 1) * 2654435761),
  });
  return res.move;
}

/* ---------------------------- Status & helpers --------------------------- */

function materialOf(s: CheckersState): { red: number; black: number } {
  let red = 0;
  let black = 0;
  for (const p of s.squares) {
    if (!p) continue;
    const v = p.king ? KING : MAN;
    if (p.player === 0) red += v;
    else black += v;
  }
  return { red, black };
}

function countPieces(s: CheckersState, player: Player): number {
  let n = 0;
  for (const p of s.squares) if (p && p.player === player) n++;
  return n;
}

function getStatus(s: CheckersState): GameStatus {
  const red = countPieces(s, 0);
  const black = countPieces(s, 1);
  if (red === 0) return { kind: 'win', winner: 1, reason: 'no pieces left' };
  if (black === 0) return { kind: 'win', winner: 0, reason: 'no pieces left' };
  if (legalMoves(s).length === 0) {
    return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'no moves left' };
  }
  return { kind: 'playing' };
}

/* ------------------------------- Board view ------------------------------ */

function getBoardView(s: CheckersState): BoardView {
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
    rankLabels: ['8', '7', '6', '5', '4', '3', '2', '1'],
  };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

/** Squares from which `player` could immediately capture in position `s`. */
function captureCount(squares: (Piece | null)[], player: Player): number {
  let n = 0;
  for (let i = 0; i < N; i++) {
    const p = squares[i];
    if (p && p.player === player && captureSequences(squares, i).length > 0) n++;
  }
  return n;
}

/** Does `player` have ANY capture available right now? */
function anyCapture(s: CheckersState, player: Player): boolean {
  for (let i = 0; i < N; i++) {
    const p = s.squares[i];
    if (p && p.player === player && captureSequences(s.squares, i).length > 0) return true;
  }
  return false;
}

/** How many of `player`'s back-rank home squares are still occupied by men? */
function backRankIntact(s: CheckersState, player: Player): number {
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
  return r >= 2 && r <= 5 && c >= 2 && c <= 5;
}

function explainMove(before: CheckersState, move: CheckersMove, after: CheckersState): MoveExplanation {
  const mover = before.turn;
  const opp = (mover ^ 1) as Player;
  const side = mover === 0 ? 'Red' : 'Black';
  const adapter = searchAdapter(before);

  // Grade by comparing the played move to the engine's best (deep, exact).
  const res = searchBestMove(before, adapter, DEPTH.tutor);
  const playedEval = evaluate(after);
  const bestEval = res.ranked[0]?.score ?? playedEval;
  const moverPlayed = mover === 0 ? playedEval : -playedEval;
  const moverBest = mover === 0 ? bestEval : -bestEval;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const captures = move.affected ? move.affected.length : 0;
  const piece = before.squares[move.from!];
  const wasMan = piece ? !piece.king : false;
  const crowned = wasMan && rowOf(move.to) === crownRow(mover);

  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;

  // Material picture before and after (from the mover's side).
  const matBefore = materialOf(before);
  const matAfter = materialOf(after);
  const myMatBefore = mover === 0 ? matBefore.red : matBefore.black;
  const oppMatBefore = mover === 0 ? matBefore.black : matBefore.red;
  const aheadBefore = myMatBefore - oppMatBefore; // >0 means mover is up material
  const myMatAfter = mover === 0 ? matAfter.red : matAfter.black;
  const oppMatAfter = mover === 0 ? matAfter.black : matAfter.red;

  // Did the mover lose a piece on this move (a trade where they were also taken)?
  const myLoss = myMatBefore - myMatAfter; // material the mover shed (in a swap, captures often come back)

  if (won) {
    insights.push({ tag: 'Winning move', detail: `Leaves ${opp === 0 ? 'Red' : 'Black'} with no reply — game over.`, tone: 'good' as const });
  }

  // Capturing — celebrate multi-jumps.
  if (captures >= 2) {
    insights.push({
      tag: `Multi-jump ×${captures}!`,
      detail: `A single chained jump sweeps ${captures} enemy pieces off the board — a decisive material swing.`,
      tone: 'good' as const,
    });
    principles.push('Look for chained jumps — one move can capture several pieces at once.');
  } else if (captures === 1) {
    insights.push({ tag: 'Capture', detail: 'Jumps an enemy piece and wins material.', tone: 'good' as const });
  }

  // Crowning a king.
  if (crowned) {
    insights.push({
      tag: 'Crowned a King!',
      detail: 'Reaching the far rank promotes this man to a King — it can now move and capture in all four directions.',
      tone: 'good' as const,
    });
    principles.push('Push men toward the last rank: a King is far stronger, worth nearly two men.');
    threats.push(`${side}'s new King roams both forward and backward.`);
  }

  // Mandatory-capture awareness: did the mover have to take?
  if (anyCapture(before, mover) && captures === 0) {
    // Should be impossible given the generator, but explain defensively.
    insights.push({ tag: 'Capture was forced', detail: 'A jump was available and captures are mandatory.', tone: 'info' as const });
  }

  // Trading: does this move offer / complete an even swap, and is it wise?
  // After our move, can the opponent immediately recapture into roughly parity?
  const oppCaptureAfter = anyCapture(after, opp);
  if (captures >= 1 && oppCaptureAfter) {
    if (aheadBefore > 0) {
      insights.push({
        tag: 'Trade while ahead',
        detail: 'Exchanging pieces when you lead in material simplifies toward a winning endgame.',
        tone: 'good' as const,
      });
      principles.push('When ahead, trade pieces — fewer men on the board magnifies your lead.');
    } else if (aheadBefore < 0) {
      insights.push({
        tag: 'Trade while behind',
        detail: 'Swapping pieces when you are down material only sharpens the opponent\'s advantage — avoid it when you can.',
        tone: 'bad' as const,
      });
      principles.push('When behind, keep pieces on — avoid trades that simplify into a lost endgame.');
    }
  }

  // Central control.
  if (!crowned && captures === 0 && isCentral(move.to) && !isCentral(move.from!)) {
    insights.push({ tag: 'Takes the center', detail: 'Occupying the central squares gives a man the most influence and mobility.', tone: 'good' as const });
    principles.push('Control the center — central pieces attack more squares and are harder to trap.');
  }

  // Keeping the back row early.
  const movesPlayed = N - pieceCount(before); // proxy for how far the game has progressed
  const earlyGame = movesPlayed < 6;
  const backWasIntact = backRankIntact(before, mover);
  const backNowIntact = backRankIntact(after, mover);
  if (earlyGame && wasMan && backWasIntact > backNowIntact) {
    insights.push({
      tag: 'Back rank loosened',
      detail: 'Advancing a back-rank man this early opens a lane for an enemy man to slip in and be crowned.',
      tone: 'bad' as const,
    });
    principles.push('Keep your back row intact early — it blocks the squares where enemy men would promote.');
  }

  // Does the played move hang material — can the opponent reply with a capture
  // that nets pieces we did not have to give? Compare to the best line.
  const oppBest = searchBestMove(after, searchAdapter(after), DEPTH.hard - 2);
  if (!won && oppBest.move && (oppBest.move.affected?.length ?? 0) > 0) {
    const oppReply = applyMove(after, oppBest.move);
    const matReply = materialOf(oppReply);
    const myAfterReply = mover === 0 ? matReply.red : matReply.black;
    const netLoss = myMatAfter - myAfterReply; // material we lose to the reply
    // Only flag a genuine hang: a loss not recouped by our own capture this turn.
    if (netLoss > 0 && netLoss > myLoss && (oppBest.move.affected?.length ?? 0) >= 1) {
      if ((oppBest.move.affected?.length ?? 0) >= 2) {
        insights.push({ tag: 'Allows a multi-jump', detail: 'The opponent can answer with a chained jump, sweeping several pieces — a costly oversight.', tone: 'bad' as const });
      } else {
        insights.push({ tag: 'Hangs a piece', detail: 'This exposes a piece the opponent can jump for free next turn.', tone: 'bad' as const });
      }
      threats.push(`${opp === 0 ? 'Red' : 'Black'} can jump with ${oppBest.move.notation}.`);
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
    : crowned && captures >= 1 ? `${side} jumps into the last rank and crowns a King.`
    : captures >= 2 ? `${side} chains a ${captures}-piece multi-jump.`
    : captures === 1 ? `${side} jumps and wins a piece (${sq(move.from!)}×${sq(move.to)}).`
    : crowned ? `${side} reaches the last rank and crowns a King.`
    : `${side} steps ${sq(move.from!)}–${sq(move.to)}.`;

  return {
    summary,
    band,
    evalBefore: evaluate(before),
    evalAfter: evaluate(after),
    insights,
    principles,
    threats: threats.length ? threats : undefined,
    betterIdea: loss > 60 && res.move && res.move.id !== move.id
      ? `Stronger was ${res.move.notation}${(res.move.affected?.length ?? 0) >= 2 ? ' — a multi-jump' : (res.move.affected?.length ?? 0) === 1 ? ' — a capture' : ''}.`
      : undefined,
  };
}

function hint(s: CheckersState): { move: CheckersMove; text: string } | null {
  const res = searchBestMove(s, searchAdapter(s), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move;
  const mover = s.turn;
  const after = applyMove(s, m);
  const piece = s.squares[m.from!];
  const wasMan = piece ? !piece.king : false;
  const crowned = wasMan && rowOf(m.to) === crownRow(mover);
  const captures = m.affected ? m.affected.length : 0;
  const status = getStatus(after);

  const text =
    status.kind === 'win' && status.winner === mover
      ? `Play ${m.notation} — it leaves the opponent with no reply and wins.`
    : captures >= 2 ? `Play ${m.notation} — a forced ${captures}-piece multi-jump that sweeps the board.`
    : captures === 1 && crowned ? `Play ${m.notation} — jump and crown a King in one move.`
    : crowned ? `Play ${m.notation} to reach the last rank and crown a King.`
    : captures === 1 ? `Play ${m.notation} — captures are mandatory and this jump wins material.`
    : isCentral(m.to) ? `Play ${m.notation} — claim the center to gain mobility.`
    : `${m.notation} is the strongest move here.`;
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<CheckersState, CheckersMove> = {
  id: 'checkers',
  name: 'Checkers',
  tagline: 'Diagonal duel of jumps and kings — simple to learn, sharp to master.',
  blurb: 'Checkers (English draughts) packs a fierce tactical game into one diagonal idea: every jump is mandatory, and a single chained move can sweep several pieces away at once. March your men to the far rank to crown unstoppable Kings, force the captures that suit you, and grind your advantage into a won endgame. Easy to pick up, a lifetime to play well.',
  category: 'Classic',
  depth: 3,
  emoji: '🔴',
  accent: '#ef4444',
  players: [
    { id: 0, name: 'Red', short: 'R', color: '#ef4444' },
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
  deserialize: (str) => JSON.parse(str) as CheckersState,

  tutorial: {
    overview: 'Checkers — known as draughts across much of the world — is the classic diagonal battle fought entirely on the dark squares of an 8×8 board. Behind its friendly look hides a razor-sharp tactical game: because every capture is compulsory, a clever player can steer the opponent into forced jumps, set up devastating multi-captures, and crown Kings that rule the board.',
    objective: 'Capture or trap every one of your opponent\'s pieces. You win the moment your opponent cannot make a legal move — because they have no pieces left, or because every piece they own is blocked.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          {
            title: 'The dark squares only',
            body: 'Play happens solely on the **dark squares** of the 8×8 board. **Red** starts on the three rows nearest you and moves **up** the board; **Black** starts on the three far rows and moves **down**. Red moves first, then players alternate.',
          },
          {
            title: 'Men move diagonally forward',
            body: 'An ordinary piece — a **man** — slides one square diagonally **forward** onto an empty dark square. Men never move straight, sideways, or backward.',
            highlight: [idx(5, 2), idx(4, 1), idx(4, 3)],
          },
          {
            title: 'Capturing by jumping',
            body: 'To capture, **jump** diagonally forward over an enemy piece on an adjacent square, landing on the empty square just beyond. The jumped piece is removed from the board. A man may only jump forward.',
            highlight: [idx(5, 2), idx(4, 3), idx(3, 4)],
          },
          {
            title: 'Captures are mandatory',
            body: 'If you can capture, you **must** — quiet moves are illegal whenever a jump exists. If several different jumps are available, you may choose which one to make, but a jump it must be.',
          },
          {
            title: 'Multi-jumps: keep going',
            body: 'After a jump, if the **same piece** can immediately jump again, it **must** continue, capturing piece after piece in one turn. A double or triple jump can swing the game in a single move — and the whole chain counts as your one move.',
            highlight: [idx(5, 0), idx(4, 1), idx(3, 2), idx(2, 3), idx(1, 4)],
          },
          {
            title: 'Crowning a King',
            body: 'When a man reaches the **far rank** — Red on the top row, Black on the bottom row — it is **crowned a King** (a second piece is stacked on it). The move ends there; a man does not keep jumping after it is crowned.',
            highlight: [idx(0, 1), idx(0, 3), idx(0, 5), idx(0, 7)],
          },
          {
            title: 'Kings move both ways',
            body: 'A **King** is far more powerful: it slides and jumps one square diagonally in **all four** directions — forward *and* backward. A pair of roaming Kings can hunt down lone men with ease.',
            highlight: [idx(4, 3), idx(3, 2), idx(3, 4), idx(5, 2), idx(5, 4)],
          },
          {
            title: 'How you win',
            body: 'You win when your opponent has **no legal move** — either every piece is captured, or all remaining pieces are completely blocked. With careful trading, even a one-piece edge is usually enough.',
          },
        ],
      },
      {
        title: 'Winning Strategy', icon: '🧠',
        steps: [
          {
            title: 'Control the center',
            body: 'Pieces in the **center** influence more squares and are far harder to trap than pieces stranded on the edge. Steer your men toward the middle in the opening and keep them supported.',
            highlight: [idx(4, 3), idx(4, 5), idx(3, 2), idx(3, 4)],
          },
          {
            title: 'Hold your back row',
            body: 'Resist pushing your **back-rank** men too soon. As long as they guard your home squares, the opponent cannot slip a man through to be crowned. Break the back row late, and only with a plan.',
            highlight: [idx(7, 0), idx(7, 2), idx(7, 4), idx(7, 6)],
          },
          {
            title: 'Use the edges defensively',
            body: 'A piece on the **side files** can never be jumped from outside the board, so the edge is a safe haven. It costs some mobility, so use it to shelter pieces and to anchor a defence — not as your whole plan.',
            highlight: [idx(3, 0), idx(4, 7)],
          },
          {
            title: 'Trade when you are ahead',
            body: 'If you are **up material**, exchange pieces at every fair chance. Each swap shrinks the board and magnifies your lead — a one-piece edge with few pieces left is far easier to convert than the same edge in a crowd. When **behind**, do the opposite: avoid trades and keep pieces on to muddy the position.',
          },
          {
            title: 'The power of Kings',
            body: 'A **King**, free to move both ways, is worth nearly two men. Race a man to the last rank to crown one, then use its reach to attack the enemy from behind, defend your own men, and dominate the endgame.',
            highlight: [idx(0, 3)],
          },
          {
            title: 'Force the captures you want',
            body: 'Because jumps are **compulsory**, you can set traps: offer a piece so that the only legal recapture lands the opponent where your next move jumps **two** of theirs. Reading these forced sequences — giving up one to take many — is the heart of strong checkers.',
            highlight: [idx(4, 3), idx(3, 4), idx(2, 5)],
          },
        ],
      },
    ],
  },
};

export default def;
