import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Tafl (Brandub variant) — the asymmetric Viking "king's table" game on a 7×7
 * board. The ATTACKERS (8) try to capture the king; the DEFENDERS (4 + king)
 * try to walk the king to any corner. Everyone moves like a rook. Soldiers are
 * captured by being sandwiched (custodial capture); the king is captured by
 * being surrounded on all four sides (board edge, corner and throne count as
 * walls). It is the center's only asymmetric game — two sides, two goals.
 *
 * Cell encoding (index = row*7 + col, row 0 top): null empty | 0 attacker |
 * 1 defender | 2 king. Player 0 = Attackers (move first); player 1 = Defenders.
 */

const N = 7;
const THRONE = 3 * N + 3; // 24
const CORNERS = [0, N - 1, N * (N - 1), N * N - 1]; // 0, 6, 42, 48
const CORNER_SET = new Set(CORNERS);
const RESTRICTED = new Set([...CORNERS, THRONE]); // non-king pieces can't enter
const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (i: number) => `${String.fromCharCode(97 + (i % N))}${N - Math.floor(i / N)}`;

export interface TaflState {
  board: (number | null)[]; // 49 cells
  turn: Player; // 0 attackers, 1 defenders
  since: number; // plies since the last capture (for the draw cap)
}
interface TaflMove extends MoveBase {}

const isKing = (v: number | null) => v === 2;
const ownerOf = (v: number | null): Player | -1 => (v === 0 ? 0 : v === 1 || v === 2 ? 1 : -1);

export function initialState(): TaflState {
  const board: (number | null)[] = Array(N * N).fill(null);
  board[THRONE] = 2; // king
  for (const i of [idx(2, 3), idx(4, 3), idx(3, 2), idx(3, 4)]) board[i] = 1; // defenders
  for (const i of [idx(0, 3), idx(1, 3), idx(6, 3), idx(5, 3), idx(3, 0), idx(3, 1), idx(3, 5), idx(3, 6)]) board[i] = 0; // attackers
  return { board, turn: 0, since: 0 };
}

function piecesOf(board: (number | null)[], p: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < N * N; i++) if (ownerOf(board[i]) === p) out.push(i);
  return out;
}
const kingPos = (board: (number | null)[]) => board.indexOf(2);
const count = (board: (number | null)[], v: number) => board.reduce((n: number, x) => n + (x === v ? 1 : 0), 0);

/** Rook-slide destinations. Non-kings may not enter corners or the throne. */
function slideDests(board: (number | null)[], from: number): number[] {
  const king = isKing(board[from]);
  const r = Math.floor(from / N), c = from % N;
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    let rr = r + dr, cc = c + dc;
    while (inB(rr, cc)) {
      const i = idx(rr, cc);
      if (board[i] !== null) break; // blocked by a piece
      if (!king && RESTRICTED.has(i)) break; // soldiers can't pass/land on throne or corners
      out.push(i);
      rr += dr; cc += dc;
    }
  }
  return out;
}

function genMoves(s: TaflState, from?: number | null): TaflMove[] {
  if (winnerOf(s) !== null) return [];
  const out: TaflMove[] = [];
  for (const f of piecesOf(s.board, s.turn)) {
    if (from != null && from !== f) continue;
    for (const to of slideDests(s.board, f)) {
      out.push({ id: `${f}-${to}`, from: f, to, notation: `${sq(f)}-${sq(to)}` });
    }
  }
  return out;
}

/** Squares that act as an "anvil" for capturing a soldier of `mover`'s enemy. */
function isAnvil(board: (number | null)[], cell: number, mover: Player): boolean {
  if (CORNER_SET.has(cell)) return true; // corners are always hostile
  if (cell === THRONE && board[THRONE] === null) return true; // empty throne is hostile
  return ownerOf(board[cell]) === mover; // your own piece
}

