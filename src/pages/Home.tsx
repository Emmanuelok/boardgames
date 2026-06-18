import { Suspense, lazy, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GAME_COUNT } from '../engine/catalogueMeta';
import { BOARD_THEMES } from '../themes/boardThemes';
import ShaderField, { WALLPAPERS } from '../components/ShaderField';
import Onboarding from '../components/Onboarding';
import './Home.css';

// The catalogue (and the whole game registry) loads only when the gallery mounts,
// so the hero paints instantly and the games stream in just below it.
const GamesGallery = lazy(() => import('../components/GamesGallery'));

const FEATURES = [
  { icon: '🧠', title: 'A tutor, not just an opponent', body: 'Every move graded Brilliant → Blunder and explained in plain English.' },
  { icon: '🎬', title: '2D & 3D boards', body: 'A hand-crafted 2D set or a fully interactive 3D board with real lighting.' },
  { icon: '📈', title: 'Full game review', body: 'Accuracy score, evaluation graph and a move-by-move breakdown after every game.' },
  { icon: '💎', title: `${BOARD_THEMES.length}+ board themes`, body: 'Wood, marble, neon and the signature Liquid Glass — switch instantly.' },
];

export default function Home() {
  const nav = useNavigate();
  const [wallpaper, setWallpaper] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('gm-wallpaper') : null;
    return WALLPAPERS.some((w) => w.id === saved) ? (saved as string) : WALLPAPERS[0].id;
  });
  const pickWallpaper = (id: string) => { setWallpaper(id); try { localStorage.setItem('gm-wallpaper', id); } catch { /* ignore */ } };

  const daily = useMemo(() => { try { return JSON.parse(localStorage.getItem('gm-daily') || '{}'); } catch { return {}; } }, []);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dailyDone = daily.lastDate === today;
  const dailyStreak = dailyDone || daily.lastDate === yesterday ? (daily.streak || 0) : 0;

  return (
    <div className="home">
      <Onboarding />

      <header className="home-hero">
        <ShaderField variant={wallpaper} className="hh-bg" />
        <div className="hh-veil" />
        <div className="hh-inner">
          <div className="hh-copy">
            <span className="eyebrow">✦ AI Game Center · {GAME_COUNT} games · step-by-step tutor</span>
            <h1 className="hh-title">Play, and actually get <span className="gradient-text">better</span>.</h1>
            <p className="hh-sub">An engine that explains the meaning behind every move — in 2D and 3D, with a full post-game review.</p>
            <div className="row gap-sm wrap">
              <button className="btn primary lg glow" onClick={() => nav('/play/chess')}>♟ Quick play: Chess</button>
              <button className="btn lg" onClick={() => nav('/daily')}>📅 Daily{dailyDone ? ' ✓' : dailyStreak > 0 ? ` · 🔥${dailyStreak}` : ''}</button>
            </div>
          </div>
          <div className="hh-wp" role="group" aria-label="Living wallpaper">
            <span className="hh-wp-label">✦ Living wallpaper — move & click to play</span>
            <div className="hh-wp-chips">
              {WALLPAPERS.map((w) => (
                <button key={w.id} className={`wp-chip ${wallpaper === w.id ? 'on' : ''}`} onClick={() => pickWallpaper(w.id)}>{w.label}</button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="home-games">
        <div className="hg-head">
          <h2>Choose your game</h2>
          <p className="muted">{GAME_COUNT} unique games — each with a course, a move-by-move tutor and post-game review.</p>
        </div>
        <Suspense fallback={<div className="hg-skeleton">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="hg-skel-card" />)}</div>}>
          <GamesGallery />
        </Suspense>
      </section>

      <section className="home-features">
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature glass-soft" key={f.title}>
              <span className="feat-ic">{f.icon}</span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="home-foot faint">Crafted for players who want to understand the game, not just play it.</div>
      </section>
    </div>
  );
}
