import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Breakthrough — a modern abstract strategy game (Dan Troyka, 2000), played on
 * an 8×8 board. Each side has two ranks of identical pawns. A pawn moves one
 * square straight or diagonally FORWARD to an empty square, but captures ONLY
 * diagonally forward. First player to land a pawn on the opponent's home rank
 * wins (also winning if the opponent is eliminated or has no legal move). No
 * backward moves, no pawn promotion — pure racing and blocking.
 *
 * Board indexing matches chess: index = row*8 + col, row 0 is the top (rank 8).
 * Player 0 ("White") starts on rows 6–7 and advances toward row 0.
 * Player 1 ("Black") starts on rows 0–1 and advances toward row 7.
 */

const N = 8;
export interface BtState {
  board: (Player | null)[]; // 64 cells, row-major; null = empty
  turn: Player;
}
interface BtMove extends MoveBase {}

const forwardOf = (p: Player) => (p === 0 ? -1 : +1); // White moves up (row→0), Black down (row→7)
const goalRowOf = (p: Player) => (p === 0 ? 0 : N - 1);
const homeRows = (p: Player) => (p === 0 ? [6, 7] : [0, 1]);

const inBounds = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const idx = (r: number, c: number) => r * N + c;
const sq = (r: number, c: number) => `${String.fromCharCode(97 + c)}${N - r}`;

export function initialState(): BtState {
  const board: (Player | null)[] = Array(N * N).fill(null);
  for (const r of homeRows(0)) for (let c = 0; c < N; c++) board[idx(r, c)] = 0;
  for (const r of homeRows(1)) for (let c = 0; c < N; c++) board[idx(r, c)] = 1;
  return { board, turn: 0 };
}

function pieceCount(board: (Player | null)[], p: Player): number {
  let n = 0;
  for (const v of board) if (v === p) n++;
  return n;
}

/** Has a pawn of `p` reached the opponent's home rank? */
function reachedGoal(board: (Player | null)[], p: Player): boolean {
  const gr = goalRowOf(p);
  for (let c = 0; c < N; c++) if (board[idx(gr, c)] === p) return true;
  return false;
}

function legalMoves(s: BtState, from?: number | null): BtMove[] {
  // No moves once the game is decided by reaching a goal rank or elimination.
  if (reachedGoal(s.board, 0) || reachedGoal(s.board, 1)) return [];
  const p = s.turn;
  const dir = forwardOf(p);
  const out: BtMove[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (s.board[idx(r, c)] !== p) continue;
      const f = idx(r, c);
      if (from != null && from !== f) continue;
      const nr = r + dir;
      if (!inBounds(nr, c) && c === c) { /* nr off board only when at goal already; skip */ }
      // Straight forward: only onto an EMPTY square (never a capture).
      if (inBounds(nr, c) && s.board[idx(nr, c)] === null) {
        out.push(mkMove(f, idx(nr, c), false, p));
      }
      // Diagonals: onto empty (move) or enemy (capture); never onto own.
      for (const dc of [-1, 1]) {
        const tc = c + dc;
        if (!inBounds(nr, tc)) continue;
        const t = idx(nr, tc);
        const occ = s.board[t];
        if (occ === null) out.push(mkMove(f, t, false, p));
        else if (occ !== p) out.push(mkMove(f, t, true, p));
      }
    }
  }
  return out;
}

function mkMove(from: number, to: number, capture: boolean, _p: Player): BtMove {
  const fr = Math.floor(from / N), fc = from % N, tr = Math.floor(to / N), tc = to % N;
  return {
    id: `${from}-${to}`,
    from, to, capture,
    notation: `${sq(fr, fc)}${capture ? 'x' : '-'}${sq(tr, tc)}`,
    affected: capture ? [to] : undefined,
  };
}

function apply(s: BtState, m: BtMove): BtState {
  const board = s.board.slice();
  board[m.from!] = null;
  board[m.to] = s.turn; // captures simply overwrite the enemy pawn
  return { board, turn: (s.turn ^ 1) as Player };
}

