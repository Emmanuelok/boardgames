import { GAME_MAP } from '../engine/registry';
import type { GameStatus } from '../engine/types';

const BROKER = 'wss://broker.emqx.io:8084/mqtt';
const NAMESPACE = 'grandmaster/v1/watch';
const ROOM = /^[A-Z0-9-]{4,64}$/;
const MAX_MESSAGE_BYTES = 220_000;

export interface SpectatorSnapshot {
  version: 1;
  roomId: string;
  sequence: number;
  gameId: string;
  serializedState: string;
  status: GameStatus;
  lastMove: { from?: number; to: number; affected?: number[] } | null;
  moves: string[];
  sentAt: number;
}

export type SpectatorConnectionStatus = 'connecting' | 'online' | 'offline' | 'error';
export type SpectatorHostStatus = 'connecting' | 'live' | 'offline' | 'error';

export function normalizeWatchRoom(value: string | null | undefined): string | null {
  const room = (value ?? '').trim().toUpperCase();
  return ROOM.test(room) ? room : null;
}

function safeLastMove(value: unknown): SpectatorSnapshot['lastMove'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const to = Number(raw.to);
  if (!Number.isInteger(to) || to < -1 || to > 20_000) return null;
  const from = Number(raw.from);
  const affected = Array.isArray(raw.affected)
    ? raw.affected.filter((cell): cell is number => Number.isInteger(cell) && cell >= 0 && cell <= 20_000).slice(0, 400)
    : undefined;
  return {
    ...(Number.isInteger(from) && from >= 0 && from <= 20_000 ? { from } : {}),
    to,
    ...(affected?.length ? { affected } : {}),
  };
}

export function validateSpectatorSnapshot(value: unknown, expectedRoom?: string): SpectatorSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const roomId = normalizeWatchRoom(typeof raw.roomId === 'string' ? raw.roomId : null);
  const gameId = typeof raw.gameId === 'string' ? raw.gameId : '';
  const def = GAME_MAP[gameId];
  if (raw.version !== 1 || !roomId || (expectedRoom && roomId !== expectedRoom) || !def || def.custom) return null;
  const sequence = Number(raw.sequence);
  const serializedState = typeof raw.serializedState === 'string' ? raw.serializedState : '';
  if (!Number.isSafeInteger(sequence) || sequence < 0 || serializedState.length === 0 || serializedState.length > 180_000) return null;
  let status: GameStatus;
  try {
    const state = def.deserialize(serializedState);
    def.getBoardView(state);
    status = def.getStatus(state);
  } catch {
    return null;
  }
  const moves = Array.isArray(raw.moves)
    ? raw.moves.filter((move): move is string => typeof move === 'string').map((move) => move.slice(0, 180)).slice(-24)
    : [];
  const sentAt = typeof raw.sentAt === 'number' && Number.isFinite(raw.sentAt) ? Math.floor(raw.sentAt) : 0;
  return { version: 1, roomId, sequence, gameId, serializedState, status, lastMove: safeLastMove(raw.lastMove), moves, sentAt };
}

export class SpectatorHost {
  private client: any = null;
  private roomId: string | null = null;
  private sequence = 0;
  private connected = false;
  private generation = 0;
  private status: SpectatorHostStatus = 'offline';
  private pending: { gameId: string; state: unknown; lastMove: SpectatorSnapshot['lastMove']; moves: string[] } | null = null;
  onStatus: (status: SpectatorHostStatus) => void = () => {};

  getStatus(): SpectatorHostStatus {
    return this.status;
  }

