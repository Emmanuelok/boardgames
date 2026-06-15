import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

/**
 * Mancala — the ancient game of sowing, played here under the popular **Kalah**
 * rules. The board is two rows of six small pits plus a large "store" at each
 * end. Every pit starts with four stones (48 in all). On your turn you scoop up
 * all the stones from one of your own pits and "sow" them one at a time into the
 * pits ahead, dropping a stone in your own store along the way but skipping your
 * opponent's. Two rules give the game its bite: landing your last stone in your
 * own store earns you an **extra turn**, and landing it in an empty pit on your
 * own side **captures** that stone together with everything in the pit directly
 * opposite. When one side's pits run empty the other player sweeps their
 * remaining stones home, and whoever has gathered more stones wins.
 *
 * Logical state: { pits: number[14], turn: Player }.
 *   0–5   = South (player 0) pits, left→right
 *   6     = South store
 *   7–12  = North (player 1) pits
 *   13    = North store
 * South (player 0) moves first.
 */

export interface MancalaState {
  pits: number[]; // length 14
  turn: Player;
}
interface MancalaMove extends MoveBase {
  /** The logical pit index (0–5 for South, 7–12 for North) that is sown. */
  pit: number;
}

const SOUTH_STORE = 6;
const NORTH_STORE = 13;
const TOTAL_STONES = 48;

const sideName = (p: Player) => (p === 0 ? 'South' : 'North');
const ownStore = (p: Player) => (p === 0 ? SOUTH_STORE : NORTH_STORE);
const oppStore = (p: Player) => (p === 0 ? NORTH_STORE : SOUTH_STORE);

/** The six pit indices owned by a side. */
const pitsOf = (p: Player): number[] => (p === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);
/** Is `i` one of `player`'s own playing pits (not a store)? */
const isOwnPit = (p: Player, i: number) => (p === 0 ? i >= 0 && i <= 5 : i >= 7 && i <= 12);
/** The pit directly across from pit `i` on the 0–12 ring (stores excluded). */
const oppositePit = (i: number) => 12 - i;

/** Human label for a pit: South pits are numbered 1–6 left→right, likewise North. */
function pitLabel(pit: number): string {
  if (pit <= 5) return `pit ${pit + 1}`;        // South pits 0..5 → 1..6
  return `pit ${pit - 6}`;                       // North pits 7..12 → 1..6
}

/* --------------------------- Sowing mechanics ------------------------- */

/**
 * Advance one step counterclockwise from index `i` for `player`, skipping the
 * opponent's store. South ring: 0,1,2,3,4,5,6,7,8,9,10,11,12,(skip 13)→0.
 * North ring: 7,8,9,10,11,12,13,0,1,2,3,4,5,(skip 6)→7.
 */
function nextIndex(i: number, player: Player): number {
  let n = (i + 1) % 14;
  if (n === oppStore(player)) n = (n + 1) % 14; // never drop into the opponent's store
  return n;
}

/**
 * The result of resolving a sow: the new pit array, the side to move next (which
 * equals `mover` when an extra turn was earned), and a description of what
 * happened for the tutor.
 */
interface SowResult {
  pits: number[];
  nextTurn: Player;
  extraTurn: boolean;
  /** Stones captured into the mover's store this move (0 if no capture). */
  captured: number;
  /** The opposite pit emptied by a capture, or -1. */
  captureFrom: number;
  /** The pit the last stone landed in. */
  landed: number;
  /** Stones swept home at game end, by player (only when the game just ended). */
  swept?: { player: Player; amount: number };
  gameOver: boolean;
}

/** Are all of `player`'s playing pits empty? */
function sideEmpty(pits: number[], player: Player): boolean {
  return pitsOf(player).every((i) => pits[i] === 0);
}

