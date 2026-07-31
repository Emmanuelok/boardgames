import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPwaSnapshot,
  PWA_OFFLINE_CACHE_VERSION,
  PWA_OFFLINE_READY_STORAGE_KEY,
  readPwaOfflineReady,
} from './register';

describe('offline app foundation', () => {
  beforeEach(() => localStorage.clear());

  it('ships an installable manifest with all required local icons', () => {
    const manifestPath = resolve(process.cwd(), 'public/manifest.webmanifest');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.start_url).toBe('./#/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons).toHaveLength(3);
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(process.cwd(), 'public', icon.src.replace(/^\.\//, '')))).toBe(true);
    }
  });

  it('ships a worker with shell fallback, runtime caching, and opt-in full download', () => {
    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    expect(source).toContain("request.mode === 'navigate'");
    expect(source).toContain("type !== 'CACHE_APP'");
    expect(source).toContain('CACHE_APP_DONE');
    expect(source).toContain('SKIP_WAITING');
    expect(source).toContain('const cached = await caches.match(request)');
    expect(source).toContain('/\\.(?:js|css)$/i');
  });

  it('exposes a stable status snapshot when service workers are unavailable', () => {
    const first = getPwaSnapshot();
    expect(getPwaSnapshot()).toBe(first);
    expect(typeof first.online).toBe('boolean');
    expect(typeof first.supported).toBe('boolean');
  });

  it('only restores a valid ready flag for the current cache version', () => {
    localStorage.setItem(PWA_OFFLINE_READY_STORAGE_KEY, JSON.stringify({
      version: 1,
      cacheVersion: PWA_OFFLINE_CACHE_VERSION,
      ready: true,
      cachedAt: Date.now(),
    }));
    expect(readPwaOfflineReady()).toBe(true);

    localStorage.setItem(PWA_OFFLINE_READY_STORAGE_KEY, JSON.stringify({
      version: 1,
      cacheVersion: 'gm-offline-stale',
      ready: true,
      cachedAt: Date.now(),
    }));
    expect(readPwaOfflineReady()).toBe(false);
  });
});
