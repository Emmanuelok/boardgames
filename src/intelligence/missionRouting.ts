import type { MissionStage } from './learningMemory';

export const MISSION_STAGE_META: Record<MissionStage, {
  label: string;
  agent: string;
  icon: string;
  verb: string;
}> = {
  observe: { label: 'Observe', agent: 'Diagnostician', icon: '◉', verb: 'read the evidence' },
  learn: { label: 'Learn', agent: 'Curriculum Guide', icon: '◇', verb: 'study the idea' },
  practice: { label: 'Practice', agent: 'Practice Builder', icon: '✦', verb: 'solve the pattern' },
  play: { label: 'Play', agent: 'Sparring Director', icon: '⬡', verb: 'test the idea' },
  reflect: { label: 'Reflect', agent: 'Review Analyst', icon: '⌁', verb: 'close the loop' },
};

/**
 * Preserve an existing route query while binding it to one exact mission stage.
 * HashRouter consumes the returned path, so no origin/base URL is required.
 */
export function withMissionContext(
  href: string,
  missionId: string,
  stage: MissionStage,
): string {
  const [pathAndQuery, fragment] = href.split('#', 2);
  const question = pathAndQuery.indexOf('?');
  const path = question >= 0 ? pathAndQuery.slice(0, question) : pathAndQuery;
  const query = question >= 0 ? pathAndQuery.slice(question + 1) : '';
  const params = new URLSearchParams(query);
  params.set('mission', missionId);
  params.set('stage', stage);
  const suffix = params.toString();
  return `${path}${suffix ? `?${suffix}` : ''}${fragment ? `#${fragment}` : ''}`;
}

export function readMissionContext(params: URLSearchParams): {
  missionId: string;
  stage: MissionStage;
} | null {
  const missionId = params.get('mission')?.trim() ?? '';
  const stage = params.get('stage');
  if (
    !missionId
    || missionId.length > 256
    || !stage
    || !(stage in MISSION_STAGE_META)
  ) return null;
  return { missionId, stage: stage as MissionStage };
}
