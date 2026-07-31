import type { Player } from '../engine/types';

export type ScanOccupant = 'empty' | 'player0' | 'player1';
export type ScanSampling = 'squares' | 'intersections';

export interface ScanToken {
  occupant: ScanOccupant;
  /** Engine-facing piece kind. Placement games use a single generic kind. */
  kind: string;
}

export interface ScanCell extends ScanToken {
  index: number;
  row: number;
  col: number;
  /** 0–1 estimate from image sampling. Corrections made by the player are 1. */
  confidence: number;
  /** Normalized foreground/texture score used to make the occupancy decision. */
  occupancyScore: number;
}

export interface ScanCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ScannerGame {
  id: string;
  name: string;
  rows: number;
  cols: number;
  sampling: ScanSampling;
  playerNames: [string, string];
  /** Which engine player is normally represented by the lighter physical piece. */
  lighterPlayer: Player;
  pieceKinds: Array<{ id: string; label: string; glyph: string }>;
  defaultKind: string;
  notes: string;
}

export interface ScanResult {
  cells: ScanCell[];
  averageConfidence: number;
  lowConfidenceCount: number;
}

export interface ScanDraft {
  version: 1;
  id: string;
  gameId: string;
  gameName: string;
  rows: number;
  cols: number;
  turn: Player;
  cells: ScanCell[];
  serialized: string;
  createdAt: string;
  summary: {
    player0: number;
    player1: number;
    empty: number;
    lowConfidence: number;
  };
}
