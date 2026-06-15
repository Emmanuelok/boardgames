/**
 * The universal board-game abstraction.
 *
 * Every game in the center — Chess, Checkers, Reversi, Connect Four, Gomoku,
 * Tic-Tac-Toe and any future addition — implements {@link GameDefinition}.
 * The entire UI (2D board, 3D board, tutor panel, AI driver) talks only to
 * this interface, which is what lets the center scale to *any* board game
 * without rewriting the presentation layer.
 */

export type Player = 0 | 1;

export interface PlayerInfo {
  id: Player;
  /** Display name, e.g. "White", "Red", "X". */
  name: string;
  /** One/two character badge, e.g. "W", "R", "X". */
  short: string;
  /** CSS color used to tint pieces / UI for this side. */
  color: string;
}

/** A single piece as the renderer sees it. `id` must be stable across moves
 *  so the 2D/3D layers can animate a piece sliding rather than teleporting. */
export interface PieceView {
  id: string;
  /** Game-specific piece kind: 'P','N','B','R','Q','K' | 'man','king' | 'disc' | 'X','O' | 'stone'. */
  kind: string;
  player: Player;
  /** Unicode glyph used by the 2D renderer for instant, asset-free beauty. */
  glyph?: string;
  /** Whether the piece is "crowned"/"promoted" (checkers king, etc.). */
  crowned?: boolean;
}

export interface CellView {
  index: number;
  row: number;
  col: number;
  piece: PieceView | null;
  /** False for cells that are never playable (e.g. light squares in checkers). */
  playable?: boolean;
}

export interface BoardView {
  rows: number;
  cols: number;
  cells: CellView[];
  fileLabels?: string[];
  rankLabels?: string[];
}

export type GameStatus =
  | { kind: 'playing' }
  | { kind: 'check'; player: Player }
  | { kind: 'win'; winner: Player; reason: string }
  | { kind: 'draw'; reason: string };

/** The minimal shape every move shares. Games may extend it with extra fields. */
export interface MoveBase {
  /** Unique within a given position; used as a React key and for equality. */
  id: string;
  /** Source cell index for "move" games; omitted for "place"/"drop" games. */
  from?: number;
  /** Destination / placement cell index. */
  to: number;
  /** Human-readable notation, e.g. "Nf3", "e4", "King to c5". */
  notation: string;
  capture?: boolean;
  /** Cells captured/flipped as a side effect (checkers jumps, reversi flips). */
  affected?: number[];
  /** Piece kind a pawn promotes to, when relevant. */
  promotion?: string;
}

/* ----------------------------- The Tutor ------------------------------ */

/** Quality band assigned to a move, in the spirit of chess engines. */
export type EvalBand =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'good'
  | 'book'
  | 'solid'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export interface MoveInsight {
  tag: string;
  detail: string;
  tone: 'good' | 'bad' | 'info';
}

/** The rich, human explanation that powers the standout tutor panel. */
export interface MoveExplanation {
  /** One-sentence headline, e.g. "Knight develops and hits the e5 pawn." */
  summary: string;
  band: EvalBand;
  /** Evaluation (centipawn-like, + favours player 0) before and after. */
  evalBefore: number;
  evalAfter: number;
  insights: MoveInsight[];
  /** Teaching principles invoked, e.g. "Control the center". */
  principles: string[];
  /** What the move now threatens. */
  threats?: string[];
  /** A stronger idea the learner could have considered. */
  betterIdea?: string;
}

export type Difficulty = 'tutor' | 'easy' | 'medium' | 'hard' | 'master';

export interface InteractionModel {
  /**
   * - `move`  : select a source cell, then a destination (Chess, Checkers).
   * - `place` : click an empty cell to drop a mark there (Tic-Tac-Toe, Gomoku, Reversi).
   * - `drop`  : click a column; the piece falls to the lowest free cell (Connect Four).
   */
  type: 'move' | 'place' | 'drop';
}

export interface RenderConfig {
  /** 2D + 3D piece archetype. */
  pieceStyle: 'chess' | 'disc' | 'checker' | 'stone' | 'mark' | 'token';
  showCoordinates: boolean;
  /** Pieces sit on the *intersections* of lines (Go/Gomoku) vs inside squares. */
  intersections?: boolean;
  /** Suggested gap between cells in 2D (px multiplier). */
  cellGap?: number;
  /** Whether the 3D board should render with a chequered pattern. */
  checkered: boolean;
}

/* ----------------------------- Tutorials ------------------------------ */

export interface TutorialStep {
  title: string;
  body: string;
  /** Optional illustrative position (game-serialized) shown on a mini board. */
  setup?: string;
  highlight?: number[];
  arrows?: Array<{ from: number; to: number; tone?: 'good' | 'bad' | 'info' }>;
}

export interface TutorialChapter {
  title: string;
  icon: string;
  steps: TutorialStep[];
}

export interface Tutorial {
  overview: string;
  objective: string;
  chapters: TutorialChapter[];
}

/* --------------------------- Game definition -------------------------- */

export interface GameDefinition<S = any, M extends MoveBase = MoveBase> {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  category: 'Classic' | 'Strategy' | 'Abstract' | 'Family';
  /** 1 (trivial) … 5 (lifelong) — how hard the game is to master. */
  depth: 1 | 2 | 3 | 4 | 5;
  emoji: string;
  /** Accent color for cards/headers. */
  accent: string;
  players: [PlayerInfo, PlayerInfo];
  interaction: InteractionModel;
  render: RenderConfig;

  createInitialState(): S;
  cloneState(s: S): S;
  getBoardView(s: S): BoardView;
  getTurn(s: S): Player;
  getStatus(s: S): GameStatus;
  /** Legal moves, optionally restricted to those originating from `fromCell`. */
  getLegalMoves(s: S, fromCell?: number | null): M[];
  applyMove(s: S, m: M): S;

  /** Pick a move for the AI at the given difficulty. */
  chooseMove(s: S, difficulty: Difficulty): M | null;
  /** Static evaluation; positive favours player 0. */
  evaluate(s: S): number;

  /** Produce the rich tutor explanation for a move that was just played. */
  explainMove(before: S, move: M, after: S): MoveExplanation;
  /** Suggest the human's best move and why (the "Hint" button). */
  hint(s: S): { move: M; text: string } | null;

  serialize(s: S): string;
  deserialize(str: string): S;

  tutorial: Tutorial;
}
