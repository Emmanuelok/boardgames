import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_MAP } from '../engine/registry';
import {
  normalizeWatchRoom,
  SpectatorHost,
  SpectatorWatcher,
  validateSpectatorSnapshot,
  type SpectatorConnectionStatus,
  type SpectatorHostStatus,
} from './spectator';

const mqttHarness = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const client = {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return client;
    }),
    publish: vi.fn(),
    end: vi.fn(),
    subscribe: vi.fn(),
  };
  return {
    handlers,
    client,
    connect: vi.fn(() => client),
  };
});

vi.mock('mqtt', () => ({
  default: { connect: mqttHarness.connect },
}));

beforeEach(() => {
  mqttHarness.handlers.clear();
  mqttHarness.client.on.mockClear();
  mqttHarness.client.publish.mockClear();
  mqttHarness.client.end.mockClear();
  mqttHarness.client.subscribe.mockClear();
  mqttHarness.connect.mockClear();
});

describe('spectator snapshots', () => {
  it('normalizes bounded room ids', () => {
    expect(normalizeWatchRoom(' gm-room-1 ')).toBe('GM-ROOM-1');
    expect(normalizeWatchRoom('../bad')).toBeNull();
  });

  it('validates state with the authoritative game engine', () => {
    const def = GAME_MAP['tic-tac-toe'];
    const snapshot = validateSpectatorSnapshot({
      version: 1,
      roomId: 'GM-ROOM-1',
      sequence: 2,
      gameId: def.id,
      serializedState: def.serialize(def.createInitialState()),
      moves: ['X to a1'],
      sentAt: 1,
    }, 'GM-ROOM-1');
    expect(snapshot?.gameId).toBe(def.id);
    expect(snapshot?.status.kind).toBe('playing');
  });

  it('rejects custom engines and malformed state', () => {
    expect(validateSpectatorSnapshot({ version: 1, roomId: 'GM-ROOM-1', sequence: 1, gameId: 'backgammon', serializedState: '{}' })).toBeNull();
    expect(validateSpectatorSnapshot({ version: 1, roomId: 'GM-ROOM-1', sequence: 1, gameId: 'chess', serializedState: 'broken' })).toBeNull();
  });

  it('exposes truthful host status and clears the retained room on graceful close', async () => {
    const host = new SpectatorHost();
    const statuses: SpectatorHostStatus[] = [];
    host.onStatus = (status) => statuses.push(status);

    await expect(host.connect('GM-ROOM-1')).resolves.toBe(true);
    expect(host.getStatus()).toBe('connecting');
    expect(mqttHarness.connect).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      will: expect.objectContaining({
        topic: 'grandmaster/v1/watch/GM-ROOM-1',
        payload: '',
        retain: true,
      }),
    }));

    mqttHarness.handlers.get('connect')?.();
    expect(host.getStatus()).toBe('live');

    const def = GAME_MAP['tic-tac-toe'];
    host.publish(def.id, def.createInitialState(), null, []);
    const snapshotPayload = mqttHarness.client.publish.mock.calls.find((call) => call[1] !== '')?.[1];
    expect(JSON.parse(snapshotPayload)).toMatchObject({
      roomId: 'GM-ROOM-1',
      gameId: 'tic-tac-toe',
    });

    host.close();
    expect(host.getStatus()).toBe('offline');
    expect(statuses).toEqual(['connecting', 'live', 'offline']);
    expect(mqttHarness.client.publish).toHaveBeenCalledWith(
      'grandmaster/v1/watch/GM-ROOM-1',
      '',
      { qos: 0, retain: true },
    );
    expect(mqttHarness.client.end).toHaveBeenCalledWith(false);
  });

  it('marks an invalid host room as an error without opening a broker connection', async () => {
    const host = new SpectatorHost();
    await expect(host.connect('../not-a-room')).resolves.toBe(false);
    expect(host.getStatus()).toBe('error');
    expect(mqttHarness.connect).not.toHaveBeenCalled();
  });

  it('treats an empty retained watcher payload as an ended room and accepts a fresh stream', async () => {
    const watcher = new SpectatorWatcher();
    const statuses: SpectatorConnectionStatus[] = [];
    const sequences: number[] = [];
    watcher.onStatus = (status) => statuses.push(status);
    watcher.onSnapshot = (snapshot) => sequences.push(snapshot.sequence);
    await watcher.connect('GM-ROOM-1');
    mqttHarness.handlers.get('connect')?.();

    const def = GAME_MAP['tic-tac-toe'];
    const message = (sequence: number) => new TextEncoder().encode(JSON.stringify({
      version: 1,
      roomId: 'GM-ROOM-1',
      sequence,
      gameId: def.id,
      serializedState: def.serialize(def.createInitialState()),
      moves: [],
      sentAt: Date.now(),
    }));
    mqttHarness.handlers.get('message')?.('grandmaster/v1/watch/GM-ROOM-1', message(100));
    mqttHarness.handlers.get('message')?.('grandmaster/v1/watch/GM-ROOM-1', new Uint8Array());
    mqttHarness.handlers.get('message')?.('grandmaster/v1/watch/GM-ROOM-1', message(101));

    expect(sequences).toEqual([100, 101]);
    expect(statuses).toEqual(['connecting', 'online', 'online', 'offline', 'online']);
  });
});
