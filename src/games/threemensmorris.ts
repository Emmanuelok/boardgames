import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Three Men's Morris (a.k.a. Nine Holes / Tapatan) — one of the oldest board
 * games known, boards scratched into Roman and Egyptian stone. On a 3×3 board of
 * nine points joined by the rows, columns and both diagonals, each player has
 * three men. First a PLACEMENT phase: players alternate dropping their three men
 * on empty points. Then a MOVEMENT phase: slide a man along a line to an adjacent
 * empty point. Three of your men in any straight line wins — so, unlike
 * Tic-Tac-Toe, the game does not end when the board fills; you must manoeuvre.
 *
 * index = row*3 + col, row 0 is the top. Player 0 = Black (first), 1 = White.
 */

const N = 3;
const sq = (i: number) => `${'abc'[i % N]}${N - Math.floor(i / N)}`;

// The eight straight lines (three rows, three columns, two diagonals).
const LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// Adjacency for sliding: consecutive points on a line are connected. The centre
// joins all eight points; corners and edges join three each.
const ADJ: number[][] = (() => {
  const set = Array.from({ length: N * N }, () => new Set<number>());
  for (const [a, b, c] of LINES) { set[a].add(b); set[b].add(a); set[b].add(c); set[c].add(b); }
  return set.map((s) => [...s]);
})();

// Unique edges, for drawing the classic board (grid + both diagonals).
const CONNECTIONS: [number, number][] = (() => {
  const seen = new Set<string>(); const out: [number, number][] = [];
  for (let a = 0; a < N * N; a++) for (const b of ADJ[a]) {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!seen.has(k)) { seen.add(k); out.push(a < b ? [a, b] : [b, a]); }
  }
  return out;
})();

const DRAW_PLY = 60; // bound the shuffling phase so it can't loop forever

export interface MorrisState {
  board: (Player | null)[]; // 9 points
  turn: Player;
  ply: number;
}
interface MorrisMove extends MoveBase {}

function winnerOf(board: (Player | null)[]): Player | null {
  for (const [a, b, c] of LINES) if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}
const placed = (board: (Player | null)[]): number => board.filter((v) => v !== null).length;
const isPlacement = (board: (Player | null)[]) => placed(board) < 6;

function genMoves(s: MorrisState): MorrisMove[] {
  if (winnerOf(s.board) !== null) return [];
  const out: MorrisMove[] = [];
  if (isPlacement(s.board)) {
    for (let i = 0; i < N * N; i++) if (s.board[i] === null) out.push({ id: `p${i}`, to: i, notation: sq(i) });
  } else {
    for (let i = 0; i < N * N; i++) {
      if (s.board[i] !== s.turn) continue;
      for (const j of ADJ[i]) if (s.board[j] === null) out.push({ id: `${i}-${j}`, from: i, to: j, notation: `${sq(i)}-${sq(j)}` });
    }
  }
  return out;
}

function legalMoves(s: MorrisState, from?: number | null): MorrisMove[] {
  const all = genMoves(s);
  return from == null ? all : all.filter((m) => m.from === from);
}

function apply(s: MorrisState, m: MorrisMove): MorrisState {
  const board = s.board.slice();
  if (m.from === undefined) board[m.to] = s.turn;
  else { board[m.from] = null; board[m.to] = s.turn; }
  return { board, turn: (s.turn ^ 1) as Player, ply: s.ply + 1 };
}

export function evaluate(s: MorrisState): number {
  const w = winnerOf(s.board);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  // In the movement phase, a side with no legal slide is stalemated and loses.
  if (!isPlacement(s.board) && genMoves(s).length === 0) return s.turn === 0 ? -WIN : WIN;
  let score = 0;
  for (const [a, b, c] of LINES) {
    const cells = [s.board[a], s.board[b], s.board[c]];
    const x = cells.filter((v) => v === 0).length, o = cells.filter((v) => v === 1).length;
    if (x > 0 && o > 0) continue; // contested — a dead line
    if (x > 0) score += x === 2 ? 18 : 3;
    if (o > 0) score -= o === 2 ? 18 : 3;
  }
  if (s.board[4] === 0) score += 6; else if (s.board[4] === 1) score -= 6; // the centre sits on four lines
  return score;
}

