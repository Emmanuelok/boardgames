/**
 * Live lobby over a public MQTT broker (no backend of our own): players
 * broadcast presence and can challenge each other. Accepting a challenge sends
 * both players to the same room code, where the existing PeerJS layer
 * establishes the actual P2P game. Lazy/dynamic import keeps it SSR-safe.
 *
 * Note: relies on a public broker, so it needs ordinary internet to work.
 */
const BROKER = 'wss://broker.emqx.io:8084/mqtt';
const NS = 'grandmaster/v1';
const PEER_ID = /^p-[a-z0-9]{8}$/;
const GAME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOM_CODE = /^GM-[A-Z0-9]{5}$/;
const MAX_PEERS = 120;
const MAX_MESSAGE_BYTES = 2_048;

function validGame(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && GAME_ID.test(value);
}

/** Public lobbies deliberately use temporary handles instead of profile names. */
export function lobbyAlias(id: string): string {
  const suffix = id.replace(/^p-/, '').slice(-4).toUpperCase();
  return `Strategist ${suffix || 'GUEST'}`;
}

export interface LobbyPeer { id: string; name: string; game: string; ts: number; }
export interface Invite { fromId: string; fromName: string; code: string; gameId: string; }
export type LobbyStatus = 'connecting' | 'online' | 'error' | 'offline';

export class Lobby {
  private client: any = null;
  readonly id = 'p-' + Math.random().toString(36).slice(2, 10);
  name = lobbyAlias(this.id);
  game = 'chess';
  private peers = new Map<string, LobbyPeer>();
  private hb: any = null;
  private prune: any = null;
  onPeers: (peers: LobbyPeer[]) => void = () => {};
  onInvite: (inv: Invite) => void = () => {};
  onStatus: (s: LobbyStatus) => void = () => {};

  async connect(_profileName: string, game: string) {
    this.name = lobbyAlias(this.id);
    if (validGame(game)) this.game = game;
    this.onStatus('connecting');
    try {
      const mqtt: any = await import('mqtt');
      this.client = (mqtt.default ?? mqtt).connect(BROKER, { connectTimeout: 9000, reconnectPeriod: 5000, clean: true });
    } catch { this.onStatus('error'); return; }

    this.client.on('connect', () => {
      this.onStatus('online');
      this.client.subscribe(`${NS}/lobby`);
      this.client.subscribe(`${NS}/inv/${this.id}`);
      this.publishPresence();
      clearInterval(this.hb);
      clearInterval(this.prune);
      this.hb = setInterval(() => this.publishPresence(), 5000);
      this.prune = setInterval(() => this.pruneStale(), 4000);
    });
    this.client.on('error', () => this.onStatus('error'));
    this.client.on('close', () => this.onStatus('offline'));
    this.client.on('message', (topic: string, payload: Uint8Array) => {
      if (payload.byteLength > MAX_MESSAGE_BYTES) return;
      let msg: any;
      try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (topic === `${NS}/lobby`) {
        if (!msg || !PEER_ID.test(msg.id) || msg.id === this.id) return;
        if (msg.t === 'bye') this.peers.delete(msg.id);
        else {
          if (!validGame(msg.game)) return;
          if (!this.peers.has(msg.id) && this.peers.size >= MAX_PEERS) return;
          this.peers.set(msg.id, { id: msg.id, name: lobbyAlias(msg.id), game: msg.game, ts: Date.now() });
        }
        this.onPeers(this.list());
      } else if (topic === `${NS}/inv/${this.id}`) {
        if (!msg || !PEER_ID.test(msg.fromId) || !ROOM_CODE.test(msg.code) || !validGame(msg.gameId)) return;
        this.onInvite({ fromId: msg.fromId, fromName: lobbyAlias(msg.fromId), code: msg.code, gameId: msg.gameId });
      }
    });
  }

  setGame(game: string) { if (validGame(game)) { this.game = game; this.publishPresence(); } }
  /** Profile names stay local; the public lobby always uses the session alias. */
  setName(_name: string) { this.name = lobbyAlias(this.id); }

  /** Invite a player to a room you'll host under `code` for `gameId`. */
  invite(targetId: string, code: string, gameId: string) {
    const normalizedCode = code.trim().toUpperCase();
    if (!PEER_ID.test(targetId) || !ROOM_CODE.test(normalizedCode) || !validGame(gameId)) return;
    this.client?.publish(`${NS}/inv/${targetId}`, JSON.stringify({ fromId: this.id, code: normalizedCode, gameId }));
  }

  private publishPresence() {
    this.client?.publish(`${NS}/lobby`, JSON.stringify({ id: this.id, name: this.name, game: this.game, ts: Date.now() }));
  }
  private pruneStale() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) if (now - p.ts > 16000) { this.peers.delete(id); changed = true; }
    if (changed) this.onPeers(this.list());
  }
  list(): LobbyPeer[] { return [...this.peers.values()].sort((a, b) => a.name.localeCompare(b.name)); }

  disconnect() {
    try {
      this.client?.publish(`${NS}/lobby`, JSON.stringify({ id: this.id, t: 'bye' }));
      clearInterval(this.hb); clearInterval(this.prune);
      this.client?.end(true);
    } catch { /* ignore */ }
    this.client = null;
    this.peers.clear();
    this.onPeers([]);
    this.onStatus('offline');
  }
}