/** Sweep every remaining playing stone into its owner's store (end of game). */
function sweep(pits: number[]): number[] {
  const out = pits.slice();
  for (const i of pitsOf(0)) { out[SOUTH_STORE] += out[i]; out[i] = 0; }
  for (const i of pitsOf(1)) { out[NORTH_STORE] += out[i]; out[i] = 0; }
  return out;
}

/**
 * Resolve sowing the chosen pit. Implements the full Kalah turn: distribute the
 * stones, apply the extra-turn and capture rules, then — if the move emptied the
 * mover's side or the opponent's — sweep the remaining stones and end the game.
 */
function sow(state: MancalaState, pit: number): SowResult {
  const mover = state.turn;
  const pits = state.pits.slice();
  let hand = pits[pit];
  pits[pit] = 0;

  let pos = pit;
  while (hand > 0) {
    pos = nextIndex(pos, mover);
    pits[pos] += 1;
    hand -= 1;
  }
  const landed = pos;

  let extraTurn = false;
  let captured = 0;
  let captureFrom = -1;

  if (landed === ownStore(mover)) {
    // Last stone in our own store → play again.
    extraTurn = true;
  } else if (isOwnPit(mover, landed) && pits[landed] === 1) {
    // Last stone fell into a previously empty pit on our side → capture.
    const across = oppositePit(landed);
    if (pits[across] > 0) {
      captured = pits[across] + 1; // the opposite pit plus our landing stone
      pits[ownStore(mover)] += captured;
      pits[across] = 0;
      pits[landed] = 0;
      captureFrom = across;
    }
  }

  // End-of-game: if either side now has no stones to sow, the other player
  // sweeps their remaining stones into their store and the game is over.
  let gameOver = false;
  let swept: { player: Player; amount: number } | undefined;
  let finalPits = pits;
  if (sideEmpty(pits, 0) || sideEmpty(pits, 1)) {
    gameOver = true;
    const loser: Player = sideEmpty(pits, 0) ? 0 : 1; // side that emptied first
    const sweeper = (loser ^ 1) as Player;
    const remaining = pitsOf(sweeper).reduce((a, i) => a + pits[i], 0);
    if (remaining > 0) swept = { player: sweeper, amount: remaining };
    finalPits = sweep(pits);
  }

  const nextTurn: Player = gameOver ? mover : (extraTurn ? mover : ((mover ^ 1) as Player));

  return { pits: finalPits, nextTurn, extraTurn, captured, captureFrom, landed, swept, gameOver };
}

function apply(s: MancalaState, m: MancalaMove): MancalaState {
  const res = sow(s, m.pit);
  return { pits: res.pits, turn: res.nextTurn };
}

/* ------------------------------ Status -------------------------------- */

function isTerminal(s: MancalaState): boolean {
  return sideEmpty(s.pits, 0) || sideEmpty(s.pits, 1);
}

/* ------------------------------ Grid view ----------------------------- */
/*
 * The board is rendered as a 2×8 grid (16 cells). Logical pits map to grid
 * cells as follows; only pit/store cells carry a `count`, everything else is
 * non-playable scenery.
 *
 *   (0,0) North store      (0,1..6) North pits 12,11,10,9,8,7      (0,7) —
 *   (1,0) —                (1,1..6) South pits 0,1,2,3,4,5         (1,7) South store
 */
const GRID_ROWS = 2;
const GRID_COLS = 8;

/** Grid cell index (0..15) for a logical pit/store index. */
function gridIndexOfPit(pit: number): number {
  if (pit === NORTH_STORE) return 0;                 // (0,0)
  if (pit >= 7 && pit <= 12) return (13 - pit);      // (0,1..6): pit 12→1 … pit 7→6
  if (pit >= 0 && pit <= 5) return GRID_COLS + 1 + pit; // (1,1..6): pit 0→9 … pit 5→14
  if (pit === SOUTH_STORE) return GRID_COLS + 7;     // (1,7) = 15
  return -1;
}

/* ----------------------------- Evaluation ----------------------------- */

