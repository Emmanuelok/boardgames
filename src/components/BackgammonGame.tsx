import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  initialState, rollDice, withRoll, legalMoves, applyMove, turnIsOver, endTurn, winner, aiPlayTurn,
  type BgState, type BgMove,
} from '../games/backgammon/logic';
import { useProfile } from '../profile/profile';
import { playSound, resumeAudio, isMuted, toggleMuted } from '../audio/sound';
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

export default function BackgammonGame({ aiDifficulty = 'medium' }: { aiDifficulty?: 'easy' | 'medium' | 'hard' }) {
  const [s, setS] = useState<BgState>(() => initialState());
  const [sel, setSel] = useState<Src | null>(null);
  const [thinking, setThinking] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const recordResult = useProfile((p) => p.recordResult);
  const win = winner(s);
  const [recorded, setRecorded] = useState(false);

  const moves = useMemo(() => (s.dice.length ? legalMoves(s) : []), [s]);
  const sources = useMemo(() => new Set<Src>(moves.map((m) => m.from)), [moves]);
  const destsOf = (from: Src) => moves.filter((m) => m.from === from);
  const selDests = sel === null ? [] : destsOf(sel);
  const destPoints = new Set<number>(selDests.filter((m) => m.to !== 'off').map((m) => m.to as number));
  const canBearSel = selDests.some((m) => m.to === 'off');

  // Record the result once.
  useEffect(() => {
    if (win === null || recorded) return;
    setRecorded(true);
    playSound(win === WHITE ? 'win' : 'lose');
    recordResult('backgammon', win === WHITE ? 'win' : 'loss', aiDifficulty as any);
  }, [win, recorded, recordResult, aiDifficulty]);

  // AI (Black) plays its whole turn.
  useEffect(() => {
    if (win !== null || s.turn !== BLACK) return;
    setThinking(true);
    const t = setTimeout(() => {
      let st = s.dice.length ? s : withRoll(s, rollDice());
      // Greedy: repeatedly take the move the engine's evaluate prefers.
      // (logic.aiPlayTurn does the full sequence selection.)
      const res = aiPlay(st, aiDifficulty);
      playSound(res.hit ? 'capture' : 'move');
      setS(endTurn(res.state));
      setThinking(false);
    }, 750);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, win]);

  const roll = () => {
    resumeAudio();
    if (s.turn !== WHITE || s.dice.length || win !== null) return;
    playSound('select');
    let st = withRoll(s, rollDice());
    if (legalMoves(st).length === 0) st = endTurn(st); // no move possible
    setS(st);
  };

  const clickSource = (from: Src) => {
    resumeAudio();
    if (s.turn !== WHITE || win !== null) return;
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
    setS(st);
  };

  return (
    <div className="bg-game">
      <div className="bg-hud">
        <PlayerChip name="Black" color="#1f2937" pips={pip(s, BLACK)} off={s.off[1]} active={s.turn === BLACK} ai thinking={thinking} />
        <div className="bg-center-hud">
          <Dice dice={s.dice} turn={s.turn} />
          {s.turn === WHITE && s.dice.length === 0 && win === null && <button className="btn primary" onClick={roll}>🎲 Roll</button>}
          {win !== null && <div className="bg-result">{win === WHITE ? 'You win! 🏆' : 'Black wins'}</div>}
        </div>
        <PlayerChip name="You" color="#f1f5f9" pips={pip(s, WHITE)} off={s.off[0]} active={s.turn === WHITE} thinking={false} />
      </div>

      <div className="bg-board-wrap">
        <div className="bg-board">
          <Half points={TOP} top s={s} sel={sel} sources={sources} destPoints={destPoints} onSource={clickSource} onDest={(p: number) => { const m = selDests.find((x) => x.to === p); if (m) play(m); }} />
          <Half points={BOT} s={s} sel={sel} sources={sources} destPoints={destPoints} onSource={clickSource} onDest={(p: number) => { const m = selDests.find((x) => x.to === p); if (m) play(m); }} />
        </div>
        <div className="bg-off">
          <OffTray player={BLACK} count={s.off[1]} />
          <button className={`bg-bearoff ${canBearSel ? 'live' : ''}`} disabled={!canBearSel} onClick={() => { const m = selDests.find((x) => x.to === 'off'); if (m) play(m); }}>Bear off ↓</button>
          <OffTray player={WHITE} count={s.off[0]} highlight={canBearSel} />
        </div>
      </div>

      <div className="bg-controls">
        <button className="btn sm" onClick={() => { setS(initialState()); setSel(null); setRecorded(false); }}>↻ New game</button>
        <button className="btn icon sm" onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
        <Link className="btn sm ghost" to="/learn/backgammon">📖 Rules</Link>
        <span className="faint" style={{ fontSize: 13 }}>{s.bar[0] > 0 ? 'You have a checker on the bar — enter it first.' : sel !== null ? 'Choose a destination.' : s.turn === WHITE && s.dice.length ? 'Pick a checker to move.' : ''}</span>
      </div>
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

function PlayerChip({ name, color, pips, off, active, ai, thinking }: any) {
  return (
    <div className={`bg-player ${active ? 'active' : ''}`}>
      <span className="bg-swatch" style={{ background: color }} />
      <div className="col" style={{ lineHeight: 1.15 }}>
        <strong>{name}</strong>
        <span className="faint" style={{ fontSize: 11 }}>{ai ? 'AI' : 'You'} · {pips} pips · {off} off</span>
      </div>
      {active && ai && thinking && <span className="bg-think">rolling…</span>}
    </div>
  );
}
