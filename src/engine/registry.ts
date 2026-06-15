import type { GameDefinition } from './types';
import ticTacToe from '../games/ticTacToe';
import connectFour from '../games/connectFour';
import gomoku from '../games/gomoku';
import reversi from '../games/reversi';
import checkers from '../games/checkers';
import chess from '../games/chess';
import draughts from '../games/draughts';
import pente from '../games/pente';
import go from '../games/go';
import xiangqi from '../games/xiangqi';
import hex from '../games/hex';
import mancala from '../games/mancala';
import ninemensmorris from '../games/ninemensmorris';

/**
 * The master catalogue. Every game in the center is registered here; the hub,
 * router and game screen are driven entirely off this list, so adding a new
 * board game is as simple as implementing {@link GameDefinition} and adding it.
 */
export const GAMES: GameDefinition[] = [
  chess,
  xiangqi,
  checkers,
  draughts,
  ninemensmorris,
  reversi,
  connectFour,
  mancala,
  go,
  gomoku,
  pente,
  hex,
  ticTacToe,
];

export const GAME_MAP: Record<string, GameDefinition> = Object.fromEntries(
  GAMES.map((g) => [g.id, g]),
);

export function getGame(id: string | undefined): GameDefinition | undefined {
  return id ? GAME_MAP[id] : undefined;
}
