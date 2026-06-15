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
    overview: 'Tic-Tac-Toe (Noughts and Crosses) is the friendliest strategy game in the world — and the perfect first lesson in the language of *threats*, *forks* and *tempo* that runs through every game in this center. It is small enough to hold entirely in your head, yet it already contains the single most important tactical idea in all of board gaming: the double threat. Master it here and you will spot it everywhere else.',
    objective: 'Be the first to place three of your marks in a straight line — horizontal, vertical, or diagonal. There are exactly eight such lines. If the board fills with neither side completing one, the game is a draw. With best play by both players the result is always a draw, so the real goals are: never lose, and pounce the instant your opponent errs.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Play happens on a **3×3 grid** of nine squares — three corners-and-an-edge to a side, with one cell in the middle. One player is **X**, the other is **O**. **X always moves first**, which is a small but real advantage.' },
          { title: 'Taking turns', body: 'Players alternate, each turn placing one mark in any **empty** square. A square, once filled, stays filled — there is no moving or removing marks. The game lasts at most nine moves: five for X, four for O.' },
          { title: 'How to win', body: 'Get **three of your own marks in a straight line** — across, down, or diagonally — and you win the instant the third lands. There are **eight** possible winning lines: three rows, three columns, and the two diagonals.', highlight: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
          { title: 'Reading a threat', body: 'A **threat** is a line where you already hold two squares and the third is empty — you are one move from winning. Learning to *see every threat for both sides on every turn* is essentially the whole skill of the game. Here X threatens the top row at the top-right square.', setup: '{"board":[0,0,null,null,1,null,null,null,null],"turn":0}', highlight: [0, 1, 2] },
          { title: 'The draw — "cat\'s game"', body: 'If all nine squares fill and nobody has three in a row, the game is a **draw**, traditionally called a "cat\'s game". Because two careful players always reach this, a draw is the *normal* result — winning means your opponent slipped.' },
        ],
      },
      {
        title: 'The Cells & Blocking', icon: '🧭',
        steps: [
          { title: 'Own the center', body: 'The **center** square sits on **four** of the eight winning lines — both diagonals, the middle row and the middle column. No other square touches more. If you move first, almost always take the center: it does the most work on offense *and* defense.', setup: '{"board":[null,null,null,null,0,null,null,null,null],"turn":1}', highlight: [4] },
          { title: 'Corners beat edges', body: 'Each **corner** belongs to **three** lines (a row, a column, and a diagonal); each **edge** to only **two** (a row and a column). So after the center, corners are the most valuable squares, and edges the least. Opening replies and second moves should favour corners.', highlight: [0, 2, 6, 8] },
          { title: 'Why corners matter on defense too', body: 'Two corners on the same diagonal share the center between them, and any two corners share an edge line — so corners give you the flexible "two-in-a-line with a gap" shapes that turn into forks. The four edges (top, left, right, bottom) are the weakest cells and rarely your first choice.', highlight: [1, 3, 5, 7] },
          { title: 'Always block — or lose', body: 'If your opponent has two marks in a line with the third square empty, you **must** place in that square immediately. Ignore it and they simply complete the line next turn. Here O threatens the top row; X is forced to plug the top-right square.', setup: '{"board":[1,1,null,null,0,null,null,null,null],"turn":0}', highlight: [2], arrows: [] },
          { title: 'Threat beats no-threat', body: 'When you are not forced to block, make a move that *creates* a threat of your own. A move that both blocks the opponent **and** makes a new threat is ideal — it forces them to defend instead of attack, and you keep the initiative (the "tempo").' },
        ],
      },
      {
        title: 'The Fork & The Draw', icon: '🍴',
        steps: [
          { title: 'The fork: two threats at once', body: 'The winning weapon is the **fork** — a single move that creates **two** separate threats. Your opponent can block only one of them, so on your next turn you complete the other and win. Every Tic-Tac-Toe win ultimately comes from a fork (or an opponent failing to block).' },
          { title: 'How a fork is built', body: 'Forks grow from cells that share *two* of your lines. Here X holds the center and a corner; playing the opposite corner would line up **two** two-in-a-rows crossing through X\'s pieces — a double threat O cannot meet.', setup: '{"board":[0,null,null,null,0,null,null,null,null],"turn":0}', highlight: [0, 4, 8], arrows: [{ from: 4, to: 8, tone: 'good' }] },
          { title: 'The corner trap', body: 'A classic trap: X takes a corner, O wrongly answers on an edge instead of the center. X then takes the opposite corner, and with the center still free X is heading for a fork. Punishing edge replies is the most common way to actually beat a human.' },
          { title: 'Avoid being forked', body: 'Defense is the mirror image: deny your opponent the cells that would give *them* two crossing lines. Taking the center early kills most enemy forks before they start, since so many forks run through the middle.', highlight: [4] },
          { title: 'Why perfect play draws', body: 'With best play by **both** sides, Tic-Tac-Toe is a forced **draw** — the game is "solved". That is why our AI on **Master** can never be beaten: it always takes the center or a correct corner, always blocks, and never allows a fork. Against it, aim to *never lose*; against anyone else, set forks and wait for a slip.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          {
            title: 'Win in one',
            body: 'Time to play, not just read. **Click an empty square** to place your X. You already hold two of the top row — finish it.',
            setup: '{"board":[0,0,null,1,1,null,null,null,null],"turn":0}',
            challenge: {
              prompt: 'X to play — complete three in a row.',
              solution: ['X → top-right'],
              success: 'X → top-right completes the top row for the win. The first thing to check every single turn is "can I win right now?" — if yes, just take it.',
            },
          },
          {
            title: 'Block the loss',
            body: 'Now you are under fire. O holds the top-right and the right square, threatening the right-hand column. If you do not stop it, O wins next move. Find the only saving square.',
            setup: '{"board":[0,null,1,null,0,1,null,null,null],"turn":0}',
            challenge: {
              prompt: 'X to play — block O\'s winning threat.',
              solution: ['X → bottom-right'],
              success: 'X → bottom-right plugs the right column just in time. The second question every turn — right after "can I win?" — is "can my opponent win?" If yes, you must block it.',
            },
          },
          {
            title: 'Create a fork',
            body: 'The real art. You hold the top-right and bottom-left corners; O sits on the center and bottom-right. Find the corner that makes **two** threats at once — O can only stop one.',
            setup: '{"board":[null,null,0,null,1,null,0,null,1],"turn":0}',
            challenge: {
              prompt: 'X to play — make a fork (two threats at once).',
              solution: ['X → top-left'],
              success: 'X → top-left forks: it threatens the top row (top-left + top-right) **and** the left column (top-left + bottom-left). O can block only one, so you win on the move after. This double threat is the most important tactic in all of board games.',
            },
          },
          {
            title: 'Keep training',
            body: 'In a real game our AI tutor grades **every** move you make — spotting your forks, your missed blocks, and the stronger square when you misfire. Play it at rising difficulty: on Master it is unbeatable, so a draw is a triumph and any win means you caught a real mistake.',
          },
        ],
      },
    ],
  },
};

export default def;