export function applyMove(s: TaflState, m: TaflMove): TaflState {
  const board = s.board.slice();
  const piece = board[m.from!];
  board[m.from!] = null;
  board[m.to] = piece;
  const mover = s.turn;
  const r = Math.floor(m.to / N), c = m.to % N;
  let captured = 0;
  for (const [dr, dc] of DIRS) {
    const ar = r + dr, ac = c + dc;
    if (!inB(ar, ac)) continue;
    const adj = idx(ar, ac);
    const av = board[adj];
    if (av === null || ownerOf(av) === mover || isKing(av)) continue; // only enemy soldiers
    const br = r + 2 * dr, bc = c + 2 * dc;
    if (inB(br, bc) && isAnvil(board, idx(br, bc), mover)) { board[adj] = null; captured++; }
  }
  return { board, turn: (s.turn ^ 1) as Player, since: captured > 0 ? 0 : s.since + 1 };
}

/** Is the king surrounded on all four sides (attacker / corner / throne / edge)? */
function kingSurrounded(board: (number | null)[]): boolean {
  const k = kingPos(board);
  if (k < 0) return false;
  const r = Math.floor(k / N), c = k % N;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (!inB(nr, nc)) continue; // the edge seals this side
    const ni = idx(nr, nc);
    if (board[ni] === 0) continue; // attacker seals
    if (CORNER_SET.has(ni) || ni === THRONE) continue; // hostile square seals
    return false; // open side
  }
  return true;
}

function winnerOf(s: TaflState): Player | null {
  const k = kingPos(s.board);
  if (k >= 0 && CORNER_SET.has(k)) return 1; // king escaped → defenders win
  if (kingSurrounded(s.board)) return 0; // king captured → attackers win
  if (count(s.board, 0) === 0) return 1; // all attackers gone → defenders win
  return null;
}

/* --------------------------------- eval --------------------------------- */

function kingCornerDist(board: (number | null)[]): number {
  const k = kingPos(board);
  if (k < 0) return 0;
  const r = Math.floor(k / N), c = k % N;
  return Math.min(...CORNERS.map((q) => Math.abs(r - Math.floor(q / N)) + Math.abs(c - (q % N))));
}
function kingSealedSides(board: (number | null)[]): number {
  const k = kingPos(board);
  if (k < 0) return 0;
  const r = Math.floor(k / N), c = k % N;
  let s = 0;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (!inB(nr, nc)) { s++; continue; }
    const ni = idx(nr, nc);
    if (board[ni] === 0 || CORNER_SET.has(ni) || ni === THRONE) s++;
  }
  return s;
}

export function evaluate(s: TaflState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  const att = count(s.board, 0), def = count(s.board, 1);
  const kMob = (() => { const k = kingPos(s.board); return k >= 0 ? slideDests(s.board, k).length : 0; })();
  let score = att * 10 - def * 16; // material (defenders are precious)
  score += kingCornerDist(s.board) * 7; // keep the king far from corners
  score += kingSealedSides(s.board) * 22; // closing the net around the king
  score -= kMob * 3; // the king's freedom helps the defenders
  return score; // + favours attackers (player 0)
}

const DEPTH: Record<Difficulty, number> = { tutor: 3, easy: 1, medium: 2, hard: 3, master: 4 };
// A touch of randomness even at master keeps rook-shuffles from cycling.
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.6, medium: 0.25, hard: 0.08, master: 0.03 };

function searchAdapter() {
  return {
    getLegalMoves: (s: TaflState) => genMoves(s, null),
    applyMove,
    getTurn: (s: TaflState) => s.turn,
    isTerminal: (s: TaflState) => winnerOf(s) !== null,
    evaluate,
  };
}

