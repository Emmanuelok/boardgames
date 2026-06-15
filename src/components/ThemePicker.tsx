import { useMemo, useState } from 'react';
import { BOARD_THEMES, THEME_CATEGORIES, type BoardTheme, type ThemeCategory } from '../themes/boardThemes';
import './ThemePicker.css';

export default function ThemePicker({ current, onPick, onClose }: { current: string; onPick: (id: string) => void; onClose: () => void; }) {
  const [cat, setCat] = useState<ThemeCategory | 'All'>('Liquid Glass');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    return BOARD_THEMES.filter((t) =>
      (cat === 'All' || t.category === cat) &&
      (q === '' || t.name.toLowerCase().includes(q.toLowerCase())),
    );
  }, [cat, q]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="theme-picker glass" onClick={(e) => e.stopPropagation()}>
        <div className="tp-head">
          <div>
            <h3 style={{ margin: 0 }}>Board themes</h3>
            <span className="faint" style={{ fontSize: 13 }}>{BOARD_THEMES.length} templates · including Liquid Glass</span>
          </div>
          <button className="btn icon" onClick={onClose}>✕</button>
        </div>

        <div className="tp-filters">
          <input className="tp-search" placeholder="Search themes…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="tp-cats">
            <button className={`chip clickable ${cat === 'All' ? 'active' : ''}`} onClick={() => setCat('All')}>All</button>
            {THEME_CATEGORIES.map((c) => (
              <button key={c} className={`chip clickable ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="tp-grid">
          {list.map((t) => (
            <button key={t.id} className={`tp-item ${current === t.id ? 'on' : ''}`} onClick={() => onPick(t.id)} title={t.name}>
              <Preview t={t} />
              <span className="tp-name">{t.name}</span>
            </button>
          ))}
          {list.length === 0 && <div className="faint" style={{ padding: 20 }}>No themes match “{q}”.</div>}
        </div>
      </div>
    </div>
  );
}

function Preview({ t }: { t: BoardTheme }) {
  return (
    <div className="tp-prev" style={{ background: t.glass ? '#0a1018' : t.surface, borderColor: t.border, boxShadow: t.glow ? `0 0 14px -4px ${t.glow}` : undefined }}>
      <div
        className="tp-checker"
        style={{
          backgroundColor: t.light,
          backgroundImage: `linear-gradient(45deg, ${t.dark} 25%, transparent 25%, transparent 75%, ${t.dark} 75%), linear-gradient(45deg, ${t.dark} 25%, transparent 25%, transparent 75%, ${t.dark} 75%)`,
          backgroundSize: '25% 25%',
          backgroundPosition: '0 0, 12.5% 12.5%',
        }}
      />
      <span className="tp-piece light" style={{ background: t.pieceLight }} />
      <span className="tp-piece dark" style={{ background: t.pieceDark }} />
    </div>
  );
}