function winnerOf(s: BtState): Player | null {
  if (reachedGoal(s.board, 0)) return 0;
  if (reachedGoal(s.board, 1)) return 1;
  if (pieceCount(s.board, 0) === 0) return 1;
  if (pieceCount(s.board, 1) === 0) return 0;
  return null;
}

function searchAdapter() {
  return {
    getLegalMoves: (s: BtState) => legalMoves(s, null),
    applyMove: apply,
    getTurn: (s: BtState) => s.turn,
    isTerminal: (s: BtState) => winnerOf(s) !== null,
    evaluate,
    order: (_s: BtState, m: BtMove) => (m.capture ? 1000 : 0) + (m.to), // captures & advanced squares first
  };
}

/* --------------------------------- eval --------------------------------- */

/** How many of `p`'s pawns guard square (r,c) (i.e. could recapture there). */
function defendersOf(board: (Player | null)[], p: Player, r: number, c: number): number {
  const back = -forwardOf(p); // a defender sits one rank *behind* in the diagonals
  let n = 0;
  for (const dc of [-1, 1]) {
    const dr = r + back, dcc = c + dc;
    if (inBounds(dr, dcc) && board[idx(dr, dcc)] === p) n++;
  }
  return n;
}
function attackersOf(board: (Player | null)[], p: Player, r: number, c: number): number {
  // Enemy pawns of (p^1) that attack (r,c): they sit one of *their* ranks behind it.
  const e = (p ^ 1) as Player;
  const back = -forwardOf(e);
  let n = 0;
  for (const dc of [-1, 1]) {
    const dr = r + back, dcc = c + dc;
    if (inBounds(dr, dcc) && board[idx(dr, dcc)] === e) n++;
  }
  return n;
}

/**
 * Static evaluation, + favours player 0. Combines material, advancement
 * (weighted heavily near the goal — a pawn one step away is almost a win),
 * and safety (a pawn attacked more than it is defended is a liability).
 */
export function evaluate(s: BtState): number {
  const w = winnerOf(s);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;

  const board = s.board;
  let score = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = board[idx(r, c)];
      if (v === null) continue;
      const sign = v === 0 ? 1 : -1;
      // distance advanced toward the goal: 0 at the home rank … 7 at the goal.
      const adv = v === 0 ? 7 - r : r;
      let val = 100; // material
      val += adv * adv * 1.6; // advancement, accelerating toward the goal
      if (adv >= 5) val += 40; // deep penetration is a serious threat
      // Safety: undefended pawns that are attacked are likely to fall.
      const def = defendersOf(board, v, r, c);
      const att = attackersOf(board, v, r, c);
      if (att > def) val -= 35 * (att - def);
      else if (def > 0) val += 6; // supported pawns hold the line
      score += sign * val;
    }
  }
  // Central files are slightly more valuable (more diagonals to work with).
  return Math.round(score);
}

const DEPTH: Record<Difficulty, number> = { tutor: 5, easy: 1, medium: 3, hard: 5, master: 6 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.85, medium: 0.4, hard: 0.08, master: 0 };

/* ------------------------------- tutor bits ------------------------------ */

function nearestToGoal(board: (Player | null)[], p: Player): number {
  // Largest advancement among p's pawns (0..7).
  let best = -1;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (board[idx(r, c)] === p) best = Math.max(best, p === 0 ? 7 - r : r);
  }
  return best;
}

