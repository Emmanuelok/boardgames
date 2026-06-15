import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * The Game of the Amazons (Walter Zamkauskas, 1988) on an 8×8 board. Each side
 * has four amazons that move like a chess queen. After moving, the amazon MUST
 * shoot an arrow — also along a queen line from its new square — that blocks
 * that square forever. Nothing is ever captured; the board just fills with
 * arrows. The player who cannot move loses. Because every turn blocks one more
 * square, the game always ends — and play becomes a deep battle for territory.
 *
 * Board cell encoding (index = row*8 + col, row 0 is the top):
 *   null = empty, 0/1 = an amazon of that player, 2/3 = an arrow shot by that player.
 */

const N = 8;
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;
const DIRS: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export interface AmazonsState {
  board: (number | null)[]; // null empty | 0/1 amazon | 2/3 arrow
  turn: Player;
}
interface AmazonsMove extends MoveBase { arrow: number }

export function initialState(): AmazonsState {
  const board: (number | null)[] = Array(N * N).fill(null);
  for (const i of [2, 5, 16, 23]) board[i] = 1; // Black amazons: c8,f8,a6,h6
  for (const i of [40, 47, 58, 61]) board[i] = 0; // White amazons: a3,h3,c1,f1
  return { board, turn: 0 };
}

const isAmazon = (v: number | null) => v === 0 || v === 1;
function amazonsOf(board: (number | null)[], p: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < N * N; i++) if (board[i] === p) out.push(i);
  return out;
}

/** Empty squares reachable from `from` by a queen slide; `ignore` is treated empty. */
function queenReach(board: (number | null)[], from: number, ignore = -1): number[] {
  const r0 = Math.floor(from / N), c0 = from % N;
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr, c = c0 + dc;
    while (inB(r, c)) {
      const i = idx(r, c);
      if (i !== ignore && board[i] !== null) break;
      out.push(i);
      r += dr; c += dc;
    }
  }
  return out;
}

function genMoves(board: (number | null)[], turn: Player): AmazonsMove[] {
  const out: AmazonsMove[] = [];
  for (const from of amazonsOf(board, turn)) {
    for (const to of queenReach(board, from)) {
      // From the destination, the amazon's old square is now empty (ignore=from).
      for (const arrow of queenReach(board, to, from)) {
        out.push({ id: `${from}-${to}-${arrow}`, from, to, arrow, capture: false, affected: [arrow], notation: `${sq(from)}-${sq(to)}✕${sq(arrow)}` });
      }
    }
  }
  return out;
}

function legalMoves(s: AmazonsState, from?: number | null): AmazonsMove[] {
  const all = genMoves(s.board, s.turn);
  return from == null ? all : all.filter((m) => m.from === from);
}

function apply(s: AmazonsState, m: AmazonsMove): AmazonsState {
  const board = s.board.slice();
  board[m.from!] = null;
  board[m.to] = s.turn; // amazon
  board[m.arrow] = 2 + s.turn; // arrow
  return { board, turn: (s.turn ^ 1) as Player };
}

const hasMove = (board: (number | null)[], p: Player) => amazonsOf(board, p).some((a) => queenReach(board, a).length > 0);

/* --------------------------------- eval --------------------------------- */

/**
 * Territory by minimum queen-move distance: each empty square is "owned" by the
 * side whose amazons can reach it in fewer moves. Owning more of the board is the
 * essence of Amazons strategy and plays well even at shallow depth.
 */
function queenDist(board: (number | null)[], sources: number[]): Int8Array {
  const dist = new Int8Array(N * N).fill(127);
  let frontier: number[] = [];
  for (const s of sources) { dist[s] = 0; frontier.push(s); }
  let d = 0;
  while (frontier.length) {
    const next: number[] = [];
    for (const cell of frontier) {
      for (const e of queenReach(board, cell)) {
        if (dist[e] > d + 1) { dist[e] = d + 1; next.push(e); }
      }
    }
    frontier = next; d++;
  }
  return dist;
}

