import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/* -------------------------------------------------------------------------- */
/*  Alquerque — the ~3,000-year-old ancestor of draughts.                      */
/*                                                                            */
/*  Played on a 5×5 lattice of points joined by orthogonal lines everywhere   */
/*  and by diagonals on the "strong" points (those where row+col is even).    */
/*  Pieces step one point along any drawn line to an empty neighbour, and     */
/*  capture by short-jumping an adjacent enemy to the empty point beyond —     */
/*  in ANY direction the lines allow. Captures are compulsory and chain like  */
/*  draughts. Take all the enemy pieces (or leave them with no move) to win.  */
/*  A long spell with no capture is declared a draw, which bounds the game.   */
/* -------------------------------------------------------------------------- */

const SIZE = 5;
const N = SIZE * SIZE; // 25
const NO_CAPTURE_DRAW = 30; // plies without a capture → draw (guarantees termination)

export interface AlqState { points: (Player | null)[]; turn: Player; sinceCapture: number }
export interface AlqMove extends MoveBase { path: number[] }

const idx = (r: number, c: number) => r * SIZE + c;
const rowOf = (i: number) => Math.floor(i / SIZE);
const colOf = (i: number) => i % SIZE;
const onBoard = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const isStrong = (r: number, c: number) => (r + c) % 2 === 0; // strong points carry diagonals

const FILES = ['a', 'b', 'c', 'd', 'e'];
const sq = (i: number) => `${FILES[colOf(i)]}${SIZE - rowOf(i)}`;

const ORTHO: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Line directions available from a point (diagonals only on strong points). */
function dirsAt(i: number): [number, number][] {
  return isStrong(rowOf(i), colOf(i)) ? [...ORTHO, ...DIAG] : ORTHO;
}

/** Line segments for the board drawing — each adjacency once (a<b). */
export const CONNECTIONS: [number, number][] = (() => {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const r = rowOf(i), c = colOf(i);
    for (const [dr, dc] of dirsAt(i)) {
      const nr = r + dr, nc = c + dc;
      if (!onBoard(nr, nc)) continue;
      const j = idx(nr, nc);
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  return out;
})();

export function createInitialState(): AlqState {
  const points: (Player | null)[] = Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const r = rowOf(i), c = colOf(i);
    if (r < 2) points[i] = 1;            // top two rows
    else if (r > 2) points[i] = 0;       // bottom two rows
    else if (c < 2) points[i] = 0;       // middle row: left half to player 0
    else if (c > 2) points[i] = 1;       // middle row: right half to player 1
    // centre (2,2) stays empty
  }
  return { points, turn: 0, sinceCapture: 0 };
}

const cloneState = (s: AlqState): AlqState => ({ points: s.points.slice(), turn: s.turn, sinceCapture: s.sinceCapture });

/* ----------------------------- Move generation --------------------------- */

function simpleSteps(points: (Player | null)[], from: number): AlqMove[] {
  const r = rowOf(from), c = colOf(from);
  const out: AlqMove[] = [];
  for (const [dr, dc] of dirsAt(from)) {
    const nr = r + dr, nc = c + dc;
    if (!onBoard(nr, nc)) continue;
    const to = idx(nr, nc);
    if (points[to] !== null) continue;
    out.push({ id: `m${from}-${to}`, from, to, notation: `${sq(from)}–${sq(to)}`, path: [to] });
  }
  return out;
}

function captureSequences(points: (Player | null)[], start: number): AlqMove[] {
  const me = points[start];
  if (me === null) return [];
  const results: AlqMove[] = [];
  const walk = (board: (Player | null)[], at: number, captured: number[], path: number[]) => {
    const r = rowOf(at), c = colOf(at);
    let extended = false;
    for (const [dr, dc] of dirsAt(at)) {
      const mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
      if (!onBoard(lr, lc)) continue;
      const mid = idx(mr, mc), land = idx(lr, lc);
      const victim = board[mid];
      if (victim === null || victim === me) continue; // must jump an enemy
      if (board[land] !== null) continue;             // land must be empty
      if (captured.includes(mid)) continue;           // never jump the same piece twice
      extended = true;
      const next = board.slice();
      next[mid] = null; next[at] = null; next[land] = me;
      walk(next, land, [...captured, mid], [...path, land]);
    }
    if (!extended && path.length > 0) {
      results.push({ id: `j${start}-${path.join('-')}`, from: start, to: path[path.length - 1], notation: `${sq(start)}×${sq(path[path.length - 1])}`, capture: true, affected: captured.slice(), path: path.slice() });
    }
  };
  walk(points, start, [], []);
  return results;
}

