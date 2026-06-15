import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Gomoku (Five in a Row), a.k.a. Gobang. Played on the 15×15 intersections of
 * a Go board. Black moves first; the first side to line up five or more of its
 * own stones in an unbroken horizontal, vertical or diagonal row wins.
 *
 * Two move generators live here. The public `getLegalMoves` offers *every*
 * empty point so the human can place a stone anywhere. The AI, however, would
 * drown in a 225-wide branching factor, so its search adapter only considers
 * empty points near existing stones (Chebyshev distance ≤ 2), ordered by a
 * cheap local-pattern score so alpha-beta prunes hard.
 */

export interface GomokuState {
  board: (Player | null)[]; // 225 cells, row-major (15×15)
  turn: Player;
  last: number; // index of the last move played, -1 if none
}
interface GomokuMove extends MoveBase {}

const SIZE = 15;
const CELLS = SIZE * SIZE; // 225
const CENTER = 112; // (7,7)
const NEED = 5; // stones in a row to win

/** Column letters A–O (no I-skipping here; the Go convention varies, we use A–O). */
const COLS = 'ABCDEFGHIJKLMNO';
const rc = (i: number): [number, number] => [Math.floor(i / SIZE), i % SIZE];
/** Human point name, e.g. cell (row 7, col 7) -> "H8". Columns A–O, rows 1–15. */
function pointName(i: number): string {
  const [r, c] = rc(i);
  return `${COLS[c]}${r + 1}`;
}
const sideName = (p: Player) => (p === 0 ? 'Black' : 'White');

/** The four line directions as (dRow, dCol). */
const DIRS: Array<[number, number]> = [
  [0, 1],  // horizontal
  [1, 0],  // vertical
  [1, 1],  // ↘ diagonal
  [1, -1], // ↗ diagonal
];

const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

/** Does `player` have five-or-more in a row passing through cell `idx`? */
function fiveThrough(board: (Player | null)[], idx: number, player: Player): boolean {
  const [r0, c0] = rc(idx);
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (let s = 1; ; s++) {
      const r = r0 + dr * s, c = c0 + dc * s;
      if (!inBounds(r, c) || board[r * SIZE + c] !== player) break;
      count++;
    }
    for (let s = 1; ; s++) {
      const r = r0 - dr * s, c = c0 - dc * s;
      if (!inBounds(r, c) || board[r * SIZE + c] !== player) break;
      count++;
    }
    if (count >= NEED) return true;
  }
  return false;
}

/** Winner of the whole position (only the last move could have made a five). */
function winnerOf(s: GomokuState): Player | null {
  if (s.last < 0) return null;
  const who = s.board[s.last];
  if (who === null) return null;
  return fiveThrough(s.board, s.last, who) ? who : null;
}

const isFull = (board: (Player | null)[]) => board.every((c) => c !== null);

/* ----------------------- AI candidate generation ---------------------- */

/** Empty points within Chebyshev distance 2 of some stone; center if empty board. */
function candidates(board: (Player | null)[]): number[] {
  let any = false;
  const mark = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === null) continue;
    any = true;
    const [r, c] = rc(i);
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r2 = r + dr, c2 = c + dc;
        if (inBounds(r2, c2)) {
          const j = r2 * SIZE + c2;
          if (board[j] === null) mark[j] = 1;
        }
      }
    }
  }
  if (!any) return [CENTER];
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (mark[i]) out.push(i);
  return out.length ? out : [CENTER];
}

function makeMove(s: GomokuState, i: number): GomokuMove {
  return { id: `p${i}`, to: i, notation: `${sideName(s.turn)} at ${pointName(i)}` };
}

/* ------------------------------ Apply --------------------------------- */

function apply(s: GomokuState, m: GomokuMove): GomokuState {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player, last: m.to };
}

/* ------------------------ Pattern evaluation -------------------------- */

