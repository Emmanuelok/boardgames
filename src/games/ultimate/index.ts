import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, winnerOf, evaluate, type UTTTState, type Mark } from './logic';

/**
 * Ultimate Tic-Tac-Toe metadata + course. The meta-board structure (nine boards,
 * the "you send your opponent" rule, won-board overlays, the highlighted active
 * board) needs a bespoke component (UltimateGame), so the board-flow methods here
 * are thin (`custom`). A real 9×9 board view is still exposed for generic use.
 */
const def: GameDefinition<UTTTState, any> = {
  id: 'ultimate',
  name: 'Ultimate Tic-Tac-Toe',
  tagline: 'Nine games of tic-tac-toe in one — and your move decides where your opponent plays.',
  blurb:
    'The deceptively deep evolution of tic-tac-toe. The board is nine small boards in a 3×3 grid. Win a small board with three-in-a-row; win the GAME by winning three small boards in a line. The twist that creates all the strategy: the cell you play in tells your opponent which board they must play in next. Suddenly every move is two decisions — what you take, and where you send them.',
  category: 'Abstract',
  depth: 3,
  emoji: '🎯',
  accent: '#6366f1',
  players: [
    { id: 0, name: 'You', short: 'X', color: '#38bdf8' },
    { id: 1, name: 'Nova', short: 'O', color: '#fb7185' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'mark', showCoordinates: false, checkered: false },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ cells: s.cells.slice(), boards: s.boards.slice(), active: s.active, turn: s.turn }),

  getBoardView: (s): BoardView => {
    const cells = [] as BoardView['cells'];
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const gr = Math.floor(b / 3) * 3 + Math.floor(c / 3);
        const gc = (b % 3) * 3 + (c % 3);
        const v = s.cells[b * 9 + c] as Mark | null;
        cells.push({ index: gr * 9 + gc, row: gr, col: gc, piece: v === null ? null : { id: `u${b}${c}`, kind: v === 0 ? 'X' : 'O', player: v as Player, glyph: v === 0 ? '✕' : '◯' } });
      }
    }
    cells.sort((a, b) => a.index - b.index);
    return { rows: 9, cols: 9, cells };
  },

  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const w = winnerOf(s);
    if (w === 'draw') return { kind: 'draw', reason: 'every board decided with no winning line' };
    if (w !== null) return { kind: 'win', winner: w as Player, reason: 'three boards in a row' };
    return { kind: 'playing' };
  },
  getLegalMoves: () => [],
  applyMove: (s) => s,
  chooseMove: () => null,
  evaluate: (s) => evaluate(s),
  explainMove: (): MoveExplanation => ({ summary: '', band: 'solid', evalBefore: 0, evalAfter: 0, insights: [], principles: [] }),
  hint: () => null,
  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Ultimate Tic-Tac-Toe looks like a child’s game and plays like a real one. You take the humble 3×3 grid and nest it inside itself: nine little boards arranged in a big 3×3. The genius is a single linking rule — the square you choose inside a board decides which board your opponent is sent to next. That one rule turns noughts-and-crosses into a game of foresight, sacrifice and tempo that experts still argue about.',
    objective:
      'Win three small boards in a row — horizontally, vertically or diagonally on the big grid. You win a small board the usual way, by getting three of your marks in a line inside it. The catch: you rarely get to choose which board you play in. Whatever CELL your opponent just played dictates the BOARD you must play in now. So you are always weighing the mark you want to make against the board you are about to hand your opponent.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'Nine boards in one', body: 'The big board is a 3×3 grid of nine **small** tic-tac-toe boards. You (X) and Nova (O) take turns placing a single mark, exactly like normal tic-tac-toe — but spread across all nine little boards.' },
          { title: 'Win a small board', body: 'Get **three of your marks in a row** inside a small board and you win it — it’s then “yours” and is marked with a big X or O. A small board that fills up with no line is a **draw** and belongs to neither player.' },
          { title: 'The golden rule: you send your opponent', body: 'The square you play in tells your opponent **which board they must play in next**. Play in the *top-right* cell of any board, and your opponent must play somewhere in the *top-right* board. This is the heart of the game — every move is also a command.' },
          { title: 'The free move', body: 'If you’re sent to a board that’s already **won or full**, the rule can’t apply — so you may play in **any** open board instead. Forcing your opponent into a free move hands them flexibility, so it’s usually something to avoid giving away.' },
          { title: 'Winning the game', body: 'Win **three small boards in a row** on the big grid — across, down or diagonally — and you win the whole game. If all nine boards are decided with no such line, the game is a draw.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Every move is two decisions', body: 'Before you place a mark, look at the cell, not just the board: where will it **send** Nova? A move that wins you a small board is worthless if it sends Nova somewhere they win two. Always read the cell’s position first.' },
          { title: 'Send them to dead ends', body: 'Aim to send Nova into boards that are **already decided or hopeless for them** — boards where their move does little. Conversely, dread being forced to send them into the centre or a board where they’re about to complete a line.' },
          { title: 'The centre board is gold', body: 'The centre small board sits on **four** of the big board’s winning lines — more than any other. Fighting hard for the centre, and for the centre **cell** of each board, pays off twice over.' },
          { title: 'Sometimes, don’t win', body: 'Completing a small board can be a trap if the only winning cell sends Nova somewhere devastating. Strong players will **decline** an easy small-board win to keep control of where the game goes next. Tempo beats greed.' },
          { title: 'Count both meta-lines', body: 'Track the big board like a normal tic-tac-toe: which three-in-a-row of boards are you building, and which is Nova threatening? Win the boards that complete **your** line while denying the boards that complete **theirs** — the coach flags both as you play.' },
        ],
      },
    ],
  },
};

export default def;
