import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Lines of Action (Claude Soucie, 1969) — a connection game on an 8×8 board.
 * Each side has 12 men. A man moves in a straight line (orthogonal or diagonal)
 * EXACTLY as many squares as there are men of EITHER colour on that whole line.
 * It may leap its own men but not the enemy's, and it may capture an enemy man
 * by landing on it. You win the moment ALL of your men form a single connected
 * group (touching orthogonally or diagonally). A lone man counts as connected —
 * so capturing the enemy down to one piece hands them the win.
 *
 * Indexing matches chess: index = row*8 + col, row 0 is the top (rank 8).
 * Player 0 = Black, starts on the top and bottom rows and moves first.
 * Player 1 = White, starts on the left and right columns.
 */

const N = 8;
export interface LoaState {
  board: (Player | null)[]; // 64 cells; null = empty
  turn: Player;
}
interface LoaMove extends MoveBase {}

const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (r: number, c: number) => `${String.fromCharCode(97 + c)}${N - r}`;
// Four line orientations: horizontal, vertical, ↘ diagonal, ↗ anti-diagonal.
const ORIENT: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
const NEIGH: [number, number][] = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function initialState(): LoaState {
  const board: (Player | null)[] = Array(N * N).fill(null);
  for (let c = 1; c <= 6; c++) { board[idx(0, c)] = 0; board[idx(7, c)] = 0; } // Black: top & bottom rows
  for (let r = 1; r <= 6; r++) { board[idx(r, 0)] = 1; board[idx(r, 7)] = 1; } // White: left & right columns
  return { board, turn: 0 };
}

function pieces(board: (Player | null)[], p: Player): number[] {
  const out: number[] = [];
  for (let i = 0; i < N * N; i++) if (board[i] === p) out.push(i);
  return out;
}

/** Men on the whole line through (r,c) in orientation (dr,dc), counting (r,c). */
function lineCount(board: (Player | null)[], r: number, c: number, dr: number, dc: number): number {
  let n = 1;
  for (const s of [1, -1]) {
    let rr = r + dr * s, cc = c + dc * s;
    while (inB(rr, cc)) { if (board[idx(rr, cc)] !== null) n++; rr += dr * s; cc += dc * s; }
  }
  return n;
}

function legalMoves(s: LoaState, from?: number | null): LoaMove[] {
  if (winnerOf(s) !== null) return [];
  const me = s.turn;
  const enemy = (me ^ 1) as Player;
  const out: LoaMove[] = [];
  for (const f of pieces(s.board, me)) {
    if (from != null && from !== f) continue;
    const r = Math.floor(f / N), c = f % N;
    for (const [dr, dc] of ORIENT) {
      const d = lineCount(s.board, r, c, dr, dc);
      for (const s2 of [1, -1]) {
        const tr = r + dr * s2 * d, tc = c + dc * s2 * d;
        if (!inB(tr, tc)) continue;
        const dest = s.board[idx(tr, tc)];
        if (dest === me) continue; // cannot land on your own man
        let blocked = false; // cannot leap an enemy man
        for (let k = 1; k < d; k++) {
          if (s.board[idx(r + dr * s2 * k, c + dc * s2 * k)] === enemy) { blocked = true; break; }
        }
        if (blocked) continue;
        const to = idx(tr, tc);
        const capture = dest === enemy;
        out.push({ id: `${f}-${to}`, from: f, to, capture, notation: `${sq(r, c)}${capture ? 'x' : '-'}${sq(tr, tc)}`, affected: capture ? [to] : undefined });
      }
    }
  }
  return out;
}

function apply(s: LoaState, m: LoaMove): LoaState {
  const board = s.board.slice();
  board[m.from!] = null;
  board[m.to] = s.turn; // a capture overwrites the enemy man
  return { board, turn: (s.turn ^ 1) as Player };
}

/** Number of 8-connected groups among `p`'s men (0 if none). */
function groupCount(board: (Player | null)[], p: Player): number {
  const cells = new Set(pieces(board, p));
  if (cells.size === 0) return 0;
  const seen = new Set<number>();
  let groups = 0;
  for (const start of cells) {
    if (seen.has(start)) continue;
    groups++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      const r = Math.floor(cur / N), c = cur % N;
      for (const [dr, dc] of NEIGH) {
        const nr = r + dr, nc = c + dc;
        if (!inB(nr, nc)) continue;
        const ni = idx(nr, nc);
        if (cells.has(ni) && !seen.has(ni)) { seen.add(ni); stack.push(ni); }
      }
    }
  }
  return groups;
}

const isConnected = (board: (Player | null)[], p: Player) => groupCount(board, p) === 1;

