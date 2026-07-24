import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProgression } from '../progression/progression';
import { ALL_PUZZLES, PUZZLE_GAME_IDS, shuffle } from '../puzzles/allPuzzles';
import { getGame } from '../engine/registry';
import { getTheme } from '../themes/boardThemes';
import InteractiveLesson from '../components/InteractiveLesson';
import JourneyContext from '../components/JourneyContext';
import { useLearningMemory } from '../intelligence/learningMemory';
import { readMissionContext } from '../intelligence/missionRouting';
import { playSound, resumeAudio } from '../audio/sound';
import './Puzzles.css';

const KEY = 'gm-puzzles';
function load(): { solved: number; best: number; streak: number } {
  try { return { solved: 0, best: 0, streak: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { solved: 0, best: 0, streak: 0 }; }
}

export default function Puzzles() {
  const [searchParams] = useSearchParams();
  const requestedGame = searchParams.get('game') || '';
  const [filter, setFilter] = useState(() => PUZZLE_GAME_IDS.includes(requestedGame) ? requestedGame : 'all');
  const queue = useMemo(() => shuffle(filter === 'all' ? ALL_PUZZLES : ALL_PUZZLES.filter((p) => p.gameId === filter)), [filter]);
  const [idx, setIdx] = useState(0);
  const [stats, setStats] = useState(load);
  const [streak, setStreak] = useState(stats.streak);
  const [result, setResult] = useState<'idle' | 'solved' | 'failed'>('idle');
  const theme = getTheme('tournament-green');
  const missionContext = readMissionContext(searchParams);
  const activeMission = useLearningMemory((state) => state.activeMission);

  const puzzle = queue[idx % queue.length];
  const def = getGame(puzzle.gameId)!;
  const missionGame = (
    missionContext?.stage === 'practice'
    && activeMission?.id === missionContext.missionId
  ) ? getGame(activeMission.gameId) : undefined;

  useEffect(() => {
    setFilter(PUZZLE_GAME_IDS.includes(requestedGame) ? requestedGame : 'all');
    setIdx(0);
  }, [requestedGame]);
  useEffect(() => { setResult('idle'); }, [idx, filter]);

  const save = (s: { solved: number; best: number; streak: number }) => { setStats(s); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  const onSolved = () => {
    if (result !== 'idle') return;
    playSound('win');
    const ns = streak + 1;
    setStreak(ns); setResult('solved');
    save({ solved: stats.solved + 1, best: Math.max(stats.best, ns), streak: ns });
    try { useProgression.getState().recordPuzzle(ns); } catch { /* ignore */ }
    const memory = useLearningMemory.getState();
    if (
      missionContext?.stage === 'practice'
      && memory.activeMission?.id === missionContext.missionId
      && memory.activeMission.gameId === puzzle.gameId
      && memory.activeMission.currentStage === 'practice'
    ) {
      memory.recordEvent({
        id: `puzzle-solved:${missionContext.missionId}:${puzzle.id}`,
        at: Date.now(),
        kind: 'puzzle_solved',
        missionId: missionContext.missionId,
        gameId: puzzle.gameId,
        stage: 'practice',
        sourceId: `puzzle:${puzzle.gameId}`,
        outcome: 'success',
      });
    }
  };
  const onFailed = () => {
    if (result !== 'idle') return;
    playSound('illegal'); setStreak(0); setResult('failed');
    save({ ...stats, streak: 0 });
    const memory = useLearningMemory.getState();
    if (
      missionContext?.stage === 'practice'
      && memory.activeMission?.id === missionContext.missionId
      && memory.activeMission.gameId === puzzle.gameId
      && memory.activeMission.currentStage === 'practice'
    ) {
      memory.recordEvent({
        id: `puzzle-attempt:${missionContext.missionId}:${puzzle.id}:${idx}`,
        at: Date.now(),
        kind: 'puzzle_attempted',
        missionId: missionContext.missionId,
        gameId: puzzle.gameId,
        stage: 'practice',
        sourceId: `puzzle:${puzzle.gameId}`,
        outcome: 'failed',
      });
    }
  };
  const next = () => { resumeAudio(); setIdx((i) => i + 1); };

  return (
    <div className="puzzles">
      {missionGame && (
        <JourneyContext
          gameId={missionGame.id}
          gameName={missionGame.name}
          gameEmoji={missionGame.emoji}
          stage="practice"
        />
      )}
      <header className="pz-hero" aria-labelledby="puzzles-title">
        <img
          className="pz-hero-art"
          src="/assets/tactics-observatory.webp"
          alt=""
          width="1600"
          height="880"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="pz-hero-veil" />
        <div className="pz-copy">
          <span className="section-overline">Practice builder · adaptive pattern training</span>
          <h1 id="puzzles-title">See the pattern before the move appears.</h1>
          <p>Study one exact position at a time, test your calculation, then carry the idea into the next board.</p>
        </div>
        <div className="pz-stats" role="list" aria-label="Puzzle training statistics">
          <Stat n={streak} l="streak" hot={streak >= 3} icon="🔥" />
          <Stat n={stats.solved} l="solved" />
          <Stat n={stats.best} l="best" />
        </div>
      </header>

      <div className="pz-filters" role="group" aria-label="Choose a puzzle game">
        <button type="button" aria-pressed={filter === 'all'} className={`chip clickable ${filter === 'all' ? 'active' : ''}`} onClick={() => { setFilter('all'); setIdx(0); }}>All games</button>
        {PUZZLE_GAME_IDS.map((id) => (
          <button type="button" aria-pressed={filter === id} key={id} className={`chip clickable ${filter === id ? 'active' : ''}`} onClick={() => { setFilter(id); setIdx(0); }}>
            {getGame(id)?.emoji} {getGame(id)?.name}
          </button>
        ))}
      </div>

      <div className="pz-stage glass">
        <div className="pz-prompt-row">
          <span className="chip pz-theme" style={{ ['--accent' as any]: def.accent }}>{def.emoji} {puzzle.theme}</span>
          <span className="faint" style={{ fontSize: 13 }}>Rated ~{puzzle.rating}</span>
        </div>
        <InteractiveLesson
          key={puzzle.id + idx}
          def={def}
          setup={puzzle.setup}
          challenge={{ prompt: puzzle.prompt, solution: puzzle.solution, success: 'Solved! On to the next.' }}
          theme={theme}
          onSolved={onSolved}
          onFailed={onFailed}
          onRetry={() => setResult('idle')}
        />
        <div className="pz-actions">
          <div className="pz-feedback" role="status" aria-live="polite" aria-atomic="true">
            {result === 'solved' && <span className="pz-verdict good">Solved. Your streak increased by one.</span>}
            {result === 'failed' && <span className="pz-verdict bad">Not this time. Reset, study the position, and keep going.</span>}
          </div>
          <button type="button" className="btn primary" onClick={next}>{result === 'idle' ? 'Skip →' : 'Next puzzle →'}</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l, hot, icon }: { n: number; l: string; hot?: boolean; icon?: string }) {
  return (
    <div className={`pz-stat ${hot ? 'hot' : ''}`} role="listitem">
      <div className="pz-stat-n">{icon && <span aria-hidden="true">{icon}</span>}{n}</div>
      <div className="pz-stat-l">{l}</div>
    </div>
  );
}
