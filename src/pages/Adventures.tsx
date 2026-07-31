import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ADVENTURES,
  adventureMissionTargets,
  type Adventure,
  type AdventureChapter,
} from '../adventures/catalogue';
import {
  chapterUnlocked,
  useAdventureStore,
  type ActiveAdventure,
} from '../adventures/adventureStore';
import {
  createLearningMission,
  useLearningMemory,
  type ActiveLearningMission,
} from '../intelligence/learningMemory';
import { MISSION_STAGE_META, withMissionContext } from '../intelligence/missionRouting';
import { useProgression } from '../progression/progression';
import './Adventures.css';

function missionId(adventureId: string, chapterId: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `adventure:${adventureId}:${chapterId}:${random}`;
}

function imageFor(gameId: string): string {
  return `/assets/game-thumbnails/${gameId}.webp`;
}

export function shouldConfirmAdventureReplacement(
  activeMission: Pick<ActiveLearningMission, 'id' | 'status'> | null,
  activeAdventure: ActiveAdventure | null,
  requested: Pick<ActiveAdventure, 'adventureId' | 'chapterId'>,
): boolean {
  if (activeMission?.status !== 'active') return false;
  return activeAdventure?.missionId !== activeMission.id
    || activeAdventure.adventureId !== requested.adventureId
    || activeAdventure.chapterId !== requested.chapterId;
}

