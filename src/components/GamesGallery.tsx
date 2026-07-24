import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATALOGUE } from '../engine/registry';
import type { GameDefinition } from '../engine/types';
import MiniBoard from './MiniBoard';
import { getTheme } from '../themes/boardThemes';
import '../pages/Games.css';

const THUMB_THEME = getTheme('tournament-green'); // a bright, high-contrast board reads well at thumbnail size
export const GAME_CATEGORIES = ['All', ...Array.from(new Set(CATALOGUE.map((entry) => (
  entry.type === 'family' ? entry.family.category : entry.def.category
))))];

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

interface GamesGalleryProps {
  limit?: number;
  filters?: boolean;
  headingLevel?: 'h2' | 'h3';
  initialCategory?: string;
  category?: string;
  onCategoryChange?: (category: string) => void;
}

export default function GamesGallery({
  limit,
  filters = false,
  headingLevel = 'h3',
  initialCategory = 'All',
  category: controlledCategory,
  onCategoryChange,
}: GamesGalleryProps) {
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [internalCategory, setInternalCategory] = useState(() => (
    GAME_CATEGORIES.includes(initialCategory) ? initialCategory : 'All'
  ));
  const category = controlledCategory && GAME_CATEGORIES.includes(controlledCategory)
    ? controlledCategory
    : internalCategory;
  const CardHeading = headingLevel;

  useEffect(() => {
    if (controlledCategory === undefined && GAME_CATEGORIES.includes(initialCategory)) {
      setInternalCategory(initialCategory);
    }
  }, [controlledCategory, initialCategory]);

  const selectCategory = (nextCategory: string) => {
    if (!GAME_CATEGORIES.includes(nextCategory)) return;
    if (controlledCategory === undefined) setInternalCategory(nextCategory);
    onCategoryChange?.(nextCategory);
  };

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = CATALOGUE.filter((entry) => {
      const fam = entry.type === 'family' ? entry.family : null;
      const game = entry.type === 'family' ? entry.primary : entry.def;
      const entryCategory = fam ? fam.category : game.category;
      if (category !== 'All' && entryCategory !== category) return false;
      if (!needle) return true;
      const haystack = [
        fam?.name, fam?.tagline, game.name, game.tagline, entryCategory,
        ...(fam?.variants.map((variant) => variant.label) ?? []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    return typeof limit === 'number' && !filters ? matching.slice(0, limit) : matching;
  }, [category, filters, limit, query]);

  return (
    <>
      {filters && (
        <div className="game-tools" role="search" aria-label="Search and filter the game catalogue">
          <div className="game-search">
            <label className="game-search-label" htmlFor="game-catalogue-search">Search games</label>
            <span aria-hidden="true">⌕</span>
            <input
              id="game-catalogue-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by game, family or idea…"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </div>
          <div className="game-categories" role="group" aria-label="Filter by category">
            {GAME_CATEGORIES.map((item) => (
              <button
                type="button"
                key={item}
                className={category === item ? 'on' : ''}
                aria-pressed={category === item}
                onClick={() => selectCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <span className="game-result-count" aria-live="polite">{entries.length} world{entries.length === 1 ? '' : 's'}</span>
        </div>
      )}
      {entries.length ? <div className="game-grid">
      {entries.map((entry) => {
        const fam = entry.type === 'family' ? entry.family : null;
        const g = entry.type === 'family' ? entry.primary : entry.def;
        const name = fam ? fam.name : g.name;
        const category = fam ? fam.category : g.category;
        const tagline = fam ? fam.tagline : g.tagline;
        return (
          <article className="game-card glass" key={fam ? `fam-${fam.id}` : g.id} style={{ ['--accent' as any]: g.accent }}>
            <button type="button" className="gc-thumb" onClick={() => nav(`/play/${g.id}`)} aria-label={`Play ${name}`}>
              <GameThumb def={g} />
              <span className="chip gc-cat">{category}</span>
              {fam && <span className="chip gc-variants">{fam.variants.length} variants</span>}
            </button>
            <div className="gc-body">
              <CardHeading className="gc-name">{g.emoji} {name}</CardHeading>
              <p className="gc-tag">{tagline}</p>
              <div className="gc-meta"><Depth depth={g.depth} /><span className="faint">{fam ? fam.variants.map((v) => v.label.split(' · ')[0]).join(' · ') : `${g.players[0].name} v ${g.players[1].name}`}</span></div>
              <div className="gc-actions">
                <button type="button" className="btn primary sm" onClick={() => nav(`/play/${g.id}`)}>Play</button>
                <button type="button" className="btn sm" onClick={() => nav(`/learn/${g.id}`)}>Learn</button>
              </div>
            </div>
          </article>
        );
      })}
      </div> : (
        <div className="game-empty glass-soft">
          <span>⌕</span>
          <h2>No game matches that search</h2>
          <p>Try a family such as chess, connection, territory or classic.</p>
          <button className="btn" type="button" onClick={() => { setQuery(''); selectCategory('All'); }}>Reset filters</button>
        </div>
      )}
    </>
  );
}

function Depth({ depth }: { depth: number }) {
  const label = `Strategy depth ${depth} out of 5`;
  return <span className="depth" role="img" aria-label={label} title={label}>{[1, 2, 3, 4, 5].map((i) => <i aria-hidden="true" key={i} className={i <= depth ? 'on' : ''} />)}</span>;
}
