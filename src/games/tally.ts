import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Tally — an ORIGINAL game designed for this center. On a 7×7 board players take
 * turns placing one stone (no captures). When the board is full, each of the 16
 * "lines" — 7 rows, 7 columns and the 2 long diagonals — is awarded to whoever
 * holds the majority of its squares (7 is odd, so every line has a clear owner).
 * Win the most lines. It is a game of spreading versus concentrating: pour stones
 * into a line to flip it, but every stone you commit is one you can't use to
 * contest somewhere else.
 */

const N = 7;
const WIN_BIG = 100000;

export interface TallyState { board: (Player | null)[]; turn: Player }
interface TallyMove extends MoveBase {}

// The 16 scoring lines: rows, columns, both long diagonals.
const LINES: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < N; r++) out.push(Array.from({ length: N }, (_, c) => r * N + c)); // rows
  for (let c = 0; c < N; c++) out.push(Array.from({ length: N }, (_, r) => r * N + c)); // cols
  out.push(Array.from({ length: N }, (_, i) => i * N + i)); // main diagonal
  out.push(Array.from({ length: N }, (_, i) => i * N + (N - 1 - i))); // anti-diagonal
  return out;
})();

export function initialState(): TallyState {
  return { board: Array(N * N).fill(null), turn: 0 };
}

const isFull = (b: (Player | null)[]) => b.every((v) => v !== null);

/** Lines each player holds by strict majority (board need not be full). */
export function lineScores(board: (Player | null)[]): [number, number] {
  let a = 0, b = 0;
  for (const line of LINES) {
    let p0 = 0, p1 = 0;
    for (const i of line) { if (board[i] === 0) p0++; else if (board[i] === 1) p1++; }
    if (p0 > p1) a++; else if (p1 > p0) b++;
  }
  return [a, b];
}

function legalMoves(s: TallyState): TallyMove[] {
  if (isFull(s.board)) return [];
  const out: TallyMove[] = [];
  const tag = s.turn === 0 ? 'Indigo' : 'Gold';
  for (let i = 0; i < N * N; i++) if (s.board[i] === null) out.push({ id: `p${i}`, to: i, notation: `${tag} ${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}` });
  return out;
}

function apply(s: TallyState, m: TallyMove): TallyState {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

function winnerOf(s: TallyState): Player | 'draw' | null {
  if (!isFull(s.board)) return null;
  const [a, b] = lineScores(s.board);
  return a > b ? 0 : b > a ? 1 : 'draw';
}

export function evaluate(s: TallyState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN_BIG;
  if (w === 1) return -WIN_BIG;
  if (w === 'draw') return 0;
  // Net "lean": +1 for each line currently held by player 0, −1 for player 1.
  const [a, b] = lineScores(s.board);
  return a - b;
}

const DEPTH: Record<Difficulty, number> = { tutor: 2, easy: 1, medium: 2, hard: 2, master: 3 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.85, medium: 0.4, hard: 0.1, master: 0 };

function adapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove: apply,
    getTurn: (s: TallyState) => s.turn,
    isTerminal: (s: TallyState) => isFull(s.board),
    evaluate,
  };
}

