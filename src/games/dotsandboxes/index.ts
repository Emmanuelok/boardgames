import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, evaluate, winner, type DbState } from './logic';

/**
 * Dots and Boxes metadata + course. Its play (a dot grid with clickable edges
 * and claimable boxes) is driven by a bespoke component (DotsAndBoxesGame), so
 * the standard board-flow methods here are thin and unused (`custom: true`).
 */
const def: GameDefinition<DbState, any> = {
  id: 'dots-and-boxes',
  name: 'Dots and Boxes',
  tagline: 'Draw a line, close a box, claim it — and the childhood classic hides a fierce endgame.',
  blurb:
    'Everyone has played it in a school notebook: take turns joining dots, and whoever draws the fourth wall of a box claims it and goes again. But beneath the doodle lies real depth — the whole game turns on the endgame technique of the "double-cross", sacrificing two boxes to seize control of every chain. Simple to start, genuinely hard to master.',
  category: 'Family',
  depth: 3,
  emoji: '⬛',
  accent: '#3b82f6',
  players: [
    { id: 0, name: 'Blue', short: 'B', color: '#3b82f6' },
    { id: 1, name: 'Red', short: 'R', color: '#ef4444' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'mark', showCoordinates: false, checkered: false },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ edges: s.edges.slice(), owner: s.owner.slice(), scores: [s.scores[0], s.scores[1]], turn: s.turn }),
  getBoardView: (): BoardView => ({ rows: 1, cols: 1, cells: [] }),
  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const w = winner(s);
    return w !== null ? { kind: 'win', winner: w as Player, reason: 'owns the most boxes' } : { kind: 'playing' };
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
      'Dots and Boxes is the doodle game everyone knows — but it is also a staple of combinatorial game theory, studied by Elwyn Berlekamp in a whole book. Two players take turns drawing the edges of a grid of squares; the deceptively simple rule that "completing a box wins it and gives you another go" creates long forced chains and a beautiful, counter-intuitive endgame where giving boxes away is how you win.',
    objective:
      'Own more boxes than your opponent when the grid is full. You claim a box by drawing its fourth and final side — and doing so immediately grants you another move, which can cascade through a whole chain. The catch: drawing the third side of any box hands your opponent a free box, so most of the game is spent avoiding that, until someone is forced to "open" a chain.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'Drawing lines', body: 'On your turn you draw **one line** between two **adjacent dots** — horizontally or vertically. That is the entire move. Players alternate turns.' },
          { title: 'Claiming a box', body: 'When your line completes the **fourth side** of a 1×1 box, you **claim** that box (it is coloured in for you) — **and you must move again**. Completing two boxes with one line claims both and you still move again.' },
          { title: 'The free move', body: 'Because completing boxes lets you keep going, a single line can set off a **chain** of captures across the board. Conversely, drawing the **third** side of a box gives your opponent a free box on their turn.' },
          { title: 'Winning', body: 'Play continues until **every line is drawn**. Whoever has claimed **more boxes** wins. On the 5×5 grid here there are 25 boxes, so there is always a winner.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Avoid the third side', body: 'Early on, never draw the **third** side of a box if you can help it — that just gifts a box. Play "safe" lines (sides of boxes that still have 0 or 1 edges) for as long as possible.' },
          { title: 'Count the chains', body: 'The board eventually splits into **chains** — runs of boxes that fall together once opened. Whoever is **forced to open the first chain** usually loses the race, so the fight is over who runs out of safe moves first (the "parity" battle).' },
          { title: 'The double-cross', body: 'The master move: when you take a long chain, **leave the last two boxes**, drawing a line that hands them back. Your opponent must take those two and then **open the next chain for you**. Sacrificing two boxes to control every chain is how strong players win.' },
          { title: 'When to take it all', body: 'On the **very last** chain, just take everything — there is nothing left to give away. Knowing which chain is the last, and counting whether you are ahead enough to decline the double-cross, is the heart of expert play.' },
        ],
      },
    ],
  },
};

export default def;
