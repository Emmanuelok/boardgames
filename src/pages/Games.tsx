import { useSearchParams } from 'react-router-dom';
import GamesGallery, { GAME_CATEGORIES } from '../components/GamesGallery';
import { CATALOGUE_WORLD_COUNT, GAME_COUNT } from '../engine/catalogueMeta';
import './Games.css';

const WORLD_COPY: Record<string, { mark: string; description: string }> = {
  Strategy: { mark: '♜', description: 'Long plans, pressure and purposeful trade-offs.' },
  Classic: { mark: '◇', description: 'Enduring rules with immediate strategic tension.' },
  Abstract: { mark: '⬡', description: 'Pure patterns, connection, territory and tempo.' },
  Family: { mark: '✦', description: 'Related variants gathered into one playable world.' },
};

function categoryFromParam(value: string | null): string {
  if (!value) return 'All';
  return GAME_CATEGORIES.find((category) => category.toLowerCase() === value.toLowerCase()) ?? 'All';
}

export default function Games() {
  const [searchParams, setSearchParams] = useSearchParams();
  const category = categoryFromParam(searchParams.get('category'));

  const updateCategory = (nextCategory: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextCategory === 'All') next.delete('category');
    else next.set('category', nextCategory.toLowerCase());
    setSearchParams(next, { replace: true });
  };

  const chooseWorld = (nextCategory: string) => {
    updateCategory(nextCategory);
    requestAnimationFrame(() => {
      document.getElementById('game-catalogue')?.scrollIntoView({ block: 'start' });
    });
  };

  return (
    <div className="games-page discover-page">
      <header className="discover-head discover-hero">
        <img
          className="discover-art"
          src="/assets/strategy-worlds.webp"
          alt=""
          width="1600"
          height="854"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="discover-veil" />
        <div className="discover-copy">
          <span className="section-overline">The strategy library</span>
          <h1>Find the board that teaches your next idea.</h1>
          <p>{GAME_COUNT} complete game engines organized into {CATALOGUE_WORLD_COUNT} discoverable worlds—from royal strategy and territory to connection, alignment, capture and race games.</p>
          <ul className="discover-facts" aria-label="Catalogue features">
            <li><b>{GAME_COUNT}</b> playable engines</li>
            <li><b>2D + 3D</b> adaptive boards</li>
            <li><b>Every move</b> explained</li>
            <li><b>Every game</b> has a course</li>
          </ul>
        </div>
        <div className="discover-worlds" role="group" aria-label="Browse strategy categories">
          <button type="button" className={category === 'All' ? 'on' : ''} aria-pressed={category === 'All'} onClick={() => chooseWorld('All')}>
            <span aria-hidden="true">◎</span><strong>All worlds</strong><small>{CATALOGUE_WORLD_COUNT} places to begin</small>
          </button>
          {GAME_CATEGORIES.filter((item) => item !== 'All').map((item) => {
            const world = WORLD_COPY[item] ?? { mark: '◫', description: 'A distinct family of strategic ideas.' };
            return (
              <button type="button" key={item} className={category === item ? 'on' : ''} aria-pressed={category === item} onClick={() => chooseWorld(item)}>
                <span aria-hidden="true">{world.mark}</span><strong>{item}</strong><small>{world.description}</small>
              </button>
            );
          })}
        </div>
      </header>
      <section id="game-catalogue" className="discover-catalogue" aria-label={`${category} game worlds`}>
        <GamesGallery filters headingLevel="h2" category={category} onCategoryChange={updateCategory} />
      </section>
    </div>
  );
}
