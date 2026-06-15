import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, rollDice, withRoll, legalMoves, applyMove, turnIsOver, endTurn, winner, aiPlayTurn,
  type BgState, type BgMove,
} from '../games/backgammon/logic';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
import { useBgOnline, type BgOnline } from '../net/useBgOnline';
import './BackgammonGame.css';

const WHITE = 0, BLACK = 1;
type Src = number | 'bar';

// Visual layout: top row points 12..17 | bar | 18..23 ; bottom 11..6 | bar | 5..0.
const TOP = [12, 13, 14, 15, 16, 17, -1, 18, 19, 20, 21, 22, 23];
const BOT = [11, 10, 9, 8, 7, 6, -1, 5, 4, 3, 2, 1, 0];

function pip(s: BgState, player: number): number {
  let n = (player === WHITE ? s.bar[0] : s.bar[1]) * 25;
  for (let p = 0; p < 24; p++) {
    const c = s.points[p];
    if (player === WHITE && c > 0) n += c * (p + 1);
    if (player === BLACK && c < 0) n += -c * (24 - p);
  }
  return n;
}

export default function BackgammonGame({
  aiDifficulty = 'medium', autoHost, autoJoin,
}: { aiDifficulty?: 'easy' | 'medium' | 'hard'; autoHost?: string; autoJoin?: string }) {
  const [s, setS] = useState<BgState>(() => initialState());
  const [sel, setSel] = useState<Src | null>(null);
  const [thinking, setThinking] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [recorded, setRecorded] = useState(false);
  const [showOnline, setShowOnline] = useState(false);
  const recordResult = useProfile((p) => p.recordResult);
  const win = winner(s);

  const online = useBgOnline({
    onReset: () => { setS(initialState()); setSel(null); setRecorded(false); },
    onState: (st) => { setS(st); setSel(null); },
  });
  const isOnline = online.engaged;
  const myColor: 0 | 1 = isOnline ? online.color : WHITE;
  const myTurn = s.turn === myColor && win === null && (!isOnline || online.connected);
  const flip = isOnline && myColor === BLACK; // guest (Black) sees the board from their side

  // Auto host/join from an invite link (?join= / ?host=).
  const didAuto = useRef(false);
  useEffect(() => {
    if (didAuto.current) return;
    if (autoJoin) { didAuto.current = true; setShowOnline(true); online.join(autoJoin); }
    else if (autoHost) { didAuto.current = true; setShowOnline(true); online.host(autoHost); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoin, autoHost]);

  const moves = useMemo(() => (myTurn && s.dice.length ? legalMoves(s) : []), [s, myTurn]);
  const sources = useMemo(() => new Set<Src>(moves.map((m) => m.from)), [moves]);
  const destsOf = (from: Src) => moves.filter((m) => m.from === from);
  const selDests = sel === null ? [] : destsOf(sel);
  const destPoints = new Set<number>(selDests.filter((m) => m.to !== 'off').map((m) => m.to as number));
  const canBearSel = selDests.some((m) => m.to === 'off');

  // Record the result once (rated vs AI only — online games are friendly).
  useEffect(() => {
    if (win === null || recorded) return;
    setRecorded(true);
    playSound(win === myColor ? 'win' : 'lose');
    if (!isOnline) recordResult('backgammon', win === WHITE ? 'win' : 'loss', aiDifficulty as any);
  }, [win, recorded, recordResult, aiDifficulty, isOnline, myColor]);

  // AI (Black) plays its whole turn — vs-AI mode only.
  useEffect(() => {
    if (isOnline) return;
    if (win !== null || s.turn !== BLACK) return;
    setThinking(true);
    const t = setTimeout(() => {
      let st = s.dice.length ? s : withRoll(s, rollDice());
      const res = aiPlay(st, aiDifficulty);
      playSound(res.hit ? 'capture' : 'move');
      setS(endTurn(res.state));
      setThinking(false);
    }, 750);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, win, isOnline]);

  const push = (st: BgState) => { setS(st); if (isOnline) online.sendState(st); };

  const roll = () => {
    resumeAudio();
    if (!myTurn || s.dice.length) return;
    playSound('select');
    let st = withRoll(s, rollDice());
    if (legalMoves(st).length === 0) st = endTurn(st); // no move possible
    push(st);
  };

  const clickSource = (from: Src) => {
    resumeAudio();
    if (!myTurn) return;
    if (!sources.has(from)) { setSel(null); return; }
    playSound('select');
    setSel(from);
  };

  const play = (m: BgMove) => {
    let st = applyMove(s, m);
    const hit = m.to !== 'off' && isHit(s, m);
    playSound(m.to === 'off' ? 'promote' : hit ? 'capture' : 'move');
    setSel(null);
    if (turnIsOver(st)) st = endTurn(st);
    push(st);
  };

  const newGame = () => {
    if (isOnline) online.restart();
    setS(initialState()); setSel(null); setRecorded(false);
  };

  const onDest = (p: number) => { const m = selDests.find((x) => x.to === p); if (m) play(m); };
  const blackName = isOnline ? (myColor === BLACK ? 'You' : 'Opponent') : 'Black';
  const whiteName = isOnline ? (myColor === WHITE ? 'You' : 'Opponent') : 'You';

  return (
    <div className="bg-game">
      <div className="bg-hud">
        <PlayerChip name={blackName} color="#1f2937" pips={pip(s, BLACK)} off={s.off[1]} active={s.turn === BLACK}
          tag={isOnline ? 'online' : 'AI'} thinking={!isOnline && thinking} />
        <div className="bg-center-hud">
          <Dice dice={s.dice} turn={s.turn} />
          {myTurn && s.dice.length === 0 && <button className="btn primary" onClick={roll}>🎲 Roll</button>}
          {isOnline && online.connected && win === null && !myTurn && <div className="faint" style={{ fontSize: 13 }}>Opponent’s turn…</div>}
          {isOnline && !online.connected && win === null && <div className="faint" style={{ fontSize: 13 }}>Waiting for opponent…</div>}
          {win !== null && <div className="bg-result">{win === myColor ? 'You win! 🏆' : `${win === WHITE ? 'White' : 'Black'} wins`}</div>}
        </div>
        <PlayerChip name={whiteName} color="#f1f5f9" pips={pip(s, WHITE)} off={s.off[0]} active={s.turn === WHITE} tag={isOnline ? 'online' : 'you'} thinking={false} />
      </div>

      <div className="bg-board-wrap">
        <div className={`bg-board${flip ? ' flipped' : ''}`}>
          <Half points={TOP} top s={s} sel={sel} sources={sources} destPoints={destPoints} onSource={clickSource} onDest={onDest} />
          <Half points={BOT} s={s} sel={sel} sources={sources} destPoints={destPoints} onSource={clickSource} onDest={onDest} />
        </div>
        <div className="bg-off">
          <OffTray player={BLACK} count={s.off[1]} />
          <button className={`bg-bearoff ${canBearSel ? 'live' : ''}`} disabled={!canBearSel} onClick={() => { const m = selDests.find((x) => x.to === 'off'); if (m) play(m); }}>Bear off ↓</button>
          <OffTray player={WHITE} count={s.off[0]} highlight={canBearSel} />
        </div>
      </div>

      <div className="bg-controls">
        <button className="btn sm" onClick={newGame}>↻ New game</button>
        <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
        <Link className="btn sm ghost" to="/learn/backgammon">📖 Rules</Link>
        {isOnline
          ? <button className="btn sm ghost" onClick={() => { online.leave(); setShowOnline(false); }}>Leave room</button>
          : <button className="btn sm" onClick={() => setShowOnline((v) => !v)}>🌐 Play online</button>}
        <span className="faint" style={{ fontSize: 13 }}>{hintLine(s, myTurn, sel, isOnline, online.connected)}</span>
      </div>

      {showOnline && <OnlinePanel online={online} myColor={myColor} />}
    </div>
  );
}

function hintLine(s: BgState, myTurn: boolean, sel: Src | null, isOnline: boolean, connected: boolean): string {
  if (isOnline && !connected) return '';
  if (!myTurn) return '';
  if (s.bar[s.turn] > 0) return 'You have a checker on the bar — enter it first.';
  if (sel !== null) return 'Choose a destination.';
  if (s.dice.length) return 'Pick a checker to move.';
  return '';
}

/* ----- Online panel (create / join / status / chat) ----- */
function OnlinePanel({ online, myColor }: { online: BgOnline; myColor: 0 | 1 }) {
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  if (!online.engaged) {
    return (
      <div className="bg-online glass-soft">
        <div className="field-label">Play a friend online (P2P)</div>
        <button className="btn sm primary" onClick={() => online.host()}>Create room</button>
        <div className="row gap-xs">
          <input className="tp-search" style={{ flex: 1 }} placeholder="Enter code (GM-XXXXX)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
          <button className="btn sm" onClick={() => online.join(joinCode)} disabled={joinCode.trim().length < 5}>Join</button>
        </div>
        <span className="faint" style={{ fontSize: 12 }}>Host plays White and rolls first. Share the code or link to invite a friend — runs peer-to-peer, no account needed.</span>
        <Link className="chip clickable" to="/lobby" style={{ alignSelf: 'flex-start' }}>🌐 Find players in the Lobby →</Link>
      </div>
    );
  }
  return (
    <div className="bg-online glass-soft">
      {online.code && <div className="online-code">{online.code}</div>}
      {online.code && myColor === WHITE && (
        <button className="btn sm primary" onClick={() => {
          const link = `${window.location.origin}${window.location.pathname}#/play/backgammon?join=${online.code}`;
          navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
        }}>{copied ? '✓ Link copied!' : '🔗 Copy invite link'}</button>
      )}
      <div className={`online-status ${online.status}`}>
        {online.status === 'waiting' && (online.code ? 'Share the code or link — waiting for your opponent to join…' : 'Connecting…')}
        {online.status === 'connected' && `Connected! You play ${myColor === WHITE ? 'White' : 'Black'}.`}
        {online.status === 'error' && 'Connection failed — check the code and try again.'}
        {online.status === 'closed' && 'Opponent disconnected.'}
      </div>
      {online.connected && <BgChat online={online} />}
    </div>
  );
}

function BgChat({ online }: { online: BgOnline }) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [online.chat.length]);
  return (
    <div className="bg-chat">
      <div className="bg-chat-msgs">
        {online.chat.length === 0 && <div className="faint" style={{ fontSize: 12, padding: '2px 2px' }}>Say hi to your opponent 👋</div>}
        {online.chat.map((m, i) => <div key={i} className={`chat-msg ${m.from}`}>{m.text}</div>)}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); online.sendChat(text); setText(''); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" maxLength={280} />
        <button className="btn sm primary" type="submit">Send</button>
      </form>
    </div>
  );
}

