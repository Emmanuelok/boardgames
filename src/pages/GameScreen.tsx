import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore';
import { getGame } from '../engine/registry';
import { getTheme } from '../themes/boardThemes';
import Board2D from '../components/Board2D';
import TutorPanel from '../components/TutorPanel';
import ThemePicker from '../components/ThemePicker';
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
  const [tab, setTab] = useState<'tutor' | 'moves' | 'setup'>('tutor');
  const [themeOpen, setThemeOpen] = useState(false);

  useEffect(() => {
    if (gameId && getGame(gameId)) useGameStore.getState().newGame(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    if (!store.toast) return;
    const t = setTimeout(() => useGameStore.getState().setToast(null), 2600);
    return () => clearTimeout(t);
  }, [store.toast]);

  const def = store.def;
  if (!def || !store.state || def.id !== gameId) {
    return <div className="loading">Loading…</div>;
  }

  const theme = getTheme(store.themeId);
  const view = def.getBoardView(store.state);
  const turn = def.getTurn(store.state) as Player;
  const bottom: Player = (store.flipped ? 1 : 0) as Player;
  const top: Player = (1 - bottom) as Player;
  const over = store.status.kind === 'win' || store.status.kind === 'draw';

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
          <div className="seg">
            <button className={store.view === '2d' ? 'on' : ''} onClick={() => store.setView('2d')}>2D</button>
            <button className={store.view === '3d' ? 'on' : ''} onClick={() => store.setView('3d')}>3D</button>
          </div>
          <button className="btn sm" onClick={() => setThemeOpen(true)}>🎨 Theme</button>
          <Link className="btn sm ghost" to={`/learn/${def.id}`}>📖 Learn</Link>
        </div>
      </header>

      <div className="play-area">
        <div className="board-col">
          <PlayerTag def={def} who={top} turn={turn} thinking={store.thinking} store={store} />
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
              />
            )}
          </div>
          <PlayerTag def={def} who={bottom} turn={turn} thinking={store.thinking} store={store} you />
        </div>

        <aside className="side-col">
          <div className="controls glass-soft">
            <button className="btn sm primary" onClick={store.restart}>↻ New</button>
            <button className="btn sm" onClick={store.undo} disabled={store.past.length === 0}>↶ Undo</button>
            <button className="btn sm" onClick={store.redo} disabled={store.future.length === 0}>↷ Redo</button>
            <button className="btn sm" onClick={store.requestHint} disabled={over}>💡 Hint</button>
            <button className="btn sm" onClick={store.toggleFlip}>⇅ Flip</button>
          </div>

          <div className="tabs">
            {(['tutor', 'moves', 'setup'] as const).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                {t === 'tutor' ? '🧠 Tutor' : t === 'moves' ? '📜 Moves' : '⚙ Setup'}
              </button>
            ))}
          </div>

          <div className="tab-panel">
            {tab === 'tutor' && <TutorPanel />}
            {tab === 'moves' && <MoveLog store={store} />}
            {tab === 'setup' && <Setup store={store} def={def} />}
          </div>
        </aside>
      </div>

      {themeOpen && <ThemePicker current={store.themeId} onPick={(id) => store.setTheme(id)} onClose={() => setThemeOpen(false)} />}
      {store.promotion && <Promotion store={store} />}
      {store.toast && <div className="toast glass">{store.toast}</div>}
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

function PlayerTag({ def, who, turn, thinking, store, you }: any) {
  const isAI = store.mode === 'ai' && who !== store.humanColor;
  const active = turn === who && store.status.kind !== 'win' && store.status.kind !== 'draw';
  return (
    <div className={`player-tag ${active ? 'active' : ''}`}>
      <span className="pt-swatch" style={{ background: def.players[who].color }} />
      <div className="col" style={{ lineHeight: 1.15 }}>
        <strong>{def.players[who].name}</strong>
        <span className="faint" style={{ fontSize: 11 }}>{store.mode === 'pass' ? 'Player' : isAI ? 'AI Engine' : you ? 'You' : 'You'}</span>
      </div>
      {active && isAI && thinking && <span className="pt-think">thinking…</span>}
      {active && <span className="pt-pulse" />}
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
  return (
    <div className="setup glass-soft">
      <Field label="Opponent">
        <div className="seg full">
          <button className={store.mode === 'ai' ? 'on' : ''} onClick={() => restartWith(() => store.setMode('ai'))}>vs AI</button>
          <button className={store.mode === 'pass' ? 'on' : ''} onClick={() => restartWith(() => store.setMode('pass'))}>Pass &amp; Play</button>
        </div>
      </Field>

      {store.mode === 'ai' && (
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