const def: GameDefinition<TaflState, TaflMove> = {
  id: 'tafl',
  name: 'Tafl',
  tagline: 'Viking siege chess — eight hunters trap a king who is racing for the corner.',
  blurb:
    'Hnefatafl, the “king’s table”, was the board game of the Viking age, played from Ireland to the Ukraine long before chess arrived in the north. It is gloriously asymmetric: the attackers ring the board and try to surround the king, while a smaller band of defenders fights to clear a path for him to bolt to any corner. Two sides, two completely different goals, one sudden-death sprint.',
  category: 'Strategy',
  depth: 4,
  emoji: '🛡️',
  accent: '#b45309',
  players: [
    { id: 0, name: 'Attackers', short: 'A', color: '#dc2626' },
    { id: 1, name: 'Defenders', short: 'D', color: '#e5e7eb' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'mark', showCoordinates: true, checkered: true },
  evalScale: 130,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, since: s.since }),

  getBoardView(s): BoardView {
    const cells = s.board.map((v, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      mark: (CORNER_SET.has(i) ? 'goal' : i === THRONE ? 'throne' : undefined) as 'goal' | 'throne' | undefined,
      piece: v === null ? null
        : v === 0 ? { id: `a${i}`, kind: 'attacker', player: 0 as Player, glyph: '◆' }
        : v === 1 ? { id: `d${i}`, kind: 'defender', player: 1 as Player, glyph: '●' }
        : { id: `k${i}`, kind: 'king', player: 1 as Player, glyph: '♚' },
    }));
    return {
      rows: N, cols: N, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      rankLabels: ['7', '6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s);
    if (w !== null) {
      const k = kingPos(s.board);
      const reason = k >= 0 && CORNER_SET.has(k) ? 'the king reached a corner'
        : count(s.board, 0) === 0 ? 'every attacker was captured'
        : 'the king was surrounded';
      return { kind: 'win', winner: w, reason };
    }
    if (genMoves(s, null).length === 0) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent has no move' };
    if (s.since >= 60) return { kind: 'draw', reason: 'no capture in 30 moves' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => genMoves(s, from),
  applyMove,

  chooseMove(s, difficulty) {
    const seed = (s.board.filter((v) => v !== null).length + s.turn + s.since + 1) * 2654435761;
    return searchBestMove(s, searchAdapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) }).move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const res = searchBestMove(before, searchAdapter(), DEPTH.tutor);
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const moverPlayed = toMover(evaluate(after));
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : moverPlayed;
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const w = winnerOf(after);
    const captured = (move.affected?.length ?? 0) || (count(before.board, mover === 0 ? 1 : 0) - count(after.board, mover === 0 ? 1 : 0));
    const kMoved = isKing(before.board[move.from!]);

    if (w === mover) insights.push({ tag: mover === 0 ? 'King captured!' : 'Escaped!', detail: mover === 0 ? 'The king is surrounded — attackers win.' : 'The king reached a corner — defenders win.', tone: 'good' });
    if (captured > 0) insights.push({ tag: 'Capture', detail: `Sandwiches and removes ${captured} enemy ${captured > 1 ? 'pieces' : 'piece'}.`, tone: 'good' });
    if (mover === 1 && kMoved) {
      const d = kingCornerDist(after.board);
      insights.push({ tag: d <= 2 ? 'Corner run' : 'King on the move', detail: d <= 2 ? 'The king is closing on a corner — one breakthrough from winning.' : 'The king repositions toward open space and the corners.', tone: 'good' });
      principles.push('Defenders: open a clear file or rank to a corner and run the king through it.');
    }
    if (mover === 0) {
      const sealed = kingSealedSides(after.board);
      if (sealed >= 3) insights.push({ tag: 'Closing the net', detail: `The king now has ${4 - sealed} escape side(s) left — tighten the ring.`, tone: 'good' });
      principles.push('Attackers: build an unbroken wall around the king; never leave a clear lane to a corner.');
    }
    if (insights.length === 0) insights.push({ tag: 'Maneuver', detail: 'A quiet rook move improving the position.', tone: 'info' });
    if (principles.length === 0) principles.push('Pieces move like a rook; capture a soldier by flanking it on two opposite sides.');

    const winningBig = Math.abs(moverPlayed) > 120;
    const band = w === mover ? 'best' : gradeByLoss(loss, winningBig);
    const summary = w === mover ? (mover === 0 ? 'Attackers surround the king and win!' : 'The king breaks through to a corner — defenders win!')
      : captured > 0 ? `${def.players[mover].name} capture on ${sq(move.to)}.`
      : `${def.players[mover].name} play ${move.notation}.`;
    const better = loss > 40 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined;

    return { summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after), insights, principles, betterIdea: better };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = applyMove(s, res.move);
    let text: string;
    if (winnerOf(after) === s.turn) text = `${res.move.notation} wins on the spot — play it!`;
    else if (s.turn === 1 && isKing(s.board[res.move.from!])) text = `${res.move.notation} marches the king toward a corner.`;
    else if (count(after.board, s.turn === 0 ? 1 : 0) < count(s.board, s.turn === 0 ? 1 : 0)) text = `${res.move.notation} captures by flanking.`;
    else text = s.turn === 0 ? `${res.move.notation} tightens the ring around the king.` : `${res.move.notation} clears a path for the king.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Tafl games — Hnefatafl and its smaller cousin Brandub played here — were the great board games of Norse and Celtic Europe for a thousand years. What makes them unforgettable is the asymmetry: one army surrounds the board and the other defends a king in the centre, and the two sides win in completely different ways. This is the only such game in the center, and it plays fast and sharp.',
    objective:
      'It depends which side you take. The DEFENDERS (the smaller force, plus the king) win by moving the **king to any of the four corners**. The ATTACKERS (the larger ring of soldiers) win by **surrounding the king on all four sides** so he cannot move. There is no shared goal — it is a chase, and one slip ends it.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The armies', body: 'On the 7×7 board the **king** starts on the central **throne**, ringed by his **four defenders**. **Eight attackers** sit at the edges in a cross. The four **corners** (marked) are the king’s escape squares. Attackers move first.' },
          { title: 'Movement', body: 'Every piece — attacker, defender and king alike — moves like a **rook**: any number of empty squares in a straight line, horizontally or vertically, and **may not jump**. Only the **king** may stop on the throne or a corner; the soldiers must go around them.' },
          { title: 'Capturing a soldier', body: 'You capture an enemy **soldier** by **sandwiching** it: move a piece so the enemy is trapped directly between your piece and another of yours (or a corner/empty throne) along a line. The captured piece is removed. You are safe moving *into* a gap — only the active move captures. Here moving the attacker to d5 traps the defender on c5.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,2,null],"turn":0,"since":0}', highlight: [16], arrows: [{ from: 20, to: 17, tone: 'good' }] },
          { title: 'Capturing the king', body: 'The king is tougher: he is captured only when **all four sides** are blocked by attackers or by a wall — the board edge, a corner, or the throne all count as walls. Pin him against the edge and you need fewer attackers.' },
          { title: 'Winning the chase', body: 'The instant the king lands on a **corner**, the defenders win. The instant he is fully **surrounded**, the attackers win. (If thirty moves pass with no capture, it is a draw.)' },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Attackers: keep the wall whole', body: 'Your eight pieces must form an **unbroken ring**. The king escapes through any clear rank or file to a corner, so never leave an open lane. Advance patiently and only close in once the king cannot slip past.' },
          { title: 'Defenders: open a lane', body: 'Your job is to **clear a straight path** to a corner and run the king down it. Use your four defenders to capture or shove aside the attackers guarding a corner, then bolt.' },
          { title: 'Threaten two corners', body: 'As the defender, manoeuvre the king so he threatens to dash to **two different corners** at once — the attackers cannot block both, and one will be yours.' },
          { title: 'Attackers: use the walls', body: 'Capturing is easier near the edge and the corners, which act as a second attacker. Herd defenders and the king toward the rim, where your sandwiches need only one piece plus the wall.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          { title: 'Escape!', body: 'Time to play as the **Defenders**. **Click the king, then a corner.** Both top corners are open — run the king home to win.', setup: '{"board":[null,null,null,2,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,0],"turn":1,"since":0}',
            challenge: { prompt: 'Defenders to play — escape the king to a corner.', solution: ['d7-a7', 'd7-g7'], success: 'The king slides straight into the corner — the defenders win the instant he lands there.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — for both sides — flagging captures, the closing net and open lanes to the corner, while the evaluation bar shows who is winning the chase. Switch sides in Setup and try to win as both the hunters and the hunted.' },
        ],
      },
    ],
  },
};

export default def;
