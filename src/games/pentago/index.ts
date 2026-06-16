import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, result, evaluate, type PentagoState } from './logic';

/**
 * Pentago metadata + course. Its play (place a marble, then rotate a 3×3
 * quadrant) needs a bespoke component (PentagoGame) with rotation controls,
 * so the standard board-flow methods here are thin and unused (`custom: true`).
 */
const def: GameDefinition<PentagoState, any> = {
  id: 'pentago',
  name: 'Pentago',
  tagline: 'Place a marble, then twist the board — five in a row wins, if the rotation allows it.',
  blurb:
    'A modern award-winner (Mensa Select) that bolts a brilliant twist onto five-in-a-row: every turn you place a marble AND rotate one of the four quadrants ninety degrees. A rotation can complete your line — or shatter your opponent’s the instant before they win. Thinking in two moving frames at once makes a “simple” game wonderfully hard.',
  category: 'Strategy',
  depth: 4,
  emoji: '🌀',
  accent: '#a855f7',
  players: [
    { id: 0, name: 'Amber', short: 'A', color: '#f59e0b' },
    { id: 1, name: 'Blue', short: 'B', color: '#3b82f6' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'stone', showCoordinates: false, checkered: false },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),
  getBoardView: (): BoardView => ({ rows: 1, cols: 1, cells: [] }),
  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const r = result(s.board);
    if (r.winner !== null) return { kind: 'win', winner: r.winner, reason: 'five marbles in a row' };
    if (r.draw) return { kind: 'draw', reason: 'the board filled with no five' };
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
      'Pentago, designed by Tomas Flodén, took the oldest idea in abstract games — make a line — and added one inspired rule: after you place a piece you must rotate a quarter of the board. Suddenly the position you build is never stable, and a single twist can snatch victory or defeat from nowhere. It is quick to learn, fits in a pocket, and has been solved by computers as a first-player win — but between humans it is a delight.',
    objective:
      'Be the first to get five of your marbles in a row — horizontally, vertically or diagonally — counted AFTER the rotation that ends your turn. Each turn has two compulsory parts: place one marble on any empty cell, then rotate any one of the four 3×3 quadrants 90° clockwise or anticlockwise. If a single rotation gives both players five, or the board fills with neither reaching five, the game is a draw.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Pentago is played on a **6×6** board made of **four 3×3 quadrants** that can each spin independently. Amber moves first; players alternate.' },
          { title: 'Place a marble', body: 'The first half of your turn: drop one marble of your colour onto **any empty cell**. Simple — but it is only half the move.' },
          { title: 'Twist a quadrant', body: 'The second half, and it is **compulsory**: choose **one** of the four quadrants and rotate it **90°**, clockwise or anticlockwise. Every marble in that quadrant turns with it. You must rotate even if you would rather not.' },
          { title: 'Five in a row — after the spin', body: 'You win with **five of your marbles in a line** (any direction) — but the line is only checked **after** your rotation. So a rotation can *complete* a five, or you can use it to *break apart* a five your opponent was about to make.' },
          { title: 'Draws', body: 'If one rotation produces **five for both** players at once, it is a **draw**. If all 36 cells fill with no one reaching five, that is a draw too.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Think in two frames', body: 'Because any quadrant can spin, a marble’s “position” is fluid. Always ask not just “is this four in a row?” but “what does it become if that quadrant turns?” Strong lines are ones a rotation can *complete*, not ones a rotation can *wreck*.' },
          { title: 'The centres are gold', body: 'The four centre cells of the quadrants **never move** when their own quadrant rotates (a 3×3 rotation fixes its centre). Marbles on these four squares are the most stable anchors for a line — fight for them early.' },
          { title: 'Rotate to defend', body: 'If your opponent threatens five, you often do not need to block the empty cell — you can **rotate the quadrant their line runs through** and scatter it. Defence and offence share the same single rotation, so make it do both.' },
          { title: 'Beware the gift', body: 'Your mandatory rotation can hand your opponent a five you never saw, by sliding *their* marbles into line. Before you spin, check that the rotation does not complete an enemy row as well as serving you.' },
        ],
      },
    ],
  },
};

export default def;