export default function Adventures() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(ADVENTURES[0].id);
  const data = useAdventureStore();
  const activeMission = useLearningMemory((state) => state.activeMission);
  const activateMission = useLearningMemory((state) => state.activateMission);
  const recordLesson = useProgression((state) => state.recordLesson);
  const selected = ADVENTURES.find((adventure) => adventure.id === selectedId) ?? ADVENTURES[0];

  useEffect(() => {
    const active = useAdventureStore.getState().active;
    if (!active || activeMission?.id !== active.missionId || activeMission.status !== 'complete') return;
    if (useAdventureStore.getState().complete(active.adventureId, active.chapterId)) {
      recordLesson(`adventure:${active.adventureId}:${active.chapterId}`);
    }
  }, [activeMission, recordLesson]);

  const completedCount = useMemo(
    () => Object.values(data.completed).reduce((sum, chapters) => sum + chapters.length, 0),
    [data.completed],
  );

  const launch = (adventure: Adventure, chapter: AdventureChapter) => {
    if (!chapterUnlocked(data, adventure.id, chapter.id)) return;
    if (shouldConfirmAdventureReplacement(activeMission, data.active, {
      adventureId: adventure.id,
      chapterId: chapter.id,
    })) {
      const replace = window.confirm('Replace your current active chapter with this one? Evidence already collected stays saved.');
      if (!replace) return;
    }
    const id = missionId(adventure.id, chapter.id);
    const mission = createLearningMission({
      id,
      gameId: chapter.gameId,
      targets: adventureMissionTargets(chapter),
    });
    activateMission(mission);
    data.activate({ adventureId: adventure.id, chapterId: chapter.id, missionId: id, startedAt: Date.now() });
    const first = mission.steps[0];
    navigate(withMissionContext(first.target.href ?? `/play/${chapter.gameId}`, id, first.stage));
  };

  const resume = () => {
    const active = data.active;
    if (!active || activeMission?.id !== active.missionId || activeMission.status !== 'active') return;
    const step = activeMission.steps.find((candidate) => candidate.status === 'active');
    if (!step) return;
    navigate(withMissionContext(step.target.href ?? '/path', activeMission.id, step.stage));
  };

  return (
    <div className="adv-page">
      <header className="adv-hero">
        <div className="adv-hero-glow" />
        <div>
          <span className="section-overline">Feature 5 · multi-game adventure campaigns</span>
          <h1>One strategic idea. Three worlds. A journey you can finish.</h1>
          <p>Each expedition moves through diagnosis, learning, practice, a full match and reflection. Progress is earned from real platform evidence—not from tapping a decorative checkpoint.</p>
          <div className="adv-hero-actions">
            {data.active && activeMission?.id === data.active.missionId && activeMission.status === 'active'
              ? <button className="btn primary lg glow" type="button" onClick={resume}>Resume active chapter →</button>
              : <button className="btn primary lg glow" type="button" onClick={() => launch(selected, selected.chapters.find((chapter) => chapterUnlocked(data, selected.id, chapter.id) && !data.completed[selected.id]?.includes(chapter.id)) ?? selected.chapters[0])}>Begin an expedition →</button>}
            <Link className="btn lg" to="/path">Open adaptive path</Link>
          </div>
        </div>
        <aside className="adv-hero-status glass-soft">
          <span>Expedition record</span>
          <strong>{completedCount}<small>/ {ADVENTURES.reduce((sum, adventure) => sum + adventure.chapters.length, 0)}</small></strong>
          <p>chapters completed</p>
          <div aria-hidden="true"><i style={{ width: `${completedCount / 9 * 100}%` }} /></div>
        </aside>
      </header>

      <nav className="adv-switcher" aria-label="Choose an adventure">
        {ADVENTURES.map((adventure) => {
          const done = data.completed[adventure.id]?.length ?? 0;
          return (
            <button
              key={adventure.id}
              type="button"
              className={selected.id === adventure.id ? 'on' : ''}
              aria-pressed={selected.id === adventure.id}
              onClick={() => setSelectedId(adventure.id)}
              style={{ '--adv-accent': adventure.accent } as CSSProperties}
            >
              <span>{adventure.overline}</span>
              <strong>{adventure.title}</strong>
              <small>{done}/{adventure.chapters.length} chapters</small>
            </button>
          );
        })}
      </nav>

      <section className="adv-intro" style={{ '--adv-accent': selected.accent } as CSSProperties}>
        <div>
          <span className="section-overline">{selected.overline}</span>
          <h2>{selected.title}</h2>
          <p>{selected.description}</p>
        </div>
        <aside>
          <small>Transfer outcome</small>
          <strong>{selected.outcome}</strong>
        </aside>
      </section>

      <section className="adv-map" aria-label={`${selected.title} chapters`}>
        <div className="adv-route-line" aria-hidden="true" />
        {selected.chapters.map((chapter, index) => {
          const complete = data.completed[selected.id]?.includes(chapter.id) ?? false;
          const unlocked = chapterUnlocked(data, selected.id, chapter.id);
          const active = data.active?.adventureId === selected.id
            && data.active.chapterId === chapter.id
            && activeMission?.id === data.active.missionId
            && activeMission.status === 'active';
          const missionDone = active
            ? activeMission.steps.filter((step) => step.status === 'complete').length
            : complete ? 5 : 0;
          return (
            <article
              key={chapter.id}
              className={`adv-chapter ${complete ? 'complete' : active ? 'active' : unlocked ? 'ready' : 'locked'}`}
              style={{ '--chapter-accent': chapter.accent } as CSSProperties}
            >
              <div className="adv-chapter-art">
                <img src={imageFor(chapter.gameId)} alt="" width="1280" height="853" loading="lazy" decoding="async" />
                <span>{String(index + 1).padStart(2, '0')}</span>
                <b>{complete ? '✓ complete' : active ? '● active' : unlocked ? 'ready' : 'locked'}</b>
              </div>
              <div className="adv-chapter-copy">
                <small>{chapter.concept} · {chapter.minutes} min</small>
                <h3>{chapter.title}</h3>
                <p>{chapter.summary}</p>
                <blockquote>{chapter.briefing}</blockquote>
                <div className="adv-stage-dots" aria-label={`${missionDone} of 5 learning stages complete`}>
                  {(['observe', 'learn', 'practice', 'play', 'reflect'] as const).map((stage, stageIndex) => (
                    <span className={stageIndex < missionDone ? 'done' : stageIndex === missionDone && active ? 'now' : ''} key={stage} title={MISSION_STAGE_META[stage].label}>
                      {MISSION_STAGE_META[stage].icon}<i>{MISSION_STAGE_META[stage].label}</i>
                    </span>
                  ))}
                </div>
                <div className="adv-chapter-foot">
                  <span><small>Fixed chapter badge</small><strong>{chapter.badge}</strong></span>
                  {complete ? (
                    <Link className="btn sm" to={`/play/${chapter.gameId}`}>Revisit board</Link>
                  ) : active ? (
                    <button className="btn primary sm" type="button" onClick={resume}>Continue stage →</button>
                  ) : (
                    <button className="btn primary sm" type="button" disabled={!unlocked} onClick={() => launch(selected, chapter)}>
                      {unlocked ? 'Launch chapter →' : 'Complete previous chapter'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
