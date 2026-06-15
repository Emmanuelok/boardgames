import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Kōnane — Hawaiian checkers, an ancient game of pure capture. The board starts
 * packed with black and white stones in a checkerboard pattern; the opening (two
 * stones lifted from the centre) is pre-applied so play begins with the captures.
 * A stone jumps ORTHOGONALLY over an adjacent enemy into the empty square beyond,
 * removing it, and may continue jumping enemies IN THE SAME STRAIGHT LINE. The
 * player who cannot make a capture loses (last to move wins). Because every move
 * removes a stone, a game always ends — and a perfect engine never stalls.
 *
 * Indexing matches chess: index = row*8 + col, row 0 is the top.
 * Player 0 = Black (moves first); Player 1 = White.
 */

const N = 8;
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;
const ORTHO: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export interface KonaneState {
  board: (Player | null)[]; // 64 cells; null = empty
  turn: Player;
}
interface KonaneMove extends MoveBase {}

export function initialState(): KonaneState {
  const board: (Player | null)[] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) board[idx(r, c)] = (r + c) % 2 === 0 ? 0 : 1;
  board[idx(4, 3)] = null; // the two-stone opening, pre-applied at the centre
  board[idx(4, 4)] = null;
  return { board, turn: 0 };
}

/** All capturing moves for `color`: orthogonal jumps, continuing in a straight line. */
function genMoves(board: (Player | null)[], color: Player): KonaneMove[] {
  const enemy = (color ^ 1) as Player;
  const out: KonaneMove[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[idx(r, c)] !== color) continue;
      const from = idx(r, c);
      for (const [dr, dc] of ORTHO) {
        let rr = r, cc = c;
        const caps: number[] = [];
        while (true) {
          const mr = rr + dr, mc = cc + dc, lr = rr + 2 * dr, lc = cc + 2 * dc;
          if (!inB(lr, lc) || board[idx(mr, mc)] !== enemy || board[idx(lr, lc)] !== null) break;
          caps.push(idx(mr, mc));
          out.push({ id: `${from}-${idx(lr, lc)}`, from, to: idx(lr, lc), capture: true, affected: caps.slice(), notation: `${sq(from)}x${sq(idx(lr, lc))}` });
          rr = lr; cc = lc; // continue jumping in the same direction
        }
      }
    }
  }
  return out;
}

function legalMoves(s: KonaneState, from?: number | null): KonaneMove[] {
  const all = genMoves(s.board, s.turn);
  return from == null ? all : all.filter((m) => m.from === from);
}