const DEPTH: Record<Difficulty, number> = { tutor: 9, easy: 1, medium: 3, hard: 6, master: 9 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.85, medium: 0.45, hard: 0.1, master: 0 };

function searchAdapter() {
  return {
    getLegalMoves: (s: MorrisState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: MorrisState) => s.turn,
    isTerminal: (s: MorrisState) => winnerOf(s.board) !== null || s.ply >= DRAW_PLY || (!isPlacement(s.board) && genMoves(s).length === 0),
    evaluate,
  };
}

function threats(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const [a, b, c] of LINES) {
    const cells = [board[a], board[b], board[c]];
    if (cells.filter((v) => v === player).length === 2 && cells.includes(null)) n++;
  }
  return n;
}

const def: GameDefinition<MorrisState, MorrisMove> = {
  id: 'three-mens-morris',
  name: "Three Men's Morris",
  tagline: 'Place three men, then slide along the lines — three in a row wins.',
  blurb:
    'An ancestor of Tic-Tac-Toe and the whole Morris family, played for over two thousand years — Ovid mentions it, and boards survive carved into Roman temple steps. You each drop three men on a 3×3 board of lines, then begin sliding them point to point. The twist that makes it a real game: the board never fills, so you can shuffle toward three in a row forever — and so can your opponent. It is a tense little dance of making and blocking the same handful of lines.',
  category: 'Classic',
  depth: 2,
  emoji: '🔵',
  accent: '#0ea5e9',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#1f2937' },
    { id: 1, name: 'White', short: 'W', color: '#f8fafc' },
  ],
  interaction: { type: 'adaptive' },
  render: { pieceStyle: 'disc', showCoordinates: false, checkered: false, connections: CONNECTIONS },
  evalScale: 36,

  createInitialState: () => ({ board: Array(N * N).fill(null), turn: 0, ply: 0 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, ply: s.ply }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `tm${i}-${p}`, kind: 'man', player: p },
    }));
    return { rows: N, cols: N, cells };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s.board);
    if (w !== null) return { kind: 'win', winner: w, reason: 'three in a row' };
    if (!isPlacement(s.board) && genMoves(s).length === 0) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent has no move' };
    if (s.ply >= DRAW_PLY) return { kind: 'draw', reason: 'no three in a row in time' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (placed(s.board) * 17 + s.ply * 7 + s.turn + 1) * 2654435761;
    return searchBestMove(s, searchAdapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const res = searchBestMove(before, searchAdapter(), DEPTH.hard);
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : toMover(evaluate(after));
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const won = winnerOf(after.board) === mover;
    const myAfter = threats(after.board, mover);
    const myBefore = threats(before.board, mover);
    const oppBefore = threats(before.board, (mover ^ 1) as Player);
    const oppAfter = threats(after.board, (mover ^ 1) as Player);

    if (won) insights.push({ tag: 'Winning move', detail: 'Completes three in a row — game over.', tone: 'good' });
    insights.push(isPlacement(before.board)
      ? { tag: 'Placement', detail: 'Drops a man during the opening phase.', tone: 'info' }
      : { tag: 'Slide', detail: 'Moves a man along a line to an adjacent point.', tone: 'info' });
    if (!won && myAfter >= 2) {
      insights.push({ tag: 'Double threat', detail: 'Two lines are now one move from completion — only one can be blocked.', tone: 'good' });
      principles.push('Make two threats at once; a single defender cannot cover both.');
    } else if (!won && myAfter > myBefore) {
      insights.push({ tag: 'Builds a threat', detail: 'Now one move from three in a row.', tone: 'good' });
    }
    if (oppBefore > 0 && oppAfter < oppBefore) {
      insights.push({ tag: 'Blocks', detail: 'Stops a line the opponent was about to complete.', tone: 'good' });
      principles.push('Block an immediate three-in-a-row threat at once.');
    }
    if (principles.length === 0) principles.push('Fight for the centre — it lies on four of the eight lines.');

    const winningBig = Math.abs(playedForMover) > 40;
    const band = won ? 'best' : gradeByLoss(loss, winningBig);
    const summary = won ? `${def.players[mover].name} makes three in a row and wins!`
      : myAfter >= 2 ? `${def.players[mover].name} sets up a double threat with ${move.notation}.`
      : `${def.players[mover].name} plays ${move.notation}.`;
    const better = loss > 25 && res.move && res.move.id !== move.id ? `A stronger move was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.hard);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const won = winnerOf(after.board) === s.turn;
    const near = threats(after.board, s.turn);
    const text = won ? `${res.move.notation} completes three in a row — play it to win!`
      : near >= 2 ? `${res.move.notation} makes two threats at once.`
      : isPlacement(s.board) ? `${res.move.notation} fights for the centre and the most lines.`
      : `${res.move.notation} improves your position.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      "Three Men's Morris is one of humanity's oldest games — diagrams of its board are cut into the roofing slabs of an Egyptian temple at Kurna and into the steps of the Roman forum, and the poet Ovid describes it in the first century. It is the simplest member of the Morris family and a direct ancestor of Tic-Tac-Toe, but with one decisive difference: because each side has only three men and the board has nine points, play does not stop when the men are down — you slide them around, hunting for three in a row while denying it to your opponent.",
    objective:
      'Get your three men onto any one of the eight straight lines — a row, a column or a diagonal. Play has two phases. First, taking turns, each player places their three men on empty points. Then, taking turns, each player slides one man along a drawn line to a neighbouring empty point. There is no capturing and the board never fills, so the game is a pure race of threats; with best play it is a draw, and the skill is in never letting your opponent slip a third man into line.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board & the men', body: 'The board is a **3×3 grid of nine points**, joined by lines along the three rows, three columns and **both diagonals** — so the centre point connects to all eight others. Each player has just **three men**; one side is **Black**, the other **White**. **Black goes first.**' },
          { title: 'Phase 1 — placing', body: 'Starting with Black, players take turns **placing one man on any empty point**, until all six men are on the board (three each). If you can make three in a row already during placing, you win at once — but a careful opponent will not let you.' },
          { title: 'Phase 2 — moving', body: 'Once all six men are down, players take turns **sliding one man along a line to an adjacent empty point**. You can only move to a connected neighbour, and only onto an empty point — there is no jumping and no capturing.' },
          { title: 'How to win', body: 'Form **three of your men in a straight line** — any row, column or diagonal — and you win the instant it happens, in either phase. Because there are always three empty points in the moving phase, the game can continue indefinitely, so winning means out-manoeuvring your opponent, not out-lasting them.', highlight: [0, 4, 8] },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'The centre is everything', body: 'The **centre point lies on four of the eight lines** — both diagonals, the middle row and the middle column. Whoever holds it has by far the most ways to build and the most ways to block. Taking the centre, in placement or by sliding into it, is almost always right.', highlight: [4] },
          { title: 'Make and block in the same breath', body: 'With only three men each, almost every position has a live threat for *someone*. The strongest slides both **complete one of your lines’ requirements and sit in the opponent’s** — gaining a tempo. Always check, before you move, whether your opponent is one slide from three in a row.' },
          { title: "Don't break your own line carelessly", body: 'Sliding a man **vacates** the point it left, which can destroy a line you were building or open the very point your opponent needed. Every move is two events — a departure and an arrival — so weigh both. A move that makes a threat while leaving another intact is gold.' },
          { title: 'Why it is a draw with care', body: 'With best play Three Men\'s Morris is a **draw**: each side can always block the other’s third man in time. So against our Master AI a draw is the goal — and any win means you engineered a double threat or punished a careless slide.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          {
            title: 'Slide into the win',
            body: 'All six men are down, so you are in the **moving phase**, playing **Black**. You already hold two corners of the top row; your centre man can slide up to complete it. **Click your centre man, then the empty top-middle point.**',
            setup: '{"board":[0,null,0,1,0,1,null,null,1],"turn":0,"ply":6}',
            challenge: {
              prompt: 'Black to play — slide a man to make three in a row.',
              solution: ['b2-b3'],
              success: 'Sliding the centre man to b3 lines up the whole top row — three in a row and the win. Notice it had to come from the centre: no other Black man touches b3 without breaking the line.',
            },
          },
          {
            title: 'Keep training',
            body: 'In a real game the tutor grades **every** placement and slide — praising double threats and timely blocks, and warning when a slide breaks your own line — while the evaluation bar tracks who is closer to three in a row. On **Master** the AI never lets a third man through, so hold the draw and pounce on any slip.',
          },
        ],
      },
    ],
  },
};

export default def;
