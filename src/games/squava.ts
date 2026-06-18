import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Squava — a 5×5 misère/positive hybrid.                                     */
/*                                                                            */
/*  Players take turns marking empty cells. You WIN by making four in a row    */
/*  (orthogonal or diagonal) — but you LOSE the instant you make three in a    */
/*  row without it being part of a four. So three is poison: you must build    */
/*  fours through GAPS (✕ ✕ _ ✕) and steer your opponent into a forced three.  */
/*  A filled board with neither result is a draw. Pure logic, no mutation.     */
/* -------------------------------------------------------------------------- */

const SIZE = 5;
const N = SIZE * SIZE;

export interface SquavaState { board: (Player | null)[]; turn: Player }
export interface SquavaMove extends MoveBase {}

const rowOf = (i: number) => Math.floor(i / SIZE);
const colOf = (i: number) => i % SIZE;
const FILES = ['a', 'b', 'c', 'd', 'e'];
const sq = (i: number) => `${FILES[colOf(i)]}${SIZE - rowOf(i)}`;
const DIRS: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];

export function createInitialState(): SquavaState {
  return { board: Array(N).fill(null), turn: 0 };
}

/** Longest consecutive run of player p through any line. */
function maxRun(board: (Player | null)[], p: Player): number {
  let best = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r * SIZE + c] !== p) continue;
      for (const [dr, dc] of DIRS) {
        const pr = r - dr, pc = c - dc;
        if (pr >= 0 && pr < SIZE && pc >= 0 && pc < SIZE && board[pr * SIZE + pc] === p) continue; // not a run start
        let len = 0, rr = r, cc = c;
        while (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr * SIZE + cc] === p) { len++; rr += dr; cc += dc; }
        if (len > best) best = len;
      }
    }
  }
  return best;
}

const isFull = (b: (Player | null)[]) => b.every((v) => v !== null);

/** The player who just moved is turn^1; their run decides the outcome. */
export function winnerOf(s: SquavaState): Player | 'draw' | null {
  const mover = (s.turn ^ 1) as Player;
  const run = maxRun(s.board, mover);
  if (run >= 4) return mover;          // four in a row → the mover wins
  if (run === 3) return s.turn;        // three in a row → the mover loses, so the other player wins
  if (isFull(s.board)) return 'draw';
  return null;
}

export function legalMoves(s: SquavaState): SquavaMove[] {
  if (winnerOf(s) !== null) return [];
  const tag = s.turn === 0 ? '✕' : '◯';
  const out: SquavaMove[] = [];
  for (let i = 0; i < N; i++) if (s.board[i] === null) out.push({ id: `p${i}`, to: i, notation: `${tag} ${sq(i)}` });
  return out;
}

export function applyMove(s: SquavaState, m: SquavaMove): SquavaState {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

/* ------------------------------- Evaluation ------------------------------ */

// Every 4-in-a-line window (the unit of a potential four).
const WINDOWS: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) for (const [dr, dc] of DIRS) {
    const er = r + 3 * dr, ec = c + 3 * dc;
    if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;
    out.push([0, 1, 2, 3].map((k) => (r + k * dr) * SIZE + (c + k * dc)));
  }
  return out;
})();
const WEIGHT = [0, 1, 6, 45]; // value of a pure window by how many marks it holds (3 = one move from a winning four)

function evaluate(s: SquavaState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  if (w === 'draw') return 0;
  let score = 0;
  for (const win of WINDOWS) {
    let x = 0, o = 0;
    for (const i of win) { const v = s.board[i]; if (v === 0) x++; else if (v === 1) o++; }
    if (x > 0 && o > 0) continue; // dead window
    if (x > 0) score += WEIGHT[x];
    else if (o > 0) score -= WEIGHT[o];
  }
  // Mild centre preference.
  for (let i = 0; i < N; i++) { const v = s.board[i]; if (v === null) continue; const cb = 2 - (Math.abs(rowOf(i) - 2) + Math.abs(colOf(i) - 2)) * 0.3; score += (v === 0 ? 1 : -1) * cb; }
  return score;
}

/** A move is "losing" if it makes a bare three; "winning" if it makes a four. */
function classify(s: SquavaState, m: SquavaMove): 'win' | 'lose' | 'safe' {
  const run = maxRun(applyMove(s, m).board, s.turn);
  return run >= 4 ? 'win' : run === 3 ? 'lose' : 'safe';
}

function adapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove,
    getTurn: (s: SquavaState) => s.turn,
    isTerminal: (s: SquavaState) => winnerOf(s) !== null,
    evaluate,
    // Try wins first, then safe moves, then self-defeating threes last — sharp pruning.
    order: (s: SquavaState, m: SquavaMove) => { const k = classify(s, m); return k === 'win' ? 100 : k === 'safe' ? 10 : -100; },
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 6, easy: 2, medium: 4, hard: 6, master: 8 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.8, medium: 0.4, hard: 0.08, master: 0 };