export function legalMoves(s: AlqState, fromCell?: number | null): AlqMove[] {
  const { points, turn } = s;
  const captures: AlqMove[] = [];
  for (let i = 0; i < N; i++) if (points[i] === turn) captures.push(...captureSequences(points, i));
  let moves: AlqMove[];
  if (captures.length > 0) moves = captures;
  else {
    const steps: AlqMove[] = [];
    for (let i = 0; i < N; i++) if (points[i] === turn) steps.push(...simpleSteps(points, i));
    moves = steps;
  }
  if (fromCell !== undefined && fromCell !== null) return moves.filter((m) => m.from === fromCell);
  return moves;
}

export function applyMove(s: AlqState, m: AlqMove): AlqState {
  const points = s.points.slice();
  const me = points[m.from!];
  if (m.affected) for (const cap of m.affected) points[cap] = null;
  points[m.from!] = null;
  points[m.to] = me;
  const captured = (m.affected?.length ?? 0) > 0;
  return { points, turn: (s.turn ^ 1) as Player, sinceCapture: captured ? 0 : s.sinceCapture + 1 };
}

const countPieces = (s: AlqState, p: Player) => s.points.reduce<number>((n, v) => n + (v === p ? 1 : 0), 0);

export function winnerOf(s: AlqState): Player | 'draw' | null {
  if (countPieces(s, 0) === 0) return 1;
  if (countPieces(s, 1) === 0) return 0;
  if (s.sinceCapture >= NO_CAPTURE_DRAW) return 'draw';
  if (legalMoves(s).length === 0) return (s.turn ^ 1) as Player; // side to move is stuck → it loses
  return null;
}

/* ------------------------------- Evaluation ------------------------------ */

const CONN = (() => { const a = Array(N).fill(0); for (const [x, y] of CONNECTIONS) { a[x]++; a[y]++; } return a; })();

function evaluate(s: AlqState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  if (w === 'draw') return 0;
  let score = 0;
  for (let i = 0; i < N; i++) {
    const v = s.points[i];
    if (v === null) continue;
    const sign = v === 0 ? 1 : -1;
    score += sign * 100;                 // material dominates
    score += sign * CONN[i] * 1.5;       // well-connected points (strong points) are stronger
  }
  // Small mobility edge for the side to move.
  score += (s.turn === 0 ? 1 : -1) * legalMoves(s).length * 1.2;
  return score;
}

