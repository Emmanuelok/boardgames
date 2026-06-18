import { NavLink, Link } from 'react-router-dom';
import { useProgression, levelFromXp } from '../progression/progression';
import './Sidebar.css';

const GROUPS: { title: string; items: { to: string; icon: string; label: string; end?: boolean }[] }[] = [
  { title: 'Play', items: [
    { to: '/', icon: '🎲', label: 'Games', end: true },
    { to: '/daily', icon: '📅', label: 'Daily' },
    { to: '/lobby', icon: '🌐', label: 'Online' },
  ] },
  { title: 'Learn', items: [
    { to: '/openings', icon: '📖', label: 'Openings' },
    { to: '/puzzles', icon: '🧩', label: 'Puzzles' },
  ] },
  { title: 'You', items: [
    { to: '/reviews', icon: '🗂', label: 'Reviews' },
    { to: '/shop', icon: '🛍', label: 'Shop' },
    { to: '/profile', icon: '👤', label: 'Profile' },
  ] },
];

export default function Sidebar() {
  const xp = useProgression((s) => s.xp);
  const coins = useProgression((s) => s.coins);
  const { level, into, span } = levelFromXp(xp);
  const pct = Math.round((into / span) * 100);

  return (
    <aside className="sidebar">
      <Link to="/" className="sb-brand">
        <span className="sb-mark">♞</span>
        <span className="sb-name">GrandMaster</span>
      </Link>

      <nav className="sb-nav">
        {GROUPS.map((g) => (
          <div className="sb-group" key={g.title}>
            <span className="sb-group-title">{g.title}</span>
            {g.items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `sb-link ${isActive ? 'on' : ''}`}>
                <span className="sb-ic">{n.icon}</span>
                <span className="sb-label">{n.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <Link to="/profile" className="sb-prog" title={`Level ${level} · ${into}/${span} XP`}>
        <div className="sb-prog-top">
          <span className="sb-lvl">Lv {level}</span>
          <span className="sb-coins">🪙 {coins.toLocaleString()}</span>
        </div>
        <div className="sb-xp"><div className="sb-xp-fill" style={{ width: `${pct}%` }} /></div>
      </Link>

      <Link to="/play/chess" className="btn primary sb-cta">♟ Quick play</Link>
    </aside>
  );
}
