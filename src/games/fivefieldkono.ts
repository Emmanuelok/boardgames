import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Five Field Kono (오밭고누) — a traditional Korean race game on a 5×5 board.
 * Each side has seven stones; you may only ever move a stone **one step
 * diagonally** onto an empty cell, and there are no captures. The goal is a pure
 * transposition: be first to march all of your stones onto the cells the
 * opponent started on. Because the two armies must squeeze past each other with
 * no way to remove a blocker, it is a subtle game of tempo and traffic control.
 *
 * index = row*5 + col, row 0 is the top. Player 0 = Blue (top, first),
 * Player 1 = Orange (bottom).
 */

const N = 5;
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (i: number) => `${'abcde'[i % N]}${N - Math.floor(i / N)}`;
const DIAG: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const DRAW_PLY = 200; // a captureless race can stall; bound it as a draw

// Starting cells: a full back row plus the two outer cells of the next row (7 each).
const START0 = [0, 1, 2, 3, 4, 5, 9];          // top
const START1 = [15, 19, 20, 21, 22, 23, 24];   // bottom
const GOAL = [new Set(START1), new Set(START0)]; // player p aims to fill the opponent's start

export interface KonoState {
  board: (Player | null)[]; // 25 cells
  turn: Player;
  ply: number;
}
interface KonoMove extends MoveBase {}

function reached(board: (Player | null)[], p: Player): boolean {
  const goal = GOAL[p];
  let n = 0;
  for (const cell of goal) if (board[cell] === p) n++;
  return n === goal.size; // all seven of the opponent's start cells held by p
}
function winnerOf(board: (Player | null)[]): Player | null {
  if (reached(board, 0)) return 0;
  if (reached(board, 1)) return 1;
  return null;
}

function genMoves(s: KonoState): KonoMove[] {
  if (winnerOf(s.board) !== null) return [];
  const out: KonoMove[] = [];
  for (let i = 0; i < N * N; i++) {
    if (s.board[i] !== s.turn) continue;
    const r = Math.floor(i / N), c = i % N;
    for (const [dr, dc] of DIAG) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && s.board[idx(nr, nc)] === null) {
        const to = idx(nr, nc);
        out.push({ id: `${i}-${to}`, from: i, to, notation: `${sq(i)}-${sq(to)}` });
      }
    }
  }
  return out;
}

function legalMoves(s: KonoState, from?: number | null): KonoMove[] {
  const all = genMoves(s);
  return from == null ? all : all.filter((m) => m.from === from);
}

function apply(s: KonoState, m: KonoMove): KonoState {
  const board = s.board.slice();
  board[m.from!] = null;
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player, ply: s.ply + 1 };
}

/** Stones on their goal for a side, for the tutor / eval. */
function onGoal(board: (Player | null)[], p: Player): number {
  let n = 0;
  for (const cell of GOAL[p]) if (board[cell] === p) n++;
  return n;
}

const ON_GOAL = 50, ROW = 5;
export function evaluate(s: KonoState): number {
  const w = winnerOf(s.board);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  if (genMoves(s).length === 0) return s.turn === 0 ? -WIN : WIN; // side to move is stuck → loses
  let score = 0;
  for (let i = 0; i < N * N; i++) {
    const p = s.board[i];
    if (p === null) continue;
    const r = Math.floor(i / N);
    if (p === 0) score += r * ROW + (GOAL[0].has(i) ? ON_GOAL : 0);      // Blue marches downward
    else score -= (N - 1 - r) * ROW + (GOAL[1].has(i) ? ON_GOAL : 0);    // Orange marches upward
  }
  return score;
}

const DEPTH: Record<Difficulty, number> = { tutor: 5, easy: 1, medium: 2, hard: 4, master: 5 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.8, medium: 0.4, hard: 0.1, master: 0 };

function searchAdapter() {
  return {
    getLegalMoves: (s: KonoState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: KonoState) => s.turn,
    isTerminal: (s: KonoState) => winnerOf(s.board) !== null || s.ply >= DRAW_PLY || genMoves(s).length === 0,
    evaluate,
    order: (_s: KonoState, m: KonoMove) => Math.floor(m.to / N), // forward moves first
  };
}

