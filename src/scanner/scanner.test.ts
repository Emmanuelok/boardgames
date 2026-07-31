import { beforeEach, describe, expect, it } from 'vitest';
import { sampleBoardImage } from './imagePipeline';
import { scannerGame } from './games';
import {
  SCAN_DRAFT_STORAGE_KEY,
  consumeScanDraft,
  createScanDraft,
  readScanDraft,
  saveScanDraft,
  serializeScanPosition,
} from './positionDraft';
import type { ScanCell, ScannerGame } from './types';
import { useGameStore } from '../store/useGameStore';

function syntheticImage(): ImageData {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = 130;
    data[i * 4 + 1] = 130;
    data[i * 4 + 2] = 130;
    data[i * 4 + 3] = 255;
  }
  const disc = (cx: number, cy: number, value: number) => {
    for (let y = cy - 9; y <= cy + 9; y += 1) {
      for (let x = cx - 9; x <= cx + 9; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > 81) continue;
        const offset = (y * width + x) * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
      }
    }
  };
  disc(25, 25, 12);
  disc(75, 25, 245);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

const SAMPLE_GAME: ScannerGame = {
  id: 'sample',
  name: 'Sample',
  rows: 2,
  cols: 2,
  sampling: 'squares',
  playerNames: ['Light', 'Dark'],
  lighterPlayer: 0,
  pieceKinds: [{ id: 'stone', label: 'Stone', glyph: '●' }],
  defaultKind: 'stone',
  notes: '',
};

describe('physical-board scanner', () => {
  beforeEach(() => sessionStorage.clear());

  it('uses real pixel contrast to distinguish empty, light, and dark pieces', () => {
    const result = sampleBoardImage(syntheticImage(), SAMPLE_GAME, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(result.cells).toHaveLength(4);
    expect(result.cells[0].occupant).toBe('player1');
    expect(result.cells[1].occupant).toBe('player0');
    expect(result.cells[2].occupant).toBe('empty');
    expect(result.cells[3].occupant).toBe('empty');
  });

  it('serializes verified chess cells to a conservative FEN', () => {
    const game = scannerGame('chess');
    const cells: ScanCell[] = Array.from({ length: 64 }, (_, index) => ({
      index,
      row: Math.floor(index / 8),
      col: index % 8,
      occupant: 'empty',
      kind: '',
      confidence: 1,
      occupancyScore: 0,
    }));
    cells[4] = { ...cells[4], occupant: 'player1', kind: 'K' };
    cells[60] = { ...cells[60], occupant: 'player0', kind: 'K' };
    expect(serializeScanPosition(game, cells, 0)).toBe('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  });

  it('stores only normalized board data and consumes it once', () => {
    const game = scannerGame('tic-tac-toe');
    const cells: ScanCell[] = Array.from({ length: 9 }, (_, index) => ({
      index,
      row: Math.floor(index / 3),
      col: index % 3,
      occupant: index === 0 ? 'player0' : 'empty',
      kind: index === 0 ? 'mark' : '',
      confidence: 1,
      occupancyScore: index === 0 ? 1 : 0,
    }));
    const draft = createScanDraft(game, cells, 1);
    expect(saveScanDraft(draft)).toBe(true);
    expect(sessionStorage.getItem(SCAN_DRAFT_STORAGE_KEY)).not.toContain('data:image');
    expect(readScanDraft()?.summary.player0).toBe(1);
    expect(consumeScanDraft()?.id).toBe(draft.id);
    expect(readScanDraft()).toBeNull();
  });

  it('keeps the scanned side to move under human control when loading a position', () => {
    const game = scannerGame('tic-tac-toe');
    const cells: ScanCell[] = Array.from({ length: 9 }, (_, index) => ({
      index,
      row: Math.floor(index / 3),
      col: index % 3,
      occupant: index === 0 ? 'player0' : 'empty',
      kind: index === 0 ? 'mark' : '',
      confidence: 1,
      occupancyScore: index === 0 ? 1 : 0,
    }));
    const draft = createScanDraft(game, cells, 1);
    expect(useGameStore.getState().loadPosition(draft.gameId, draft.serialized, { humanColor: draft.turn })).toBe(true);
    expect(useGameStore.getState()).toMatchObject({
      gameId: 'tic-tac-toe',
      mode: 'ai',
      humanColor: 1,
      thinking: false,
      flipped: true,
    });
    // Leave any delayed driver unable to act after this test finishes.
    useGameStore.setState({ mode: 'pass', humanColor: 0, thinking: false });
  });
});
