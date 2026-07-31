import type { Player } from '../engine/types';
import { SCANNER_GAME_MAP } from './games';
import type { ScanCell, ScanDraft, ScannerGame } from './types';

export const SCAN_DRAFT_STORAGE_KEY = 'gm-scan-draft-v1';

function playerValue(cell: ScanCell): Player | null {
  if (cell.occupant === 'player0') return 0;
  if (cell.occupant === 'player1') return 1;
  return null;
}

function serializeChess(cells: ScanCell[], turn: Player): string {
  const rows: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    let empty = 0;
    let fen = '';
    for (let col = 0; col < 8; col += 1) {
      const cell = cells[row * 8 + col];
      if (!cell || cell.occupant === 'empty') {
        empty += 1;
        continue;
      }
      if (empty) {
        fen += String(empty);
        empty = 0;
      }
      const kind = /^[PNBRQK]$/.test(cell.kind) ? cell.kind : 'P';
      fen += cell.occupant === 'player0' ? kind : kind.toLowerCase();
    }
    if (empty) fen += String(empty);
    rows.push(fen || '8');
  }
  // Castling and en-passant history cannot be proved from a photograph.
  return `${rows.join('/')} ${turn === 0 ? 'w' : 'b'} - - 0 1`;
}

export function serializeScanPosition(game: ScannerGame, cells: ScanCell[], turn: Player): string {
  if (game.id === 'chess') return serializeChess(cells, turn);
  if (game.id === 'checkers') {
    return JSON.stringify({
      squares: cells.map((cell) => {
        const player = playerValue(cell);
        return player === null ? null : { player, king: cell.kind === 'king' };
      }),
      turn,
    });
  }
  const board = cells.map(playerValue);
  if (game.id === 'go') return JSON.stringify({ board, turn, passes: 0, ko: -1, captures: [0, 0] });
  if (game.id === 'gomoku') return JSON.stringify({ board, turn, last: -1 });
  if (game.id === 'pente') return JSON.stringify({ board, turn, captures: [0, 0], last: -1 });
  return JSON.stringify({ board, turn });
}

function safeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createScanDraft(game: ScannerGame, cells: ScanCell[], turn: Player): ScanDraft {
  const summary = {
    player0: cells.filter((cell) => cell.occupant === 'player0').length,
    player1: cells.filter((cell) => cell.occupant === 'player1').length,
    empty: cells.filter((cell) => cell.occupant === 'empty').length,
    lowConfidence: cells.filter((cell) => cell.confidence < 0.55).length,
  };
  return {
    version: 1,
    id: safeId(),
    gameId: game.id,
    gameName: game.name,
    rows: game.rows,
    cols: game.cols,
    turn,
    cells,
    serialized: serializeScanPosition(game, cells, turn),
    createdAt: new Date().toISOString(),
    summary,
  };
}

export function isScanDraft(value: unknown): value is ScanDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<ScanDraft>;
  const game = typeof draft.gameId === 'string' ? SCANNER_GAME_MAP[draft.gameId] : undefined;
  return draft.version === 1
    && !!game
    && draft.rows === game.rows
    && draft.cols === game.cols
    && Array.isArray(draft.cells)
    && draft.cells.length === game.rows * game.cols
    && (draft.turn === 0 || draft.turn === 1)
    && typeof draft.serialized === 'string';
}

export function saveScanDraft(draft: ScanDraft, storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SCAN_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readScanDraft(storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage): ScanDraft | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(SCAN_DRAFT_STORAGE_KEY) ?? 'null');
    return isScanDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** One-shot handoff for GameScreen integration; malformed drafts are discarded. */
export function consumeScanDraft(storage: Storage | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage): ScanDraft | null {
  const draft = readScanDraft(storage);
  try {
    storage?.removeItem(SCAN_DRAFT_STORAGE_KEY);
  } catch {
    // A failed cleanup must not make a valid imported position unusable.
  }
  return draft;
}
