import { useState } from 'react';
import { Link } from 'react-router-dom';
import { loadRecords, clearRecords, type GameRecord } from '../engine/reviewSummary';
import { BAND_META } from '../engine/grade';
import './ReviewHub.css';

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Spark({ pts, accent }: { pts: number[]; accent: string }) {
  const W = 300, H = 50;
  if (pts.length < 2) return <div className="rv-spark empty" />;
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H / 2 - (v * H) / 2}`).join(' ');
  return (
    <svg className="rv-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`rv-${accent.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="3 3" />
      <polygon points={`0,${H / 2} ${path} ${W},${H / 2}`} fill={`url(#rv-${accent.replace('#', '')})`} />
      <polyline points={path} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function ReviewHub() {
  const [records, setRecords] = useState<GameRecord[]>(() => loadRecords());
  const [open, setOpen] = useState<string | null>(null);

  const wipe = () => { if (confirm('Clear your game review history?')) { clearRecords(); setRecords([]); } };

  return (
    <div className="reviewhub">
      <header className="rv-top">
        <Link to="/" className="btn ghost sm">← Hub</Link>
        <div className="gs-title"><span className="gs-emoji">🗂</span><div className="col"><strong>Game Reviews</strong><span className="faint" style={{ fontSize: 12 }}>{records.length} recent game{records.length === 1 ? '' : 's'} · accuracy & evaluation</span></div></div>
        {records.length > 0 && <button className="btn ghost sm" onClick={wipe}>Clear</button>}
      </header>

      {records.length === 0 ? (
        <div className="rv-empty glass-soft">
          <span style={{ fontSize: 40 }}>🗂</span>
          <h2>No reviews yet</h2>
          <p className="muted">Finish a game against the engine and it lands here — with your accuracy, the evaluation graph and the key moments.</p>
          <Link className="btn primary" to="/play/chess">Play a game</Link>
        </div>
      ) : (
        <div className="rv-list">
          {records.map((r) => {
            const isOpen = open === r.id;
            return (
              <div className={`rv-card glass ${isOpen ? 'open' : ''}`} key={r.id} style={{ ['--accent' as any]: r.accent }}>
                <button className="rv-card-head" onClick={() => setOpen(isOpen ? null : r.id)}>
                  <span className="rv-emoji">{r.emoji}</span>
                  <div className="rv-id">
                    <strong>{r.gameName}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>{ago(r.ts)} · {r.moves} moves</span>
                  </div>
                  <span className={`rv-result ${r.result}`}>{r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : 'Draw'}</span>
                </button>

                <div className="rv-mid">
                  <Spark pts={r.evalPts} accent={r.accent} />
                  <div className="rv-acc">
                    <span className="rv-acc-chip"><b>{r.acc[0]}%</b> {r.p0}</span>
                    <span className="rv-acc-chip"><b>{r.acc[1]}%</b> {r.p1}</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="rv-detail">
                    {r.key.length > 0 ? (
                      <>
                        <div className="rv-km-label">Key moments</div>
                        {r.key.map((m, i) => {
                          const meta = BAND_META[m.band];
                          return (
                            <div className="rv-km" key={i}>
                              <span className="rv-km-n">{m.n}.</span>
                              <span className="rv-km-move">{m.notation}</span>
                              <span className="rv-km-band" style={{ color: meta.color }}>{meta.symbol} {meta.label}</span>
                            </div>
                          );
                        })}
                      </>
                    ) : <div className="rv-km-label">A clean game — no blunders or brilliancies flagged.</div>}
                    <Link className="btn sm primary rv-again" to={`/play/${r.gameId}`}>Play {r.gameName} again →</Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
