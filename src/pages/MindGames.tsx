import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DIFFICULTY_LABELS,
  buildMindCascadeSkillProfile,
  getMindCascadeDailyChallenge,
} from '../mindgames/intelligence';
import { loadMindCascadeProgress } from '../mindgames/progress';
import './MindGames.css';

const PREVIEW_GLYPHS = ['◇', '○', '△', '⬡', '◇', '△', '○', '⬡', '○', '△', '◇', '⬡', '△', '◇', '○', '⬡'];

const RESEARCH_GAMES = [
  {
    name: 'Vector Weave',
    concept: 'Network planning',
    detail: 'Route limited signals through a changing graph while preserving future connections.',
    mark: '⌁',
  },
  {
    name: 'Proof Garden',
    concept: 'Constraint reasoning',
    detail: 'Grow a valid geometric system where every placement must satisfy visible logical rules.',
    mark: '⌬',
  },
  {
    name: 'Signal Fold',
    concept: 'Spatial foresight',
    detail: 'Fold paths across a compact field and predict how one transformation changes the whole board.',
    mark: '⌑',
  },
] as const;

export default function MindGames() {
  const [progress] = useState(() => loadMindCascadeProgress());
  const daily = useMemo(() => getMindCascadeDailyChallenge(), []);
  const profile = useMemo(
    () => buildMindCascadeSkillProfile(progress.performanceHistory),
    [progress.performanceHistory],
  );
  const resume = progress.resumableSession;

  return (
    <div className="mind-games-page">
      <header className="mind-games-hero">
        <div className="mind-games-orbit" aria-hidden="true"><i /><i /><i /></div>
        <div className="mind-games-hero-copy">
          <span className="section-overline">GrandMaster originals · intelligent games laboratory</span>
          <h1>Games built to reveal how a plan develops.</h1>
          <p>These are original, deliberate strategy experiences built around reproducible positions, visible objectives and explainable adaptation. Your game record stays on this device and describes only evidence observed here.</p>
          <div className="mind-games-actions">
            <Link className="btn primary lg glow" to="/mind-games/cascade">Play Mind Cascade →</Link>
            {resume ? <Link className="btn lg" to="/mind-games/cascade?resume=1">Resume saved board</Link> : null}
          </div>
        </div>
        <aside className="mind-games-ledger glass-soft" aria-label="Mind Games activity">
          <span><i aria-hidden="true" /> Local strategy evidence</span>
          <div><strong>{progress.totalCompletedSessions}</strong><small>completed sessions</small></div>
          <div><strong>{progress.replays.length}</strong><small>saved replays</small></div>
          <div><strong>{progress.achievements.length}</strong><small>fixed milestones</small></div>
        </aside>
      </header>

      <section className="mind-games-flagship" aria-labelledby="mind-cascade-title">
        <div className="mind-games-board-shell" aria-hidden="true">
          <div className="mind-games-board-top"><span>Seed {daily.seed}</span><b>{DIFFICULTY_LABELS[daily.difficulty]}</b></div>
          <div className="mind-games-board">
            {PREVIEW_GLYPHS.map((glyph, index) => <i key={`${glyph}-${index}`} data-tone={index % 5}>{glyph}</i>)}
          </div>
          <div className="mind-games-board-foot"><span>Forecast</span><b>B3 → C3</b><small>Sequence progress + setup value</small></div>
        </div>
        <div className="mind-games-flagship-copy">
          <span className="section-overline">Flagship game 01 · playable now</span>
          <h2 id="mind-cascade-title">Mind Cascade</h2>
          <p className="mind-games-lede">A strategy-cascade puzzle where every swap is a commitment. Build patterns, satisfy linked objectives and preserve future choices inside a limited move allowance.</p>
          <div className="mind-games-pillars" role="list">
            <article role="listitem"><span>01</span><h3>Read</h3><p>Inspect a seeded position with no hidden board changes.</p></article>
            <article role="listitem"><span>02</span><h3>Forecast</h3><p>Compare legal candidates and see which objective each advances.</p></article>
            <article role="listitem"><span>03</span><h3>Commit</h3><p>Spend a move, resolve deterministic cascades and preserve the replay.</p></article>
            <article role="listitem"><span>04</span><h3>Reflect</h3><p>Receive evidence-linked coaching and a reversible next difficulty.</p></article>
          </div>
          <div className="mind-games-actions">
            <Link className="btn primary lg" to="/mind-games/cascade">Start a designed path</Link>
            <Link className="btn lg" to="/mind-games/cascade?daily=1">Play today’s deterministic seed</Link>
          </div>
          <p className="mind-games-safety">No pressure timer, purchasable lives, loot boxes or randomized rewards. Progress comes from completed play and reflection, not spending.</p>
        </div>
      </section>

      <section className="mind-games-profile" aria-labelledby="mind-games-profile-title">
        <div>
          <span className="section-overline">Transparent skill evidence</span>
          <h2 id="mind-games-profile-title">A profile that shows when evidence is missing.</h2>
          <p>{profile.disclaimer}</p>
        </div>
        <div className="mind-games-skill-grid">
          {profile.skills.map((skill) => {
            const evidenceId = `mind-games-${skill.id}-evidence`;
            const isMeasured = skill.evidenceCount > 0;
            return (
              <article key={skill.id}>
                <div>
                  <strong>{skill.label}</strong>
                  <span>{isMeasured ? `${skill.score}/100` : 'Unmeasured'}</span>
                </div>
                <progress
                  max="100"
                  value={isMeasured ? skill.score : undefined}
                  aria-label={`${skill.label}: ${isMeasured ? `${skill.score} out of 100` : 'unmeasured'}`}
                  aria-describedby={evidenceId}
                />
                <small id={evidenceId}>
                  {isMeasured
                    ? `${skill.evidenceCount} recorded observation${skill.evidenceCount === 1 ? '' : 's'} · ${skill.confidence}% confidence`
                    : 'No score yet. Complete a session to create local play evidence.'}
                </small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mind-games-daily" aria-labelledby="mind-games-daily-title">
        <div>
          <span className="section-overline">Same date · same position · fully reproducible</span>
          <h2 id="mind-games-daily-title">Today’s deterministic challenge</h2>
          <p>The local calendar date creates one deterministic seed on your device. Players opening the same date receive the same starting logic, and replay remains possible without a network.</p>
        </div>
        <div className="mind-games-daily-card">
          <span>{daily.dateKey}</span>
          <strong>{DIFFICULTY_LABELS[daily.difficulty]}</strong>
          <small>Seed {daily.seed} · ruleset {daily.rulesetVersion.replace('mind-cascade-', '')}</small>
          <Link className="btn primary" to="/mind-games/cascade?daily=1">Solve today’s board →</Link>
        </div>
      </section>

      <section className="mind-games-research" aria-labelledby="mind-games-research-title">
        <div className="mind-games-section-head">
          <div><span className="section-overline">Original game pipeline</span><h2 id="mind-games-research-title">What the laboratory explores next.</h2></div>
          <p>These concepts are clearly marked as research directions, not pretend destinations. Mind Cascade is the complete playable release.</p>
        </div>
        <div className="mind-games-research-grid">
          {RESEARCH_GAMES.map((game) => (
            <article key={game.name}>
              <span aria-hidden="true">{game.mark}</span>
              <small>Design research · {game.concept}</small>
              <h3>{game.name}</h3>
              <p>{game.detail}</p>
              <b>Concept under development</b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