/* ----- AI wrapper (uses logic.aiPlayTurn, tracking whether it hit) ----- */
function aiPlay(st: BgState, diff: 'easy' | 'medium' | 'hard') {
  const before = st;
  const { moves, state } = aiPlayTurn(st, diff);
  let hit = false;
  let cur = before;
  for (const m of moves) { if (m.to !== 'off' && isHit(cur, m)) hit = true; cur = applyMove(cur, m); }
  return { state, hit };
}
function isHit(s: BgState, m: BgMove): boolean {
  if (m.to === 'off') return false;
  const c = s.points[m.to as number];
  return s.turn === WHITE ? c === -1 : c === 1;
}

/* ------------------------------ pieces ------------------------------ */

function Half({ points, top, s, sel, sources, destPoints, onSource, onDest }: any) {
  return (
    <div className={`bg-half ${top ? 'top' : 'bottom'}`}>
      {points.map((p: number, i: number) => {
        if (p === -1) {
          const barCount = top ? s.bar[1] : s.bar[0];
          const isBarSrc = !top && sources.has('bar');
          return (
            <div key={`bar${i}`} className={`bg-bar-col ${top ? 'top' : 'bottom'} ${isBarSrc ? 'src' : ''} ${sel === 'bar' && !top ? 'sel' : ''}`} onClick={() => !top && onSource('bar')}>
              {Array.from({ length: barCount }).map((_, k) => <span key={k} className={`bg-checker ${top ? 'b' : 'w'}`} />)}
            </div>
          );
        }
        const count = s.points[p];
        const owner = count > 0 ? WHITE : count < 0 ? BLACK : -1;
        const n = Math.abs(count);
        const isSource = sources.has(p);
        const isDest = destPoints.has(p);
        const isSel = sel === p;
        return (
          <div
            key={p}
            className={`bg-point ${(i % 2 === 0) ? 'a' : 'b'} ${top ? 'down' : 'up'} ${isSource ? 'src' : ''} ${isDest ? 'dest' : ''} ${isSel ? 'sel' : ''}`}
            onClick={() => (isDest ? onDest(p) : onSource(p))}
          >
            <div className="bg-checkers">
              {Array.from({ length: Math.min(n, 5) }).map((_, k) => (
                <span key={k} className={`bg-checker ${owner === WHITE ? 'w' : 'b'}`} />
              ))}
              {n > 5 && <span className="bg-stacknum">{n}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OffTray({ player, count, highlight }: { player: number; count: number; highlight?: boolean }) {
  return (
    <div className={`bg-offtray ${highlight ? 'live' : ''}`}>
      {Array.from({ length: count }).map((_, k) => <span key={k} className={`bg-checker flat ${player === WHITE ? 'w' : 'b'}`} />)}
      <span className="bg-off-n">{count}/15</span>
    </div>
  );
}

function Dice({ dice, turn }: { dice: number[]; turn: number }) {
  if (!dice.length) return <div className="bg-dice empty" />;
  return (
    <div className="bg-dice">
      {dice.slice(0, 4).map((d, i) => (
        <span key={i} className={`die ${turn === WHITE ? 'w' : 'b'}`}>{pips(d)}</span>
      ))}
    </div>
  );
}
function pips(d: number) {
  return <span className={`die-face f${d}`}>{Array.from({ length: d }).map((_, i) => <i key={i} />)}</span>;
}

function PlayerChip({ name, color, pips, off, active, tag, thinking }: any) {
  return (
    <div className={`bg-player ${active ? 'active' : ''}`}>
      <span className="bg-swatch" style={{ background: color }} />
      <div className="col" style={{ lineHeight: 1.15 }}>
        <strong>{name}</strong>
        <span className="faint" style={{ fontSize: 11 }}>{tag} · {pips} pips · {off} off</span>
      </div>
      {active && thinking && <span className="bg-think">rolling…</span>}
    </div>
  );
}