/**
 * Score a single contiguous "window" of NEED cells from player 0's view.
 * A window is only meaningful if it does not contain *both* colours: a mixed
 * window can never become a five for either side, so it's dead and scores 0.
 *
 * `mine` = stones of player 0 in the window, `theirs` = stones of player 1.
 * Open-ended runs (we approximate openness with the window-sliding itself,
 * since a 5-window that's full of one colour already *is* a five) get
 * escalating bonuses. Symmetric for the opponent (negative).
 */
const SCORE_MINE = [0, 4, 40, 220, 1400]; // 0..4 stones of mine in an empty-otherwise window
const SCORE_THEIRS = [0, 4, 40, 220, 1400];

function evaluate(s: GomokuState): number {
  // A completed five short-circuits to ±WIN. We discount the magnitude by the
  // number of stones on the board so that a win reached *sooner* scores better
  // than the same win reached later (and a loss suffered later scores better
  // than one suffered now). Without this, deeper searches treat "win now" and
  // "win in three plies" as identical ±WIN and may dawdle instead of finishing
  // — or, worse, fail to take an immediate win / block an immediate four. The
  // discount (≤ 225) is tiny next to WIN, so a five still dwarfs every shape.
  const w = winnerOf(s);
  if (w !== null) {
    let stones = 0;
    for (let i = 0; i < CELLS; i++) if (s.board[i] !== null) stones++;
    return w === 0 ? WIN - stones : -WIN + stones;
  }

  const board = s.board;
  let score = 0;

  // Slide a length-NEED window along every line in all four directions and
  // sum the window scores. Each real five-window would have already been
  // caught above, so here we reward partial, still-winnable windows.
  for (const [dr, dc] of DIRS) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const er = r + dr * (NEED - 1), ec = c + dc * (NEED - 1);
        if (!inBounds(er, ec)) continue;
        let mine = 0, theirs = 0;
        for (let k = 0; k < NEED; k++) {
          const v = board[(r + dr * k) * SIZE + (c + dc * k)];
          if (v === 0) mine++;
          else if (v === 1) theirs++;
        }
        if (mine > 0 && theirs > 0) continue; // dead window
        if (mine > 0) score += SCORE_MINE[mine];
        else if (theirs > 0) score -= SCORE_THEIRS[theirs];
      }
    }
  }
  return score;
}

/* ---------------------- Threat / shape detection ---------------------- */

/**
 * Examine the maximal run of `player`'s stones through `idx` in one direction,
 * returning its length and how many of the two ends are open (empty, in-bounds).
 */
function runInfo(board: (Player | null)[], idx: number, player: Player, dr: number, dc: number) {
  const [r0, c0] = rc(idx);
  let len = 1;
  // forward
  let fr = r0 + dr, fc = c0 + dc;
  while (inBounds(fr, fc) && board[fr * SIZE + fc] === player) { len++; fr += dr; fc += dc; }
  const openF = inBounds(fr, fc) && board[fr * SIZE + fc] === null;
  // backward
  let br = r0 - dr, bc = c0 - dc;
  while (inBounds(br, bc) && board[br * SIZE + bc] === player) { len++; br -= dr; bc -= dc; }
  const openB = inBounds(br, bc) && board[br * SIZE + bc] === null;
  return { len, ends: (openF ? 1 : 0) + (openB ? 1 : 0) };
}

interface ThreatSummary {
  five: boolean;
  fours: number;       // lines that are an immediate winning threat (length-4, ≥1 open end, or any "open" 4)
  openThrees: number;  // length-3 runs open on both ends (a forcing threat)
}

/** Summarise the threats `player` has *through the stone at `idx`* (the move just played). */
function threatsAt(board: (Player | null)[], idx: number, player: Player): ThreatSummary {
  let five = false, fours = 0, openThrees = 0;
  for (const [dr, dc] of DIRS) {
    const { len, ends } = runInfo(board, idx, player, dr, dc);
    if (len >= NEED) { five = true; continue; }
    if (len === 4 && ends >= 1) fours++;
    else if (len === 3 && ends === 2) openThrees++;
  }
  return { five, fours, openThrees };
}

/** Best threat description a *single new stone at idx* would give `player`. */
function totalThreats(board: (Player | null)[], idx: number, player: Player): ThreatSummary {
  return threatsAt(board, idx, player);
}

