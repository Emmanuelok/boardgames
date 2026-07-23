import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BOARD_THEMES } from '../themes/boardThemes';
import { GAME_COUNT } from '../engine/catalogueMeta';
import ShaderField from '../components/ShaderField';
import Onboarding from '../components/Onboarding';
import { useProfile, ratingTitle } from '../profile/profile';
import { useProgression, levelFromXp, cosmetic, COSMETICS } from '../progression/progression';
import './Home.css';

const GamesGallery = lazy(() => import('../components/GamesGallery'));

const INTELLIGENCE = [
  { icon: '◉', title: 'Diagnose', body: 'Reads games, reviews and practice evidence to find the highest-value focus.' },
  { icon: '◇', title: 'Learn', body: 'Sequences the right lesson and interactive position for your current level.' },
  { icon: '✦', title: 'Practice', body: 'Moves from guided examples to independent calculation with fading support.' },
  { icon: '⬡', title: 'Play', body: 'Sets a fair opponent and explains the meaning behind every decision.' },
  { icon: '⌁', title: 'Reflect', body: 'Turns decisive moments into the next lesson instead of a forgotten result.' },
];

const localDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function useNearViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || ready) return;
    if (!('IntersectionObserver' in window)) { setReady(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setReady(true); observer.disconnect(); }
    }, { rootMargin: '700px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);
  return [ref, ready] as const;
}

