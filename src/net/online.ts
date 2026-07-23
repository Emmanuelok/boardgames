/**
 * Peer-to-peer online play over WebRTC via PeerJS's public broker — no backend
 * of our own. One player hosts (gets a room code), the other joins with it;
 * moves are relayed over the data channel and applied by both engines. Loaded
 * lazily and dynamically so it never runs during SSR/Node import.
 */
import type { DataConnection } from 'peerjs';

export type NetMsg =
  | { t: 'init'; gameId: string }
  | { t: 'move'; move: unknown }
  | { t: 'state'; state: unknown } // full authoritative state sync (bespoke games, e.g. backgammon dice)
  | { t: 'restart'; gameId: string }
  | { t: 'chat'; text: string }
  | { t: 'bye' };

export type NetStatus = 'idle' | 'waiting' | 'connected' | 'error' | 'closed';

export const QUICK_CHAT_PHRASES = [
  'Hello!',
  'Good move!',
  'Nice idea.',
  'I need a moment.',
  'Well played!',
  'Thanks for the game!',
] as const;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE = /^GM-[A-HJ-NP-Z2-9]{5}$/;
const GAME_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_INVALID_MESSAGES = 8;
const QUICK_CHAT_SET = new Set<string>(QUICK_CHAT_PHRASES);

export function genRoomCode(): string {
  let c = '';
  const bytes = new Uint8Array(5);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (const byte of bytes) c += ALPHABET[byte % ALPHABET.length];
  return `GM-${c}`;
}

export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return ROOM_CODE.test(code) ? code : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafePlainData(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  budget.nodes++;
  if (budget.nodes > 256 || depth > 4) return false;
  if (value == null || typeof value === 'boolean' || typeof value === 'undefined') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 512;
  if (Array.isArray(value)) {
    return value.length <= 128 && value.every((item) => isSafePlainData(item, depth + 1, budget));
  }
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length <= 32 && keys.every((key) => key.length <= 64 && isSafePlainData(value[key], depth + 1, budget));
}

function isMove(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 256
    && Number.isSafeInteger(value.to)
    && (value.to as number) >= -1
    && (value.to as number) <= 4096
    && typeof value.notation === 'string'
    && value.notation.length <= 512
    && isSafePlainData(value);
}

/** State messages are currently reserved for Backgammon's authoritative sync. */
function safeBackgammonState(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const { points, bar, off, turn, dice } = value;
  if (!Array.isArray(points) || points.length !== 24
    || !points.every((n) => Number.isInteger(n) && n >= -15 && n <= 15)) return null;
  if (!Array.isArray(bar) || bar.length !== 2
    || !bar.every((n) => Number.isInteger(n) && n >= 0 && n <= 15)) return null;
  if (!Array.isArray(off) || off.length !== 2
    || !off.every((n) => Number.isInteger(n) && n >= 0 && n <= 15)) return null;
  if (turn !== 0 && turn !== 1) return null;
  if (!Array.isArray(dice) || dice.length > 4
    || !dice.every((n) => Number.isInteger(n) && n >= 1 && n <= 6)) return null;

  const white = points.reduce((sum, n) => sum + Math.max(0, n), 0) + bar[0] + off[0];
  const black = points.reduce((sum, n) => sum + Math.max(0, -n), 0) + bar[1] + off[1];
  if (white !== 15 || black !== 15) return null;

  return {
    points: points.slice(),
    bar: [bar[0], bar[1]],
    off: [off[0], off[1]],
    turn,
    dice: dice.slice(),
  };
}

/** Parse and sanitize the untrusted value received from the peer data channel. */
export function parseNetMsg(value: unknown): NetMsg | null {
  if (!isRecord(value) || typeof value.t !== 'string') return null;
  if (value.t === 'init' || value.t === 'restart') {
    return typeof value.gameId === 'string' && GAME_ID.test(value.gameId)
      ? { t: value.t, gameId: value.gameId }
      : null;
  }
  if (value.t === 'move') {
    return isMove(value.move) ? { t: 'move', move: { ...value.move } } : null;
  }
  if (value.t === 'state') {
    const state = safeBackgammonState(value.state);
    return state ? { t: 'state', state } : null;
  }
  if (value.t === 'chat') {
    if (typeof value.text !== 'string') return null;
    const text = value.text.trim();
    return QUICK_CHAT_SET.has(text) ? { t: 'chat', text } : null;
  }
  return value.t === 'bye' ? { t: 'bye' } : null;
}

