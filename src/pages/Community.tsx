import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { GAMES, GAME_MAP } from '../engine/registry';
import Lobby from './Lobby';
import {
  CURATED_CLUBS,
  useCommunityStore,
  type Club,
  type Tournament,
} from '../community/communityStore';
import { bracketChampion, type TournamentFormat } from '../community/brackets';
import './Community.css';

type Tab = 'lobby' | 'clubs' | 'tournaments' | 'watch';
const STANDARD_GAMES = GAMES.filter((game) => !game.custom);

function nextWeekend(): string {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  date.setHours(15, 0, 0, 0);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export default function Community() {
  const [tab, setTab] = useState<Tab>('clubs');
  const community = useCommunityStore();
  const activeMatches = community.tournaments.flatMap((tournament) => tournament.bracket.rounds.flat()
    .filter((match) => match.status === 'ready')
    .map((match) => ({ tournament, match })));
  return (
    <div className="community-page">
      <header className="community-hero">
        <div>
          <span className="section-overline">Feature 6 · clubs, competitions and read-only watching</span>
          <h1>Strategy is better when the table remembers everyone.</h1>
          <p>Create focused clubs, schedule learning sessions, run transparent brackets and launch friendly P2P matches. Recognition is fixed and visible—there are no stakes, paid entry, odds or randomized rewards.</p>
          <div className="community-principles" role="list">
            <span role="listitem"><i /> Temporary public aliases</span>
            <span role="listitem"><i /> Friendly, unrated online play</span>
            <span role="listitem"><i /> Fixed badges only</span>
          </div>
        </div>
        <aside className="glass-soft">
          <small>Your community desk</small>
          <strong>{community.clubs.length}</strong><span>joined club{community.clubs.length === 1 ? '' : 's'}</span>
          <strong>{community.tournaments.length}</strong><span>saved bracket{community.tournaments.length === 1 ? '' : 's'}</span>
        </aside>
      </header>

      <nav className="community-tabs" aria-label="Community areas">
        {([
          ['lobby', '◎', 'Live lobby'],
          ['clubs', '◌', 'Clubs'],
          ['tournaments', '⌁', 'Tournaments'],
          ['watch', '◉', 'Watch desk'],
        ] as const).map(([id, icon, label]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <span aria-hidden="true">{icon}</span>{label}
          </button>
        ))}
      </nav>

      {tab === 'lobby' && <section className="community-panel community-lobby"><Lobby /></section>}
      {tab === 'clubs' && <ClubsPanel />}
      {tab === 'tournaments' && <TournamentsPanel />}
      {tab === 'watch' && <WatchPanel activeMatches={activeMatches} />}
    </div>
  );
}

function ClubsPanel() {
  const community = useCommunityStore();
  const [selected, setSelected] = useState(community.clubs[0]?.id ?? '');
  const [sessionTitle, setSessionTitle] = useState('Saturday strategy table');
  const [sessionGame, setSessionGame] = useState('chess');
  const [sessionTime, setSessionTime] = useState(nextWeekend);

  const join = (club: Omit<Club, 'joined' | 'sessions'>) => {
    community.joinClub(club);
    setSelected(club.id);
  };
  const schedule = () => {
    if (!selected || !sessionTime) return;
    community.scheduleSession(selected, {
      title: sessionTitle,
      gameId: sessionGame,
      startsAt: new Date(sessionTime).getTime(),
      durationMinutes: 45,
    });
  };

  return (
    <section className="community-panel">
      <div className="community-section-head">
        <div><span className="section-overline">Curated discovery</span><h2>Find a table built around how you want to improve.</h2></div>
        <span className="community-local-note">Saved on this device</span>
      </div>
      <div className="club-grid">
        {CURATED_CLUBS.map((club, index) => {
          const joined = community.clubs.some((item) => item.id === club.id);
          return (
            <article className="club-card" key={club.id} style={{ '--club-hue': `${165 + index * 58}` } as CSSProperties}>
              <span className="club-mark" aria-hidden="true">{['⬡', '♜', '◇'][index]}</span>
              <small>{club.focusGameIds.length} connected game worlds</small>
              <h3>{club.name}</h3>
              <p>{club.description}</p>
              <div className="club-games">
                {club.focusGameIds.map((gameId) => <span key={gameId}>{GAME_MAP[gameId]?.name ?? gameId}</span>)}
              </div>
              {joined
                ? <button className="btn sm" type="button" onClick={() => setSelected(club.id)}>Open my club</button>
                : <button className="btn primary sm" type="button" onClick={() => join(club)}>Join with invite code →</button>}
            </article>
          );
        })}
      </div>

      <div className="club-workspace">
        <div className="club-list">
          <span className="section-overline">My clubs</span>
          {community.clubs.length === 0 && <p className="muted">Join a curated table to schedule its first session.</p>}
          {community.clubs.map((club) => (
            <button type="button" className={selected === club.id ? 'on' : ''} key={club.id} onClick={() => setSelected(club.id)}>
              <strong>{club.name}</strong>
              <small>{club.inviteCode} · {club.sessions.length} sessions</small>
            </button>
          ))}
        </div>
        <div className="club-scheduler">
          <span className="section-overline">Session scheduler</span>
          <h3>Put a focused table on the calendar.</h3>
          <div className="community-form-grid">
            <label><span>Session</span><input value={sessionTitle} maxLength={80} onChange={(event) => setSessionTitle(event.target.value)} /></label>
            <label><span>Game</span><select value={sessionGame} onChange={(event) => setSessionGame(event.target.value)}>{GAMES.map((game) => <option value={game.id} key={game.id}>{game.name}</option>)}</select></label>
            <label><span>Local date &amp; time</span><input type="datetime-local" value={sessionTime} onChange={(event) => setSessionTime(event.target.value)} /></label>
          </div>
          <button className="btn primary" type="button" disabled={!selected || !sessionTitle.trim()} onClick={schedule}>Schedule club session</button>
          {selected && (
            <div className="club-sessions">
              {community.clubs.find((club) => club.id === selected)?.sessions.map((session) => (
                <article key={session.id}>
                  <span>{GAME_MAP[session.gameId]?.emoji}</span>
                  <div><strong>{session.title}</strong><small>{new Date(session.startsAt).toLocaleString()} · {session.durationMinutes} min</small></div>
                  <Link className="btn sm" to={`/play/${session.gameId}`}>Open board</Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TournamentsPanel() {
  const community = useCommunityStore();
  const [name, setName] = useState('Weekend Strategy Cup');
  const [gameId, setGameId] = useState('chess');
  const [format, setFormat] = useState<TournamentFormat>('knockout');
  const [players, setPlayers] = useState('Strategist North\nStrategist East\nStrategist South\nStrategist West');
  const [selectedId, setSelectedId] = useState(community.tournaments[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const selected = community.tournaments.find((tournament) => tournament.id === selectedId) ?? community.tournaments[0];

  const create = () => {
    const tournament = community.createTournament(name, gameId, format, players.split('\n'));
    if (!tournament) {
      setMessage(format === 'knockout' ? 'Use exactly 4 or 8 unique participant names.' : 'Use 3 to 8 unique participant names.');
      return;
    }
    setSelectedId(tournament.id);
    setMessage('Bracket created. Every pairing and result stays transparent.');
  };

  return (
    <section className="community-panel tournament-panel">
      <div className="tournament-builder">
        <span className="section-overline">Competition builder</span>
        <h2>Create a fair, transparent bracket.</h2>
        <p>Seed order is visible. Results advance deterministically. Recognition is a fixed platform badge—never a stake, entry fee or randomized prize.</p>
        <label><span>Name</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <div className="community-form-grid two">
          <label><span>Game</span><select value={gameId} onChange={(event) => setGameId(event.target.value)}>{STANDARD_GAMES.map((game) => <option value={game.id} key={game.id}>{game.name}</option>)}</select></label>
          <label><span>Format</span><select value={format} onChange={(event) => setFormat(event.target.value as TournamentFormat)}><option value="knockout">Single elimination · 4/8</option><option value="round-robin">Round robin · 3–8</option></select></label>
        </div>
        <label><span>Participants · one per line</span><textarea rows={7} value={players} onChange={(event) => setPlayers(event.target.value)} /></label>
        <button className="btn primary" type="button" onClick={create}>Generate transparent bracket →</button>
        {message && <p className="community-message" role="status">{message}</p>}
      </div>

      <div className="tournament-desk">
        <div className="tournament-picks" aria-label="Saved tournaments">
          {community.tournaments.map((tournament) => (
            <button type="button" className={selected?.id === tournament.id ? 'on' : ''} key={tournament.id} onClick={() => setSelectedId(tournament.id)}>
              <span>{GAME_MAP[tournament.gameId]?.emoji}</span><strong>{tournament.name}</strong><small>{tournament.status}</small>
            </button>
          ))}
        </div>
        {selected ? <Bracket tournament={selected} /> : (
          <div className="tournament-empty glass-soft"><span aria-hidden="true">⌁</span><h3>Your first bracket will appear here.</h3><p>Create a four-player knockout or a round robin to begin.</p></div>
        )}
      </div>
    </section>
  );
}

function Bracket({ tournament }: { tournament: Tournament }) {
  const reportResult = useCommunityStore((state) => state.reportResult);
  const champion = bracketChampion(tournament.bracket);
  return (
    <div className="bracket">
      <div className="bracket-head">
        <div><small>{GAME_MAP[tournament.gameId]?.name} · {tournament.format}</small><h3>{tournament.name}</h3></div>
        <span>{champion ? `🏅 ${champion.name}` : tournament.fixedRecognition}</span>
      </div>
      <div className="bracket-rounds">
        {tournament.bracket.rounds.map((round, index) => (
          <section key={index}>
            <h4>{tournament.format === 'knockout' && index === tournament.bracket.rounds.length - 1
              ? 'Final'
              : `Round ${index + 1}`}</h4>
            {round.map((match) => (
              <article className={`bracket-match ${match.status}`} key={match.id}>
                {[match.playerA, match.playerB].map((player, playerIndex) => (
                  <button
                    type="button"
                    disabled={!player || match.status !== 'ready'}
                    className={match.winnerId === player?.id ? 'winner' : ''}
                    key={player?.id ?? `empty-${playerIndex}`}
                    onClick={() => player && reportResult(tournament.id, match.id, player.id)}
                    title={match.status === 'ready' ? `Record ${player?.name} as winner` : undefined}
                  >
                    <span>{player ? `#${player.seed}` : '—'}</span>
                    <strong>{player?.name ?? 'Awaiting winner'}</strong>
                    {match.status === 'complete' && (
                      <b>{playerIndex === 0 ? match.scoreA : match.scoreB}</b>
                    )}
                  </button>
                ))}
                {tournament.format === 'round-robin' && match.status === 'ready' && (
                  <button
                    className="bracket-draw"
                    type="button"
                    onClick={() => reportResult(tournament.id, match.id, null)}
                    title="Record this pairing as a verified draw"
                  >
                    Record draw
                  </button>
                )}
                <small>{match.status === 'complete'
                  ? match.winnerId === null ? 'Draw recorded' : 'Result recorded'
                  : match.status === 'ready'
                    ? tournament.format === 'round-robin' ? 'Select the verified winner or record a draw' : 'Select the verified winner'
                    : 'Waiting for earlier result'}</small>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function WatchPanel({ activeMatches }: { activeMatches: Array<{ tournament: Tournament; match: Tournament['bracket']['rounds'][number][number] }> }) {
  const watchable = activeMatches.filter(({ tournament }) => !GAME_MAP[tournament.gameId]?.custom);
  return (
    <section className="community-panel watch-panel">
      <div className="community-section-head">
        <div><span className="section-overline">Read-only watch desk</span><h2>Follow a match without touching the board.</h2></div>
        <Link className="btn primary" to="/lobby">Find a live opponent</Link>
      </div>
      <div className="watch-explainer">
        <div><span aria-hidden="true">◉</span><strong>Validated snapshots</strong><p>A viewer receives serialized board states, never gameplay controls.</p></div>
        <div><span aria-hidden="true">⌁</span><strong>Monotonic sequence</strong><p>Old or oversized updates are rejected before rendering.</p></div>
        <div><span aria-hidden="true">◌</span><strong>Temporary rooms</strong><p>Broadcasts are ephemeral and use public strategy aliases.</p></div>
      </div>
      {watchable.length > 0 ? (
        <div className="watch-grid">
          {watchable.map(({ tournament, match }) => {
            const room = `${tournament.id}-${match.id}`.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 48);
            return (
              <article key={`${tournament.id}:${match.id}`}>
                <img src={`/assets/game-thumbnails/${tournament.gameId}.webp`} alt="" loading="lazy" />
                <small>{tournament.name}</small>
                <h3>{match.playerA?.name} <i>vs</i> {match.playerB?.name}</h3>
                <p>{GAME_MAP[tournament.gameId]?.name} · read-only room</p>
                <div>
                  <Link className="btn sm" to={`/watch/${room}?game=${tournament.gameId}`}>Open watch room</Link>
                  <Link className="btn sm primary" to={`/play/${tournament.gameId}?broadcast=${room}`}>Host broadcast</Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="watch-empty glass-soft">
          <span aria-hidden="true">◉</span>
          <h3>No watchable bracket match is ready yet.</h3>
          <p>Create a standard-game tournament and its ready pairings will appear here with host and viewer links.</p>
        </div>
      )}
    </section>
  );
}
