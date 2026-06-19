import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATALOGUE } from '../engine/registry';
import type { GameDefinition } from '../engine/types';
import MiniBoard from './MiniBoard';
import { getTheme } from '../themes/boardThemes';
import '../pages/Games.css';

const THUMB_THEME = getTheme('tournament-green'); // a bright, high-contrast board reads well at thumbnail size

/** Mount the heavy board preview only once the card nears the viewport. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver((es) => { if (es[0]?.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

function GameThumb({ def }: { def: GameDefinition }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const renderable = useMemo(() => {
    try { return def.getBoardView(def.createInitialState()).cells.length > 1; } catch { return false; }
  }, [def]);
  if (!renderable) {
    return <div ref={ref} className="gt-fallback" style={{ ['--accent' as any]: def.accent }}><span className="gt-emoji">{def.emoji}</span></div>;
  }
  return (
    <div ref={ref} className="gt-fit">
      {seen ? <MiniBoard def={def} theme={THUMB_THEME} /> : <span className="gt-emoji ghost">{def.emoji}</span>}
    </div>
  );
}

export default function GamesGallery() {
  const nav = useNavigate();
  return (
    <div className="game-grid">
      {CATALOGUE.map((entry) => {
        const fam = entry.type === 'family' ? entry.family : null;
        const g = entry.type === 'family' ? entry.primary : entry.def;
        const name = fam ? fam.name : g.name;
        const category = fam ? fam.category : g.category;
        const tagline = fam ? fam.tagline : g.tagline;
        return (
          <div className="game-card glass" key={fam ? `fam-${fam.id}` : g.id} style={{ ['--accent' as any]: g.accent }}>
            <button className="gc-thumb" onClick={() => nav(`/play/${g.id}`)} aria-label={`Play ${name}`}>
              <GameThumb def={g} />
              <span className="chip gc-cat">{category}</span>
              {fam && <span className="chip gc-variants">{fam.variants.length} variants</span>}
            </button>
            <div className="gc-body">
              <h3 className="gc-name">{g.emoji} {name}</h3>
              <p className="gc-tag">{tagline}</p>
              <div className="gc-meta"><Depth depth={g.depth} /><span className="faint">{fam ? fam.variants.map((v) => v.label.split(' · ')[0]).join(' · ') : `${g.players[0].name} v ${g.players[1].name}`}</span></div>
              <div className="gc-actions">
                <button className="btn primary sm" onClick={() => nav(`/play/${g.id}`)}>Play</button>
                <button className="btn sm" onClick={() => nav(`/learn/${g.id}`)}>Learn</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Depth({ depth }: { depth: number }) {
  return <span className="depth" title={`Depth ${depth} / 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= depth ? 'on' : ''} />)}</span>;
}
