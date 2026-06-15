import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Pente — five-in-a-row with teeth. Played on the 13×13 intersections of a
 * board, Pente keeps Gomoku's goal (be first to line up five) but adds the
 * famous *custodial capture*: drop a stone so that two of your stones bracket
 * exactly two enemy stones — YOU · OPP · OPP · YOU — along any of the eight
 * directions, and that flanked pair is lifted from the board and banked as one
 * captured pair. Bank five pairs and you also win.
 *
 * The capture rule is wonderfully asymmetric: it fires only for the stone you
 * just placed. That means you may *safely* drop a stone into the gap between two
 * enemy stones (moving "into" a pair) — you are never captured for completing
 * the bracket yourself; only the bracketing player's placement triggers it.
 *
 * As in our Gomoku, two move generators live here. The public `getLegalMoves`
 * offers every empty point so the human can place anywhere; the AI search adapter
 * only considers empty points near existing stones (Chebyshev ≤ 2), ordered by a
 * cheap local-pattern + capture score so alpha-beta prunes hard.
 */

export interface PenteState {
  board: (Player | null)[]; // 169 cells, row-major (13×13)
  turn: Player;
  /** Pairs captured by [player0, player1]. */
  captures: [number, number];
  last: number; // index of the last move played, -1 if none
}
interface PenteMove extends MoveBase {}

const SIZE = 13;
const CELLS = SIZE * SIZE; // 169
const CENTER = 84; // (6,6) -> "G7"
const NEED = 5; // stones in a row to win
const PAIRS_TO_WIN = 5; // captured pairs to win

/** Column letters A–M (one per file on a 13-wide board). */
const COLS = 'ABCDEFGHIJKLM';
const rc = (i: number): [number, number] => [Math.floor(i / SIZE), i % SIZE];
/** Human point name, e.g. cell (row 6, col 6) -> "G7". Columns A–M, rows 1–13. */
function pointName(i: number): string {
  const [r, c] = rc(i);
  return `${COLS[c]}${r + 1}`;
}
const sideName = (p: Player) => (p === 0 ? 'Black' : 'White');

/** The four line directions for five-in-a-row scans, as (dRow, dCol). */
const DIRS: Array<[number, number]> = [
  [0, 1],  // horizontal
  [1, 0],  // vertical
  [1, 1],  // ↘ diagonal
  [1, -1], // ↗ diagonal
];

/** All eight directions for custodial-capture scans. */
const DIRS8: Array<[number, number]> = [
  [0, 1], [0, -1],
  [1, 0], [-1, 0],
  [1, 1], [-1, -1],
  [1, -1], [-1, 1],
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

/** Any five-in-a-row anywhere on the board for `player` (used after captures may
 *  have shifted shapes; cheap enough on 13×13). */
function hasFiveAnywhere(board: (Player | null)[], player: Player): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (board[i] === player && fiveThrough(board, i, player)) return true;
  }
  return false;
}

/**
 * The pairs that placing `player`'s stone at `idx` would capture: scan all eight
 * directions for the custodial pattern YOU(at idx) · OPP · OPP · YOU. Returns the
 * indices of the captured enemy stones (always an even count — two per direction
 * captured). EXACTLY two enemy stones are taken per direction: a three-in-the-row
 * bracketed by your stones is NOT captured.
 *
 * `board` is read as if the stone at `idx` already belongs to `player`.
 */
function capturedBy(board: (Player | null)[], idx: number, player: Player): number[] {
  const opp = (player ^ 1) as Player;
  const [r0, c0] = rc(idx);
  const out: number[] = [];
  for (const [dr, dc] of DIRS8) {
    const r1 = r0 + dr, c1 = c0 + dc;       // first enemy
    const r2 = r0 + dr * 2, c2 = c0 + dc * 2; // second enemy
    const r3 = r0 + dr * 3, c3 = c0 + dc * 3; // bracketing own stone
    if (!inBounds(r1, c1) || !inBounds(r2, c2) || !inBounds(r3, c3)) continue;
    const i1 = r1 * SIZE + c1, i2 = r2 * SIZE + c2, i3 = r3 * SIZE + c3;
    if (board[i1] === opp && board[i2] === opp && board[i3] === player) {
      out.push(i1, i2);
    }
  }
  return out;
}

