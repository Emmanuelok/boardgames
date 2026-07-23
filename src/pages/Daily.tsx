import { useEffect, useMemo, useState } from 'react';
import { useProgression } from '../progression/progression';
import { Link } from 'react-router-dom';
import { ALL_PUZZLES } from '../puzzles/allPuzzles';
import { getGame } from '../engine/registry';
import { getTheme } from '../themes/boardThemes';
import InteractiveLesson from '../components/InteractiveLesson';
import { playSound, resumeAudio } from '../audio/sound';
import {
  isLocalDateKey,
  localDateKey,
  localDateKeyAtOffset,
  parseLocalDateKey,
} from '../utils/localDate';
import './Daily.css';

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface DailyStore { lastDate: string; streak: number; best: number; total: number; days: string[] }
const KEY = 'gm-daily';
const MAX_DAILY_COUNTER = 1_000_000;
const emptyDaily = (): DailyStore => ({ lastDate: '', streak: 0, best: 0, total: 0, days: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function counter(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MAX_DAILY_COUNTER, Math.max(0, Math.floor(parsed)));
}

export function normalizeDailyStore(value: unknown): DailyStore {
  if (!isRecord(value)) return emptyDaily();
  const days = Array.isArray(value.days)
    ? Array.from(new Set(value.days.filter(isLocalDateKey))).slice(-60)
    : [];
  const streak = counter(value.streak);
  return {
    lastDate: isLocalDateKey(value.lastDate) ? value.lastDate : '',
    streak,
    best: Math.max(streak, counter(value.best)),
    total: Math.max(days.length, counter(value.total)),
    days,
  };
}

export function loadDailyStore(): DailyStore {
  if (typeof window === 'undefined' || !window.localStorage) return emptyDaily();
  try { return normalizeDailyStore(JSON.parse(window.localStorage.getItem(KEY) || '{}')); }
  catch { return emptyDaily(); }
}

/** Today's puzzle, chosen deterministically from the whole catalogue by date. */
export function dailyPuzzleFor(date = new Date()) {
  const pool = ALL_PUZZLES.filter((p) => p.setup);
  return pool[hashStr(localDateKey(date)) % pool.length];
}

export default function Daily() {
  const now = useMemo(() => new Date(), []);
  const today = localDateKey(now);
  const yesterday = localDateKeyAtOffset(now, -1);
  const puzzle = useMemo(() => dailyPuzzleFor(now), [now]);
  const def = getGame(puzzle.gameId)!;
  const theme = getTheme('tournament-green');

  const [store, setStore] = useState<DailyStore>(loadDailyStore);
  const [result, setResult] = useState<'idle' | 'solved' | 'failed'>(store.lastDate === today ? 'solved' : 'idle');
  const [copied, setCopied] = useState(false);
  const doneToday = store.lastDate === today;
  const liveStreak = store.lastDate === today || store.lastDate === yesterday ? store.streak : 0;

  useEffect(() => { resumeAudio(); }, []);

  const save = (value: DailyStore) => {
    const normalized = normalizeDailyStore(value);
    setStore(normalized);
    try { localStorage.setItem(KEY, JSON.stringify(normalized)); } catch { /* ignore */ }
  };

  const onSolved = () => {
    if (result !== 'idle') return;
    playSound('win');
    setResult('solved');
    if (store.lastDate === today) return; // already counted today
    const streak = store.lastDate === yesterday ? Math.min(MAX_DAILY_COUNTER, store.streak + 1) : 1;
    save({
      lastDate: today,
      streak,
      best: Math.max(store.best, streak),
      total: Math.min(MAX_DAILY_COUNTER, store.total + 1),
      days: Array.from(new Set([...store.days, today])).slice(-60),
    });
    try { useProgression.getState().recordDaily(streak); } catch { /* ignore */ }
  };
  const onFailed = () => { if (result === 'idle') { playSound('illegal'); setResult('failed'); } };

  const share = async () => {
    const text = `🎯 GrandMaster Daily — ${new Date().toLocaleDateString()}\nSolved today’s ${def.name} challenge! 🔥 ${Math.max(liveStreak, 1)}-day streak.`;
    const url = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}#/daily` : '';
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).share) await (navigator as any).share({ title: 'GrandMaster Daily', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    } catch { /* user dismissed the share sheet */ }
  };

  // The last seven days as a little streak strip.
  const week = Array.from({ length: 7 }, (_, i) => localDateKeyAtOffset(now, i - 6));

  return (
    <div className="daily">
      <header className="dy-top">
        <div className="gs-title"><span className="gs-emoji">📅</span><div className="col"><strong>Daily Challenge</strong><span className="faint" style={{ fontSize: 12 }}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div></div>
        <div className="dy-stats">
          <Stat n={liveStreak} l="day streak" hot={liveStreak >= 3} icon="🔥" />
          <Stat n={store.best} l="best" />
          <Stat n={store.total} l="solved" />
        </div>
      </header>

      <div className="dy-week">
        {week.map((k) => (
          <div key={k} className={`dy-dot ${store.days.includes(k) ? 'on' : ''} ${k === today ? 'today' : ''}`} title={k}>
            <span>{parseLocalDateKey(k)?.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
          </div>
        ))}
      </div>

      <div className="dy-stage glass">
        <div className="dy-prompt-row">
          <span className="chip dy-theme" style={{ ['--accent' as any]: def.accent }}>{def.emoji} {def.name}</span>
          <span className="faint" style={{ fontSize: 13 }}>{puzzle.theme} · rated ~{puzzle.rating}</span>
        </div>

        {doneToday && result === 'solved'
          ? (
            <div className="dy-done">
              <div className="dy-done-badge">✓</div>
              <h2>Today’s challenge complete!</h2>
              <p className="muted">Nice work — your streak is safe. A fresh puzzle unlocks at local midnight. You can replay today’s below or explore the games.</p>
              <div className="row gap-sm wrap" style={{ justifyContent: 'center', marginTop: 6 }}>
                <button className="btn primary" onClick={share}>{copied ? '✓ Copied!' : '🔗 Share result'}</button>
                <Link className="btn" to={`/play/${def.id}`}>Play {def.name}</Link>
                <Link className="btn" to="/puzzles">More puzzles →</Link>
              </div>
            </div>
          )
          : (
            <>
              <InteractiveLesson
                key={puzzle.id}
                def={def}
                setup={puzzle.setup}
                challenge={{ prompt: puzzle.prompt, solution: puzzle.solution, success: 'Solved! Your daily streak is safe — come back tomorrow for a new one.' }}
                theme={theme}
                onSolved={onSolved}
                onFailed={onFailed}
              />
              <div className="dy-actions">
                {result === 'failed' && <span className="dy-verdict bad">Not quite — study the position and try again.</span>}
                {result === 'idle' && <span className="faint" style={{ fontSize: 13 }}>One puzzle a day, drawn from across the whole center. Solve it to extend your streak.</span>}
              </div>
            </>
          )}
      </div>
    </div>
  );
}

function Stat({ n, l, hot, icon }: { n: number; l: string; hot?: boolean; icon?: string }) {
  return (
    <div className={`dy-stat ${hot ? 'hot' : ''}`}>
      <div className="dy-stat-n">{icon && <span>{icon}</span>}{n}</div>
      <div className="dy-stat-l">{l}</div>
    </div>
  );
}
