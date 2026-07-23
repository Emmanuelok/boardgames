import { describe, expect, it } from 'vitest';
import { genRoomCode, normalizeRoomCode, parseNetMsg, QUICK_CHAT_PHRASES } from './online';

const validBackgammonState = {
  points: [
    2, 0, 0, 0, 0, -5,
    0, -3, 0, 0, 0, 5,
    -5, 0, 0, 0, 3, 0,
    5, 0, 0, 0, 0, -2,
  ],
  bar: [0, 0],
  off: [0, 0],
  turn: 0,
  dice: [],
};

describe('online protocol boundary', () => {
  it('generates and normalizes unambiguous room codes', () => {
    const code = genRoomCode();
    expect(code).toMatch(/^GM-[A-HJ-NP-Z2-9]{5}$/);
    expect(normalizeRoomCode(`  ${code.toLowerCase()}  `)).toBe(code);
    expect(normalizeRoomCode('GM-O0I1L')).toBeNull();
  });

  it('accepts only bounded, structured moves', () => {
    expect(parseNetMsg({ t: 'move', move: { id: '12-20', from: 12, to: 20, notation: 'e3' } })).toEqual({
      t: 'move', move: { id: '12-20', from: 12, to: 20, notation: 'e3' },
    });
    expect(parseNetMsg({ t: 'move', move: { id: 'bad', to: Infinity, notation: 'x' } })).toBeNull();
    expect(parseNetMsg({ t: 'move', move: { id: 'bad', to: 2 } })).toBeNull();
  });

  it('allows the shared quick-chat vocabulary and rejects arbitrary peer text', () => {
    for (const text of QUICK_CHAT_PHRASES) expect(parseNetMsg({ t: 'chat', text })).toEqual({ t: 'chat', text });
    expect(parseNetMsg({ t: 'chat', text: 'send me your contact details' })).toBeNull();
  });

  it('sanitizes a valid Backgammon state and rejects impossible inventories', () => {
    const parsed = parseNetMsg({ t: 'state', state: validBackgammonState });
    expect(parsed?.t).toBe('state');
    expect(parsed && parsed.t === 'state' ? parsed.state : null).not.toBe(validBackgammonState);

    const impossible = { ...validBackgammonState, off: [15, 15] };
    expect(parseNetMsg({ t: 'state', state: impossible })).toBeNull();
  });

  it('rejects unknown commands and malformed game identifiers', () => {
    expect(parseNetMsg({ t: 'admin', action: 'reset' })).toBeNull();
    expect(parseNetMsg({ t: 'restart', gameId: '../chess' })).toBeNull();
    expect(parseNetMsg({ t: 'init', gameId: 'chess' })).toEqual({ t: 'init', gameId: 'chess' });
  });
});
