import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { OPENINGS, type OpeningInfo } from '../games/chess/openings';
import chess from '../games/chess';
import MiniBoard from '../components/MiniBoard';
import OpeningTrainer from '../components/OpeningTrainer';
import OpeningGauntlet from '../components/OpeningGauntlet';
import { getTheme } from '../themes/boardThemes';
import './Openings.css';

const clean = (s: string) => s.replace(/[+#!?]/g, '');
const groupOf = (o: OpeningInfo) => (o.moves[0] === 'e4' ? '1.e4' : o.moves[0] === 'd4' ? '1.d4' : 'Flank & others');
const GROUPS = ['1.e4', '1.d4', 'Flank & others'] as const;

/** Replay a SAN line through the chess engine, capturing a FEN and last-move squares per ply. */
function replay(sanMoves: string[]): { fens: string[]; last: (number[] | null)[] } {
  const fens: string[] = [];
  const last: (number[] | null)[] = [null];
  let s = chess.createInitialState();
  fens.push(chess.serialize(s));
  for (const san of sanMoves) {
    const m = chess.getLegalMoves(s).find((mv) => clean(mv.notation) === clean(san));
    if (!m) break;
    s = chess.applyMove(s, m);
    fens.push(chess.serialize(s));
    last.push(m.from != null ? [m.from, m.to] : null);
  }
  return { fens, last };
}

export default function Openings() {
  const theme = getTheme('wood-walnut');
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('1.e4');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<OpeningInfo>(() => OPENINGS.find((o) => o.name.includes('Ruy López (Spanish')) ?? OPENINGS[0]);
  const [ply, setPly] = useState(selected.moves.length);
  const [playing, setPlaying] = useState(false);
  const [training, setTraining] = useState(false);
  const [gauntlet, setGauntlet] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return OPENINGS.filter((o) => (q ? (o.name.toLowerCase().includes(q) || o.eco.toLowerCase().includes(q)) : groupOf(o) === group));
  }, [group, query]);

  const { fens, last } = useMemo(() => replay(selected.moves), [selected]);
  const maxPly = fens.length - 1;
  const clamped = Math.min(ply, maxPly);

  const pick = (o: OpeningInfo) => { setSelected(o); setPly(o.moves.length); setPlaying(false); };

  // Auto-play through the line.
  useEffect(() => {
    if (!playing) return;
    if (clamped >= maxPly) { setPlaying(false); return; }
    const t = setTimeout(() => setPly((p) => Math.min(maxPly, p + 1)), 850);
    return () => clearTimeout(t);
  }, [playing, clamped, maxPly]);

  const restartPlay = () => { setPly(0); setPlaying(true); };

  return (
    <div className="openings">
      <header className="op-top">
        <Link to="/" className="btn ghost sm">← Hub</Link>
        <div className="gs-title"><span className="gs-emoji">📖</span><div className="col"><strong>Openings Explorer</strong><span className="faint" style={{ fontSize: 12 }}>{OPENINGS.length} named openings · step through every line</span></div></div>
        <div className="row gap-xs">
          {!gauntlet && <button className="btn sm" onClick={() => setGauntlet(true)}>⚡ Gauntlet</button>}
          <Link to="/play/chess" className="btn sm primary">Play chess</Link>
        </div>
      </header>

      {gauntlet ? (
        <div className="op-solo"><OpeningGauntlet theme={theme} onExit={() => setGauntlet(false)} /></div>
      ) : (
      <div className="op-grid">
        <aside className="op-list-col">
          <input className="op-search" placeholder="Search openings or ECO…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {!query && (
            <div className="op-tabs">
              {GROUPS.map((g) => <button key={g} className={`op-tab ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>{g}</button>)}
            </div>
          )}
          <div className="op-list">
            {list.map((o) => (
              <button key={o.eco + o.name + o.moves.length} className={`op-item ${selected === o ? 'on' : ''}`} onClick={() => pick(o)}>
                <span className="op-eco">{o.eco}</span>
                <span className="op-name">{o.name}</span>
              </button>
            ))}
            {list.length === 0 && <div className="op-empty">No openings match “{query}”.</div>}
          </div>
        </aside>

        {training ? (
          <OpeningTrainer opening={selected} theme={theme} onExit={() => setTraining(false)} />
        ) : (
        <section className="op-detail glass">
          <div className="op-detail-head">
            <span className="chip op-chip">{selected.eco}</span>
            <h2>{selected.name}</h2>
            <button className="btn sm primary op-practice" onClick={() => setTraining(true)}>🎓 Practice</button>
          </div>
          <div className="op-board">
            <MiniBoard def={chess as any} setup={fens[clamped]} theme={theme} highlight={last[clamped] ?? []} />
          </div>

          <div className="op-controls">
            <button className="btn icon sm" onClick={() => { setPlaying(false); setPly(0); }} title="Start">⏮</button>
            <button className="btn icon sm" onClick={() => { setPlaying(false); setPly((p) => Math.max(0, p - 1)); }} title="Back">◀</button>
            <button className="btn sm" onClick={() => (playing ? setPlaying(false) : restartPlay())}>{playing ? '⏸ Pause' : '▶ Play'}</button>
            <button className="btn icon sm" onClick={() => { setPlaying(false); setPly((p) => Math.min(maxPly, p + 1)); }} title="Forward">▶</button>
            <button className="btn icon sm" onClick={() => { setPlaying(false); setPly(maxPly); }} title="End">⏭</button>
          </div>

          <div className="op-moves">
            <button className={`op-move ${clamped === 0 ? 'on' : ''}`} onClick={() => { setPlaying(false); setPly(0); }}>start</button>
            {selected.moves.map((m, i) => (
              <button key={i} className={`op-move ${clamped === i + 1 ? 'on' : ''}`} onClick={() => { setPlaying(false); setPly(i + 1); }}>
                {i % 2 === 0 ? <span className="op-num">{Math.floor(i / 2) + 1}.</span> : null}{m}
              </button>
            ))}
          </div>

          {selected.idea && <p className="op-idea">💡 {selected.idea}</p>}
          <Link to="/play/chess" className="btn primary op-play">Play this out vs the engine →</Link>
        </section>
        )}
      </div>
      )}
    </div>
  );
}
