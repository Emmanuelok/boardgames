import type {
  BoardView, Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, MoveInsight, Player,
} from '../engine/types';
import { mulberry32, searchBestMove, WIN } from '../engine/ai';
import { gradeByLoss } from '../engine/grade';

export interface C4State {
  board: (Player | null)[]; // 42 cells, row-major, row 0 = top
  turn: Player;
}
interface C4Move extends MoveBase {}

const COLS = 7;
const ROWS = 6;
const CENTER_COL = 3;

const idx = (row: number, col: number) => row * COLS + col;

/**
 * Every line of four cells in which a win can occur — horizontal, vertical and
 * both diagonals — precomputed once as arrays of four indices. The evaluator and
 * the win check both slide over these "windows".
 */
const WINDOWS: number[][] = (() => {
  const w: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) w.push([idx(r, c), idx(r, c + 1), idx(r, c + 2), idx(r, c + 3)]); // →
      if (r + 3 < ROWS) w.push([idx(r, c), idx(r + 1, c), idx(r + 2, c), idx(r + 3, c)]); // ↓
      if (c + 3 < COLS && r + 3 < ROWS) w.push([idx(r, c), idx(r + 1, c + 1), idx(r + 2, c + 2), idx(r + 3, c + 3)]); // ↘
      if (c - 3 >= 0 && r + 3 < ROWS) w.push([idx(r, c), idx(r + 1, c - 1), idx(r + 2, c - 2), idx(r + 3, c - 3)]); // ↙
    }
  }
  return w;
})();

/** The landing row for a column: the lowest empty cell, or -1 if the column is full. */
function dropRow(board: (Player | null)[], col: number): number {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[idx(r, col)] === null) return r;
  }
  return -1;
}

function winnerOf(board: (Player | null)[]): Player | null {
  for (const [a, b, c, d] of WINDOWS) {
    const v = board[a];
    if (v !== null && v === board[b] && v === board[c] && v === board[d]) return v;
  }
  return null;
}

function isFull(board: (Player | null)[]): boolean {
  for (let c = 0; c < COLS; c++) if (board[idx(0, c)] === null) return false;
  return true;
}

function searchAdapter(_state: C4State) {
  return {
    getLegalMoves: legalMoves,
    applyMove: apply,
    getTurn: (s: C4State) => s.turn,
    isTerminal: (s: C4State) => winnerOf(s.board) !== null || isFull(s.board),
    evaluate,
    // Order centre-ward columns first: they touch the most winning lines, so
    // exploring them early sharpens alpha-beta pruning markedly.
    order: (_s: C4State, m: C4Move) => -Math.abs((m.to % COLS) - CENTER_COL),
  };
}

function legalMoves(s: C4State): C4Move[] {
  if (winnerOf(s.board) !== null) return [];
  const moves: C4Move[] = [];
  for (let c = 0; c < COLS; c++) {
    const r = dropRow(s.board, c);
    if (r >= 0) {
      moves.push({
        id: `c${c}`,
        to: idx(r, c),
        notation: `${s.turn === 0 ? 'Red' : 'Yellow'} drops in column ${c + 1}`,
      });
    }
  }
  return moves;
}

function apply(s: C4State, m: C4Move): C4State {
  const board = s.board.slice();
  board[m.to] = s.turn;
  return { board, turn: (s.turn ^ 1) as Player };
}

/**
 * Classic Connect-Four heuristic. Slide a 4-window across every line and score
 * it from player 0 (Red)'s perspective: four-in-a-window is a win, three with an
 * empty is a strong threat, two with two empties is a foothold. Player 1's
 * windows are subtracted symmetrically. A central-column bonus rewards owning
 * column 4, whose discs participate in the greatest number of lines.
 */
function scoreWindow(cells: (Player | null)[]): number {
  let r = 0;
  let y = 0;
  let e = 0;
  for (const v of cells) {
    if (v === 0) r++;
    else if (v === 1) y++;
    else e++;
  }
  // A window holding both colours can never be completed — it is dead.
  if (r > 0 && y > 0) return 0;
  if (r === 4) return 100000;
  if (y === 4) return -100000;
  if (r === 3 && e === 1) return 120;
  if (y === 3 && e === 1) return -120;
  if (r === 2 && e === 2) return 12;
  if (y === 2 && e === 2) return -12;
  if (r === 1 && e === 3) return 1;
  if (y === 1 && e === 3) return -1;
  return 0;
}

