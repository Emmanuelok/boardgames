import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, evaluate, winner, type BgState } from './logic';

/**
 * Backgammon's metadata + course. Its actual play (dice, triangular points,
 * stacked checkers, bearing off) is driven by a bespoke component
 * (BackgammonGame), so this definition only fills the catalogue and the Learn
 * page; the standard board-flow methods are thin and unused (`custom: true`).
 */
const def: GameDefinition<BgState, any> = {
  id: 'backgammon',
  name: 'Backgammon',
  tagline: 'The oldest game — race your checkers home on the roll of the dice.',
  blurb: 'A 5,000-year-old race game of luck and skill. Roll the dice, march your fifteen checkers around the board and bear them all off before your opponent — while hitting their blots and building blockades. Equal parts bold and calculating.',
  category: 'Classic',
  depth: 4,
  emoji: '🎲',
  accent: '#d97706',
  players: [
    { id: 0, name: 'White', short: 'W', color: '#f1f5f9' },
    { id: 1, name: 'Black', short: 'B', color: '#1f2937' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'disc', showCoordinates: false, checkered: false },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => JSON.parse(JSON.stringify(s)),
  getBoardView: () => ({ rows: 1, cols: 1, cells: [] }),
  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const w = winner(s);
    return w !== null ? { kind: 'win', winner: w as Player, reason: 'bore off all fifteen checkers' } : { kind: 'playing' };
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
    overview: 'Backgammon is the great race game: two players each guide fifteen checkers around a 24-point track and off the board, their speed set by the roll of two dice. Pure chance meets deep strategy — when to race, when to hit, when to build a wall.',
    objective: 'Be the first to bring all fifteen of your checkers into your home board and then "bear them all off". Hitting your opponent and blocking their path are your weapons along the way.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board & the race', body: 'The board has 24 narrow triangles called **points**. Your checkers travel in one direction toward your **home board** (the final quadrant) and then bear off. Your opponent races the opposite way — you pass like ships.' },
          { title: 'Rolling & moving', body: 'On your turn you roll **two dice** and move checkers that many points — one checker per die, or one checker twice. Roll **doubles** (e.g. 5-5) and you play the number **four** times. You must use both dice if a legal move exists.' },
          { title: 'Where you can land', body: 'You may land on any point that is empty, holds **your own** checkers, or holds exactly **one** enemy checker. You may **not** land on a point held by **two or more** enemy checkers — it is blocked.' },
          { title: 'Hitting & the bar', body: 'Landing on a lone enemy checker (a **blot**) sends it to the **bar** in the middle. A player with a checker on the bar must **re-enter** it in the opponent\'s home board before doing anything else — and can be shut out if those points are blocked.' },
          { title: 'Bearing off', body: 'Once **all fifteen** of your checkers are home, you bear them off with the dice. First one home wins. A clean, bold race punctuated by well-timed hits is the heart of the game.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧠',
        steps: [
          { title: 'Make points', body: 'Two checkers on a point **make** it — a safe anchor that also blocks the enemy. Building a wall of consecutive made points (a **prime**) can trap enemy checkers completely.' },
          { title: 'Mind your blots', body: 'A single checker is a **blot** that can be hit. Early on, leaving blots to make points is worth it; as the race tightens, play safe and avoid being sent back to the bar.' },
          { title: 'Race vs. hold', body: 'Count the **pips** (total distance to bear off). If you\'re ahead in the race, simplify and run. If behind, hold an **anchor** in the enemy home and wait for a shot at a blot to swing the game.' },
          { title: 'Timing the bear-off', body: 'Bring checkers home evenly so you\'re never forced to leave a blot during bear-off. A single exposed checker late can be hit and cost you the whole game.' },
        ],
      },
    ],
  },
};

export default def;
