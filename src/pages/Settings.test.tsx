import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESSIBILITY_STORAGE_KEY } from '../accessibility/preferences';
import Settings from './Settings';

describe('Settings page', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('exposes grouped choices and non-colour board cues', async () => {
    const { container } = render(<Settings />);
    expect(screen.getByRole('heading', { name: /accessibility & device settings/i })).toBeInTheDocument();
    expect(container.querySelector('main')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(5);
    fireEvent.click(screen.getByRole('radio', { name: /light/i }));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? '{}').theme).toBe('light');
      expect(document.documentElement.dataset.uiTheme).toBe('light');
    });
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
});
