import { useMemo } from 'react';
import type { EvalBand, GameDefinition, GameStatus } from '../engine/types';
import { BAND_META } from '../engine/grade';
import type { LogEntry } from '../store/useGameStore';
import './GameReview.css';

const QUALITY: Record<EvalBand, number> = {
  brilliant: 1, great: 1, best: 1, good: 0.92, book: 0.84, solid: 0.84,
  inaccuracy: 0.55, mistake: 0.32, blunder: 0.06,
};
const GOOD: EvalBand[] = ['brilliant', 'great', 'best', 'good'];
const BAD: EvalBand[] = ['inaccuracy', 'mistake', 'blunder'];

function accuracy(entries: LogEntry[]): number {
  const scored = entries.filter((e) => e.explanation);
  if (!scored.length) return 100;
  const avg = scored.reduce((s, e) => s + (QUALITY[e.explanation!.band] ?? 0.84), 0) / scored.length;
  return Math.round(avg * 100);
}

function counts(entries: LogEntry[]): Partial<Record<EvalBand, number>> {
  const c: Partial<Record<EvalBand, number>> = {};
  for (const e of entries) if (e.explanation) c[e.explanation.band] = (c[e.explanation.band] ?? 0) + 1;
  return c;
}

export default function GameReview({ def, log, status }: { def: GameDefinition; log: LogEntry[]; status: GameStatus }) {
  const p0 = useMemo(() => log.filter((e) => e.player === 0), [log]);
  const p1 = useMemo(() => log.filter((e) => e.player === 1), [log]);
  const acc0 = accuracy(p0);
  const acc1 = accuracy(p1);

  // Evaluation curve (white perspective), carrying the last known value forward.
  const k = def.id === 'chess' ? 350 : 600;
  const pts = useMemo(() => {
    let last = 0;
    return log.map((e) => {
      if (e.explanation) last = e.explanation.evalAfter;
      return Math.tanh(last / k);
    });
  }, [log, k]);

  const W = 320, H = 64;
  const path = pts.length > 1
    ? pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H / 2 - (v * H) / 2}`).join(' ')
    : '';
  const area = path ? `0,${H / 2} ${path} ${W},${H / 2}` : '';

  const keyMoments = log
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.explanation && (e.explanation.band === 'blunder' || e.explanation.band === 'brilliant' || e.explanation.band === 'mistake'))
    .slice(0, 4);

  const winner = status.kind === 'win' ? status.winner : null;

  return (
    <div className="review fade-in">
      <div className="review-head">
        <span className="review-emoji">{status.kind === 'draw' ? '🤝' : '🏆'}</span>
        <div>
          <strong>{status.kind === 'win' ? `${def.players[winner!].name} wins` : 'Draw'}</strong>
          <div className="faint" style={{ fontSize: 12.5 }}>Game review · {(status as any).reason}</div>
        </div>
      </div>

      <div className="acc-row">
        <AccCard def={def} who={0} acc={acc0} top={winner === 0} />
        <AccCard def={def} who={1} acc={acc1} top={winner === 1} />
      </div>

      <div className="evalgraph">
        <div className="eg-label">Evaluation</div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="eg-svg">
          <defs>
            <linearGradient id="egfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(232,237,247,0.35)" />
              <stop offset="50%" stopColor="rgba(232,237,247,0.05)" />
              <stop offset="100%" stopColor="rgba(10,12,20,0.35)" />
            </linearGradient>
          </defs>
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 3" />
          {area && <polygon points={area} fill="url(#egfill)" />}
          {path && <polyline points={path} fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinejoin="round" />}
        </svg>
      </div>

      <div className="breakdown">
        <BreakdownRow def={def} who={0} c={counts(p0)} />
        <BreakdownRow def={def} who={1} c={counts(p1)} />
      </div>

      {keyMoments.length > 0 && (
        <div className="key-moments">
          <div className="eg-label">Key moments</div>
          {keyMoments.map(({ e, i }) => {
            const meta = BAND_META[e.explanation!.band];
            return (
              <div className="km" key={i}>
                <span className="km-num">{Math.floor(i / 2) + 1}.</span>
                <span className="km-move">{e.notation}</span>
                <span className="km-band" style={{ color: meta.color }}>{meta.symbol} {meta.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccCard({ def, who, acc, top }: { def: GameDefinition; who: 0 | 1; acc: number; top: boolean }) {
  return (
    <div className={`acc-card ${top ? 'win' : ''}`}>
      <span className="acc-dot" style={{ background: def.players[who].color }} />
      <div className="acc-name">{def.players[who].name}</div>
      <div className="acc-val">{acc}<span className="acc-pct">%</span></div>
      <div className="acc-label">accuracy</div>
    </div>
  );
}

function BreakdownRow({ def, who, c }: { def: GameDefinition; who: 0 | 1; c: Partial<Record<EvalBand, number>> }) {
  const good = GOOD.reduce((s, b) => s + (c[b] ?? 0), 0);
  const bad = BAD.reduce((s, b) => s + (c[b] ?? 0), 0);
  return (
    <div className="bd-row">
      <span className="bd-name"><span className="acc-dot sm" style={{ background: def.players[who].color }} />{def.players[who].name}</span>
      <span className="bd-chip good">✓ {good} strong</span>
      {(c.brilliant || c.great) ? <span className="bd-chip brill">!! {(c.brilliant ?? 0) + (c.great ?? 0)}</span> : null}
      {c.mistake ? <span className="bd-chip warn">? {c.mistake}</span> : null}
      {c.blunder ? <span className="bd-chip bad">?? {c.blunder}</span> : null}
      {bad === 0 && <span className="bd-chip clean">clean</span>}
    </div>
  );
}
