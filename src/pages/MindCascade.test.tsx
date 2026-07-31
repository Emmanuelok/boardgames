import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MIND_CASCADE_PROGRESS_STORAGE_KEY,
  createEmptyMindCascadeProgress,
} from '../mindgames/progress';
import MindCascade, {
  getCascadePowerVisuals,
  getSwapMotion,
} from './MindCascade';

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
});

describe('<MindCascade>', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_789_000_000_000);
    delete document.documentElement.dataset.motion;
  });

  afterEach(() => {
    vi.useRealTimers();
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
