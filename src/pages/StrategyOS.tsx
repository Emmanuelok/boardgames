import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { loadRecords } from '../engine/reviewSummary';
import { useProfile } from '../profile/profile';
import { useLearningMemory } from '../intelligence/learningMemory';
import { useAdventureStore } from '../adventures/adventureStore';
import { useCommunityStore } from '../community/communityStore';
import { useCreatorStore } from '../creator/creations';
import { readScanDraft } from '../scanner/positionDraft';
import './StrategyOS.css';

interface Feature {
  n: string;
  icon: string;
  title: string;
  promise: string;
  detail: string;
  to: string;
  cta: string;
  color: string;
}

const FEATURES: Feature[] = [
  { n: '01', icon: '⌁', title: 'Replay Lab', promise: 'Turn completed games into inspectable evidence.', detail: 'Scrub saved positions, annotate decisions and generate focused practice from turning points.', to: '/intelligence?tab=replay', cta: 'Open replay lab', color: '#8e79ff' },
  { n: '02', icon: '✦', title: 'Strategy DNA', promise: 'See observed strategy patterns—not isolated ratings.', detail: 'Confidence-weighted concepts connect reviews, game results and learning activity.', to: '/intelligence?tab=dna', cta: 'Read my strategy DNA', color: '#5de0c0' },
  { n: '03', icon: '⇄', title: 'Cross-game Training', promise: 'Learn an idea here and test it somewhere new.', detail: 'Concept overlap produces clear source-board, bridge-board and transfer-board pathways.', to: '/intelligence?tab=transfer', cta: 'Build a transfer route', color: '#65b9ff' },
  { n: '04', icon: '◉', title: 'Explainable Coach', promise: 'Recommendations show their evidence and purpose.', detail: 'Review-aware briefings explain what to notice, why it matters and where to practise next.', to: '/intelligence?tab=coach', cta: 'Ask the coach', color: '#f3c66e' },
  { n: '05', icon: '⬡', title: 'Adventure Campaigns', promise: 'Carry one concept through three complete worlds.', detail: 'Nine chapters use the real observe, learn, practise, play and reflect evidence loop.', to: '/adventures', cta: 'Choose an expedition', color: '#ff77b3' },
  { n: '06', icon: '◎', title: 'Clubs & Tournaments', promise: 'Organize friendly tables and transparent brackets.', detail: 'Local-first clubs, scheduled sessions, deterministic pairings, P2P launch and read-only rooms.', to: '/community', cta: 'Enter the community', color: '#63dfbe' },
  { n: '07', icon: '◇', title: 'Creator Studio', promise: 'Make safe, engine-validated learning experiences.', detail: 'Author puzzle packs, guided courses and challenge positions without executable scripts.', to: '/creator', cta: 'Create an experience', color: '#a78bfa' },
  { n: '08', icon: '▣', title: 'Physical-board Scanner', promise: 'Bring an actual tabletop position into the workspace.', detail: 'Private on-device image sampling, confidence signals and a correction grid before saving.', to: '/scanner', cta: 'Scan a position', color: '#61c6ff' },
  { n: '09', icon: '◐', title: 'Accessibility Suite', promise: 'Let the platform adapt to the player.', detail: 'Theme, contrast, colour-vision, text, spacing, motion and piece-pattern preferences.', to: '/settings', cta: 'Personalize access', color: '#ffad66' },
  { n: '10', icon: '↓', title: 'Offline-first PWA', promise: 'Install the strategy school and keep learning offline.', detail: 'App-shell caching, offline state, safe update prompts and downloadable local content.', to: '/settings#offline', cta: 'Prepare offline access', color: '#78e2c4' },
];

