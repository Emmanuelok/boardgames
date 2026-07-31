import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Board2D from '../components/Board2D';
import { GAME_MAP } from '../engine/registry';
import { getTheme, DEFAULT_THEME_ID } from '../themes/boardThemes';
import {
  normalizeWatchRoom,
  SpectatorWatcher,
  type SpectatorConnectionStatus,
  type SpectatorSnapshot,
} from '../community/spectator';
import './Spectate.css';

export default function Spectate() {
  const { broadcastId } = useParams();
  const [params] = useSearchParams();
  const roomId = normalizeWatchRoom(broadcastId);
  const fallbackGame = GAME_MAP[params.get('game') ?? ''] && !GAME_MAP[params.get('game')!].custom ? params.get('game')! : 'chess';
  const [status, setStatus] = useState<SpectatorConnectionStatus>('connecting');
  const [snapshot, setSnapshot] = useState<SpectatorSnapshot | null>(null);
  const theme = getTheme(DEFAULT_THEME_ID);

  useEffect(() => {
    if (!roomId) { setStatus('error'); return; }
    const watcher = new SpectatorWatcher();
    watcher.onStatus = setStatus;
    watcher.onSnapshot = setSnapshot;
    void watcher.connect(roomId);
    return () => watcher.close();
  }, [roomId]);

  const def = GAME_MAP[snapshot?.gameId ?? fallbackGame];
  const state = useMemo(() => {
    if (!def) return null;
    try { return snapshot ? def.deserialize(snapshot.serializedState) : def.createInitialState(); }
    catch { return def.createInitialState(); }
  }, [def, snapshot]);
  if (!roomId || !def || def.custom || !state) {
    return <div className="spectate-page"><section className="watch-error glass"><h1>Watch room unavailable</h1><p>This room id or game is not supported.</p><Link className="btn primary" to="/community">Return to community</Link></section></div>;
  }
  const view = def.getBoardView(state);
  const turn = def.getTurn(state);
  const liveStatus = def.getStatus(state);

  return (
    <div className="spectate-page">
      <header className="spectate-head">
        <Link className="btn ghost sm" to="/community">← Community</Link>
        <div><span className="section-overline">Read-only spectator room</span><h1>{def.name} broadcast</h1></div>
        <span className={`spectate-status ${status}`} role="status"><i />{status === 'online' ? snapshot ? 'Live position' : 'Waiting for host' : status}</span>
      </header>
      <div className="spectate-layout">
        <section className="spectate-board">
          <Board2D
            def={def}
            view={view}
            theme={theme}
            turn={turn}
            flipped={false}
            selected={null}
            targets={[]}
            lastMove={snapshot?.lastMove ?? null}
            status={liveStatus}
            hint={null}
            onCell={() => {}}
            readOnly
          />
          <p className="spectate-lock">Read-only view · board controls are disabled</p>
        </section>
        <aside className="spectate-panel glass-soft">
          <span className="section-overline">Room {roomId}</span>
          <h2>{snapshot ? 'Following the live sequence' : 'The table is ready.'}</h2>
          <p>{snapshot
            ? `Update ${snapshot.sequence} passed engine validation. ${def.players[turn].name} is to move.`
            : 'Ask the host to open this game with the matching broadcast link. The first validated position will appear automatically.'}</p>
          <div className="spectate-integrity">
            <span><b>✓</b> No move controls</span>
            <span><b>✓</b> Engine-deserialized state</span>
            <span><b>✓</b> Old sequence rejection</span>
            <span><b>✓</b> Bounded public payload</span>
          </div>
          <h3>Recent moves</h3>
          {snapshot?.moves.length ? <ol className="spectate-moves">{snapshot.moves.slice(-12).map((move, index) => <li key={`${snapshot.sequence}-${index}`}>{move}</li>)}</ol> : <p className="muted">No moves received yet.</p>}
          <Link className="btn primary" to={`/play/${def.id}`}>Open my own board</Link>
        </aside>
      </div>
    </div>
  );
}
