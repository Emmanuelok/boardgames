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

const pointerCaptureDescriptors = {
  set: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture'),
  has: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture'),
  release: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture'),
};
const elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
const elementFromPointMock = vi.fn();
let pointerCaptures = new WeakMap<HTMLElement, Set<number>>();

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: elementFromPointMock,
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(function setPointerCapture(this: HTMLElement, pointerId: number) {
      const active = pointerCaptures.get(this) ?? new Set<number>();
      active.add(pointerId);
      pointerCaptures.set(this, active);
    }),
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(function hasPointerCapture(this: HTMLElement, pointerId: number) {
      return pointerCaptures.get(this)?.has(pointerId) ?? false;
    }),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(function releasePointerCapture(this: HTMLElement, pointerId: number) {
      pointerCaptures.get(this)?.delete(pointerId);
    }),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (elementFromPointDescriptor) {
    Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor);
  } else {
    Reflect.deleteProperty(document, 'elementFromPoint');
  }
  ([
    ['setPointerCapture', pointerCaptureDescriptors.set],
    ['hasPointerCapture', pointerCaptureDescriptors.has],
    ['releasePointerCapture', pointerCaptureDescriptors.release],
  ] as const).forEach(([property, descriptor]) => {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, property, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, property);
  });
});

beforeEach(() => {
  localStorage.clear();
  applyAccessibilityPreferences(DEFAULT_ACCESSIBILITY_PREFERENCES);
  pointerCaptures = new WeakMap();
  elementFromPointMock.mockReset();
  vi.mocked(HTMLElement.prototype.setPointerCapture).mockClear();
  vi.mocked(HTMLElement.prototype.hasPointerCapture).mockClear();
  vi.mocked(HTMLElement.prototype.releasePointerCapture).mockClear();
});

function renderBoard(
  gameId: string,
  options: {
    readOnly?: boolean;
    selected?: number | null;
    onCell?: (cell: number) => void;
  } = {},
) {
  const def = GAME_MAP[gameId];
  const state = def.createInitialState();
  return render(
    <Board2D
      def={def}
      view={def.getBoardView(state)}
      theme={getTheme(DEFAULT_THEME_ID)}
      turn={def.getTurn(state)}
      flipped={false}
      selected={options.selected ?? null}
      targets={[]}
      lastMove={null}
      status={def.getStatus(state)}
      hint={null}
      onCell={options.onCell ?? (() => {})}
      readOnly={options.readOnly}
    />,
  );
}

function boardCell(container: HTMLElement, index: number): HTMLElement {
  const cell = container.querySelector<HTMLElement>(`.cell[data-idx="${index}"]`);
  expect(cell).not.toBeNull();
  return cell!;
}

function beginDrag(source: HTMLElement, pointerId: number): void {
  fireEvent.pointerDown(source, {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 80,
    clientY: 80,
  });
  fireEvent.pointerMove(window, {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    clientX: 130,
    clientY: 80,
  });
}

function endDrag(pointerId: number): void {
  fireEvent.pointerUp(window, {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 130,
    clientY: 80,
  });
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

describe('Board2D direct manipulation', () => {
  const sourceIndex = 48; // White pawn on a2 in the initial chess position.
  const destinationIndex = 40; // a3.

  it('commits one source and one destination activation for a legal drag', () => {
    const onCell = vi.fn();
    const { container } = renderBoard('chess', { onCell });
    const source = boardCell(container, sourceIndex);
    const destination = boardCell(container, destinationIndex);
    elementFromPointMock.mockReturnValue(destination);

    beginDrag(source, 7);

    expect(onCell).toHaveBeenCalledTimes(1);
    expect(onCell).toHaveBeenLastCalledWith(sourceIndex);
    expect(document.querySelector('.drag-ghost')).toBeInTheDocument();
    expect(document.querySelector('.drag-ghost')).toHaveAttribute('aria-hidden', 'true');
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(7);

    endDrag(7);

    expect(onCell.mock.calls.map(([cell]) => cell)).toEqual([
      sourceIndex,
      destinationIndex,
    ]);
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.querySelector('.drag-ghost')).not.toBeInTheDocument();

    fireEvent.click(source);
    expect(onCell).toHaveBeenCalledTimes(2);

    fireEvent.click(source);
    expect(onCell).toHaveBeenCalledTimes(3);
    expect(onCell).toHaveBeenLastCalledWith(sourceIndex);
  });

  it('cancels an active drag without activating a destination', () => {
    const onCell = vi.fn();
    const { container } = renderBoard('chess', { onCell });
    const source = boardCell(container, sourceIndex);

    beginDrag(source, 8);
    fireEvent.pointerCancel(window, {
      pointerId: 8,
      pointerType: 'touch',
      isPrimary: true,
    });

    expect(onCell.mock.calls.map(([cell]) => cell)).toEqual([sourceIndex]);
    expect(document.querySelector('.drag-ghost')).not.toBeInTheDocument();
  });

  it('ignores secondary pointer movement and release during the primary drag', () => {
    const onCell = vi.fn();
    const { container } = renderBoard('chess', { onCell });
    const source = boardCell(container, sourceIndex);
    const destination = boardCell(container, destinationIndex);
    elementFromPointMock.mockReturnValue(destination);

    fireEvent.pointerDown(source, {
      pointerId: 9,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: 80,
      clientY: 80,
    });
    fireEvent.pointerMove(window, {
      pointerId: 10,
      pointerType: 'touch',
      isPrimary: false,
      clientX: 140,
      clientY: 80,
    });
    fireEvent.pointerUp(window, {
      pointerId: 10,
      pointerType: 'touch',
      isPrimary: false,
      clientX: 140,
      clientY: 80,
    });
    expect(onCell).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, {
      pointerId: 9,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 130,
      clientY: 80,
    });
    endDrag(9);

    expect(onCell.mock.calls.map(([cell]) => cell)).toEqual([
      sourceIndex,
      destinationIndex,
    ]);
  });

  it('does not deselect a source that was selected before dragging', () => {
    const onCell = vi.fn();
    const { container } = renderBoard('chess', {
      selected: sourceIndex,
      onCell,
    });
    const source = boardCell(container, sourceIndex);
    const destination = boardCell(container, destinationIndex);
    elementFromPointMock.mockReturnValue(destination);

    beginDrag(source, 11);
    expect(onCell).not.toHaveBeenCalled();
    endDrag(11);

    expect(onCell).toHaveBeenCalledTimes(1);
    expect(onCell).toHaveBeenCalledWith(destinationIndex);
  });

  it('never turns an invalid drop surface into board index zero', () => {
    const onCell = vi.fn();
    const { container } = renderBoard('chess', { onCell });
    const source = boardCell(container, sourceIndex);
    const unrelatedCell = document.createElement('div');
    unrelatedCell.className = 'cell';
    document.body.appendChild(unrelatedCell);
    elementFromPointMock.mockReturnValue(unrelatedCell);

    beginDrag(source, 12);
    endDrag(12);

    expect(onCell.mock.calls.map(([cell]) => cell)).toEqual([sourceIndex]);
    expect(onCell).not.toHaveBeenCalledWith(0);
    unrelatedCell.remove();
  });
});
