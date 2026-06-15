import { Link, useNavigate } from 'react-router-dom';
import { GAMES, getGame } from '../engine/registry';
import { BOARD_THEMES, getTheme } from '../themes/boardThemes';
import MiniBoard from '../components/MiniBoard';
import './Home.css';

const FEATURES = [
  { icon: '🧠', title: 'A tutor, not just an opponent', body: 'Every move is graded Brilliant → Blunder and explained in plain English — captures, forks, pins, hanging pieces, plans, and the stronger move you missed.' },
  { icon: '🎮', title: 'Stunning 2D & 3D boards', body: 'A crisp animated 2D view with a hand-crafted piece set, or a fully interactive 3D board with real lighting, shadows and orbit controls.' },
  { icon: '💎', title: `${BOARD_THEMES.length}+ board themes`, body: 'From tournament wood and marble to neon, gemstone and the signature Liquid Glass — preview and switch instantly.' },
  { icon: '📚', title: 'Interactive lessons', body: 'Guided, hands-on courses for every game: learn the rules, then solve real positions on the board with instant feedback.' },
];

export default function Home() {
  const nav = useNavigate();
  const chess = getGame('chess')!;
  const heroTheme = getTheme('wood-walnut');

  return (
    <div className="home">
      <nav className="nav">
        <Link to="/" className="brand">
          <span className="brand-mark">♞</span>
          <span className="brand-name">GrandMaster</span>
        </Link>
        <div className="row gap-sm">
          <a className="chip clickable" href="#games">Games</a>
          <a className="chip clickable" href="#features">Features</a>
          <button className="btn primary sm" onClick={() => nav('/play/chess')}>Play</button>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy fade-in">
          <span className="eyebrow">AI Game Center · 2D &amp; 3D · Step-by-step tutor</span>
          <h1 className="hero-title">
            The board game center that <span className="gradient-text">teaches you</span> to win.
          </h1>
          <p className="hero-sub">
            Play Chess and a growing universe of board games against an AI that explains the meaning behind
            every move — in stunning 2D and 3D, dressed in any of {BOARD_THEMES.length}+ themes.
          </p>
          <div className="row gap-sm wrap">
            <button className="btn primary lg" onClick={() => nav('/play/chess')}>♟ Play Chess</button>
            <button className="btn lg" onClick={() => nav('/learn/chess')}>📖 Learn to play</button>
          </div>
          <div className="hero-stats">
            <Stat n={`${GAMES.length}`} l="games" />
            <Stat n={`${BOARD_THEMES.length}+`} l="themes" />
            <Stat n="2D · 3D" l="every board" />
            <Stat n="∞" l="lessons" />
          </div>
        </div>
        <div className="hero-board fade-in">
          <div className="hero-board-frame">
            <MiniBoard def={chess} theme={heroTheme} />
          </div>
          <div className="hero-board-glow" />
        </div>
      </header>

      <section id="games" className="section">
        <div className="section-head">
          <h2>Choose your game</h2>
          <p className="muted">Each one ships with a full course and a move-by-move AI tutor.</p>
        </div>
        <div className="game-grid">
          {GAMES.map((g, i) => (
            <div className="game-card glass fade-in" style={{ animationDelay: `${i * 45}ms`, ['--accent' as any]: g.accent }} key={g.id}>
              <div className="gc-art">
                <span className="gc-emoji">{g.emoji}</span>
                <span className="chip gc-cat">{g.category}</span>
              </div>
              <div className="gc-body">
                <h3 className="gc-name">{g.name}</h3>
                <p className="gc-tag">{g.tagline}</p>
                <div className="gc-meta">
                  <Depth depth={g.depth} />
                  <span className="faint">{g.players[0].name} v {g.players[1].name}</span>
                </div>
                <div className="gc-actions">
                  <Link className="btn primary sm" to={`/play/${g.id}`}>Play</Link>
                  <Link className="btn sm" to={`/learn/${g.id}`}>Learn</Link>
                </div>
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
        <span className="brand"><span className="brand-mark sm">♞</span> GrandMaster</span>
        <span className="faint">Crafted for players who want to understand the game, not just play it.</span>
      </footer>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return <div className="stat"><div className="stat-n">{n}</div><div className="stat-l">{l}</div></div>;
}
function Depth({ depth }: { depth: number }) {
  return <span className="depth" title={`Depth ${depth} / 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= depth ? 'on' : ''} />)}</span>;
}