/* ------------------------------ Search -------------------------------- */

function searchAdapter() {
  return {
    getLegalMoves: (s: GomokuState): GomokuMove[] => {
      if (winnerOf(s) !== null) return [];
      return candidates(s.board).map((i) => makeMove(s, i));
    },
    applyMove: apply,
    getTurn: (s: GomokuState) => s.turn,
    isTerminal: (s: GomokuState) => winnerOf(s) !== null || isFull(s.board),
    evaluate,
    // Order candidates by the local pattern value of placing there for the
    // side to move, plus proximity to the last stone, so alpha-beta prunes.
    order: (s: GomokuState, m: GomokuMove): number => moveOrderScore(s, m.to),
  };
}

/** Cheap heuristic for ordering a candidate cell (higher = examine first). */
function moveOrderScore(s: GomokuState, i: number): number {
  const me = s.turn;
  const opp = (me ^ 1) as Player;
  const board = s.board;
  board[i] = me;
  const mine = threatsAt(board, i, me);
  board[i] = opp;
  const theirs = threatsAt(board, i, opp);
  board[i] = null;

  let sc = 0;
  if (mine.five) sc += 100000;
  if (theirs.five) sc += 90000; // blocking a five is nearly as urgent
  sc += mine.fours * 1200 + theirs.fours * 1000;
  sc += mine.openThrees * 300 + theirs.openThrees * 250;

  // Proximity to the last move keeps the action local.
  if (s.last >= 0) {
    const [r1, c1] = rc(i), [r2, c2] = rc(s.last);
    sc += 30 - (Math.abs(r1 - r2) + Math.abs(c1 - c2));
  }
  return sc;
}

const DEPTH: Record<Difficulty, number> = { tutor: 4, easy: 1, medium: 2, hard: 3, master: 4 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.8, medium: 0.4, hard: 0.08, master: 0 };

/* --------------------------- Definition ------------------------------- */