export function evaluate(s: AmazonsState): number {
  if (s.turn === 0 && !hasMove(s.board, 0)) return -WIN; // White to move, stuck → loses
  if (s.turn === 1 && !hasMove(s.board, 1)) return WIN;
  const d0 = queenDist(s.board, amazonsOf(s.board, 0));
  const d1 = queenDist(s.board, amazonsOf(s.board, 1));
  let territory = 0, mobility = 0;
  for (let i = 0; i < N * N; i++) {
    if (s.board[i] !== null) continue;
    if (d0[i] < d1[i]) territory++;
    else if (d1[i] < d0[i]) territory--;
  }
  for (const a of amazonsOf(s.board, 0)) mobility += queenReach(s.board, a).length;
  for (const a of amazonsOf(s.board, 1)) mobility -= queenReach(s.board, a).length;
  return territory * 12 + mobility; // territory dominates; mobility breaks ties
}

// Amazons branches to hundreds of moves early, so a fixed depth-2 search is
// intractable; instead every level searches one ply over a strong TERRITORY
// evaluation (the key Amazons heuristic), with difficulty set by randomness.
const DEPTH: Record<Difficulty, number> = { tutor: 1, easy: 1, medium: 1, hard: 1, master: 1 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.4, hard: 0.15, master: 0 };

function searchAdapter() {
  return {
    getLegalMoves: (s: AmazonsState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: AmazonsState) => s.turn,
    isTerminal: (s: AmazonsState) => !hasMove(s.board, s.turn),
    evaluate,
  };
}

