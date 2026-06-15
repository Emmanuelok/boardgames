import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Hex — the classic connection game invented independently by Piet Hein (1942)
 * and John Nash (1948). Played on an 11×11 rhombus of hexagonal cells. Red
 * (player 0) owns the TOP and BOTTOM edges and tries to link them with an
 * unbroken chain of red stones; Blue (player 1) owns the LEFT and RIGHT edges
 * and tries to link those. Players alternate placing one stone per turn on any
 * empty cell; stones never move. Red plays first.
 *
 * A beautiful property of Hex: the game can NEVER end in a draw. When the board
 * fills, exactly one player has connected their two sides — so somebody always
 * wins. This is equivalent to the two-dimensional Brouwer fixed-point theorem.
 *
 * Two move generators live here, mirroring Gomoku. The public `getLegalMoves`
 * returns *every* empty cell so the human may play anywhere. The AI search
 * adapter, faced with a 121-wide branching factor, restricts itself to a
 * candidate set — empty cells adjacent to existing stones, the centre, and
 * "bridge" completion cells — ordered by a cheap local value so alpha-beta
 * prunes hard.
 */

export interface HexState {
  board: (Player | null)[]; // 121 cells, row-major (11×11), row 0 = TOP edge
  turn: Player;
}
interface HexMove extends MoveBase {}

const SIZE = 11;
const CELLS = SIZE * SIZE; // 121
const CENTER = 60; // (5,5)

/** Files A–K (no I-skipping — a continuous A..K covers the 11 columns). */
const COLS = 'ABCDEFGHIJK';
const rc = (i: number): [number, number] => [Math.floor(i / SIZE), i % SIZE];
const idx = (r: number, c: number) => r * SIZE + c;
const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

const sideName = (p: Player) => (p === 0 ? 'Red' : 'Blue');

/**
 * Human cell name, e.g. centre cell (row 5, col 5) -> "F6". Files A–K run with
 * the columns; ranks 1–11 run from the BOTTOM, so the TOP row (index 0) is rank
 * 11 and the BOTTOM row (index 10) is rank 1.
 */
function cellName(i: number): string {
  const [r, c] = rc(i);
  return `${COLS[c]}${SIZE - r}`;
}

/**
 * The six hex neighbours of a cell on this rhombic board. On the standard Hex
 * parallelogram, (r,c) touches (r,c-1),(r,c+1),(r-1,c),(r+1,c),(r-1,c+1) and
 * (r+1,c-1) — the two "acute" diagonals that give each interior cell exactly
 * six neighbours.
 */
const HEX_DIRS: Array<[number, number]> = [
  [0, -1], [0, 1],
  [-1, 0], [1, 0],
  [-1, 1], [1, -1],
];

/** Push the in-bounds hex neighbours of cell `i` into `out` (reused buffer). */
function neighbours(i: number, out: number[]): number[] {
  out.length = 0;
  const [r, c] = rc(i);
  for (const [dr, dc] of HEX_DIRS) {
    const r2 = r + dr, c2 = c + dc;
    if (inBounds(r2, c2)) out.push(idx(r2, c2));
  }
  return out;
}

/* ------------------------------ Win check ----------------------------- */

/**
 * Has `player` connected their two edges? Flood-fill over hex adjacency from
 * the player's "first" edge; a win means we reach the "second" edge.
 *  - Red (0): from row 0 (TOP) reaching row 10 (BOTTOM).
 *  - Blue (1): from col 0 (LEFT) reaching col 10 (RIGHT).
 */
function connected(board: (Player | null)[], player: Player): boolean {
  const seen = new Uint8Array(CELLS);
  const stack: number[] = [];
  // Seed the flood from every owned stone sitting on the player's start edge.
  for (let k = 0; k < SIZE; k++) {
    const start = player === 0 ? idx(0, k) : idx(k, 0);
    if (board[start] === player && !seen[start]) {
      seen[start] = 1;
      stack.push(start);
    }
  }
  const nbuf: number[] = [];
  while (stack.length) {
    const cur = stack.pop()!;
    const [r, c] = rc(cur);
    // Reached the far edge?
    if (player === 0 ? r === SIZE - 1 : c === SIZE - 1) return true;
    for (const nb of neighbours(cur, nbuf)) {
      if (!seen[nb] && board[nb] === player) {
        seen[nb] = 1;
        stack.push(nb);
      }
    }
  }
  return false;
}

