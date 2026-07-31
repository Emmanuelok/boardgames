import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESSIBILITY_STORAGE_KEY } from '../accessibility/preferences';
import {
  getSoundIntensityMode,
  isMuted,
  setMuted,
  setSoundIntensityMode,
} from '../audio/sound';
import Settings from './Settings';

describe('Settings page', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false);
    setSoundIntensityMode('balanced');
  });
  afterEach(() => vi.restoreAllMocks());

  it('exposes grouped choices and non-colour board cues', async () => {
    const { container } = render(<Settings />);
    expect(screen.getByRole('heading', { name: /accessibility & device settings/i })).toBeInTheDocument();
    expect(container.querySelector('main')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(6);
    fireEvent.click(screen.getByRole('radio', { name: /light/i }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? '{}').theme).toBe('light');
      expect(document.documentElement.dataset.uiTheme).toBe('light');
    });
  });

  it('persists a player-controlled cinematic sound mix and mute choice', () => {
    render(<Settings />);

    fireEvent.click(screen.getByRole('radio', { name: /cinematic/i }));
    expect(getSoundIntensityMode()).toBe('cinematic');

    fireEvent.click(screen.getByRole('switch', { name: /game sound/i }));
    expect(isMuted()).toBe(true);
    expect(screen.getByText(/game sound switched off and saved/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /turn on & preview completion mix/i }));
    expect(isMuted()).toBe(false);
    expect(screen.getByText(/game sound switched on.*playing/i)).toBeInTheDocument();
  });

  it('applies a preference for the session and reports when persistence fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    render(<Settings />);

    fireEvent.click(screen.getByRole('radio', { name: /^light/i }));
    await waitFor(() => {
      expect(document.documentElement.dataset.uiTheme).toBe('light');
      expect(screen.getByText(/applied for this session, but this browser could not save/i)).toBeInTheDocument();
    });
  });

  it('reports session-only sound changes when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    render(<Settings />);

    fireEvent.click(screen.getByRole('radio', { name: /cinematic/i }));
    expect(getSoundIntensityMode()).toBe('cinematic');
    expect(screen.getByText(/cinematic mix applied for this session/i)).toBeInTheDocument();
  });
});
