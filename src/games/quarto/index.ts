import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, winnerOf, evaluate, type QuartoState } from './logic';

/**
 * Quarto metadata + course. Its play (attribute-rich pieces, placing the piece
 * your opponent gave you, then choosing theirs) needs a bespoke component
 * (QuartoGame), so the standard board-flow methods here are thin (`custom`).
 */
const def: GameDefinition<QuartoState, any> = {
  id: 'quarto',
  name: 'Quarto',
  tagline: 'You don’t pick your own piece — your opponent does. Line up four that share a trait.',
  blurb:
    'A modern masterpiece (Mensa Select winner) of pure deduction. Sixteen pieces, each tall or short, dark or light, round or square, solid or hollow. You win by completing a line of four pieces sharing ANY one trait — but here is the diabolical twist: you never choose your own piece, your opponent hands it to you. So every turn you must place a piece AND find one to give away that doesn’t hand victory to your rival.',
  category: 'Strategy',
  depth: 4,
  emoji: '🧩',
  accent: '#ca8a04',
  players: [
    { id: 0, name: 'You', short: 'Y', color: '#f59e0b' },
    { id: 1, name: 'Owl', short: 'O', color: '#60a5fa' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'mark', showCoordinates: false, checkered: false },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ board: s.board.slice(), held: s.held, turn: s.turn }),
  getBoardView: (): BoardView => ({ rows: 1, cols: 1, cells: [] }),
  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const w = winnerOf(s);
    if (w === 'draw') return { kind: 'draw', reason: 'the board filled with no shared-trait line' };
    if (w !== null) return { kind: 'win', winner: w, reason: 'four in a line sharing a trait' };
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
      'Quarto, designed by Blaise Müller, looks like four-in-a-row and plays like nothing else, because of one rule: you never choose the piece you place — your opponent chooses it for you. Suddenly you are thinking about both sides at once, hunting for a piece to give that cannot possibly win, while steering the piece you were given onto a safe square. It is small, elegant and ferociously logical.',
    objective:
      'Be the player who completes a line of four pieces — a row, column or diagonal — that all share at least one of the four traits (all tall, OR all dark, OR all round, OR all hollow, etc.). You win the instant you PLACE the fourth such piece. The catch: each turn you place the piece your opponent handed you, then hand your opponent one of the pieces still off the board. Give a winning piece away and you lose.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The pieces', body: 'There are **sixteen** pieces, and every one is unique. Each has four traits, and each trait has two values: **tall / short**, **dark / light**, **round / square**, and **solid / hollow**. No two pieces are alike.' },
          { title: 'A turn = place, then give', body: 'A turn has two parts. First, **place** the piece your opponent gave you on any empty square. Then **choose one** of the remaining pieces and **hand it to your opponent** — that is the piece they must place next turn. (The very first turn is just a give.)' },
          { title: 'How you win', body: 'You win by **placing the fourth piece** of a line — row, column or diagonal — where all four pieces share **at least one trait** (all tall, all hollow, all round… any single trait counts). The shared trait need not be the same across different lines.' },
          { title: 'The deadly gift', body: 'Because you choose your **opponent’s** piece, the danger is handing them one that completes a line. Before you give, scan every line with three pieces: if the piece you are about to give shares a trait with all three of any such line, you are giving away the game.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Think for both sides', body: 'Every piece is neutral — either player can use it to win. So on your turn you are really solving two puzzles: where to safely place the piece you hold, and which piece is safe to give. Always check the give first: is there a piece left that cannot complete any line?' },
          { title: 'Watch the “three” lines', body: 'A line with **three** pieces already sharing a trait is a loaded gun. If you must give a piece, make sure it does **not** carry that shared trait. As the board fills, the safe pieces run out — that squeeze is the heart of the game.' },
          { title: 'Set a fork', body: 'The winning idea is to create **two** different threat-lines that need pieces with *opposite* traits, so that whatever piece is left to give you, one of the lines completes. Forcing your opponent to hand you a winner is how Quarto is won.' },
          { title: 'Count the pieces', body: 'Late in the game only a few pieces remain off the board. Track their traits carefully — often you can prove that every remaining piece you could be given is safe, or that your opponent has no safe gift left. Quarto rewards cold calculation.' },
        ],
      },
    ],
  },
};

export default def;
