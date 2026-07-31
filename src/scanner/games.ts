import type { ScannerGame } from './types';

const CHESS_PIECES = [
  { id: 'P', label: 'Pawn', glyph: '♟' },
  { id: 'N', label: 'Knight', glyph: '♞' },
  { id: 'B', label: 'Bishop', glyph: '♝' },
  { id: 'R', label: 'Rook', glyph: '♜' },
  { id: 'Q', label: 'Queen', glyph: '♛' },
  { id: 'K', label: 'King', glyph: '♚' },
];

const CHECKER_PIECES = [
  { id: 'man', label: 'Man', glyph: '●' },
  { id: 'king', label: 'King', glyph: '♛' },
];

const STONE = [{ id: 'stone', label: 'Stone', glyph: '●' }];
const DISC = [{ id: 'disc', label: 'Disc', glyph: '●' }];
const MARK = [{ id: 'mark', label: 'Mark', glyph: '●' }];

export const SCANNER_GAMES: ScannerGame[] = [
  {
    id: 'chess',
    name: 'Chess',
    rows: 8,
    cols: 8,
    sampling: 'squares',
    playerNames: ['White', 'Black'],
    lighterPlayer: 0,
    pieceKinds: CHESS_PIECES,
    defaultKind: 'P',
    notes: 'The scan estimates occupied squares and piece colour. Confirm each piece type; a photo cannot prove castling or en-passant history.',
  },
  {
    id: 'checkers',
    name: 'Checkers',
    rows: 8,
    cols: 8,
    sampling: 'squares',
    playerNames: ['Red', 'Black'],
    lighterPlayer: 0,
    pieceKinds: CHECKER_PIECES,
    defaultKind: 'man',
    notes: 'Confirm crowned kings and remove any false readings on the unused light squares.',
  },
  {
    id: 'reversi',
    name: 'Reversi',
    rows: 8,
    cols: 8,
    sampling: 'squares',
    playerNames: ['Black', 'White'],
    lighterPlayer: 1,
    pieceKinds: DISC,
    defaultKind: 'disc',
    notes: 'Disc colour and occupancy can usually be recognized well on an evenly lit board.',
  },
  {
    id: 'go',
    name: 'Go · 9×9',
    rows: 9,
    cols: 9,
    sampling: 'intersections',
    playerNames: ['Black', 'White'],
    lighterPlayer: 1,
    pieceKinds: STONE,
    defaultKind: 'stone',
    notes: 'Place all four outer intersections inside the crop. Ko and capture history cannot be recovered from one photograph.',
  },
  {
    id: 'gomoku',
    name: 'Gomoku · 15×15',
    rows: 15,
    cols: 15,
    sampling: 'intersections',
    playerNames: ['Black', 'White'],
    lighterPlayer: 1,
    pieceKinds: STONE,
    defaultKind: 'stone',
    notes: 'Use a straight overhead photo with every outer intersection visible.',
  },
  {
    id: 'pente',
    name: 'Pente · 13×13',
    rows: 13,
    cols: 13,
    sampling: 'intersections',
    playerNames: ['Black', 'White'],
    lighterPlayer: 1,
    pieceKinds: STONE,
    defaultKind: 'stone',
    notes: 'Captured-pair history cannot be inferred, so imported positions begin with zero banked pairs.',
  },
  {
    id: 'tic-tac-toe',
    name: 'Tic-Tac-Toe',
    rows: 3,
    cols: 3,
    sampling: 'squares',
    playerNames: ['X', 'O'],
    lighterPlayer: 1,
    pieceKinds: MARK,
    defaultKind: 'mark',
    notes: 'Confirm X and O after sampling; hand-drawn marks vary too much for a confident automatic label.',
  },
];

export const SCANNER_GAME_MAP = Object.fromEntries(
  SCANNER_GAMES.map((game) => [game.id, game]),
) as Record<string, ScannerGame>;

export function scannerGame(gameId: string): ScannerGame {
  return SCANNER_GAME_MAP[gameId] ?? SCANNER_GAMES[0];
}
