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

export interface LobbyPeer { id: string; name: string; game: string; ts: number; }
export interface Invite { fromId: string; fromName: string; code: string; gameId: string; }
export type LobbyStatus = 'connecting' | 'online' | 'error' | 'offline';

export class Lobby {
  private client: any = null;
  readonly id = 'p-' + Math.random().toString(36).slice(2, 10);
  name = 'Player';
  game = 'chess';
  private peers = new Map<string, LobbyPeer>();
  private hb: any = null;
  private prune: any = null;
  onPeers: (peers: LobbyPeer[]) => void = () => {};
  onInvite: (inv: Invite) => void = () => {};
  onStatus: (s: LobbyStatus) => void = () => {};

  async connect(name: string, game: string) {
    this.name = name || 'Player';
    this.game = game;
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
      this.hb = setInterval(() => this.publishPresence(), 5000);
      this.prune = setInterval(() => this.pruneStale(), 4000);
    });
    this.client.on('error', () => this.onStatus('error'));
    this.client.on('close', () => this.onStatus('offline'));
    this.client.on('message', (topic: string, payload: Uint8Array) => {
      let msg: any;
      try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (topic === `${NS}/lobby`) {
        if (msg.id === this.id) return;
        if (msg.t === 'bye') this.peers.delete(msg.id);
        else this.peers.set(msg.id, { id: msg.id, name: msg.name, game: msg.game, ts: Date.now() });
        this.onPeers(this.list());
      } else if (topic === `${NS}/inv/${this.id}`) {
        this.onInvite(msg as Invite);
      }
    });
  }

  setGame(game: string) { this.game = game; this.publishPresence(); }
  setName(name: string) { this.name = name || 'Player'; this.publishPresence(); }

  /** Invite a player to a room you'll host under `code` for `gameId`. */
  invite(targetId: string, code: string, gameId: string) {
    this.client?.publish(`${NS}/inv/${targetId}`, JSON.stringify({ fromId: this.id, fromName: this.name, code, gameId }));
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
    this.onStatus('offline');
  }
}