/** The winner, accounting for the rule that the player who just moved wins ties. */
function winnerOf(s: LoaState): Player | null {
  const mover = (s.turn ^ 1) as Player; // turn already flipped to the next player
  if (isConnected(s.board, mover)) return mover;
  const other = (mover ^ 1) as Player;
  if (isConnected(s.board, other)) return other;
  return null;
}

/* --------------------------------- eval --------------------------------- */

/** Compactness metric for `p` (closer to 0 = nearer to a single group). */
function metric(board: (Player | null)[], p: Player): number {
  const cells = pieces(board, p);
  if (cells.length === 0) return -1000;
  const g = groupCount(board, p);
  let sr = 0, sc = 0;
  for (const i of cells) { sr += Math.floor(i / N); sc += i % N; }
  const cr = sr / cells.length, cc = sc / cells.length;
  let spread = 0;
  for (const i of cells) spread += Math.hypot(Math.floor(i / N) - cr, (i % N) - cc);
  return -(g * 30) - spread * 3;
}

export function evaluate(s: LoaState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;
  return Math.round(metric(s.board, 0) - metric(s.board, 1));
}

const DEPTH: Record<Difficulty, number> = { tutor: 3, easy: 1, medium: 2, hard: 3, master: 4 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.85, medium: 0.4, hard: 0.08, master: 0 };

function searchAdapter() {
  return {
    getLegalMoves: (s: LoaState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: LoaState) => s.turn,
    isTerminal: (s: LoaState) => winnerOf(s) !== null,
    evaluate,
    order: (_s: LoaState, m: LoaMove) => (m.capture ? 40 : 0),
  };
}

