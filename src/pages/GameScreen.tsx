import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { getGame, familyOf } from '../engine/registry';
import { getTheme } from '../themes/boardThemes';
import Board2D from '../components/Board2D';
import EvalBar from '../components/EvalBar';
import TutorPanel from '../components/TutorPanel';
import ThemePicker from '../components/ThemePicker';
import HandStrip from '../components/HandStrip';
import BackgammonGame from '../components/BackgammonGame';
import { isMuted, toggleMuted, resumeAudio } from '../audio/sound';
import { useProfile, ratingTitle, ACHIEVEMENTS } from '../profile/profile';
import type { Difficulty, MoveBase, Player } from '../engine/types';
import './GameScreen.css';

const Board3D = lazy(() => import('../components/Board3D'));

const DIFFS: { id: Difficulty; label: string; sub: string }[] = [
  { id: 'easy', label: 'Beginner', sub: 'gentle' },
  { id: 'medium', label: 'Casual', sub: 'balanced' },
  { id: 'hard', label: 'Strong', sub: 'sharp' },
  { id: 'master', label: 'Master', sub: 'relentless' },
  { id: 'tutor', label: 'Tutor', sub: 'teaches' },
];

export default function GameScreen() {
  const { gameId } = useParams();
  const store = useGameStore();
  const [tab, setTab] = useState<'tutor' | 'moves' | 'setup' | 'chat'>('tutor');
  const [themeOpen, setThemeOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const rating = useProfile((s) => s.rating);
  const lastUnlocked = useProfile((s) => s.lastUnlocked);
  const clearLastUnlocked = useProfile((s) => s.clearLastUnlocked);

  useEffect(() => {
    if (!lastUnlocked) return;
    const t = setTimeout(() => clearLastUnlocked(), 5000);
    return () => clearTimeout(t);
  }, [lastUnlocked, clearLastUnlocked]);

  const [params] = useSearchParams();
  const joinedRef = useRef(false);

  useEffect(() => {
    if (gameId && getGame(gameId)) useGameStore.getState().newGame(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Auto host/join a room from the URL (?join=GM-XXXXX from an invite link,
  // or ?host=GM-XXXXX when a lobby challenge sends both players to a shared code).
  useEffect(() => {
    if (joinedRef.current) return;
    if (gameId && getGame(gameId)?.custom) return; // bespoke games (backgammon) auto-join themselves
    const join = params.get('join');
    const host = params.get('host');
    if (join) { joinedRef.current = true; setTimeout(() => useGameStore.getState().joinOnline(join), 450); }
    else if (host) { joinedRef.current = true; setTimeout(() => useGameStore.getState().hostOnline(host), 450); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!store.toast) return;
    const t = setTimeout(() => useGameStore.getState().setToast(null), 2600);
    return () => clearTimeout(t);
  }, [store.toast]);

  useEffect(() => { if (store.mode !== 'online' && tab === 'chat') setTab('tutor'); }, [store.mode, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const s = useGameStore.getState();
      switch (e.key.toLowerCase()) {
        case 'z': s.undo(); break;
        case 'y': s.redo(); break;
        case 'f': s.toggleFlip(); break;
        case 'h': s.requestHint(); break;
        case 'n': s.restart(); break;
        case 'escape': setThemeOpen(false); if (s.promotion) s.choosePromotion(null); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const def = store.def;
  if (!def || !store.state || def.id !== gameId) {
    return <div className="loading">Loading…</div>;
  }

  // Games with a bespoke renderer (Backgammon: dice, stacks) bypass the board flow.
  if (def.custom) {
    const diff = store.difficulty === 'easy' ? 'easy' : store.difficulty === 'hard' || store.difficulty === 'master' ? 'hard' : 'medium';
    return (
      <div className="game-screen" style={{ ['--accent' as any]: def.accent }}>
        <header className="gs-toolbar">
          <Link to="/" className="btn ghost sm">← Hub</Link>
          <div className="gs-title"><span className="gs-emoji">{def.emoji}</span><div className="col"><strong>{def.name}</strong><span className="faint" style={{ fontSize: 12 }}>vs AI · {diff}</span></div></div>
          <Link className="btn sm ghost" to={`/learn/${def.id}`}>📖 Learn</Link>
        </header>
        <BackgammonGame aiDifficulty={diff} autoJoin={params.get('join') || undefined} autoHost={params.get('host') || undefined} />
      </div>
    );
  }

  const theme = getTheme(store.themeId);
  const view = def.getBoardView(store.state);
  const turn = def.getTurn(store.state) as Player;
  const bottom: Player = (store.flipped ? 1 : 0) as Player;
  const top: Player = (1 - bottom) as Player;
  const over = store.status.kind === 'win' || store.status.kind === 'draw';
  const canDrop = (p: Player) => turn === p && !over && (store.mode === 'pass' || p === store.humanColor);
  const opening = def.identifyOpening?.(store.log.map((e) => e.notation)) ?? null;

  return (
    <div className="game-screen" style={{ ['--accent' as any]: def.accent }}>
      <header className="gs-toolbar">
        <Link to="/" className="btn ghost sm">← Hub</Link>
        <div className="gs-title">
          <span className="gs-emoji">{def.emoji}</span>
          <div className="col">
            <strong>{def.name}</strong>
            <span className="faint" style={{ fontSize: 12 }}>{statusLine(store)}</span>
          </div>
        </div>
        <div className="row gap-xs">
          <span className="chip rating-chip hide-sm" title="Your rating">⚡ {rating} · {ratingTitle(rating)}</span>
          <div className="seg">
            <button className={store.view === '2d' ? 'on' : ''} onClick={() => store.setView('2d')}>2D</button>
            <button className={store.view === '3d' ? 'on' : ''} onClick={() => store.setView('3d')}>3D</button>
          </div>
          <button className="btn icon sm" title={muted ? 'Unmute' : 'Mute'} onClick={() => { resumeAudio(); setMutedState(toggleMuted()); }}>{muted ? '🔇' : '🔊'}</button>
          <button className="btn sm" onClick={() => setThemeOpen(true)}>🎨 Theme</button>
          <Link className="btn sm ghost hide-sm" to={`/learn/${def.id}`}>📖 Learn</Link>
        </div>
      </header>

      <VariantBar gameId={def.id} />

      <div className="play-area">
        <div className="board-col">
          <PlayerTag def={def} who={top} turn={turn} thinking={store.thinking} store={store} />
          <HandStrip def={def} state={store.state} player={top} armed={store.selectedDrop} active={canDrop(top)} onPick={store.selectHand} />
          <div className="board-stage">
            {def.evalScale != null && <EvalBar info={store.liveEval} loading={store.liveEvalLoading} status={store.status} flipped={store.flipped} scale={def.evalScale} />}
            <div className="board-host">
              {store.view === '3d' ? (
                <Suspense fallback={<div className="board3d-fallback glass-soft">Loading 3D board…</div>}>
                  <Board3D
                    def={def} view={view} theme={theme} turn={turn} flipped={store.flipped}
                    selected={store.selected} targets={store.targets} lastMove={store.lastMove}
                    status={store.status} hint={store.hintMove} onCell={store.onCellClick}
                  />
                </Suspense>
              ) : (
                <Board2D
                  def={def} view={view} theme={theme} turn={turn} flipped={store.flipped}
                  selected={store.selected} targets={store.targets} lastMove={store.lastMove}
                  status={store.status} hint={store.hintMove} onCell={store.onCellClick}
                  pendingCell={store.pendingTo}
                />
              )}
            </div>
          </div>
          <HandStrip def={def} state={store.state} player={bottom} armed={store.selectedDrop} active={canDrop(bottom)} onPick={store.selectHand} />
          <PlayerTag def={def} who={bottom} turn={turn} thinking={store.thinking} store={store} you />
        </div>

        <aside className="side-col">
          {opening && (
            <div className="opening-chip glass-soft" title={opening.idea}>
              <span className="oc-emoji">📖</span>
              <div className="col">
                <strong>{opening.name}</strong>
                {opening.idea && <span className="oc-idea">{opening.idea}</span>}
              </div>
              {opening.eco && <span className="oc-eco">{opening.eco}</span>}
            </div>
          )}
          <div className="controls glass-soft">
            <button className="btn sm primary" onClick={store.restart} title="New game (N)">↻ New</button>
            <button className="btn sm" onClick={store.undo} disabled={store.past.length === 0} title="Undo (Z)">↶ Undo</button>
            <button className="btn sm" onClick={store.redo} disabled={store.future.length === 0} title="Redo (Y)">↷ Redo</button>
            <button className="btn sm" onClick={store.requestHint} disabled={over} title="Get a hint (H)">💡 Hint</button>
            <button className="btn sm" onClick={store.toggleFlip} title="Flip board (F)">⇅ Flip</button>
            {def.canPass && <button className="btn sm" onClick={store.passTurn} disabled={over} title="Pass (Go)">⏭ Pass</button>}
          </div>

          <div className="tabs">
            {(store.mode === 'online' ? (['tutor', 'moves', 'chat', 'setup'] as const) : (['tutor', 'moves', 'setup'] as const)).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                {t === 'tutor' ? '🧠 Tutor' : t === 'moves' ? '📜 Moves' : t === 'chat' ? '💬 Chat' : '⚙ Setup'}
              </button>
            ))}
          </div>

          <div className="tab-panel">
            {tab === 'tutor' && <TutorPanel />}
            {tab === 'moves' && <MoveLog store={store} />}
            {tab === 'setup' && <Setup store={store} def={def} />}
            {tab === 'chat' && store.mode === 'online' && <Chat store={store} />}
          </div>
        </aside>
      </div>

      {themeOpen && <ThemePicker current={store.themeId} onPick={(id) => store.setTheme(id)} onClose={() => setThemeOpen(false)} />}
      {store.promotion && <Promotion store={store} />}
      {store.toast && <div className="toast glass">{store.toast}</div>}
      {lastUnlocked && <AchievementToast id={lastUnlocked} />}
    </div>
  );
}

function VariantBar({ gameId }: { gameId: string }) {
  const fam = familyOf(gameId);
  if (!fam || fam.variants.length < 2) return null;
  return (
    <div className="variant-bar">
      <span className="vb-label">{fam.emoji} {fam.name}</span>
      <div className="seg variant-seg">
        {fam.variants.map((v) => (
          v.id === gameId
            ? <button key={v.id} className="on" disabled>{v.label}</button>
            : <Link key={v.id} to={`/play/${v.id}`}>{v.label}</Link>
        ))}
      </div>
    </div>
  );
}

function Chat({ store }: any) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [store.chat.length]);
  return (
    <div className="chat glass-soft">
      <div className="chat-msgs">
        {store.chat.length === 0 && <div className="faint" style={{ padding: 12, fontSize: 13 }}>Connected — say hello to your opponent 👋</div>}
        {store.chat.map((m: any, i: number) => <div key={i} className={`chat-msg ${m.from}`}>{m.text}</div>)}
        <div ref={endRef} />
      </div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); store.sendChat(text); setText(''); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" maxLength={280} />
        <button className="btn sm primary" type="submit">Send</button>
      </form>
    </div>
  );
}

function AchievementToast({ id }: { id: string }) {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return null;
  return (
    <div className="achievement-toast glass">
      <span className="at-ic">{a.icon}</span>
      <div className="col">
        <span className="at-title">Achievement unlocked</span>
        <strong>{a.title}</strong>
        <span className="faint" style={{ fontSize: 12 }}>{a.desc}</span>
      </div>
    </div>
  );
}

function statusLine(store: any): string {
  const { def, status } = store;
  if (status.kind === 'win') return `${def.players[status.winner].name} wins by ${status.reason}`;
  if (status.kind === 'draw') return `Draw — ${status.reason}`;
  const t = def.getTurn(store.state);
  const who = store.mode === 'ai' ? (t === store.humanColor ? 'Your move' : 'Engine to move') : `${def.players[t].name} to move`;
  if (status.kind === 'check') return `${who} · Check!`;
  return who;
}

const CHESS_VAL: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
function playerScore(def: any, state: any, who: Player): string | null {
  if (!state) return null;
  const cells = def.getBoardView(state).cells;
  if (def.id === 'chess') {
    let mine = 0, theirs = 0;
    for (const c of cells) if (c.piece) {
      const v = CHESS_VAL[c.piece.kind] ?? 0;
      if (c.piece.player === who) mine += v; else theirs += v;
    }
    return mine - theirs > 0 ? `+${mine - theirs}` : null;
  }
  if (def.id === 'reversi' || def.id === 'checkers') {
    let n = 0;
    for (const c of cells) if (c.piece && c.piece.player === who) n++;
    return String(n);
  }
  return null;
}

function PlayerTag({ def, who, turn, thinking, store, you }: any) {
  const isAI = store.mode === 'ai' && who !== store.humanColor;
  const active = turn === who && store.status.kind !== 'win' && store.status.kind !== 'draw';
  const score = playerScore(def, store.state, who);
  return (
    <div className={`player-tag ${active ? 'active' : ''}`}>
      <span className="pt-swatch" style={{ background: def.players[who].color }} />
      <div className="col" style={{ lineHeight: 1.15 }}>
        <strong>{def.players[who].name}</strong>
        <span className="faint" style={{ fontSize: 11 }}>{store.mode === 'pass' ? 'Player' : isAI ? 'AI Engine' : you ? 'You' : 'You'}</span>
      </div>
      <div className="pt-right">
        {score && <span className="pt-score">{score}</span>}
        {active && isAI && thinking && <span className="pt-think">thinking…</span>}
        {active && <span className="pt-pulse" />}
      </div>
    </div>
  );
}

function MoveLog({ store }: any) {
  const { log, def } = store;
  if (log.length === 0) return <div className="empty glass-soft">No moves yet. Make your first move!</div>;
  const rows: any[] = [];
  for (let i = 0; i < log.length; i += 2) rows.push([log[i], log[i + 1]]);
  return (
    <div className="movelog glass-soft">
      {rows.map((pair, i) => (
        <div className="ml-row" key={i}>
          <span className="ml-num">{i + 1}.</span>
          <span className="ml-move">{pair[0]?.notation} {badge(pair[0])}</span>
          <span className="ml-move">{pair[1] ? <>{pair[1].notation} {badge(pair[1])}</> : ''}</span>
        </div>
      ))}
      <div className="faint" style={{ padding: '8px 10px', fontSize: 12 }}>{def.players[0].name} on the left.</div>
    </div>
  );
}
function badge(entry: any) {
  if (!entry?.explanation) return null;
  const b = entry.explanation.band;
  const sym: Record<string, string> = { brilliant: '!!', great: '!', best: '★', good: '✓', book: '', solid: '=', inaccuracy: '?!', mistake: '?', blunder: '??' };
  return <span className={`mlb ${b}`}>{sym[b] ?? ''}</span>;
}

function Setup({ store, def }: any) {
  const restartWith = (fn: () => void) => { fn(); setTimeout(() => useGameStore.getState().restart(), 0); };
  const [showOnline, setShowOnline] = useState(store.mode === 'online');
  const [joinCode, setJoinCode] = useState('');
  return (
    <div className="setup glass-soft">
      <Field label="Opponent">
        <div className="seg full">
          <button className={store.mode !== 'online' && store.mode === 'ai' && !showOnline ? 'on' : ''} onClick={() => { setShowOnline(false); restartWith(() => store.setMode('ai')); }}>vs AI</button>
          <button className={store.mode === 'pass' && !showOnline ? 'on' : ''} onClick={() => { setShowOnline(false); restartWith(() => store.setMode('pass')); }}>Pass &amp; Play</button>
          <button className={showOnline || store.mode === 'online' ? 'on' : ''} onClick={() => setShowOnline(true)}>Online</button>
        </div>
      </Field>

      {showOnline && (
        <Field label="Online (P2P)">
          <div className="online-panel">
            {store.mode !== 'online' || store.onlineStatus === 'idle' ? (
              <>
                <button className="btn sm primary" onClick={() => store.hostOnline()}>Create room</button>
                <div className="row gap-xs">
                  <input className="tp-search" style={{ flex: 1 }} placeholder="Enter code (GM-XXXXX)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
                  <button className="btn sm" onClick={() => store.joinOnline(joinCode)} disabled={joinCode.trim().length < 5}>Join</button>
                </div>
                <span className="faint" style={{ fontSize: 12 }}>Create a room and share the code/link, or join a friend’s. Runs peer-to-peer; no account needed.</span>
                <Link className="chip clickable" to="/lobby" style={{ alignSelf: 'flex-start' }}>🌐 Find players in the Lobby →</Link>
              </>
            ) : (
              <>
                {store.onlineCode && <div className="online-code">{store.onlineCode}</div>}
                {store.onlineCode && store.onlineColor === 0 && (
                  <button className="btn sm primary" onClick={() => {
                    const link = `${window.location.origin}${window.location.pathname}#/play/${def.id}?join=${store.onlineCode}`;
                    navigator.clipboard?.writeText(link).then(() => store.setToast('Invite link copied — send it to a friend!'), () => store.setToast(link));
                  }}>🔗 Copy invite link</button>
                )}
                <div className={`online-status ${store.onlineStatus}`}>
                  {store.onlineStatus === 'waiting' && (store.onlineCode ? 'Share the code or link — waiting for your opponent to join…' : 'Connecting…')}
                  {store.onlineStatus === 'connected' && `Connected! You play ${def.players[store.onlineColor].name}.`}
                  {store.onlineStatus === 'error' && 'Connection failed — check the code and try again.'}
                  {store.onlineStatus === 'closed' && 'Disconnected.'}
                </div>
                <button className="btn sm ghost" onClick={() => { store.leaveOnline(); setShowOnline(false); }}>Leave room</button>
              </>
            )}
          </div>
        </Field>
      )}

      {store.mode === 'ai' && !showOnline && (
        <>
          <Field label="AI strength">
            <div className="diff-grid">
              {DIFFS.map((d) => (
                <button key={d.id} className={`diff ${store.difficulty === d.id ? 'on' : ''}`} onClick={() => store.setDifficulty(d.id)}>
                  <strong>{d.label}</strong><span>{d.sub}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Play as`}>
            <div className="seg full">
              <button className={store.humanColor === 0 ? 'on' : ''} onClick={() => restartWith(() => store.setHumanColor(0))}>{def.players[0].name}</button>
              <button className={store.humanColor === 1 ? 'on' : ''} onClick={() => restartWith(() => store.setHumanColor(1))}>{def.players[1].name}</button>
            </div>
          </Field>
        </>
      )}

      <Field label="Tutor">
        <button className={`chip clickable ${store.autoTutor ? 'active' : ''}`} onClick={store.toggleAutoTutor}>
          {store.autoTutor ? 'Explain every move ✓' : 'Explanations off'}
        </button>
      </Field>

      <Field label="Board view">
        <div className="seg full">
          <button className={store.view === '2d' ? 'on' : ''} onClick={() => store.setView('2d')}>2D</button>
          <button className={store.view === '3d' ? 'on' : ''} onClick={() => store.setView('3d')}>3D</button>
        </div>
      </Field>
    </div>
  );
}
function Field({ label, children }: { label: string; children: any }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}

function Promotion({ store }: any) {
  const opts: MoveBase[] = store.promotion.options;
  const player = store.def.getTurn(store.state);
  const color = store.def.players[player].color;
  const glyphFor: Record<number, string> = { 5: '♛', 4: '♜', 3: '♝', 2: '♞' };
  return (
    <div className="modal-backdrop" onClick={() => store.choosePromotion(null)}>
      <div className="promo glass" onClick={(e) => e.stopPropagation()}>
        <div className="promo-title">Promote to…</div>
        <div className="promo-row">
          {opts.map((o) => (
            <button key={o.id} className="promo-piece" style={{ color }} onClick={() => store.choosePromotion(o)}>
              {glyphFor[(o as any).promo] ?? '♛'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
