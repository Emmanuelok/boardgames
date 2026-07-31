export type TournamentFormat = 'knockout' | 'round-robin';
export type MatchStatus = 'scheduled' | 'ready' | 'complete';

export interface BracketParticipant {
  id: string;
  name: string;
  seed: number;
}

export interface BracketMatch {
  id: string;
  round: number;
  slot: number;
  playerA: BracketParticipant | null;
  playerB: BracketParticipant | null;
  scoreA: number | null;
  scoreB: number | null;
  winnerId: string | null;
  status: MatchStatus;
}

export interface TournamentBracket {
  format: TournamentFormat;
  participants: BracketParticipant[];
  rounds: BracketMatch[][];
}

const cleanName = (value: string): string => value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 48);

export function createParticipants(names: string[]): BracketParticipant[] {
  const seen = new Set<string>();
  return names.map(cleanName).filter((name) => {
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8).map((name, index) => ({ id: `p${index + 1}`, name, seed: index + 1 }));
}

function readyStatus(a: BracketParticipant | null, b: BracketParticipant | null): MatchStatus {
  return a && b ? 'ready' : 'scheduled';
}

export function createKnockout(names: string[]): TournamentBracket {
  const participants = createParticipants(names);
  if (participants.length !== 4 && participants.length !== 8) {
    throw new Error('Knockout tournaments require exactly 4 or 8 unique participants.');
  }
  const size = participants.length;
  const first: BracketMatch[] = [];
  for (let slot = 0; slot < size / 2; slot += 1) {
    const a = participants[slot];
    const b = participants[size - 1 - slot];
    first.push({
      id: `r1m${slot + 1}`,
      round: 1,
      slot,
      playerA: a,
      playerB: b,
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'ready',
    });
  }
  const rounds = [first];
  let matchCount = first.length / 2;
  let round = 2;
  while (matchCount >= 1) {
    rounds.push(Array.from({ length: matchCount }, (_, slot): BracketMatch => ({
      id: `r${round}m${slot + 1}`,
      round,
      slot,
      playerA: null,
      playerB: null,
      scoreA: null,
      scoreB: null,
      winnerId: null,
      status: 'scheduled',
    })));
    matchCount /= 2;
    round += 1;
  }
  return { format: 'knockout', participants, rounds };
}

export function createRoundRobin(names: string[]): TournamentBracket {
  const participants = createParticipants(names);
  if (participants.length < 3 || participants.length > 8) {
    throw new Error('Round-robin tournaments require 3 to 8 unique participants.');
  }
  const rotation: Array<BracketParticipant | null> = [...participants];
  if (rotation.length % 2) rotation.push(null);
  const rounds: BracketMatch[][] = [];
  const count = rotation.length;
  for (let round = 0; round < count - 1; round += 1) {
    const matches: BracketMatch[] = [];
    for (let slot = 0; slot < count / 2; slot += 1) {
      const a = rotation[slot];
      const b = rotation[count - 1 - slot];
      if (!a || !b) continue;
      const playerA = round % 2 === 0 ? a : b;
      const playerB = round % 2 === 0 ? b : a;
      matches.push({
        id: `r${round + 1}m${slot + 1}`,
        round: round + 1,
        slot,
        playerA,
        playerB,
        scoreA: null,
        scoreB: null,
        winnerId: null,
        status: 'ready',
      });
    }
    rounds.push(matches);
    rotation.splice(1, 0, rotation.pop() ?? null);
  }
  return { format: 'round-robin', participants, rounds };
}

export function reportMatch(
  bracket: TournamentBracket,
  matchId: string,
  winnerId: string | null,
  score?: [number, number],
): TournamentBracket {
  const rounds = bracket.rounds.map((round) => round.map((match) => ({
    ...match,
    playerA: match.playerA ? { ...match.playerA } : null,
    playerB: match.playerB ? { ...match.playerB } : null,
  })));
  let found: BracketMatch | null = null;
  for (const round of rounds) {
    const match = round.find((candidate) => candidate.id === matchId);
    if (match) { found = match; break; }
  }
  if (!found || found.status !== 'ready' || !found.playerA || !found.playerB) return bracket;
  const isDraw = winnerId === null;
  if (isDraw && bracket.format !== 'round-robin') return bracket;
  if (!isDraw && winnerId !== found.playerA.id && winnerId !== found.playerB.id) return bracket;
  const requestedScore = score ?? (
    isDraw ? [1, 1]
      : winnerId === found.playerA.id ? [1, 0]
        : [0, 1]
  );
  const scoreA = Math.max(0, Math.min(99, Math.floor(requestedScore[0])));
  const scoreB = Math.max(0, Math.min(99, Math.floor(requestedScore[1])));
  if ((isDraw && scoreA !== scoreB)
    || (winnerId === found.playerA.id && scoreA <= scoreB)
    || (winnerId === found.playerB.id && scoreB <= scoreA)) return bracket;
  found.scoreA = scoreA;
  found.scoreB = scoreB;
  found.winnerId = winnerId;
  found.status = 'complete';

  if (bracket.format === 'knockout') {
    const nextRound = rounds[found.round];
    const next = nextRound?.[Math.floor(found.slot / 2)];
    if (next) {
      const winner = found.playerA.id === winnerId ? found.playerA : found.playerB;
      if (found.slot % 2 === 0) next.playerA = winner;
      else next.playerB = winner;
      next.status = readyStatus(next.playerA, next.playerB);
    }
  }
  return { ...bracket, rounds };
}

export function bracketChampion(bracket: TournamentBracket): BracketParticipant | null {
  if (bracket.format === 'knockout') {
    const final = bracket.rounds[bracket.rounds.length - 1]?.[0];
    return final?.winnerId
      ? [final.playerA, final.playerB].find((player) => player?.id === final.winnerId) ?? null
      : null;
  }
  const points = new Map(bracket.participants.map((participant) => [participant.id, 0]));
  for (const match of bracket.rounds.flat()) {
    if (match.status !== 'complete') return null;
    if (match.winnerId) points.set(match.winnerId, (points.get(match.winnerId) ?? 0) + 3);
    else if (match.playerA && match.playerB) {
      points.set(match.playerA.id, (points.get(match.playerA.id) ?? 0) + 1);
      points.set(match.playerB.id, (points.get(match.playerB.id) ?? 0) + 1);
    }
  }
  return bracket.participants.slice().sort((a, b) => (points.get(b.id) ?? 0) - (points.get(a.id) ?? 0) || a.seed - b.seed)[0] ?? null;
}
