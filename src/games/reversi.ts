import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Reversi (Othello). Two players take turns placing discs on an 8×8 board.
 * A legal move drops a disc on an empty square so that, in at least one of the
 * eight straight-line directions, an unbroken run of the opponent's discs is
 * "bracketed" between the new disc and another of the mover's discs. Every
 * bracketed disc flips to the mover's colour. If you have no bracketing move
 * you must pass; the game ends when neither side can move, and whoever owns the
 * most discs wins. A minute to learn, a lifetime to master.
 *
 * Passing is modelled with a synthetic move `{ to: -1 }` so the generic driver
 * and the search engine handle it uniformly: applying it merely flips the turn.
 */

export interface ReversiState {
  board: (Player | null)[]; // 64 cells, row-major (row 0 = top)
  turn: Player;
}
interface ReversiMove extends MoveBase {}

const SIZE = 8;
const CELLS = SIZE * SIZE; // 64

const rc = (i: number): [number, number] => [Math.floor(i / SIZE), i % SIZE];
const idx = (r: number, c: number) => r * SIZE + c;
const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

const sideName = (p: Player) => (p === 0 ? 'Black' : 'White');

/** Files a–h (left→right), ranks 1–8 with rank 1 at the BOTTOM (row index 7). */
const FILES = 'abcdefgh';
function squareName(i: number): string {
  const [r, c] = rc(i);
  return `${FILES[c]}${SIZE - r}`;
}

/** The eight ray directions as (dRow, dCol). */
const DIRS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/* ---------------------------- Key squares ----------------------------- */

const CORNERS = [0, 7, 56, 63];
/** For each corner, its diagonally-adjacent inner "X-square" — the worst place
 *  to play while the corner is empty, because it hands the corner away. */
const X_SQUARE_OF: Record<number, number> = {
  0: idx(1, 1),   // 9
  7: idx(1, 6),   // 14
  56: idx(6, 1),  // 49
  63: idx(6, 6),  // 54
};
/** For each corner, the two orthogonally-adjacent edge "C-squares". */
const C_SQUARES_OF: Record<number, number[]> = {
  0: [idx(0, 1), idx(1, 0)],     // b8-row, a7-row → cells 1, 8
  7: [idx(0, 6), idx(1, 7)],     // cells 6, 15
  56: [idx(6, 0), idx(7, 1)],    // cells 48, 57
  63: [idx(6, 7), idx(7, 6)],    // cells 55, 62
};
const X_SQUARES = new Set(Object.values(X_SQUARE_OF));
const C_SQUARES = new Set(Object.values(C_SQUARES_OF).flat());
const CORNER_OF_X: Record<number, number> = Object.fromEntries(
  Object.entries(X_SQUARE_OF).map(([corner, x]) => [x, Number(corner)]),
);
const CORNER_OF_C: Record<number, number> = Object.fromEntries(
  Object.entries(C_SQUARES_OF).flatMap(([corner, cs]) => cs.map((c) => [c, Number(corner)])),
);

/**
 * Classic 8×8 positional weight matrix (player-0 perspective sign is applied at
 * evaluation time; these are absolute square values). Corners are gold, the
 * X- and C-squares around an empty corner are poison, edges are mildly good and
 * the centre is small.
 */
const WEIGHTS: number[] = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

/* --------------------------- Move generation -------------------------- */

/**
 * The discs that placing at `cell` would flip for `player`, scanning all eight
 * directions for a bracketed run of opponent discs ending in a friendly disc.
 * Empty result means the placement is illegal (it flips nothing).
 */
function flipsFor(board: (Player | null)[], cell: number, player: Player): number[] {
  if (board[cell] !== null) return [];
  const opp = (player ^ 1) as Player;
  const [r0, c0] = rc(cell);
  const flips: number[] = [];
  for (const [dr, dc] of DIRS) {
    const line: number[] = [];
    let r = r0 + dr, c = c0 + dc;
    while (inBounds(r, c) && board[idx(r, c)] === opp) {
      line.push(idx(r, c));
      r += dr; c += dc;
    }
    // Bracketed only if the run is non-empty and capped by our own disc.
    if (line.length > 0 && inBounds(r, c) && board[idx(r, c)] === player) {
      for (const f of line) flips.push(f);
    }
  }
  return flips;
}