/** The winner of the whole position, or null if nobody has connected yet. */
function winnerOf(s: HexState): Player | null {
  if (connected(s.board, 0)) return 0;
  if (connected(s.board, 1)) return 1;
  return null;
}

/* ------------------- Connection-distance heuristic -------------------- */

/**
 * Shortest "completion distance" for `player` to join their two edges, via a
 * 0-1 BFS (Dijkstra with weights {0,1}) over hex adjacency. Traversing one of
 * your own stones costs 0; an empty cell costs 1; an opponent stone is
 * impassable. The distance is the minimum number of NEW stones you would need
 * to place to finish the connection. 0 means already connected; a large
 * sentinel means impossible (the opponent has walled you off).
 *
 * We model the two edges as virtual super-sources/sinks: every cell on the
 * start edge is seeded with cost equal to (0 if owned else 1), and we stop when
 * we first settle any cell on the far edge, adding its own entry cost.
 */
const UNREACH = 1 << 20;

function completionDistance(board: (Player | null)[], player: Player): number {
  const opp = (player ^ 1) as Player;
  const dist = new Int32Array(CELLS).fill(UNREACH);
  // A double-ended queue emulated with two stacks for 0-1 BFS.
  const dq: number[] = []; // we use unshift/push sparingly; size is small (≤121)
  // Seed every start-edge cell that isn't blocked by the opponent.
  for (let k = 0; k < SIZE; k++) {
    const cell = player === 0 ? idx(0, k) : idx(k, 0);
    if (board[cell] === opp) continue;
    const cost = board[cell] === player ? 0 : 1;
    if (cost < dist[cell]) {
      dist[cell] = cost;
      if (cost === 0) dq.unshift(cell);
      else dq.push(cell);
    }
  }
  const nbuf: number[] = [];
  let best = UNREACH;
  while (dq.length) {
    const cur = dq.shift()!;
    const d = dist[cur];
    const [r, c] = rc(cur);
    const onFar = player === 0 ? r === SIZE - 1 : c === SIZE - 1;
    if (onFar) { best = Math.min(best, d); continue; }
    for (const nb of neighbours(cur, nbuf)) {
      if (board[nb] === opp) continue;
      const step = board[nb] === player ? 0 : 1;
      const nd = d + step;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        if (step === 0) dq.unshift(nb);
        else dq.push(nb);
      }
    }
  }
  return best;
}

/**
 * Static evaluation from Red's (player 0) perspective. A completed connection
 * returns ±WIN (discounted by stones on board so a sooner win outscores a later
 * one, exactly as Gomoku does). Otherwise score by the difference in completion
 * distance: the side that needs fewer new stones is ahead. Positive favours Red.
 */
function evaluate(s: HexState): number {
  const w = winnerOf(s);
  if (w !== null) {
    let stones = 0;
    for (let i = 0; i < CELLS; i++) if (s.board[i] !== null) stones++;
    return w === 0 ? WIN - stones : -WIN + stones;
  }
  const dRed = completionDistance(s.board, 0);
  const dBlue = completionDistance(s.board, 1);
  // Both finite here (a side is only UNREACH if walled off, which on a legal
  // unfinished Hex position cannot happen for both — but guard anyway).
  const red = dRed >= UNREACH ? SIZE * SIZE : dRed;
  const blue = dBlue >= UNREACH ? SIZE * SIZE : dBlue;
  // Scale so a one-stone distance edge is worth a meaningful amount, while a
  // small mover-tempo term rewards being the side to move when distances tie.
  return (blue - red) * 90;
}

/* ----------------------- AI candidate generation ---------------------- */

/** The two "bridge" partner cells reached by a knight-like hex bridge from `i`.
 *  A bridge is a pair of empty cells sharing two common empty neighbours, giving
 *  a virtual connection the opponent cannot sever in one move. We add bridge
 *  endpoints as candidates so the search finds these efficient links. */
const BRIDGE_DIRS: Array<[number, number]> = [
  [-2, 1], [-1, 2], [1, 1], [2, -1], [1, -2], [-1, -1],
];

/** Empty cells worth searching: those adjacent to a stone, bridge endpoints of
 *  existing stones, and the centre. On an empty board, just the centre. */
