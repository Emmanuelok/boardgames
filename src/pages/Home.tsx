import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GAME_COUNT, SAMPLE_EMOJIS } from '../engine/catalogueMeta';
import { BOARD_THEMES } from '../themes/boardThemes';
import ShaderField, { WALLPAPERS } from '../components/ShaderField';
import Onboarding from '../components/Onboarding';
import './Home.css';

const FEATURES = [
  { icon: '🧠', title: 'A tutor, not just an opponent', body: 'Every move graded Brilliant → Blunder and explained in plain English — forks, pins, hanging pieces, plans, and the stronger move you missed.' },
  { icon: '🎬', title: 'Cinematic 2D & 3D', body: 'A hand-crafted animated 2D set, or a fully interactive 3D board with real lighting, shadows and orbit controls.' },
  { icon: '📈', title: 'Full game review', body: 'After every game, get an accuracy score, an evaluation graph, and a move-by-move breakdown — like a personal coach.' },
  { icon: '💎', title: `${BOARD_THEMES.length}+ board themes`, body: 'Tournament wood, marble, neon, gemstone and the signature Liquid Glass — preview and switch instantly.' },
];

/** One IntersectionObserver reveals every `.reveal` element as it scrolls in. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal')) as HTMLElement[];
    if (!('IntersectionObserver' in window) || els.length === 0) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '-6% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

export default function Home() {
  const nav = useNavigate();
  const [wallpaper, setWallpaper] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('gm-wallpaper') : null;
    return WALLPAPERS.some((w) => w.id === saved) ? (saved as string) : WALLPAPERS[0].id;
  });
  const pickWallpaper = (id: string) => { setWallpaper(id); try { localStorage.setItem('gm-wallpaper', id); } catch { /* ignore */ } };
  useReveal();

  // Surface the daily-challenge streak on the hero button.
  const daily = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('gm-daily') || '{}'); } catch { return {}; }
  }, []);
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dailyDone = daily.lastDate === todayKey;
  const dailyStreak = dailyDone || daily.lastDate === yesterdayKey ? (daily.streak || 0) : 0;

  return (
    <div className="home">
      <ShaderField variant={wallpaper} className="home-bg" />
      <div className="home-veil" />
      <div className="home-floor" />
      <Onboarding />

      <nav className="nav">
        <Link to="/" className="brand">
          <span className="brand-mark">♞</span>
          <span className="brand-name">GrandMaster</span>
        </Link>
        <div className="row gap-sm">
          <Link className="chip clickable hide-sm" to="/games">🎲 Games</Link>
          <Link className="chip clickable hide-sm" to="/daily">📅 Daily</Link>
          <Link className="chip clickable hide-sm" to="/openings">📖 Openings</Link>
          <Link className="chip clickable hide-sm" to="/lobby">🌐 Lobby</Link>
          <Link className="chip clickable hide-sm" to="/puzzles">🧩 Puzzles</Link>
          <Link className="chip clickable hide-sm" to="/reviews">🗂 Reviews</Link>
          <Link className="chip clickable hide-sm" to="/profile">👤 Profile</Link>
          <button className="btn primary sm" onClick={() => nav('/play/chess')}>Play now</button>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow hero-eyebrow">✦ AI Game Center · 2D &amp; 3D · Step-by-step tutor</span>
          <h1 className="hero-title">Master every board game with an AI that <span className="gradient-text">teaches you</span>.</h1>
          <p className="hero-sub">
            Chess, Go, Backgammon, Amazons and {GAME_COUNT - 4} more distinct games — played against an engine
            that explains the meaning behind every move, in stunning 2D and 3D, with full post-game review.
          </p>
          <div className="row gap-sm wrap">
            <button className="btn primary lg glow" onClick={() => nav('/play/chess')}>♟ Start playing</button>
            <button className="btn lg" onClick={() => nav('/daily')}>
              📅 Daily challenge{dailyDone ? ' ✓' : dailyStreak > 0 ? ` · 🔥${dailyStreak}` : ''}
            </button>
            <button className="btn lg" onClick={() => nav('/puzzles')}>🧩 Train tactics</button>
            <button className="btn lg" onClick={() => nav('/learn/chess')}>📖 Learn</button>
          </div>
          <div className="hero-stats">
            <Stat n={GAME_COUNT} l="unique games" />
            <Stat n={BOARD_THEMES.length} suffix="+" l="themes" />
            <Stat n={37} l="lessons" />
            <Stat n={2} suffix="D · 3D" l="every board" raw />
          </div>
        </div>

        <div className="wallpaper-panel glass">
          <div className="wp-head">
            <span className="wp-title">✦ Living wallpaper</span>
            <span className="wp-sub">Move your cursor · click anywhere to ripple</span>
          </div>
          <div className="wp-switch">
            {WALLPAPERS.map((w) => (
              <button key={w.id} className={`wp-chip ${wallpaper === w.id ? 'on' : ''}`} onClick={() => pickWallpaper(w.id)}>
                {w.label}
              </button>
            ))}
          </div>
          <p className="wp-hint">{WALLPAPERS.find((w) => w.id === wallpaper)?.hint}</p>
        </div>
      </header>

      <section id="games" className="section">
        <div className="gcta glass reveal">
          <div className="gcta-copy">
            <h2>{GAME_COUNT} games, one tutor</h2>
            <p className="muted">From Chess, Go and Backgammon to Surakarta and a handful of our own originals — each ships with a step-by-step course, a move-by-move AI tutor, and full post-game review.</p>
            <div className="row gap-sm wrap">
              <button className="btn primary lg glow" onClick={() => nav('/games')}>🎲 Browse all games</button>
              <button className="btn lg" onClick={() => nav('/play/chess')}>♟ Quick play: Chess</button>
            </div>
          </div>
          <div className="gcta-emojis" aria-hidden="true">
            {SAMPLE_EMOJIS.map((e, i) => (
              <span key={i} className="gcta-chip">{e}</span>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="section">
        <div className="section-head reveal">
          <h2>Built to make you better</h2>
          <p className="muted">Not just a place to play — a place to improve.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature glass-soft reveal" key={f.title}>
              <span className="feat-ic">{f.icon}</span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span className="brand"><span className="brand-mark sm">♞</span> GrandMaster</span>
        <span className="faint">Crafted for players who want to understand the game, not just play it.</span>
      </footer>
    </div>
  );
}

function Stat({ n, l, suffix, raw }: { n: number; l: string; suffix?: string; raw?: boolean }) {
  const [val, setVal] = useState(raw ? n : 0);
  useEffect(() => {
    if (raw) return;
    const t0 = performance.now();
    const dur = 900;
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * n));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [n, raw]);
  return (
    <div className="stat">
      <div className="stat-n">{val}{suffix}</div>
      <div className="stat-l">{l}</div>
    </div>
  );
}

