import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Teeko (John Scarne, 1937) — a tense little abstract on a 5×5 board. Each side
 * has four men. First the DROP phase: players alternate placing their four men on
 * any empty cell. Then the MOVE phase: slide one of your men to an adjacent empty
 * cell — orthogonally OR diagonally. You win the instant your four men form a
 * straight line of four (horizontal, vertical or diagonal) OR a 2×2 square, in
 * either phase. Tiny board, enormous tension.
 *
 * index = row*5 + col, row 0 is the top. Player 0 = Black (first), 1 = Red.
 */

const N = 5;
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;
const DIRS: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
/** Generous safety cap so the move phase can never loop forever in the UI/AI. */
const DRAW_PLY = 120;

export interface TeekoState {
  board: (Player | null)[]; // 25 cells, row-major
  turn: Player;
  ply: number;
}
interface TeekoMove extends MoveBase {}

// Every winning group of four cells: lines of four, then 2×2 squares.
const LINES: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c <= N - 4; c++) out.push([idx(r, c), idx(r, c + 1), idx(r, c + 2), idx(r, c + 3)]);
  for (let c = 0; c < N; c++) for (let r = 0; r <= N - 4; r++) out.push([idx(r, c), idx(r + 1, c), idx(r + 2, c), idx(r + 3, c)]);
  for (let r = 0; r <= N - 4; r++) for (let c = 0; c <= N - 4; c++) out.push([idx(r, c), idx(r + 1, c + 1), idx(r + 2, c + 2), idx(r + 3, c + 3)]);
  for (let r = 0; r <= N - 4; r++) for (let c = 3; c < N; c++) out.push([idx(r, c), idx(r + 1, c - 1), idx(r + 2, c - 2), idx(r + 3, c - 3)]);
  return out;
})();
const SQUARES: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) out.push([idx(r, c), idx(r, c + 1), idx(r + 1, c), idx(r + 1, c + 1)]);
  return out;
})();
const GROUPS = [...LINES, ...SQUARES];
const SQUARE_KEYS = new Set(SQUARES.map((g) => g.join(',')));

function winningGroup(board: (Player | null)[]): number[] | null {
  for (const g of GROUPS) {
    const p = board[g[0]];
    if (p !== null && board[g[1]] === p && board[g[2]] === p && board[g[3]] === p) return g;
  }
  return null;
}
function winnerOf(board: (Player | null)[]): Player | null {
  const g = winningGroup(board);
  return g ? (board[g[0]] as Player) : null;
}

const pieceCount = (board: (Player | null)[]): number => board.filter((v) => v !== null).length;
const isDrop = (board: (Player | null)[]) => pieceCount(board) < 8;

/** Number of groups where `player` holds exactly three with the fourth cell empty. */
function nearWins(board: (Player | null)[], player: Player): number {
  let n = 0;
  for (const g of GROUPS) {
    let mine = 0, empty = 0;
    for (const cell of g) { const v = board[cell]; if (v === player) mine++; else if (v === null) empty++; }
    if (mine === 3 && empty === 1) n++;
  }
  return n;
}

function genMoves(s: TeekoState): TeekoMove[] {
  if (winnerOf(s.board) !== null) return [];
  const out: TeekoMove[] = [];
  if (isDrop(s.board)) {
    for (let i = 0; i < N * N; i++) if (s.board[i] === null) out.push({ id: `d${i}`, to: i, notation: sq(i) });
  } else {
    for (let i = 0; i < N * N; i++) {
      if (s.board[i] !== s.turn) continue;
      const r = Math.floor(i / N), c = i % N;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (inB(nr, nc) && s.board[idx(nr, nc)] === null) {
          const to = idx(nr, nc);
          out.push({ id: `${i}-${to}`, from: i, to, notation: `${sq(i)}-${sq(to)}` });
        }
      }
    }
  }
  return out;
}

