import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lobby, type LobbyPeer, type Invite, type LobbyStatus } from '../net/lobby';
import { genRoomCode } from '../net/online';
import { useProfile, ratingTitle } from '../profile/profile';
import { GAMES, getGame } from '../engine/registry';
import './Lobby.css';

const ONLINE_GAMES = GAMES.filter((g) => !g.custom);

export default function LobbyPage() {
  const nav = useNavigate();
  const name = useProfile((p) => p.name);
  const rating = useProfile((p) => p.rating);
  const lobbyRef = useRef<Lobby | null>(null);
  const [peers, setPeers] = useState<LobbyPeer[]>([]);
  const [status, setStatus] = useState<LobbyStatus>('connecting');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [game, setGame] = useState('chess');

  useEffect(() => {
    const lobby = new Lobby();
    lobbyRef.current = lobby;
    lobby.onPeers = setPeers;
    lobby.onStatus = setStatus;
    lobby.onInvite = (inv) => setInvite(inv);
    lobby.connect(name, game);
    return () => lobby.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { lobbyRef.current?.setGame(game); }, [game]);
  useEffect(() => { lobbyRef.current?.setName(name); }, [name]);

  const challenge = (peer: LobbyPeer) => {
    const code = genRoomCode();
    lobbyRef.current?.invite(peer.id, code, game);
    nav(`/play/${game}?host=${code}`);
  };
  const accept = () => { if (invite) nav(`/play/${invite.gameId}?join=${invite.code}`); };

  return (
    <div className="lobby">
      <header className="lobby-top">
        <div className="gs-title"><span className="gs-emoji">🌐</span><div className="col"><strong>Live Lobby</strong><span className="faint" style={{ fontSize: 12 }}>Find players online &amp; challenge them</span></div></div>
        <span className={`lobby-status ${status}`}>● {status === 'online' ? 'Online' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'Offline (no broker)' : 'Offline'}</span>
      </header>

      <div className="lobby-you glass">
        <div className="pf-avatar sm">{(name || 'Y').charAt(0).toUpperCase()}</div>
        <div className="col" style={{ flex: 1 }}>
          <strong>{name} <span className="faint" style={{ fontWeight: 400, fontSize: 13 }}>· {ratingTitle(rating)} ({rating})</span></strong>
          <span className="faint" style={{ fontSize: 12 }}>You appear to others as “{name}”. Edit on your <Link to="/profile" className="link">profile</Link>.</span>
        </div>
        <div className="lobby-game-pick">
          <span className="faint" style={{ fontSize: 12, marginRight: 6 }}>I want to play</span>
          <select value={game} onChange={(e) => setGame(e.target.value)} className="lobby-select">
            {ONLINE_GAMES.map((g) => <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>)}
          </select>
        </div>
      </div>

      <h2 className="lobby-h">Players online <span className="faint" style={{ fontSize: 15, fontWeight: 400 }}>· {peers.length}</span></h2>
      {status !== 'online' ? (
        <div className="lobby-empty glass-soft">
          {status === 'connecting' ? 'Connecting to the lobby…'
            : 'Could not reach the lobby broker. The lobby needs ordinary internet (it’s blocked in some sandboxes). You can still play a friend via an invite link from any game’s Setup → Online.'}
        </div>
      ) : peers.length === 0 ? (
        <div className="lobby-empty glass-soft">No one else here yet. Keep this open, share the link, and players will appear as they join.</div>
      ) : (
        <div className="lobby-list">
          {peers.map((p) => (
            <div className="lobby-peer glass-soft" key={p.id}>
              <span className="lobby-dot" />
              <div className="col" style={{ flex: 1 }}>
                <strong>{p.name}</strong>
                <span className="faint" style={{ fontSize: 12 }}>wants to play {getGame(p.game)?.emoji} {getGame(p.game)?.name ?? p.game}</span>
              </div>
              <button className="btn sm primary" onClick={() => challenge(p)}>Challenge → {getGame(game)?.name}</button>
            </div>
          ))}
        </div>
      )}

      {invite && (
        <div className="modal-backdrop" onClick={() => setInvite(null)}>
          <div className="glass invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="invite-emoji">⚔️</div>
            <h3 style={{ margin: '4px 0' }}>{invite.fromName} challenges you!</h3>
            <p className="muted">A game of <strong>{getGame(invite.gameId)?.name ?? invite.gameId}</strong> awaits.</p>
            <div className="row gap-sm" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button className="btn primary" onClick={accept}>Accept &amp; play</button>
              <button className="btn ghost" onClick={() => setInvite(null)}>Decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
