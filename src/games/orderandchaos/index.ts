import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, winnerOf, evaluate, N, type OCState, type Sym } from './logic';

/**
 * Order and Chaos metadata + course. The defining rule — each turn a player may
 * place EITHER symbol — needs a bespoke component (OrderChaosGame) with a symbol
 * picker, so the board-flow methods here are thin (`custom`). We still expose a
 * real board view so the tutorial's mini-boards render the actual X/O positions.
 */
const def: GameDefinition<OCState, any> = {
  id: 'order-and-chaos',
  name: 'Order and Chaos',
  tagline: 'Both players place both symbols. Order wants five in a row; Chaos wants to stop it.',
  blurb:
    'A brilliantly asymmetric twist on five-in-a-row. There are two symbols, X and O, and on every turn a player may place EITHER of them on any empty square — you both share both pieces. But your goals are opposite. ORDER tries to build a line of five identical symbols; CHAOS tries to fill the 6×6 board so that no such line ever appears. One elegant rule keeps it fair: six-in-a-row does not count — only exactly five wins.',
  category: 'Abstract',
  depth: 3,
  emoji: '🔀',
  accent: '#10b981',
  players: [
    // Colours double as the symbol colours used by the mini-board: X = emerald, O = rose.
    { id: 0, name: 'Order', short: 'Or', color: '#10b981' },
    { id: 1, name: 'Chaos', short: 'Ch', color: '#f43f5e' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'mark', showCoordinates: true, checkered: true },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView: (s): BoardView => ({
    rows: N, cols: N,
    cells: s.board.map((v: Sym | null, i: number) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: v === null ? null : { id: `oc${i}`, kind: v === 0 ? 'X' : 'O', player: v as Player, glyph: v === 0 ? '✕' : '◯' },
    })),
    fileLabels: ['a', 'b', 'c', 'd', 'e', 'f'],
    rankLabels: ['6', '5', '4', '3', '2', '1'],
  }),

  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const w = winnerOf(s);
    if (w !== null) return { kind: 'win', winner: w, reason: w === 0 ? 'five identical symbols in a line' : 'the board filled with no line of five' };
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
      'Order and Chaos, invented by Stephen Sniderman in 1981, takes five-in-a-row and turns it into a duel of opposites. There is no “your colour” here — both players place both symbols, X and O, wherever they like. What differs is the goal: one player (Order) is trying to create a line, the other (Chaos) is trying to prevent one from ever forming. It is small, sharp and surprisingly deep, and it plays quite unlike Gomoku or Connect Four.',
    objective:
      'On a 6×6 board, ORDER wins by forming a line of FIVE identical symbols — five X’s or five O’s — in a row, column or diagonal. CHAOS wins if the board fills up with no such line. Either player may place either symbol each turn, so Order must engineer a five while Chaos pollutes every promising line with the wrong symbol. The famous balancing rule: a run of SIX does not count — only exactly five wins for Order.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'Place either symbol', body: 'The board starts empty. On your turn, choose **X or O** and drop it on **any empty square** — there is no “your” symbol, both players use both. Then it is the other player’s turn. Squares are never moved or removed.' },
          { title: 'Order wins on five', body: 'ORDER’s goal is a line of **exactly five identical symbols** — horizontally, vertically or diagonally. Below, five X’s in a row wins immediately for Order. It does not matter who placed each symbol — only that five of a kind line up.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":1}', highlight: [12, 13, 14, 15, 16] },
          { title: 'Six does NOT count', body: 'The balancing rule that defines the game: a run of **six** identical symbols is **not** a win. The row of six X’s below does **not** win for Order — to score, a line must be exactly five, with the ends not extended. This rule keeps Order from winning too easily.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":1}', highlight: [12, 13, 14, 15, 16, 17] },
          { title: 'Chaos wins by jamming', body: 'CHAOS never makes a line — it **breaks** them. By dropping the opposite symbol into a promising row (the lone O below kills this line), Chaos poisons it forever. Chaos wins if the whole board fills with no line of five anywhere.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,0,0,1,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [14] },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Order: make a double threat', body: 'A single line of four is easy to block. The winning weapon is the **open four** — four in a row with **both** ends empty. Both highlighted squares complete five, and Chaos can only block one. Engineer two winning squares at once and you win.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [12, 17] },
          { title: 'Order: stay central', body: 'Lines through the **centre** pass through the most windows, so central squares belong to more potential fives than edge squares. Build outward from the middle and keep two directions alive at once, so Chaos can never address every threat.' },
          { title: 'Chaos: poison early', body: 'Do not wait. The moment a line has three of one symbol, drop the **opposite** symbol into it — one well-placed enemy stone kills a whole window. Spread your blocks so several lines die per move, and steer Order toward sixes (which don’t count) rather than fives.' },
          { title: 'Both: count the windows', body: 'Every five-window is either alive (one symbol only) or dead (both symbols present). Order wins by piling up live windows that cross; Chaos wins by killing them faster than they form. Near the end it becomes pure counting — exactly the kind of calculation the tutor highlights as you play.' },
        ],
      },
    ],
  },
};

export default def;
