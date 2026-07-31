import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  MIND_CASCADE_PROGRESS_STORAGE_KEY,
  createEmptyMindCascadeProgress,
} from '../mindgames/progress';
import MindCascade from './MindCascade';

function renderCascade(entry = '/mind-games/cascade') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MindCascade />
    </MemoryRouter>,
  );
}

describe('<MindCascade>', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_789_000_000_000);
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
