import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_STORAGE_KEY,
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  applyAccessibilityPreferences,
  normalizeAccessibilityPreferences,
  readAccessibilityPreferences,
  saveAccessibilityPreferences,
} from './preferences';

describe('accessibility preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
    for (const key of Object.keys(document.documentElement.dataset)) {
      delete document.documentElement.dataset[key];
    }
  });

  it('preserves the authored dark presentation until the player chooses otherwise', () => {
    expect(DEFAULT_ACCESSIBILITY_PREFERENCES.theme).toBe('dark');
    applyAccessibilityPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
    expect(document.documentElement.dataset.uiTheme).toBe('dark');
  });

  it('repairs malformed persisted values with safe defaults', () => {
    expect(normalizeAccessibilityPreferences({
      theme: 'neon',
      contrast: 'high',
      textScale: 999,
      motion: 'reduced',
      playerPatterns: 'yes',
    })).toEqual({
      ...DEFAULT_ACCESSIBILITY_PREFERENCES,
      contrast: 'high',
      motion: 'reduced',
    });
  });

  it('persists a versioned preference record', () => {
    const next = { ...DEFAULT_ACCESSIBILITY_PREFERENCES, theme: 'light' as const, textScale: 125 as const };
    expect(saveAccessibilityPreferences(next)).toBe(true);
    expect(JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? '{}').version).toBe(1);
    expect(readAccessibilityPreferences()).toEqual(next);
  });

  it('applies non-colour cues and readable sizing to the root element', () => {
    const root = document.documentElement;
    applyAccessibilityPreferences({
      ...DEFAULT_ACCESSIBILITY_PREFERENCES,
      theme: 'light',
      contrast: 'high',
      textScale: 112,
      playerPatterns: true,
      font: 'readable',
    }, root);
    expect(root.dataset.uiTheme).toBe('light');
    expect(root.dataset.contrast).toBe('high');
    expect(root.dataset.playerPatterns).toBe('true');
    expect(root.dataset.readableFont).toBe('true');
    expect(root.style.getPropertyValue('--a11y-text-scale')).toBe('1.12');
  });
});
