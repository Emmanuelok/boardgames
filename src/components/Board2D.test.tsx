import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  applyAccessibilityPreferences,
  saveAccessibilityPreferences,
} from '../accessibility/preferences';
import { GAME_MAP } from '../engine/registry';
import { DEFAULT_THEME_ID, getTheme } from '../themes/boardThemes';
import Board2D from './Board2D';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  localStorage.clear();
  applyAccessibilityPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
});

function renderBoard(gameId: string, options: { readOnly?: boolean; onCell?: (cell: number) => void } = {}) {
  const def = GAME_MAP[gameId];
  const state = def.createInitialState();
  return render(
    <Board2D
      def={def}
      view={def.getBoardView(state)}
      theme={getTheme(DEFAULT_THEME_ID)}
      turn={def.getTurn(state)}
      flipped={false}
      selected={null}
      targets={[]}
      lastMove={null}
      status={def.getStatus(state)}
      hint={null}
      onCell={options.onCell ?? (() => {})}
      readOnly={options.readOnly}
    />,
  );
}

describe('Board2D accessibility contract', () => {
  it('updates announcements and removes Framer Motion animation in reduced mode', async () => {
    saveAccessibilityPreferences({
      ...DEFAULT_ACCESSIBILITY_PREFERENCES,
      motion: 'reduced',
      verboseBoardLabels: false,
    });
    const { container } = renderBoard('chess');

    const firstCell = screen.getAllByRole('gridcell')[0];
    expect(firstCell).toHaveAccessibleName(/occupied/i);
    expect(firstCell).not.toHaveAccessibleName(/rook/i);
    expect((container.querySelector('.pc') as HTMLElement).style.transform).toBe('');

    saveAccessibilityPreferences({
      ...DEFAULT_ACCESSIBILITY_PREFERENCES,
      motion: 'reduced',
      verboseBoardLabels: true,
    });
    await waitFor(() => expect(firstCell).toHaveAccessibleName(/rook/i));
  });

  it('makes spectator boards read-only and only indexes actual gridcells', () => {
    const onCell = vi.fn();
    const { container } = renderBoard('nine-mens-morris', { readOnly: true, onCell });
    const grid = screen.getByRole('grid');
    expect(grid).toHaveAttribute('aria-readonly', 'true');
    expect(grid).toHaveAccessibleName(/read-only position/i);
    expect(grid).not.toHaveAccessibleName(/arrow keys/i);

    const cells = screen.getAllByRole('gridcell');
    expect(cells.every((cell) => !cell.hasAttribute('tabindex'))).toBe(true);
    expect(container.querySelectorAll('[aria-rowindex]:not([role="gridcell"])')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-colindex]:not([role="gridcell"])')).toHaveLength(0);
    fireEvent.click(cells[0]);
    expect(onCell).not.toHaveBeenCalled();
  });
});
