import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MIND_CASCADE_PROGRESS_STORAGE_KEY,
  createEmptyMindCascadeProgress,
} from '../mindgames/progress';
import MindCascade, {
  getCascadePowerVisuals,
  getPointerDragIntent,
  getSwapMotion,
} from './MindCascade';

const pointerCaptureDescriptors = {
  set: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture'),
  has: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture'),
  release: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture'),
};

function installPointerCaptureHarness() {
  const captures = new WeakMap<HTMLElement, Set<number>>();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(function setPointerCapture(this: HTMLElement, pointerId: number) {
      const active = captures.get(this) ?? new Set<number>();
      active.add(pointerId);
      captures.set(this, active);
    }),
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(function hasPointerCapture(this: HTMLElement, pointerId: number) {
      return captures.get(this)?.has(pointerId) ?? false;
    }),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(function releasePointerCapture(this: HTMLElement, pointerId: number) {
      captures.get(this)?.delete(pointerId);
    }),
  });
}

function restorePointerCaptureHarness() {
  (['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'] as const)
    .forEach((property) => {
      const descriptor = property === 'setPointerCapture'
        ? pointerCaptureDescriptors.set
        : property === 'hasPointerCapture'
          ? pointerCaptureDescriptors.has
          : pointerCaptureDescriptors.release;
      if (descriptor) Object.defineProperty(HTMLElement.prototype, property, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, property);
    });
}

function renderCascade(entry = '/mind-games/cascade') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MindCascade />
    </MemoryRouter>,
  );
}

function commitFirstForecast(): HTMLElement {
  fireEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
  const candidate = document.querySelector<HTMLButtonElement>('.mc-forecast');
  expect(candidate).not.toBeNull();
  fireEvent.click(candidate!);
  const destination = document.querySelector<HTMLButtonElement>(
    `.mc-tile[data-row="${candidate!.dataset.toRow}"][data-column="${candidate!.dataset.toColumn}"]`,
  );
  expect(destination).not.toBeNull();
  fireEvent.click(destination!);
  const frame = document.querySelector<HTMLElement>('.mc-board-frame');
  expect(frame).not.toBeNull();
  return frame!;
}

describe('Mind Cascade effect helpers', () => {
  it('keeps Mirror and Orbit origins and affected coordinates distinct', () => {
    const overlap = { row: 2, column: 2 };
    const visuals = getCascadePowerVisuals({
      activatedSpecials: [
        {
          power: 'mirror',
          position: { row: 1, column: 1 },
          affected: [{ row: 1, column: 2 }, overlap],
        },
        {
          power: 'orbit',
          position: { row: 3, column: 3 },
          affected: [{ row: 3, column: 2 }, overlap],
        },
      ],
      createdSpecials: [
        { power: 'mirror', kind: 'iris', position: { row: 4, column: 4 } },
        { power: 'orbit', kind: 'grove', position: { row: 5, column: 5 } },
      ],
    });

    expect(visuals.powers).toEqual(['mirror', 'orbit']);
    expect(visuals.mirror.origins).toEqual([{ row: 1, column: 1 }]);
    expect(visuals.orbit.origins).toEqual([{ row: 3, column: 3 }]);
    expect(visuals.mirror.affected).toContainEqual(overlap);
    expect(visuals.orbit.affected).toContainEqual(overlap);
    expect(visuals.mirror.created).toEqual([{ row: 4, column: 4 }]);
    expect(visuals.orbit.created).toEqual([{ row: 5, column: 5 }]);
  });

  it('maps swap motion to its real axis and direction', () => {
    expect(getSwapMotion({
      from: { row: 4, column: 2 },
      to: { row: 3, column: 2 },
    })).toMatchObject({
      axis: 'vertical',
      direction: 'up',
      fromX: '0%',
      fromY: '-12%',
    });
    expect(getSwapMotion({
      from: { row: 2, column: 3 },
      to: { row: 2, column: 4 },
    })).toMatchObject({
      axis: 'horizontal',
      direction: 'right',
      fromX: '12%',
      fromY: '0%',
    });
  });

  it('locks pointer gestures to the dominant axis and one adjacent target', () => {
    expect(getPointerDragIntent(
      { row: 3, column: 3 },
      9,
      4,
      7,
      7,
    )).toEqual({
      axis: 'none',
      crossedThreshold: false,
      target: null,
    });
    expect(getPointerDragIntent(
      { row: 3, column: 3 },
      -42,
      13,
      7,
      7,
    )).toEqual({
      axis: 'horizontal',
      crossedThreshold: true,
      target: { row: 3, column: 2 },
    });
    expect(getPointerDragIntent(
      { row: 3, column: 3 },
      34,
      -64,
      7,
      7,
    )).toEqual({
      axis: 'vertical',
      crossedThreshold: true,
      target: { row: 2, column: 3 },
    });
    expect(getPointerDragIntent(
      { row: 0, column: 0 },
      -40,
      0,
      7,
      7,
    ).target).toBeNull();
    expect(getPointerDragIntent(
      { row: 3, column: 3 },
      18,
      90,
      7,
      7,
      10,
      'horizontal',
    )).toMatchObject({
      axis: 'horizontal',
      target: { row: 3, column: 4 },
    });
  });
});

