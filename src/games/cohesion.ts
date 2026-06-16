import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Cohesion — an ORIGINAL game designed for this center. On a 6×6 board players
 * take turns placing one stone of their colour on any empty cell. There is no
 * capture; the board simply fills. When it is full, each player's score is the
 * size of their single LARGEST orthogonally-connected cluster of stones, and the
 * bigger cluster wins. So every move is a tug-of-war: extend your own blob while
 * cutting your opponent's apart. (A knockout: reach a cluster of 14 and you win
 * at once.) Pure logic, nothing mutates its arguments.
 */

const N = 6;
const WIN_BIG = 100000;
const KNOCKOUT = 14;
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;

export interface CohesionState { board: (Player | null)[]; turn: Player } // N*N cells
interface CoMove extends MoveBase {}

export function initialState(): CohesionState {
  return { board: Array(N * N).fill(null), turn: 0 };
}

const isFull = (b: (Player | null)[]) => b.every((v) => v !== null);

/** Size of the largest 4-connected cluster of `p`'s stones. */
export function largestCluster(board: (Player | null)[], p: Player): number {
  const seen = new Uint8Array(N * N);
  let best = 0;
  for (let start = 0; start < N * N; start++) {
    if (board[start] !== p || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      const r = Math.floor(cur / N), c = cur % N;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (!inB(nr, nc)) continue;
        const ni = nr * N + nc;
        if (board[ni] === p && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (size > best) best = size;
  }
  return best;
}

function legalMoves(s: CohesionState): CoMove[] {
  if (winnerOf(s) !== null) return [];
  const out: CoMove[] = [];
  const tag = s.turn === 0 ? 'Teal' : 'Rose';
  for (let i = 0; i < N * N; i++) {
    if (s.board[i] === null) out.push({ id: `p${i}`, to: i, notation: `${tag} ${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}` });
  }
  return out;
}

function apply(s: CohesionState, m: CoMove): CohesionState {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

function winnerOf(s: CohesionState): Player | 'draw' | null {
  const a = largestCluster(s.board, 0), b = largestCluster(s.board, 1);
  if (a >= KNOCKOUT && a > b) return 0;
  if (b >= KNOCKOUT && b > a) return 1;
  if (isFull(s.board)) return a > b ? 0 : b > a ? 1 : 'draw';
  return null;
}

export function evaluate(s: CohesionState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN_BIG;
  if (w === 1) return -WIN_BIG;
  if (w === 'draw') return 0;
  return largestCluster(s.board, 0) - largestCluster(s.board, 1); // + favours player 0
}

const DEPTH: Record<Difficulty, number> = { tutor: 3, easy: 1, medium: 2, hard: 3, master: 4 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.85, medium: 0.4, hard: 0.1, master: 0 };

function adapter() {
  return {
    getLegalMoves: legalMoves,
    applyMove: apply,
    getTurn: (s: CohesionState) => s.turn,
    isTerminal: (s: CohesionState) => winnerOf(s) !== null,
    evaluate,
  };
}

const def: GameDefinition<CohesionState, CoMove> = {
  id: 'cohesion',
  name: 'Cohesion',
  tagline: 'An original: grow your biggest connected cluster while you cut your rival’s apart.',
  blurb:
    'A game we designed for this center. No captures, no lines — just a tug-of-war over connection. Each turn you drop a stone, and when the board is full the player with the single largest connected cluster wins. Every placement does double duty: it can extend your own group or sever your opponent’s, and the best moves do both at once. Quiet on the surface, sharp underneath.',
  category: 'Abstract',
  depth: 3,
  emoji: '🟢',
  accent: '#14b8a6',
  players: [
    { id: 0, name: 'Teal', short: 'T', color: '#14b8a6' },
    { id: 1, name: 'Rose', short: 'R', color: '#f43f5e' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },
  evalScale: 7,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `co${i}-${p}`, kind: 'stone', player: p },
    }));
    return {
      rows: N, cols: N, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f'],
      rankLabels: ['6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s);
    if (w === 'draw') return { kind: 'draw', reason: 'equal largest clusters' };
    if (w !== null) return { kind: 'win', winner: w, reason: `the largest cluster (${largestCluster(s.board, w)} stones)` };
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
    const myBefore = largestCluster(before.board, mover), myAfter = largestCluster(after.board, mover);
    const oppBefore = largestCluster(before.board, (mover ^ 1) as Player), oppAfter = largestCluster(after.board, (mover ^ 1) as Player);
    const w = winnerOf(after);

    if (w === mover) insights.push({ tag: 'Knockout!', detail: `A cluster of ${myAfter} — that wins outright.`, tone: 'good' });
    if (myAfter > myBefore + 1) insights.push({ tag: 'Merge', detail: `Joins groups into one cluster of ${myAfter} — a big jump.`, tone: 'good' });
    else if (myAfter > myBefore) insights.push({ tag: 'Extend', detail: `Grows your largest cluster to ${myAfter}.`, tone: 'good' });
    else insights.push({ tag: 'Stake', detail: 'Claims a square that does not yet touch your main group — useful for blocking or future growth.', tone: 'info' });
    if (oppAfter < oppBefore) insights.push({ tag: 'Cut!', detail: `Splits the opponent’s cluster down from ${oppBefore} to ${oppAfter}.`, tone: 'good' });
    if (principles.length === 0) principles.push('The best stone does two jobs: it grows your cluster AND fits where it cramps your opponent’s.');

    const winningBig = Math.abs(moverPlayed) > 4;
    const band = w === mover ? 'best' : gradeByLoss(Math.round(loss * 40), winningBig);
    const summary = w === mover ? `${def.players[mover].name} reaches a cluster of ${myAfter} and wins!`
      : oppAfter < oppBefore ? `${def.players[mover].name} cuts and plays ${move.notation.split(' ')[1]}.`
      : `${def.players[mover].name} plays ${move.notation.split(' ')[1]} (cluster ${myAfter}).`;
    const better = loss >= 2 && res.move && res.move.id !== move.id ? `Bigger was ${res.move.notation.split(' ')[1]}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, adapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const sq = res.move.notation.split(' ')[1];
    const my = largestCluster(after.board, s.turn), oppNow = largestCluster(after.board, (s.turn ^ 1) as Player), oppBefore = largestCluster(s.board, (s.turn ^ 1) as Player);
    const text = oppNow < oppBefore ? `${sq} grows your cluster and cuts the opponent — the ideal double move.`
      : `${sq} extends your largest cluster to ${my}.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Cohesion is an original game built for this center — you will not find it elsewhere. It strips strategy down to a single idea: connection. There is no capturing and no race to a line. You and your opponent simply fill the board one stone at a time, and at the end the player whose stones form the single largest connected blob wins. It looks placid, but because every empty square is contested for both its growing value to you and its cutting value against your opponent, the decisions are surprisingly tense.',
    objective:
      'When the 6×6 board is full, your score is the size of your **largest orthogonally-connected cluster** — a group of your stones all joined edge-to-edge. The bigger cluster wins (equal clusters draw). You can also win instantly by building a cluster of **14**. So aim to grow one big, solid group of your own while breaking your opponent’s stones into small, disconnected pieces.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'Placing stones', body: 'On your turn, place **one stone** of your colour on **any empty square**. That is the whole move — there is no moving or capturing. Teal goes first; players alternate until the board is full.' },
          { title: 'What counts as a cluster', body: 'A **cluster** is a set of your stones connected **edge-to-edge** (up/down/left/right — diagonals do **not** connect). Your score is the size of your single biggest cluster, not your total number of stones. The four highlighted Teal stones form one cluster of 4.', setup: '{"board":[null,null,null,null,null,null,null,0,0,null,null,null,null,null,0,0,1,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [7, 8, 14, 15] },
          { title: 'Winning', body: 'When all 36 squares are filled, the player with the **larger** largest-cluster wins; equal sizes draw. Reaching a cluster of **14** wins immediately. So one big connected group beats several scattered ones, even if they add up to more stones.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Grow and cut at once', body: 'The strongest stones do **two jobs**: they extend your own cluster *and* sit where they stop your opponent’s from joining up. Always look for the square that does both.' },
          { title: 'Bridge your groups', body: 'A single stone placed in the right gap can **merge two of your groups** into one much larger cluster — a sudden jump in score. Watch for these bridging squares (and deny them to your opponent).' },
          { title: 'Fight for the centre', body: 'Central stones have four neighbours and connect in every direction, so they are the easiest to build a big blob around. Edge and corner stones are worth less for cohesion.' },
          { title: 'Sever, don’t chase', body: 'You rarely need to surround the opponent — just slip a stone into the **one gap** their cluster needs to grow through. Keeping their biggest group small is as good as making yours big.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          { title: 'Bridge to win', body: 'Time to play. **Click the empty square** that bridges your two Teal groups into one cluster of 14 — an instant knockout.', setup: '{"board":[0,0,0,0,0,0,0,null,null,null,null,1,null,null,null,null,null,1,0,0,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}',
            challenge: { prompt: 'Teal to play — merge into a winning cluster.', solution: ['Teal a4'], success: 'That single stone joins both groups into one cluster of 14 — an instant win. Bridging squares are the most valuable on the board.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — rewarding merges and cuts, flagging stranded stones — while the evaluation bar tracks whose cluster is ahead. Step up the difficulty and try to out-connect the engine.' },
        ],
      },
    ],
  },
};

export default def;