const def: GameDefinition<BtState, BtMove> = {
  id: 'breakthrough',
  name: 'Breakthrough',
  tagline: 'Race an army of pawns across the board — first to break through wins.',
  blurb:
    'A modern abstract gem with rules you learn in a minute and depth that rewards a lifetime. Every pawn moves and captures like a chess pawn with no promotion — so the whole game is a knife-edge race of attack, defence and timing. Push too hard and your runners get cut down; defend too passively and you get overrun. Our engine and move-by-move tutor turn that tension into a masterclass.',
  category: 'Abstract',
  depth: 4,
  emoji: '⚔️',
  accent: '#14b8a6',
  players: [
    { id: 0, name: 'White', short: 'W', color: '#eef2f7' },
    { id: 1, name: 'Black', short: 'B', color: '#0f172a' },
  ],
  interaction: { type: 'move' },
  render: { pieceStyle: 'checker', showCoordinates: true, checkered: true },
  evalScale: 500,

  createInitialState: initialState,
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / N), col: i % N,
      piece: p === null ? null : { id: `bt${i}-${p}`, kind: 'man', player: p },
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
    if (w !== null) {
      const reason = reachedGoal(s.board, w) ? 'broke through to the home rank'
        : 'captured every enemy pawn';
      return { kind: 'win', winner: w, reason };
    }
    // No legal move = loss for the side to move (rare, but a real rule).
    if (legalMoves(s, null).length === 0) {
      return { kind: 'win', winner: (s.turn ^ 1) as Player, reason: 'opponent has no legal move' };
    }
    return { kind: 'playing' };
  },

  getLegalMoves: (s, from) => legalMoves(s, from),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const seed = (pieceCount(s.board, 0) + pieceCount(s.board, 1) + s.turn + 1) * 2654435761;
    const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], { randomness: RAND[difficulty], rng: mulberry32(seed) });
    return res.move;
  },

  evaluate,

  liveEval(s) {
    const w = winnerOf(s);
    if (w !== null) return { score: w === 0 ? WIN : -WIN, depth: 0 };
    const r = searchBestMove(s, searchAdapter(), 4); // score is already + favours player 0
    return { score: Math.round(r.score), depth: 4 };
  },

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const res = searchBestMove(before, searchAdapter(), DEPTH.tutor);
    // Search scores are "+ favours player 0"; flip into the mover's perspective.
    const toMover = (sc: number) => (mover === 0 ? sc : -sc);
    const moverPlayed = toMover(evaluate(after));
    const bestForMover = res.ranked.length ? toMover(res.ranked[0].score) : moverPlayed;
    const playedForMover = toMover(res.ranked.find((r) => r.move.id === move.id)?.score ?? evaluate(after));
    const loss = Math.max(0, bestForMover - playedForMover);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const threats: string[] = [];

    const w = winnerOf(after);
    const tr = Math.floor(move.to / N);
    const tc = move.to % N;

    if (w === mover) {
      insights.push({ tag: 'Breakthrough!', detail: 'A pawn reaches the home rank — the game is won.', tone: 'good' });
    }
    if (move.capture) {
      insights.push({ tag: 'Capture', detail: 'Removes an enemy pawn diagonally — the only way Breakthrough pawns take.', tone: 'good' });
    }
    const def0 = defendersOf(after.board, mover, tr, tc);
    const att0 = attackersOf(after.board, mover, tr, tc);
    if (att0 > def0 && w !== mover) {
      insights.push({ tag: 'Hanging pawn', detail: 'This pawn is attacked more times than it is defended — it can be captured for free.', tone: 'bad' });
      principles.push('Advance pawns in supported phalanxes, not as lone runners.');
    } else if (def0 > 0) {
      insights.push({ tag: 'Supported', detail: 'The pawn is defended by a friend behind it, so a capture can be answered.', tone: 'good' });
    }
    const adv = mover === 0 ? 7 - tr : tr;
    if (adv >= 5 && w !== mover) {
      insights.push({ tag: 'Deep advance', detail: 'Pushing into the enemy camp — a real promotion threat that must be answered.', tone: 'good' });
      threats.push('Threatens to march on toward the home rank.');
    }
    if (adv <= 1 && !move.capture) {
      principles.push('Keep your back ranks intact — gaps behind become highways for the enemy.');
    }

    const winningBig = Math.abs(moverPlayed) > 600;
    const band = w === mover ? 'best' : gradeByLoss(loss, winningBig);
    if (band === 'blunder' || band === 'mistake') {
      insights.push({ tag: 'Loosens the position', detail: 'A stronger move kept more control — this hands the opponent a real chance.', tone: 'bad' });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Develops', detail: 'A sound advance that improves the position without overreaching.', tone: 'info' });
    }
    if (principles.length === 0) principles.push('Win the race by one tempo: count how many moves each side needs to break through.');

    const summary =
      w === mover ? `${def.players[mover].name} breaks through and wins!`
      : move.capture ? `${def.players[mover].name} captures on ${sq(tr, tc)}.`
      : `${def.players[mover].name} advances to ${sq(tr, tc)}.`;

    const better = loss > 60 && res.move && res.move.id !== move.id ? `Stronger was ${res.move.notation}.` : undefined;

    return {
      summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles, threats: threats.length ? threats : undefined, betterIdea: better,
    };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    let text: string;
    if (winnerOf(after) === s.turn) text = `${res.move.notation} breaks through to win — play it!`;
    else if (res.move.capture) text = `${res.move.notation} captures a pawn and keeps the initiative.`;
    else {
      const adv = nearestToGoal(after.board, s.turn);
      text = adv >= 5 ? `${res.move.notation} pushes a runner deep — a strong promotion threat.`
        : `${res.move.notation} is the engine's choice — advance with support.`;
    }
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview:
      'Breakthrough was invented by Dan Troyka in 2000 and promptly won the 8×8 Game Design Competition — proof that a truly great game needs almost no rules. Each side commands sixteen identical pawns, two full ranks of them, and the entire contest is a single question asked over and over: can I get one pawn to the far side before you do? Because the pawns capture only on the diagonal, every advance is also an exposure, and every defence is also a commitment. The result is a tense, fast, deeply tactical race that plays beautifully on the same 8×8 board as chess.',
    objective:
      'Be the first to move one of your pawns onto the opponent\'s home rank — the row their pawns started on. You also win if you capture every enemy pawn, or if your opponent is left with no legal move. There is no promotion and no draw by stalemate of material: someone always breaks through. The whole skill is in *timing and support* — racing where you are faster, blocking where you are slower, and never sending a runner the enemy can simply cut down.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The armies', body: 'Both sides start with **sixteen pawns**, filling their nearest **two ranks**. White sits on the bottom two rows and races **upward**; Black sits on the top two rows and races **downward**. Every pawn is identical — there are no other pieces and no kings.' },
          { title: 'Moving a pawn', body: 'On your turn you move **one pawn one square forward** — either **straight ahead** or **diagonally forward** — onto an **empty** square. Pawns never move sideways or backward. That is the whole movement rule.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [26, 27, 28] },
          { title: 'Capturing', body: 'Pawns capture **only diagonally forward**, exactly like a chess pawn — never straight ahead. A pawn directly in front of you is a **roadblock you cannot take**; you must go around it or capture into it from the side. This single asymmetry is the heart of all Breakthrough tactics.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,1,1,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [27], arrows: [{ from: 35, to: 26, tone: 'good' }, { from: 35, to: 28, tone: 'good' }] },
          { title: 'How you win', body: 'The instant one of your pawns lands on the **opponent\'s home rank** (their starting row), you **win**. You also win if you capture every enemy pawn, or if it is the opponent\'s turn and they have **no legal move**. There is no promotion — reaching the end *is* the goal.' },
          { title: 'No draws', body: 'Breakthrough cannot be drawn. Pawns only ever move forward, so the position keeps advancing and someone is always getting closer to the far rank. Every game ends in a win — which is exactly why **tempo** (who gets there first) decides everything.' },
        ],
      },
      {
        title: 'Race & Tempo', icon: '🏁',
        steps: [
          { title: 'Count the race', body: 'A pawn needs to travel its remaining rows to break through. Before committing to an attack, **count the moves** you need versus the moves your opponent needs on the other wing. If you arrive even **one tempo** sooner, the race is yours — push it through.' },
          { title: 'Columns are highways', body: 'An **empty file** in front of a pawn is a clear highway to the goal. Watch for files where the enemy has no defenders left; a pawn there can sprint home. Equally, guard your own files — a single hole in your back ranks can be fatal.' },
          { title: 'Attack on the wing', body: 'Edge files (the a- and h-files) are dangerous attacking lanes because an edge pawn can only be defended from **one** diagonal, not two. Many breakthroughs come down the flank where the defender simply runs out of guards.', highlight: [0, 8, 7, 15] },
          { title: 'Don\'t race a losing race', body: 'If counting shows the opponent is faster on their wing, **do not** keep pushing your slower attack — you will just lose the race. Switch to **defence**: bring pawns back into guarding diagonals and force them to spend extra moves breaking through.' },
        ],
      },
      {
        title: 'Phalanx & Defence', icon: '🛡️',
        steps: [
          { title: 'Three defend, two attack', body: 'The golden rule: it takes **three defenders** to reliably stop **two attackers** on a file. When you assault, mass your pawns; when you defend, make sure each forward pawn has friends behind it on **both** diagonals so a capture can always be answered.' },
          { title: 'The phalanx', body: 'Advance pawns **side by side**, supporting one another, rather than as lone runners. A connected wall of pawns defends every square in front of it. A lone pawn poking forward, by contrast, is usually just a free capture waiting to happen.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}', highlight: [42, 43, 44] },
          { title: 'Defended vs hanging', body: 'A pawn is **safe** when at least as many friendly pawns guard its square as enemy pawns attack it. A pawn that is attacked more than it is defended is **hanging** — the opponent simply takes it and comes out ahead. Our tutor flags hanging pawns the moment you create one.' },
          { title: 'Sacrifice to open a file', body: 'Advanced players give up a pawn deliberately: a well-timed capture or push **removes a key defender**, opening a file your next runner sprints through. If your sacrifice costs the enemy more tempo than it costs you, it is worth it.' },
          { title: 'Trade when ahead in the race', body: 'If you are winning the race, **trade pawns** to simplify — fewer pieces means fewer defenders for them and a clearer run for you. If you are behind, keep pawns on to retain defenders and complicate the position.' },
        ],
      },
      {
        title: 'Tactics Trainer', icon: '🎯',
        steps: [
          { title: 'Break through', body: 'Time to play. **Click your pawn, then its destination.** Your pawn on a7 has a clear, empty file ahead — take the final step onto the home rank and win.', setup: '{"board":[null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null],"turn":0}',
            challenge: { prompt: 'White to play — break through to the home rank.', solution: ['a7-a8'], success: 'a7-a8 lands on the home rank and wins instantly. The first question every turn is simply: can I break through right now?' } },
          { title: 'Capture your way in', body: 'The square straight ahead is blocked, but Breakthrough pawns take on the diagonal. Find the capture that lands you on the home rank.', setup: '{"board":[1,1,1,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0}',
            challenge: { prompt: 'White to play — capture onto the home rank to win.', solution: ['b7xa8', 'b7xc8'], success: 'A diagonal capture onto the back rank breaks through. When the file ahead is blocked, look for an enemy pawn to take your way in.' } },
          { title: 'Cut down the runner', body: 'Black is one step from breaking through on b2. If you do nothing, Black wins next move. Capture the runner before it promotes.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,0,null,0,null,null,null,null,null],"turn":0}',
            challenge: { prompt: 'White to play — stop Black from breaking through.', solution: ['a1xb2', 'c1xb2'], success: 'Capturing the b2 runner removes the threat. After "can I win?", always ask "can my opponent win?" — and cut down any pawn one step from your home rank.' } },
          { title: 'Keep training', body: 'In a full game the tutor grades **every** move — flagging hanging pawns, missed captures, and the stronger advance when you misfire, while the evaluation bar shows who is winning the race. Step up the difficulty: on Master the engine counts the race perfectly and punishes a single loose pawn.' },
        ],
      },
    ],
  },
};

export default def;
