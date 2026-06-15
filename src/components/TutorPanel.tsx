import { useGameStore } from '../store/useGameStore';
import { BAND_META } from '../engine/grade';
import type { GameStatus, MoveExplanation, Player } from '../engine/types';
import GameReview from './GameReview';
import './TutorPanel.css';

export default function TutorPanel() {
  const def = useGameStore((s) => s.def);
  const log = useGameStore((s) => s.log);
  const thinking = useGameStore((s) => s.thinking);
  const status = useGameStore((s) => s.status);
  const hintText = useGameStore((s) => s.hintText);
  const liveThreats = useGameStore((s) => s.liveThreats);
  const autoTutor = useGameStore((s) => s.autoTutor);
  const toggleAutoTutor = useGameStore((s) => s.toggleAutoTutor);
  if (!def) return null;

  const last = log[log.length - 1];
  const exp = last?.explanation;

  return (
    <div className="tutor glass">
      <div className="tutor-head">
        <div className="row gap-sm" style={{ alignItems: 'center' }}>
          <span className="tutor-orb">🧠</span>
          <div className="col">
            <strong>AI Tutor</strong>
            <span className="faint" style={{ fontSize: 12 }}>Move-by-move coaching</span>
          </div>
        </div>
        <button className={`chip clickable ${autoTutor ? 'active' : ''}`} onClick={toggleAutoTutor} title="Explain every move">
          {autoTutor ? 'Auto ✓' : 'Auto'}
        </button>
      </div>

      <div className="tutor-body">
        {status.kind === 'win' || status.kind === 'draw' ? (
          <GameReview def={def} log={log} status={status} />
        ) : null}

        {thinking && (
          <div className="tutor-thinking fade-in">
            <span className="dots"><i /><i /><i /></span>
            <span className="muted">The engine is calculating its reply…</span>
          </div>
        )}

        {!thinking && liveThreats.length > 0 && (
          <div className="threat-warn fade-in">
            <span className="tw-ic">⚠</span>
            <div className="tw-body">
              <strong className="tw-title">Watch out</strong>
              {liveThreats.map((t, i) => <div key={i} className="tw-line">{t}</div>)}
            </div>
          </div>
        )}

        {hintText && (
          <div className="hint-card fade-in">
            <span className="hint-ic">💡</span>
            <div><strong>Hint.</strong> {hintText}</div>
          </div>
        )}

        {last && last.analyzing && !exp && (
          <div className="analyzing fade-in">
            <div className="shimmer" />
            <div className="shimmer short" />
            <span className="faint">Analysing {last.notation}…</span>
          </div>
        )}

        {exp ? (
          <Explanation def={def} exp={exp} notation={last.notation} player={last.player} />
        ) : !last ? (
          <Intro def={def} />
        ) : null}
      </div>
    </div>
  );
}

function Explanation({ def, exp, notation, player }: { def: any; exp: MoveExplanation; notation: string; player: Player }) {
  const meta = BAND_META[exp.band];
  return (
    <div className="explanation fade-in" key={notation}>
      <div className="exp-top">
        <span className="grade" style={{ background: `${meta.color}22`, color: meta.color, borderColor: `${meta.color}66` }}>
          <span className="grade-sym">{meta.symbol}</span> {meta.label}
        </span>
        <span className="move-tag">
          <span className="dotc" style={{ background: def.players[player].color }} />
          {def.players[player].name}: <strong>{notation}</strong>
        </span>
      </div>

      <EvalBar def={def} evalAfter={exp.evalAfter} />

      <p className="summary">{exp.summary}</p>

      {exp.insights.length > 0 && (
        <ul className="insights">
          {exp.insights.map((ins, i) => (
            <li key={i} className={`ins ${ins.tone}`}>
              <span className="ins-ic">{ins.tone === 'good' ? '✓' : ins.tone === 'bad' ? '✕' : '•'}</span>
              <span><strong>{ins.tag}.</strong> {ins.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {exp.threats && exp.threats.length > 0 && (
        <div className="block threats">
          <div className="block-label">⚔ Threats</div>
          {exp.threats.map((t, i) => <div key={i} className="threat-line">{t}</div>)}
        </div>
      )}

      {exp.betterIdea && (
        <div className="block better">
          <div className="block-label">↗ Stronger idea</div>
          <div>{exp.betterIdea}</div>
        </div>
      )}

      {exp.principles.length > 0 && (
        <div className="principles">
          {exp.principles.map((p, i) => <span key={i} className="chip principle">{p}</span>)}
        </div>
      )}
    </div>
  );
}

function EvalBar({ def, evalAfter }: { def: any; evalAfter: number }) {
  const k = def.id === 'chess' ? 350 : 600;
  const pct = 50 + 50 * Math.tanh(evalAfter / k);
  const isChess = def.id === 'chess';
  const big = Math.abs(evalAfter) > 9000;
  const label = big
    ? (evalAfter > 0 ? `${def.players[0].name} winning` : `${def.players[1].name} winning`)
    : isChess
      ? `${evalAfter >= 0 ? '+' : ''}${(evalAfter / 100).toFixed(1)}`
      : Math.abs(evalAfter) < (def.id === 'reversi' ? 30 : 60)
        ? 'Even'
        : `${evalAfter > 0 ? def.players[0].name : def.players[1].name} ahead`;
  return (
    <div className="evalbar" title="Position evaluation">
      <div className="evalbar-track">
        <div className="evalbar-fill" style={{ width: `${pct}%` }} />
        <div className="evalbar-knob" style={{ left: `${pct}%` }} />
      </div>
      <span className="evalbar-label">{label}</span>
    </div>
  );
}

function ResultBanner({ def, status }: { def: any; status: GameStatus }) {
  if (status.kind === 'win') {
    return (
      <div className="result win fade-in">
        <div className="result-emoji">🏆</div>
        <div>
          <strong>{def.players[status.winner].name} wins!</strong>
          <div className="muted" style={{ fontSize: 13 }}>by {status.reason}</div>
        </div>
      </div>
    );
  }
  if (status.kind === 'draw') {
    return (
      <div className="result draw fade-in">
        <div className="result-emoji">🤝</div>
        <div>
          <strong>It's a draw</strong>
          <div className="muted" style={{ fontSize: 13 }}>{status.reason}</div>
        </div>
      </div>
    );
  }
  return null;
}

function Intro({ def }: { def: any }) {
  return (
    <div className="intro fade-in">
      <div className="intro-emoji">{def.emoji}</div>
      <p className="summary" style={{ marginTop: 4 }}>{def.tutorial.objective}</p>
      <p className="faint" style={{ fontSize: 13 }}>
        Make a move and I'll grade it, explain the idea, point out tactics, and show you a stronger plan when you miss one.
      </p>
    </div>
  );
}