const def: GameDefinition<TallyState, TallyMove> = {
  id: 'tally',
  name: 'Tally',
  tagline: 'An original: hold the majority in the most rows, columns and diagonals.',
  blurb:
    'A game we designed for this center — an elegant battle of spreading versus concentrating. You and your opponent fill a 7×7 board one stone at a time, and at the end every row, column and long diagonal goes to whoever holds the majority of its squares. Win the most lines. Pour stones into one line to seize it, and you starve your contest of the next — the whole game is about where to commit and where to let go.',
  category: 'Abstract',
  depth: 3,
  emoji: '⊞',
  accent: '#6366f1',
  players: [
    { id: 0, name: 'Indigo', short: 'I', color: '#6366f1' },
    { id: 1, name: 'Gold', short: 'G', color: '#eab308' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },
  evalScale: 5,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `ta${i}-${p}`, kind: 'disc', player: p },
    }));
    return {
      rows: N, cols: N, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      rankLabels: ['7', '6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s);
    if (w === 'draw') return { kind: 'draw', reason: 'the lines split evenly' };
    if (w !== null) { const [a, b] = lineScores(s.board); return { kind: 'win', winner: w, reason: `won ${w === 0 ? a : b} of 16 lines` }; }
    return { kind: 'playing' };
  },

  getLegalMoves: (s) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (s.board.filter((v) => v !== null).length + s.turn + 1) * 2654435761;
    return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const res = searchBestMove(before, adapter(), DEPTH.tutor);
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const moverPlayed = toMover(evaluate(after));
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : moverPlayed;
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const [a0, b0] = lineScores(before.board), [a1, b1] = lineScores(after.board);
    const myGain = (mover === 0 ? a1 - a0 : b1 - b0);
    const oppDrop = (mover === 0 ? b0 - b1 : a0 - a1);
    const w = winnerOf(after);

    if (w === mover) insights.push({ tag: 'Board full — you win!', detail: `You hold the majority in more lines.`, tone: 'good' });
    if (myGain > 0) insights.push({ tag: 'Seizes a line', detail: `Tips ${myGain} line${myGain > 1 ? 's' : ''} into your majority.`, tone: 'good' });
    if (oppDrop > 0) insights.push({ tag: 'Contests', detail: `Pulls ${oppDrop} line${oppDrop > 1 ? 's' : ''} back from your opponent.`, tone: 'good' });
    if (insights.length === 0) insights.push({ tag: 'Develops', detail: 'A stone that builds toward majorities without committing too hard yet.', tone: 'info' });
    principles.push('A square at the crossing of a row, a column AND a diagonal fights for three lines at once — those are gold.');

    const winningBig = Math.abs(moverPlayed) > 4;
    const band = w === mover ? 'best' : gradeByLoss(Math.round(loss * 50), winningBig);
    const summary = w === mover ? `${def.players[mover].name} takes the most lines and wins!`
      : `${def.players[mover].name} plays ${move.notation.split(' ')[1]}${myGain || oppDrop ? ` (${a1}–${b1} lines)` : ''}.`;
    const better = loss >= 2 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation.split(' ')[1]}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, adapter(), DEPTH.tutor);
    if (!res.move) return null;
    const sq = res.move.notation.split(' ')[1];
    const [a, b] = lineScores(apply(s, res.move).board);
    return { move: res.move, text: `${sq} is the engine's choice — it pushes the line count toward ${a}–${b}.` };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Tally is an original game built for this center. It takes the simplest possible action — place a stone on an empty square — and hangs a whole strategy off how the board is scored at the end. There is no capturing and no line to complete mid-game; instead the tension is purely about *allocation*. Every line on the board is a little election, decided by majority, and you only have so many votes to spread among them.',
    objective:
      'Fill the 7×7 board, then count the lines. Each of the 7 rows, 7 columns and 2 long diagonals — 16 lines in all — is won by whoever holds **more** of its seven squares (seven is odd, so there are no tied lines). Whoever wins **more lines overall** wins the game; an 8–8 split is a draw. The art is deciding which lines to fight for and which to concede, since every stone committed to one line is denied to another.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'Placing stones', body: 'On your turn, place **one stone** of your colour on any empty square. No moving, no capturing — Indigo goes first and players alternate until all 49 squares are filled.' },
          { title: 'Scoring the lines', body: 'When the board is full, look at all **16 lines**: the 7 rows, the 7 columns, and the 2 long diagonals. Each line is **won by whoever holds at least 4 of its 7 squares**. Because 7 is odd, every line has a definite winner. The highlighted row below holds **4 Indigo and 3 Gold** — so Indigo carries it, regardless of the order.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,0,1,0,1,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [21, 22, 23, 24, 25, 26, 27] },
          { title: 'Winning', body: 'Add up the lines. Whoever **won more lines** wins the game. 8 lines each is a draw. It does not matter how the rest of your stones are arranged — only who carried each line.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Four is enough', body: 'You only need **4 of 7** to win a line — the other 3 squares are wasted votes. Aim to win lines **4–3**, not 7–0. Spreading your strength to win many lines narrowly beats burying it to win a few hugely.' },
          { title: 'Crossings are gold', body: 'The centre square sits on a row, a column **and** both diagonals — up to four lines at once. Squares on a diagonal pull double duty. Fight hardest for the intersections that contest the most lines.' },
          { title: 'Block and concede', body: 'If your opponent already holds 4 of a line, it is **lost** — stop spending stones there and contest elsewhere. Equally, deny them a 4th stone in lines that are still 3–3. Knowing when to concede is half the game.' },
          { title: 'Count to the finish', body: 'Late on, the result is pure arithmetic: tally the lines already decided and the ones still in the balance, and steer your last stones to the lines that swing the count. Tally rewards cold counting over flashy play.' },
        ],
      },
    ],
  },
};

export default def;