export default function StrategyOS() {
  const completedGames = useProfile((state) => state.totals.played);
  const learningEvents = useLearningMemory((state) => state.events.length);
  const chapters = useAdventureStore((state) =>
    Object.values(state.completed).reduce((sum, values) => sum + values.length, 0));
  const clubCount = useCommunityStore((state) => state.clubs.length);
  const tournamentCount = useCommunityStore((state) => state.tournaments.length);
  const creationCount = useCreatorStore((state) => state.creations.length);
  const [reviews] = useState(loadRecords);
  const [scans] = useState(() => readScanDraft() ? 1 : 0);
  const evidence = completedGames + reviews.length + learningEvents;

  return (
    <div className="os-page">
      <header className="os-hero">
        <div className="os-orbit" aria-hidden="true"><i /><i /><i /></div>
        <div className="os-hero-copy">
          <span className="section-overline">GrandMaster Strategy OS · ten connected systems</span>
          <h1>Everything now connects around the same evidence.</h1>
          <p>Replay and coaching share on-device play evidence in this browser. Campaigns, community, creation, physical boards, accessibility and offline play connect through shared routes and local state. Nothing here is presented as a finished feature unless it is usable.</p>
          <div className="os-actions"><Link className="btn primary lg glow" to="/intelligence">Open intelligence lab →</Link><Link className="btn lg" to="/mind-games/cascade">Play Mind Cascade</Link><Link className="btn lg" to="/adventures">Begin an adventure</Link></div>
        </div>
        <aside className="os-live glass-soft" aria-label="On-device activity summary">
          <span><i aria-hidden="true" /> On-device play record ready</span>
          <div><strong>{evidence}</strong><small>recorded activity items</small></div>
          <div><strong>{completedGames}</strong><small>completed games</small></div>
          <div><strong>{reviews.length}</strong><small>saved reviews</small></div>
        </aside>
      </header>

      <section className="os-flow" aria-label="Connected platform flow">
        <span>Play</span><b aria-hidden="true">→</b><span>Replay</span><b aria-hidden="true">→</b><span>Strategy DNA</span><b aria-hidden="true">→</b><span>Transfer</span><b aria-hidden="true">→</b><span>Coach</span>
      </section>

      <section className="os-mind-game" aria-labelledby="os-mind-game-title">
        <div>
          <span className="section-overline">The next original strategy layer · now playable</span>
          <h2 id="os-mind-game-title">Strategy now has an original experimental playground.</h2>
          <p>Mind Cascade is the first game created specifically for GrandMaster’s learner model. It records in-game signals such as planning intervals, sequencing, objective efficiency and cascade depth on deterministic boards, then explains the evidence behind the next challenge.</p>
          <p className="os-scope-note">These signals describe play inside Mind Cascade. They are not an IQ, aptitude or general-intelligence assessment.</p>
          <div className="os-mind-signals" role="list" aria-label="Mind Cascade design principles">
            <span role="listitem"><b>Forecastable</b><small>Ranked swaps with reasons</small></span>
            <span role="listitem"><b>Reproducible</b><small>Seeded daily boards</small></span>
            <span role="listitem"><b>Transparent</b><small>Between-round adaptation</small></span>
          </div>
          <Link className="btn primary lg" to="/mind-games/cascade">Enter Mind Cascade →</Link>
        </div>
        <div className="os-mind-diagram" aria-hidden="true">
          <span>Observe</span><b>01</b><i />
          <span>Forecast</span><b>02</b><i />
          <span>Commit</span><b>03</b><i />
          <span>Explain</span><b>04</b>
        </div>
      </section>

      <section className="os-features" aria-labelledby="os-features-title">
        <div className="os-feature-head">
          <div><span className="section-overline">The complete expansion</span><h2 id="os-features-title">Ten features, one coherent platform.</h2></div>
          <p>Each surface states what evidence it uses, what remains on this device and which online abilities depend on a connection.</p>
        </div>
        <div className="os-grid">
          {FEATURES.map((feature) => (
            <article key={feature.n} style={{ '--os-color': feature.color } as CSSProperties}>
              <div className="os-card-top"><span>{feature.n}</span><i aria-hidden="true">{feature.icon}</i></div>
              <small>{feature.promise}</small>
              <h3>{feature.title}</h3>
              <p>{feature.detail}</p>
              <Link to={feature.to}>{feature.cta} <b aria-hidden="true">→</b></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="os-footprint" aria-labelledby="os-footprint-title">
        <div><span className="section-overline">Your current footprint</span><h2 id="os-footprint-title">The OS grows from real activity.</h2><p>These numbers are read from your saved platform state. They are never invented to make an empty dashboard look busy.</p></div>
        <div className="os-footprint-grid" role="list" aria-label="Saved platform activity">
          <span role="listitem"><strong>{chapters}</strong><small>adventure chapters</small></span>
          <span role="listitem"><strong>{clubCount}</strong><small>joined clubs</small></span>
          <span role="listitem"><strong>{tournamentCount}</strong><small>saved brackets</small></span>
          <span role="listitem"><strong>{creationCount}</strong><small>authored creations</small></span>
          <span role="listitem"><strong>{scans}</strong><small>saved scan draft</small></span>
        </div>
      </section>
    </div>
  );
}
