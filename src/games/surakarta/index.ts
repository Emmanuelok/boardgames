import type { BoardView, GameDefinition, GameStatus, MoveExplanation, Player } from '../../engine/types';
import { initialState, winnerOf, evaluate, SIZE, rowOf, colOf, type SkState } from './logic';

/**
 * Surakarta metadata + course. The signature loop-capture board (eight corner
 * arcs joining the rank/file lines) needs a bespoke renderer (SurakartaGame), so
 * the board-flow methods here are thin (`custom`). A plain 6×6 board view is
 * still exposed for generic consumers.
 */
const def: GameDefinition<SkState, any> = {
  id: 'surakarta',
  name: 'Surakarta',
  tagline: 'Capture by sweeping around the corner loops — a board game like no other.',
  blurb:
    'A traditional game from Java with a mechanism you will see nowhere else: to capture, a piece races along a rank or file, swings around one of the eight looping tracks at the corners, and snatches the first enemy it meets on the far side. Quiet moves are simple single steps; captures are these gorgeous, curving raids. The four central points sit on no loop at all, so they are perfectly safe. Strip the board of your opponent’s twelve pieces to win.',
  category: 'Classic',
  depth: 3,
  emoji: '🌀',
  accent: '#d4a017',
  players: [
    { id: 0, name: 'You', short: 'Y', color: '#fbbf24' },
    { id: 1, name: 'Sphinx', short: 'S', color: '#38bdf8' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'disc', showCoordinates: true, checkered: false, intersections: true },
  custom: true,

  createInitialState: () => initialState(),
  cloneState: (s) => ({ points: s.points.slice(), turn: s.turn, sinceCapture: s.sinceCapture }),
  getBoardView: (s): BoardView => ({
    rows: SIZE, cols: SIZE,
    cells: s.points.map((p: Player | null, i: number) => ({ index: i, row: rowOf(i), col: colOf(i), piece: p === null ? null : { id: `sk${i}`, kind: 'disc', player: p } })),
    fileLabels: ['a', 'b', 'c', 'd', 'e', 'f'], rankLabels: ['6', '5', '4', '3', '2', '1'],
  }),
  getTurn: (s) => s.turn as Player,
  getStatus: (s): GameStatus => {
    const w = winnerOf(s);
    if (w === 'draw') return { kind: 'draw', reason: '40 moves with no capture' };
    if (w !== null) return { kind: 'win', winner: w as Player, reason: 'all enemy pieces captured' };
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
      'Surakarta — named for a city in central Java — looks like a simple grid until you notice the loops curling off every corner. Those loops are the whole game. Ordinary moves are humble single steps, but captures send a piece hurtling along a line, around a loop, and onto an unsuspecting enemy on the other side of the board. It is one of the most distinctive capturing mechanisms in all of board games, and it plays beautifully.',
    objective:
      'Capture all twelve of your opponent’s pieces (or leave them with no legal move). Each side starts with twelve pieces on its two nearest rows. You win by clearing the board of enemy pieces. If forty moves pass with no capture at all, the game is a draw.',
    chapters: [
      {
        title: 'The Board & The Loops', icon: '🌀',
        steps: [
          { title: 'Points, lines and loops', body: 'Play is on the points of a 6×6 grid joined by lines. At every corner, the outermost lines and the next-in lines curl back as **loops** — eight in all. These loops are the tracks captures travel on; ordinary moves ignore them.' },
          { title: 'The starting position', body: 'Each player has **twelve** pieces filling their two nearest rows; the middle two rows start empty. You move first, then players alternate.' },
          { title: 'The safe centre', body: 'The four **central points** lie on rows and columns that carry no loop. A piece there can neither capture nor be captured — a unique safe haven worth knowing about.' },
        ],
      },
      {
        title: 'Moving & Capturing', icon: '⚔️',
        steps: [
          { title: 'Simple moves', body: 'On a quiet turn, step one piece to **any adjacent empty point** — horizontally, vertically or diagonally. That’s all a non-capturing move ever is: one short step.' },
          { title: 'The looping capture', body: 'To capture, a piece travels **along its rank or file**, rides **at least one loop** around a corner, and lands on the **first enemy piece** it reaches. The whole path must be clear — any piece in the way (friend or foe) before the target blocks the raid.' },
          { title: 'Capturing is optional', body: 'Unlike draughts, you are **never forced** to capture. A capture that wins a piece but exposes you to a bigger loop-raid in reply can be a trap — weigh each one.' },
          { title: 'Winning', body: 'Take **all twelve** enemy pieces, or leave your opponent with no move, to win. Trades that keep you ahead in material steer you toward that goal.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Own the loop lines', body: 'A piece on a rank or file that feeds a loop is a loaded gun; a piece buried where it can’t reach a loop is passive. Manoeuvre your pieces onto lines that let them sweep around the corners.' },
          { title: 'Read the incoming raids', body: 'Before you move, trace your opponent’s loops too: is one of your pieces sitting on a clear track for an enemy capture? The curving paths are easy to miss — that’s where games are lost.' },
          { title: 'Use the safe centre', body: 'When a piece is in danger, the four central points are untouchable. Park a key piece there to weather a storm, or to force the opponent to come to you.' },
          { title: 'Trade when ahead', body: 'Every capture is one fewer enemy piece. When you lead in material, seek exchanges that simplify toward a won endgame; when behind, keep pieces on and complicate with loop threats.' },
        ],
      },
    ],
  },
};

export default def;