function apply(s: KonaneState, m: KonaneMove): KonaneState {
  const board = s.board.slice();
  board[m.from!] = null;
  for (const c of m.affected!) board[c] = null;
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

function stoneCount(board: (Player | null)[], p: Player): number {
  let n = 0;
  for (const v of board) if (v === p) n++;
  return n;
}

export function evaluate(s: KonaneState): number {
  const m0 = genMoves(s.board, 0).length, m1 = genMoves(s.board, 1).length;
  if (s.turn === 0 && m0 === 0) return -WIN; // Black to move but stuck → Black loses
  if (s.turn === 1 && m1 === 0) return WIN;
  // Mobility is everything in Kōnane: you win by leaving the opponent no move.
  return (m0 - m1) * 8 + (stoneCount(s.board, 0) - stoneCount(s.board, 1));
}

const DEPTH: Record<Difficulty, number> = { tutor: 4, easy: 1, medium: 3, hard: 4, master: 5 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.6, medium: 0.25, hard: 0.05, master: 0 };

function searchAdapter() {
  return {
    getLegalMoves: (s: KonaneState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: KonaneState) => s.turn,
    isTerminal: (s: KonaneState) => genMoves(s.board, s.turn).length === 0,
    evaluate,
    order: (_s: KonaneState, m: KonaneMove) => m.affected!.length, // longer captures first
  };
}

const def: GameDefinition<KonaneState, KonaneMove> = {
  id: 'konane',
  name: 'Kōnane',
  tagline: 'Hawaiian checkers — jump and capture until your opponent has no move left.',
  blurb:
    'An ancient Hawaiian game of pure capture, played by chiefs and commoners for centuries. Stones leap orthogonally over their neighbours, clearing the board one jump at a time. There is no king and no goal square — you win simply by making the last capture, leaving your opponent stranded with nowhere to jump. Behind its simple rules lies a sharp battle for mobility that mathematicians study as a model of combinatorial game theory.',
  category: 'Abstract',
  depth: 3,
  emoji: '🌺',
  accent: '#e11d48',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#111827' },
    { id: 1, name: 'White', short: 'W', color: '#f1f5f9' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'stone', showCoordinates: true, checkered: false },
  evalScale: 150,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `k${i}-${p}`, kind: 'stone', player: p },
    }));
    return {
      rows: N, cols: N, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      rankLabels: ['8', '7', '6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (legalMoves(s, null).length === 0) {
      return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent has no capture left' };
    }
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
    const res = searchBestMove(before, searchAdapter(), DEPTH.tutor);
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const moverPlayed = toMover(evaluate(after));
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : moverPlayed;
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const caps = move.affected!.length;
    const oppMovesAfter = genMoves(after.board, (mover ^ 1) as Player).length;
    const myMovesAfter = genMoves(after.board, mover).length;

    if (oppMovesAfter === 0) insights.push({ tag: 'Game over!', detail: 'The opponent has no capture left — that wins the game.', tone: 'good' });
    if (caps >= 2) insights.push({ tag: `Triple/${caps}× capture`, detail: `Clears ${caps} enemy stones in one straight-line leap.`, tone: 'good' });
    else insights.push({ tag: 'Capture', detail: 'Removes an enemy stone — every Kōnane move is a capture.', tone: 'info' });
    if (myMovesAfter > oppMovesAfter) { insights.push({ tag: 'Mobility', detail: 'Leaves you more replies than your opponent — the key to squeezing them out.', tone: 'good' }); }
    else if (myMovesAfter < oppMovesAfter - 1) { insights.push({ tag: 'Loses tempo', detail: 'The opponent ends with more moves than you — dangerous in the mobility race.', tone: 'bad' }); }
    if (principles.length === 0) principles.push('Count moves, not stones: aim to keep more captures available than your opponent.');

    const winningBig = Math.abs(moverPlayed) > 150;
    const band = oppMovesAfter === 0 ? 'best' : gradeByLoss(loss, winningBig);
    const summary = oppMovesAfter === 0 ? `${def.players[mover].name} makes the last capture and wins!`
      : caps >= 2 ? `${def.players[mover].name} chains a ${caps}-stone capture, ${move.notation}.`
      : `${def.players[mover].name} captures, ${move.notation}.`;
    const better = loss > 16 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    let text: string;
    if (genMoves(after.board, (s.turn ^ 1) as Player).length === 0) text = `${res.move.notation} leaves the opponent with no move — play it to win!`;
    else if (res.move.affected!.length >= 2) text = `${res.move.notation} chains ${res.move.affected!.length} captures and keeps the initiative.`;
    else text = `${res.move.notation} keeps your mobility up — the engine's choice.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Kōnane is the great board game of old Hawaiʻi — Captain Cook’s crew described islanders engrossed in it in 1778, and boards are carved into lava rock across the islands. It is a game of subtraction: the board begins full and empties as you play, every single move a capture. There is no race to a goal and no piece to protect — the entire contest is a duel for *mobility*, and the loser is simply whoever first finds they have no jump to make.',
    objective:
      'Make the last capture. On your turn you must jump one of your stones over an adjacent enemy stone into the empty square beyond, removing the stone you jumped — and you may keep leaping over more enemies in the same straight line. When it is your opponent’s turn and they have no capture available, they lose. So the goal is not to take the most stones but to keep a move in hand while strangling your opponent’s options.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Kōnane starts **completely full** of stones in a checkerboard pattern — black and white alternating. Following tradition, the opening (two adjacent stones lifted from the centre) is already done for you, leaving two empty squares in the middle and **Black to move first**.' },
          { title: 'Jumping', body: 'A move is a **jump**: a stone hops **orthogonally** (never diagonally) over an **adjacent enemy** stone and lands on the **empty square just beyond**, capturing the stone it jumped. You cannot move without capturing.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,null,1,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [36], arrows: [{ from: 34, to: 36, tone: 'good' }] },
          { title: 'Chaining captures', body: 'After a jump you may **continue jumping in the SAME straight line**, hopping over and removing more enemy stones as long as each landing square is empty. You may stop after any jump — but every hop in a single move goes in one unbroken direction. You may not turn corners.' },
          { title: 'Winning', body: 'There is no goal square. You win when, on your opponent’s turn, **they have no legal capture left**. The player who makes the **last move wins**. Because every move removes a stone, the board steadily empties and a game always reaches an end.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Mobility, not material', body: 'Capturing the most stones does **not** win — having the last move does. Judge a position by **how many jumps each side has**, not by who has more stones. Often the right move is the one that preserves *your* options while shrinking your opponent’s.' },
          { title: 'Don’t empty your own lines', body: 'Every capture removes a stone — sometimes one you’ll wish you still had to jump later. Avoid clearing out the area around your own stones; keep enemy targets nearby so you always have a hop available.' },
          { title: 'Make the opponent commit', body: 'Force exchanges in regions where you will be left with the last available jump. Steering the play into a corner of the board where only *you* can move is the classic winning plan.' },
          { title: 'Count to the end', body: 'Late in the game, with few stones left, you can often **count the moves exactly**: if you can see that you will have one more jump than your opponent, the win is yours. Kōnane rewards careful endgame calculation.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          { title: 'Take the last move', body: 'Time to play. **Click your stone, then the empty square beyond the enemy.** Only one capture is on the board — make it, and White is left with no reply at all.', setup: '{"board":[null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,null,null,null,null,null,null],"turn":0}',
            challenge: { prompt: 'Black to play — make a move that leaves White stuck.', solution: ['a1xc1'], success: 'That capture removes White’s last mobile stone, so White has no legal jump and Black — having made the final move — wins.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — rewarding moves that win the mobility race and flagging ones that hand your opponent extra replies, while the evaluation bar tracks who has more jumps in hand. Step the engine up to Master, which never miscounts the endgame.' },
        ],
      },
    ],
  },
};

export default def;
