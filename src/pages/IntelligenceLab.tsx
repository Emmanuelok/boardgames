import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import MiniBoard from '../components/MiniBoard';
import {
  loadRecords,
  REVIEW_RECORDS_CHANGED_EVENT,
  type GameRecord,
} from '../engine/reviewSummary';
import { getGame } from '../engine/registry';
import { BAND_META } from '../engine/grade';
import { getTheme } from '../themes/boardThemes';
import { useProfile } from '../profile/profile';
import { buildStrategyProfile, type StrategyProfile } from '../intelligence/strategyProfile';
import {
  buildCrossGameRoutes,
  type CrossGameRoute,
} from '../intelligence/crossGameTraining';
import {
  classifyPrinciples,
  STRATEGY_CONCEPT_BY_ID,
  type StrategyConceptId,
} from '../intelligence/strategyConcepts';
import {
  LAB_CHANGED_EVENT,
  LAB_STORAGE_KEY,
  addGeneratedDrill,
  completedDrillsAsSkillEvidence,
  loadLabState,
  recordCompletedDrill,
  removeLabAnnotation,
  upsertLabAnnotation,
  type LabState,
} from '../intelligence/labStore';
import './IntelligenceLab.css';

type LabTab = 'replay' | 'dna' | 'transfer' | 'coach';

const TABS: Array<{ id: LabTab; label: string; eyebrow: string; icon: string }> = [
  { id: 'replay', label: 'Replay Lab', eyebrow: 'Reconstruct', icon: '⌁' },
  { id: 'dna', label: 'Strategy DNA', eyebrow: 'Measure', icon: '◉' },
  { id: 'transfer', label: 'Cross-game training', eyebrow: 'Transfer', icon: '⇄' },
  { id: 'coach', label: 'Explainable Coach', eyebrow: 'Understand', icon: '◇' },
];

function isTab(value: string | null): value is LabTab {
  return TABS.some((tab) => tab.id === value);
}

