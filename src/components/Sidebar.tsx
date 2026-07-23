import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useProgression, levelFromXp, questComplete } from '../progression/progression';
import './Sidebar.css';

interface NavigationItem {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
  mobile?: boolean;
}

const GROUPS: { title: string; items: NavigationItem[] }[] = [
  { title: 'Your journey', items: [
    { to: '/', icon: '⌂', label: 'Today', end: true, mobile: true },
    { to: '/path', icon: '✦', label: 'My Path', mobile: true },
  ] },
  { title: 'Explore', items: [
    { to: '/games', icon: '◫', label: 'Games', mobile: true },
    { to: '/daily', icon: '◉', label: 'Daily' },
    { to: '/puzzles', icon: '◇', label: 'Puzzles' },
    { to: '/openings', icon: '📖', label: 'Openings' },
    { to: '/lobby', icon: '◎', label: 'Play Online' },
  ] },
  { title: 'Progress', items: [
    { to: '/reviews', icon: '⌁', label: 'Reviews' },
    { to: '/profile', icon: '◌', label: 'Profile', mobile: true },
    { to: '/shop', icon: '♢', label: 'Collection' },
  ] },
];

export default function Sidebar() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreToggleRef = useRef<HTMLButtonElement>(null);
  const xp = useProgression((s) => s.xp);
  const coins = useProgression((s) => s.coins);
  const quests = useProgression((s) => s.quests);
  const weekly = useProgression((s) => s.weekly);
  const claimable = [...quests, ...weekly].filter((q) => questComplete(q) && !q.claimed).length;
  const { level, into, span } = levelFromXp(xp);
  const pct = Math.round((into / span) * 100);
  const secondary = GROUPS.flatMap((group) => group.items.filter((item) => !item.mobile));
  const secondaryActive = secondary.some((item) => (
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  ));

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMoreOpen(false);
      requestAnimationFrame(() => moreToggleRef.current?.focus());
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [moreOpen]);

  return (
    <aside className="sidebar">
      <Link to="/" className="sb-brand">
        <span className="sb-mark">♞</span>
        <span className="sb-name">GrandMaster</span>
      </Link>

      <nav className="sb-nav" aria-label="Primary navigation">
        {GROUPS.map((g) => (
          <div className="sb-group" key={g.title}>
            <span className="sb-group-title">{g.title}</span>
            {g.items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `sb-link ${n.mobile ? 'mobile-primary' : 'mobile-secondary'} ${isActive ? 'on' : ''}`}>
                <span className="sb-ic">{n.icon}</span>
                <span className="sb-label">{n.label}</span>
                {n.to === '/profile' && claimable > 0 && <span className="sb-badge" role="status" aria-label={`${claimable} reward${claimable === 1 ? '' : 's'} to claim`} title={`${claimable} reward${claimable === 1 ? '' : 's'} to claim`}>{claimable}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <button
        ref={moreToggleRef}
        className={`sb-more-toggle ${moreOpen || secondaryActive ? 'on' : ''}`}
        type="button"
        aria-expanded={moreOpen}
        aria-controls="mobile-more"
        onClick={() => setMoreOpen((open) => !open)}
      >
        <span className="sb-ic">•••</span><span className="sb-label">More</span>
      </button>

      <nav className={`sb-mobile-more ${moreOpen ? 'open' : ''}`} id="mobile-more" aria-label="More navigation" aria-hidden={!moreOpen}>
        {moreOpen && (
          <>
            <div className="sb-mobile-more-head">
              <strong>More from GrandMaster</strong>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  requestAnimationFrame(() => moreToggleRef.current?.focus());
                }}
                aria-label="Close more navigation"
              >
                ×
              </button>
            </div>
            <div className="sb-mobile-more-grid">
              {secondary.map((item) => (
                <NavLink key={item.to} to={item.to} onClick={() => setMoreOpen(false)}>
                  <span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong>
                </NavLink>
              ))}
            </div>
          </>
        )}
      </nav>

      <Link to="/profile" className="sb-prog" title={`Level ${level} · ${into}/${span} XP`}>
        <div className="sb-prog-top">
          <span className="sb-lvl">Lv {level}</span>
          <span className="sb-coins">🪙 {coins.toLocaleString()}</span>
        </div>
        <div className="sb-xp"><div className="sb-xp-fill" style={{ width: `${pct}%` }} /></div>
      </Link>

      <Link to="/path" className="btn primary sb-cta">✦ Continue my path</Link>
    </aside>
  );
}
