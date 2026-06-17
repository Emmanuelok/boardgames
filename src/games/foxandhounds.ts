import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Fox & Hounds — the classic asymmetric chase on the dark squares of 8×8.   */
/*                                                                            */
/*  The lone FOX (player 0) starts on its back row and may step one square    */
/*  diagonally in ANY direction. The four HOUNDS (player 1) start on the      */
/*  opposite back row and may step one square diagonally FORWARD only — they  */
/*  can never retreat. Nobody captures. The fox wins by slipping through to   */
/*  the hounds' home row, or by stranding the hounds with no move; the hounds */
/*  win by trapping the fox so it cannot move. Because the hounds only ever   */
/*  advance, the game is guaranteed to end.                                   */
/* -------------------------------------------------------------------------- */

const SIZE = 8;
const N = SIZE * SIZE;

export interface FHPiece { player: Player }
export interface FHState { squares: (FHPiece | null)[]; turn: Player }
export interface FHMove extends MoveBase {}

const idx = (r: number, c: number) => r * SIZE + c;
const rowOf = (i: number) => Math.floor(i / SIZE);
const colOf = (i: number) => i % SIZE;
const onBoard = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const isPlayable = (r: number, c: number) => (r + c) % 2 === 1;

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const sq = (i: number) => `${FILES[colOf(i)]}${SIZE - rowOf(i)}`;

// Hounds occupy row 0 (top) and advance downward (row increasing). The fox sits
// on row 7 (bottom) and tries to reach row 0.
const HOUND_COLS = [1, 3, 5, 7];
const FOX_START = idx(7, 4);

function createInitialState(): FHState {
  const squares: (FHPiece | null)[] = Array(N).fill(null);
  for (const c of HOUND_COLS) squares[idx(0, c)] = { player: 1 };
  squares[FOX_START] = { player: 0 };
  return { squares, turn: 0 }; // the fox moves first
}

const cloneState = (s: FHState): FHState => ({ squares: s.squares.map((p) => (p ? { player: p.player } : null)), turn: s.turn });

function foxIndex(s: FHState): number {
  for (let i = 0; i < N; i++) if (s.squares[i]?.player === 0) return i;
  return -1;
}
function houndIndices(s: FHState): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (s.squares[i]?.player === 1) out.push(i);
  return out;
}

// Step directions: the fox roams all four diagonals; a hound only goes forward (down).
const FOX_DIRS: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const HOUND_DIRS: [number, number][] = [[1, -1], [1, 1]];

function movesFrom(s: FHState, from: number): FHMove[] {
  const p = s.squares[from];
  if (!p) return [];
  const dirs = p.player === 0 ? FOX_DIRS : HOUND_DIRS;
  const r = rowOf(from), c = colOf(from);
  const out: FHMove[] = [];
  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (!onBoard(nr, nc)) continue;
    const to = idx(nr, nc);
    if (s.squares[to] !== null) continue;
    out.push({ id: `${from}-${to}`, from, to, notation: `${p.player === 0 ? 'Fox' : 'H'} ${sq(from)}–${sq(to)}` });
  }
  return out;
}

function legalMoves(s: FHState, fromCell?: number | null): FHMove[] {
  // Terminal positions yield no moves (keeps search tidy).
  const fox = foxIndex(s);
  if (fox >= 0 && rowOf(fox) === 0) return [];
  const out: FHMove[] = [];
  if (s.turn === 0) {
    if (fox >= 0) out.push(...movesFrom(s, fox));
  } else {
    for (const h of houndIndices(s)) out.push(...movesFrom(s, h));
  }
  if (fromCell !== undefined && fromCell !== null) return out.filter((m) => m.from === fromCell);
  return out;
}

function applyMove(s: FHState, m: FHMove): FHState {
  const squares = s.squares.map((p) => (p ? { player: p.player } : null));
  squares[m.to] = squares[m.from!];
  squares[m.from!] = null;
  return { squares, turn: (s.turn ^ 1) as Player };
}

