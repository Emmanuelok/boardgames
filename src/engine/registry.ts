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
import shogi from '../games/shogi';
import backgammon from '../games/backgammon';
import breakthrough from '../games/breakthrough';
import linesOfAction from '../games/linesOfAction';
import konane from '../games/konane';
import clobber from '../games/clobber';
import amazons from '../games/amazons';
import dotsAndBoxes from '../games/dotsandboxes';
import tafl from '../games/tafl';
import pentago from '../games/pentago';

/**
 * The master catalogue. Every game in the center is registered here; the hub,
 * router and game screen are driven entirely off this list, so adding a new
 * board game is as simple as implementing {@link GameDefinition} and adding it.
 */
export const GAMES: GameDefinition[] = [
  chess,
  xiangqi,
  shogi,
  tafl,
  checkers,
  draughts,
  breakthrough,
  ninemensmorris,
  backgammon,
  dotsAndBoxes,
  pentago,
  reversi,
  linesOfAction,
  konane,
  clobber,
  amazons,
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

/**
 * Game families. Closely-related games (e.g. Checkers vs International Draughts)
 * are grouped so the hub shows ONE entry per family; the play screen then offers
 * a variant switcher. A game not in any family stands on its own.
 */
export interface GameFamily {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  category: GameDefinition['category'];
  /** Variant game ids, primary first (the default the family card opens). */
  variants: { id: string; label: string }[];
}

export const FAMILIES: GameFamily[] = [
  {
    id: 'chess', name: 'Chess', emoji: '♛', category: 'Strategy',
    tagline: 'The royal game and its great cousins — three cultures, one hunt for the king.',
    variants: [
      { id: 'chess', label: 'International' },
      { id: 'xiangqi', label: 'Xiangqi · Chinese' },
      { id: 'shogi', label: 'Shogi · Japanese' },
    ],
  },
  {
    id: 'draughts', name: 'Checkers & Draughts', emoji: '⛂', category: 'Classic',
    tagline: 'Jump, capture and crown your kings — on the small board or the big one.',
    variants: [
      { id: 'checkers', label: 'Checkers · 8×8' },
      { id: 'draughts', label: 'International · 10×10' },
    ],
  },
  {
    id: 'n-in-a-row', name: 'N-in-a-Row', emoji: '⭕', category: 'Family',
    tagline: 'Line up your pieces before your opponent — from 3 in a row to 5.',
    variants: [
      { id: 'gomoku', label: 'Gomoku · five' },
      { id: 'pente', label: 'Pente · + captures' },
      { id: 'connect-four', label: 'Connect Four' },
      { id: 'tic-tac-toe', label: 'Tic-Tac-Toe' },
    ],
  },
];

const VARIANT_FAMILY = new Map<string, GameFamily>();
for (const f of FAMILIES) for (const v of f.variants) VARIANT_FAMILY.set(v.id, f);

/** The family a game belongs to, if any. */
export function familyOf(id: string | undefined): GameFamily | undefined {
  return id ? VARIANT_FAMILY.get(id) : undefined;
}

export type CatalogueEntry =
  | { type: 'game'; def: GameDefinition }
  | { type: 'family'; family: GameFamily; primary: GameDefinition };

/** The hub catalogue: one entry per family (collapsed at its first member) or
 *  standalone game, preserving registry order. */
export const CATALOGUE: CatalogueEntry[] = (() => {
  const out: CatalogueEntry[] = [];
  const seen = new Set<string>();
  for (const g of GAMES) {
    const fam = VARIANT_FAMILY.get(g.id);
    if (fam) {
      if (!seen.has(fam.id)) { seen.add(fam.id); out.push({ type: 'family', family: fam, primary: GAME_MAP[fam.variants[0].id] }); }
    } else {
      out.push({ type: 'game', def: g });
    }
  }
  return out;
})();
