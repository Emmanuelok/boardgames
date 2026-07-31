import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../engine/registry';
import { GAME_THUMBNAILS } from './GamesGallery';

describe('game catalogue thumbnails', () => {
  const catalogueKeys = CATALOGUE.map((entry) => (
    entry.type === 'family' ? entry.family.id : entry.def.id
  ));

  it('has one unique curated image for every catalogue world', () => {
    expect(Object.keys(GAME_THUMBNAILS).sort()).toEqual([...catalogueKeys].sort());
    expect(new Set(Object.values(GAME_THUMBNAILS)).size).toBe(catalogueKeys.length);
  });

  it('references optimized image files that exist in public assets', () => {
    Object.values(GAME_THUMBNAILS).forEach((src) => {
      expect(src.endsWith('.webp')).toBe(true);
      expect(existsSync(resolve(process.cwd(), 'public', src.replace(/^\//, '')))).toBe(true);
    });
  });
});