/** Does `player` have at least one bracketing (legal, non-pass) move? */
function hasMove(board: (Player | null)[], player: Player): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== null) continue;
    if (flipsFor(board, i, player).length > 0) return true;
  }
  return false;
}

/** Build the bracketing moves for the side to move (no pass). */
function bracketingMoves(s: ReversiState): ReversiMove[] {
  const moves: ReversiMove[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (s.board[i] !== null) continue;
    const flips = flipsFor(s.board, i, s.turn);
    if (flips.length === 0) continue;
    moves.push({
      id: `p${i}`,
      to: i,
      notation: `${sideName(s.turn)} ${squareName(i)} (flips ${flips.length})`,
      affected: flips,
      capture: true,
    });
  }
  return moves;
}

const PASS_MOVE: ReversiMove = { id: 'pass', to: -1, notation: '(pass)' };

/**
 * The move list honoured by both the UI and the search engine:
 *   • the side to move has bracketing moves      → return exactly those
 *   • it has none but the opponent does           → return a single PASS move
 *   • neither side can move (game over)           → return []
 */
function legalMoves(s: ReversiState): ReversiMove[] {
  const moves = bracketingMoves(s);
  if (moves.length > 0) return moves;
  const opp = (s.turn ^ 1) as Player;
  if (hasMove(s.board, opp)) return [PASS_MOVE];
  return [];
}

/** Applying any move: a pass (`to === -1`) only flips the turn. */
function apply(s: ReversiState, m: ReversiMove): ReversiState {
  if (m.to === -1) {
    return { board: s.board.slice(), turn: (s.turn ^ 1) as Player };
  }
  const board = s.board.slice();
  board[m.to] = s.turn;
  const flips = m.affected ?? flipsFor(s.board, m.to, s.turn);
  for (const f of flips) board[f] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

/** Neither side can place a bracketing disc → the game is over. */
function isTerminal(s: ReversiState): boolean {
  return !hasMove(s.board, 0) && !hasMove(s.board, 1);
}

function discCount(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const v of board) if (v === player) n++;
  return n;
}

/* ----------------------------- Evaluation ----------------------------- */

/**
 * Weighted positional evaluation from player 0 (Black)'s perspective.
 * Combines a positional (square-weight) term, a mobility term that matters most
 * in the midgame, a disc-difference term that matters most near the end, and a
 * stability boost for corners already owned. Finished positions return a large
 * ±value scaled by the final disc margin. Positive favours Black.
 */
function evaluate(s: ReversiState): number {
  const b = s.board;
  const black = discCount(b, 0);
  const white = discCount(b, 1);
  const empties = CELLS - black - white;

  // Terminal: decide by disc margin, dominating any heuristic.
  if (isTerminal(s)) {
    if (black > white) return WIN + (black - white);
    if (white > black) return -WIN - (white - black);
    return 0; // tie
  }

  // Positional term: sum square weights for each owned cell.
  let positional = 0;
  for (let i = 0; i < CELLS; i++) {
    if (b[i] === 0) positional += WEIGHTS[i];
    else if (b[i] === 1) positional -= WEIGHTS[i];
  }

  // Mobility term: difference in number of bracketing moves available.
  const blackMob = countMoves(b, 0);
  const whiteMob = countMoves(b, 1);
  let mobility = 0;
  if (blackMob + whiteMob > 0) {
    mobility = (100 * (blackMob - whiteMob)) / (blackMob + whiteMob);
  }

  // Disc difference, as a normalised percentage.
  let discDiff = 0;
  if (black + white > 0) {
    discDiff = (100 * (black - white)) / (black + white);
  }

  // Corner stability: owning a corner is permanent — reward it heavily.
  let stability = 0;
  for (const corner of CORNERS) {
    if (b[corner] === 0) stability += 30;
    else if (b[corner] === 1) stability -= 30;
  }

  // Phase weighting: mobility rules the midgame, disc count the endgame.
  const endgame = empties <= 12;
  const mobilityWeight = endgame ? 30 : 78;
  const discWeight = endgame ? 26 : 6;

  return positional + stability + mobilityWeight * (mobility / 100) * 64 + discWeight * (discDiff / 100) * 64;
}