function candidates(board: (Player | null)[]): number[] {
  const mark = new Uint8Array(CELLS);
  let any = false;
  const nbuf: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === null) continue;
    any = true;
    const [r, c] = rc(i);
    for (const nb of neighbours(i, nbuf)) {
      if (board[nb] === null) mark[nb] = 1;
    }
    for (const [dr, dc] of BRIDGE_DIRS) {
      const r2 = r + dr, c2 = c + dc;
      if (inBounds(r2, c2)) {
        const j = idx(r2, c2);
        if (board[j] === null) mark[j] = 1;
      }
    }
  }
  if (!any) return [CENTER];
  if (board[CENTER] === null) mark[CENTER] = 1;
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (mark[i]) out.push(i);
  return out.length ? out : emptyCells(board);
}

function emptyCells(board: (Player | null)[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === null) out.push(i);
  return out;
}

function makeMove(s: HexState, i: number): HexMove {
  // Placement: `from` is intentionally OMITTED (undefined) for a place game.
  return { id: `p${i}`, to: i, notation: `${sideName(s.turn)} ${cellName(i)}` };
}

/* ------------------------------ Apply --------------------------------- */

function apply(s: HexState, m: HexMove): HexState {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

const isFull = (board: (Player | null)[]) => board.every((c) => c !== null);

/* ---------------------- Move ordering / local value ------------------- */

/**
 * A cheap value for placing the side-to-move's stone at cell `i`: how much it
 * shortens our own completion distance, how much it lengthens the opponent's
 * (a block), plus a small pull toward the centre. Used to order candidates so
 * alpha-beta prunes, and reused by the tutor to pick "the strongest" cell.
 */
function moveValue(s: HexState, i: number): number {
  const me = s.turn;
  const opp = (me ^ 1) as Player;
  const board = s.board;

  const myBefore = completionDistance(board, me);
  const oppBefore = completionDistance(board, opp);
  board[i] = me;
  const myAfter = completionDistance(board, me);
  const oppAfter = completionDistance(board, opp);
  board[i] = null;

  const advance = (myBefore - myAfter); // how many stones closer we got
  const block = (oppAfter - oppBefore);  // how much we set the opponent back

  let sc = advance * 100 + block * 80;
  // Centre influence: cells near the middle touch more of the board.
  const [r, c] = rc(i);
  const mid = (SIZE - 1) / 2;
  sc += 20 - (Math.abs(r - mid) + Math.abs(c - mid));
  return sc;
}

/* ------------------------------ Search -------------------------------- */

function searchAdapter() {
  return {
    getLegalMoves: (s: HexState): HexMove[] => {
      if (winnerOf(s) !== null) return [];
      return candidates(s.board).map((i) => makeMove(s, i));
    },
    applyMove: apply,
    getTurn: (s: HexState) => s.turn,
    isTerminal: (s: HexState) => winnerOf(s) !== null || isFull(s.board),
    evaluate,
    order: (s: HexState, m: HexMove): number => moveValue(s, m.to),
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 2, easy: 1, medium: 1, hard: 2, master: 2 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.8, medium: 0.45, hard: 0.1, master: 0 };

const seedFor = (stones: number) => (stones + 1) * 2654435761;

/* --------------------------- Tutor helpers ---------------------------- */

/** Does placing `me`'s stone at `i` complete the win? */
function isWinningMove(board: (Player | null)[], i: number, me: Player): boolean {
  const probe = board.slice();
  probe[i] = me;
  return connected(probe, me);
}

/** A genuine bridge from cell `i` for `player`: a stone (or edge) two cells away
 *  along a bridge direction, where the two shared carrier cells are both empty.
 *  Returns the partner cell index if a friendly bridge is formed, else -1. */
function bridgePartner(board: (Player | null)[], i: number, player: Player): number {
  const [r, c] = rc(i);
  const nbuf: number[] = [];
  const myN = new Set(neighbours(i, nbuf));
  for (const [dr, dc] of BRIDGE_DIRS) {
    const r2 = r + dr, c2 = c + dc;
    if (!inBounds(r2, c2)) continue;
    const j = idx(r2, c2);
    if (board[j] !== player) continue;
    // The two carriers are the cells adjacent to BOTH i and j.
    const jbuf: number[] = [];
    let carriers = 0, free = 0;
    for (const nb of neighbours(j, jbuf)) {
      if (myN.has(nb)) {
        carriers++;
        if (board[nb] === null) free++;
      }
    }
    if (carriers >= 2 && free >= 2) return j;
  }
  return -1;
}

/** Whether cell `i` sits on `player`'s own edge (helps "extend toward edge"). */
function onOwnEdge(i: number, player: Player): boolean {
  const [r, c] = rc(i);
  return player === 0 ? (r === 0 || r === SIZE - 1) : (c === 0 || c === SIZE - 1);
}

/* --------------------------- Definition ------------------------------- */

const def: GameDefinition<HexState, HexMove> = {
  id: 'hex',
  name: 'Hex',
  tagline: 'Bridge your two sides across an 11×11 hex rhombus — and Hex can never be drawn.',
  blurb: 'Hex is the purest connection game, discovered twice — by Piet Hein and by John Nash. Place one stone per turn and race to link your two edges with an unbroken chain across a field of hexagons. The rules take a sentence, yet the strategy runs deep: the elegant "bridge" gives you a connection your opponent cannot cut, every move is at once an attack and a block, and a dead-simple topological truth guarantees there are no draws — when the board is full, exactly one player has won.',
  category: 'Abstract',
  depth: 4,
  emoji: '⬡',
  accent: '#ef4444',
  players: [
    { id: 0, name: 'Red', short: 'R', color: '#ef4444' },
    { id: 1, name: 'Blue', short: 'B', color: '#3b82f6' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'stone', showCoordinates: true, checkered: false, intersections: false },

  createInitialState: () => ({ board: Array(CELLS).fill(null), turn: 0 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / SIZE), col: i % SIZE,
      piece: p === null ? null : { id: `c${i}`, kind: 'stone', player: p, glyph: p === 0 ? '⬢' : '⬢' },
    }));
    const fileLabels = COLS.split('');
    // Ranks shown 11 (top) down to 1 (bottom), matching cellName.
    const rankLabels = Array.from({ length: SIZE }, (_, r) => String(SIZE - r));
    return { rows: SIZE, cols: SIZE, cells, fileLabels, rankLabels };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s);
    if (w !== null) {
      const reason = w === 0 ? 'Red connected top to bottom' : 'Blue connected left to right';
      return { kind: 'win', winner: w, reason };
    }
    // Hex can never draw; while cells remain it is simply still playing.
    return { kind: 'playing' };
  },

  // Public move list: the human may place on ANY empty cell.
  getLegalMoves(s, _from): HexMove[] {
    if (winnerOf(s) !== null) return [];
    const moves: HexMove[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (s.board[i] === null) moves.push(makeMove(s, i));
    }
    return moves;
  },

  applyMove: apply,

  chooseMove(s, difficulty) {
    if (winnerOf(s) !== null) return null;
    const stones = s.board.filter((c) => c !== null).length;
    if (stones === 0) return makeMove(s, CENTER); // open in the centre
    const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
      randomness: RAND[difficulty],
      rng: mulberry32(seedFor(stones)),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opp = (mover ^ 1) as Player;
    const adapter = searchAdapter();
    const stones = before.board.filter((c) => c !== null).length;

    // Rank candidate moves so we can grade the played move against the best,
    // finding the played move in `res.ranked` by id (as Gomoku does).
    const res = searchBestMove(before, adapter, 2, {
      rng: mulberry32(seedFor(stones)),
    });
    const playedEntry = res.ranked.find((r) => r.move.id === move.id);
    const playedEval = playedEntry ? playedEntry.score : evaluate(after);
    const bestEval = res.ranked[0]?.score ?? playedEval;
    const moverPlayed = mover === 0 ? playedEval : -playedEval;
    const moverBest = mover === 0 ? bestEval : -bestEval;
    const loss = Math.max(0, moverBest - moverPlayed);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const threats: string[] = [];

    const won = winnerOf(after) === mover;

    // Distances before/after for both sides give the tutor real Hex insight.
    const myBefore = completionDistance(before.board, mover);
    const myAfter = completionDistance(after.board, mover);
    const oppBefore = completionDistance(before.board, opp);
    const oppAfter = completionDistance(after.board, opp);
    const advanced = myBefore - myAfter;     // shortened my own connection
    const blocked = oppAfter - oppBefore;    // lengthened opponent's path
    const partner = bridgePartner(before.board, move.to, mover);
    const tookCentre = stones === 0 && move.to === CENTER;
    const myEdge = onOwnEdge(move.to, mover);

    if (won) {
      insights.push({
        tag: 'Winning connection',
        detail: `Completes an unbroken chain ${mover === 0 ? 'from the top edge to the bottom' : 'from the left edge to the right'} — game over.`,
        tone: 'good',
      });
    }
    if (tookCentre) {
      insights.push({ tag: 'Centre opening', detail: 'The middle cell (F6) touches the most lines and radiates influence toward every edge — the standard strong first move.', tone: 'good' });
      principles.push('Open near the centre — central stones project toward both of your edges at once.');
    }
    if (!won && partner >= 0) {
      insights.push({ tag: 'Bridge', detail: `Forms a bridge with ${cellName(partner)}: two empty carrier cells link the pair, so the connection is safe — if the opponent plays one carrier you simply take the other.`, tone: 'good' });
      principles.push('Use bridges: a bridged pair is a virtual connection your opponent cannot cut in a single move.');
      threats.push(`The bridge to ${cellName(partner)} secures that link without needing to play it yet.`);
    }
    if (!won && advanced >= 1) {
      insights.push({ tag: 'Extends connection', detail: `Brings your chain ${advanced} cell${advanced === 1 ? '' : 's'} closer to joining your two edges (completion distance ${myBefore} → ${myAfter}).`, tone: 'good' });
      principles.push('Every stone should shorten the distance between your two sides.');
      if (myAfter <= 2) threats.push(`Only ${myAfter} more cell${myAfter === 1 ? '' : 's'} would finish the connection.`);
    }
    if (!won && myEdge && advanced >= 1) {
      insights.push({ tag: 'Anchors an edge', detail: 'Touches your own border, anchoring the chain to one of the two sides you must reach.', tone: 'info' });
    }
    if (!won && blocked >= 1) {
      insights.push({ tag: 'Blocks the opponent', detail: `Sits on the opponent's shortest path, lengthening their completion distance ${oppBefore} → ${oppAfter}. In Hex every block also builds your own wall.`, tone: 'good' });
      principles.push("Blocking and connecting are the same act — a stone that bars the opponent's route advances yours.");
    }

    const winningBig = Math.abs(moverPlayed) > 1000;
    let band: MoveExplanation['band'] = won ? 'best' : gradeByLoss(loss, winningBig);
    // A safe bridge that also makes real progress is a particularly elegant find.
    if (!won && partner >= 0 && advanced >= 1 && loss <= 20) band = 'great';

    if (band === 'blunder' || band === 'mistake') {
      insights.push({ tag: 'Loses ground', detail: 'A stronger cell would have advanced your connection or cut the opponent more sharply; this lets them gain tempo.', tone: 'bad' });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Develops', detail: 'A reasonable placement that keeps your options open across the board.', tone: 'info' });
    }

    const summary =
      won ? `${sideName(mover)} links ${mover === 0 ? 'top and bottom' : 'left and right'} and wins!`
      : tookCentre ? `${sideName(mover)} opens in the centre with ${cellName(move.to)}.`
      : partner >= 0 ? `${sideName(mover)} plays ${cellName(move.to)}, bridging to ${cellName(partner)}.`
      : blocked >= 1 && advanced >= 1 ? `${sideName(mover)} plays ${cellName(move.to)}, advancing and blocking at once.`
      : advanced >= 1 ? `${sideName(mover)} plays ${cellName(move.to)}, extending the connection.`
      : blocked >= 1 ? `${sideName(mover)} plays ${cellName(move.to)} to block the opponent.`
      : `${sideName(mover)} plays ${cellName(move.to)}.`;

    return {
      summary, band,
      evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles,
      threats: threats.length ? threats : undefined,
      betterIdea: loss > 120 && res.move && res.move.to !== move.to
        ? `Stronger was ${cellName(res.move.to)}, which makes faster progress toward joining your edges.`
        : undefined,
    };
  },

  hint(s) {
    if (winnerOf(s) !== null) return null;
    const stones = s.board.filter((c) => c !== null).length;
    if (stones === 0) {
      return { move: makeMove(s, CENTER), text: 'Open in the centre (F6) — a central stone radiates influence toward all of your edges.' };
    }
    const res = searchBestMove(s, searchAdapter(), 2, { rng: mulberry32(seedFor(stones)) });
    if (!res.move) return null;

    const me = s.turn;
    const opp = (me ^ 1) as Player;
    const to = res.move.to;
    const winning = isWinningMove(s.board, to, me);
    const partner = bridgePartner(s.board, to, me);
    const myBefore = completionDistance(s.board, me);
    const after = apply(s, res.move);
    const myAfter = completionDistance(after.board, me);
    const oppBefore = completionDistance(s.board, opp);
    const oppAfter = completionDistance(after.board, opp);

    let text: string;
    if (winning) {
      text = `Play ${cellName(to)} — it completes your chain between the two ${me === 0 ? 'horizontal' : 'vertical'} edges and wins.`;
    } else if (partner >= 0) {
      text = `Play ${cellName(to)} — it bridges to ${cellName(partner)}, a virtual link the opponent can't cut in one move.`;
    } else if (myBefore - myAfter >= 1) {
      text = `Play ${cellName(to)} — it shortens your connection (distance ${myBefore} → ${myAfter}).`;
    } else if (oppAfter - oppBefore >= 1) {
      text = `Play ${cellName(to)} — it blocks the opponent's shortest path while extending your own wall.`;
    } else {
      text = `Play ${cellName(to)} — the strongest developing move here.`;
    }
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Hex is a two-player connection game on an 11×11 rhombus of hexagons, invented independently by the Danish poet-scientist Piet Hein in 1942 and by mathematician John Nash in 1948. The rules could not be simpler — place one stone, then try to join your two sides — yet beneath them lies a game of deep strategy and a famous mathematical guarantee that it can never be drawn.',
    objective: 'Connect YOUR two opposite edges with an unbroken chain of your own stones. Red joins the top and bottom; Blue joins the left and right. Exactly one of you will succeed — Hex has no draws.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board & sides', body: 'The 11×11 board is a slanted rhombus of hexagons. **Red** owns the **top and bottom** edges; **Blue** owns the **left and right** edges. Red moves first, then players alternate, placing **one stone per turn** on any empty cell. Stones never move once placed.' },
          { title: 'How to win', body: 'Build an **unbroken chain of your own stones** linking your two edges. **Red** wins by connecting **top to bottom**; **Blue** wins by connecting **left to right**. The chain may wander any path so long as consecutive stones touch.', highlight: [5, 16, 27, 38, 49, 60, 71, 82, 93, 104, 115] },
          { title: 'The six neighbours', body: 'Each hexagon touches up to **six** others. For a cell at (row r, col c) the neighbours are its left and right, the cells directly above and below, **and** the two acute diagonals — up-right and down-left. Those two diagonals are what make the board hexagonal rather than square.', highlight: [60, 59, 61, 49, 71, 50, 70] },
          { title: 'Why Hex can never draw', body: 'When the board is completely full, it is a mathematical fact that **exactly one** player has connected their sides — never both, never neither. So there is **no such thing as a draw** in Hex; the game always produces a winner. (This truth is equivalent to a deep result, the Brouwer fixed-point theorem.)' },
          { title: 'The centre', body: 'Play tends to begin in the middle. The centre cell here is **F6** (cell 60); a stone there reaches toward every edge and is the classic strong opening.', highlight: [CENTER] },
        ],
      },
      {
        title: 'Strategy', icon: '🧠',
        steps: [
          { title: 'The bridge', body: 'The key tactic in Hex is the **bridge**: two of your stones placed a short knight\'s-hop apart so that **two empty cells** connect them. The opponent cannot cut a bridge — if they play one of the two carrier cells, you simply take the other. Strings of bridges race across the board far faster than solid lines.', highlight: [60, 71], arrows: [{ from: 60, to: 71, tone: 'good' }] },
          { title: 'Connect AND block', body: 'In Hex offence and defence are the **same move**. Because only one side can win, any stone that blocks the opponent\'s route necessarily helps build your own wall across their path. Always ask: does this stone both advance my chain and stand in the opponent\'s way?' },
          { title: 'Central influence', body: 'Stones in the **centre** are worth more than stones on the rim — they radiate toward more edges and support more bridges. Seize the middle early, then extend toward your two sides with efficient bridge ladders.', highlight: [CENTER] },
          { title: 'The first-move edge & swap', body: 'Moving first is a genuine advantage in Hex — with perfect play the **first player wins**. To balance this, players use the **swap rule** (a.k.a. the pie rule): one player places the first stone, then the *other* player may either accept it or **swap sides** and take that stone as their own. This discourages an overpowering opening and keeps the game fair.' },
          { title: 'Reading the connection', body: 'Strong play means thinking in **virtual connections**: groups already linked by bridges and edge templates that need no further moves to join. Plan a chain of such links from one of your edges to the other, and force the opponent to defend everywhere at once.' },
        ],
      },
    ],
  },
};

export default def;