describe('<MindCascade>', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    installPointerCaptureHarness();
    vi.spyOn(Date, 'now').mockReturnValue(1_789_000_000_000);
    delete document.documentElement.dataset.motion;
  });

  afterEach(() => {
    vi.useRealTimers();
    restorePointerCaptureHarness();
    delete document.documentElement.dataset.motion;
  });

  it('renders an original, objective-led strategy board without pressure mechanics', () => {
    renderCascade();

    expect(screen.getByRole('heading', { name: 'Think beyond the match.' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: /7 by 7 Mind Cascade board/i })).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(49);
    expect(document.querySelectorAll('.mc-objective').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/no pressure timer/i)).toBeInTheDocument();
    expect(screen.getByText(/no paid lives or random rewards/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bIQ\b|general intelligence score/i)).not.toBeInTheDocument();

    const labels = screen.getAllByRole('gridcell').map((tile) => tile.getAttribute('aria-label'));
    expect(labels.every((label) => (label?.length ?? 0) > 10)).toBe(true);
    expect(new Set(labels).size).toBe(49);
    expect(screen.getByRole('heading', { name: 'Mind Cascade, Pattern Garden' })).toBeInTheDocument();
  });

  it('commits a forecasted legal swap and saves a verified resumable session', () => {
    renderCascade();

    const movesBefore = Number(
      screen.getByText('Moves remaining').parentElement?.querySelector('strong')?.textContent,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
    const candidate = document.querySelector<HTMLButtonElement>('.mc-forecast');
    expect(candidate).not.toBeNull();
    fireEvent.click(candidate!);

    const destination = document.querySelector<HTMLButtonElement>(
      `.mc-tile[data-row="${candidate!.dataset.toRow}"][data-column="${candidate!.dataset.toColumn}"]`,
    );
    expect(destination).not.toBeNull();
    fireEvent.click(destination!);

    const movesAfter = Number(
      screen.getByText('Moves remaining').parentElement?.querySelector('strong')?.textContent,
    );
    expect(movesAfter).toBe(movesBefore - 1);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/resolved \d+ cascade step/i);

    const saved = JSON.parse(localStorage.getItem(MIND_CASCADE_PROGRESS_STORAGE_KEY) ?? '{}');
    expect(saved.resumableSession).toMatchObject({
      moveNumber: 1,
      state: { turn: 1 },
    });
    expect(saved.resumableSession.steps).toHaveLength(1);
  });

  it('tracks a dominant-axis touch swipe, commits on release, and suppresses its synthetic click', () => {
    vi.useFakeTimers();
    renderCascade();

    fireEvent.click(screen.getByRole('tab', { name: 'Forecast' }));
    const candidate = document.querySelector<HTMLButtonElement>('.mc-forecast');
    expect(candidate).not.toBeNull();
    const fromRow = Number(candidate!.dataset.fromRow);
    const fromColumn = Number(candidate!.dataset.fromColumn);
    const toRow = Number(candidate!.dataset.toRow);
    const toColumn = Number(candidate!.dataset.toColumn);
    const source = document.querySelector<HTMLButtonElement>(
      `.mc-tile[data-row="${fromRow}"][data-column="${fromColumn}"]`,
    );
    const target = document.querySelector<HTMLButtonElement>(
      `.mc-tile[data-row="${toRow}"][data-column="${toColumn}"]`,
    );
    const frame = document.querySelector<HTMLElement>('.mc-board-frame');
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    expect(frame).not.toBeNull();
    const movesBefore = Number(
      screen.getByText('Moves remaining').parentElement?.querySelector('strong')?.textContent,
    );
    const pointerId = 17;
    const startX = 120;
    const startY = 140;
    const horizontal = fromRow === toRow;
    const endX = startX + (toColumn - fromColumn) * 64 + (horizontal ? 0 : 5);
    const endY = startY + (toRow - fromRow) * 64 + (horizontal ? 5 : 0);
    const layoutRead = vi.spyOn(source!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 40,
      height: 50,
      top: 0,
      right: 40,
      bottom: 50,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(source!, {
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: startX,
      clientY: startY,
    });
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(pointerId);

    fireEvent.pointerMove(source!, {
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: startX + 5,
      clientY: startY + 3,
    });
    act(() => { vi.advanceTimersByTime(20); });
    expect(frame).not.toHaveClass('is-dragging');
    expect(source).not.toHaveClass('drag-source');

    fireEvent.pointerMove(source!, {
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: endX,
      clientY: endY,
    });
    act(() => { vi.advanceTimersByTime(20); });
    expect(frame).toHaveClass('is-dragging');
    expect(frame).toHaveAttribute('data-drag-axis', horizontal ? 'horizontal' : 'vertical');
    expect(source).toHaveClass('drag-source');
    expect(target).toHaveClass('drag-target');
    expect(source!.style.getPropertyValue(horizontal ? '--mc-drag-x' : '--mc-drag-y'))
      .not.toBe('0px');
    fireEvent.pointerMove(source!, {
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      clientX: endX + (horizontal ? Math.sign(endX - startX) * 24 : 0),
      clientY: endY + (horizontal ? 0 : Math.sign(endY - startY) * 24),
    });
    act(() => { vi.advanceTimersByTime(20); });
    expect(layoutRead).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(source!, {
      pointerId,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: endX,
      clientY: endY,
    });

    const movesAfter = Number(
      screen.getByText('Moves remaining').parentElement?.querySelector('strong')?.textContent,
    );
    expect(movesAfter).toBe(movesBefore - 1);
    expect(frame).not.toHaveClass('is-dragging');
    expect(source).not.toHaveClass('drag-source');
    expect(target).not.toHaveClass('drag-target');
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(pointerId);
    expect(layoutRead).toHaveBeenCalledTimes(1);

    fireEvent.click(source!);
    expect(source).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/resolved \d+ cascade step/i);
  });

  it('keeps tap-to-select below the drag threshold and cancels captured drags without a move', () => {
    vi.useFakeTimers();
    renderCascade();

    const source = screen.getAllByRole('gridcell')[8] as HTMLButtonElement;
    const frame = document.querySelector<HTMLElement>('.mc-board-frame');
    const movesBefore = Number(
      screen.getByText('Moves remaining').parentElement?.querySelector('strong')?.textContent,
    );

    fireEvent.pointerDown(source, {
      pointerId: 21,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 90,
      clientY: 90,
    });
    fireEvent.pointerUp(source, {
      pointerId: 21,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 96,
      clientY: 94,
    });
    fireEvent.click(source);
    expect(source).toHaveAttribute('aria-selected', 'true');

    fireEvent.pointerDown(source, {
      pointerId: 22,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: 90,
      clientY: 90,
    });
    fireEvent.pointerMove(source, {
      pointerId: 22,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 145,
      clientY: 94,
    });
    act(() => { vi.advanceTimersByTime(20); });
    expect(frame).toHaveClass('is-dragging');

    fireEvent.pointerCancel(source, {
      pointerId: 22,
      pointerType: 'touch',
      isPrimary: true,
    });
    expect(frame).not.toHaveClass('is-dragging');
    expect(source).not.toHaveClass('drag-source');
    const movesAfter = Number(
      screen.getByText('Moves remaining').parentElement?.querySelector('strong')?.textContent,
    );
    expect(movesAfter).toBe(movesBefore);
  });

  it('choreographs a verified turn through visible cascade state without blocking input', () => {
    vi.useFakeTimers();
    renderCascade();

    const frame = commitFirstForecast();
    expect(frame).toHaveAttribute('data-effect-phase', 'swap');
    expect(Number(frame.dataset.cascadeDepth)).toBeGreaterThanOrEqual(1);
    expect(frame).toHaveAttribute('data-feedback-motion', 'full');
    expect(['horizontal', 'vertical']).toContain(frame.dataset.swapAxis);
    if (frame.dataset.swapAxis === 'vertical') {
      expect(frame.style.getPropertyValue('--swap-from-x')).toBe('0%');
      expect(frame.style.getPropertyValue('--swap-from-y')).not.toBe('0%');
    } else {
      expect(frame.style.getPropertyValue('--swap-from-x')).not.toBe('0%');
      expect(frame.style.getPropertyValue('--swap-from-y')).toBe('0%');
    }

    const announcement = document.querySelector('.mc-live-note[aria-live="polite"]');
    expect(announcement).toHaveAttribute('aria-atomic', 'true');
    expect(announcement).toHaveTextContent(/resolved \d+ cascade step/i);
    expect(announcement).toHaveTextContent(/added \d+ points/i);
    expect(screen.getAllByRole('gridcell')[0]).not.toBeDisabled();

    act(() => { vi.advanceTimersByTime(110); });
    expect(frame).toHaveAttribute('data-effect-phase', 'cascade');
    expect(frame).toHaveAttribute('data-active-depth', '1');
    expect(document.querySelectorAll('.mc-cell-effect').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.mc-cell-effect[aria-hidden="true"]').length)
      .toBe(document.querySelectorAll('.mc-cell-effect').length);
    expect(screen.getAllByRole('gridcell')).toHaveLength(49);
  });

  it('condenses decorative choreography when reduced motion is active', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.motion = 'reduced';
    renderCascade();

    const frame = commitFirstForecast();
    expect(frame).toHaveAttribute('data-feedback-motion', 'condensed');
    expect(frame).toHaveAttribute('data-effect-phase', 'settle');
    expect(frame).not.toHaveClass('is-swap');
    expect(document.querySelector('.mc-turn-banner')).toHaveAttribute('aria-hidden', 'true');

    const announcement = document.querySelector('.mc-live-note[aria-live="polite"]');
    expect(announcement).toHaveTextContent(/cleared \d+ tiles/i);
    expect(announcement).toHaveTextContent(/added \d+ points/i);

    act(() => { vi.advanceTimersByTime(120); });
    expect(frame).toHaveAttribute('data-effect-phase', 'settle');
  });

  it('pauses without a countdown and supports roving keyboard focus', () => {
    renderCascade();

    const tiles = screen.getAllByRole('gridcell') as HTMLButtonElement[];
    expect(tiles.filter((tile) => tile.tabIndex === 0)).toHaveLength(1);
    expect(tiles[0]).toHaveAttribute('tabindex', '0');

    tiles[0].focus();
    fireEvent.keyDown(tiles[0], { key: 'ArrowRight' });
    expect(tiles[1]).toHaveFocus();
    expect(tiles[1]).toHaveAttribute('tabindex', '0');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('dialog', { name: 'Board paused' })).toBeInTheDocument();
    screen.getAllByRole('gridcell').forEach((tile) => expect(tile).toBeDisabled());
    expect(screen.getByText(/No clock is running/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume board' }));
    expect(screen.queryByRole('dialog', { name: 'Board paused' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')[0]).not.toBeDisabled();
  });

  it('recreates the same daily board from the same local-calendar descriptor', () => {
    const first = renderCascade('/mind-games/cascade?daily=1');
    const firstBoard = screen.getAllByRole('gridcell')
      .map((tile) => `${tile.getAttribute('data-kind')}:${tile.getAttribute('aria-label')}`);
    const firstSeed = document.querySelector('.mc-session-bar .section-overline')?.textContent;
    first.unmount();

    renderCascade('/mind-games/cascade?daily=1');
    const secondBoard = screen.getAllByRole('gridcell')
      .map((tile) => `${tile.getAttribute('data-kind')}:${tile.getAttribute('aria-label')}`);
    const secondSeed = document.querySelector('.mc-session-bar .section-overline')?.textContent;

    expect(secondBoard).toEqual(firstBoard);
    expect(secondSeed).toBe(firstSeed);
    expect(secondSeed).toMatch(/Daily shared seed · seed \d+/);
  });

  it('rejects an unverifiable saved board and explains the recovery', () => {
    localStorage.setItem(MIND_CASCADE_PROGRESS_STORAGE_KEY, JSON.stringify({
      ...createEmptyMindCascadeProgress(1_789_000_000_000),
      resumableSession: {
        id: 'tampered-session',
        mode: 'classic',
        engineVersion: '1',
        seed: 42,
        difficulty: 2,
        startedAt: 1_788_999_000_000,
        savedAt: 1_789_000_000_000,
        moveNumber: 3,
        score: 999,
        state: { version: 1, config: {}, history: [{ afterHash: 'not-valid' }] },
        steps: [],
      },
    }));

    renderCascade('/mind-games/cascade?resume=1');

    expect(screen.getByText(/saved board could not be verified/i)).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(49);
  });
});
