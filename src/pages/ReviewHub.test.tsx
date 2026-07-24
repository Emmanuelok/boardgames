import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReviewHub from './ReviewHub';
import { createLearningMission, useLearningMemory, type LearningEvent } from '../intelligence/learningMemory';
import type { GameRecord } from '../engine/reviewSummary';

function missionAtReflect() {
  const mission = createLearningMission({
    id: 'mission-reflect',
    gameId: 'chess',
    createdAt: 100,
    targets: [
      { stage: 'observe', kind: 'match_completed', sourceId: 'match:chess', href: '/play/chess' },
      { stage: 'learn', kind: 'lesson_completed', sourceId: 'course:chess', href: '/learn/chess' },
      { stage: 'practice', kind: 'puzzle_solved', sourceId: 'puzzle:chess', href: '/puzzles?game=chess' },
      { stage: 'play', kind: 'match_completed', sourceId: 'match:chess', href: '/play/chess' },
      { stage: 'reflect', kind: 'reflection_completed', sourceId: 'reflection:chess:after-play', href: '/reviews' },
    ],
  });
  useLearningMemory.getState().startMission(mission);
  const events: LearningEvent[] = [
    { id: 'observe', at: 101, kind: 'match_completed', missionId: mission.id, gameId: 'chess', stage: 'observe', sourceId: 'match:chess', outcome: 'complete' },
    { id: 'learn', at: 102, kind: 'lesson_completed', missionId: mission.id, gameId: 'chess', stage: 'learn', sourceId: 'course:chess', outcome: 'complete' },
    { id: 'practice', at: 103, kind: 'puzzle_solved', missionId: mission.id, gameId: 'chess', stage: 'practice', sourceId: 'puzzle:chess', outcome: 'complete' },
    { id: 'play', at: 104, kind: 'match_completed', missionId: mission.id, gameId: 'chess', stage: 'play', sourceId: 'match:chess', outcome: 'complete' },
  ];
  events.forEach((event) => useLearningMemory.getState().recordEvent(event));
}

const historicalReview: GameRecord = {
  id: 'old-review',
  ts: 103,
  gameId: 'chess',
  gameName: 'Chess',
  emoji: '♟',
  accent: '#7c3aed',
  result: 'loss',
  winner: 1,
  reason: 'complete',
  p0: 'White',
  p1: 'Black',
  acc: [70, 85],
  graded: [4, 4],
  moves: 8,
  evalPts: [0, -0.2],
  key: [],
};

describe('<ReviewHub> mission reflection', () => {
  beforeEach(() => {
    localStorage.clear();
    useLearningMemory.getState().reset();
    missionAtReflect();
  });

  it('offers a universal reflection receipt and completes the exact mission target', () => {
    render(
      <MemoryRouter initialEntries={['/reviews?mission=mission-reflect&stage=reflect']}>
        <ReviewHub />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Finish reflection →' }));
    expect(useLearningMemory.getState().activeMission).toMatchObject({
      status: 'complete',
      currentStage: null,
    });
  });

  it('does not let an older same-game review complete the latest reflection', () => {
    localStorage.setItem('gm-reviews', JSON.stringify([historicalReview]));
    render(
      <MemoryRouter initialEntries={['/reviews?mission=mission-reflect&stage=reflect']}>
        <ReviewHub />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Chess.*8 moves/i }));
    expect(useLearningMemory.getState().activeMission?.currentStage).toBe('reflect');
  });
});