function useReviewRecords(): GameRecord[] {
  const [records, setRecords] = useState<GameRecord[]>(() => loadRecords());
  useEffect(() => {
    const refresh = () => setRecords(loadRecords());
    window.addEventListener(REVIEW_RECORDS_CHANGED_EVENT, refresh);
    const storage = (event: StorageEvent) => {
      if (event.key === 'gm-reviews') refresh();
    };
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(REVIEW_RECORDS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return records;
}

function useLabSnapshot(): [LabState, () => void] {
  const [state, setState] = useState<LabState>(() => loadLabState());
  const refresh = () => setState(loadLabState());
  useEffect(() => {
    window.addEventListener(LAB_CHANGED_EVENT, refresh);
    const storage = (event: StorageEvent) => {
      if (event.key === LAB_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(LAB_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', storage);
    };
  }, []);
  return [state, refresh];
}

function relativeDate(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function IntelligenceLab() {
  const records = useReviewRecords();
  const profileState = useProfile();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const activeTab: LabTab = isTab(requestedTab) ? requestedTab : 'replay';
  const [labState, refreshLab] = useLabSnapshot();

  const profile = useMemo(() => buildStrategyProfile({
    reviews: records,
    profile: { rating: profileState.rating, stats: profileState.stats },
    puzzleEvidence: completedDrillsAsSkillEvidence(labState),
  }), [records, profileState.rating, profileState.stats, labState]);
  const routes = useMemo(() => buildCrossGameRoutes(profile), [profile]);

  const openTab = (tab: LabTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', tab);
    setParams(next, { replace: true });
  };

  return (
    <div className="intelligence-lab">
      <header className="il-hero" aria-labelledby="intelligence-title">
        <img
          src="/assets/adaptive-intelligence.webp"
          alt=""
          width="1600"
          height="900"
          decoding="async"
          fetchPriority="high"
        />
        <div className="il-hero-veil" />
        <div className="il-hero-copy">
          <span className="section-overline">One evidence layer · every strategy world</span>
          <h1 id="intelligence-title">See how you think, not only whether you won.</h1>
          <p>Reconstruct decisions, preserve your own annotations, measure transferable skills and turn a missed idea into a deliberate drill.</p>
          <div className="il-proof" role="list" aria-label="Available learning evidence">
            <span role="listitem"><b>{records.length}</b> saved reviews</span>
            <span role="listitem"><b>{profile.measuredConcepts}</b> measured skills</span>
            <span role="listitem"><b>{labState.generatedDrills.length}</b> generated drills</span>
          </div>
        </div>
      </header>

      <nav className="il-tabs" aria-label="Intelligence Lab tools">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => openTab(tab.id)}
          >
            <span aria-hidden="true">{tab.icon}</span>
            <span><small>{tab.eyebrow}</small><strong>{tab.label}</strong></span>
          </button>
        ))}
      </nav>

      <div className="il-stage">
        {activeTab === 'replay' && (
          <ReplayLab
            records={records}
            profile={profile}
            labState={labState}
            refreshLab={refreshLab}
            openTab={openTab}
          />
        )}
        {activeTab === 'dna' && <StrategyDNA profile={profile} records={records} openTab={openTab} />}
        {activeTab === 'transfer' && (
          <CrossGameTraining
            routes={routes}
            profile={profile}
            labState={labState}
            refreshLab={refreshLab}
          />
        )}
        {activeTab === 'coach' && (
          <ExplainableCoach records={records} profile={profile} openReplay={() => openTab('replay')} />
        )}
      </div>
    </div>
  );
}

function RecordPicker({
  records,
  selectedId,
  onChange,
  replayOnly = false,
}: {
  records: GameRecord[];
  selectedId: string;
  onChange: (id: string) => void;
  replayOnly?: boolean;
}) {
  const available = replayOnly ? records.filter((record) => record.replay) : records;
  return (
    <label className="il-picker">
      <span>Saved game</span>
      <select value={selectedId} onChange={(event) => onChange(event.target.value)}>
        {available.map((record) => (
          <option value={record.id} key={record.id}>
            {record.gameName} · {relativeDate(record.ts)} · {record.result}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyEvidence({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="il-empty glass-soft" aria-live="polite">
      <span aria-hidden="true">◇</span>
      <h2>{title}</h2>
      <p>{children}</p>
      <div className="il-empty-actions">
        <Link className="btn primary" to="/games">Choose a game</Link>
        <Link className="btn" to="/path">Open My Path</Link>
      </div>
    </section>
  );
}

function ReplayLab({
  records,
  profile,
  labState,
  refreshLab,
  openTab,
}: {
  records: GameRecord[];
  profile: StrategyProfile;
  labState: LabState;
  refreshLab: () => void;
  openTab: (tab: LabTab) => void;
}) {
  const replayRecords = records.filter((record) => record.replay?.frames.length);
  const [selectedId, setSelectedId] = useState(() => replayRecords[0]?.id ?? records[0]?.id ?? '');
  const [frameIndex, setFrameIndex] = useState(0);
  const [note, setNote] = useState('');
  const selected = records.find((record) => record.id === selectedId) ?? replayRecords[0] ?? records[0];
  const frames = selected?.replay?.frames ?? [];
  const frame = frames[Math.min(frameIndex, Math.max(0, frames.length - 1))];
  const def = getGame(selected?.gameId);
  const theme = getTheme('tournament-green');

  useEffect(() => {
    setFrameIndex(0);
  }, [selected?.id]);
  const annotation = selected && frame
    ? labState.annotations.find((item) => item.reviewId === selected.id && item.frameIndex === frame.ply)
    : undefined;
  useEffect(() => {
    setNote(annotation?.note ?? '');
  }, [annotation?.id, annotation?.note, selected?.id, frame?.ply]);

  if (!records.length) {
    return (
      <EmptyEvidence title="Your first replay begins with a completed coached game.">
        Replay positions are saved only from real moves. Finish a game against the engine and this lab will preserve its evidence.
      </EmptyEvidence>
    );
  }

  const principles = frame?.principles ?? [];
  const classified = classifyPrinciples(principles);
  const concept = classified[0] ?? profile.growthAreas[0]?.concept;
  const saveNote = () => {
    if (!selected || !frame || !note.trim()) return;
    upsertLabAnnotation({
      id: annotation?.id,
      reviewId: selected.id,
      gameId: selected.gameId,
      frameIndex: frame.ply,
      ...(concept ? { conceptId: concept.id } : {}),
      note,
    });
    refreshLab();
  };
  const deleteNote = () => {
    if (!annotation) return;
    removeLabAnnotation(annotation.id);
    setNote('');
    refreshLab();
  };
  const makeDrill = () => {
    if (!selected || !frame || !concept) return;
    addGeneratedDrill({
      gameId: selected.gameId,
      conceptId: concept.id,
      title: `${concept.shortLabel} reset · ${selected.gameName}`,
      prompt: frame.betterIdea
        ?? frame.summary
        ?? `Revisit ${frame.notation} and name one ${concept.label.toLowerCase()} cue before choosing a move.`,
      href: `/puzzles?game=${encodeURIComponent(selected.gameId)}&concept=${encodeURIComponent(concept.id)}`,
      source: 'replay',
      sourceId: `review:${selected.id}:ply:${frame.ply}`,
    });
    refreshLab();
  };

  return (
    <section aria-labelledby="replay-title">
      <div className="il-section-head">
        <div><span className="section-overline">Replay Lab</span><h2 id="replay-title">Return to the exact decision.</h2></div>
        <RecordPicker records={records} selectedId={selected?.id ?? ''} onChange={setSelectedId} />
      </div>

      {!selected?.replay || !frame || !def || def.custom ? (
        <div className="il-empty glass-soft">
          <span aria-hidden="true">⌁</span>
          <h3>This review contains a summary, but not a replay timeline.</h3>
          <p>It may predate timeline capture or use a bespoke board. New games on the standard boards preserve scrub-ready positions automatically; this record remains available in Reviews.</p>
          <div className="il-empty-actions">
            <Link className="btn" to="/reviews">Open saved summary</Link>
            <Link className="btn primary" to={`/play/${selected?.gameId ?? 'chess'}?difficulty=tutor`}>Create a coached replay</Link>
          </div>
        </div>
      ) : (
        <div className="replay-workbench">
          <div className="replay-board glass">
            <div className="replay-board-top">
              <span>{selected.gameName}</span>
              <strong>{frame.ply === 0 ? 'Initial position' : `Ply ${frame.ply} · ${frame.notation}`}</strong>
            </div>
            <MiniBoard def={def} setup={frame.state} theme={theme} />
            <div className="replay-controls">
              <button type="button" aria-label="Previous replay position" disabled={frameIndex === 0} onClick={() => setFrameIndex((index) => Math.max(0, index - 1))}>←</button>
              <input
                type="range"
                min={0}
                max={Math.max(0, frames.length - 1)}
                value={frameIndex}
                aria-label={`Replay position ${frameIndex + 1} of ${frames.length}`}
                onChange={(event) => setFrameIndex(Number(event.target.value))}
              />
              <button type="button" aria-label="Next replay position" disabled={frameIndex >= frames.length - 1} onClick={() => setFrameIndex((index) => Math.min(frames.length - 1, index + 1))}>→</button>
            </div>
            <div className="replay-position-meta">
              <span>{frameIndex + 1}/{frames.length} saved positions</span>
              {selected.replay.sampled && <span>Sampled from {selected.replay.totalPlies} plies</span>}
            </div>
          </div>

          <aside className="replay-analysis glass">
            <div className="replay-verdict">
              {frame.band ? (
                <span style={{ color: BAND_META[frame.band].color }}>{BAND_META[frame.band].symbol} {BAND_META[frame.band].label}</span>
              ) : <span>Position evidence</span>}
              <small>{frame.player === null ? 'Before play began' : `${def.players[frame.player].name} moved`}</small>
            </div>
            <h3>{frame.summary || (frame.ply === 0 ? 'Set your intention before the first move.' : 'No engine annotation was saved for this position.')}</h3>
            {frame.betterIdea && <div className="il-better"><b>Stronger idea</b><p>{frame.betterIdea}</p></div>}
            {principles.length > 0 && (
              <div className="il-principles">
                {principles.map((principle) => <span key={principle}>{principle}</span>)}
              </div>
            )}

            <label className="replay-note">
              <span>Your annotation</span>
              <textarea
                value={note}
                maxLength={1_200}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What did you notice? What signal will you look for next time?"
              />
              <small>{note.length}/1200</small>
            </label>
            <div className="replay-actions">
              <button className="btn primary sm" type="button" disabled={!note.trim()} onClick={saveNote}>{annotation ? 'Update note' : 'Save note'}</button>
              {annotation && <button className="btn ghost sm" type="button" onClick={deleteNote}>Remove</button>}
              <button className="btn sm" type="button" disabled={!concept} onClick={makeDrill}>Generate drill</button>
            </div>
            <button className="il-text-link" type="button" onClick={() => openTab('coach')}>Ask the explainable coach about saved evidence →</button>
          </aside>
        </div>
      )}

      <DrillShelf state={labState} refresh={refreshLab} />
    </section>
  );
}

function StrategyDNA({
  profile,
  records,
  openTab,
}: {
  profile: StrategyProfile;
  records: GameRecord[];
  openTab: (tab: LabTab) => void;
}) {
  return (
    <section aria-labelledby="dna-title">
      <div className="il-section-head">
        <div><span className="section-overline">Strategy DNA</span><h2 id="dna-title">A measured profile, never a permanent label.</h2></div>
        <div className="il-confidence-card">
          <strong>{profile.totalEvidence}</strong>
          <span>concept-linked observations</span>
        </div>
      </div>

      {!profile.totalEvidence ? (
        <EmptyEvidence title="There is not enough evidence to score your strategy yet.">
          The neutral starting values are not a judgment. Coached games and engine-verified puzzle results will gradually add confidence.
        </EmptyEvidence>
      ) : (
        <>
          <div className="dna-summary">
            <article className="glass-soft">
              <span>Evidence coverage</span><strong>{profile.measuredConcepts}/12 skills</strong>
              <small>{records.length} reviews · {profile.dataQuality.matches} match results</small>
            </article>
            <article className="glass-soft">
              <span>Strongest measured signal</span><strong>{profile.strengths[0]?.concept.label ?? 'Still emerging'}</strong>
              <small>{profile.strengths[0] ? `${profile.strengths[0].confidence}% confidence` : 'More direct evidence needed'}</small>
            </article>
            <article className="glass-soft">
              <span>Highest-value training focus</span><strong>{profile.growthAreas[0]?.concept.label ?? 'Build a baseline'}</strong>
              <button type="button" onClick={() => openTab('transfer')}>Build transfer route →</button>
            </article>
          </div>

          <div className="dna-grid" role="list" aria-label="Strategy dimensions">
            {profile.dimensions.map((dimension) => (
              <article
                className={`dna-dimension ${dimension.state}`}
                role="listitem"
                key={dimension.id}
                style={{ '--concept': dimension.concept.accent } as CSSProperties}
              >
                <div className="dna-dimension-head">
                  <span aria-hidden="true">{dimension.concept.icon}</span>
                  <div><strong>{dimension.concept.label}</strong><small>{dimension.state}</small></div>
                  <b>{dimension.confidence ? dimension.score : '—'}</b>
                </div>
                <p>{dimension.concept.description}</p>
                <div className="dna-bars">
                  <div><span>Current signal</span><i><b style={{ width: `${dimension.confidence ? dimension.score : 0}%` }} /></i></div>
                  <div><span>Confidence</span><i><b style={{ width: `${dimension.confidence}%` }} /></i></div>
                </div>
                <small>{dimension.evidenceCount
                  ? `${dimension.evidenceCount} observations across ${dimension.games.length} game${dimension.games.length === 1 ? '' : 's'}`
                  : 'No direct evidence yet'}</small>
              </article>
            ))}
          </div>

          <div className="dna-method glass-soft">
            <div><span aria-hidden="true">i</span><strong>How to read these scores</strong></div>
            <p>Scores begin at a neutral prior and move only when real reviews, graded decisions or match results provide evidence. Confidence is shown separately, and raw evaluations from different games are never compared directly.</p>
          </div>
        </>
      )}
    </section>
  );
}

function CrossGameTraining({
  routes,
  profile,
  labState,
  refreshLab,
}: {
  routes: CrossGameRoute[];
  profile: StrategyProfile;
  labState: LabState;
  refreshLab: () => void;
}) {
  const [selectedConcept, setSelectedConcept] = useState<StrategyConceptId | null>(() => routes[0]?.concept.id ?? null);
  const selected = routes.find((route) => route.concept.id === selectedConcept) ?? routes[0];

  if (!profile.totalEvidence || !selected) {
    return (
      <EmptyEvidence title="Transfer routes need one measured strategy signal.">
        Complete a coached game first. The lab will then connect that evidence to another game that trains the same idea from a different angle.
      </EmptyEvidence>
    );
  }

  const generateRouteDrill = (route: CrossGameRoute) => {
    const stop = route.stops.find((candidate) => candidate.role === 'transfer') ?? route.stops[route.stops.length - 1];
    if (!stop) return;
    addGeneratedDrill({
      gameId: stop.gameId,
      conceptId: route.concept.id,
      title: `${route.concept.shortLabel} transfer · ${stop.gameName}`,
      prompt: `Before every move, name the ${route.concept.label.toLowerCase()} cue you are testing. After the position, record whether the same cue appears in your usual game.`,
      href: stop.href,
      source: 'transfer',
      sourceId: route.id,
    });
    refreshLab();
  };

  return (
    <section aria-labelledby="transfer-title">
      <div className="il-section-head">
        <div><span className="section-overline">Cross-game training</span><h2 id="transfer-title">Learn the same idea through a different board.</h2></div>
      </div>
      <div className="transfer-layout">
        <nav className="transfer-index" aria-label="Available transfer concepts">
          {routes.map((route) => {
            const dimension = profile.dimensions.find((item) => item.id === route.concept.id);
            return (
              <button
                type="button"
                className={selected.concept.id === route.concept.id ? 'active' : ''}
                onClick={() => setSelectedConcept(route.concept.id)}
                key={route.concept.id}
              >
                <span style={{ color: route.concept.accent }}>{route.concept.icon}</span>
                <div><strong>{route.concept.label}</strong><small>{dimension?.evidenceCount ?? 0} observations</small></div>
                <b>→</b>
              </button>
            );
          })}
        </nav>

        <article className="transfer-route glass">
          <span className="section-overline">Transfer route · {selected.concept.label}</span>
          <h3>{selected.headline}</h3>
          <p>{selected.rationale}</p>
          <div className="transfer-stops">
            {selected.stops.map((stop, index) => (
              <div className="transfer-stop" key={`${stop.role}:${stop.gameId}`}>
                <span className="transfer-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="transfer-game-icon" aria-hidden="true">{stop.emoji}</span>
                <div>
                  <small>{stop.role === 'anchor' ? 'Evidence source' : stop.role === 'guided-practice' ? 'Bridge game' : 'Transfer challenge'}</small>
                  <strong>{stop.gameName}</strong>
                  <p>{stop.reason}</p>
                  <span>{stop.conceptFit}% concept fit · {stop.puzzleCount} puzzle{stop.puzzleCount === 1 ? '' : 's'}</span>
                </div>
                <Link to={stop.href} aria-label={`Open ${stop.gameName} training`}>Open →</Link>
              </div>
            ))}
          </div>
          <button className="btn primary" type="button" onClick={() => generateRouteDrill(selected)}>Save this transfer drill</button>
        </article>
      </div>
      <DrillShelf state={labState} refresh={refreshLab} compact />
    </section>
  );
}

function ExplainableCoach({
  records,
  profile,
  openReplay,
}: {
  records: GameRecord[];
  profile: StrategyProfile;
  openReplay: () => void;
}) {
  const evidenceRecords = records.filter((record) => record.replay?.frames.some((frame) => frame.summary || frame.betterIdea));
  const [selectedId, setSelectedId] = useState(() => evidenceRecords[0]?.id ?? records[0]?.id ?? '');
  const selected = records.find((record) => record.id === selectedId) ?? evidenceRecords[0] ?? records[0];
  const moments = selected?.replay?.frames.filter((frame) => frame.summary || frame.betterIdea || frame.principles?.length) ?? [];
  const [momentIndex, setMomentIndex] = useState(0);
  const moment = moments[Math.min(momentIndex, Math.max(0, moments.length - 1))];
  const concept = classifyPrinciples(moment?.principles ?? [])[0]
    ?? profile.growthAreas[0]?.concept;

  useEffect(() => setMomentIndex(0), [selected?.id]);

  if (!records.length) {
    return (
      <EmptyEvidence title="The coach needs a real decision before it can explain one.">
        Finish a coached game and the saved engine annotations will appear here. It will never invent a candidate line when analysis is absent.
      </EmptyEvidence>
    );
  }

  return (
    <section aria-labelledby="coach-title">
      <div className="il-section-head">
        <div><span className="section-overline">Explainable Coach</span><h2 id="coach-title">Trace every recommendation back to evidence.</h2></div>
        <RecordPicker records={records} selectedId={selected?.id ?? ''} onChange={setSelectedId} />
      </div>

      {!moment ? (
        <div className="il-empty glass-soft">
          <span aria-hidden="true">◇</span>
          <h3>No move-level explanation was saved for this review.</h3>
          <p>The coach will not manufacture a reason. Start a new standard game with Auto Tutor on to preserve summaries, principles and stronger ideas.</p>
          <Link className="btn primary" to={`/play/${selected?.gameId ?? 'chess'}?difficulty=tutor`}>Play with Tutor mode</Link>
        </div>
      ) : (
        <div className="coach-layout">
          <aside className="coach-moment-list" aria-label="Explained decisions">
            {moments.map((frame, index) => (
              <button type="button" className={index === momentIndex ? 'active' : ''} onClick={() => setMomentIndex(index)} key={`${frame.ply}:${frame.notation}`}>
                <span>{frame.ply}</span>
                <div><strong>{frame.notation}</strong><small>{frame.band ? BAND_META[frame.band].label : 'annotated move'}</small></div>
              </button>
            ))}
          </aside>

          <article className="coach-explanation glass">
            <div className="coach-evidence-tag">
              <span>Saved engine evidence</span>
              <b>{selected.gameName} · ply {moment.ply}</b>
            </div>
            <h3>{moment.summary ?? `${moment.notation} was preserved as a teaching moment.`}</h3>
            {moment.band && (
              <div className="coach-grade" style={{ color: BAND_META[moment.band].color }}>
                <span>{BAND_META[moment.band].symbol}</span>
                <div><strong>{BAND_META[moment.band].label}</strong><small>Assigned by the game engine after the move</small></div>
              </div>
            )}

            <div className="coach-reasoning-grid">
              <div>
                <small>What the evidence says</small>
                <p>{moment.summary ?? 'No move summary was captured.'}</p>
              </div>
              <div>
                <small>Stronger candidate or training idea</small>
                <p>{moment.betterIdea ?? (concept
                  ? `Train ${concept.label.toLowerCase()} in a focused position, then return to this game.`
                  : 'No stronger candidate line was captured, so the coach is limiting itself to the saved grade.')}</p>
              </div>
              <div>
                <small>Transferable principle</small>
                <p>{concept?.description ?? 'No canonical strategy concept can be supported by this annotation yet.'}</p>
              </div>
            </div>

            <div className="coach-links">
              <button className="btn" type="button" onClick={openReplay}>Open in Replay Lab</button>
              <Link className="btn" to={`/learn/${selected.gameId}`}>Study {selected.gameName}</Link>
              <Link className="btn primary" to={`/puzzles?game=${encodeURIComponent(selected.gameId)}${concept ? `&concept=${encodeURIComponent(concept.id)}` : ''}`}>Practice this idea →</Link>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function DrillShelf({
  state,
  refresh,
  compact = false,
}: {
  state: LabState;
  refresh: () => void;
  compact?: boolean;
}) {
  const recent = state.generatedDrills.slice(0, compact ? 3 : 6);
  if (!recent.length) return null;
  const completed = new Set(state.completedDrills.map((item) => item.drillId));
  const logPractice = (drillId: string) => {
    const drill = state.generatedDrills.find((item) => item.id === drillId);
    if (!drill) return;
    recordCompletedDrill({
      drillId,
      gameId: drill.gameId,
      conceptId: drill.conceptId,
      success: false,
      verification: 'self-reported',
    });
    refresh();
  };
  return (
    <section className="drill-shelf" aria-labelledby={`drill-title-${compact ? 'compact' : 'full'}`}>
      <div className="il-section-head compact">
        <div><span className="section-overline">Saved practice</span><h3 id={`drill-title-${compact ? 'compact' : 'full'}`}>Your generated drills</h3></div>
        <span>{state.completedDrills.length} practice logs</span>
      </div>
      <div className="drill-grid">
        {recent.map((drill) => {
          const concept = STRATEGY_CONCEPT_BY_ID[drill.conceptId];
          const done = completed.has(drill.id);
          return (
            <article className={`drill-card glass-soft ${done ? 'done' : ''}`} key={drill.id}>
              <span style={{ color: concept?.accent }}>{concept?.icon ?? '◇'}</span>
              <small>{concept?.label ?? drill.conceptId}</small>
              <h4>{drill.title}</h4>
              <p>{drill.prompt}</p>
              <div>
                <Link className="btn sm" to={drill.href}>Open drill</Link>
                <button className="btn sm ghost" type="button" disabled={done} onClick={() => logPractice(drill.id)}>{done ? 'Practice logged ✓' : 'Log practice'}</button>
              </div>
              <small>Only engine-verified puzzle results affect Strategy DNA.</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}
