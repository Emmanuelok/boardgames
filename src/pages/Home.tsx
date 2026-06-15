import { Link, useNavigate } from 'react-router-dom';
import { GAMES } from '../engine/registry';
import { BOARD_THEMES } from '../themes/boardThemes';
import './Home.css';

const FEATURES = [
  { icon: '🧠', title: 'World-class move tutor', body: 'Every move is graded from Brilliant to Blunder and explained in plain English — captures, forks, hanging pieces, plans and the stronger idea you missed.' },
  { icon: '🎮', title: 'Stunning 2D & 3D boards', body: 'Play in a crisp animated 2D view or swing around a fully interactive 3D board with real lighting and shadows.' },
  { icon: '💎', title: 'Hundreds of board themes', body: `Dress your board in any of ${BOARD_THEMES.length}+ templates — from tournament wood to neon, marble and our signature Liquid Glass.` },
  { icon: '⚙️', title: 'An opponent for everyone', body: 'Dial the AI from a gentle beginner to a genuinely strong master, with an opening book and real search behind every move.' },
];

export default function Home() {
  const nav = useNavigate();
  const chess = GAMES.find((g) => g.id === 'chess')!;

  return (
    <div className="home">
      <nav className="nav">
        <Link to="/" className="brand">
          <span className="brand-mark">♛</span>
          <span className="brand-name">GrandMaster<span className="brand-dot">.</span></span>
        </Link>
        <div className="row gap-sm">
          <a className="chip clickable" href="#games">Games</a>
          <a className="chip clickable" href="#features">Features</a>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-inner fade-in">
          <span className="eyebrow">AI Game Center · 2D &amp; 3D · Step-by-step tutor</span>
          <h1 className="hero-title">
            The most <span className="gradient-text">intelligent</span><br />board game center in the world.
          </h1>
          <p className="hero-sub">
            Master Chess and a growing universe of board games against an AI that doesn&apos;t just beat you —
            it <strong>teaches you</strong>, explaining the meaning behind every single move.
          </p>
          <div className="row gap-sm wrap" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => nav(`/play/${chess.id}`)}>♟ Play Chess</button>
            <a className="btn" href="#games">Browse all games</a>
            <button className="btn ghost" onClick={() => nav(`/learn/${chess.id}`)}>📖 Learn to play</button>
          </div>
          <div className="hero-stats">
            <Stat n={`${GAMES.length}`} l="games" />
            <Stat n={`${BOARD_THEMES.length}+`} l="board themes" />
            <Stat n="2D / 3D" l="every board" />
            <Stat n="∞" l="lessons" />
          </div>
        </div>
      </header>

      <section id="games" className="section">
        <div className="section-head">
          <h2>Choose your game</h2>
          <p className="muted">Each one ships with a full rules course and a move-by-move AI tutor.</p>
        </div>
        <div className="game-grid">
          {GAMES.map((g, i) => (
            <div className="game-card glass fade-in" style={{ animationDelay: `${i * 60}ms`, ['--accent' as any]: g.accent }} key={g.id}>
              <div className="gc-glow" />
              <div className="gc-top">
                <span className="gc-emoji">{g.emoji}</span>
                <span className="chip gc-cat">{g.category}</span>
              </div>
              <h3 className="gc-name">{g.name}</h3>
              <p className="gc-tag">{g.tagline}</p>
              <div className="gc-meta">
                <Depth depth={g.depth} />
                <span className="faint">{g.players[0].name} vs {g.players[1].name}</span>
              </div>
              <div className="gc-actions">
                <Link className="btn primary sm" to={`/play/${g.id}`}>Play</Link>
                <Link className="btn sm" to={`/learn/${g.id}`}>Learn</Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="section">
        <div className="section-head">
          <h2>Built to make you better</h2>
          <p className="muted">Not just a place to play — a place to improve.</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature glass-soft" key={f.title}>
              <span className="feat-ic">{f.icon}</span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span className="brand"><span className="brand-mark">♛</span> GrandMaster</span>
        <span className="faint">Crafted for players who want to understand the game, not just play it.</span>
      </footer>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="stat">
      <div className="stat-n">{n}</div>
      <div className="stat-l">{l}</div>
    </div>
  );
}

function Depth({ depth }: { depth: number }) {
  return (
    <span className="depth" title={`Depth ${depth} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= depth ? 'on' : ''} />)}
    </span>
  );
}