const def: GameDefinition<GomokuState, GomokuMove> = {
  id: 'gomoku',
  name: 'Gomoku',
  tagline: 'Five in a row on a 15×15 grid — easy to learn, a lifetime to master.',
  blurb: 'Gomoku (a.k.a. Gobang) is the purest race of threats: place your stones on the intersections and be the first to line up five in a row. Behind that simple goal hides a razor-sharp game of forcing moves — the open three and the four are weapons, and weaving them into an unstoppable double threat is how games are won.',
  category: 'Abstract',
  depth: 4,
  emoji: '⚫',
  accent: '#0ea5e9',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#0f172a' },
    { id: 1, name: 'White', short: 'W', color: '#f8fafc' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'stone', showCoordinates: true, checkered: false, intersections: true },

  createInitialState: () => ({ board: Array(CELLS).fill(null), turn: 0, last: -1 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, last: s.last }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / SIZE), col: i % SIZE,
      piece: p === null ? null : { id: `c${i}`, kind: 'stone', player: p, glyph: p === 0 ? '⚫' : '⚪' },
    }));
    const fileLabels = COLS.split('');
    const rankLabels = Array.from({ length: SIZE }, (_, i) => String(i + 1));
    return { rows: SIZE, cols: SIZE, cells, fileLabels, rankLabels };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s);
    if (w !== null) return { kind: 'win', winner: w, reason: 'five in a row' };
    if (isFull(s.board)) return { kind: 'draw', reason: 'the board is full' };
    return { kind: 'playing' };
  },

  // Public move list: the human may place on ANY empty intersection.
  getLegalMoves(s, _from): GomokuMove[] {
    if (winnerOf(s) !== null) return [];
    const moves: GomokuMove[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (s.board[i] === null) moves.push(makeMove(s, i));
    }
    return moves;
  },

  applyMove: apply,

  chooseMove(s, difficulty) {
    if (winnerOf(s) !== null) return null;
    const stones = s.board.filter((c) => c !== null).length;
    if (stones === 0) return makeMove(s, CENTER); // open on the star point
    const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
      randomness: RAND[difficulty],
      rng: mulberry32((stones + 1) * 2654435761),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opp = (mover ^ 1) as Player;
    const adapter = searchAdapter();

    // Grade by comparing the played move to the best candidate move (shallow).
    const stones = before.board.filter((c) => c !== null).length;
    const res = searchBestMove(before, adapter, 3, {
      rng: mulberry32((stones + 1) * 2654435761),
    });
    // Grade the played move by its OWN searched score (comparable to the best
    // move's searched score). Falling back to a static eval only if the move
    // wasn't among the searched candidates (a far-flung human placement).
    const playedEntry = res.ranked.find((r) => r.move.id === move.id);
    const playedEval = playedEntry ? playedEntry.score : evaluate(after);
    const bestEval = res.ranked[0]?.score ?? playedEval;
    const moverPlayed = mover === 0 ? playedEval : -playedEval;
    const moverBest = mover === 0 ? bestEval : -bestEval;
    const loss = Math.max(0, moverBest - moverPlayed);

    const insights: MoveExplanation['insights'] = [];
    const principles: string[] = [];
    const threats: string[] = [];

    // What did this stone create / what was threatened before it?
    const mine = totalThreats(after.board, move.to, mover);
    const oppBest = bestOppThreatBefore(before.board, opp);
    const blocked = didBlock(before.board, after.board, move.to, opp);

    const isOpening = stones === 0;
    const won = winnerOf(after) === mover;
    const doubleThreat =
      mine.fours >= 2 || (mine.fours >= 1 && mine.openThrees >= 1) || mine.openThrees >= 2;

    if (won) {
      insights.push({ tag: 'Winning move', detail: 'Completes five in a row — game over.', tone: 'good' });
    }
    if (isOpening && move.to === CENTER) {
      insights.push({ tag: 'Center opening', detail: 'The star point (H8) touches the most lines and gives Black the freest development.', tone: 'good' });
      principles.push("Open on or near the center — Black's first-move advantage is greatest there.");
    }

    if (!won && doubleThreat) {
      const kind = mine.fours >= 2 ? 'double four'
        : mine.fours >= 1 && mine.openThrees >= 1 ? 'four-three'
        : 'double open three';
      insights.push({ tag: 'Double threat!', detail: `Creates a ${kind} — two separate ways to make five. The opponent can stop only one.`, tone: 'good' });
      principles.push('Win by building a double threat (four-three or double-four): one defender, two threats.');
      threats.push(`A ${kind} is on the board — at least one line will reach five next.`);
    } else if (!won && mine.fours >= 1) {
      insights.push({ tag: 'Makes a four', detail: 'Four in a row with an open end — a forcing threat the opponent must answer immediately.', tone: 'good' });
      threats.push('Threatens to complete five next move.');
    } else if (!won && mine.openThrees >= 1) {
      insights.push({ tag: 'Open three', detail: 'Three in a row open at both ends — if ignored it becomes an unstoppable open four.', tone: 'good' });
      principles.push('The open three is a forcing move: it must be blocked or it turns into an open four.');
      threats.push('Threatens to grow into an open four.');
    }

    // Defence: did the mover need to block, and did they?
    if (oppBest.fours >= 1) {
      if (blocked.fours) {
        insights.push({ tag: 'Blocks a four', detail: "Stops the opponent's four — failing to do so loses on the spot.", tone: 'good' });
        principles.push('Always block the opponent\'s four immediately.');
      } else if (!won) {
        insights.push({ tag: 'Ignores a four', detail: 'The opponent had a four and this did not stop it — they can now make five.', tone: 'bad' });
      }
    } else if (oppBest.openThrees >= 1) {
      if (blocked.openThrees) {
        insights.push({ tag: 'Blocks an open three', detail: "Neutralises the opponent's open three before it becomes an open four.", tone: 'good' });
        principles.push("Block the opponent's open three before it forces you.");
      } else if (!won && !doubleThreat && mine.fours === 0) {
        insights.push({ tag: 'Lets a three run', detail: 'The opponent had an open three that is still open — expect a four next.', tone: 'bad' });
      }
    }

    const winningBig = Math.abs(moverPlayed) > 1000;
    let band: MoveExplanation['band'] = won ? 'best' : gradeByLoss(loss, winningBig);
    // Reward genuinely strong, hard-to-find double threats.
    if (!won && doubleThreat && loss <= 20) band = mine.fours >= 2 || (mine.fours >= 1 && mine.openThrees >= 1) ? 'brilliant' : 'great';

    if (band === 'blunder' || band === 'mistake') {
      insights.push({ tag: 'Lets the initiative slip', detail: 'A stronger reply kept control; this hands the opponent the attack.', tone: 'bad' });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Develops', detail: 'A sound placement that extends your shape and keeps options open.', tone: 'info' });
    }

    const summary =
      won ? `${sideName(mover)} lines up five in a row and wins!`
      : doubleThreat ? `${sideName(mover)} plays ${pointName(move.to)} and builds a double threat.`
      : mine.fours >= 1 ? `${sideName(mover)} plays ${pointName(move.to)}, making a forcing four.`
      : mine.openThrees >= 1 ? `${sideName(mover)} plays ${pointName(move.to)}, creating an open three.`
      : blocked.fours ? `${sideName(mover)} plays ${pointName(move.to)} to block a four.`
      : `${sideName(mover)} plays ${pointName(move.to)}.`;

    return {
      summary, band,
      evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles,
      threats: threats.length ? threats : undefined,
      betterIdea: loss > 120 && res.move && res.move.to !== move.to
        ? `Stronger was ${pointName(res.move.to)}, which keeps the initiative.`
        : undefined,
    };
  },

  hint(s) {
    if (winnerOf(s) !== null) return null;
    const stones = s.board.filter((c) => c !== null).length;
    if (stones === 0) {
      return { move: makeMove(s, CENTER), text: 'Open on the center star point (H8) — it gives the most room to attack.' };
    }
    const res = searchBestMove(s, searchAdapter(), 3, {
      rng: mulberry32((stones + 1) * 2654435761),
    });
    if (!res.move) return null;

    const me = s.turn;
    const opp = (me ^ 1) as Player;
    const after = apply(s, res.move);
    const mine = totalThreats(after.board, res.move.to, me);
    const oppBest = bestOppThreatBefore(s.board, opp);
    const blocked = didBlock(s.board, after.board, res.move.to, opp);

    let text: string;
    if (mine.five) {
      text = `Play ${pointName(res.move.to)} — it completes five in a row and wins.`;
    } else if (mine.fours >= 2 || (mine.fours >= 1 && mine.openThrees >= 1)) {
      text = `Play ${pointName(res.move.to)} — it makes a double threat the opponent cannot fully block.`;
    } else if (oppBest.fours >= 1 && blocked.fours) {
      text = `Play ${pointName(res.move.to)} — you must block the opponent's four or you lose.`;
    } else if (mine.fours >= 1) {
      text = `Play ${pointName(res.move.to)} — it makes a four, forcing the opponent to defend.`;
    } else if (oppBest.openThrees >= 1 && blocked.openThrees) {
      text = `Play ${pointName(res.move.to)} — block the opponent's open three before it becomes a four.`;
    } else if (mine.openThrees >= 1) {
      text = `Play ${pointName(res.move.to)} — it creates an open three and seizes the initiative.`;
    } else {
      text = `Play ${pointName(res.move.to)} — the strongest building move here.`;
    }
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Gomoku — "five points" in Japanese, also known as Gobang — is the world\'s most popular five-in-a-row game. Stones go on the intersections of a 15×15 grid, and the rules fit in a sentence, yet the play is a fierce, tactical duel of threats and counter-threats. This course walks you from the placing rule through the open three and the four, the four-three and double-four forks that actually win games, the defence that keeps you alive, and why Black\'s first move is a genuine edge — then sets you loose on a live Threat Trainer.',
    objective: 'Be the first to get five (or more) of your own stones in an unbroken line — horizontally, vertically, or diagonally. If every intersection fills with no line of five, the game is a draw (rare).',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Play on the **intersections** of a 15×15 grid — 225 points in all. Black plays first, then players alternate, each placing one stone per turn. Stones never move once placed, so every stone you put down is permanent: choose carefully.' },
          { title: 'How to win', body: 'Make a row of **five of your stones** in a line: across, down, or on either diagonal. The very first player to do so wins immediately — the board need not be full.', highlight: [108, 109, 110, 111, 112] },
          { title: 'Five — or more', body: 'A line of six or more also wins; you simply need *at least* five adjacent stones of your colour with no gaps. A line broken by an empty point or an enemy stone does **not** count — so a single enemy stone dropped into your row neutralises it.' },
          { title: 'Notation: naming the points', body: 'Columns are lettered **A–O** from the left, rows numbered **1–15** from the top, so each intersection has a name like **H8** (the centre). The tutor and the trainer below name every move this way; the puzzles ask you to place at a specific point.', highlight: [CENTER] },
          { title: 'The center', body: 'Games begin in the middle. The center star point is **H8** — opening there gives Black the most space to build threats in every direction. Playing near the edge wastes half your potential lines.', highlight: [CENTER] },
          { title: 'The draw', body: 'If all 225 intersections fill and neither side has five in a row, the game is a draw. On the full 15×15 board this is rare — the board is large enough that an attacker usually breaks through first.' },
        ],
      },
      {
        title: 'Threats: Threes & Fours', icon: '🔍',
        steps: [
          { title: 'The open three', body: 'Three stones in a row with **both ends empty** is an *open three* (sometimes written ⚫⚫⚫ with daylight on each side). Left alone it becomes an open four — which cannot be stopped. So an open three is a **forcing move**: your opponent almost always has to answer it at once.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":1,"last":114}', highlight: [112, 113, 114] },
          { title: 'A closed three is harmless', body: 'If an enemy stone (or the board edge) already blocks one end, the three is *closed* — it can make only a four with a single open end, which is far less dangerous. Tell open threes from closed ones at a glance; only the open ones force a reply.' },
          { title: 'The four', body: 'Four in a row with an open end threatens five immediately. A *four* is the strongest single threat — your opponent **must** block it at once or lose on the very next move. Note that even a four blocked on one side still threatens five at its open end.', highlight: [111, 112, 113, 114] },
          { title: 'The open four is already winning', body: 'A four with **both** ends open (an "open four") is unstoppable: there are two squares that complete five and the opponent can plug only one. This is why an open three is so feared — left alone it grows directly into an open four. Never let an open three survive a turn.', highlight: [111, 112, 113, 114] },
        ],
      },
      {
        title: 'Winning Forks & Defence', icon: '🧠',
        steps: [
          { title: 'Why single threats are not enough', body: 'A lone four or open three is *forced* — the opponent simply answers it, and you have gained a tempo but not the game. To actually win you must create **two threats with a single stone**, so that one defender cannot cover both.' },
          { title: 'The four-three fork', body: 'The bread-and-butter winning shape: one stone that simultaneously makes a **four** (in one line) and an **open three** (in another). The opponent must stop the four; you then convert the three into an open four and win. Here Black\'s stone at H8 makes a horizontal four and a vertical open three at once.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":1,"last":127}', highlight: [111, 112, 113, 114], arrows: [{ from: 97, to: 112, tone: 'good' }, { from: 112, to: 127, tone: 'good' }] },
          { title: 'The double-four', body: 'Even stronger is the **double-four**: one stone completing two separate fours. The opponent can block only one, and the other makes five. Double-fours are rarer to set up but completely decisive — always check whether your move makes two fours.' },
          { title: 'You must defend', body: 'Attack is only half the game. Watch your opponent: **block every four immediately**, and block open threes before they grow into open fours. A missed four loses on the spot. Each turn, look at the opponent\'s threats *before* your own plans.', highlight: [111, 112, 113, 114] },
          { title: 'Defend by counter-attacking', body: 'The strongest defence is often a move that blocks **and** makes your own four or open three — forcing the opponent to defend in turn. Trading threat for threat, the player who first lands a fork wins. Passive blocking alone slowly loses.' },
          { title: "Black's first move", body: 'Moving first is a real edge — with perfect play, plain (free-style) Gomoku is a win for Black. To even the contest, competitive variants (Renju, Swap2, the pro rule) restrict Black\'s early moves. In this casual version, Black simply enjoys the head start, so as Black, attack; as White, defend accurately and wait for Black to overreach.', highlight: [CENTER] },
        ],
      },
      {
        title: 'Threat Trainer', icon: '🎯',
        steps: [
          { title: 'How to play a puzzle', body: 'Reading about threats is one thing — *finding* them is another. In each puzzle you play **Black**. **Click the empty intersection** where you want to place your stone. Find the point described and the trainer confirms it.' },
          { title: 'Make five in a row', body: 'Black has four stones in a row across the centre, with the left end already blocked by White. There is exactly one point that completes five. Place it.', setup: '{"board":[1,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"last":111}', highlight: [116], challenge: { prompt: 'Black to play — complete five in a row and win.', solution: ['Black at L8'], success: 'Black at L8 completes five across row 8 — game over. When you hold a four, the first thing to look for is the open end that finishes it.' } },
          { title: 'Block the four', body: 'Now defend. White has four in a row and threatens to make five next move; the left end is plugged, so there is one square White needs. Take it away.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,1,1,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"last":115}', highlight: [116], challenge: { prompt: 'Black to play — block White\'s four before it makes five.', solution: ['Black at L8'], success: 'Black at L8 plugs the only square where White could have reached five. A four must be blocked the instant it appears — scan for the opponent\'s threats before anything else.' } },
          { title: 'Find the diagonal five', body: 'The fours that win games most often are diagonal — they hide in plain sight. Black has four climbing the long diagonal, with the lower end blocked by White. Complete the five.', setup: '{"board":[1,1,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"last":144}', highlight: [64], challenge: { prompt: 'Black to play — complete the diagonal five and win.', solution: ['Black at E5'], success: 'Black at E5 finishes five on the long diagonal. Diagonal lines are the ones players overlook — train your eye to scan all four directions every move.' } },
          { title: 'Keep training', body: 'In a real game the AI tutor grades **every** stone you play — naming open threes, fours, four-three forks you build, and threats you missed — from Brilliant to Blunder, and shows the stronger move when you slip. Play at rising difficulty, read each note, and these shapes will become second nature.' },
        ],
      },
    ],
  },
};

