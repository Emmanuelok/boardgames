import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  REVIEW_RECORDS_CHANGED_EVENT,
  REVIEW_RECORDS_STORAGE_KEY,
  loadRecords,
  clearRecords,
  type GameRecord,
} from '../engine/reviewSummary';
import { getGame } from '../engine/registry';
import { BAND_META } from '../engine/grade';
import JourneyContext from '../components/JourneyContext';
import { useLearningMemory } from '../intelligence/learningMemory';
import { readMissionContext } from '../intelligence/missionRouting';
import './ReviewHub.css';

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function evaluationSummary(pts: number[], p0: string, p1: string): string {
  if (pts.length < 2) return 'Not enough graded moves to draw an evaluation trend yet.';
  const final = pts[pts.length - 1];
  const finish = Math.abs(final) < 0.14
    ? 'The game finished close to balanced'
    : `The final evaluation favored ${final > 0 ? p0 : p1}`;
  const swings = pts.slice(1).filter((value, index) => Math.abs(value - pts[index]) >= 0.34).length;
  return `${finish}. ${swings === 0 ? 'No major evaluation swings were recorded' : `${swings} major evaluation swing${swings === 1 ? ' was' : 's were'} recorded`}.`;
}

function Spark({ id, pts, accent, p0, p1 }: { id: string; pts: number[]; accent: string; p0: string; p1: string }) {
  const W = 300, H = 50;
  const summary = evaluationSummary(pts, p0, p1);
  if (pts.length < 2) {
    return (
      <figure className="rv-spark-figure">
        <div className="rv-spark empty" role="img" aria-label={summary} />
        <figcaption>{summary}</figcaption>
      </figure>
    );
  }
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * W},${H / 2 - (v * H) / 2}`).join(' ');
  const safeId = `rv-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <figure className="rv-spark-figure">
      <svg className="rv-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby={`${safeId}-title ${safeId}-desc`}>
        <title id={`${safeId}-title`}>Evaluation trend</title>
        <desc id={`${safeId}-desc`}>{summary}</desc>
        <defs>
          <linearGradient id={`${safeId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="3 3" />
        <polygon points={`0,${H / 2} ${path} ${W},${H / 2}`} fill={`url(#${safeId}-fill)`} />
        <polyline points={path} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <figcaption>{summary}</figcaption>
    </figure>
  );
}