function adapter() {
  return {
    getLegalMoves: (s: AlqState) => legalMoves(s),
    applyMove,
    getTurn: (s: AlqState) => s.turn,
    isTerminal: (s: AlqState) => winnerOf(s) !== null,
    evaluate,
    order: (_s: AlqState, m: AlqMove) => (m.affected ? m.affected.length * 10 : 0), // try big captures first
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 6, easy: 3, medium: 5, hard: 7, master: 8 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.34, hard: 0.07, master: 0 };

function chooseMove(s: AlqState, difficulty: Difficulty): AlqMove | null {
  const seed = (s.points.reduce<number>((a, v, i) => a + (v !== null ? i * (v + 1) : 0), 0) + s.turn + 1) * 2654435761;
  return searchBestMove(s, adapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
}

/* ------------------------------- Status & view --------------------------- */

function getStatus(s: AlqState): GameStatus {
  const w = winnerOf(s);
  if (w === 'draw') return { kind: 'draw', reason: `${NO_CAPTURE_DRAW} moves with no capture` };
  if (w !== null) {
    const reason = countPieces(s, (w ^ 1) as Player) === 0 ? 'all enemy pieces captured' : 'the opponent has no legal move';
    return { kind: 'win', winner: w, reason };
  }
  return { kind: 'playing' };
}

function getBoardView(s: AlqState): BoardView {
  const cells = s.points.map((p, i) => ({
    index: i, row: rowOf(i), col: colOf(i), playable: true,
    piece: p === null ? null : { id: `al${i}`, kind: 'disc', player: p },
  }));
  return { rows: SIZE, cols: SIZE, cells, fileLabels: FILES.slice(), rankLabels: ['5', '4', '3', '2', '1'] };
}

/* ------------------------- Tutor: explain & hint ------------------------- */

function explainMove(before: AlqState, move: AlqMove, after: AlqState): MoveExplanation {
  const mover = before.turn;
  const side = mover === 0 ? 'Gold' : 'Silver';
  const res = searchBestMove(before, adapter(), DEPTH.tutor);
  const playedEval = evaluate(after);
  const bestEval = res.ranked[0]?.score ?? playedEval;
  const moverPlayed = mover === 0 ? playedEval : -playedEval;
  const moverBest = mover === 0 ? bestEval : -bestEval;
  const loss = Math.max(0, moverBest - moverPlayed);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];
  const caps = move.affected?.length ?? 0;
  const status = getStatus(after);
  const won = status.kind === 'win' && status.winner === mover;

  if (won) insights.push({ tag: 'Winning move', detail: 'Leaves the opponent with nothing — game over.', tone: 'good' });
  if (caps >= 2) { insights.push({ tag: `Chain capture ×${caps}!`, detail: `One move jumps ${caps} enemy pieces — a decisive swing.`, tone: 'good' }); principles.push('Hunt for chained jumps along the lines — captures are compulsory and can cascade.'); }
  else if (caps === 1) insights.push({ tag: 'Capture', detail: 'Jumps an enemy piece and wins material.', tone: 'good' });

  // Did the move leave a piece that the opponent can immediately capture?
  const reply = searchBestMove(after, adapter(), Math.min(DEPTH.tutor, 5));
  if (!won && reply.move && (reply.move.affected?.length ?? 0) > 0) {
    const oppGain = reply.move.affected!.length;
    insights.push({ tag: oppGain >= 2 ? 'Allows a chain capture' : 'Hangs a piece', detail: `The opponent can reply with ${reply.move.notation}, taking ${oppGain}.`, tone: 'bad' });
    threats.push(`${mover === 0 ? 'Silver' : 'Gold'} can play ${reply.move.notation}.`);
  }
  if (caps === 0 && insights.length === 0) {
    if (isStrong(rowOf(move.to), colOf(move.to)) && !isStrong(rowOf(move.from!), colOf(move.from!))) insights.push({ tag: 'To a strong point', detail: 'Stepping onto a strong point (with diagonals) gives this piece more lines to attack and flee along.', tone: 'good' });
    else insights.push({ tag: 'Develops', detail: 'A quiet step that keeps the position sound.', tone: 'info' });
  }
  principles.push('Captures are forced — before you move, check what jump you hand the opponent in reply.');

  const winningBig = Math.abs(moverPlayed) > 250;
  const band = won ? 'best' : gradeByLoss(loss, winningBig);
  const summary = won ? `${side} clears the board and wins!`
    : caps >= 2 ? `${side} chains a ${caps}-piece capture (${sq(move.from!)}×${sq(move.to)}).`
    : caps === 1 ? `${side} captures (${sq(move.from!)}×${sq(move.to)}).`
    : `${side} steps ${sq(move.from!)}–${sq(move.to)}.`;
  return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, threats: threats.length ? threats : undefined, betterIdea: loss > 90 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined };
}

function hint(s: AlqState): { move: AlqMove; text: string } | null {
  const res = searchBestMove(s, adapter(), DEPTH.hard);
  if (!res.move) return null;
  const m = res.move; const caps = m.affected?.length ?? 0;
  const text = caps >= 2 ? `Play ${m.notation} — a forced ${caps}-piece chain capture.`
    : caps === 1 ? `Play ${m.notation} — captures are mandatory and this wins material.`
    : `${m.notation} is the soundest move; watch the jumps you allow in reply.`;
  return { move: m, text };
}

/* ------------------------------- Definition ------------------------------ */