function evaluate(s: C4State): number {
  const b = s.board;
  const w = winnerOf(b);
  if (w === 0) return WIN;
  if (w === 1) return -WIN;

  let score = 0;
  for (const win of WINDOWS) {
    score += scoreWindow([b[win[0]], b[win[1]], b[win[2]], b[win[3]]]);
  }
  // Central control: each Red disc in the centre column is worth a few points,
  // each Yellow disc costs the same.
  for (let r = 0; r < ROWS; r++) {
    const v = b[idx(r, CENTER_COL)];
    if (v === 0) score += 6;
    else if (v === 1) score -= 6;
  }
  return score;
}

const DEPTH: Record<Difficulty, number> = { tutor: 7, easy: 2, medium: 4, hard: 6, master: 8 };
const RAND: Record<Difficulty, number> = { tutor: 0, easy: 0.85, medium: 0.45, hard: 0.08, master: 0 };

/** Count of distinct cells that, if `player` played there now, complete a four —
 *  i.e. the player's *immediate* winning squares (open threats). Only cells that
 *  are currently playable (the lowest empty cell of their column) count as live. */
function winningSquares(board: (Player | null)[], player: Player): number[] {
  const squares: number[] = [];
  for (let c = 0; c < COLS; c++) {
    const r = dropRow(board, c);
    if (r < 0) continue;
    const cell = idx(r, c);
    const test = board.slice();
    test[cell] = player;
    if (winnerOf(test) === player) squares.push(cell);
  }
  return squares;
}

/** All cells (playable now or buried) that would complete a four for `player`.
 *  Used to detect open-ended threes / double threats including squares stacked
 *  above the current frontier. */
function threatSquares(board: (Player | null)[], player: Player): number[] {
  const squares: number[] = [];
  for (let i = 0; i < ROWS * COLS; i++) {
    if (board[i] !== null) continue;
    const test = board.slice();
    test[i] = player;
    if (winnerOf(test) === player) squares.push(i);
  }
  return squares;
}

const COLW = (col: number) => col + 1; // human-facing column number (1..7)

