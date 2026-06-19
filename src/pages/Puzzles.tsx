import { useEffect, useMemo, useState } from 'react';
import { useProgression } from '../progression/progression';
import { ALL_PUZZLES, PUZZLE_GAME_IDS, shuffle } from '../puzzles/allPuzzles';
import { getGame } from '../engine/registry';
import { getTheme } from '../themes/boardThemes';
import InteractiveLesson from '../components/InteractiveLesson';
import { playSound, resumeAudio } from '../audio/sound';
import './Puzzles.css';

const KEY = 'gm-puzzles';
function load(): { solved: number; best: number } {
  try { return { solved: 0, best: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { solved: 0, best: 0 }; }
}

export default function Puzzles() {
  const [filter, setFilter] = useState('all');
  const queue = useMemo(() => shuffle(filter === 'all' ? ALL_PUZZLES : ALL_PUZZLES.filter((p) => p.gameId === filter)), [filter]);
  const [idx, setIdx] = useState(0);
  const [streak, setStreak] = useState(0);
  const [result, setResult] = useState<'idle' | 'solved' | 'failed'>('idle');
  const [stats, setStats] = useState(load);
  const theme = getTheme('tournament-green');

  const puzzle = queue[idx % queue.length];
  const def = getGame(puzzle.gameId)!;

  useEffect(() => { setResult('idle'); }, [idx, filter]);

  const save = (s: { solved: number; best: number }) => { setStats(s); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } };
  const onSolved = () => {
    if (result !== 'idle') return;
    playSound('win');
    const ns = streak + 1;
    setStreak(ns); setResult('solved');
    save({ solved: stats.solved + 1, best: Math.max(stats.best, ns) });
    try { useProgression.getState().recordPuzzle(ns); } catch { /* ignore */ }
  };
  const onFailed = () => {
    if (result !== 'idle') return;
    playSound('illegal'); setStreak(0); setResult('failed');
  };
  const next = () => { resumeAudio(); setIdx((i) => i + 1); };

  return (
    <div className="puzzles">
      <header className="pz-top">
        <div className="gs-title"><span className="gs-emoji">🧩</span><div className="col"><strong>Puzzle Trainer</strong><span className="faint" style={{ fontSize: 12 }}>{ALL_PUZZLES.length} tactics across {PUZZLE_GAME_IDS.length} games</span></div></div>
        <div className="pz-stats">
          <Stat n={streak} l="streak" hot={streak >= 3} icon="🔥" />
          <Stat n={stats.solved} l="solved" />
          <Stat n={stats.best} l="best" />
        </div>
      </header>

      <div className="pz-filters">
        <button className={`chip clickable ${filter === 'all' ? 'active' : ''}`} onClick={() => { setFilter('all'); setIdx(0); }}>All games</button>
        {PUZZLE_GAME_IDS.map((id) => (
          <button key={id} className={`chip clickable ${filter === id ? 'active' : ''}`} onClick={() => { setFilter(id); setIdx(0); }}>
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
        />
        <div className="pz-actions">
          {result === 'solved' && <span className="pz-verdict good">✅ Solved! +1 streak</span>}
          {result === 'failed' && <span className="pz-verdict bad">Streak reset — keep going</span>}
          <button className="btn primary" onClick={next}>{result === 'idle' ? 'Skip →' : 'Next puzzle →'}</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l, hot, icon }: { n: number; l: string; hot?: boolean; icon?: string }) {
  return (
    <div className={`pz-stat ${hot ? 'hot' : ''}`}>
      <div className="pz-stat-n">{icon && <span>{icon}</span>}{n}</div>
      <div className="pz-stat-l">{l}</div>
    </div>
  );
}