/** Fox (0) or hounds (1) winner, or null. No draws. */
function winnerOf(s: FHState): Player | null {
  const fox = foxIndex(s);
  if (fox >= 0 && rowOf(fox) === 0) return 0;        // fox broke through to the top
  if (legalMoves(s).length === 0) return (s.turn ^ 1) as Player; // side to move is stuck → it loses
  return null;
}

/* ------------------------------- Evaluation ------------------------------ */
// Positive favours the FOX (player 0).
function evaluate(s: FHState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  const fox = foxIndex(s);
  const fr = rowOf(fox), fc = colOf(fox);
  const hounds = houndIndices(s);
  let score = 0;
  // The fox wants to be near row 0.
  score += (SIZE - 1 - fr) * 12;
  // Breaking past the line is almost winning: reward the fox for being above the
  // lowest hound (closer to row 0 than every hound).
  const minHoundRow = Math.min(...hounds.map(rowOf));
  if (fr < minHoundRow) score += 280;
  // Fox mobility — a cornered fox is a dead fox.
  score += legalMoves({ squares: s.squares, turn: 0 }).length * 8;
  // A compact, unbroken hound line is the hounds' whole defence; spread is bad for them.
  if (hounds.length > 0) {
    const rows = hounds.map(rowOf);
    score += (Math.max(...rows) - Math.min(...rows)) * 6; // raggedness favours the fox
    // Hounds want to sit just ahead of the fox, blocking its file neighbourhood.
    const guarding = hounds.filter((h) => rowOf(h) > fr).length;
    score -= guarding * 10;
  }
  // Tiny central pull for the fox (more room to manoeuvre).
  score += (3.5 - Math.abs(fc - 3.5)) * 1.5;
  return score;
}