/** Count the moves that earn `player` an immediate extra turn from this board. */
function extraTurnMoves(pits: number[], player: Player): number {
  let n = 0;
  const store = ownStore(player);
  for (const i of pitsOf(player)) {
    if (pits[i] === 0) continue;
    // Landing exactly on our own store needs (store - i) stones along the ring.
    // No store-skipping happens between a pit and our own store on our own side,
    // so the simple distance is exact for reaching our store directly.
    let pos = i, hand = pits[i];
    while (hand > 0) { pos = nextIndex(pos, player); hand -= 1; }
    if (pos === store) n++;
  }
  return n;
}

/** Stones a player could capture right now with their best single sow. */
function bestCapture(pits: number[], player: Player): number {
  let best = 0;
  for (const i of pitsOf(player)) {
    if (pits[i] === 0) continue;
    let pos = i, hand = pits[i];
    const tmp = pits.slice();
    tmp[i] = 0;
    while (hand > 0) { pos = nextIndex(pos, player); tmp[pos] += 1; hand -= 1; }
    if (pos !== ownStore(player) && isOwnPit(player, pos) && tmp[pos] === 1) {
      const across = oppositePit(pos);
      if (tmp[across] > 0) best = Math.max(best, tmp[across] + 1);
    }
  }
  return best;
}

/**
 * Static evaluation from player 0 (South)'s perspective. The dominant term is
 * the store difference (stones banked are permanent); smaller terms reward
 * keeping material on your own side, having an immediate extra-turn move
 * available, and threatening a capture. Positive favours South.
 */
function evaluate(s: MancalaState): number {
  const p = s.pits;

  if (isTerminal(s)) {
    const swept = sweep(p);
    const south = swept[SOUTH_STORE];
    const north = swept[NORTH_STORE];
    if (south > north) return WIN + (south - north);
    if (north > south) return -WIN - (north - south);
    return 0;
  }

  const storeDiff = p[SOUTH_STORE] - p[NORTH_STORE];

  let southBoard = 0, northBoard = 0;
  for (const i of pitsOf(0)) southBoard += p[i];
  for (const i of pitsOf(1)) northBoard += p[i];

  const southExtra = extraTurnMoves(p, 0);
  const northExtra = extraTurnMoves(p, 1);

  const southCap = bestCapture(p, 0);
  const northCap = bestCapture(p, 1);

  return (
    10 * storeDiff
    + 0.5 * (southBoard - northBoard)
    + 3 * (southExtra - northExtra)
    + 1.5 * (southCap - northCap)
  );
}

/* ---------------------------- Move generation ------------------------- */

function legalMoves(s: MancalaState): MancalaMove[] {
  if (isTerminal(s)) return [];
  const moves: MancalaMove[] = [];
  for (const pit of pitsOf(s.turn)) {
    if (s.pits[pit] === 0) continue;
    moves.push({
      id: `m${pit}`,
      to: gridIndexOfPit(pit),
      pit,
      notation: `${sideName(s.turn)} sows ${pitLabel(pit)}`,
    });
  }
  return moves;
}

/* ------------------------------- Search ------------------------------- */

function searchAdapter() {
  return {
    getLegalMoves: (s: MancalaState): MancalaMove[] => legalMoves(s),
    applyMove: apply,
    getTurn: (s: MancalaState) => s.turn,
    isTerminal,
    evaluate,
    // Try captures and extra-turn moves first to sharpen alpha-beta pruning.
    order: (s: MancalaState, m: MancalaMove): number => {
      const res = sow(s, m.pit);
      let score = 0;
      if (res.extraTurn) score += 100;
      score += 10 * res.captured;
      return score;
    },
  };
}

const DEPTH: Record<Difficulty, number> = { tutor: 7, easy: 3, medium: 6, hard: 9, master: 11 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.7, medium: 0.35, hard: 0.07, master: 0 };

