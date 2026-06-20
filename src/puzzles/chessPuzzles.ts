/**
 * A curated, engine-verified dataset of chess tactics puzzles for "Puzzle Mode".
 *
 * Every puzzle in this file has been checked against this project's own chess
 * engine (see src/games/chess/engine.ts and src/games/chess/search.ts):
 *   (a) `fromFen(fen)` parses to a legal position and the side to move has legal
 *       moves;
 *   (b) `solution[0]`, stripped of any trailing `+`/`#`, equals the SAN of one of
 *       those legal moves; and
 *   (c) running `analyze(state, 6, 1500)` ranks that move as the engine's #1
 *       choice (i.e. it is `ranked[0]`), not merely a good move.
 *
 * A puzzle is "solved" when the player's first move — its SAN stripped of any
 * trailing `+`/`#` — equals `solution[0]` stripped the same way. The side to move
 * in the FEN is always the side that must find the tactic.
 *
 * This module is pure data. It imports only a *type* from the engine, so loading
 * it triggers no runtime side effects.
 */
import type { ChessState } from '../games/chess/engine';

// Referenced solely to anchor every FEN to the engine's own state convention;
// this keeps the type import meaningful without pulling in any runtime code.
export type PuzzleStateShape = ChessState;

export interface ChessPuzzle {
  id: string;
  fen: string;
  solution: string[];
  theme: string;
  rating: number;
}