export class OnlineSession {
  private peer: any = null;
  private conn: DataConnection | null = null;
  private generation = 0;
  private closed = true;
  private invalidMessages = 0;
  role: 'host' | 'guest' = 'host';
  code = '';
  onMsg: (m: NetMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};

  /** Create a room; returns the code to share. Pass a code to host a specific room. */
  async host(code?: string): Promise<string> {
    this.role = 'host';
    const requestedCode = typeof code === 'string' ? normalizeRoomCode(code) : null;
    const generation = this.begin();
    if (typeof code === 'string' && !requestedCode) {
      this.code = '';
      this.fail(generation);
      return '';
    }
    this.code = requestedCode || genRoomCode();
    this.onStatus('waiting');
    try {
      const { default: Peer } = await import('peerjs');
      if (!this.isActive(generation)) return '';
      const peer = new Peer(this.code);
      this.peer = peer;
      peer.on('error', () => this.fail(generation));
      peer.on('connection', (conn: DataConnection) => this.bind(conn, generation));
      return this.code;
    } catch {
      this.fail(generation);
      return '';
    }
  }

  /** Join an existing room by code. */
  async join(code: string): Promise<void> {
    this.role = 'guest';
    const normalized = normalizeRoomCode(code);
    const generation = this.begin();
    if (!normalized) {
      this.code = '';
      this.fail(generation);
      return;
    }
    this.code = normalized;
    this.onStatus('waiting');
    try {
      const { default: Peer } = await import('peerjs');
      if (!this.isActive(generation)) return;
      const peer = new Peer();
      this.peer = peer;
      peer.on('error', () => this.fail(generation));
      peer.on('open', () => {
        if (!this.isActive(generation) || this.peer !== peer) return;
        try {
          this.bind(peer.connect(this.code, { reliable: true }), generation);
        } catch {
          this.fail(generation);
        }
      });
    } catch {
      this.fail(generation);
    }
  }

  private begin(): number {
    this.generation++;
    this.disposeTransport();
    this.closed = false;
    this.invalidMessages = 0;
    return this.generation;
  }

  private isActive(generation: number): boolean {
    return !this.closed && generation === this.generation;
  }

  private bind(conn: DataConnection, generation: number) {
    if (!this.isActive(generation) || this.conn) {
      try { conn.close(); } catch { /* ignore */ }
      return;
    }
    this.conn = conn;
    const isCurrent = () => this.isActive(generation) && this.conn === conn;
    conn.on('open', () => { if (isCurrent()) this.onStatus('connected'); });
    conn.on('data', (data: unknown) => {
      if (!isCurrent()) return;
      const message = parseNetMsg(data);
      if (!message) {
        this.invalidMessages++;
        if (this.invalidMessages >= MAX_INVALID_MESSAGES) this.fail(generation);
        return;
      }
      this.invalidMessages = 0;
      try {
        this.onMsg(message);
      } catch {
        this.fail(generation);
      }
    });
    conn.on('close', () => {
      if (!isCurrent()) return;
      this.conn = null;
      this.onStatus('closed');
    });
    conn.on('error', () => { if (isCurrent()) this.fail(generation); });
  }

  private fail(generation: number): void {
    if (!this.isActive(generation)) return;
    const notify = this.onStatus;
    this.closed = true;
    this.generation++;
    this.disposeTransport();
    notify('error');
  }

  private disposeTransport(): void {
    const conn = this.conn;
    const peer = this.peer;
    this.conn = null;
    this.peer = null;
    try { (conn as any)?.removeAllListeners?.(); } catch { /* ignore */ }
    try { conn?.close(); } catch { /* ignore */ }
    try { peer?.removeAllListeners?.(); } catch { /* ignore */ }
    try { peer?.destroy(); } catch { /* ignore */ }
  }

  send(message: NetMsg): void {
    if (this.closed || !this.conn?.open) return;
    const safe = parseNetMsg(message);
    if (!safe) return;
    try { this.conn.send(safe); } catch { this.fail(this.generation); }
  }

  close(): void {
    if (this.closed && !this.conn && !this.peer) return;
    const notify = this.onStatus;
    this.closed = true;
    this.generation++;
    this.disposeTransport();
    notify('closed');
  }
}
