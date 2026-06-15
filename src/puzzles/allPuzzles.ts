/**
 * The puzzle pool for Puzzle Mode: the curated, engine-verified chess tactics
 * dataset plus every interactive "Trainer" challenge from all 13 games' courses
 * — so the trainer spans the whole center, not just chess.
 */
import { GAMES } from '../engine/registry';
import { CHESS_PUZZLES } from './chessPuzzles';

export interface Puzzle {
  id: string;
  gameId: string;
  gameName: string;
  setup?: string;
  solution: string[];
  prompt: string;
  theme: string;
  rating: number;
}

export function buildPuzzles(): Puzzle[] {
  const out: Puzzle[] = [];

  for (const p of CHESS_PUZZLES) {
    const side = p.fen.split(/\s+/)[1] === 'b' ? 'Black' : 'White';
    out.push({
      id: `chess:${p.id}`, gameId: 'chess', gameName: 'Chess', setup: p.fen,
      solution: p.solution, prompt: `${side} to play — find the best move.`, theme: p.theme, rating: p.rating,
    });
  }

  for (const g of GAMES) {
    g.tutorial.chapters.forEach((ch) => ch.steps.forEach((st) => {
      if (!st.challenge) return;
      out.push({
        id: `${g.id}:${st.title}`, gameId: g.id, gameName: g.name, setup: st.setup,
        solution: st.challenge.solution, prompt: st.challenge.prompt, theme: g.name, rating: g.depth * 220 + 500,
      });
    }));
  }
  return out;
}

export const ALL_PUZZLES = buildPuzzles();

export const PUZZLE_GAME_IDS = Array.from(new Set(ALL_PUZZLES.map((p) => p.gameId)));

export function shuffle<T>(arr: T[], seed = Date.now()): T[] {
  const a = arr.slice();
  let s = seed >>> 0;
  const rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