export default function ReviewHub() {
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState<GameRecord[]>(() => loadRecords());
  const [open, setOpen] = useState<string | null>(null);
  const missionContext = readMissionContext(searchParams);
  const activeMission = useLearningMemory((state) => state.activeMission);
  const learningEvents = useLearningMemory((state) => state.events);
  const journeyStage = missionContext?.stage === 'observe' || missionContext?.stage === 'reflect'
    ? missionContext.stage
    : null;
  const missionGameId = (
    journeyStage
    && activeMission?.id === missionContext?.missionId
  ) ? activeMission?.gameId : undefined;
  const missionGame = missionGameId ? getGame(missionGameId) : undefined;
  const playStep = activeMission?.steps.find((step) => step.stage === 'play');
  const playEvidence = playStep?.evidenceEventId
    ? learningEvents.find((event) => event.id === playStep.evidenceEventId)
    : undefined;
  const canReflectOnMission = (
    journeyStage === 'reflect'
    && activeMission?.id === missionContext?.missionId
    && activeMission?.currentStage === 'reflect'
    && !!playEvidence
  );

  useEffect(() => {
    const refresh = () => setRecords(loadRecords());
    const onStorage = (event: StorageEvent) => {
      if (event.key === REVIEW_RECORDS_STORAGE_KEY) refresh();
    };
    window.addEventListener(REVIEW_RECORDS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(REVIEW_RECORDS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const wipe = () => {
    if (!confirm('Clear your game review history?')) return;
    const memory = useLearningMemory.getState();
    const observeStep = memory.activeMission?.steps.find((step) => step.stage === 'observe');
    if (
      memory.activeMission?.currentStage === 'observe'
      && observeStep?.target.kind === 'review_opened'
    ) {
      // That mission was created from the review being removed. Resetting lets
      // My Path immediately build a baseline-match route instead of looping.
      memory.reset();
    }
    clearRecords();
    setRecords([]);
  };
  const recordReflection = (evidenceId: string) => {
    const memory = useLearningMemory.getState();
    const mission = memory.activeMission;
    if (
      !mission
      || mission.id !== missionContext?.missionId
      || mission.currentStage !== 'reflect'
    ) return;
    memory.recordEvent({
      id: `review:${mission.id}:reflect:${evidenceId}`,
      at: Date.now(),
      kind: 'reflection_completed',
      missionId: mission.id,
      gameId: mission.gameId,
      stage: 'reflect',
      sourceId: `reflection:${mission.gameId}:after-play`,
      outcome: 'complete',
    });
  };
  const toggleReview = (record: GameRecord, isOpen: boolean) => {
    setOpen(isOpen ? null : record.id);
    if (isOpen || !journeyStage) return;
    const memory = useLearningMemory.getState();
    const mission = memory.activeMission;
    if (
      !mission
      || mission.id !== missionContext?.missionId
      || mission.gameId !== record.gameId
      || mission.currentStage !== journeyStage
    ) return;
    // Opening an older or current record is useful context, but Reflect is only
    // complete after the learner explicitly finishes the reflection prompts.
    if (journeyStage === 'reflect') return;
    memory.recordEvent({
      id: `review:${mission.id}:${journeyStage}:${record.id}`,
      at: Date.now(),
      kind: 'review_opened',
      missionId: mission.id,
      gameId: record.gameId,
      stage: journeyStage,
      sourceId: `review:${record.gameId}`,
      outcome: 'complete',
    });
  };

  return (
    <div className="reviewhub">
      {missionGame && journeyStage && (
        <JourneyContext
          gameId={missionGame.id}
          gameName={missionGame.name}
          gameEmoji={missionGame.emoji}
          stage={journeyStage}
        />
      )}
      <header className="rv-hero" aria-labelledby="reviews-title">
        <img
          className={`rv-hero-art ${records.length === 0 ? 'rv-empty-visual' : ''}`}
          src="/assets/review-laboratory.webp"
          alt={records.length === 0 ? 'A strategy board connected to evaluation curves and highlighted decision points.' : ''}
          width="1600"
          height="854"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="rv-hero-veil" />
        <div className="rv-copy">
          <span className="section-overline">Review analyst · evidence after every game</span>
          <h1 id="reviews-title">Turn decisive moments into your next advantage.</h1>
          <p>Accuracy, evaluation shifts and key decisions stay together, so the lesson from one board can shape what you practice next.</p>
          <div className="rv-hero-actions">
            <span className="rv-count">{records.length} saved review{records.length === 1 ? '' : 's'}</span>
            {records.length > 0
              ? <button type="button" className="btn ghost sm" onClick={wipe}>Clear history</button>
              : canReflectOnMission
                ? <span className="rv-preparing">Detailed move analysis may still be processing.</span>
                : missionGame
                  ? <Link className="btn primary" to="/path">Return to My Path</Link>
                  : <Link className="btn primary" to="/play/chess">Play a game to create evidence</Link>}
          </div>
        </div>
      </header>

      {canReflectOnMission && missionGame && playEvidence && (
        <section className="rv-mission-reflection glass" aria-labelledby="mission-reflection-title">
          <div className="rv-reflection-mark" aria-hidden="true">⌁</div>
          <div>
            <span className="section-overline">Latest mission evidence · {ago(playEvidence.at)}</span>
            <h2 id="mission-reflection-title">Close the loop on {missionGame.name}.</h2>
            <p>Before the next mission, name the idea you tried, the decision that changed the position, and one signal you will notice earlier next time.</p>
            <div className="rv-reflection-prompts" role="list">
              <span role="listitem">What did I intend?</span>
              <span role="listitem">What actually changed?</span>
              <span role="listitem">What will I test next?</span>
            </div>
          </div>
          <button className="btn primary" type="button" onClick={() => recordReflection(playEvidence.id)}>Finish reflection →</button>
        </section>
      )}

      {records.length === 0 ? (
        <section className="rv-empty glass-soft" aria-labelledby="empty-review-title">
          <span className="section-overline">What your first review will preserve</span>
          <h2 id="empty-review-title">No review history yet.</h2>
          <p className="muted">Finish a game against the engine and it lands here as a compact learning record.</p>
          <div className="rv-empty-signals" role="list">
            <div role="listitem"><span aria-hidden="true">⌁</span><strong>Evaluation flow</strong><small>See when the balance changed.</small></div>
            <div role="listitem"><span aria-hidden="true">◎</span><strong>Decision quality</strong><small>Compare accuracy by side.</small></div>
            <div role="listitem"><span aria-hidden="true">✦</span><strong>Key moments</strong><small>Return to the choices that mattered.</small></div>
          </div>
        </section>
      ) : (
        <div className="rv-list">
          {records.map((r) => {
            const isOpen = open === r.id;
            return (
              <article className={`rv-card glass ${isOpen ? 'open' : ''}`} key={r.id} style={{ ['--accent' as any]: r.accent }}>
                <button type="button" className="rv-card-head" aria-expanded={isOpen} aria-controls={`review-${r.id}`} onClick={() => toggleReview(r, isOpen)}>
                  <span className="rv-emoji" aria-hidden="true">{r.emoji}</span>
                  <div className="rv-id">
                    <strong>{r.gameName}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>{ago(r.ts)} · {r.moves} moves</span>
                  </div>
                  <span className={`rv-result ${r.result}`}>{r.result === 'win' ? 'Win' : r.result === 'loss' ? 'Loss' : 'Draw'}</span>
                </button>

                <div className="rv-mid">
                  <Spark id={r.id} pts={r.evalPts} accent={r.accent} p0={r.p0} p1={r.p1} />
                  <div className="rv-acc">
                    <span className="rv-acc-chip"><b>{r.graded?.[0] === 0 ? '—' : `${r.acc[0]}%`}</b> {r.p0}</span>
                    <span className="rv-acc-chip"><b>{r.graded?.[1] === 0 ? '—' : `${r.acc[1]}%`}</b> {r.p1}</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="rv-detail" id={`review-${r.id}`}>
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
                    <div className="rv-next-actions">
                      <Link className="btn sm" to={`/puzzles?game=${encodeURIComponent(r.gameId)}`}>Practise this pattern</Link>
                      <Link className="btn sm primary" to={`/play/${r.gameId}`}>Play {r.gameName} again →</Link>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