function adapter() {
  return {
    getLegalMoves: (s: FHState) => legalMoves(s),
    applyMove,
    getTurn: (s: FHState) => s.turn,
    isTerminal: (s: FHState) => winnerOf(s) !== null,
    evaluate,
    // Fox: try advancing moves first. Hounds: also prefer advancing (forced anyway).
    order: (_s: FHState, m: FHMove) => (m.from !== undefined ? (rowOf(m.from) - rowOf(m.to)) : 0),
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 9, easy: 3, medium: 6, hard: 9, master: 11 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.75, medium: 0.32, hard: 0.06, master: 0 };

function chooseMove(s: FHState, difficulty: Difficulty): FHMove | null {
  const seed = (s.squares.reduce((a, p, i) => a + (p ? i * (p.player + 1) : 0), 0) + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/* ---------------------------- Status & board view ------------------------ */

function getStatus(s: FHState): GameStatus {
  const w = winnerOf(s);
  if (w === 0) {
    const fox = foxIndex(s);
    return { kind: 'win', winner: 0, reason: rowOf(fox) === 0 ? 'the fox broke through to the far side' : 'the hounds were left with no move' };
  }
  if (w === 1) return { kind: 'win', winner: 1, reason: 'the fox is trapped with no move' };
  return { kind: 'playing' };
}

function getBoardView(s: FHState): BoardView {
  const cells = s.squares.map((p, i) => ({
    index: i, row: rowOf(i), col: colOf(i), playable: isPlayable(rowOf(i), colOf(i)),
    piece: p === null ? null : { id: `fh${i}`, kind: p.player === 0 ? 'fox' : 'hound', player: p.player, glyph: p.player === 0 ? '🦊' : '🐶' },
  }));
  return { rows: SIZE, cols: SIZE, cells, fileLabels: FILES.slice(), rankLabels: ['8', '7', '6', '5', '4', '3', '2', '1'] };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

function explainMove(before: FHState, move: FHMove, after: FHState): MoveExplanation {
  const mover = before.turn;
  const side = mover === 0 ? 'Fox' : 'Hounds';
  const res = searchBestMove(before, adapter(), DEPTH.tutor);
  const playedEval = evaluate(after);
  const bestEval = res.ranked[0]?.score ?? playedEval;
  const moverPlayed = mover === 0 ? playedEval : -playedEval;
  const moverBest = mover === 0 ? bestEval : -bestEval;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const foxBefore = foxIndex(before), foxAfter = foxIndex(after);
  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;

  if (won) {
    insights.push({ tag: 'Winning move', detail: mover === 0 ? 'The fox escapes — the hounds can no longer stop it.' : 'The fox is trapped with nowhere to go. Hounds win.', tone: 'good' });
  }

  if (mover === 0) {
    const advanced = rowOf(foxAfter) < rowOf(foxBefore);
    const minHoundRowAfter = Math.min(...houndIndices(after).map(rowOf));
    const brokeThrough = rowOf(foxAfter) < minHoundRowAfter;
    if (brokeThrough && !won) {
      insights.push({ tag: 'Past the line!', detail: 'The fox has slipped behind the hounds — with the wall broken, a clear run to the top beckons.', tone: 'good' });
      principles.push('The fox wins the instant it gets behind the hound line — hunt for the gap.');
    } else if (advanced && !won) {
      insights.push({ tag: 'Advances', detail: 'Pushes toward the far side. Keep probing for a hole the hounds can’t cover.', tone: 'info' });
    }
    const myMob = legalMoves({ squares: after.squares, turn: 0 }).length;
    if (myMob <= 1 && !won) { insights.push({ tag: 'Running out of room', detail: 'The fox has almost no squares left — one more cover move by the hounds could trap it.', tone: 'bad' }); threats.push('The hounds are closing the net.'); }
  } else {
    // Hounds moved: did they keep an unbroken, advancing line?
    const foxRow = rowOf(foxAfter);
    const minHoundRow = Math.min(...houndIndices(after).map(rowOf));
    if (foxRow < minHoundRow) { insights.push({ tag: 'Line broken', detail: 'The fox is now behind the hounds — advancing this hound opened a lane the fox can exploit.', tone: 'bad' }); principles.push('Hounds must move as one unbroken wall — never advance a hound that leaves a gap.'); }
    else { insights.push({ tag: 'Closes the wall', detail: 'Keeps the hounds shoulder-to-shoulder, denying the fox a way past.', tone: 'good' }); principles.push('Advance the hounds in a connected line, side to side, squeezing the fox toward an edge.'); }
  }

  if (insights.length === 0) insights.push({ tag: mover === 0 ? 'Probes' : 'Holds', detail: 'A steady move that keeps the tension.', tone: 'info' });

  const winningBig = Math.abs(moverPlayed) > 250;
  const band = won ? 'best' : gradeByLoss(loss, winningBig);
  const summary = won
    ? (mover === 0 ? 'The fox is through — it wins!' : 'The hounds trap the fox — they win!')
    : `${side} play ${move.notation.replace(/^(Fox|H) /, '')}.`;
  return {
    summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles,
    threats: threats.length ? threats : undefined,
    betterIdea: loss > 80 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined,
  };
}

function hint(s: FHState): { move: FHMove; text: string } | null {
  const res = searchBestMove(s, adapter(), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move;
  const after = applyMove(s, m);
  const won = getStatus(after).kind === 'win';
  const text = s.turn === 0
    ? (won ? `Play ${m.notation} — the fox escapes!` : `Play ${m.notation} — probe toward the gap and keep your options open.`)
    : (won ? `Play ${m.notation} — this traps the fox.` : `Play ${m.notation} — keep the hound wall unbroken as it advances.`);
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<FHState, FHMove> = {
  id: 'fox-and-hounds',
  name: 'Fox & Hounds',
  tagline: 'One cunning fox against four hounds — slip through, or get boxed in.',
  blurb:
    'A pure, beautiful asymmetric duel. You are the fox: a single piece that moves any diagonal direction, trying to slip past four hounds to the open country behind them. The hounds move only forward and never capture — their only weapon is the unbroken wall. Can the lone fox find the gap, or will the pack squeeze it into a corner? Tiny rules, surprisingly deep, and a perfect study in coordination versus cunning.',
  category: 'Classic',
  depth: 2,
  emoji: '🦊',
  accent: '#f59e0b',
  players: [
    { id: 0, name: 'Fox', short: 'F', color: '#f59e0b' },
    { id: 1, name: 'Hounds', short: 'H', color: '#60a5fa' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },
  evalScale: 220,

  createInitialState,
  cloneState,
  getBoardView,
  getTurn: (s) => s.turn,
  getStatus,
  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove,
  chooseMove,
  evaluate,
  explainMove,
  hint,

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str) as FHState,

  tutorial: {
    overview:
      'Fox & Hounds (a cousin of Fox and Geese) is asymmetry distilled to its essence. One side is a single fast piece — the fox — that can go any diagonal direction. The other is a team of four hounds that can only ever shuffle forward. Neither side captures anything. It looks trivial and plays like a tense game of cat-and-mouse: the hounds win only through perfect coordination, and the fox wins the moment that coordination cracks.',
    objective:
      'If you are the FOX, win by reaching the hounds’ home row at the far side of the board — or by stranding the hounds so they have no legal move. If you are the HOUNDS, win by trapping the fox so that it cannot move at all. With flawless play the four hounds can always pen the fox; one careless advance, and the fox is gone.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The dark squares', body: 'Like draughts, the game lives entirely on the **dark squares** of an 8×8 board. The four **hounds** line up along the top row; the lone **fox** starts on the bottom row. The **fox moves first**, then players alternate.', highlight: [idx(0, 1), idx(0, 3), idx(0, 5), idx(0, 7), FOX_START] },
          { title: 'The fox roams free', body: 'On its turn the **fox** steps one square diagonally in **any** of the four directions — forward or backward — onto an empty dark square. That freedom to retreat is its great weapon.', setup: '{"turn":0,"squares":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,{"player":0},null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]}', highlight: [idx(3, 2)], arrows: [{ from: idx(3, 2), to: idx(2, 1), tone: 'good' }, { from: idx(3, 2), to: idx(2, 3), tone: 'good' }, { from: idx(3, 2), to: idx(4, 1), tone: 'good' }, { from: idx(3, 2), to: idx(4, 3), tone: 'good' }] },
          { title: 'The hounds only advance', body: 'Each **hound** steps one square diagonally **forward** — toward the fox’s side — onto an empty dark square. Hounds can **never** move backward and **never** capture. Every hound move is a commitment you can’t take back.', setup: '{"turn":1,"squares":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,{"player":1},null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]}', highlight: [idx(3, 2)], arrows: [{ from: idx(3, 2), to: idx(4, 1), tone: 'info' }, { from: idx(3, 2), to: idx(4, 3), tone: 'info' }] },
          { title: 'How each side wins', body: 'The **fox wins** by reaching the hounds’ home row (breaking out behind them), or if the hounds ever have **no legal move**. The **hounds win** by surrounding the fox so it has **no square to step to**. There are no draws — someone always gets stuck.' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Hounds: move as a wall', body: 'The hounds’ entire game is the **unbroken line**. Advance them side by side so that between them and the walls there is no diagonal gap for the fox to slip through. The moment one hound rushes ahead and opens a lane, the fox is gone.', highlight: [idx(3, 1), idx(3, 3), idx(3, 5), idx(3, 7)] },
          { title: 'Hounds: never break ranks', body: 'Only advance a hound when its neighbours can keep the line intact. Push the wall **down the board together**, herding the fox toward the top edge until it runs out of room. Patience wins — the hounds are slower, but they are four.' },
          { title: 'Fox: probe for the gap', body: 'You can’t break the wall by force, so make the hounds break it for you. **Feint** left and right; a hound that over-commits to chase you opens the hole you dart through. Use your backward moves to reset and wait for the line to crack.' },
          { title: 'Fox: get behind the line', body: 'Your goal isn’t the centre, it’s the **far row**. The instant you stand on a square closer to the top than every hound, the game is essentially won — there’s nothing left that can move fast enough to stop you. Steer for the flank the hounds have weakened.' },
        ],
      },
    ],
  },
};

export default def;
