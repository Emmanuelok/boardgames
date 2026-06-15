import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Clobber (Albert, Grossman & Nowakowski, 2001) — a pure combinatorial game on
 * a 6×6 board that starts completely filled with stones in a checkerboard
 * pattern. A move: pick one of YOUR stones and move it onto an orthogonally
 * adjacent ENEMY stone, "clobbering" (removing) it and taking its square. The
 * player who cannot move loses — last to move wins. Every move removes a stone,
 * so the board only empties and the game always ends.
 *
 * Indexing: index = row*COLS + col, row 0 is the top.
 * Player 0 = Black (moves first); Player 1 = White.
 */

const ROWS = 6, COLS = 6;
const inB = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const idx = (r: number, c: number) => r * COLS + c;
const sq = (i: number) => `${String.fromCharCode(97 + (i % COLS))}${ROWS - Math.floor(i / COLS)}`;
const ORTHO: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export interface ClobberState {
  board: (Player | null)[]; // ROWS*COLS cells; null = empty
  turn: Player;
}
interface ClobberMove extends MoveBase {}

export function initialState(): ClobberState {
  const board: (Player | null)[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) board[idx(r, c)] = (r + c) % 2 === 0 ? 0 : 1;
  return { board, turn: 0 };
}

/** Every clobber for `color`: step onto an orthogonally adjacent enemy stone. */
function genMoves(board: (Player | null)[], color: Player): ClobberMove[] {
  const enemy = (color ^ 1) as Player;
  const out: ClobberMove[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[idx(r, c)] !== color) continue;
      const from = idx(r, c);
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr, nc = c + dc;
        if (inB(nr, nc) && board[idx(nr, nc)] === enemy) {
          const to = idx(nr, nc);
          out.push({ id: `${from}-${to}`, from, to, capture: true, affected: [to], notation: `${sq(from)}x${sq(to)}` });
        }
      }
    }
  }
  return out;
}

function legalMoves(s: ClobberState, from?: number | null): ClobberMove[] {
  const all = genMoves(s.board, s.turn);
  return from == null ? all : all.filter((m) => m.from === from);
}

function apply(s: ClobberState, m: ClobberMove): ClobberState {
  const board = s.board.slice();
  board[m.from!] = null;
  board[m.to] = s.turn; // the clobbered enemy is replaced by your stone
  return { board, turn: (s.turn ^ 1) as Player };
}

export function evaluate(s: ClobberState): number {
  const m0 = genMoves(s.board, 0).length, m1 = genMoves(s.board, 1).length;
  if (s.turn === 0 && m0 === 0) return -WIN; // Black to move but stuck → Black loses
  if (s.turn === 1 && m1 === 0) return WIN;
  return (m0 - m1) * 5; // mobility is the whole game: strand your opponent
}

// Clobber's full opening has ~60 moves; depth grows brutally there, so cap it
// (games are short — branching collapses fast as the board empties).
const DEPTH: Record<Difficulty, number> = { tutor: 3, easy: 1, medium: 2, hard: 3, master: 4 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.6, medium: 0.3, hard: 0.08, master: 0 };

function searchAdapter() {
  return {
    getLegalMoves: (s: ClobberState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: ClobberState) => s.turn,
    isTerminal: (s: ClobberState) => genMoves(s.board, s.turn).length === 0,
    evaluate,
  };
}