export default function Home() {
  const navigate = useNavigate();
  const profile = useProfile();
  const progression = useProgression();
  const [galleryRef, galleryReady] = useNearViewport<HTMLElement>();
  const { level, into, span } = levelFromXp(progression.xp);
  const levelPct = Math.round((into / span) * 100);

  const equippedWp = progression.equipped.wallpaper;
  const activeWp = cosmetic(equippedWp || '')?.value || 'aurora';
  const wallpapers = useMemo(() => COSMETICS.filter((item) => item.slot === 'wallpaper'), []);
  const training = useMemo(() => {
    try {
      const daily = JSON.parse(localStorage.getItem('gm-daily') || '{}');
      const puzzles = JSON.parse(localStorage.getItem('gm-puzzles') || '{}');
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const live = daily.lastDate === localDateKey() || daily.lastDate === localDateKey(yesterday);
      return { dailyDone: daily.lastDate === localDateKey(), streak: live ? Number(daily.streak) || 0 : 0, puzzles: Number(puzzles.solved) || 0 };
    } catch { return { dailyDone: false, streak: 0, puzzles: 0 }; }
  }, []);

  const favoriteId = Object.entries(profile.stats).sort(([, a], [, b]) => b.played - a.played)[0]?.[0] || 'chess';
  const firstName = profile.name !== 'You' ? profile.name : '';

  return (
    <div className="home">
      <Onboarding />

      <header className="home-hero">
        <img
          className="hh-art"
          src="./assets/strategy-atlas.webp"
          alt=""
          width="1774"
          height="887"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <ShaderField variant={activeWp} className="hh-bg hh-shader" />
        <div className="hh-veil" />
        <div className="hh-inner">
          <div className="hh-copy">
            <span className="eyebrow"><i aria-hidden="true" /> The adaptive school of strategy · {GAME_COUNT} complete engines</span>
            <h1 className="hh-title">Every move becomes your <span>next lesson.</span></h1>
            <p className="hh-sub">Play the world’s great board games inside one connected intelligence that observes, teaches, challenges, reviews and adapts around you.</p>
            <div className="hh-actions">
              <Link className="btn primary lg glow" to="/path">✦ Build my strategy path</Link>
              <button type="button" className="btn lg hh-secondary" onClick={() => navigate(`/play/${favoriteId}`)}>Play now</button>
            </div>
            <div className="hh-trust">
              <span><b>{GAME_COUNT}</b> games</span><i />
              <span><b>{BOARD_THEMES.length}+</b> board worlds</span><i />
              <span><b>2D + 3D</b> play</span><i />
              <span><b>Every move</b> explained</span>
            </div>
          </div>

          <aside className="hh-snapshot" aria-label="Your live learning snapshot">
            <div className="hh-snapshot-head">
              <span><i aria-hidden="true" /> Live learner model</span>
              <Link to="/path">Open path →</Link>
            </div>
            <div className="hh-welcome">{firstName ? `Welcome back, ${firstName}` : 'Your evidence starts here'}</div>
            <div className="hh-snapshot-grid" role="list" aria-label="Learning statistics">
              <div role="listitem"><small>Rating</small><strong>{profile.rating}</strong><span>{ratingTitle(profile.rating)}</span></div>
              <div role="listitem"><small>Level</small><strong>{level}</strong><span>{into}/{span} XP</span></div>
              <div role="listitem"><small>Games</small><strong>{profile.totals.played}</strong><span>{profile.totals.wins} wins</span></div>
              <div role="listitem"><small>Streak</small><strong>{training.streak}</strong><span>day{training.streak === 1 ? '' : 's'}</span></div>
            </div>
            <div className="hh-level" role="progressbar" aria-label={`Progress through level ${level}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={levelPct}><span style={{ width: `${levelPct}%` }} /></div>
            <div className="hh-next">
              <span className="hh-next-mark">✦</span>
              <div><small>Recommended now</small><strong>{profile.totals.played ? 'Continue your adaptive route' : 'Take a guided placement game'}</strong></div>
              <Link to="/path" aria-label="Open recommended strategy path">→</Link>
            </div>
          </aside>
        </div>

        <div className="hh-wallpapers" role="group" aria-label="Living background">
          <span>Atmosphere</span>
          {wallpapers.slice(0, 4).map((wallpaper) => progression.owned.includes(wallpaper.id)
            ? <button type="button" key={wallpaper.id} className={equippedWp === wallpaper.id ? 'on' : ''} aria-pressed={equippedWp === wallpaper.id} onClick={() => progression.equipCosmetic('wallpaper', wallpaper.id)}>{wallpaper.name}</button>
            : <Link key={wallpaper.id} to="/shop" title={`Unlock ${wallpaper.name}`}>◇ {wallpaper.name}</Link>)}
        </div>
      </header>

      <section className="home-today" aria-labelledby="today-title">
        <div className="home-section-head">
          <div><span className="section-overline">Today, connected</span><h2 id="today-title">One clear next move.</h2></div>
          <Link to="/path" className="text-link">See the full learning route →</Link>
        </div>
        <div className="today-grid">
          <Link to="/path" className="today-primary glass">
            <span className="today-kicker"><i aria-hidden="true" /> Adaptive mission</span>
            <h3>{profile.totals.played ? 'Turn your latest evidence into progress.' : 'Let the system understand how you think.'}</h3>
            <p>{profile.totals.played ? 'Your games, puzzles and reviews are already being joined into one recommended sequence.' : 'A short guided session establishes a baseline without locking you into a label.'}</p>
            <span className="today-go">Open my path <b aria-hidden="true">→</b></span>
          </Link>
          <Link to="/daily" className={`today-card glass-soft ${training.dailyDone ? 'done' : ''}`}>
            <span className="today-icon" aria-hidden="true">◉</span><small>Daily position</small><strong>{training.dailyDone ? 'Complete' : 'Ready to solve'}</strong><span>{training.streak ? `${training.streak}-day streak` : 'A focused two-minute challenge'}</span><b aria-hidden="true">→</b>
          </Link>
          <Link to="/puzzles" className="today-card glass-soft">
            <span className="today-icon" aria-hidden="true">◇</span><small>Practice builder</small><strong>{training.puzzles} solved</strong><span>Train patterns across multiple games</span><b aria-hidden="true">→</b>
          </Link>
          <Link to="/reviews" className="today-card glass-soft">
            <span className="today-icon" aria-hidden="true">⌁</span><small>Review analyst</small><strong>{profile.totals.played ? 'Find the turning point' : 'Awaiting first game'}</strong><span>Accuracy, evaluation and key moments</span><b aria-hidden="true">→</b>
          </Link>
        </div>
      </section>

      <section className="home-intelligence" aria-labelledby="intelligence-title">
        <div className="hi-visual">
          <img src="./assets/adaptive-intelligence.webp" alt="Abstract strategy board connected to five analytical layers" width="1659" height="948" loading="lazy" decoding="async" />
          <div className="hi-visual-label"><span><i aria-hidden="true" /> One shared memory</span><strong>Rules remain engine-verified</strong></div>
        </div>
        <div className="hi-copy">
          <span className="section-overline">Not five disconnected tools</span>
          <h2 id="intelligence-title">Five specialists. One understanding of you.</h2>
          <p>The same learner model follows the full cycle—from the idea you study to the move you choose and the moment you review. Each stage updates what comes next.</p>
          <div className="intelligence-list">
            {INTELLIGENCE.map((item, index) => (
              <article key={item.title}>
                <span aria-hidden="true">{item.icon}</span><i aria-hidden="true">{String(index + 1).padStart(2, '0')}</i>
                <div><h3>{item.title}</h3><p>{item.body}</p></div>
              </article>
            ))}
          </div>
          <Link className="btn" to="/path">See the coordinated system →</Link>
        </div>
      </section>

      <section className="home-games" ref={galleryRef} aria-labelledby="library-title">
        <div className="home-section-head">
          <div><span className="section-overline">Discover the library</span><h2 id="library-title">Choose a world. Keep one learning path.</h2><p>Every game has its own rules and culture, while your progress moves with you.</p></div>
          <Link to="/games" className="text-link">Explore all {GAME_COUNT} games →</Link>
        </div>
        {galleryReady ? (
          <Suspense fallback={<GallerySkeleton />}><GamesGallery limit={8} /></Suspense>
        ) : <GallerySkeleton />}
      </section>

      <section className="home-closing" aria-labelledby="closing-title">
        <img src="./assets/learning-journey.webp" alt="" width="1774" height="887" loading="lazy" decoding="async" />
        <div className="home-closing-veil" />
        <div>
          <span className="section-overline">A path that grows with every decision</span>
          <h2 id="closing-title">Stop collecting games. Start building transferable strategy.</h2>
          <p>Pattern recognition, tempo, mobility, territory, connection and calculation can travel with you from one board to the next.</p>
          <div><Link className="btn primary lg" to="/path">Begin my path</Link><Link className="btn lg" to="/games">Explore the library</Link></div>
        </div>
      </section>
    </div>
  );
}

function GallerySkeleton() {
  return <div className="hg-skeleton" aria-hidden="true">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="hg-skel-card" />)}</div>;
}