/** A stable per-position seed: stones already banked + ply-ish progress. */
function seedFor(s: MancalaState): number {
  const banked = s.pits[SOUTH_STORE] + s.pits[NORTH_STORE];
  return (banked + 1) * 2654435761;
}

/* --------------------------- Definition ------------------------------- */

const def: GameDefinition<MancalaState, MancalaMove> = {
  id: 'mancala',
  name: 'Mancala',
  tagline: 'Sow the seeds, raid the pits — the ancient game of counting and capture.',
  blurb: 'Mancala is one of the oldest games on earth, played for centuries across Africa and Asia in carved boards, clay hollows and holes scooped in the sand. Under these Kalah rules you scoop up a pit of stones and sow them one by one around the board, banking seeds in your store. Drop your last stone in your own store and you go again; drop it into an empty pit on your side and you raid the pit opposite, sweeping its stones into your store. Chain your extra turns, spring your captures, and gather more seeds than your rival before the pits run dry.',
  category: 'Family',
  depth: 3,
  emoji: '🪺',
  accent: '#f59e0b',
  players: [
    { id: 0, name: 'South', short: 'S', color: '#f59e0b' },
    { id: 1, name: 'North', short: 'N', color: '#14b8a6' },
  ],
  interaction: { type: 'place' },
  render: { pieceStyle: 'token', showCoordinates: false, checkered: false },

  createInitialState: (): MancalaState => ({
    pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0],
    turn: 0,
  }),
  cloneState: (s) => ({ pits: s.pits.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    // Start with all 16 cells as non-playable scenery, then fill in the pits.
    const cells: BoardView['cells'] = [];
    for (let g = 0; g < GRID_ROWS * GRID_COLS; g++) {
      cells.push({
        index: g, row: Math.floor(g / GRID_COLS), col: g % GRID_COLS,
        piece: null, playable: false,
      });
    }
    const setPit = (pit: number, count: number, label?: string) => {
      const g = gridIndexOfPit(pit);
      cells[g] = {
        index: g, row: Math.floor(g / GRID_COLS), col: g % GRID_COLS,
        piece: null, playable: true, count, label,
      };
    };
    // North store + North pits (top row).
    setPit(NORTH_STORE, s.pits[NORTH_STORE], 'N');
    for (const pit of pitsOf(1)) setPit(pit, s.pits[pit]);
    // South pits + South store (bottom row).
    for (const pit of pitsOf(0)) setPit(pit, s.pits[pit]);
    setPit(SOUTH_STORE, s.pits[SOUTH_STORE], 'S');

    return { rows: GRID_ROWS, cols: GRID_COLS, cells };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    if (isTerminal(s)) {
      const swept = sweep(s.pits);
      const south = swept[SOUTH_STORE];
      const north = swept[NORTH_STORE];
      if (south === north) {
        return { kind: 'draw', reason: `the pits are empty and the stores are tied ${south}–${north}` };
      }
      const winner: Player = south > north ? 0 : 1;
      const hi = Math.max(south, north);
      const lo = Math.min(south, north);
      return { kind: 'win', winner, reason: `${sideName(winner)} gathered more stones, ${hi}–${lo}` };
    }
    return { kind: 'playing' };
  },

  getLegalMoves: (s, _from) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    if (isTerminal(s)) return null;
    const res = searchBestMove(s, searchAdapter(), DEPTH[difficulty], {
      randomness: RAND[difficulty],
      rng: mulberry32(seedFor(s)),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opp = (mover ^ 1) as Player;
    const side = sideName(mover);
    const adapter = searchAdapter();

    // Grade by comparing the played move with the best move (deep, exact).
    const res = searchBestMove(before, adapter, DEPTH.hard, {
      rng: mulberry32(seedFor(before)),
    });
    const playedEntry = res.ranked.find((r) => r.move.id === move.id);
    const playedEval = playedEntry ? playedEntry.score : evaluate(after);
    const bestEval = res.ranked[0]?.score ?? playedEval;
    const moverPlayed = mover === 0 ? playedEval : -playedEval;
    const moverBest = mover === 0 ? bestEval : -bestEval;
    const loss = Math.max(0, moverBest - moverPlayed);

    const insights: MoveInsight[] = [];
    const principles: string[] = [];
    const threats: string[] = [];

    // Replay the move to learn exactly what it did.
    const sowed = sow(before, move.pit);
    const myStoreGain = after.pits[ownStore(mover)] - before.pits[ownStore(mover)];

    // Capture threats available to the opponent after our move.
    const oppCaptureAfter = sowed.gameOver ? 0 : bestCapture(after.pits, opp);
    const oppCaptureBefore = bestCapture(before.pits, opp);
    // A capture we are now threatening for next time (only meaningful if we get
    // the move next — i.e. after an extra turn, or once the opponent has replied).
    const myCaptureAfter = sowed.gameOver ? 0 : bestCapture(after.pits, mover);

    if (sowed.captured > 0) {
      insights.push({
        tag: 'Capture!',
        detail: `The last stone dropped into an empty pit on ${side}'s side, raiding the pit opposite and sweeping ${sowed.captured} stone${sowed.captured === 1 ? '' : 's'} into the store.`,
        tone: 'good',
      });
      principles.push('Land your final stone in an empty pit on your own side to capture it plus everything in the pit opposite.');
    }

    if (sowed.extraTurn && !sowed.gameOver) {
      insights.push({
        tag: 'Extra turn',
        detail: `${side}'s last stone landed exactly in the store, so ${side} immediately gets to move again — free tempo, and the chance to chain another.`,
        tone: 'good',
      });
      principles.push('Landing your last stone in your own store earns another turn — chain these to pull ahead.');
      threats.push(`${side} moves again right now.`);
    }

    if (!sowed.gameOver && myStoreGain > 0 && !sowed.extraTurn && sowed.captured === 0) {
      insights.push({
        tag: 'Banks a seed',
        detail: `Sowing past your own store banks ${myStoreGain} stone${myStoreGain === 1 ? '' : 's'} — stones in the store are safe for the rest of the game.`,
        tone: 'good',
      });
    }

    // Defensive read: did this hand the opponent a big capture?
    if (oppCaptureAfter >= 4 && oppCaptureAfter > oppCaptureBefore) {
      insights.push({
        tag: 'Opens a raid',
        detail: `After this, ${sideName(opp)} can capture about ${oppCaptureAfter} stones — the move leaves a pit exposed opposite an empty one.`,
        tone: 'bad',
      });
      principles.push('Watch the pit opposite each empty pit on the opponent\'s side — a loaded pit there is a capture waiting to happen.');
      threats.push(`${sideName(opp)} threatens a capture of roughly ${oppCaptureAfter} stones.`);
    } else if (oppCaptureBefore >= 4 && oppCaptureAfter < oppCaptureBefore) {
      insights.push({
        tag: 'Denies a raid',
        detail: `Defuses a capture the opponent was set up for, dropping their best raid from about ${oppCaptureBefore} stones to ${oppCaptureAfter}.`,
        tone: 'good',
      });
      principles.push('Empty or refill a threatened pit to deny the opponent a capture.');
    }

    // Sets up a future capture of our own.
    if (!sowed.gameOver && sowed.captured === 0 && myCaptureAfter >= 4) {
      insights.push({
        tag: 'Sets up a capture',
        detail: `Leaves ${side} threatening to raid for about ${myCaptureAfter} stones on a coming turn.`,
        tone: 'good',
      });
      principles.push('Engineer an empty pit on your side opposite a loaded enemy pit, then drop a stone in to spring the capture.');
    }

    // Endgame: emptying a side ends the game and triggers the sweep.
    if (sowed.gameOver) {
      const swept = sweep(after.pits); // after.pits is already swept; this is idempotent
      const south = swept[SOUTH_STORE];
      const north = swept[NORTH_STORE];
      const myFinal = mover === 0 ? south : north;
      const oppFinal = mover === 0 ? north : south;
      if (sowed.swept) {
        insights.push({
          tag: 'Empties the board',
          detail: `One side is now empty, so the game ends and ${sideName(sowed.swept.player)} sweeps the remaining ${sowed.swept.amount} stone${sowed.swept.amount === 1 ? '' : 's'} home.`,
          tone: 'info',
        });
        principles.push('When a side runs empty the game ends and the other player banks all their leftover stones — count this before you commit.');
      }
      if (myFinal > oppFinal) {
        insights.push({ tag: 'Game won', detail: `Final tally ${myFinal}–${oppFinal} for ${side}.`, tone: 'good' });
      } else if (myFinal < oppFinal) {
        insights.push({ tag: 'Game lost', detail: `Final tally ${oppFinal}–${myFinal} for ${sideName(opp)}.`, tone: 'bad' });
      } else {
        insights.push({ tag: 'Drawn', detail: `The stores finish level ${myFinal}–${oppFinal}.`, tone: 'info' });
      }
    }

    const winningBig = Math.abs(moverPlayed) > WIN / 2;
    let band: MoveExplanation['band'] = gradeByLoss(loss, winningBig);
    // Reward a genuinely strong capture or a chained extra turn.
    if (!sowed.gameOver && (sowed.captured >= 6 || sowed.extraTurn) && loss <= 20) band = 'great';

    if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
      insights.push({ tag: 'Lets the lead slip', detail: 'A stronger sow was available; this one gives the opponent the better of it.', tone: 'bad' });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Solid sow', detail: 'A reasonable distribution that keeps the position balanced.', tone: 'info' });
    }

    const summary =
      sowed.captured > 0 ? `${side} sows ${pitLabel(move.pit)} and captures ${sowed.captured} stones.`
      : sowed.extraTurn && !sowed.gameOver ? `${side} sows ${pitLabel(move.pit)} into the store and goes again.`
      : sowed.gameOver ? `${side} sows ${pitLabel(move.pit)}; the board empties and the game ends.`
      : `${side} sows ${pitLabel(move.pit)}.`;

    const betterIdea = (() => {
      if (loss <= 55 || !res.move || res.move.id === move.id) return undefined;
      const bestSow = sow(before, res.move.pit);
      if (bestSow.captured > 0) return `Stronger was ${pitLabel(res.move.pit)} — it captures ${bestSow.captured} stones.`;
      if (bestSow.extraTurn) return `Stronger was ${pitLabel(res.move.pit)} — it lands in the store for another turn.`;
      return `Stronger was ${pitLabel(res.move.pit)}, which keeps more stones safe and a better shape.`;
    })();

    return {
      summary, band,
      evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles,
      threats: threats.length ? threats : undefined,
      betterIdea,
    };
  },

  hint(s) {
    if (isTerminal(s)) return null;
    const res = searchBestMove(s, searchAdapter(), DEPTH.hard, {
      rng: mulberry32(seedFor(s)),
    });
    if (!res.move) return null;

    const sowed = sow(s, res.move.pit);
    let text: string;
    if (sowed.captured > 0) {
      text = `Sow ${pitLabel(res.move.pit)} — your last stone lands in an empty pit and captures ${sowed.captured} stones.`;
    } else if (sowed.extraTurn && !sowed.gameOver) {
      text = `Sow ${pitLabel(res.move.pit)} — it lands in your store, so you get another turn.`;
    } else if (sowed.gameOver) {
      text = `Sow ${pitLabel(res.move.pit)} — it empties a side and ends the game in your favour.`;
    } else {
      text = `Sow ${pitLabel(res.move.pit)} — it banks stones and keeps the strongest shape.`;
    }
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Mancala is among the most ancient games still played, its boards carved into temple steps and scooped into desert sand across Africa and the Middle East for thousands of years. This is the **Kalah** version: a row of six pits each, a large **store** at your right hand, and forty-eight stones to sow. The rules fit in a sentence, yet strong play is a constant, quiet arithmetic — counting *exactly* where your last stone will land to bank a seed, steal an extra turn, or spring a raid on your opponent\'s pits.',
    objective: 'Gather more stones in your store than your opponent. The game ends the instant one player\'s six pits are all empty; the other player then sweeps every stone still on their own side into their store, and whoever holds more stones wins. With 48 stones in play, **25 or more guarantees victory** — that is the number to count toward.',
    chapters: [
      {
        title: 'The Board & Sowing', icon: '📜',
        steps: [
          {
            title: 'Your pits and your store',
            body: 'Each player owns the **six pits** on their side and the large **store** to their right. **South** (you, going first) owns the bottom row and the right-hand store; **North** owns the top row and the left-hand store. Every pit starts with **four stones** — forty-eight in all.',
            setup: '{"pits":[4,4,4,4,4,4,0,4,4,4,4,4,4,0],"turn":0}',
            highlight: [gridIndexOfPit(SOUTH_STORE), gridIndexOfPit(NORTH_STORE)],
          },
          {
            title: 'How sowing works',
            body: 'On your turn, pick one of **your own** non-empty pits, scoop up *all* its stones, and "sow" them one at a time into the pits ahead, moving **counterclockwise** (to the right along your row, then up the far end). You drop exactly one stone in each pit you pass.',
            setup: '{"pits":[4,4,4,4,4,4,0,4,4,4,4,4,4,0],"turn":0}',
            highlight: [gridIndexOfPit(SOUTH_STORE)],
          },
          {
            title: 'Your store, never theirs',
            body: 'As your sowing passes your **own** store you drop a stone in it — and stones banked there are **safe** for the rest of the game, counting toward your score. But when your sowing reaches your **opponent\'s** store you **skip over it** and carry straight on into their pits. You can never add to the enemy\'s score.',
            highlight: [gridIndexOfPit(SOUTH_STORE), gridIndexOfPit(NORTH_STORE)],
          },
          {
            title: 'The extra-turn rule',
            body: 'If the **last** stone you sow lands exactly in **your own store**, you immediately take **another turn**. This is huge: a pit holding just the right number of stones is a free move. With careful counting you can string several of these together before ever passing the turn back.',
            highlight: [gridIndexOfPit(SOUTH_STORE)],
          },
          {
            title: 'The capture rule',
            body: 'If your **last** stone lands in an **empty pit on your own side**, and the pit **directly opposite** it (across the board) holds stones, you **capture** the lot — those stones *plus* your landing stone — straight into your store. An empty pit on your side facing a loaded enemy pit is a trap waiting to spring.',
          },
          {
            title: 'Ending the game',
            body: 'The game ends the instant **either** player has no stones left in any of their six pits. The other player then **sweeps** every stone remaining on their own side into their store. Count the stores: more stones **wins**; a 24–24 split is a **draw**.',
          },
        ],
      },
      {
        title: 'Tempo & Captures', icon: '🧠',
        steps: [
          {
            title: 'Count to the store',
            body: 'The extra-turn rule rewards arithmetic. A pit lands its last stone in your store when it holds **exactly the right count**: the pit nearest the store needs **1** stone, the next needs **2**, and so on up to **6** for the pit farthest away. Spot these instantly and you will never miss a free move.',
            setup: '{"pits":[1,0,0,1,0,1,5,4,4,4,4,4,4,0],"turn":0}',
            highlight: [gridIndexOfPit(0), gridIndexOfPit(3), gridIndexOfPit(5)],
          },
          {
            title: 'Chain your free turns',
            body: 'Because each extra turn lets you move again, try to line up **several** store-ending pits at once. Play them in the right order — usually emptying the far pits first so the near ones still land in the store — and you can take three, four, even more moves in a single turn, burying stones safely as you go.',
            highlight: [gridIndexOfPit(SOUTH_STORE)],
          },
          {
            title: 'Build and spring captures',
            body: 'Captures decide games. Keep an **empty pit** on your side facing a *loaded* enemy pit, then drop a single stone into that empty pit — your last stone landing there raids the pit opposite and sweeps everything into your store. Engineering the right empty pit, then filling it on cue, is the heart of skilled Mancala.',
          },
          {
            title: 'Watch the opponent\'s raids',
            body: 'The capture rule cuts both ways. Every **empty pit on their side** facing a **loaded pit on yours** is a raid they are threatening. Before you commit, check whether your sow leaves one of your pits ripe to be taken — and when danger looms, **empty or pile onto** the threatened pit so their raid finds nothing or overshoots.',
          },
          {
            title: 'Hoard versus empty',
            body: 'Two opposing plans tug at every game. **Hoarding** — letting stones build in one pit — can set up a single huge sow that banks many stones or laps the board, but a fat pit is also a juicy capture target. **Emptying** keeps your side nimble and safe but banks slowly. Good players switch between the two as the board demands.',
          },
          {
            title: 'The endgame sweep',
            body: 'When one side empties, the game ends and the **other** player banks all their leftover stones. That sweep can swing the score wildly, so plan the final moves: sometimes **hoard** stones on your side to scoop them up, sometimes deliberately **starve** your own pits so the *opponent* is the one left holding little when the board clears.',
          },
        ],
      },
      {
        title: 'Mancala Trainer', icon: '🎯',
        steps: [
          {
            title: 'Earn an extra turn',
            body: 'Time to count, not just read. **Click one of your pits** (the bottom row) to sow it. One pit holds exactly the number of stones that drops your last seed in your store — find it and grab the free move.',
            setup: '{"pits":[4,4,4,4,4,1,0,4,4,4,4,4,4,0],"turn":0}',
            challenge: {
              prompt: 'South to play — find the sow that earns an extra turn.',
              solution: ['South sows pit 6'],
              success: 'South sows pit 6 — the pit nearest the store holds a single stone, which lands exactly in the store. You go again. Always scan the pit closest to your store first; a "1" there is a free turn.',
            },
          },
          {
            title: 'Count a little farther',
            body: 'Same idea, a longer reach. This time the store-ending pit is not the nearest one — count how many steps each pit is from your store and match it to the stones inside.',
            setup: '{"pits":[4,4,4,3,0,0,0,4,4,4,4,4,4,0],"turn":0}',
            challenge: {
              prompt: 'South to play — land your last stone in the store.',
              solution: ['South sows pit 4'],
              success: 'South sows pit 4 — three stones, and that pit sits exactly three steps from the store (pit 5, pit 6, then the store). The last stone lands home and you move again.',
            },
          },
          {
            title: 'Spring a capture',
            body: 'Now the big prize. One of your pits is empty, and the enemy pit straight across from it is stacked. Sow the pit whose last stone drops into that empty pit to raid the loaded one opposite.',
            setup: '{"pits":[2,1,0,1,1,1,0,4,4,4,5,4,4,0],"turn":0}',
            challenge: {
              prompt: 'South to play — set off a capture.',
              solution: ['South sows pit 1'],
              success: 'South sows pit 1: its two stones reach pit 2 and then the empty pit 3, and that landing raids the five stones opposite — six stones swept into your store in one move. Lining up an empty pit across from a fat enemy pit is how raids are made.',
            },
          },
          {
            title: 'Keep training',
            body: 'In a real game our AI tutor watches every sow — flagging the extra turns you bank, the raids you set up, and the pits you leave exposed. Play at rising difficulty and let the running commentary sharpen your counting; soon you will see the landing square before you lift a stone.',
          },
        ],
      },
    ],
  },
};

export default def;