/** Winner of the whole position, or null. A win is five-in-a-row OR five pairs. */
function winnerOf(s: PenteState): Player | null {
  if (s.captures[0] >= PAIRS_TO_WIN) return 0;
  if (s.captures[1] >= PAIRS_TO_WIN) return 1;
  if (s.last >= 0) {
    const who = s.board[s.last];
    if (who !== null && fiveThrough(s.board, s.last, who)) return who;
  }
  // Captures may have created/exposed a line for either side that doesn't pass
  // through `last`; a cheap full scan keeps the status honest.
  if (hasFiveAnywhere(s.board, 0)) return 0;
  if (hasFiveAnywhere(s.board, 1)) return 1;
  return null;
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

/** Build the placement move at `i`, carrying any captured stones in `affected`. */
function makeMove(s: PenteState, i: number): PenteMove {
  // Probe captures on a board where i is already the mover's stone.
  const probe = s.board.slice();
  probe[i] = s.turn;
  const caps = capturedBy(probe, i, s.turn);
  const note = caps.length
    ? `${sideName(s.turn)} at ${pointName(i)} (captures ${caps.length / 2})`
    : `${sideName(s.turn)} at ${pointName(i)}`;
  const m: PenteMove = { id: `p${i}`, to: i, notation: note };
  if (caps.length) { m.affected = caps; m.capture = true; }
  return m;
}

/* ------------------------------ Apply --------------------------------- */

function apply(s: PenteState, m: PenteMove): PenteState {
  const board = s.board.slice();
  const mover = s.turn;
  board[m.to] = mover;
  // Remove captured stones (recompute if the move didn't carry them).
  const caps = m.affected ?? capturedBy(board, m.to, mover);
  for (const c of caps) board[c] = null;
  const captures: [number, number] = [s.captures[0], s.captures[1]];
  captures[mover] += caps.length / 2; // each flanked pair counts as one
  return { board, turn: (mover ^ 1) as Player, captures, last: m.to };
}

/* ------------------------ Pattern evaluation -------------------------- */

/**
 * Sliding-window line scoring from player 0's view, exactly as in Gomoku: a
 * length-NEED window that contains only one colour is still winnable and earns
 * an escalating bonus; a mixed window is dead and scores 0. Captured pairs and
 * capture pressure are added on top in `evaluate`.
 */
const SCORE_MINE = [0, 4, 40, 220, 1400]; // 0..4 of mine in an otherwise-empty window
const SCORE_THEIRS = [0, 4, 40, 220, 1400];

/** Value of one banked pair toward the long-term assessment. */
const PAIR_VALUE = 120;
/** Bonus for a capture threat we have ready / penalty for an exposed pair. */
const CAPTURE_THREAT = 70;
const EXPOSED_PAIR = 90;

/** Count how many enemy pairs `player` could capture *next* move (capture threats),
 *  and how many of `player`'s own pairs sit exposed to an enemy custodial capture. */
function capturePressure(board: (Player | null)[], player: Player): { threats: number; exposed: number } {
  const opp = (player ^ 1) as Player;
  let threats = 0, exposed = 0;
  for (let i = 0; i < CELLS; i++) {
    if (board[i] !== null) continue;
    // If WE played here, how many enemy pairs would we capture?
    board[i] = player;
    threats += capturedBy(board, i, player).length / 2;
    // If the OPPONENT played here, how many of OUR pairs would they capture?
    board[i] = opp;
    exposed += capturedBy(board, i, opp).length / 2;
    board[i] = null;
  }
  return { threats, exposed };
}

function evaluate(s: PenteState): number {
  // Pair-count wins short-circuit to ±WIN, discounted by stones so a faster win
  // outscores a slower one (mirrors the five-in-a-row discount below).
  let stones = 0;
  for (let i = 0; i < CELLS; i++) if (s.board[i] !== null) stones++;
  if (s.captures[0] >= PAIRS_TO_WIN) return WIN - stones;
  if (s.captures[1] >= PAIRS_TO_WIN) return -WIN + stones;

  // A completed five short-circuits to ±WIN, discounted by stone count so that a
  // win reached sooner scores better than the same win reached later. The
  // discount (≤ 169) is tiny next to WIN, so a five dwarfs every shape.
  const w = winnerOf(s);
  if (w !== null) return w === 0 ? WIN - stones : -WIN + stones;

  const board = s.board;
  let score = 0;

  // Sliding length-NEED windows over all four line directions.
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

  // Banked pairs: a strong, permanent advantage (and progress toward the pair win).
  score += (s.captures[0] - s.captures[1]) * PAIR_VALUE;

  // Capture pressure: reward standing capture threats, punish exposed pairs.
  const p0 = capturePressure(board, 0);
  const p1 = capturePressure(board, 1);
  score += p0.threats * CAPTURE_THREAT - p0.exposed * EXPOSED_PAIR;
  score -= p1.threats * CAPTURE_THREAT - p1.exposed * EXPOSED_PAIR;

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
  let fr = r0 + dr, fc = c0 + dc;
  while (inBounds(fr, fc) && board[fr * SIZE + fc] === player) { len++; fr += dr; fc += dc; }
  const openF = inBounds(fr, fc) && board[fr * SIZE + fc] === null;
  let br = r0 - dr, bc = c0 - dc;
  while (inBounds(br, bc) && board[br * SIZE + bc] === player) { len++; br -= dr; bc -= dc; }
  const openB = inBounds(br, bc) && board[br * SIZE + bc] === null;
  return { len, ends: (openF ? 1 : 0) + (openB ? 1 : 0) };
}

interface ThreatSummary {
  five: boolean;
  fours: number;      // immediate winning threats (length-4 with ≥1 open end)
  openThrees: number; // length-3 runs open on both ends (forcing)
}

/** Summarise the line threats `player` has *through the stone at `idx`*. */
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
    getLegalMoves: (s: PenteState): PenteMove[] => {
      if (winnerOf(s) !== null) return [];
      return candidates(s.board).map((i) => makeMove(s, i));
    },
    applyMove: apply,
    getTurn: (s: PenteState) => s.turn,
    isTerminal: (s: PenteState) => winnerOf(s) !== null || isFull(s.board),
    evaluate,
    order: (s: PenteState, m: PenteMove): number => moveOrderScore(s, m.to),
  };
}

