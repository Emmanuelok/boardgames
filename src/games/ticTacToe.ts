import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

export interface TttState {
  board: (Player | null)[]; // 9 cells, row-major
  turn: Player;
}
interface TttMove extends MoveBase {}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diagonals
];
const CELL_NAME = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

function winnerOf(board: (Player | null)[]): Player | null {
  for (const [a, b, c] of LINES) {
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return null;
}

function searchAdapter(state: TttState) {
  return {
    getLegalMoves: legalMoves,
    applyMove: apply,
    getTurn: (s: TttState) => s.turn,
    isTerminal: (s: TttState) => winnerOf(s.board) !== null || s.board.every((c) => c !== null),
    evaluate,
  };
}

function legalMoves(s: TttState): TttMove[] {
  const w = winnerOf(s.board);
  if (w !== null) return [];
  const moves: TttMove[] = [];
  for (let i = 0; i < 9; i++) {
    if (s.board[i] === null) {
      moves.push({ id: `p${i}`, to: i, notation: `${s.turn === 0 ? 'X' : 'O'} → ${CELL_NAME[i]}` });
    }
  }
  return moves;
}

function apply(s: TttState, m: TttMove): TttState {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

function evaluate(s: TttState): number {
  const w = winnerOf(s.board);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  // Heuristic: count lines still winnable, weighted by how full they are.
  let score = 0;
  for (const [a, b, c] of LINES) {
    const cells = [s.board[a], s.board[b], s.board[c]];
    const x = cells.filter((v) => v === 0).length;
    const o = cells.filter((v) => v === 1).length;
    if (x > 0 && o > 0) continue; // contested, dead line
    if (x > 0) score += x === 2 ? 18 : 3;
    if (o > 0) score -= o === 2 ? 18 : 3;
  }
  return score;
}

const DEPTH: Record<Difficulty, number> = { tutor: 9, easy: 1, medium: 2, hard: 6, master: 9 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.9, medium: 0.5, hard: 0.1, master: 0 };

function lineThreats(board: (Player | null)[], player: Player): number {
  // number of lines where `player` has two and the third is empty
  let n = 0;
  for (const [a, b, c] of LINES) {
    const cells = [board[a], board[b], board[c]];
    if (cells.filter((v) => v === player).length === 2 && cells.includes(null)) n++;
  }
  return n;
}

const def: GameDefinition<TttState, TttMove> = {
  id: 'tic-tac-toe',
  name: 'Tic-Tac-Toe',
  tagline: 'The 3×3 classic — solved, but a perfect first lesson.',
  blurb: 'Three in a row wins. Simple enough to master in minutes, deep enough to teach forks, tempo and forced draws. Our AI plays perfectly — beat it and you have truly understood the game.',
  category: 'Family',
  depth: 1,
  emoji: '⭕',
  accent: '#f472b6',
  players: [
    { id: 0, name: 'X', short: 'X', color: '#38bdf8' },
    { id: 1, name: 'O', short: 'O', color: '#f472b6' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'mark', showCoordinates: false, checkered: false, cellGap: 0.12 },

  createInitialState: () => ({ board: Array(9).fill(null), turn: 0 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / 3), col: i % 3,
      piece: p === null ? null : { id: `c${i}`, kind: p === 0 ? 'X' : 'O', player: p, glyph: p === 0 ? '✕' : '◯' },
    }));
    return { rows: 3, cols: 3, cells };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s.board);
    if (w !== null) return { kind: 'win', winner: w, reason: 'three in a row' };
    if (s.board.every((c) => c !== null)) return { kind: 'draw', reason: 'the board is full' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const res = searchBestMove(s, searchAdapter(s), DEPTH[difficulty], {
      randomness: RAND[difficulty], rng: mulberry32((s.board.filter(Boolean).length + 1) * 2654435761),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const adapter = searchAdapter(before);
    // Grade by comparing the played move to the best move (deep, exact).
    const res = searchBestMove(before, adapter, 9);
    const playedEval = evaluate(after);
    const bestEval = res.ranked[0]?.score ?? playedEval;
    const moverPlayed = mover === 0 ? playedEval : -playedEval;
    const moverBest = mover === 0 ? bestEval : -bestEval;
    const loss = Math.max(0, moverBest - moverPlayed);

    const insights = [];
    const principles: string[] = [];
    const threats: string[] = [];

    const w = winnerOf(after.board);
    if (w === mover) {
      insights.push({ tag: 'Winning move', detail: 'Completes three in a row — game over.', tone: 'good' as const });
    }

    const myThreatsBefore = lineThreats(before.board, mover);
    const myThreatsAfter = lineThreats(after.board, mover);
    const oppThreatsBefore = lineThreats(before.board, (mover ^ 1) as Player);

    if (myThreatsAfter >= 2) {
      insights.push({ tag: 'Fork!', detail: 'Creates two winning threats at once — the opponent can only block one.', tone: 'good' as const });
      principles.push('Create a double threat (fork): two ways to win, only one defender.');
      threats.push('Two separate three-in-a-rows are now threatened.');
    } else if (myThreatsAfter > myThreatsBefore) {
      insights.push({ tag: 'Builds a threat', detail: 'Now threatens to complete a line next turn.', tone: 'good' as const });
    }

    // Did the mover need to block?
    if (oppThreatsBefore > 0) {
      const oppThreatsAfter = lineThreats(after.board, (mover ^ 1) as Player);
      if (oppThreatsAfter < oppThreatsBefore) {
        insights.push({ tag: 'Blocks', detail: 'Stops the opponent from completing their line.', tone: 'good' as const });
        principles.push('Always block an immediate three-in-a-row threat.');
      } else if (w !== mover) {
        insights.push({ tag: 'Missed defence', detail: 'The opponent was threatening to win and this did not stop it.', tone: 'bad' as const });
      }
    }

    if (move.to === 4 && before.board[4] === null && before.board.every((c, i) => i === move.to || c === null)) {
      insights.push({ tag: 'Center', detail: 'The center touches four of the eight winning lines — the strongest opening cell.', tone: 'good' as const });
      principles.push('Take the center first: it belongs to four lines.');
    } else if ([0, 2, 6, 8].includes(move.to) && before.board.filter(Boolean).length <= 1) {
      insights.push({ tag: 'Corner', detail: 'Corners belong to three lines — the best reply when the center is taken.', tone: 'info' as const });
      principles.push('Prefer corners over edges — they sit on more lines.');
    }

    const winningBig = Math.abs(moverPlayed) > 500;
    const band = w === mover ? 'best' : gradeByLoss(loss, winningBig);

    if (band === 'blunder' || band === 'mistake') {
      insights.push({ tag: 'Turns the game', detail: 'A perfect opponent can now force at least a draw — and maybe a win.', tone: 'bad' as const });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Develops', detail: 'A reasonable placement that keeps the position balanced.', tone: 'info' as const });
    }

    const summary =
      w === mover ? `${mover === 0 ? 'X' : 'O'} completes three in a row and wins!`
      : myThreatsAfter >= 2 ? `${mover === 0 ? 'X' : 'O'} forks — two threats, only one can be stopped.`
      : `${mover === 0 ? 'X' : 'O'} plays the ${CELL_NAME[move.to]} square.`;

    return {
      summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles, threats: threats.length ? threats : undefined,
      betterIdea: loss > 60 && res.move ? `A stronger square was the ${CELL_NAME[res.move.to]}.` : undefined,
    };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(s), 9);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const forks = lineThreats(after.board, s.turn) >= 2;
    const text = forks
      ? `Play the ${CELL_NAME[res.move.to]} — it creates a fork (two threats at once).`
      : `The ${CELL_NAME[res.move.to]} square is best here.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Tic-Tac-Toe (Noughts and Crosses) is the friendliest strategy game in the world — and a perfect way to learn the language of threats, forks and tempo that runs through every board game in this center.',
    objective: 'Be the first to place three of your marks in a horizontal, vertical, or diagonal row. If the board fills with no winner, the game is a draw.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Play happens on a 3×3 grid of nine squares. One player is **X**, the other is **O**. X always moves first.' },
          { title: 'Taking turns', body: 'Players alternate, each turn placing one mark in any empty square. A square, once filled, stays filled.' },
          { title: 'How to win', body: 'Get three of your own marks in a straight line — across, down, or diagonally — and you win instantly. There are **eight** possible winning lines.', highlight: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
          { title: 'The draw', body: 'If all nine squares fill up and nobody has three in a row, the game is a **draw** (often called a "cat\'s game").' },
        ],
      },
      {
        title: 'Winning Ideas', icon: '🧠',
        steps: [
          { title: 'Own the center', body: 'The center square sits on **four** of the eight winning lines — more than any other square. If you move first, take it.', highlight: [4] },
          { title: 'Corners beat edges', body: 'Each corner belongs to three winning lines; each edge to only two. After the center, corners are the most valuable squares.', highlight: [0, 2, 6, 8] },
          { title: 'Always block', body: 'If your opponent has two in a row with the third square empty, you must place there immediately — or you lose next turn.' },
          { title: 'The fork', body: 'The winning weapon is the **fork**: a move that creates *two* threats at once. Your opponent can only block one, so you complete the other and win. Setting up forks is the whole game.' },
          { title: 'Why perfect play draws', body: 'With best play by both sides, Tic-Tac-Toe is always a draw. That is why our AI on **Master** can never be beaten — aim to never lose, and to punish any mistake.' },
        ],
      },
    ],
  },
};

export default def;
