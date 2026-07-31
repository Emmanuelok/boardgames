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
  { n: '02', icon: '✦', title: 'Strategy DNA', promise: 'See transferable skill—not isolated ratings.', detail: 'Confidence-weighted concepts connect reviews, game results and learning activity.', to: '/intelligence?tab=dna', cta: 'Read my strategy DNA', color: '#5de0c0' },
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
  const profile = useProfile();
  const events = useLearningMemory((state) => state.events);
  const adventure = useAdventureStore();
  const community = useCommunityStore();
  const creator = useCreatorStore();
  const reviews = loadRecords();
  const chapters = Object.values(adventure.completed).reduce((sum, values) => sum + values.length, 0);
  const scans = readScanDraft() ? 1 : 0;
  const evidence = profile.totals.played + reviews.length + events.length;

  return (
    <div className="os-page">
      <header className="os-hero">
        <div className="os-orbit" aria-hidden="true"><i /><i /><i /></div>
        <div className="os-hero-copy">
          <span className="section-overline">GrandMaster Strategy OS · ten connected systems</span>
          <h1>Everything now learns from the same move.</h1>
          <p>Replay, coaching, campaigns, community, creation, physical boards, accessibility and offline play use one on-device evidence foundation in this browser. Nothing is a decorative destination.</p>
          <div className="os-actions"><Link className="btn primary lg glow" to="/intelligence">Open intelligence lab →</Link><Link className="btn lg" to="/adventures">Begin an adventure</Link></div>
        </div>
        <aside className="os-live glass-soft">
          <span><i /> On-device learner record ready</span>
          <div><strong>{evidence}</strong><small>evidence signals</small></div>
          <div><strong>{profile.totals.played}</strong><small>completed games</small></div>
          <div><strong>{reviews.length}</strong><small>saved reviews</small></div>
        </aside>
      </header>

      <section className="os-flow" aria-label="Connected platform flow">
        <span>Play</span><b>→</b><span>Replay</span><b>→</b><span>Strategy DNA</span><b>→</b><span>Transfer</span><b>→</b><span>Coach</span>
      </section>

      <section className="os-feature-head">
        <div><span className="section-overline">The complete expansion</span><h2>Ten features, one coherent platform.</h2></div>
        <p>Each surface states what evidence it uses, what remains on this device and which online abilities depend on a connection.</p>
      </section>
      <section className="os-grid">
        {FEATURES.map((feature) => (
          <article key={feature.n} style={{ '--os-color': feature.color } as CSSProperties}>
            <div className="os-card-top"><span>{feature.n}</span><i aria-hidden="true">{feature.icon}</i></div>
            <small>{feature.promise}</small>
            <h3>{feature.title}</h3>
            <p>{feature.detail}</p>
            <Link to={feature.to}>{feature.cta} <b>→</b></Link>
          </article>
        ))}
      </section>

      <section className="os-footprint">
        <div><span className="section-overline">Your current footprint</span><h2>The OS grows from real activity.</h2><p>These numbers are read from your saved platform state. They are never invented to make an empty dashboard look busy.</p></div>
        <div className="os-footprint-grid" role="list">
          <span role="listitem"><strong>{chapters}</strong><small>adventure chapters</small></span>
          <span role="listitem"><strong>{community.clubs.length}</strong><small>joined clubs</small></span>
          <span role="listitem"><strong>{community.tournaments.length}</strong><small>saved brackets</small></span>
          <span role="listitem"><strong>{creator.creations.length}</strong><small>authored creations</small></span>
          <span role="listitem"><strong>{scans}</strong><small>verified scan ready</small></span>
        </div>
      </section>
    </div>
  );
}
