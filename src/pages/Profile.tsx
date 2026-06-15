import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfile, ratingTitle, ACHIEVEMENTS } from '../profile/profile';
import { GAMES } from '../engine/registry';
import './Profile.css';

export default function Profile() {
  const p = useProfile();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const winRate = p.totals.played ? Math.round((p.totals.wins / p.totals.played) * 100) : 0;
  const playedGames = GAMES.filter((g) => p.stats[g.id]?.played);

  return (
    <div className="profile">
      <header className="pf-top">
        <Link to="/" className="btn ghost sm">← Hub</Link>
        <Link to="/puzzles" className="btn sm">🧩 Puzzles</Link>
      </header>

      <div className="pf-hero glass">
        <div className="pf-avatar">{(p.name || 'You').charAt(0).toUpperCase()}</div>
        <div className="pf-id">
          {editing ? (
            <form onSubmit={(e) => { e.preventDefault(); p.setName(draft.trim() || 'You'); setEditing(false); }} className="row gap-xs">
              <input className="pf-name-input" value={draft} maxLength={18} autoFocus onChange={(e) => setDraft(e.target.value)} />
              <button className="btn sm primary" type="submit">Save</button>
            </form>
          ) : (
            <h1 className="pf-name" onClick={() => { setDraft(p.name); setEditing(true); }} title="Click to rename">{p.name} ✎</h1>
          )}
          <div className="pf-rank">{ratingTitle(p.rating)}</div>
        </div>
        <div className="pf-rating">
          <div className="pf-rating-n">{p.rating}</div>
          <div className="pf-rating-l">rating</div>
        </div>
      </div>

      <div className="pf-totals">
        <Tot n={p.totals.played} l="played" />
        <Tot n={p.totals.wins} l="wins" tone="good" />
        <Tot n={p.totals.losses} l="losses" tone="bad" />
        <Tot n={p.totals.draws} l="draws" />
        <Tot n={`${winRate}%`} l="win rate" />
      </div>

      <section className="pf-section">
        <h2>By game</h2>
        {playedGames.length === 0 ? (
          <div className="pf-empty glass-soft">No games yet — <Link to="/play/chess" className="link">play one</Link> to start your record.</div>
        ) : (
          <div className="pf-games glass-soft">
            {playedGames.map((g) => {
              const s = p.stats[g.id];
              return (
                <div className="pf-grow" key={g.id}>
                  <span className="pf-gname">{g.emoji} {g.name}</span>
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