function legalMoves(s: TeekoState, from?: number | null): TeekoMove[] {
  const all = genMoves(s);
  return from == null ? all : all.filter((m) => m.from === from);
}

function apply(s: TeekoState, m: TeekoMove): TeekoState {
  const board = s.board.slice();
  if (m.from === undefined) board[m.to] = s.turn;
  else { board[m.from] = null; board[m.to] = s.turn; }
  return { board, turn: (s.turn ^ 1) as Player, ply: s.ply + 1 };
}

export function evaluate(s: TeekoState): number {
  const w = winnerOf(s.board);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  const weight = (n: number) => (n === 3 ? 40 : n === 2 ? 8 : n === 1 ? 1 : 0);
  let score = 0;
  for (const g of GROUPS) {
    let a = 0, b = 0;
    for (const cell of g) { const v = s.board[cell]; if (v === 0) a++; else if (v === 1) b++; }
    if (a > 0 && b > 0) continue; // contested — a dead group for both sides
    score += weight(a) - weight(b);
  }
  const centre = idx(2, 2); // the middle cell sits on the most groups
  if (s.board[centre] === 0) score += 4; else if (s.board[centre] === 1) score -= 4;
  return score;
}

const DEPTH: Record<Difficulty, number> = { tutor: 4, easy: 1, medium: 2, hard: 3, master: 4 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.35, hard: 0.08, master: 0 };
const centrality = (i: number) => 4 - (Math.abs((i % N) - 2) + Math.abs(Math.floor(i / N) - 2));

function searchAdapter() {
  return {
    getLegalMoves: (s: TeekoState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: TeekoState) => s.turn,
    isTerminal: (s: TeekoState) => winnerOf(s.board) !== null || s.ply >= DRAW_PLY,
    evaluate,
    // Try central destinations first so alpha-beta prunes the wide drop phase fast.
    order: (_s: TeekoState, m: TeekoMove) => centrality(m.to),
  };
}

