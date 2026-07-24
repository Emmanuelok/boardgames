import { Link, useSearchParams } from 'react-router-dom';
import { MISSION_STAGES, useLearningMemory, type MissionStage } from '../intelligence/learningMemory';
import { MISSION_STAGE_META, readMissionContext, withMissionContext } from '../intelligence/missionRouting';
import './JourneyContext.css';

interface JourneyContextProps {
  gameId: string;
  gameName: string;
  gameEmoji: string;
  stage: MissionStage;
}

/**
 * A compact, shared mission header for every downstream learning surface.
 * It intentionally renders nothing outside a validated mission URL.
 */
export default function JourneyContext({
  gameId,
  gameName,
  gameEmoji,
  stage,
}: JourneyContextProps) {
  const [params] = useSearchParams();
  const context = readMissionContext(params);
  const mission = useLearningMemory((state) => state.activeMission);

  if (
    !context
    || context.stage !== stage
    || !mission
    || mission.id !== context.missionId
    || mission.gameId !== gameId
  ) return null;

  const step = mission.steps.find((candidate) => candidate.stage === stage);
  const activeStep = mission.steps.find((candidate) => candidate.status === 'active');
  const completed = mission.steps.filter((candidate) => candidate.status === 'complete').length;
  const index = MISSION_STAGES.indexOf(stage);
  const meta = MISSION_STAGE_META[stage];
  const activeMeta = activeStep ? MISSION_STAGE_META[activeStep.stage] : null;
  const nextHref = activeStep?.target.href
    ? withMissionContext(activeStep.target.href, mission.id, activeStep.stage)
    : '/path';

  return (
    <section className={`journey-context ${step?.status ?? 'locked'}`} aria-label="Active adaptive learning mission">
      <div className="jc-marker" aria-hidden="true">{meta.icon}</div>
      <div className="jc-main">
        <div className="jc-kicker">
          <span>Adaptive mission</span>
          <i aria-hidden="true" />
          <span>Stage {index + 1} of {MISSION_STAGES.length}</span>
        </div>
        <div className="jc-title">
          <strong>{gameEmoji} {gameName}</strong>
          <span>{meta.label} with the {meta.agent}</span>
        </div>
        <div
          className="jc-progress"
          role="progressbar"
          aria-label="Adaptive mission progress"
          aria-valuemin={0}
          aria-valuemax={MISSION_STAGES.length}
          aria-valuenow={completed}
          aria-valuetext={`${completed} of ${MISSION_STAGES.length} stages complete; ${activeMeta?.label ?? 'mission'} ${mission.status === 'complete' ? 'complete' : 'active'}`}
        >
          {MISSION_STAGES.map((candidate) => {
            const status = mission.steps.find((item) => item.stage === candidate)?.status ?? 'locked';
            return <i key={candidate} className={status} aria-hidden="true" />;
          })}
        </div>
        <span className="jc-sr" aria-live="polite">
          {mission.status === 'complete'
            ? `${gameName} mission complete.`
            : `${activeMeta?.label ?? 'Next'} stage active. ${completed} of ${MISSION_STAGES.length} stages complete.`}
        </span>
      </div>
      <div className="jc-actions">
        <Link to="/path" className="jc-path">My Path</Link>
        {mission.status === 'complete' ? (
          <Link to="/path" className="btn sm primary">Build the next mission →</Link>
        ) : step?.status === 'complete' && activeStep && activeMeta ? (
          <Link to={nextHref} className="btn sm primary">Next: {activeMeta.label.toLowerCase()} →</Link>
        ) : activeStep?.stage !== stage ? (
          <Link to={nextHref} className="btn sm">Resume {activeMeta?.label.toLowerCase() ?? 'mission'} →</Link>
        ) : (
          <span className="jc-live"><i aria-hidden="true" /> Evidence returns here</span>
        )}
      </div>
    </section>
  );
}