const def: GameDefinition<ClobberState, ClobberMove> = {
  id: 'clobber',
  name: 'Clobber',
  tagline: 'Clobber a neighbour, take its square — make the last capture to win.',
  blurb:
    'A razor-sharp modern abstract loved by combinatorial-game theorists. The board begins packed with black and white stones; on your turn you slide one of your stones onto an adjacent enemy and clobber it off the board. No territory, no goal square — you simply want to make the final move while your opponent runs out of neighbours to attack. Short, brutal and deceptively deep, it splits into independent skirmishes you must value and add up.',
  category: 'Abstract',
  depth: 3,
  emoji: '💥',
  accent: '#8b5cf6',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#111827' },
    { id: 1, name: 'White', short: 'W', color: '#f1f5f9' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },
  evalScale: 45,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / COLS), col: i % COLS,
      piece: p === null ? null : { id: `cl${i}-${p}`, kind: 'man', player: p },
    }));
    return {
      rows: ROWS, cols: COLS, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f'],
      rankLabels: ['6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (legalMoves(s, null).length === 0) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent has no move left' };
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
    const myAfter = genMoves(after.board, mover).length;
    const oppAfter = genMoves(after.board, (mover ^ 1) as Player).length;

    if (oppAfter === 0) insights.push({ tag: 'Game over!', detail: 'The opponent has no clobber left — you made the last move and win.', tone: 'good' });
    insights.push({ tag: 'Clobber', detail: 'Removes an enemy stone and takes its square.', tone: 'info' });
    if (myAfter > oppAfter) insights.push({ tag: 'Mobility', detail: 'Leaves you with more moves than your opponent — the heart of Clobber.', tone: 'good' });
    else if (myAfter < oppAfter - 1) insights.push({ tag: 'Loses tempo', detail: 'The opponent ends with more replies than you — risky.', tone: 'bad' });
    if (principles.length === 0) principles.push('Win the move count, not the stone count: leave yourself a reply when your opponent has none.');

    const winningBig = Math.abs(moverPlayed) > 60;
    const band = oppAfter === 0 ? 'best' : gradeByLoss(loss, winningBig);
    const summary = oppAfter === 0 ? `${def.players[mover].name} makes the last clobber and wins!` : `${def.players[mover].name} clobbers, ${move.notation}.`;
    const better = loss > 12 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const text = genMoves(after.board, (s.turn ^ 1) as Player).length === 0
      ? `${res.move.notation} leaves the opponent with no move — play it to win!`
      : `${res.move.notation} keeps your mobility ahead of the opponent's.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Clobber was invented in 2001 by Michael Albert, J.P. Grossman and Richard Nowakowski and is a darling of combinatorial game theory. It could not be simpler to state — push a stone onto a neighbouring enemy and knock it off — yet it hides surprising depth, because a Clobber position naturally breaks into several disconnected little battles, and a strong player must value each one and add them together to see who will run out of moves first.',
    objective:
      'Make the last move. On your turn you must move one of your stones onto an orthogonally adjacent enemy stone, removing that enemy and occupying its square. When it becomes your opponent’s turn and none of their stones sits next to an enemy, they cannot move and they lose. So the aim is not to capture the most stones — it is to keep a move in hand for the moment your opponent has none.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Clobber starts on a **6×6 board completely filled** with stones in a checkerboard pattern — every black stone touches only white stones and vice-versa. **Black moves first.**' },
          { title: 'Clobbering', body: 'A move is always a capture: pick one of **your** stones and move it **one square — orthogonally — onto an adjacent enemy stone**. The enemy stone is removed ("clobbered") and your stone takes its place. You can never move to an empty square, and never diagonally.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,0,null,null,null,1,null,null,null,null,null,0,1,null,null,null,null,null,null,null,null,1,null,null,null,null,null],"turn":0}', highlight: [21], arrows: [{ from: 20, to: 21, tone: 'good' }] },
          { title: 'The board empties', body: 'Each clobber removes exactly one stone from the board, so the position steadily thins out and breaks into separate clusters. There is no way to add stones back — every game marches toward an end.' },
          { title: 'Winning', body: 'You win when it is your **opponent’s** turn and **none of their stones is next to an enemy** — they have no legal move. The player who makes the **last clobber wins**. It does not matter who has more stones left.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Count moves, not stones', body: 'The winner is whoever runs out of moves **last**, so think in terms of how many moves each side will get — not how many stones each owns. Often the best clobber is the one that denies your opponent a reply, even if it leaves stones on the board.' },
          { title: 'The game splits apart', body: 'As stones vanish, the board fractures into **independent regions** that don’t touch. Clobber experts evaluate each little region on its own and add up who gets the last move overall — this is exactly the kind of position combinatorial game theory was built to analyse.' },
          { title: 'Lone pairs', body: 'An isolated black-white pair is worth exactly **one move to whoever is on turn** — they clobber it and it’s gone. Keeping track of how many such "one-move" fragments exist, and whose turn falls on them, often decides the game.' },
          { title: 'Don’t self-strand', body: 'Avoid moves that leave **your own** stones with no enemy neighbours — a stone surrounded by empty squares is dead weight that can never move again. Keep your stones in contact with the enemy so you always have a clobber available.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          { title: 'Take the last move', body: 'Time to play. **Click your stone, then the adjacent enemy.** Find the clobber that leaves White with no reply at all — the last move wins.', setup: '{"board":[null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,null,null,null,null],"turn":0}',
            challenge: { prompt: 'Black to play — leave White with no move.', solution: ['a1xb1'], success: 'That clobber removes White’s last stone that had a neighbour, so White cannot move and Black — having played last — wins.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — rewarding moves that win the mobility race and flagging ones that hand your opponent extra replies, while the evaluation bar tracks who has more moves in hand. Step up to Master, which counts these little battles perfectly.' },
        ],
      },
    ],
  },
};

export default def;