const def: GameDefinition<TeekoState, TeekoMove> = {
  id: 'teeko',
  name: 'Teeko',
  tagline: 'Drop four men, then slide — make a line of four or a 2×2 square to win.',
  blurb:
    'Invented by the magician and games expert John Scarne in 1937 and championed by him as a deeper rival to Tic-Tac-Toe. On a 5×5 board each player first drops four men, then slides them one cell at a time, racing to arrange all four into a straight line of four OR a 2×2 square. The square goal makes it sharper and far less drawish than it looks: threats appear from nowhere, and a single careless slide loses on the spot.',
  category: 'Abstract',
  depth: 3,
  emoji: '🎯',
  accent: '#ef4444',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#111827' },
    { id: 1, name: 'Red', short: 'R', color: '#ef4444' },
  ],
  interaction: { type: 'adaptive' },
  render: { pieceStyle: 'disc', showCoordinates: true, checkered: false },
  evalScale: 150,

  createInitialState: () => ({ board: Array(N * N).fill(null), turn: 0, ply: 0 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, ply: s.ply }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `tk${i}-${p}`, kind: 'man', player: p },
    }));
    return { rows: N, cols: N, cells, fileLabels: ['a', 'b', 'c', 'd', 'e'], rankLabels: ['5', '4', '3', '2', '1'] };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const g = winningGroup(s.board);
    if (g) return { kind: 'win', winner: s.board[g[0]] as Player, reason: SQUARE_KEYS.has(g.join(',')) ? 'a 2×2 square' : 'four in a row' };
    if (s.ply >= DRAW_PLY) return { kind: 'draw', reason: 'no four made in time' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (pieceCount(s.board) * 31 + s.ply * 7 + s.turn + 1) * 2654435761;
    return searchBestMove(s, searchAdapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const res = searchBestMove(before, searchAdapter(), DEPTH.tutor);
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : toMover(evaluate(after));
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const threats: string[] = [];
    const wonG = winningGroup(after.board);
    const won = !!wonG && after.board[wonG[0]] === mover;
    const myNearBefore = nearWins(before.board, mover);
    const myNearAfter = nearWins(after.board, mover);
    const oppNearBefore = nearWins(before.board, (mover ^ 1) as Player);
    const oppNearAfter = nearWins(after.board, (mover ^ 1) as Player);

    if (won) insights.push({ tag: 'Winning move', detail: `Completes ${SQUARE_KEYS.has(wonG!.join(',')) ? 'a 2×2 square' : 'four in a row'} — game over.`, tone: 'good' });
    insights.push(isDrop(before.board)
      ? { tag: 'Drop', detail: 'Places a man during the opening phase.', tone: 'info' }
      : { tag: 'Slide', detail: 'Moves a man to an adjacent empty cell.', tone: 'info' });

    if (!won && myNearAfter >= 2) {
      insights.push({ tag: 'Double threat', detail: 'Two separate fours/squares are now one move away — only one can be stopped.', tone: 'good' });
      principles.push('Make two threats at once; a single defender cannot cover both.');
      threats.push('Two winning completions are threatened.');
    } else if (!won && myNearAfter > myNearBefore) {
      insights.push({ tag: 'Builds a threat', detail: 'Now one move from a line or a square.', tone: 'good' });
    }
    if (oppNearBefore > 0 && oppNearAfter < oppNearBefore) {
      insights.push({ tag: 'Blocks', detail: 'Denies the opponent a completion they were threatening.', tone: 'good' });
      principles.push('Block an immediate four/square threat at once.');
    }
    if (principles.length === 0) principles.push('Keep your men connected and central — the most lines and squares pass through the middle.');

    const winningBig = Math.abs(playedForMover) > 60;
    const band = won ? 'best' : gradeByLoss(loss, winningBig);
    const summary = won
      ? `${def.players[mover].name} completes ${SQUARE_KEYS.has(wonG!.join(',')) ? 'a square' : 'four in a row'} and wins!`
      : myNearAfter >= 2 ? `${def.players[mover].name} sets up a double threat with ${move.notation}.`
      : `${def.players[mover].name} plays ${move.notation}.`;
    const better = loss > 25 && res.move && res.move.id !== move.id ? `A stronger move was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, threats: threats.length ? threats : undefined, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const won = winnerOf(after.board) === s.turn;
    const near = nearWins(after.board, s.turn);
    const text = won ? `${res.move.notation} completes your four — play it to win!`
      : near >= 2 ? `${res.move.notation} makes two threats at once.`
      : isDrop(s.board) ? `${res.move.notation} builds toward a line or square while staying central.`
      : `${res.move.notation} improves your shape.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Teeko was created in 1937 by John Scarne — magician, card expert and one of the great game authorities of the 20th century — who spent decades promoting it as the small abstract that out-thinks Tic-Tac-Toe. The name blends "tic-tac-toe", "checkers" and "chess". It looks innocent: a 5×5 grid, four men a side. But because you win with a line of four *or* a compact 2×2 square, and because the men keep moving, threats materialise from almost any shape — and one loose slide ends the game instantly.',
    objective:
      'Be the first to arrange your four men into one of two winning shapes: a straight line of four (horizontal, vertical or diagonal) or a 2×2 square. First each player drops their four men on empty cells, taking turns; then players take turns sliding a man one step in any of the eight directions onto an adjacent empty cell. A win can happen during the drop phase or the move phase — the moment your fourth man completes a line or square, you have won.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board & the men', body: 'Teeko is played on a **5×5 grid** of 25 cells. Each player has **four men** — one side **Black**, the other **Red**. **Black moves first.** That is the entire equipment: no kings, no captures, no off-board pieces.' },
          { title: 'Phase 1 — the drop', body: 'Play opens with the **drop phase**: starting with Black, players take turns **placing one man on any empty cell**, until all eight men are on the board (four each). Where you drop matters enormously — you are already racing to build a winning shape and to deny your opponent theirs.', setup: '{"board":[null,null,null,null,null,null,0,null,1,null,null,null,0,null,null,null,1,null,null,null,null,null,null,null,null],"ply":4,"turn":0}', highlight: [12] },
          { title: 'Phase 2 — the slide', body: 'Once all eight men are down, the **move phase** begins. On your turn you **slide one of your men one step** to an **adjacent empty cell** — horizontally, vertically **or diagonally** (any of the eight directions). You may not jump, capture, or move onto an occupied cell.' },
          { title: 'Winning shape: four in a line', body: 'You win by getting your four men into a straight line of four — **across, down, or on a diagonal**. On a 5×5 board each row, column and long diagonal gives just two possible fours, so lines are precious. Here Black has three in a row and is one slide from the win.', setup: '{"board":[0,0,0,null,null,null,null,null,1,1,null,null,null,1,1,null,null,null,null,null,null,null,null,null,null],"ply":8,"turn":0}', highlight: [0, 1, 2, 3] },
          { title: 'Winning shape: the 2×2 square', body: 'The second way to win — and the one beginners forget — is a **2×2 square**: four of your men on a little block of adjacent cells. Squares are everywhere and easy to threaten from odd-looking positions, which is exactly what makes Teeko sharp. Watch for them on both sides.', setup: '{"board":[0,0,null,null,null,0,null,null,1,1,null,null,null,1,1,null,null,null,null,null,null,null,null,null,null],"ply":8,"turn":0}', highlight: [0, 1, 5, 6] },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Fight for the centre', body: 'The **central cells** belong to far more lines and squares than the edges and corners — the very middle sits on a row, a column, both diagonals and four different 2×2 squares. Dropping men near the centre keeps the most winning shapes alive for you and lets you contest the opponent’s.', highlight: [6, 7, 8, 11, 12, 13, 16, 17, 18] },
          { title: 'Drop with both shapes in mind', body: 'Because a **square** wins just as well as a **line**, a cluster of three men often threatens *two* completions at once — a line one way and a square the other. Aim your drops at flexible clumps rather than long thin rows, which only threaten in a single direction.' },
          { title: 'The double threat', body: 'As in Tic-Tac-Toe, the killing blow is a move that creates **two** winning threats — a line and a square, or two lines. Your opponent blocks one; you complete the other. Setting these up (and refusing to let your opponent set them up) is the whole middlegame.' },
          { title: 'Every slide is double-edged', body: 'In the move phase a man you slide **leaves** one cell and **arrives** at another, so a single move can complete your shape — or accidentally **break your own** near-win, or open the square your opponent needed. Before you slide, check what the vacated cell gives away.' },
          { title: 'Block in time', body: 'If the opponent has three men set for a line or square with the key cell reachable, you must **stop it now** — drop on the cell (in phase 1) or slide a man to occupy or interpose. Counting both sides’ one-move threats every turn is the core discipline of Teeko.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          {
            title: 'Make the square',
            body: 'Time to play. It is still the **drop phase** and you are **Black** with one man left to place. Three of your men sit on a little block in the top-left — **click the empty cell that completes the 2×2 square** and win at once.',
            setup: '{"board":[0,0,null,null,null,0,null,null,null,null,null,null,1,null,null,null,null,null,1,null,null,null,null,null,1],"ply":6,"turn":0}',
            challenge: {
              prompt: 'Black to play — drop the man that makes a 2×2 square.',
              solution: ['b4'],
              success: 'Dropping on b4 fills the block a5–b5–a4–b4 — a 2×2 square, and an instant win. Remember the square: it is the threat opponents overlook most.',
            },
          },
          {
            title: 'Keep training',
            body: 'In a full game the tutor grades **every** drop and slide — rewarding double threats and timely blocks, and flagging a slide that breaks your own shape — while the evaluation bar tracks who is closer to a line or square. Step the AI up to **Master**, which never misses a four and never lets you make one for free.',
          },
        ],
      },
    ],
  },
};

export default def;