const def: GameDefinition<C4State, C4Move> = {
  id: 'connect-four',
  name: 'Connect Four',
  tagline: 'Drop, stack, and line up four — the gravity-bound duel of threats.',
  blurb: 'Take turns dropping discs down a standing grid; the first to line up four in a row — across, up, or on a diagonal — wins. Easy to start, yet ruled by a single deep idea: build a double threat your opponent cannot block. Master the center, read the columns, and the win is yours.',
  category: 'Family',
  depth: 2,
  emoji: '🔴',
  accent: '#ef4444',
  players: [
    { id: 0, name: 'Red', short: 'R', color: '#ef4444' },
    { id: 1, name: 'Yellow', short: 'Y', color: '#eab308' },
  ],
  interaction: { type: 'drop' },
  render: { pieceStyle: 'disc', showCoordinates: false, checkered: false },

  createInitialState: () => ({ board: Array(ROWS * COLS).fill(null), turn: 0 }),
  cloneState: (s) => ({ board: s.board.slice(), turn: s.turn }),

  getBoardView(s): BoardView {
    const cells = s.board.map((p, i) => ({
      index: i, row: Math.floor(i / COLS), col: i % COLS,
      piece: p === null ? null : { id: `c${i}`, kind: 'disc', player: p },
    }));
    return { rows: ROWS, cols: COLS, cells };
  },

  getTurn: (s) => s.turn,

  getStatus(s): GameStatus {
    const w = winnerOf(s.board);
    if (w !== null) return { kind: 'win', winner: w, reason: 'four in a row' };
    if (isFull(s.board)) return { kind: 'draw', reason: 'the board is full' };
    return { kind: 'playing' };
  },

  getLegalMoves: (s, _from) => legalMoves(s),
  applyMove: apply,

  chooseMove(s, difficulty) {
    const placed = s.board.filter((c) => c !== null).length;
    const res = searchBestMove(s, searchAdapter(s), DEPTH[difficulty], {
      randomness: RAND[difficulty], rng: mulberry32((placed + 1) * 2654435761),
    });
    return res.move;
  },

  evaluate,

  explainMove(before, move, after): MoveExplanation {
    const mover = before.turn;
    const opp = (mover ^ 1) as Player;
    const colName = `column ${COLW(move.to % COLS)}`;
    const side = mover === 0 ? 'Red' : 'Yellow';
    const adapter = searchAdapter(before);

    // Grade by comparing the played move against the best move (deep, exact).
    const res = searchBestMove(before, adapter, DEPTH.tutor);
    const playedEntry = res.ranked.find((r) => r.move.id === move.id);
    const playedEval = playedEntry ? playedEntry.score : evaluate(after);
    const bestEval = res.ranked[0]?.score ?? playedEval;
    const moverPlayed = mover === 0 ? playedEval : -playedEval;
    const moverBest = mover === 0 ? bestEval : -bestEval;
    const loss = Math.max(0, moverBest - moverPlayed);

    const insights: MoveInsight[] = [];
    const principles: string[] = [];
    const threats: string[] = [];

    const won = winnerOf(after.board) === mover;

    // Threat bookkeeping, before and after.
    const myThreatsBefore = threatSquares(before.board, mover);
    const myThreatsAfter = threatSquares(after.board, mover);
    const myLiveAfter = winningSquares(after.board, mover);
    const oppLiveBefore = winningSquares(before.board, opp);
    const oppLiveAfter = winningSquares(after.board, opp);
    const earlyMove = before.board.filter((c) => c !== null).length < 4;

    if (won) {
      insights.push({ tag: 'Winning move', detail: `Completes four in a row — ${side} wins the game.`, tone: 'good' as const });
    }

    // A double threat — two distinct immediately-winning squares — is unstoppable.
    if (!won && myLiveAfter.length >= 2) {
      insights.push({ tag: 'Double threat!', detail: 'Creates two separate winning squares at once — the opponent can only block one. This is the winning idea in Connect Four.', tone: 'good' as const });
      principles.push('Build a double threat: two ways to win, only one defender.');
      threats.push(`${side} now threatens to win in column ${COLW(myLiveAfter[0] % COLS)} and column ${COLW(myLiveAfter[1] % COLS)} — both cannot be stopped.`);
    } else if (!won && myThreatsAfter.length > myThreatsBefore.length) {
      // Did this move turn a line into an open-ended three (a fresh threat)?
      insights.push({ tag: 'Open three', detail: 'Builds a row of three with an open end — a threat to win on the next move.', tone: 'good' as const });
      principles.push('Three-in-a-row with a free landing square forces the opponent to respond.');
      if (myLiveAfter.length === 1) {
        threats.push(`${side} threatens four in column ${COLW(myLiveAfter[0] % COLS)} next turn.`);
      }
    }

    // Did this move defuse an opponent threat?
    if (oppLiveBefore.length > 0) {
      const stopped = oppLiveBefore.filter((sq) => !oppLiveAfter.includes(sq));
      if (stopped.length > 0) {
        insights.push({ tag: 'Blocks the threat', detail: 'Plugs the square where the opponent was about to make four.', tone: 'good' as const });
        principles.push('Always block an immediate four-in-a-row threat.');
      } else if (!won) {
        insights.push({ tag: 'Missed defence', detail: 'The opponent was one move from four in a row and this did not stop it.', tone: 'bad' as const });
        threats.push(`${opp === 0 ? 'Red' : 'Yellow'} can still win in column ${COLW(oppLiveAfter[0] % COLS)}.`);
      }
    }

    // Center play early is a hallmark of strong Connect Four.
    if (!won && move.to % COLS === CENTER_COL && earlyMove) {
      insights.push({ tag: 'Center column', detail: 'The middle column belongs to more winning lines than any other — claiming it early is the textbook opening.', tone: 'good' as const });
      principles.push('Fight for the center column: its discs join the most lines.');
    }

    // After the played move, can the opponent's reply create an unstoppable fork
    // or simply win? If best play avoided this, it is a blunder.
    const oppBest = searchBestMove(after, searchAdapter(after), DEPTH.tutor - 1);
    const winningBig = Math.abs(moverPlayed) > WIN / 2;
    const band = won ? 'best' : gradeByLoss(loss, winningBig);

    if (!won && oppBest.move) {
      const oppReply = apply(after, oppBest.move);
      if (winnerOf(oppReply.board) === opp) {
        insights.push({ tag: 'Hands over the win', detail: 'This lets the opponent drop four in a row immediately.', tone: 'bad' as const });
      } else if (winningSquares(oppReply.board, opp).length >= 2) {
        insights.push({ tag: 'Allows a fork', detail: 'The opponent can answer with a double threat that cannot be blocked.', tone: 'bad' as const });
      }
    }

    if ((band === 'blunder' || band === 'mistake') && insights.every((i) => i.tone !== 'bad')) {
      insights.push({ tag: 'Loses ground', detail: 'A sharper move was available; this one concedes the initiative.', tone: 'bad' as const });
    }
    if (insights.length === 0) {
      insights.push({ tag: 'Solid drop', detail: 'A reasonable disc that keeps the position balanced.', tone: 'info' as const });
    }

    const summary =
      won ? `${side} connects four and wins!`
      : myLiveAfter.length >= 2 ? `${side} drops into ${colName} and forks — two winning squares at once.`
      : `${side} drops a disc into ${colName}.`;

    return {
      summary, band, evalBefore: evaluate(before), evalAfter: evaluate(after),
      insights, principles, threats: threats.length ? threats : undefined,
      betterIdea: loss > 120 && res.move
        ? `Stronger was ${res.move.notation.toLowerCase().replace(`${side.toLowerCase()} drops in `, 'dropping in ')} — it ${winningSquares(apply(before, res.move).board, mover).length >= 2 ? 'sets up a double threat' : 'keeps the advantage'}.`
        : undefined,
    };
  },

  hint(s) {
    const res = searchBestMove(s, searchAdapter(s), DEPTH.tutor);
    if (!res.move) return null;
    const after = apply(s, res.move);
    const col = COLW(res.move.to % COLS);
    const mover = s.turn;
    const opp = (mover ^ 1) as Player;

    const wins = winnerOf(after.board) === mover;
    const forks = winningSquares(after.board, mover).length >= 2;
    const blocks = winningSquares(s.board, opp).some((sq) => sq === res.move!.to);
    const center = res.move.to % COLS === CENTER_COL;

    const text =
      wins ? `Drop in column ${col} to connect four and win.`
      : forks ? `Drop in column ${col} — it creates a double threat (two winning squares at once).`
      : blocks ? `Drop in column ${col} to block the opponent's four-in-a-row threat.`
      : center ? `Drop in column ${col} — controlling the center column gives you the most winning lines.`
      : `Column ${col} is the strongest drop here.`;
    return { move: res.move, text };
  },

  serialize: (s) => JSON.stringify(s),
  deserialize: (str) => JSON.parse(str),

  tutorial: {
    overview: 'Connect Four is the vertical duel everyone knows — discs clatter down a standing grid and pile up under gravity. It is simple to learn and quietly deep: behind the falling discs lies a single decisive idea — the double threat — that turns a friendly game into a battle of foresight. This course takes you from the gravity rule to centre control, open threes, the unstoppable fork and the subtle parity of odd and even threats, then drops you into a live Threat Trainer to find the winning move yourself.',
    objective: 'Be the first to line up four of your own discs in a straight line — horizontally, vertically, or on either diagonal. If all 42 slots fill with no four-in-a-row, the game is a draw.',
    chapters: [
      {
        title: 'The Rules', icon: '📜',
        steps: [
          {
            title: 'The standing grid',
            body: 'The board stands upright: **7 columns** wide and **6 rows** tall, 42 slots in all. **Red** moves first, then players alternate, one disc per turn. Because gravity decides where each disc lands, you are really choosing among only seven moves at a time — yet that narrowness hides surprising depth.',
          },
          {
            title: 'Gravity does the placing',
            body: 'You do not choose a square — you choose a **column**. Your disc falls and lands on the lowest empty slot in that column, stacking on top of whatever is already there. You can never place a disc in mid-air, which means the order discs arrive in a column is everything.',
            highlight: [idx(5, 3)],
          },
          {
            title: 'Stacking up',
            body: 'Each new disc in a column sits one row higher than the last. A column is closed once all six of its slots are full; then you must drop elsewhere. Filling a column can be a weapon — it changes *which* square in a neighbouring line becomes reachable next.',
            highlight: [idx(5, 3), idx(4, 3), idx(3, 3)],
          },
          {
            title: 'Four in a row wins',
            body: 'Connect **four** of your discs in an unbroken line — across, straight up, or along a diagonal — and you win instantly, even mid-turn. There is no need to fill the board; the game ends the moment a four appears.',
            highlight: [idx(5, 1), idx(5, 2), idx(5, 3), idx(5, 4)],
          },
          {
            title: 'Vertical fours',
            body: 'The simplest four to make — and to miss defending — is **straight up** a single column. Four of one colour stacked in one column wins. Beginners stack happily toward this without noticing the opponent will simply cap the column on top.',
            highlight: [idx(5, 6), idx(4, 6), idx(3, 6), idx(2, 6)],
          },
          {
            title: 'Diagonals count too',
            body: 'It is easy to watch the rows and columns and miss a **diagonal** four sneaking up the board. Both diagonal directions — up-right and up-left — count. Train your eye to scan all four directions before every drop.',
            highlight: [idx(5, 1), idx(4, 2), idx(3, 3), idx(2, 4)],
          },
          {
            title: 'The draw',
            body: 'If every one of the 42 slots fills and no one has four in a row, the game is a **draw** — rare, but possible against careful play. (With *perfect* play from both sides, Red actually wins by moving first in the centre — a fact proven by computer in 1988.)',
          },
        ],
      },
      {
        title: 'Reading the Board', icon: '🔍',
        steps: [
          {
            title: 'What a "threat" really is',
            body: 'A **threat** is a single empty square that would complete a four for you. Spotting threats — yours and your opponent\'s — is the whole skill of Connect Four. Here Red owns three on the bottom row with an open square on each side: two threats at once.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,null,null],"turn":0}',
            highlight: [idx(5, 1), idx(5, 5)],
          },
          {
            title: 'Playable now vs buried',
            body: 'A threat only matters if its square is **reachable**. A winning square floating high in a column does nothing until the slots beneath it are filled. The art is making *your* threats land on squares that will soon be playable, and your opponent\'s on squares that stay out of reach.',
            highlight: [idx(5, 1), idx(2, 4)],
          },
          {
            title: 'The square above a threat is poison',
            body: 'Watch the slot sitting directly **on top of** a winning square. If you fill the square below an opponent\'s threat, your disc props their winning square up to playable height — and they take it. Never hand the opponent the step beneath their four.',
            highlight: [idx(5, 4), idx(4, 4)],
          },
          {
            title: 'Count the tempo',
            body: 'Every forcing move (a threat the opponent *must* answer) buys you a free tempo to build elsewhere. Strong players string threats together so the opponent is always responding, never attacking. Reading the board means reading **who is forced** on each move.',
          },
        ],
      },
      {
        title: 'Winning Strategy', icon: '🧠',
        steps: [
          {
            title: 'Control the center column',
            body: 'The **middle column** (column 4) is the most valuable real estate on the board: its discs take part in more winning lines than any other column. Claim it early and contest it hard — Red\'s strongest first move is dropping dead centre.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,null,null,null,null,null,null,1,null,null,null,null,null,null,0,null,null,null],"turn":0}',
            highlight: [idx(5, 3), idx(4, 3), idx(3, 3), idx(2, 3), idx(1, 3), idx(0, 3)],
          },
          {
            title: 'The open-ended three',
            body: 'Three of your discs in a row with a **playable empty square** on the end is a live threat: unless your opponent plugs it, you complete four next turn. An open three with *both* ends free is even stronger — it is already a double threat. Make these constantly; each one forces a response and steals the initiative.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,null,null],"turn":1}',
            highlight: [idx(5, 1), idx(5, 2), idx(5, 3), idx(5, 4), idx(5, 5)],
          },
          {
            title: 'Block your opponent\'s three',
            body: 'The flip side: when your opponent has an open three, you **must** drop into the winning square right away. Ignore it and you simply lose. Most beginner games are decided by one missed block — before every move, ask "could they win next turn?"',
            highlight: [idx(5, 1), idx(5, 2), idx(5, 3), idx(5, 4)],
          },
          {
            title: 'Build a double threat (the fork)',
            body: 'This is the heart of the game. Engineer a position where **one move makes two separate fours possible at once** — two open ends of a row, or threats in two different lines. Your opponent can only block one; you play the other and win. Here Red\'s three on the bottom row threatens both column 2 and column 6 — an unstoppable fork.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,0,0,null,null],"turn":0}',
            highlight: [idx(5, 1), idx(5, 5)],
            arrows: [{ from: idx(5, 1), to: idx(5, 1), tone: 'good' }, { from: idx(5, 5), to: idx(5, 5), tone: 'good' }],
          },
          {
            title: 'Stack a threat to make a fork',
            body: 'Forks are not only horizontal. A classic trap stacks a second threat *on top of* the first: a flat three plus a diagonal climbing through the same column produces two winning squares at different heights. When the opponent blocks the low one, the high one becomes playable.',
            highlight: [idx(5, 2), idx(5, 3), idx(5, 4), idx(4, 3)],
          },
          {
            title: 'Don\'t feed the stack above a threat',
            body: 'The mirror of the fork: avoid being forked. If you drop a disc just below your opponent\'s winning slot, your next move hands them the win. Sometimes the right move is to play *away* from a column entirely and refuse to raise their threat to playable height.',
            highlight: [idx(4, 3), idx(5, 3)],
          },
          {
            title: 'Odd and even threats & zugzwang',
            body: 'The deepest idea: number the rows 1–6 from the bottom. With Red moving first, an unanswered threat on an **odd** row (1, 3, 5) tends to fall to Red, and an **even**-row threat (2, 4, 6) to Yellow, because of who is forced to fill the squares beneath it. In the endgame the board fills until someone runs out of safe moves — **zugzwang** — and must drop right below the enemy threat. Steering your decisive threat onto the parity you own is how masters win even, blocked-looking positions.',
            highlight: [idx(5, 0), idx(3, 0), idx(1, 0)],
          },
        ],
      },
      {
        title: 'Threat Trainer', icon: '🎯',
        steps: [
          {
            title: 'How to play a puzzle',
            body: 'Reading about threats is one thing — *finding* them under pressure is another. In each puzzle you play **Red**. **Click the column** you want to drop into; the disc falls to the lowest free slot. Find the move described and the trainer confirms it.',
          },
          {
            title: 'Complete the four',
            body: 'Red has three in a row along the bottom, but Yellow has plugged the left end. There is exactly one square that completes the four. Drop it.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,1,0,0,0,null,1,1],"turn":0}',
            highlight: [idx(5, 4)],
            challenge: {
              prompt: 'Red to play — connect four and win in one.',
              solution: ['Red drops in column 5'],
              success: 'Red drops in column 5 to complete four across the bottom — game over. Whenever you hold three in a row, look first for the square that finishes it.',
            },
          },
          {
            title: 'Block the threat',
            body: 'Now you are defending. Yellow has three in a row and threatens to connect four on the next move. Find the single column that plugs the gap before it is too late.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,1,1,null,null],"turn":0}',
            highlight: [idx(5, 5)],
            challenge: {
              prompt: 'Red to play — block Yellow\'s four-in-a-row threat.',
              solution: ['Red drops in column 6'],
              success: 'Red drops in column 6, plugging the only square where Yellow could have completed four. Before every move, scan for the opponent\'s threats first — one missed block loses the game.',
            },
          },
          {
            title: 'Spot the diagonal win',
            body: 'The hardest fours to see climb on a diagonal. Red has three discs marching up-and-to-the-right, and the columns beneath the final square have filled just enough. Find the drop that completes the diagonal four.',
            setup: '{"board":[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0,1,null,null,null,null,0,1,0,null,null,null,0,1,1,1,null,null],"turn":0}',
            highlight: [idx(2, 4)],
            challenge: {
              prompt: 'Red to play — complete the diagonal four and win.',
              solution: ['Red drops in column 5'],
              success: 'Red drops in column 5; the disc lands on the fourth step of the diagonal and connects four. Diagonal threats are the ones opponents overlook most — and the ones you should hunt for first.',
            },
          },
          {
            title: 'Keep training',
            body: 'In a real game the AI tutor grades **every** drop you make — flagging open threes, forks you set up, threats you missed, and the centre squares worth fighting for — from Brilliant to Blunder. Play at rising difficulty, read each explanation, and threats will start leaping off the board.',
          },
        ],
      },
    ],
  },
};

export default def;