function chooseMove(s: SquavaState, difficulty: Difficulty): SquavaMove | null {
  const filled = s.board.filter((v) => v !== null).length;
  let depth = DEPTH[difficulty];
  if (filled < 6) depth = Math.min(depth, 4);        // tame the wide opening
  else if (filled < 10) depth = Math.min(depth, 6);  // ramp up as branching shrinks
  const seed = (filled + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), depth, { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/* ------------------------------- Status & view --------------------------- */

function getStatus(s: SquavaState): GameStatus {
  const w = winnerOf(s);
  if (w === 'draw') return { kind: 'draw', reason: 'the board filled with no four and no three' };
  if (w !== null) {
    const mover = (s.turn ^ 1) as Player;
    const reason = w === mover ? 'four in a row' : 'the opponent was forced into three in a row';
    return { kind: 'win', winner: w, reason };
  }
  return { kind: 'playing' };
}

function getBoardView(s: SquavaState): BoardView {
  const cells = s.board.map((p, i) => ({
    index: i, row: rowOf(i), col: colOf(i),
    piece: p === null ? null : { id: `sq${i}`, kind: p === 0 ? 'X' : 'O', player: p, glyph: p === 0 ? '✕' : '◯' },
  }));
  return { rows: SIZE, cols: SIZE, cells, fileLabels: FILES.slice(), rankLabels: ['5', '4', '3', '2', '1'] };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

function winningCells(s: SquavaState, p: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (s.board[i] === null) { const b = s.board.slice(); b[i] = p; if (maxRun(b, p) >= 4) out.push(i); }
  return out;
}
function safeCount(s: SquavaState, p: Player): number {
  let n = 0;
  for (let i = 0; i < N; i++) if (s.board[i] === null) { const b = s.board.slice(); b[i] = p; const run = maxRun(b, p); if (run < 3 || run >= 4) n++; }
  return n;
}

function explainMove(before: SquavaState, move: SquavaMove, after: SquavaState): MoveExplanation {
  const mover = before.turn;
  const name = mover === 0 ? 'You' : 'Owl';
  const res = searchBestMove(before, adapter(), DEPTH.tutor);
  const toMover = (sc: number) => (mover === 0 ? sc : -sc);
  const playedScore = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
  const bestScore = res.ranked.length ? toMover(res.ranked[0].score) : playedScore;
  const loss = Math.max(0, bestScore - playedScore);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];
  const kind = classify(before, move);
  const w = winnerOf(after);

  if (w === mover) insights.push({ tag: 'Four in a row — win!', detail: 'Completed a line of four, the winning length.', tone: 'good' });
  else if (w !== null && w !== 'draw') insights.push({ tag: 'Three in a row — loss', detail: 'This makes a bare three, which loses on the spot. Threes are poison unless they extend to four.', tone: 'bad' });
  else {
    const myWins = winningCells(after, mover).length;
    if (myWins >= 2) { insights.push({ tag: 'Double threat!', detail: `Sets up ${myWins} different ways to complete a four — the opponent can block only one.`, tone: 'good' }); principles.push('Aim for two winning gaps at once; a double threat to four is unstoppable.'); }
    else if (myWins === 1) { insights.push({ tag: 'Threatens four', detail: 'Creates a gap that becomes a winning four next move — the opponent must block it.', tone: 'good' }); }
    else insights.push({ tag: 'Safe development', detail: 'Builds influence without exposing a three. In Squava, not losing is half of winning.', tone: 'info' });
    const oppSafe = safeCount(after, (mover ^ 1) as Player);
    if (oppSafe <= 2) { insights.push({ tag: 'Squeezing', detail: `The opponent has only ${oppSafe} safe square${oppSafe === 1 ? '' : 's'} left — they may soon be forced into a three.`, tone: 'good' }); threats.push('Opponent is running out of safe moves.'); }
  }
  if (kind === 'lose' && w === null) principles.push('Never make three in a row unless the same move makes four.');
  principles.push('Build fours through a GAP (✕ ✕ _ ✕), never as a bare three.');

  const winningBig = Math.abs(playedScore) > 90;
  const band = w === mover ? 'best' : (w !== null && w !== 'draw') ? 'blunder' : gradeByLoss(loss, winningBig);
  const summary = w === mover ? `${name} make four in a row and win!`
    : (w !== null && w !== 'draw') ? `${name} are forced into three in a row and lose.`
    : `${name} play ${sq(move.to)}.`;
  return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, threats: threats.length ? threats : undefined, betterIdea: loss > 60 && res.move && res.move.id !== move.id ? `Stronger was ${sq(res.move.to)}.` : undefined };
}

function hint(s: SquavaState): { move: SquavaMove; text: string } | null {
  const res = searchBestMove(s, adapter(), DEPTH.hard);
  if (!res.move) return null;
  const k = classify(s, res.move);
  const text = k === 'win' ? `Play ${sq(res.move.to)} — it completes four in a row and wins!`
    : winningCells(applyMove(s, res.move), s.turn).length >= 2 ? `Play ${sq(res.move.to)} — it sets up a double threat to four.`
    : `Play ${sq(res.move.to)} — a safe move that keeps your fours alive without exposing a three.`;
  return { move: res.move, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<SquavaState, SquavaMove> = {
  id: 'squava',
  name: 'Squava',
  tagline: 'Four in a row wins — but three in a row LOSES. A tiny board, a wicked twist.',
  blurb:
    'Squava looks like noughts-and-crosses grown up, then turns the screw. On a 5×5 grid, making four in a row wins — yet making three in a row LOSES instantly. Suddenly every line is a tightrope: you must build your fours through gaps and trick your opponent into the three they cannot avoid. Small, sharp and devious, it flips your tic-tac-toe instincts upside down.',
  category: 'Abstract',
  depth: 2,
  emoji: '⛓️',
  accent: '#a78bfa',
  players: [
    { id: 0, name: 'You', short: 'X', color: '#60a5fa' },
    { id: 1, name: 'Owl', short: 'O', color: '#f87171' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'mark', showCoordinates: true, checkered: true },
  evalScale: 90,

  createInitialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),
  getBoardView,
  getTurn: (s) => s.turn,
  getStatus,
  getLegalMoves: (s) => legalMoves(s),
  applyMove,
  chooseMove,
  evaluate,
  explainMove,
  hint,

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str) as SquavaState,

  tutorial: {
    overview:
      'Squava (from "square" + "Sudoku"-ish coinage) is a modern abstract that weaponises the humble three-in-a-row. Everyone who has played tic-tac-toe instinctively rushes to line up their marks — and in Squava that instinct gets you killed, because three in a row is an instant loss. The only winning length is four. The result is a tense little game of building through gaps and laying traps.',
    objective:
      'Make a line of FOUR of your marks — horizontally, vertically or diagonally — to win. But beware: making a line of exactly THREE loses immediately. So you can never simply stack three and add a fourth; you must complete fours through gaps, while manoeuvring your opponent into a position where every move makes them a three.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'Place a mark', body: 'On your turn, place your mark (**✕** for you, **◯** for the Owl) on any empty cell of the 5×5 board. You go first; then you alternate. Nothing ever moves or is removed.' },
          { title: 'Four wins', body: 'Make **four of your marks in a row** — across, down or diagonally — and you **win** immediately.' },
          { title: 'Three loses', body: 'Make **three in a row** and you **lose** on the spot — unless that same move makes four. This is the whole twist: three is poison.', setup: '{"turn":1,"board":[null,null,null,null,null,null,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]}', highlight: [6, 7, 8] },
          { title: 'Win through a gap', body: 'Because a bare three loses, you build fours through a **gap**: ✕ ✕ _ ✕. Filling the gap jumps you straight from a safe shape to a winning four — never passing through a losing three.', setup: '{"turn":0,"board":[null,null,null,null,null,0,0,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]}', highlight: [5, 6, 8], arrows: [{ from: 7, to: 7, tone: 'good' }] },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Fear your own threes', body: 'Your tic-tac-toe reflexes are now a liability. Before every move, check: does this make a bare three? If so, only play it when it simultaneously makes four. Counting threes is the first skill of Squava.' },
          { title: 'Build with gaps', body: 'Lay your marks with **gaps** between them (✕ _ ✕ or ✕ ✕ _ ✕) so a single fill turns them into a four. A gapped pattern threatens a win while never standing as a losing three.' },
          { title: 'Set the double threat', body: 'The cleanest wins create **two** gap-fours at once. Your opponent can block only one square per turn, so two simultaneous winning gaps end the game.' },
          { title: 'Squeeze for the forced three', body: 'You can also win by **zugzwang**: fill the board so that every square left for your opponent makes them a three. Late in the game, count their *safe* squares — when they run out, they must lose.' },
        ],
      },
      {
        title: 'Trainer', icon: '🎯',
        steps: [
          { title: 'Complete the four', body: 'You have ✕ ✕ _ ✕ along the second row. **Click the gap** to make four in a row and win — jumping straight past the losing three.',
            setup: '{"turn":0,"board":[null,null,null,null,null,0,0,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]}',
            challenge: { prompt: 'You to play — complete four in a row.', solution: ['✕ c4'], success: 'Filling the gap makes four in a row at once — a win — without ever forming a losing three. Always build fours through a gap.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — celebrating double threats and warning when a move walks you into a three. Squava rewards cold counting over instinct; step up the difficulty and trap the Owl.' },
        ],
      },
    ],
  },
};

export default def;
