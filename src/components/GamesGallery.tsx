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

/** Curated, full-bleed photographs for every world in the public catalogue. */
export const GAME_THUMBNAILS: Record<string, string> = {
  chess: '/assets/game-thumbnails/chess.webp',
  tafl: '/assets/game-thumbnails/tafl.webp',
  draughts: '/assets/game-thumbnails/checkers-draughts.webp',
  alquerque: '/assets/game-thumbnails/alquerque.webp',
  breakthrough: '/assets/game-thumbnails/breakthrough.webp',
  'fox-and-hounds': '/assets/game-thumbnails/fox-and-hounds.webp',
  'nine-mens-morris': '/assets/game-thumbnails/nine-mens-morris.webp',
  'three-mens-morris': '/assets/game-thumbnails/three-mens-morris.webp',
  'mu-torere': '/assets/game-thumbnails/mu-torere.webp',
  backgammon: '/assets/game-thumbnails/backgammon.webp',
  'dots-and-boxes': '/assets/game-thumbnails/dots-and-boxes.webp',
  pentago: '/assets/game-thumbnails/pentago.webp',
  quarto: '/assets/game-thumbnails/quarto.webp',
  tally: '/assets/game-thumbnails/tally.webp',
  squava: '/assets/game-thumbnails/squava.webp',
  'order-and-chaos': '/assets/game-thumbnails/order-and-chaos.webp',
  ultimate: '/assets/game-thumbnails/ultimate-tic-tac-toe.webp',
  surakarta: '/assets/game-thumbnails/surakarta.webp',
  cohesion: '/assets/game-thumbnails/cohesion.webp',
  domineering: '/assets/game-thumbnails/domineering.webp',
  reversi: '/assets/game-thumbnails/reversi.webp',
  'lines-of-action': '/assets/game-thumbnails/lines-of-action.webp',
  konane: '/assets/game-thumbnails/konane.webp',
  clobber: '/assets/game-thumbnails/clobber.webp',
  teeko: '/assets/game-thumbnails/teeko.webp',
  'five-field-kono': '/assets/game-thumbnails/five-field-kono.webp',
  amazons: '/assets/game-thumbnails/amazons.webp',
  'n-in-a-row': '/assets/game-thumbnails/n-in-a-row.webp',
  mancala: '/assets/game-thumbnails/mancala.webp',
  go: '/assets/game-thumbnails/go.webp',
  hex: '/assets/game-thumbnails/hex.webp',
  hexapawn: '/assets/game-thumbnails/hexapawn.webp',
};

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

function GameThumb({ def, thumbnailKey }: { def: GameDefinition; thumbnailKey: string }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const thumbnail = GAME_THUMBNAILS[thumbnailKey];
  const renderable = useMemo(() => {
    try { return def.getBoardView(def.createInitialState()).cells.length > 1; } catch { return false; }
  }, [def]);
  if (thumbnail) {
    return (
      <div ref={ref} className="gt-photo-frame">
        <img
          className="gt-photo"
          src={thumbnail}
          alt=""
          width="1280"
          height="853"
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }
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
        const thumbnailKey = fam?.id ?? g.id;
        return (
          <article className="game-card glass" key={fam ? `fam-${fam.id}` : g.id} style={{ ['--accent' as any]: g.accent }}>
            <button type="button" className="gc-thumb" onClick={() => nav(`/play/${g.id}`)} aria-label={`Play ${name}`}>
              <GameThumb def={g} thumbnailKey={thumbnailKey} />
              <span className="chip gc-cat">{category}</span>
              {fam && <span className="chip gc-variants">{fam.variants.length} variants</span>}
            </button>
            <div className="gc-body">
              <CardHeading className="gc-name">{name}</CardHeading>
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