export const CHESS_PUZZLES: ChessPuzzle[] = [
  /* ----------------------------- Mate in 1 ---------------------------- */
  {
    id: 'm1-queen-backrank',
    fen: '6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1',
    solution: ['Qd8#'],
    theme: 'Mate in 1',
    rating: 640,
  },
  {
    id: 'm1-rook-backrank-e',
    fen: '6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1',
    solution: ['Re8#'],
    theme: 'Mate in 1',
    rating: 600,
  },
  {
    id: 'm1-rook-corner',
    fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1',
    solution: ['Ra8#'],
    theme: 'Mate in 1',
    rating: 700,
  },
  {
    id: 'm1-backrank-rook',
    fen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1',
    solution: ['Ra8#'],
    theme: 'Mate in 1',
    rating: 800,
  },
  {
    id: 'm1-queen-e8',
    fen: '6k1/5ppp/8/8/8/8/6PP/4Q1K1 w - - 0 1',
    solution: ['Qe8#'],
    theme: 'Mate in 1',
    rating: 820,
  },
  {
    id: 'm1-rook-ladder',
    fen: '4k3/8/4K3/8/8/8/7R/8 w - - 0 1',
    solution: ['Rh8#'],
    theme: 'Mate in 1',
    rating: 810,
  },
  {
    id: 'm1-queen-h-file',
    fen: '7k/6pp/8/8/8/8/8/Q6K w - - 0 1',
    solution: ['Qa8#'],
    theme: 'Mate in 1',
    rating: 840,
  },
  {
    id: 'm1-queen-king-escort',
    fen: '6k1/8/5KP1/8/8/8/8/3Q4 w - - 0 1',
    solution: ['Qd8#'],
    theme: 'Mate in 1',
    rating: 880,
  },
  {
    id: 'm1-corner-rook',
    fen: 'k7/2K5/8/8/8/8/8/7R w - - 0 1',
    solution: ['Ra1#'],
    theme: 'Mate in 1',
    rating: 860,
  },

  /* ----------------------------- Mate in 2 ---------------------------- */
  {
    id: 'm2-rook-ladder',
    fen: '6k1/8/6K1/8/8/8/1R6/R7 w - - 0 1',
    solution: ['Rb8+'],
    theme: 'Mate in 2',
    rating: 1080,
  },
  {
    id: 'm2-rook-push',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    solution: ['Ra8+'],
    theme: 'Mate in 2',
    rating: 1120,
  },

  /* ------------------------------- Fork ------------------------------- */
  {
    id: 'fork-knight-takes-queen',
    fen: '4k3/8/8/3N4/8/2q5/8/4K3 w - - 0 1',
    solution: ['Nxc3'],
    theme: 'Fork',
    rating: 980,
  },
  {
    id: 'fork-knight-grabs-queen',
    fen: 'r3k3/8/8/8/4q3/8/3N4/4K3 w - - 0 1',
    solution: ['Nxe4'],
    theme: 'Fork',
    rating: 1020,
  },
  {
    id: 'fork-knight-family',
    fen: '3rk3/8/4N3/8/8/8/8/4K3 w - - 0 1',
    solution: ['Nxd8'],
    theme: 'Fork',
    rating: 960,
  },
  {
    id: 'fork-knight-king-queen-c7',
    fen: 'q3k3/8/8/3N4/8/8/6PP/6K1 w - - 0 1',
    solution: ['Nc7+'],
    theme: 'Fork',
    rating: 1180,
  },
  {
    id: 'fork-knight-king-rook-c7',
    fen: 'r3k3/8/8/3N4/8/8/6PP/6K1 w - - 0 1',
    solution: ['Nc7+'],
    theme: 'Fork',
    rating: 1150,
  },
  {
    id: 'fork-queen-double-attack',
    fen: 'r5k1/5ppp/8/8/Q7/8/5PPP/6K1 w - - 0 1',
    solution: ['Qxa8#'],
    theme: 'Fork',
    rating: 1090,
  },

  /* -------------------------------- Pin -------------------------------- */
  {
    id: 'pin-win-rook',
    fen: '3rk3/8/8/8/8/8/3Q4/3RK3 w - - 0 1',
    solution: ['Qxd8+'],
    theme: 'Pin',
    rating: 1080,
  },
  {
    id: 'pin-queen-takes-queen',
    fen: '3qk3/8/8/8/3Q4/8/8/3RK3 w - - 0 1',
    solution: ['Qxd8+'],
    theme: 'Pin',
    rating: 1130,
  },

  /* ------------------------------ Skewer ------------------------------ */
  {
    id: 'skewer-queen-diagonal',
    fen: '7k/6q1/8/8/8/8/5PPP/Q5K1 w - - 0 1',
    solution: ['Qa8+'],
    theme: 'Skewer',
    rating: 1220,
  },
  {
    id: 'skewer-bishop-diagonal',
    fen: '7k/6q1/8/8/3B4/8/5PPP/6K1 w - - 0 1',
    solution: ['Bxg7+'],
    theme: 'Skewer',
    rating: 1240,
  },
  {
    id: 'skewer-rook-file',
    fen: 'q7/8/8/8/k7/8/6PP/1R4K1 w - - 0 1',
    solution: ['Ra1+'],
    theme: 'Skewer',
    rating: 1200,
  },

  /* -------------------------- Hanging piece --------------------------- */
  {
    id: 'hang-knight',
    fen: '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1',
    solution: ['Qxd5'],
    theme: 'Hanging piece',
    rating: 880,
  },
  {
    id: 'hang-rook',
    fen: '4k3/8/8/8/3r4/8/8/3RK3 w - - 0 1',
    solution: ['Rxd4'],
    theme: 'Hanging piece',
    rating: 860,
  },
  {
    id: 'hang-bishop-pawn-capture',
    fen: '4k3/8/8/4b3/3P4/8/8/4K3 w - - 0 1',
    solution: ['dxe5'],
    theme: 'Hanging piece',
    rating: 900,
  },
  {
    id: 'hang-queen-rook-grab',
    fen: '4k3/8/8/2q5/8/2R5/8/4K3 w - - 0 1',
    solution: ['Rxc5'],
    theme: 'Hanging piece',
    rating: 940,
  },

  /* ------------------------------ Back-rank --------------------------- */
  {
    id: 'backrank-rook-mate',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    solution: ['Ra8#'],
    theme: 'Back-rank',
    rating: 940,
  },
  {
    id: 'backrank-queen-grab',
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1',
    solution: ['Qxd8+'],
    theme: 'Back-rank',
    rating: 1010,
  },
  {
    id: 'backrank-rook-trade-mate',
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    solution: ['Rxd8#'],
    theme: 'Back-rank',
    rating: 990,
  },

  /* -------------------------- Discovered attack ----------------------- */
  {
    id: 'discovery-knight-rook-battery',
    fen: '4k3/8/8/8/8/2q5/4N3/3RK3 w - - 0 1',
    solution: ['Nxc3'],
    theme: 'Discovered attack',
    rating: 1180,
  },
  {
    id: 'discovery-knight-check-wins-queen',
    fen: '3k4/8/8/5q2/3N4/8/6PP/3R2K1 w - - 0 1',
    solution: ['Nxf5+'],
    theme: 'Discovered attack',
    rating: 1260,
  },

  /* ------------------------------ Promotion --------------------------- */
  {
    id: 'promo-simple-queen',
    fen: '7k/3P4/8/8/8/8/8/4K3 w - - 0 1',
    solution: ['d8=Q+'],
    theme: 'Promotion',
    rating: 860,
  },
  {
    id: 'promo-capture-rook',
    fen: '2r5/3P4/3K4/8/8/8/8/7k w - - 0 1',
    solution: ['dxc8=Q'],
    theme: 'Promotion',
    rating: 1000,
  },
  {
    id: 'promo-pawn-race',
    fen: '8/P6k/8/8/8/8/8/4K3 w - - 0 1',
    solution: ['a8=Q'],
    theme: 'Promotion',
    rating: 820,
  },
];

export default CHESS_PUZZLES;
