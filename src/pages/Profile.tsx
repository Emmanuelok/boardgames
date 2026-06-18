import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfile, ratingTitle, ACHIEVEMENTS } from '../profile/profile';
import { useProgression, levelFromXp, levelTier, questDef, cosmetic } from '../progression/progression';
import { GAMES, getGame } from '../engine/registry';
import './Profile.css';

const readJSON = (k: string): any => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };

// Rating bands → a progress bar toward the next rank.
const BANDS: [number, number, string][] = [
  [0, 600, 'Novice'], [600, 900, 'Casual'], [900, 1200, 'Club'],
  [1200, 1500, 'Expert'], [1500, 1800, 'Master'], [1800, 2200, 'Grandmaster'],
];

export default function Profile() {
  const p = useProfile();
  const prog = useProgression();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const winRate = p.totals.played ? Math.round((p.totals.wins / p.totals.played) * 100) : 0;

  // Progression / economy view-model.
  const { level, into, span } = levelFromXp(prog.xp);
  const tier = levelTier(level);
  const xpPct = Math.round((into / span) * 100);
  const frameColor = cosmetic(prog.equipped.frame || '')?.value || '';
  const titleText = cosmetic(prog.equipped.title || '')?.value || '';

  const playedGames = useMemo(
    () => GAMES.filter((g) => p.stats[g.id]?.played).sort((a, b) => (p.stats[b.id].played - p.stats[a.id].played)),
    [p.stats],
  );

  // Highlights: most-played game and best win-rate (min 3 games).
  const favorite = playedGames[0];
  const topGame = useMemo(() => {
    let best: { id: string; wr: number } | null = null;
    for (const g of playedGames) {
      const s = p.stats[g.id];
      if (s.played < 3) continue;
      const wr = s.wins / s.played;
      if (!best || wr > best.wr) best = { id: g.id, wr };
    }
    return best;
  }, [playedGames, p.stats]);

  // Training data lives in its own localStorage keys.
  const daily = readJSON('gm-daily');
  const puzzles = readJSON('gm-puzzles');
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dailyStreak = daily.lastDate === today || daily.lastDate === yesterday ? (daily.streak || 0) : 0;

  const band = BANDS.find(([lo, hi]) => p.rating >= lo && p.rating < hi) ?? BANDS[BANDS.length - 1];
  const [lo, hi, label] = band;
  const isMax = label === 'Grandmaster';
  const progress = isMax ? 1 : (p.rating - lo) / (hi - lo);
  const toNext = isMax ? 0 : hi - p.rating;
  const nextLabel = isMax ? '' : BANDS[BANDS.indexOf(band) + 1][2];

  return (
    <div className="profile">
      <header className="pf-top">
        <div className="row gap-xs">
          <Link to="/daily" className="btn sm">📅 Daily</Link>
          <Link to="/puzzles" className="btn sm">🧩 Puzzles</Link>
        </div>
      </header>

      <div className="pf-hero glass">
        <div className="pf-avatar" style={frameColor ? { boxShadow: `0 0 0 3px ${frameColor}, 0 8px 22px -8px ${frameColor}` } : undefined}>{(p.name || 'You').charAt(0).toUpperCase()}</div>
        <div className="pf-id">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); p.setName(draft.trim() || 'You'); setEditing(false); }} className="row gap-xs">
              <input className="pf-name-input" value={draft} maxLength={18} autoFocus onChange={(e) => setDraft(e.target.value)} />
              <button className="btn sm primary" type="submit">Save</button>
            </form>
          ) : (
            <h1 className="pf-name" onClick={() => { setDraft(p.name); setEditing(true); }} title="Click to rename">{p.name} ✎</h1>
          )}
          <div className="pf-rank">{ratingTitle(p.rating)}{titleText && <span className="pf-title-chip">{titleText}</span>}{prog.pro && <span className="pf-pro-chip">PRO</span>}</div>
          <div className="pf-progress" title={isMax ? 'Top rank reached' : `${toNext} rating to ${nextLabel}`}>
            <div className="pf-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="pf-progress-l">{isMax ? 'Top rank reached 👑' : `${toNext} to ${nextLabel}`}</div>
        </div>
        <div className="pf-rating">
          <div className="pf-rating-n">{p.rating}</div>
          <div className="pf-rating-l">rating</div>
        </div>
      </div>

      <div className="pf-level glass-soft">
        <div className="pf-lvl-badge"><span className="pf-lvl-ic">{tier.icon}</span><span className="pf-lvl-n">Lv {level}</span></div>
        <div className="pf-lvl-mid">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>{tier.name}</strong>
            <span className="faint" style={{ fontSize: 12.5 }}>{into} / {span} XP to Lv {level + 1}</span>
          </div>
          <div className="pf-lvl-bar"><div style={{ width: `${xpPct}%` }} /></div>
        </div>
        <div className="pf-lvl-coins"><span className="pf-coins-n">🪙 {prog.coins.toLocaleString()}</span><Link to="/shop" className="btn sm">🛍 Shop</Link></div>
      </div>

      <section className="pf-section">
        <h2>Daily Quests <span className="faint" style={{ fontSize: 14, fontWeight: 400 }}>· resets at midnight</span></h2>
        <div className="pf-quests">
          {prog.quests.map((q) => {
            const d = questDef(q.id);
            if (!d) return null;
            const complete = q.progress >= d.goal;
            const qpct = Math.min(100, Math.round((q.progress / d.goal) * 100));
            return (
              <div className={`pf-quest glass-soft ${complete ? 'done' : ''}`} key={q.id}>
                <span className="pf-q-ic">{d.icon}</span>
                <div className="col grow">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <strong>{d.label}</strong>
                    <span className="faint" style={{ fontSize: 12.5 }}>{Math.min(q.progress, d.goal)}/{d.goal}</span>
                  </div>
                  <div className="pf-q-bar"><div style={{ width: `${qpct}%` }} /></div>
                </div>
                <span className="pf-q-reward">{d.reward.xp > 0 ? `+${d.reward.xp} XP · ` : ''}🪙{d.reward.coins}</span>
                {q.claimed ? <span className="pf-q-claimed">✓ Claimed</span>
                  : complete ? <button className="btn sm primary" onClick={() => prog.claimQuest(q.id)}>Claim</button>
                  : <span className="pf-q-go faint">In progress</span>}
              </div>
            );
          })}
        </div>
      </section>

      <div className="pf-totals">
        <Tot n={p.totals.played} l="played" />
        <Tot n={p.totals.wins} l="wins" tone="good" />
        <Tot n={p.totals.losses} l="losses" tone="bad" />
        <Tot n={p.totals.draws} l="draws" />
        <Tot n={`${winRate}%`} l="win rate" />
      </div>

      {(favorite || topGame || dailyStreak > 0) && (
        <div className="pf-highlights">
          {favorite && <Highlight icon={getGame(favorite.id)?.emoji || '🎮'} label="Most played" value={getGame(favorite.id)?.name || favorite.id} sub={`${p.stats[favorite.id].played} games`} />}
          {topGame && <Highlight icon={getGame(topGame.id)?.emoji || '🏆'} label="Best game" value={getGame(topGame.id)?.name || topGame.id} sub={`${Math.round(topGame.wr * 100)}% win rate`} />}
          <Highlight icon="🔥" label="Daily streak" value={`${dailyStreak} day${dailyStreak === 1 ? '' : 's'}`} sub={`best ${daily.best || 0}`} />
        </div>
      )}

      <section className="pf-section">
        <h2>Training</h2>
        <div className="pf-train">
          <Link to="/daily" className="pf-train-card glass-soft">
            <span className="pf-train-ic">📅</span>
            <div className="col">
              <strong>Daily Challenge</strong>
              <span className="faint" style={{ fontSize: 12.5 }}>🔥 {dailyStreak} streak · {daily.total || 0} solved · best {daily.best || 0}</span>
            </div>
            <span className="pf-train-go">→</span>
          </Link>
          <Link to="/puzzles" className="pf-train-card glass-soft">
            <span className="pf-train-ic">🧩</span>
            <div className="col">
              <strong>Puzzle Trainer</strong>
              <span className="faint" style={{ fontSize: 12.5 }}>{puzzles.solved || 0} solved · best streak {puzzles.best || 0}</span>
            </div>
            <span className="pf-train-go">→</span>
          </Link>
          <Link to="/reviews" className="pf-train-card glass-soft">
            <span className="pf-train-ic">🗂</span>
            <div className="col">
              <strong>Game Reviews</strong>
              <span className="faint" style={{ fontSize: 12.5 }}>Revisit recent games — accuracy & eval</span>
            </div>
            <span className="pf-train-go">→</span>
          </Link>
        </div>
      </section>

      <section className="pf-section">
        <h2>By game <span className="faint" style={{ fontSize: 14, fontWeight: 400 }}>· {playedGames.length} played</span></h2>
        {playedGames.length === 0 ? (
          <div className="pf-empty glass-soft">No games yet — <Link to="/play/chess" className="link">play one</Link> to start your record.</div>
        ) : (
          <div className="pf-games glass-soft">
            {playedGames.map((g) => {
              const s = p.stats[g.id];
              const wr = s.played ? Math.round((s.wins / s.played) * 100) : 0;
              return (
                <div className="pf-grow" key={g.id}>
                  <span className="pf-gname">{g.emoji} {g.name}</span>
                  <div className="pf-wr">
                    <div className="pf-wr-bar"><span style={{ width: `${wr}%` }} /></div>
                    <span className="pf-wr-n">{wr}%</span>
                  </div>
                  <span className="pf-record"><b className="good">{s.wins}W</b> · <b className="bad">{s.losses}L</b> · {s.draws}D</span>
                  <Link className="btn sm" to={`/play/${g.id}`}>Play</Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="pf-section">
        <h2>Achievements <span className="faint" style={{ fontSize: 14, fontWeight: 400 }}>· {p.achievements.length}/{ACHIEVEMENTS.length}</span></h2>
        <div className="pf-achievements">
          {ACHIEVEMENTS.map((a) => {
            const got = p.achievements.includes(a.id);
            return (
              <div className={`pf-ach ${got ? 'got' : 'locked'}`} key={a.id} title={a.desc}>
                <span className="pf-ach-ic">{got ? a.icon : '🔒'}</span>
                <div className="col">
                  <strong>{a.title}</strong>
                  <span className="faint" style={{ fontSize: 12 }}>{a.desc}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <button className="btn ghost sm pf-reset" onClick={() => { if (confirm('Reset all stats and achievements?')) p.reset(); }}>Reset profile</button>
    </div>
  );
}

function Tot({ n, l, tone }: { n: number | string; l: string; tone?: 'good' | 'bad' }) {
  return <div className="pf-tot"><div className={`pf-tot-n ${tone ?? ''}`}>{n}</div><div className="pf-tot-l">{l}</div></div>;
}

function Highlight({ icon, label, value, sub }: { icon: string; label: string; value: string; sub: string }) {
  return (
    <div className="pf-hi glass-soft">
      <span className="pf-hi-ic">{icon}</span>
      <div className="col">
        <span className="pf-hi-label">{label}</span>
        <strong className="pf-hi-value">{value}</strong>
        <span className="faint" style={{ fontSize: 12 }}>{sub}</span>
      </div>
    </div>
  );
}
