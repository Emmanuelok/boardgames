import GamesGallery from '../components/GamesGallery';
import { CATALOGUE_WORLD_COUNT, GAME_COUNT } from '../engine/catalogueMeta';
import './Games.css';

export default function Games() {
  return (
    <div className="games-page discover-page">
      <header className="discover-head">
        <span className="section-overline">The strategy library</span>
        <h1>Find the board that teaches your next idea.</h1>
        <p>{GAME_COUNT} complete game engines organized into {CATALOGUE_WORLD_COUNT} discoverable worlds—from royal strategy and territory to connection, alignment, capture and race games.</p>
        <ul className="discover-facts" aria-label="Catalogue features">
          <li><b>{GAME_COUNT}</b> playable engines</li>
          <li><b>2D + 3D</b> adaptive boards</li>
          <li><b>Every move</b> explained</li>
          <li><b>Every game</b> has a course</li>
        </ul>
      </header>
      <GamesGallery filters headingLevel="h2" />
    </div>
  );
}