  private setStatus(status: SpectatorHostStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  async connect(roomValue: string): Promise<boolean> {
    const roomId = normalizeWatchRoom(roomValue);
    if (!roomId) {
      this.setStatus('error');
      return false;
    }
    this.teardown(true);
    const generation = ++this.generation;
    this.roomId = roomId;
    // Use a wall-clock epoch as the sequence base. A host can restart a room
    // while existing watchers stay connected; a fresh stream must still sort
    // after that room's retained snapshot from the previous host session.
    this.sequence = Date.now();
    this.setStatus('connecting');
    try {
      const mqtt: any = await import('mqtt');
      const client = (mqtt.default ?? mqtt).connect(BROKER, {
        clean: true,
        connectTimeout: 8_000,
        reconnectPeriod: 4_000,
        // An ungraceful disconnect clears the retained room just as a normal
        // close does, so a later viewer cannot mistake an abandoned board for
        // a currently hosted match.
        will: {
          topic: `${NAMESPACE}/${roomId}`,
          payload: '',
          qos: 0,
          retain: true,
        },
      });
      this.client = client;
      client.on('connect', () => {
        if (generation !== this.generation || this.client !== client) return;
        this.connected = true;
        this.setStatus('live');
        this.flush();
      });
      client.on('reconnect', () => {
        if (generation !== this.generation || this.client !== client) return;
        this.connected = false;
        this.setStatus('connecting');
      });
      client.on('offline', () => {
        if (generation !== this.generation || this.client !== client) return;
        this.connected = false;
        this.setStatus('offline');
      });
      client.on('close', () => {
        if (generation !== this.generation || this.client !== client) return;
        this.connected = false;
        if (this.status !== 'error') this.setStatus('offline');
      });
      client.on('error', () => {
        if (generation !== this.generation || this.client !== client) return;
        this.connected = false;
        this.setStatus('error');
      });
      return true;
    } catch {
      this.teardown(false);
      this.setStatus('error');
      return false;
    }
  }

  publish(gameId: string, state: unknown, lastMove: SpectatorSnapshot['lastMove'], moves: string[]): void {
    this.pending = { gameId, state, lastMove, moves };
    this.flush();
  }

  private flush(): void {
    if (!this.pending) return;
    const { gameId, state, lastMove, moves } = this.pending;
    const def = GAME_MAP[gameId];
    if (!this.connected || !this.client || !this.roomId || !def || def.custom) return;
    let serializedState = '';
    try { serializedState = def.serialize(state); } catch { return; }
    const snapshot = validateSpectatorSnapshot({
      version: 1,
      roomId: this.roomId,
      sequence: ++this.sequence,
      gameId,
      serializedState,
      status: def.getStatus(state),
      lastMove,
      moves,
      sentAt: Date.now(),
    }, this.roomId);
    if (!snapshot) return;
    const payload = JSON.stringify(snapshot);
    if (new TextEncoder().encode(payload).byteLength > MAX_MESSAGE_BYTES) return;
    this.client.publish(`${NAMESPACE}/${this.roomId}`, payload, { qos: 0, retain: true });
    this.pending = null;
  }

  private teardown(clearRetained: boolean): void {
    const client = this.client;
    const roomId = this.roomId;
    const wasConnected = this.connected;
    this.client = null;
    this.connected = false;
    this.roomId = null;
    this.sequence = 0;
    this.pending = null;
    if (!client) return;
    try {
      if (clearRetained && wasConnected && roomId) {
        // MQTT clears a retained message when a retained zero-length payload is
        // published. A graceful end queues this clear before disconnecting.
        client.publish(`${NAMESPACE}/${roomId}`, '', { qos: 0, retain: true });
        client.end(false);
      } else {
        client.end(true);
      }
    } catch { /* ignore */ }
  }

  close(): void {
    this.generation += 1;
    this.teardown(true);
    this.setStatus('offline');
  }
}

export class SpectatorWatcher {
  private client: any = null;
  private roomId: string | null = null;
  private lastSequence = -1;
  onSnapshot: (snapshot: SpectatorSnapshot) => void = () => {};
  onStatus: (status: SpectatorConnectionStatus) => void = () => {};

  async connect(roomValue: string): Promise<void> {
    const roomId = normalizeWatchRoom(roomValue);
    if (!roomId) { this.onStatus('error'); return; }
    this.close();
    this.roomId = roomId;
    this.onStatus('connecting');
    try {
      const mqtt: any = await import('mqtt');
      this.client = (mqtt.default ?? mqtt).connect(BROKER, { clean: true, connectTimeout: 8_000, reconnectPeriod: 4_000 });
      this.client.on('connect', () => {
        this.onStatus('online');
        this.client.subscribe(`${NAMESPACE}/${roomId}`);
      });
      this.client.on('close', () => this.onStatus('offline'));
      this.client.on('error', () => this.onStatus('error'));
      this.client.on('message', (_topic: string, payload: Uint8Array) => {
        if (payload.byteLength > MAX_MESSAGE_BYTES) return;
        if (payload.byteLength === 0) {
          this.lastSequence = -1;
          this.onStatus('offline');
          return;
        }
        let value: unknown;
        try { value = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
        const snapshot = validateSpectatorSnapshot(value, roomId);
        if (!snapshot || snapshot.sequence <= this.lastSequence) return;
        this.lastSequence = snapshot.sequence;
        this.onStatus('online');
        this.onSnapshot(snapshot);
      });
    } catch {
      this.onStatus('error');
    }
  }

  close(): void {
    try { this.client?.end(true); } catch { /* ignore */ }
    this.client = null;
    this.roomId = null;
    this.lastSequence = -1;
  }
}
