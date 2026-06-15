/**
 * Online play for Backgammon. The generic game store can't drive Backgammon —
 * it has dice (hidden randomness) and a multi-move turn — so instead of relaying
 * individual moves we sync the whole `BgState` after each action by the player
 * whose turn it is. The host plays White (0) and moves first; the guest plays
 * Black (1). Built on the same peer-to-peer transport as the other games.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { OnlineSession, type NetMsg, type NetStatus } from './online';
import type { BgState } from '../games/backgammon/logic';

export interface BgChatMsg { from: 'me' | 'them'; text: string }

export interface BgOnline {
  engaged: boolean; // online mode active (creating, joining, or connected)
  connected: boolean;
  status: NetStatus;
  code: string;
  color: 0 | 1; // 0 = White (host), 1 = Black (guest)
  chat: BgChatMsg[];
  host: (code?: string) => void;
  join: (code: string) => void;
  leave: () => void;
  sendState: (s: BgState) => void;
  restart: () => void;
  sendChat: (text: string) => void;
}

export interface BgOnlineHandlers {
  /** Reset to a fresh game (host on connect, and on either side's rematch). */
  onReset: () => void;
  /** Apply an authoritative state pushed by the opponent. */
  onState: (s: BgState) => void;
}

export function useBgOnline(handlers: BgOnlineHandlers): BgOnline {
  const h = useRef(handlers);
  h.current = handlers;
  const sess = useRef<OnlineSession | null>(null);

  const [engaged, setEngaged] = useState(false);
  const [status, setStatus] = useState<NetStatus>('idle');
  const [code, setCode] = useState('');
  const [color, setColor] = useState<0 | 1>(0);
  const [chat, setChat] = useState<BgChatMsg[]>([]);

  const onMsg = useCallback((m: NetMsg) => {
    if (m.t === 'state') h.current.onState(m.state as BgState);
    else if (m.t === 'init' || m.t === 'restart') h.current.onReset();
    else if (m.t === 'chat') setChat((c) => [...c, { from: 'them', text: String(m.text).slice(0, 280) }]);
    else if (m.t === 'bye') setStatus('closed');
  }, []);

  const open = useCallback(
    (role: 'host' | 'guest', codeArg?: string) => {
      sess.current?.close();
      const s = new OnlineSession();
      s.onMsg = onMsg;
      s.onStatus = (st) => {
        setStatus(st);
        // The host owns the opening position: once both are connected it starts a
        // fresh game and broadcasts it so the two boards begin in lockstep.
        if (st === 'connected' && role === 'host') {
          h.current.onReset();
          s.send({ t: 'init', gameId: 'backgammon' });
        }
      };
      sess.current = s;
      setEngaged(true);
      setStatus('waiting');
      setChat([]);
      setColor(role === 'host' ? 0 : 1);
      if (role === 'host') {
        setCode(typeof codeArg === 'string' ? codeArg : '');
        s.host(typeof codeArg === 'string' ? codeArg : undefined).then((c) => setCode(c));
      } else {
        setCode((codeArg || '').trim().toUpperCase());
        s.join(codeArg || '');
      }
    },
    [onMsg],
  );

  const host = useCallback((c?: string) => open('host', typeof c === 'string' ? c : undefined), [open]);
  const join = useCallback((c: string) => open('guest', c), [open]);

  const leave = useCallback(() => {
    try { sess.current?.send({ t: 'bye' }); } catch { /* ignore */ }
    sess.current?.close();
    sess.current = null;
    setEngaged(false);
    setStatus('idle');
    setCode('');
    setChat([]);
  }, []);

  const sendState = useCallback((s: BgState) => sess.current?.send({ t: 'state', state: s }), []);
  const restart = useCallback(() => sess.current?.send({ t: 'restart', gameId: 'backgammon' }), []);
  const sendChat = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    sess.current?.send({ t: 'chat', text: t.slice(0, 280) });
    setChat((c) => [...c, { from: 'me', text: t.slice(0, 280) }]);
  }, []);

  useEffect(() => () => { sess.current?.close(); }, []);

  return { engaged, connected: status === 'connected', status, code, color, chat, host, join, leave, sendState, restart, sendChat };
}