const def: GameDefinition<AmazonsState, AmazonsMove> = {
  id: 'amazons',
  name: 'Amazons',
  tagline: 'Move like a queen, then fire an arrow — wall your rival in until they cannot move.',
  blurb:
    'A modern masterpiece of pure strategy. Your four amazons sweep across the board like chess queens, and after each move one of them looses an arrow that seals a square shut forever. No piece is ever captured; instead the open board slowly closes up, and the contest becomes a subtle war over territory. Whoever is first left with no move loses. Easy to learn, famously deep — a favourite of game theorists and a true test of spatial vision.',
  category: 'Abstract',
  depth: 5,
  emoji: '🏹',
  accent: '#22d3ee',
  players: [
    { id: 0, name: 'White', short: 'W', color: '#f1f5f9' },
    { id: 1, name: 'Black', short: 'B', color: '#111827' },
  ],
  interaction: { type: 'shoot' },
  render: { pieceStyle: 'mark', showCoordinates: true, checkered: true },
  evalScale: 220,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((v, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: v === null ? null
        : isAmazon(v) ? { id: `am${i}-${v}`, kind: 'amazon', player: v as Player, glyph: '♛' }
        : { id: `ar${i}-${v}`, kind: 'arrow', player: (v - 2) as Player, glyph: '✕' },
    }));
    return {
      rows: N, cols: N, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      rankLabels: ['8', '7', '6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (!hasMove(s.board, s.turn)) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent is walled in with no move' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (s.board.filter((v) => v !== null).length + s.turn + 1) * 2654435761;
    return searchBestMove(s, searchAdapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const res = searchBestMove(before, searchAdapter(), DEPTH.master);
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const moverPlayed = toMover(evaluate(after));
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : moverPlayed;
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    if (!hasMove(after.board, (mover ^ 1) as Player)) insights.push({ tag: 'Sealed in!', detail: 'The opponent has no move left — that wins the game.', tone: 'good' });
    const mineNext = amazonsOf(after.board, mover).reduce((s2, a) => s2 + queenReach(after.board, a).length, 0);
    const oppNext = amazonsOf(after.board, (mover ^ 1) as Player).reduce((s2, a) => s2 + queenReach(after.board, a).length, 0);
    insights.push({ tag: 'Move & shoot', detail: `Amazon to ${sq(move.to)}, arrow to ${sq(move.arrow)} — sealing that square for good.`, tone: 'info' });
    if (mineNext > oppNext) insights.push({ tag: 'Space', detail: 'Leaves your amazons more room to roam than your opponent — the goal of every move.', tone: 'good' });
    else if (mineNext < oppNext - 3) insights.push({ tag: 'Cramped', detail: 'Your amazons end up with less room than the enemy — risky in the territory race.', tone: 'bad' });
    if (principles.length === 0) principles.push('Fight for territory: use arrows to wall off regions you dominate and to fence the enemy in.');

    const winningBig = Math.abs(moverPlayed) > 200;
    const band = !hasMove(after.board, (mover ^ 1) as Player) ? 'best' : gradeByLoss(loss, winningBig);
    const summary = !hasMove(after.board, (mover ^ 1) as Player) ? `${def.players[mover].name} walls the opponent in and wins!`
      : `${def.players[mover].name}: ${sq(move.from!)}→${sq(move.to)}, arrow ${sq(move.arrow)}.`;
    const better = loss > 24 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.master);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const text = !hasMove(after.board, (s.turn ^ 1) as Player)
      ? `${res.move.notation} leaves the opponent with no move — play it to win!`
      : `Move to ${sq(res.move.to)} and shoot ${sq(res.move.arrow)} — it claims the most territory.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'The Game of the Amazons was invented by Walter Zamkauskas in 1988 and has become a touchstone for game theorists and AI researchers alike, prized for the staggering number of moves available early on and the elegant way the board steadily closes. Each move is two actions in one — a queen-like step, then an arrow shot — and the whole game is a slow, beautiful act of enclosure in which you carve the board into regions and try to end up with more room than your opponent.',
    objective:
      'Be the player who can still move when your opponent cannot. There is no capturing; instead, every arrow you fire permanently seals a square, so the open space relentlessly shrinks. As walls of arrows divide the board into separate pockets, the side whose amazons are penned into the smaller space runs out of moves first — and loses. Think in terms of territory: every move and every arrow should win you room or take it away from the enemy.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The amazons', body: 'Each side has **four amazons**, placed symmetrically near the edges. They move exactly like a **chess queen** — any number of empty squares in a straight line: horizontally, vertically or diagonally — and may never jump over anything.' },
          { title: 'Move, then shoot', body: 'A turn has **two parts**: first move one of your amazons like a queen, then **immediately shoot an arrow** from that amazon’s new square. The arrow also flies in a straight queen-line and lands on an empty square (marked ✕), which is **blocked forever** — no piece or arrow may ever use it again. Here the white amazon on d6 has just fired an arrow to f6.', setup: '{"board":[null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,2,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,3,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [19], arrows: [{ from: 19, to: 21, tone: 'good' }] },
          { title: 'Nothing is captured', body: 'Amazons are never taken and arrows never move. The board only ever gains arrows, so the open space steadily shrinks and divides into separate regions. Every game marches toward a close.' },
          { title: 'Winning', body: 'There is no goal square and no capture count. You win when, on your **opponent’s** turn, none of their amazons can make a legal move (each is walled in by edges, arrows and other pieces). The player who makes the **last move wins**.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'It’s all about territory', body: 'Count the empty squares your amazons can reach **before** your opponent’s can. Whoever controls more reachable space will get more moves, and so make the last one. Every arrow should either expand your territory or shrink the enemy’s.' },
          { title: 'Build walls', body: 'Use arrows to **fence off** a region you already dominate, sealing it as your private reservoir of moves. A wall of arrows cutting the board in two, with you on the bigger side, is often decisive.' },
          { title: 'Trap, don’t chase', body: 'You can hem an enemy amazon into a tiny pocket with arrows, taking it out of the game without ever capturing it. Reducing your opponent to a few cramped squares while your amazons roam free is the classic winning plan.' },
          { title: 'Keep your amazons free', body: 'Beware of walling **yourself** in. An amazon with no room is as good as lost. Aim to leave each of your amazons access to open space, and avoid shooting arrows that block your own paths.' },
        ],
      },
    ],
  },
};

export default def;
