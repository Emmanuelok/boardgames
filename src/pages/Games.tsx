import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CATALOGUE } from '../engine/registry';
import type { GameDefinition } from '../engine/types';
import MiniBoard from '../components/MiniBoard';
import { getTheme } from '../themes/boardThemes';
import './Games.css';

const THUMB_THEME = getTheme('tournament-green'); // a bright, high-contrast board reads well at thumbnail size

/** A real preview of the game: its starting board, or an accent tile for the
 *  few games whose board isn't a simple grid (Backgammon, Dots, Quarto, Pentago). */
function GameThumb({ def }: { def: GameDefinition }) {
  const renderable = useMemo(() => {
    try { return def.getBoardView(def.createInitialState()).cells.length > 1; } catch { return false; }
  }, [def]);
  if (!renderable) {
    return <div className="gt-fallback" style={{ ['--accent' as any]: def.accent }}><span className="gt-emoji">{def.emoji}</span></div>;
  }
  return <div className="gt-fit"><MiniBoard def={def} theme={THUMB_THEME} /></div>;
}

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal')) as HTMLElement[];
    if (!('IntersectionObserver' in window) || !els.length) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '-5% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

export default function Games() {
  const nav = useNavigate();
  useReveal();
  const families = CATALOGUE.filter((e) => e.type === 'family').length;

  return (
    <div className="games-page">
      <header className="gp-top">
        <Link to="/" className="btn ghost sm">← Hub</Link>
        <div className="gs-title"><span className="gs-emoji">🎲</span><div className="col"><strong>Choose your game</strong><span className="faint" style={{ fontSize: 12 }}>{CATALOGUE.length} unique games · {families} with variants · each with a tutor</span></div></div>
        <Link to="/openings" className="btn sm hide-sm">📖 Openings</Link>
      </header>

      <div className="game-grid">
        {CATALOGUE.map((entry) => {
          const fam = entry.type === 'family' ? entry.family : null;
          const g = entry.type === 'family' ? entry.primary : entry.def;
          const name = fam ? fam.name : g.name;
          const category = fam ? fam.category : g.category;
          const tagline = fam ? fam.tagline : g.tagline;
          return (
            <div className="game-card glass reveal" key={fam ? `fam-${fam.id}` : g.id} style={{ ['--accent' as any]: g.accent }}>
              <Link to={`/play/${g.id}`} className="gc-thumb" aria-label={`Play ${name}`}>
                <GameThumb def={g} />
                <span className="chip gc-cat">{category}</span>
                {fam && <span className="chip gc-variants">{fam.variants.length} variants</span>}
              </Link>
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
    </div>
  );
}

function Depth({ depth }: { depth: number }) {
  return <span className="depth" title={`Depth ${depth} / 5`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= depth ? 'on' : ''} />)}</span>;
}