/** Cheap heuristic for ordering a candidate cell (higher = examine first). */
function moveOrderScore(s: PenteState, i: number): number {
  const me = s.turn;
  const opp = (me ^ 1) as Player;
  const board = s.board;

  board[i] = me;
  const mine = threatsAt(board, i, me);
  const myCaps = capturedBy(board, i, me).length / 2; // pairs I'd grab here
  board[i] = opp;
  const theirs = threatsAt(board, i, opp);
  const theirCaps = capturedBy(board, i, opp).length / 2; // pairs they'd grab here
  board[i] = null;

  let sc = 0;
  if (mine.five) sc += 100000;
  if (theirs.five) sc += 90000;       // blocking a five is nearly as urgent
  // A capture that reaches five pairs is game-winning; weight captures highly.
  const myPairsNow = s.captures[me];
  if (myCaps > 0 && myPairsNow + myCaps >= PAIRS_TO_WIN) sc += 95000;
  sc += myCaps * 1500 + theirCaps * 1300; // grabbing / denying captures
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

const def: GameDefinition<PenteState, PenteMove> = {
  id: 'pente',
  name: 'Pente',
  tagline: 'Five in a row — or capture five pairs. Bracket your foe and the stones are yours.',
  blurb: 'Pente takes the elegant five-in-a-row race and arms it with the custodial capture: flank exactly two enemy stones between two of your own and they vanish from the board, banked as a captured pair. Win by lining up five — or by snatching five pairs. Every stone is both a builder and a target, so attack and defence intertwine into one of the sharpest abstract duels ever invented.',
  category: 'Abstract',
  depth: 4,
  emoji: '🔵',
  accent: '#6366f1',
  players: [
    { id: 0, name: 'Black', short: 'B', color: '#0f172a' },
    { id: 1, name: 'White', short: 'W', color: '#f8fafc' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'stone', showCoordinates: true, checkered: false, intersections: true },

  createInitialState: () => ({ board: Array(CELLS).fill(null), turn: 0, captures: [0, 0], last: -1 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn, captures: [s.captures[0], s.captures[1]], last: s.last }),

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
    if (s.captures[0] >= PAIRS_TO_WIN) return { kind: 'win', winner: 0, reason: 'five pairs captured' };
    if (s.captures[1] >= PAIRS_TO_WIN) return { kind: 'win', winner: 1, reason: 'five pairs captured' };
    const w = winnerOf(s);
    if (w !== null) return { kind: 'win', winner: w, reason: 'five in a row' };
    if (isFull(s.board)) return { kind: 'draw', reason: 'the board is full' };
    return { kind: 'playing' };
  },

  // Public move list: the human may place on ANY empty intersection.
  getLegalMoves(s, _from): PenteMove[] {
    if (winnerOf(s) !== null) return [];
    const moves: PenteMove[] = [];
    for (let i = 0; i < CELLS; i++) {
      if (s.board[i] === null) moves.push(makeMove(s, i));
    }
    return moves;
  },

  applyMove: apply,

  chooseMove(s, difficulty) {
    if (winnerOf(s) !== null) return null;
    const stones = s.board.filter((c) => c !== null).length;
    if (stones === 0) return makeMove(s, CENTER); // open on the center point
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
    // move's searched score), falling back to a static eval only if the move
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

    // Capture facts for the move just played.
    const capturedNow = (move.affected?.length ?? 0) / 2;
    const pairsAfter = after.captures[mover];
    // Did the mover leave a freshly capturable pair for the opponent next move?
    const exposedAfter = countExposedPairs(after.board, mover);
    // Did the mover create a standing capture threat of their own?
    const captureThreats = countCaptureThreats(after.board, mover);

    const isOpening = stones === 0;
    const won = winnerOf(after) === mover;
    const wonByPairs = won && pairsAfter >= PAIRS_TO_WIN;
    const doubleThreat =
      mine.fours >= 2 || (mine.fours >= 1 && mine.openThrees >= 1) || mine.openThrees >= 2;

    if (won) {
      insights.push({
        tag: 'Winning move',
        detail: wonByPairs
          ? 'Banks the fifth captured pair — game over.'
          : 'Completes five in a row — game over.',
        tone: 'good',
      });
    }
    if (isOpening && move.to === CENTER) {
      insights.push({ tag: 'Center opening', detail: 'The center point (G7) touches the most lines and gives Black the freest development.', tone: 'good' });
      principles.push("Open in the center — Black's first-move advantage is greatest there.");
    }

    if (capturedNow > 0 && !won) {
      insights.push({
        tag: capturedNow > 1 ? `Captures ${capturedNow} pairs!` : 'Captures a pair!',
        detail: `Brackets ${capturedNow > 1 ? capturedNow + ' enemy pairs' : 'an enemy pair'} and lifts ${capturedNow * 2} stones — now ${pairsAfter}/${PAIRS_TO_WIN} pairs. Captures both gain ground and can shatter the opponent's lines.`,
        tone: 'good',
      });
      principles.push('Use captures to break enemy lines and march toward the five-pair win.');
      if (pairsAfter === PAIRS_TO_WIN - 1) {
        threats.push('One more captured pair wins the game — the opponent must avoid exposing any pair.');
      }
    }

    if (!won && doubleThreat) {
      const kind = mine.fours >= 2 ? 'double four'
        : mine.fours >= 1 && mine.openThrees >= 1 ? 'four-three'
        : 'double open three';
      insights.push({ tag: 'Double threat!', detail: `Creates a ${kind} — two separate ways to make five. The opponent can stop only one.`, tone: 'good' });
      principles.push('Win by building a double threat (four-three or double-four): one defender, two threats.');
      threats.push(`A ${kind} is on the board — at least one line will reach five next.`);
    } else if (!won && mine.fours >= 1) {
      insights.push({ tag: 'Makes a four', detail: 'Four in a row with an open end — a forcing threat the opponent must answer at once.', tone: 'good' });
      threats.push('Threatens to complete five next move.');
    } else if (!won && mine.openThrees >= 1) {
      insights.push({ tag: 'Open three', detail: 'Three in a row open at both ends — if ignored it becomes an unstoppable open four.', tone: 'good' });
      principles.push('The open three is a forcing move: it must be answered or it turns into an open four.');
      threats.push('Threatens to grow into an open four.');
    }

    if (!won && captureThreats > 0 && capturedNow === 0) {
      insights.push({
        tag: captureThreats > 1 ? 'Capture threats' : 'Capture threat',
        detail: `Sets up ${captureThreats > 1 ? captureThreats + ' custodial captures' : 'a custodial capture'} — next move you can bracket an enemy pair and remove it.`,
        tone: 'good',
      });
      threats.push('Threatens to capture an enemy pair by flanking it.');
    }

    // Defence: did the mover need to block a line, and did they?
    if (oppBest.fours >= 1) {
      if (blocked.fours) {
        insights.push({ tag: 'Blocks a four', detail: "Stops the opponent's four — failing to do so loses on the spot.", tone: 'good' });
        principles.push("Always block the opponent's four immediately.");
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

    // Vulnerability warning: did this move leave a capturable pair behind?
    if (!won && exposedAfter > 0) {
      insights.push({
        tag: 'Exposes a pair',
        detail: `Leaves ${exposedAfter > 1 ? exposedAfter + ' of your pairs' : 'a pair of your stones'} flanked-on-one-side — the opponent can drop a stone to bracket and capture ${exposedAfter > 1 ? 'them' : 'it'}. Avoid lining up two stones with both bracketing points open.`,
        tone: 'bad',
      });
      principles.push('Never leave a contiguous pair with both bracketing points open — it can be captured.');
      threats.push('A pair of your stones is capturable next move.');
    }

    const winningBig = Math.abs(moverPlayed) > 1000;
    let band: MoveExplanation['band'] = won ? 'best' : gradeByLoss(loss, winningBig);
    // Reward genuinely strong, hard-to-find ideas.
    if (!won && doubleThreat && loss <= 20) {
      band = mine.fours >= 2 || (mine.fours >= 1 && mine.openThrees >= 1) ? 'brilliant' : 'great';
    } else if (!won && capturedNow >= 2 && loss <= 20) {
      band = 'brilliant'; // a double capture in one stone is a showpiece
    } else if (!won && capturedNow >= 1 && loss <= 20) {
      band = 'great';
    }

    if (band === 'blunder' || band === 'mistake') {
      insights.push({ tag: 'Lets the initiative slip', detail: 'A stronger reply kept control; this hands the opponent the attack.', tone: 'bad' });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Develops', detail: 'A sound placement that extends your shape and keeps options open.', tone: 'info' });
    }

    const summary =
      wonByPairs ? `${sideName(mover)} captures a fifth pair and wins!`
      : won ? `${sideName(mover)} lines up five in a row and wins!`
      : capturedNow > 0 ? `${sideName(mover)} plays ${pointName(move.to)} and captures ${capturedNow > 1 ? capturedNow + ' pairs' : 'a pair'}.`
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
      return { move: makeMove(s, CENTER), text: 'Open on the center point (G7) — it gives the most room to attack in every direction.' };
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
    const capturedNow = (res.move.affected?.length ?? 0) / 2;
    const pairsAfter = after.captures[me];
    const captureThreats = countCaptureThreats(after.board, me);

    let text: string;
    if (mine.five) {
      text = `Play ${pointName(res.move.to)} — it completes five in a row and wins.`;
    } else if (capturedNow > 0 && pairsAfter >= PAIRS_TO_WIN) {
      text = `Play ${pointName(res.move.to)} — it captures your fifth pair and wins the game.`;
    } else if (capturedNow > 0) {
      text = `Play ${pointName(res.move.to)} — it brackets and captures ${capturedNow > 1 ? capturedNow + ' enemy pairs' : 'an enemy pair'} (now ${pairsAfter}/${PAIRS_TO_WIN}).`;
    } else if (mine.fours >= 2 || (mine.fours >= 1 && mine.openThrees >= 1)) {
      text = `Play ${pointName(res.move.to)} — it makes a double threat the opponent cannot fully block.`;
    } else if (oppBest.fours >= 1 && blocked.fours) {
      text = `Play ${pointName(res.move.to)} — you must block the opponent's four or you lose.`;
    } else if (mine.fours >= 1) {
      text = `Play ${pointName(res.move.to)} — it makes a four, forcing the opponent to defend.`;
    } else if (captureThreats > 0) {
      text = `Play ${pointName(res.move.to)} — it threatens a custodial capture, pressuring an enemy pair.`;
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
    overview: 'Pente, invented in 1977, fuses the clean five-in-a-row race with a capturing twist borrowed from ancient Go-family games. Stones go on the intersections of a 13×13 grid; Black plays first, and every turn places one stone. The added rule — the custodial pair capture — transforms a familiar game into a sharp, two-edged battle where every stone you place is both an arrow and a potential prisoner. This course covers both roads to victory, dissects the capture rule and its surprising safety quirk, then teaches the exposed pair, capture-as-defence, and the double threat — before handing you a live trainer where you make five, capture a pair and block a four yourself.',
    objective: 'Win in one of two ways: line up five (or more) of your stones in an unbroken row — horizontal, vertical, or diagonal — OR capture five pairs of enemy stones. Both paths race at once, so you must build your lines while guarding your stones from capture.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          { title: 'The board', body: 'Play on the **intersections** of a 13×13 grid — 169 points. Columns are lettered **A–M**, rows numbered **1–13**, so the centre is **G7**. Black plays first, then players alternate, each placing one stone per turn. Stones never move once placed (though they can be captured and removed).' },
          { title: 'Win with five in a row', body: 'Make a row of **five of your stones** in a line: across, down, or on either diagonal. A line of six or more also wins — you simply need at least five adjacent stones with no gaps. As in Gomoku, this is one path to victory.', highlight: [82, 83, 84, 85, 86] },
          { title: 'Win with five pairs', body: 'The second path: capturing **five pairs** (ten enemy stones in all) wins the game outright, even with no line of five. Your captured-pair count is shown beside the board; the two races — to five-in-a-row and to five pairs — run in parallel, and your opponent is sprinting down both at once too.' },
          { title: 'The draw', body: 'If all 169 intersections fill and neither side has five in a row or five captured pairs, the game is a draw — rare, since captures keep opening the board and an attacker usually breaks through first.' },
        ],
      },
      {
        title: 'The Custodial Capture', icon: '⚔️',
        steps: [
          { title: 'Bracket the pair', body: 'The signature rule. Place a stone so the pattern reads **YOU · OPP · OPP · YOU** along any of the eight directions — your new stone, then exactly two enemy stones in a row, then another of your stones already on the board — and those **two flanked enemy stones are lifted off** and banked as one captured pair.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,1,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"captures":[0,0],"last":86}', highlight: [83, 84, 85, 86] },
          { title: 'Only pairs — never one, never three', body: 'Capture takes **exactly two** stones. A *single* enemy stone bracketed YOU·OPP·YOU is safe; a *run of three* bracketed YOU·OPP·OPP·OPP·YOU is also safe. The custodial rule fires only for an enemy pair of precisely two.', highlight: [84, 85] },
          { title: 'It fires only on YOUR placement', body: 'Crucially, a capture happens only for the **stone you just placed** — the bracketing player triggers it. Stones already sitting in a YOU·OPP·OPP·YOU shape from earlier moves are *not* retroactively captured; the pattern must be *completed by the flanker\'s new stone*.', highlight: [83, 86] },
          { title: 'You may move INTO a pair safely', body: 'This leads to Pente\'s famous quirk: you can **safely drop a stone between two enemy stones**. If you place into the middle of OPP · _ · OPP, completing the bracket *yourself*, you are **not** captured — only the player who lays the *outer* flanking stone captures. Moving into the jaws is legal and often strong.', highlight: [83, 84, 85, 86] },
          { title: 'Captures can swing the game', body: 'Each captured pair both advances you toward the five-pair win *and* removes two enemy stones from the board — potentially shattering a line they were building. A well-timed capture is offence and defence in a single stone, which is why captures dominate Pente tactics.' },
        ],
      },
      {
        title: 'Winning Strategy', icon: '🧠',
        steps: [
          { title: 'Beware the exposed pair', body: 'A **contiguous pair of your stones with both bracketing points open** is a target: an enemy stone already sits on one end, so the opponent simply drops on the other end and your pair vanishes. Here Black\'s pair on G7–H7 is flanked by White on F7 — one White stone on I7 captures it. Avoid lining up two stones with both ends exposed near enemy stones.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":1,"captures":[0,0],"last":83}', highlight: [84, 85], arrows: [{ from: 86, to: 86, tone: 'bad' }] },
          { title: 'Captures break lines', body: 'Because a capture removes two stones, it can **shatter an enemy line** instantly — a pair of stones the opponent is building with can be *captured away* rather than merely blocked. Spotting a capture that also defuses a threat is often the single strongest move on the board: defence and gain in one stroke. Here White wants to play I7 to make a four (G7-H7-I7-J7); instead Black plays **I7 first**, bracketing the White pair G7–H7 between F7 and the new stone, lifting both off and wrecking the line in one move.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,1,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"captures":[0,0],"last":87}', highlight: [84, 85], arrows: [{ from: 86, to: 86, tone: 'good' }] },
          { title: 'The open three', body: 'As in Gomoku, three in a row with **both ends empty** is an open three — left alone it becomes an unstoppable open four. It is a forcing move your opponent must answer… *unless* they can answer it with a capture instead, removing two of its stones. Always check whether your open three sits on capturable pairs.', highlight: [83, 84, 85] },
          { title: 'The four', body: 'Four in a row with an open end threatens five immediately — your opponent must block it at once or lose. But beware: a four whose stones include a capturable pair can be **broken by capture** rather than blocked, so a four is not always as safe as it looks. Build fours that are not also exposed pairs.', highlight: [82, 83, 84, 85] },
          { title: 'The double threat wins', body: 'Make **two threats in one move** — a four-three, a double four, or, uniquely to Pente, a **line threat paired with a capture threat**. The opponent defends only one; you carry out the other. Weaving line threats together with capture threats is the very heart of Pente — a capture that also makes a four is often unstoppable.' },
          { title: "Black's edge", body: 'Moving first is a genuine advantage, sharper here than in Gomoku because the first capture can swing momentum hard. Open in the center (G7), build toward a double threat, keep your pairs guarded, and watch for captures that break the opponent\'s lines — that is the winning recipe.', highlight: [CENTER] },
        ],
      },
      {
        title: 'Capture & Threat Trainer', icon: '🎯',
        steps: [
          { title: 'How to play a puzzle', body: 'Time to put it together. In each puzzle you play **Black**. **Click the empty intersection** where you want your stone. Find the point described — making five, capturing a pair, or blocking a four — and the trainer confirms it.' },
          { title: 'Make five in a row', body: 'Black has four stones across the centre, with the left end blocked by White. There is exactly one point that completes five. Place it — and note it does not expose you to any capture.', setup: '{"board":[1,1,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,0,0,0,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"captures":[0,0],"last":83}', highlight: [88], challenge: { prompt: 'Black to play — complete five in a row and win.', solution: ['Black at K7'], success: 'Black at K7 makes five across row 7 — game over. Five in a row ends the game instantly, capture race or not.' } },
          { title: 'Capture a pair', body: 'The move that makes Pente Pente. Black already sits on F7; White has a pair on G7–H7. Drop the stone that completes the YOU · OPP · OPP · YOU bracket and lift the pair off the board.', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"captures":[0,0],"last":85}', highlight: [86], challenge: { prompt: 'Black to play — capture the White pair with a custodial bracket.', solution: ['Black at I7 (captures 1)', 'Black at I7'], success: 'Black at I7 brackets the White pair G7–H7 (YOU·OPP·OPP·YOU) and lifts both stones — one pair banked. Captures remove enemy stones and march you toward the five-pair win.' } },
          { title: 'Block the four', body: 'Now defend. White has four in a row with the left end already plugged; one square would give White five. Take it. (Here a plain block is the move — White\'s four is not a capturable pair.)', setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,1,1,1,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,0,null,0,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"turn":0,"captures":[0,0],"last":87}', highlight: [88], challenge: { prompt: 'Black to play — block White\'s four before it makes five.', solution: ['Black at K7'], success: 'Black at K7 plugs the only square where White could reach five. In Pente, always check first whether you can break a four by capture — but when you cannot, block the open end at once.' } },
          { title: 'Keep training', body: 'In a real game the AI tutor grades **every** stone you play — naming captures and capture threats, exposed pairs you leave behind, fours and forks, and threats you missed — from Brilliant to Blunder, and shows the stronger move when you slip. Play at rising difficulty, read each note, and Pente\'s two-edged tactics will sharpen fast.' },
        ],
      },
    ],
  },
};

