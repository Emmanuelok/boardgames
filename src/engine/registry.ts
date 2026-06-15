import type { GameDefinition } from './types';
import ticTacToe from '../games/ticTacToe';
import connectFour from '../games/connectFour';
import gomoku from '../games/gomoku';
import reversi from '../games/reversi';
import checkers from '../games/checkers';
import chess from '../games/chess';

/**
 * The master catalogue. Every game in the center is registered here; the hub,
 * router and game screen are driven entirely off this list, so adding a new
 * board game is as simple as implementing {@link GameDefinition} and adding it.
 */
export const GAMES: GameDefinition[] = [
  chess,
  checkers,
  reversi,
  connectFour,
  gomoku,
  ticTacToe,
];

export const GAME_MAP: Record<string, GameDefinition> = Object.fromEntries(
  GAMES.map((g) => [g.id, g]),
);

export function getGame(id: string | undefined): GameDefinition | undefined {
  return id ? GAME_MAP[id] : undefined;
}
