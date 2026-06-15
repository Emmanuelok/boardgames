import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import { CATALOGUE, getGame } from '../engine/registry';
import { BOARD_THEMES, getTheme } from '../themes/boardThemes';
import MiniBoard from '../components/MiniBoard';
import './Home.css';

const Board3D = lazy(() => import('../components/Board3D'));

const FEATURES = [
  { icon: '🧠', title: 'A tutor, not just an opponent', body: 'Every move graded Brilliant → Blunder and explained in plain English — forks, pins, hanging pieces, plans, and the stronger move you missed.' },
  { icon: '🎬', title: 'Cinematic 2D & 3D', body: 'A hand-crafted animated 2D set, or a fully interactive 3D board with real lighting, shadows and orbit controls.' },
  { icon: '📈', title: 'Full game review', body: 'After every game, get an accuracy score, an evaluation graph, and a move-by-move breakdown — like a personal coach.' },
  { icon: '💎', title: `${BOARD_THEMES.length}+ board themes`, body: 'Tournament wood, marble, neon, gemstone and the signature Liquid Glass — preview and switch instantly.' },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.08, duration: 0.6, ease: [0.22, 0.7, 0.2, 1] } }),
};

export default function Home() {
  const nav = useNavigate();
  const chess = getGame('chess')!;
  const heroTheme = getTheme('wood-walnut');
  const heroState = chess.createInitialState();

  return (
    <div className="home">
      <nav className="nav">
        <Link to="/" className="brand">
          <span className="brand-mark">♞</span>
          <span className="brand-name">GrandMaster</span>
        </Link>
        <div className="row gap-sm">
          <Link className="chip clickable hide-sm" to="/lobby">🌐 Lobby</Link>
          <Link className="chip clickable hide-sm" to="/puzzles">🧩 Puzzles</Link>
          <Link className="chip clickable hide-sm" to="/profile">👤 Profile</Link>
          <button className="btn primary sm" onClick={() => nav('/play/chess')}>Play now</button>
        </div>
      </nav>

      <header className="hero">
        <div className="hero-copy">
          <motion.span className="eyebrow hero-eyebrow" variants={fadeUp} initial="hidden" animate="show" custom={0}>
            ✦ AI Game Center · 2D &amp; 3D · Step-by-step tutor
          </motion.span>
          <motion.h1 className="hero-title" variants={fadeUp} initial="hidden" animate="show" custom={1}>
            Master every board game with an AI that <span className="gradient-text">teaches you</span>.
          </motion.h1>
          <motion.p className="hero-sub" variants={fadeUp} initial="hidden" animate="show" custom={2}>
            Chess, Go, Backgammon, Amazons and {CATALOGUE.length - 4} more distinct games — played against an engine
            that explains the meaning behind every move, in stunning 2D and 3D, with full post-game review.
          </motion.p>
          <motion.div className="row gap-sm wrap" variants={fadeUp} initial="hidden" animate="show" custom={3}>
            <button className="btn primary lg glow" onClick={() => nav('/play/chess')}>♟ Start playing</button>
            <button className="btn lg" onClick={() => nav('/puzzles')}>🧩 Train tactics</button>
            <button className="btn lg" onClick={() => nav('/learn/chess')}>📖 Learn</button>
          </motion.div>
          <motion.div className="hero-stats" variants={fadeUp} initial="hidden" animate="show" custom={4}>
            <Stat n={CATALOGUE.length} l="unique games" />
            <Stat n={BOARD_THEMES.length} suffix="+" l="themes" />
            <Stat n={37} l="lessons" />
            <Stat n={2} suffix="D · 3D" l="every board" raw />
          </motion.div>
        </div>

        <motion.div className="hero-board" initial={{ opacity: 0, scale: 0.92, rotateY: -12 }} animate={{ opacity: 1, scale: 1, rotateY: 0 }} transition={{ duration: 0.9, ease: [0.22, 0.7, 0.2, 1] }}>
          <div className="hero-board-frame">
            <Suspense fallback={<MiniBoard def={chess} theme={heroTheme} />}>
              <Board3D
                def={chess} view={chess.getBoardView(heroState)} theme={heroTheme} turn={0}
                flipped={false} selected={null} targets={[]} lastMove={null}
                status={{ kind: 'playing' }} hint={null} onCell={() => {}} autoRotate
              />
            </Suspense>
          </div>
          <div className="hero-board-glow" />
          <div className="hero-badge glass">♛ Live 3D</div>
        </motion.div>
      </header>

      <Section id="games" title="Choose your game" sub="Each ships with a deep course and a move-by-move AI tutor.">
        <div className="game-grid">
          {CATALOGUE.map((entry, i) => {
            const fam = entry.type === 'family' ? entry.family : null;
            const g = entry.type === 'family' ? entry.primary : entry.def;
            const name = fam ? fam.name : g.name;
            const emoji = fam ? fam.emoji : g.emoji;
            const category = fam ? fam.category : g.category;
            const tagline = fam ? fam.tagline : g.tagline;
            return (
              <motion.div
                className="game-card glass" key={fam ? `fam-${fam.id}` : g.id} style={{ ['--accent' as any]: g.accent }}
                variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-8%' }} custom={(i % 4) * 0.5}
                whileHover={{ y: -8 }}
              >
                <div className="gc-art">
                  <span className="gc-emoji">{emoji}</span>
                  <span className="chip gc-cat">{category}</span>
                  {fam && <span className="chip gc-variants">{fam.variants.length} variants</span>}
                </div>
                <div className="gc-body">
                  <h3 className="gc-name">{name}</h3>
                  <p className="gc-tag">{tagline}</p>
                  <div className="gc-meta"><Depth depth={g.depth} /><span className="faint">{fam ? fam.variants.map((v) => v.label.split(' · ')[0]).join(' · ') : `${g.players[0].name} v ${g.players[1].name}`}</span></div>
                  <div className="gc-actions">
                    <Link className="btn primary sm" to={`/play/${g.id}`}>Play</Link>
                    <Link className="btn sm" to={`/learn/${g.id}`}>Learn</Link>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Section>

      <Section id="features" title="Built to make you better" sub="Not just a place to play — a place to improve.">
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <motion.div className="feature glass-soft" key={f.title}
              variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-8%' }} custom={i * 0.5}>
              <span className="feat-ic">{f.icon}</span>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      <footer className="footer">
        <span className="brand"><span className="brand-mark sm">♞</span> GrandMaster</span>
        <span className="faint">Crafted for players who want to understand the game, not just play it.</span>
      </footer>
    </div>
  );
}

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} className="section">
      <motion.div className="section-head" variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-10%' }}>
        <h2>{title}</h2>
        <p className="muted">{sub}</p>
      </motion.div>
      {children}
    </section>
  );
}

function Stat({ n, l, suffix, raw }: { n: number; l: string; suffix?: string; raw?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView || raw) return;
    let start = 0;
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * n));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    void start;
    return () => cancelAnimationFrame(raf);
  }, [inView, n, raw]);
  return (
    <div className="stat" ref={ref}>
      <div className="stat-n">{raw ? n : val}{suffix}</div>
      <div className="stat-l">{l}</div>
    </div>
  );
}

function Depth({ depth }: { depth: number }) {
  return <span className="depth" title={`Depth ${depth} / 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= depth ? 'on' : ''} />)}</span>;
}