/* ----------------------- explainMove helpers -------------------------- */

/** The opponent's strongest standing LINE threat before the mover replied. */
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

/** Did placing the mover's stone at `idx` sit on the opponent's key line square? */
function didBlock(beforeBoard: (Player | null)[], afterBoard: (Player | null)[], idx: number, opp: Player): { fours: boolean; openThrees: boolean } {
  const probe = beforeBoard.slice();
  probe[idx] = opp;
  const t = threatsAt(probe, idx, opp);
  return {
    fours: t.fours >= 1 || t.five,
    openThrees: t.openThrees >= 1,
  };
}

/** How many of `player`'s pairs the opponent could capture on their very next move. */
function countExposedPairs(board: (Player | null)[], player: Player): number {
  const opp = (player ^ 1) as Player;
  const work = board.slice();
  let total = 0;
  for (let i = 0; i < CELLS; i++) {
    if (work[i] !== null) continue;
    work[i] = opp;
    total += capturedBy(work, i, opp).length / 2;
    work[i] = null;
  }
  return total;
}

/** How many enemy pairs `player` could capture on their very next move. */
function countCaptureThreats(board: (Player | null)[], player: Player): number {
  const work = board.slice();
  let total = 0;
  for (let i = 0; i < CELLS; i++) {
    if (work[i] !== null) continue;
    work[i] = player;
    total += capturedBy(work, i, player).length / 2;
    work[i] = null;
  }
  return total;
}

export default def;