/** Number of bracketing moves `player` has from this board. */
function countMoves(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== null) continue;
    if (flipsFor(board, i, player).length > 0) n++;
  }
  return n;
}

/* ------------------------------ Search -------------------------------- */

function searchAdapter() {
  return {
    // The search must see the synthetic pass so it can navigate forced passes.
    getLegalMoves: (s: ReversiState): ReversiMove[] => legalMoves(s),
    applyMove: apply,
    getTurn: (s: ReversiState) => s.turn,
    isTerminal,
    evaluate,
    // Order corners first and X/C-squares last to sharpen alpha-beta pruning.
    order: (_s: ReversiState, m: ReversiMove): number => {
      if (m.to === -1) return -1000;
      if (CORNERS.includes(m.to)) return 1000;
      if (X_SQUARES.has(m.to)) return -200;
      if (C_SQUARES.has(m.to)) return -100;
      return WEIGHTS[m.to];
    },
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 6, easy: 1, medium: 3, hard: 5, master: 6 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.8, medium: 0.4, hard: 0.08, master: 0 };

/* -------------------------- Tutor helpers ----------------------------- */

/** Is the corner that this X/C-square betrays still empty? */
function bordersEmptyCorner(board: (Player | null)[], cell: number): { corner: number; empty: boolean } | null {
  if (cell in CORNER_OF_X) {
    const corner = CORNER_OF_X[cell];
    return { corner, empty: board[corner] === null };
  }
  if (cell in CORNER_OF_C) {
    const corner = CORNER_OF_C[cell];
    return { corner, empty: board[corner] === null };
  }
  return null;
}

/* --------------------------- Definition ------------------------------- */

const def: GameDefinition<ReversiState, ReversiMove> = {
  id: 'reversi',
  name: 'Reversi',
  tagline: 'Flank, flip, and outflank — Othello\'s minute to learn, lifetime to master.',
  blurb: 'Reversi (better known as Othello) is the classic battle of the discs: drop a piece to bracket your opponent\'s line and watch the whole row flip to your colour. A minute to learn and a lifetime to master, it hides a deep game beneath its simple rule — the player with the most discs when the board fills wins, but greedily grabbing discs early is the surest road to defeat. Seize the corners, starve your opponent of moves, and turn the board your colour.',
  category: 'Strategy',
  depth: 3,
  emoji: '⚪',
  accent: '#10b981',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#0f172a' },
    { id: 1, name: 'White', short: 'W', color: '#f8fafc' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'disc', showCoordinates: true, checkered: false },

  createInitialState: () => {
    const board: (Player | null)[] = Array(CELLS).fill(null);
    board[idx(3, 3)] = 1; // d5 white
    board[idx(3, 4)] = 0; // e5 black
    board[idx(4, 3)] = 0; // d4 black
    board[idx(4, 4)] = 1; // e4 white
    return { board, turn: 0 };
  },
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / SIZE), col: i % SIZE,
      piece: p === null ? null : { id: `c${i}`, kind: 'disc', player: p, glyph: p === 0 ? '⚫' : '⚪' },
    }));
    const fileLabels = FILES.split('');
    // Rank 1 at the bottom → labels top-to-bottom are 8,7,…,1.
    const rankLabels = Array.from({ length: SIZE }, (_, i) => String(SIZE - i));
    return { rows: SIZE, cols: SIZE, cells, fileLabels, rankLabels };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (isTerminal(s)) {
      const black = discCount(s.board, 0);
      const white = discCount(s.board, 1);
      if (black === white) {
        return { kind: 'draw', reason: `the board is settled ${black}–${white}` };
      }
      const winner: Player = black > white ? 0 : 1;
      const hi = Math.max(black, white);
      const lo = Math.min(black, white);
      return { kind: 'win', winner, reason: `${sideName(winner)} controls more discs, ${hi}–${lo}` };
    }
    return { kind: 'playing' };
  },

  // Honour the pass contract: bracketing moves, else a single pass, else [].
  getLegalMoves: (s, _from) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    if (isTerminal(s)) return null;
    const placed = discCount(s.board, 0) + discCount(s.board, 1);
    const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
      randomness: RAND[difficulty],
      rng: mulberry32((placed + 1) * 2654435761),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opp = (mover ^ 1) as Player;
    const side = sideName(mover);
    const adapter = searchAdapter();

    // Grade by comparing the played move against the best move (deep, exact).
    const placed = discCount(before.board, 0) + discCount(before.board, 1);
    const res = searchBestMove(before, adapter, DEPTH.hard, {
      rng: mulberry32((placed + 1) * 2654435761),
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
    const flips = move.affected ?? [];
    const empties = CELLS - placed - (isPass ? 0 : 1);
    const earlyGame = placed < 20;
    const endgame = empties <= 12;

    // Mobility before and after, from the mover's perspective.
    const myMobBefore = countMoves(before.board, mover);
    const oppMobAfter = countMoves(after.board, opp);
    const oppMobBefore = countMoves(before.board, opp);

    // Final disc tally if this ends the game.
    const blackAfter = discCount(after.board, 0);
    const whiteAfter = discCount(after.board, 1);
    const myAfter = mover === 0 ? blackAfter : whiteAfter;
    const oppAfter = mover === 0 ? whiteAfter : blackAfter;
    const gameOver = isTerminal(after);

    let tookCorner = false;
    let badCorner: { corner: number } | null = null;

    if (isPass) {
      insights.push({ tag: 'Forced pass', detail: `${side} has no legal move — every empty square would flip nothing — so the turn passes back to ${sideName(opp)}.`, tone: 'info' });
      principles.push('You must flip at least one disc; with no bracketing move available, you are forced to pass.');
    } else {
      // Corner capture — permanent and powerful.
      if (CORNERS.includes(move.to)) {
        tookCorner = true;
        insights.push({ tag: 'Takes a corner!', detail: `${squareName(move.to)} is a corner — it can never be flanked or flipped, so this disc is permanent and anchors stable discs along both edges.`, tone: 'good' });
        principles.push('Corners are the most valuable squares on the board — they can never be flipped.');
        threats.push('The corner anchors stable discs that the opponent can no longer take back.');
      }

      // X-square / C-square next to an EMPTY corner — usually hands it over.
      const border = bordersEmptyCorner(before.board, move.to);
      if (!tookCorner && border && border.empty) {
        badCorner = { corner: border.corner };
        if (X_SQUARES.has(move.to)) {
          insights.push({ tag: 'X-square danger', detail: `${squareName(move.to)} sits diagonally next to the empty ${squareName(border.corner)} corner. Playing here typically lets the opponent grab that corner — the single worst trade in Othello.`, tone: 'bad' });
          principles.push('Avoid the X-squares (diagonal to an empty corner): they usually give the corner away.');
        } else {
          insights.push({ tag: 'C-square risk', detail: `${squareName(move.to)} is a C-square beside the empty ${squareName(border.corner)} corner — it often exposes the corner to the opponent.`, tone: 'bad' });
          principles.push('Be wary of C-squares next to empty corners — they can hand over the corner.');
        }
        threats.push(`${sideName(opp)} may be able to seize the ${squareName(border.corner)} corner.`);
      }

      // Greedy early flipping reduces your own mobility.
      if (!tookCorner && earlyGame && flips.length >= 4) {
        insights.push({ tag: 'Greedy flip', detail: `Flipping ${flips.length} discs this early feels good but usually backfires — owning more discs now tends to shrink your own mobility and hands the opponent more options. In the opening, fewer discs is better.`, tone: 'bad' });
        principles.push('Do not grab discs greedily early — mobility matters far more than the disc count in the midgame.');
      } else if (!tookCorner && flips.length === 1 && earlyGame) {
        insights.push({ tag: 'Quiet move', detail: 'Flips just one disc — keeping your footprint small early preserves your mobility and options.', tone: 'good' });
        principles.push('Small, quiet moves early keep your mobility high.');
      }

      // Mobility swing: did the move strangle the opponent's options?
      if (!gameOver) {
        if (oppMobAfter === 0) {
          insights.push({ tag: 'Forces a pass', detail: `${sideName(opp)} now has no legal move and must pass — you get to move again.`, tone: 'good' });
          principles.push('Restricting the opponent until they must pass wins you free tempo.');
          threats.push(`${sideName(opp)} is out of moves and must pass.`);
        } else if (oppMobAfter < oppMobBefore && oppMobBefore - oppMobAfter >= 2 && !badCorner) {
          insights.push({ tag: 'Limits mobility', detail: `Cuts the opponent's available moves from ${oppMobBefore} to ${oppMobAfter}, squeezing their options.`, tone: 'good' });
          principles.push('Aim to reduce the opponent\'s mobility — it forces them into bad squares.');
        }
      }

      // Endgame disc counting.
      if (endgame && !gameOver) {
        insights.push({ tag: 'Endgame count', detail: `With few squares left, the disc count now matters: ${side} holds ${myAfter} to ${oppAfter}. From here, count carefully — parity and stable discs decide it.`, tone: 'info' });
        principles.push('In the endgame, count discs and stable squares — that is what finally wins.');
      }
    }

    if (gameOver) {
      if (myAfter > oppAfter) {
        insights.push({ tag: 'Game won', detail: `Neither side can move — the board is settled and ${side} wins ${myAfter}–${oppAfter}.`, tone: 'good' });
      } else if (myAfter < oppAfter) {
        insights.push({ tag: 'Game lost', detail: `The board is settled ${oppAfter}–${myAfter} for ${sideName(opp)}.`, tone: 'bad' });
      } else {
        insights.push({ tag: 'Drawn', detail: `The board is settled and the disc count is tied ${myAfter}–${oppAfter}.`, tone: 'info' });
      }
    }

    const winningBig = Math.abs(moverPlayed) > WIN / 2;
    let band: MoveExplanation['band'] = isPass ? 'book' : gradeByLoss(loss, winningBig);
    // Reward a genuinely strong corner grab; punish gifting a corner.
    if (!isPass && tookCorner && loss <= 20) band = 'great';
    if (!isPass && badCorner && loss > 120) band = loss > 320 ? 'blunder' : 'mistake';

    if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
      insights.push({ tag: 'Concedes ground', detail: 'A stronger move was available; this one gives the opponent the better position.', tone: 'bad' });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Solid move', detail: 'A reasonable placement that keeps the position balanced.', tone: 'info' });
    }

    const summary =
      isPass ? `${side} has no legal move and must pass.`
      : tookCorner ? `${side} plays ${squareName(move.to)} and claims a permanent corner.`
      : gameOver ? `${side} plays ${squareName(move.to)}; the board is settled ${myAfter}–${oppAfter}.`
      : badCorner ? `${side} plays ${squareName(move.to)}, exposing the ${squareName(badCorner.corner)} corner.`
      : `${side} plays ${squareName(move.to)} and flips ${flips.length} disc${flips.length === 1 ? '' : 's'}.`;

    return {
      summary, band,
      evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles,
      threats: threats.length ? threats : undefined,
      betterIdea: !isPass && loss > 120 && res.move && res.move.to !== move.to && res.move.to !== -1
        ? `Stronger was ${squareName(res.move.to)} — ${CORNERS.includes(res.move.to) ? 'it grabs a corner' : 'it keeps more mobility and a safer shape'}.`
        : undefined,
    };
  },

  hint(s) {
    if (isTerminal(s)) return null;
    const placed = discCount(s.board, 0) + discCount(s.board, 1);
    const res = searchBestMove(s, searchAdapter(), DEPTH.hard, {
      rng: mulberry32((placed + 1) * 2654435761),
    });
    if (!res.move) return null;

    if (res.move.to === -1) {
      return { move: res.move, text: 'You have no legal move here — you must pass and let the opponent play.' };
    }

    const mover = s.turn;
    const opp = (mover ^ 1) as Player;
    const after = apply(s, res.move);
    const oppMobAfter = countMoves(after.board, opp);
    const border = bordersEmptyCorner(s.board, res.move.to);

    let text: string;
    if (CORNERS.includes(res.move.to)) {
      text = `Play ${squareName(res.move.to)} — take the corner, it can never be flipped.`;
    } else if (oppMobAfter === 0) {
      text = `Play ${squareName(res.move.to)} — it leaves the opponent with no move, forcing them to pass.`;
    } else if (border && border.empty) {
      // The search picked a risky square only if it is genuinely best; explain plainly.
      text = `Play ${squareName(res.move.to)} — best here, though normally you avoid squares next to an empty corner.`;
    } else {
      text = `Play ${squareName(res.move.to)} — it keeps your mobility high and steers toward the corners.`;
    }
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Reversi — sold the world over as Othello — is the great game of the flipping disc. Every piece is black on one side and white on the other, and a single move can sweep an entire row from one colour to the other. Its one rule takes a minute to learn, yet the play is a deep, surprising battle of position where grabbing too much too soon is the classic beginner\'s trap.',
    objective: 'Own more discs than your opponent when the board fills up (or when neither side can move). You capture discs by flanking them — bracketing a line of the opponent\'s discs between two of your own.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          {
            title: 'The board and start',
            body: 'Play on an **8×8** board. It begins with four discs in the centre, set diagonally: two **White** on one diagonal, two **Black** on the other. **Black** always moves first.',
            highlight: [idx(3, 3), idx(3, 4), idx(4, 3), idx(4, 4)],
          },
          {
            title: 'Flanking and flipping',
            body: 'On your turn, place a disc on an empty square so that it **brackets** one or more of the opponent\'s discs in a straight line — horizontal, vertical, or diagonal — with another of *your* discs at the far end. Every bracketed disc **flips** to your colour. You may flip discs in several directions at once.',
          },
          {
            title: 'You must capture',
            body: 'A move is only legal if it flips **at least one** disc. You cannot place a disc that captures nothing. If — and only if — you have no capturing move anywhere, you **pass** and your opponent moves again.',
          },
          {
            title: 'The game ends',
            body: 'Play continues until **neither** side can make a capturing move — usually when all 64 squares are full, but sometimes sooner. At that point the game is over.',
          },
          {
            title: 'Most discs wins',
            body: 'Count the discs. Whoever shows **more of their colour** wins; an equal split is a draw. Because the final move can flip a whole edge, the lead can swing wildly right to the end — never resign early.',
          },
        ],
      },
      {
        title: 'Winning Strategy', icon: '🧠',
        steps: [
          {
            title: 'Corners are king',
            body: 'A disc in a **corner** can never be flanked, so it can **never be flipped** — it is yours for the whole game, and it anchors stable discs all along both edges. Winning the corners is the single most important goal in Othello.',
            highlight: CORNERS,
          },
          {
            title: 'Beware the X-squares',
            body: 'The squares **diagonally next to a corner** (the "X-squares") are the most dangerous on the board while that corner is empty. Playing one almost always lets your opponent drop into the corner you just opened up. Stay off them until the neighbouring corner is settled.',
            highlight: [idx(1, 1), idx(1, 6), idx(6, 1), idx(6, 6)],
          },
          {
            title: 'Mobility over greed',
            body: 'The deepest idea in Reversi: **do not grab discs greedily early**. The player with *more* discs in the opening usually has *fewer* moves and is being slowly squeezed. Aim instead to keep your own choices open while starving your opponent of safe moves — force *them* onto the X-squares and edges.',
          },
          {
            title: 'Edges and stability',
            body: 'Beyond corners, **stable discs** — ones that can never be flipped because they are backed by your own pieces all the way to an edge or corner — are what truly count. Build solid edges anchored to corners you control, and avoid loose discs the opponent can flank.',
          },
          {
            title: 'Count in the endgame',
            body: 'When only a handful of squares remain, the game turns concrete: **count the discs**, watch the **parity** of empty regions (who is forced to play last where), and play the move that leaves *you* the final, board-flipping placement. Many games are won or lost on the very last disc.',
          },
        ],
      },
    ],
  },
};

export default def;