/* ----------------------- explainMove helpers -------------------------- */

/** The opponent's strongest standing threat *before* the mover replied. We scan
 *  every empty point the opponent could complete a four/open-three through by
 *  inspecting their existing runs adjacent to empties. Cheap and good enough
 *  for tutoring: look at each opponent stone's runs. */
function bestOppThreatBefore(board: (Player | null)[], opp: Player): ThreatSummary {
  let fours = 0, openThrees = 0, five = false;
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== opp) continue;
    const t = threatsAt(board, i, opp);
    five = five || t.five;
    fours = Math.max(fours, t.fours);
    openThrees = Math.max(openThrees, t.openThrees);
  }
  return { five, fours, openThrees };
}

/** Did placing the mover's stone at `idx` reduce the opponent's best threat? We
 *  compare the opponent's strongest run touching `idx`'s line before and after. */
function didBlock(beforeBoard: (Player | null)[], afterBoard: (Player | null)[], idx: number, opp: Player): { fours: boolean; openThrees: boolean } {
  // Was idx an end-point of an opponent four / open three before our move?
  // Simulate: on the BEFORE board, the opponent owning idx would have run.
  const probe = beforeBoard.slice();
  probe[idx] = opp;
  const t = threatsAt(probe, idx, opp);
  // It "blocked a four/three" if the opponent could have used this very point
  // to extend a four or open three (i.e. our stone sits on their key square).
  return {
    fours: t.fours >= 1 || t.five,
    openThrees: t.openThrees >= 1,
  };
}

export default def;