const def: GameDefinition<LoaState, LoaMove> = {
  id: 'lines-of-action',
  name: 'Lines of Action',
  tagline: 'Move as far as the line is long — and pull your men into one connected band to win.',
  blurb:
    'A modern classic of pure strategy. Forget capturing the enemy king — here the goal is connection: gather all your men into a single group touching corner-to-corner. Every move travels exactly as many squares as there are pieces on its line, so the board itself is constantly rewriting your options. Deceptively simple, genuinely deep, and a favourite of abstract-game connoisseurs.',
  category: 'Abstract',
  depth: 4,
  emoji: '🔗',
  accent: '#0ea5e9',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#111827' },
    { id: 1, name: 'White', short: 'W', color: '#eef2f7' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },
  evalScale: 200,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `loa${i}-${p}`, kind: 'man', player: p },
    }));
    return {
      rows: N, cols: N, cells,
      fileLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      rankLabels: ['8', '7', '6', '5', '4', '3', '2', '1'],
    };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s);
    if (w !== null) return { kind: 'win', winner: w, reason: 'connected all men into one group' };
    if (legalMoves(s, null).length === 0) return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent has no legal move' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (pieces(s.board, 0).length + pieces(s.board, 1).length + s.turn + 1) * 2654435761;
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
    const gBefore = groupCount(before.board, mover);
    const gAfter = groupCount(after.board, mover);

    if (w === mover) {
      insights.push({ tag: 'Connected!', detail: 'Every one of your men now forms a single group — that wins the game.', tone: 'good' });
    } else if (w === (mover ^ 1)) {
      insights.push({ tag: 'Hands over the win', detail: 'This leaves the opponent connected (a lone man counts!) — they win.', tone: 'bad' });
    }
    if (gAfter < gBefore) {
      insights.push({ tag: 'Joins groups', detail: `Merges your men from ${gBefore} groups down to ${gAfter} — closer to a single band.`, tone: 'good' });
      principles.push('Reduce your group count: every move should pull stragglers toward the main mass.');
    } else if (gAfter > gBefore && w == null) {
      insights.push({ tag: 'Scatters', detail: 'Splits your men into more groups — usually the wrong direction.', tone: 'bad' });
    }
    if (move.capture) {
      const enemyLeft = pieces(after.board, (mover ^ 1) as Player).length;
      if (enemyLeft <= 1) insights.push({ tag: 'Over-capture', detail: 'Reducing the enemy toward a single man makes THEM connected — beware.', tone: 'bad' });
      else insights.push({ tag: 'Capture', detail: 'Removes an enemy man and can break up their formation — but thins the board.', tone: 'info' });
    }
    if (insights.length === 0) insights.push({ tag: 'Manoeuvre', detail: 'A quiet move that keeps your men working toward connection.', tone: 'info' });
    if (principles.length === 0) principles.push('Aim for the centre — central men are easier to connect than edge men.');

    const winningBig = Math.abs(moverPlayed) > 200;
    const band = w === mover ? 'best' : w === (mover ^ 1) ? 'blunder' : gradeByLoss(loss, winningBig);
    const summary =
      w === mover ? `${def.players[mover].name} connects every man and wins!`
      : move.capture ? `${def.players[mover].name} captures on ${sq(Math.floor(move.to / N), move.to % N)}.`
      : `${def.players[mover].name} plays ${move.notation}.`;
    const better = loss > 50 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined;

    return {
      summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles, betterIdea: better,
    };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    let text: string;
    if (winnerOf(after) === s.turn) text = `${res.move.notation} connects all your men — play it to win!`;
    else if (groupCount(after.board, s.turn) < groupCount(s.board, s.turn)) text = `${res.move.notation} merges your groups — the right direction.`;
    else if (res.move.capture) text = `${res.move.notation} captures to break up the enemy formation.`;
    else text = `${res.move.notation} is the engine's choice — keep gathering toward the centre.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Lines of Action, devised by Claude Soucie and popularised by Sid Sackson’s *A Gamut of Games*, is one of the purest connection games ever made. There is no king to trap and no territory to count — there is only your own little army, scattered around the rim of the board, and a single question: can you draw every one of your men together into one connected clump before your opponent does the same? The twist that makes it sing is the movement rule, where the length of every move is dictated by the pieces already on its line, so the board is forever reshaping what you can and cannot do.',
    objective:
      'Connect ALL of your men into a single group, where men count as joined if they touch horizontally, vertically OR diagonally (eight-way contact). The instant your last straggler links up, you win — it does not matter how spread out your opponent is. One important corollary: a single lone man is, by itself, a connected group, so if you ever capture your opponent down to one piece you hand them an immediate win. Connection, not destruction, is everything.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The armies', body: 'Black starts with **six men along the top row and six along the bottom row**; White starts with **six down the left column and six down the right**. The four corners begin empty. Black moves first. Notice that each side begins as **two separate lines** — your whole job is to merge them into one.' },
          { title: 'How far you move', body: 'A man moves in a straight line — **horizontally, vertically or diagonally** — and must travel **exactly as many squares as there are men (of either colour) standing on that entire line**. A piece on a line with three men moves exactly three squares. This is the rule that makes the game: every move’s length is set by the board.' },
          { title: 'Leaping and blocking', body: 'On its way, a man **may jump over your own men**, but it **may not jump over an enemy man** — an enemy anywhere between the start and the destination blocks the move entirely. The landing square itself must be **empty or hold an enemy** (never your own man).' },
          { title: 'Capturing', body: 'If a move lands exactly on an enemy man, that man is **captured and removed**. Capturing is never forced and is often a double-edged sword: it can shatter the enemy’s formation, but it also removes a piece from a line (changing future move lengths) and thins the board.' },
          { title: 'Winning: connection', body: 'You win the moment **all of your remaining men form one group**, connected through any of the eight directions. Diagonal contact counts! Here Black’s men all touch in a single connected band — that is a win.', setup: '{"board":[null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,0,0,0,0,null,null,null,null,0,0,0,0,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null],"turn":1}', highlight: [26, 27, 28, 29, 34, 35, 36, 37] },
        ],
      },
      {
        title: 'Strategy', icon: '🧭',
        steps: [
          { title: 'Head for the centre', body: 'Central men are far easier to connect than edge men — they have neighbours in every direction. A sound plan is to march your stragglers toward the **middle of the board**, building one growing clump rather than several scattered pairs.' },
          { title: 'Count your groups', body: 'At any moment, ask **how many separate groups** your men form. You start with two. Good moves lower that number; you have won when it reaches **one**. Treat “group count” as your score and drive it down every turn.' },
          { title: 'Lines change as you move', body: 'Because move length depends on how crowded a line is, **emptying or filling a line changes everyone’s options** — yours and your opponent’s. A capture that removes a man from a busy file shortens every move on it. Always re-count the line before you commit.' },
          { title: 'The over-capture trap', body: 'A lone man is connected, so **capturing your opponent down to a single piece loses instantly**. More subtly, captures can *help* your opponent connect by pulling their pieces together. Capture to disrupt a near-connected enemy or to clear your own path — not just for the sake of it.' },
          { title: 'Blocking', body: 'Since enemy men block movement, you can **park a man in the path** your opponent needs, freezing a key piece. Defensive blocking buys time to complete your own connection — but don’t strand the blocker too far from your main group.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          { title: 'Connect to win', body: 'Time to play. **Click a man, then its destination.** Your men are nearly together — find the move that links every Black man into a single connected group and win on the spot.', setup: '{"board":[null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,null,null,null,0,null,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,1,null],"turn":0}',
            challenge: { prompt: 'Black to play — connect every man into one group.', solution: ['d5-b5', 'd5-b3', 'a4-b3', 'a4-b5'], success: 'That links your stragglers into the main group — all your men now form a single connected band, which wins the game on the spot.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — flagging when you join or scatter your groups, warning you off the over-capture trap, while the evaluation bar shows whose army is closer to connecting. Step the engine up to Master and try to win the race to one group.' },
        ],
      },
    ],
  },
};

export default def;
