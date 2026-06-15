/**
 * Peer-to-peer online play over WebRTC via PeerJS's public broker — no backend
 * of our own. One player hosts (gets a room code), the other joins with it;
 * moves are relayed over the data channel and applied by both engines. Loaded
 * lazily and dynamically so it never runs during SSR/Node import.
 */
import type { DataConnection } from 'peerjs';

export type NetMsg =
  | { t: 'init'; gameId: string }
  | { t: 'move'; move: any }
  | { t: 'restart'; gameId: string }
  | { t: 'bye' };

export type NetStatus = 'idle' | 'waiting' | 'connected' | 'error' | 'closed';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(): string {
  let c = '';
  for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `GM-${c}`;
}

export class OnlineSession {
  private peer: any = null;
  private conn: DataConnection | null = null;
  role: 'host' | 'guest' = 'host';
  code = '';
  onMsg: (m: NetMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  /** Create a room; returns the code to share. */
  async host(): Promise<string> {
    this.role = 'host';
    this.code = genCode();
    this.onStatus('waiting');
    const { default: Peer } = await import('peerjs');
    this.peer = new Peer(this.code);
    this.peer.on('error', () => this.onStatus('error'));
    this.peer.on('connection', (conn: DataConnection) => this.bind(conn));
    return this.code;
  }

  /** Join an existing room by code. */
  async join(code: string): Promise<void> {
    this.role = 'guest';
    this.code = code.trim().toUpperCase();
    this.onStatus('waiting');
    const { default: Peer } = await import('peerjs');
    this.peer = new Peer();
    this.peer.on('error', () => this.onStatus('error'));
    this.peer.on('open', () => this.bind(this.peer.connect(this.code, { reliable: true })));
  }

  private bind(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => this.onStatus('connected'));
    conn.on('data', (d: unknown) => this.onMsg(d as NetMsg));
    conn.on('close', () => this.onStatus('closed'));
    conn.on('error', () => this.onStatus('error'));
  }

  send(m: NetMsg) { try { this.conn?.send(m); } catch { /* ignore */ } }
  close() { try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ } this.onStatus('closed'); }
}