const def: GameDefinition<KonoState, KonoMove> = {
  id: 'five-field-kono',
  name: 'Five Field Kono',
  tagline: 'Slide your seven stones diagonally and swap sides — first to reach the far camp wins.',
  blurb:
    'A traditional Korean strategy game (오밭고누) with a deceptively pure goal: move every one of your seven stones across to the squares your opponent started on. The only move is a single diagonal step onto an empty cell, and nothing is ever captured — so the whole battle is one of traffic. Two armies have to thread past each other through a 5×5 board with no way to remove a stone in the way, which turns the race into a tense, blockade-and-tempo puzzle.',
  category: 'Abstract',
  depth: 3,
  emoji: '🪨',
  accent: '#3b82f6',
  players: [
    { id: 0, name: 'Blue', short: 'B', color: '#3b82f6' },
    { id: 1, name: 'Orange', short: 'O', color: '#f97316' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'disc', showCoordinates: true, checkered: true },
  evalScale: 200,

  createInitialState() {
    const board: (Player | null)[] = Array(N * N).fill(null);
    for (const i of START0) board[i] = 0;
    for (const i of START1) board[i] = 1;
    return { board, turn: 0, ply: 0 };
  },
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, ply: s.ply }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `fk${i}-${p}`, kind: 'man', player: p },
    }));
    return { rows: N, cols: N, cells, fileLabels: ['a', 'b', 'c', 'd', 'e'], rankLabels: ['5', '4', '3', '2', '1'] };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s.board);
    if (w !== null) return { kind: 'win', winner: w, reason: 'reached the far camp' };
    if (genMoves(s).length === 0) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent is blocked in' };
    if (s.ply >= DRAW_PLY) return { kind: 'draw', reason: 'neither army could break through' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (s.ply * 31 + s.turn + 1) * 2654435761;
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
    const goalBefore = onGoal(before.board, mover);
    const goalAfter = onGoal(after.board, mover);
    const movingForward = mover === 0 ? Math.floor(move.to / N) > Math.floor(move.from! / N) : Math.floor(move.to / N) < Math.floor(move.from! / N);

    if (won) insights.push({ tag: 'Race won!', detail: `All seven stones have reached the far camp — ${def.players[mover].name} wins.`, tone: 'good' });
    if (goalAfter > goalBefore) insights.push({ tag: 'Into camp', detail: 'Lands a stone on one of the goal squares.', tone: 'good' });
    else if (movingForward) insights.push({ tag: 'Advances', detail: 'Steps a stone closer to the far side.', tone: 'good' });
    else insights.push({ tag: 'Sidesteps', detail: 'A lateral or backward step — sometimes needed to clear traffic, but it costs tempo.', tone: 'info' });
    if (genMoves(after).length === 0 && !won) insights.push({ tag: 'Self-block', detail: 'Leaves you with no move — avoid stalling your own army.', tone: 'bad' });
    if (principles.length === 0) principles.push('It is a race: advance your rearmost stones and keep lanes open — you can never capture a blocker.');

    const winningBig = Math.abs(playedForMover) > 120;
    const band = won ? 'best' : gradeByLoss(loss, winningBig);
    const summary = won ? `${def.players[mover].name} completes the crossing and wins!`
      : goalAfter > goalBefore ? `${def.players[mover].name} brings a stone home with ${move.notation}.`
      : `${def.players[mover].name} plays ${move.notation}.`;
    const better = loss > 30 && res.move && res.move.id !== move.id ? `A faster move was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.hard);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const won = winnerOf(after.board) === s.turn;
    const text = won ? `${res.move.notation} brings the last stone home — play it to win!`
      : onGoal(after.board, s.turn) > onGoal(s.board, s.turn) ? `${res.move.notation} lands a stone in the far camp.`
      : `${res.move.notation} makes the fastest progress across.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Five Field Kono is one of a family of traditional Korean "kono" board games. Despite the warlike look of two armies facing off, nothing is ever captured — the entire contest is a race to change places. Its charm is in the constraint: a stone may only ever step one square **diagonally**, so each stone is locked to squares of a single colour, and the two sides must interleave and pass through one another with no way to clear a stone that gets in the way.',
    objective:
      'Be the first to move all seven of your stones onto the seven squares your opponent started on. You and your opponent take turns; on your turn you slide one stone one step diagonally onto an empty square. There is no jumping, no capturing and no placing — just the diagonal step. Because the goal squares begin full of enemy stones, you can only move in as they move out, so timing and lane-management decide the race (and a careful game can end in a draw).',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The armies', body: 'On a **5×5 board**, each side has **seven stones**. **Blue** starts along the top — the whole top row plus the two outer squares of the second row — and **Orange** mirrors it along the bottom. The middle of the board starts empty. **Blue moves first.**', highlight: [0, 1, 2, 3, 4, 5, 9] },
          { title: 'The only move: a diagonal step', body: 'On your turn you move **one** stone **one square diagonally** onto an **empty** square. That is the only move there is — never straight, never two squares, never onto an occupied square. A stone therefore always stays on squares of the same colour.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"ply":2}', highlight: [12], arrows: [{ from: 12, to: 6, tone: 'good' }, { from: 12, to: 18, tone: 'good' }] },
          { title: 'No captures, ever', body: 'You can never remove or jump an opposing stone — if a square you want is occupied, you must go around. This is the heart of the game: a single enemy stone parked in a key diagonal can dam up a whole lane.' },
          { title: 'How to win', body: 'You win the moment **all seven of your stones occupy your opponent’s seven starting squares**. Blue is racing to the bottom camp, Orange to the top. Since those squares begin full of the enemy, you can only fill them as the enemy vacates — so the armies must trade places.', highlight: [15, 19, 20, 21, 22, 23, 24] },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'It is a race — push forward', body: 'Every diagonal step toward the far side is progress; every sideways or backward step is lost tempo. Favour advancing your **rearmost** stones so the whole army flows across together, rather than rushing one stone ahead where it can be blocked.' },
          { title: 'Keep your lanes open', body: 'Because nothing can be captured, a clogged diagonal stays clogged. Watch for your own stones colliding, and try not to leave a stone where it must later wait for an enemy to move. Whoever manages the traffic better usually wins the crossing.' },
          { title: 'Two colours, two races', body: 'A stone never changes square-colour, so really you are running **two independent little races** at once — one on the light diagonals, one on the dark. Make sure both halves of your army keep moving; a colour that falls behind will lose you the game even if the other races ahead.' },
          { title: "Don't stall yourself", body: 'If it ever becomes your turn and **no stone can step diagonally to an empty square**, you are blocked in and lose. With a captureless game this is a real danger in a jam — always keep at least one free diagonal in reserve.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          {
            title: 'Bring the last one home',
            body: 'You are **Blue**, racing to the bottom camp. Six of your stones are already on their goal squares; one straggler sits just above the last empty goal square. **Click that stone, then step it diagonally into the camp** to win the race.',
            setup: '{"board":[null,null,null,null,null,null,1,1,1,null,null,0,1,null,null,null,1,1,1,0,0,0,0,0,0],"turn":0,"ply":18}',
            challenge: {
              prompt: 'Blue to play — land the seventh stone in the far camp.',
              solution: ['b3-a2'],
              success: 'Stepping b3→a2 fills the last goal square, so all seven Blue stones now sit on Orange’s start — the crossing is complete and Blue wins. Note only that straggler could do it: moving a stone already in camp would just empty a goal square again.',
            },
          },
          {
            title: 'Keep training',
            body: 'In a real game the tutor grades **every** step — rewarding stones that reach the far camp or advance, and flagging tempo-losing sidesteps or moves that jam your own lanes — while the evaluation bar tracks who is winning the crossing. On **Master** the AI manages its traffic perfectly, so out-tempo it to break through.',
          },
        ],
      },
    ],
  },
};

export default def;