const def: GameDefinition<AlqState, AlqMove> = {
  id: 'alquerque',
  name: 'Alquerque',
  tagline: 'The 3,000-year-old grandfather of draughts — jump along the lines to clear the board.',
  blurb:
    'Alquerque is the ancient game from which checkers and draughts descend — played in Egypt over three millennia ago and carried across the Mediterranean by the Moors. On a 5×5 lattice laced with diagonals, pieces glide along the lines and capture by leaping an adjacent foe, chaining jump after jump. Captures are compulsory, so every move is a small calculation: which jumps will you be forced into, and which will you force? Strip the board of enemy pieces to win.',
  category: 'Classic',
  depth: 3,
  emoji: '🟡',
  accent: '#eab308',
  players: [
    { id: 0, name: 'Gold', short: 'G', color: '#fcd34d' },
    { id: 1, name: 'Silver', short: 'S', color: '#cbd5e1' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'disc', showCoordinates: true, checkered: false, intersections: true, connections: CONNECTIONS },
  evalScale: 300,

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
  deserialize: (str) => JSON.parse(str) as AlqState,

  tutorial: {
    overview:
      'Alquerque is the common ancestor of the whole draughts family — boards for it were scratched into temple roofs in ancient Egypt. It looks like a simple lattice of dots and lines, but the diagonals turn it into a sharp game of forced jumps. If you have ever played checkers you already half-know it; the twist is that pieces move and capture in every direction the lines allow, not just forward.',
    objective:
      'Capture all of your opponent’s pieces — or leave them with no legal move. Each side starts with twelve pieces; the centre point is empty. Captures are compulsory and chain, so material swings fast. If thirty moves pass with no capture at all, the game is declared a draw.',
    chapters: [
      {
        title: 'The Board & Pieces', icon: '📜',
        steps: [
          { title: 'Lines, not squares', body: 'Alquerque is played on the **points** of a 5×5 grid, joined by lines. Every point connects to its orthogonal neighbours; the **strong points** (where the diagonals are drawn) also connect diagonally. Pieces sit on points and travel along the lines.' },
          { title: 'The starting position', body: 'Each player has **twelve** pieces filling their side; the **centre point is empty**, the single gap that gets the game moving. Gold sits on the bottom and the lower-left of the middle row; Silver mirrors it on top.' },
          { title: 'Moving', body: 'On your turn, slide one piece along a line to an **adjacent empty point** — in any direction the lines allow (orthogonally from any point, and diagonally from the strong points). If you can capture, though, you **must** (see next chapter).' },
          { title: 'Winning', body: 'You win by **capturing every enemy piece**, or by leaving your opponent **with no legal move**. Thirty consecutive moves without a capture is a draw — so keep the pressure on.' },
        ],
      },
      {
        title: 'Capturing', icon: '⚔️',
        steps: [
          { title: 'The jump', body: 'To capture, **leap over an adjacent enemy** along a line to the empty point immediately beyond it — exactly like draughts, but in **any** direction the lines permit. The jumped piece is removed.' },
          { title: 'Captures are compulsory', body: 'If a capture is available, you **must** take one. A quiet step is illegal whenever a jump exists. If you have several jumps, you may choose which — but jump you must.' },
          { title: 'Chains', body: 'After a jump, if the **same piece** can jump again, it **must keep going** — sweeping several pieces in a single move. Spotting these chains (and the ones you hand your opponent) is the whole art of Alquerque.' },
          { title: 'Strong points matter', body: 'A piece on a **strong point** can jump diagonally as well as straight, so it both attacks more and is harder to trap. Steer your pieces onto strong points, and try to force the enemy onto the weak ones.' },
        ],
      },
      {
        title: 'Trainer', icon: '🎯',
        steps: [
          { title: 'Make the capture', body: 'Captures are forced. **Click your piece, then the point beyond the enemy** to jump it. There is one capture available here — take it.',
            setup: '{"turn":0,"sinceCapture":0,"points":[null,null,null,null,null,null,null,null,null,null,null,1,0,null,null,null,null,null,null,null,null,null,null,null,null]}',
            challenge: { prompt: 'Gold to play — jump the Silver piece.', solution: ['c3×a3'], success: 'The Gold piece leaps the Silver one to the empty point straight beyond, removing it. Whenever a capture exists, you are forced to take one.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — celebrating chain captures, and warning you when a step hands the opponent a jump. Captures are mandatory, so reading one move deeper than feels natural is the key to winning. Step up the difficulty and clear the board.' },
        ],
      },
    ],
  },
};

export default def;
