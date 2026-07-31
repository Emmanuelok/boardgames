/**
 * A shared vocabulary for ideas that transfer between otherwise very different
 * board games. Engine explanations remain free to use natural language; this
 * module converts that authored language into stable ids that can be persisted,
 * aggregated and linked to training in another game.
 */

export const STRATEGY_CONCEPTS = [
  {
    id: 'calculation',
    label: 'Calculation',
    shortLabel: 'Calculate',
    description: 'Compare candidate moves and follow the most important replies before committing.',
    icon: '⌁',
    accent: '#60a5fa',
  },
  {
    id: 'tactics',
    label: 'Tactical vision',
    shortLabel: 'Tactics',
    description: 'Recognise forcing sequences, multiple threats and immediate gains.',
    icon: '✦',
    accent: '#f59e0b',
  },
  {
    id: 'tempo',
    label: 'Tempo',
    shortLabel: 'Tempo',
    description: 'Use each turn efficiently and count races accurately.',
    icon: '⏱',
    accent: '#fb7185',
  },
  {
    id: 'initiative',
    label: 'Initiative',
    shortLabel: 'Initiative',
    description: 'Create questions the opponent must answer and keep control of the sequence.',
    icon: '↗',
    accent: '#f97316',
  },
  {
    id: 'space-control',
    label: 'Space control',
    shortLabel: 'Space',
    description: 'Occupy or influence valuable regions, lanes, intersections and goals.',
    icon: '◇',
    accent: '#a78bfa',
  },
  {
    id: 'connection',
    label: 'Connection',
    shortLabel: 'Connect',
    description: 'Keep pieces or stones mutually supporting and build resilient networks.',
    icon: '⛓',
    accent: '#2dd4bf',
  },
  {
    id: 'material-efficiency',
    label: 'Material efficiency',
    shortLabel: 'Material',
    description: 'Gain, preserve and exchange playing resources at the right moment.',
    icon: '◆',
    accent: '#fbbf24',
  },
  {
    id: 'structure',
    label: 'Structure',
    shortLabel: 'Structure',
    description: 'Shape pieces, groups and formations so they remain useful over several turns.',
    icon: '▦',
    accent: '#34d399',
  },
  {
    id: 'mobility',
    label: 'Mobility',
    shortLabel: 'Mobility',
    description: 'Preserve useful choices while restricting the opponent’s available play.',
    icon: '⇄',
    accent: '#38bdf8',
  },
  {
    id: 'defence',
    label: 'Defence',
    shortLabel: 'Defence',
    description: 'Identify urgent threats, remove tactical weaknesses and protect critical routes.',
    icon: '⬡',
    accent: '#818cf8',
  },
  {
    id: 'endgame',
    label: 'Endgame technique',
    shortLabel: 'Endgame',
    description: 'Convert small advantages with precise counting, timing and simplification.',
    icon: '◎',
    accent: '#c084fc',
  },
  {
    id: 'pattern-recognition',
    label: 'Pattern recognition',
    shortLabel: 'Patterns',
    description: 'Recall recurring shapes, alignments and tactical motifs quickly and accurately.',
    icon: '◉',
    accent: '#ec4899',
  },
] as const;

export type StrategyConcept = (typeof STRATEGY_CONCEPTS)[number];
export type StrategyConceptId = StrategyConcept['id'];

export const STRATEGY_CONCEPT_BY_ID: Readonly<Record<StrategyConceptId, StrategyConcept>> =
  Object.fromEntries(STRATEGY_CONCEPTS.map((concept) => [concept.id, concept])) as
    Record<StrategyConceptId, StrategyConcept>;

const CONCEPT_IDS = new Set<string>(STRATEGY_CONCEPTS.map((concept) => concept.id));

export function isStrategyConceptId(value: unknown): value is StrategyConceptId {
  return typeof value === 'string' && CONCEPT_IDS.has(value);
}

/**
 * Terms are deliberately broad enough to recognise the authored explanations
 * across all engines, but specific enough not to label every sentence with
 * every concept. A principle may legitimately map to more than one concept.
 */
const PRINCIPLE_PATTERNS: Readonly<Record<StrategyConceptId, readonly RegExp[]>> = {
  calculation: [
    /\bcalculat/, /\bcount\b/, /\bcompare\b/, /\bcandidate\b/, /\bbranch(?:es)?\b/,
    /\breply\b/, /\breplies\b/, /\blook ahead\b/, /\bsequence\b/,
  ],
  tactics: [
    /\bfork\b/, /\bpin(?:s|ned)?\b/, /\bskewer\b/, /\bdouble threat\b/,
    /\bdiscovered attack\b/, /\bchain(?:ed)? (?:jump|capture)/, /\btactic/,
    /\btwo threats\b/, /\bforcing move\b/, /\bmate\b/,
  ],
  tempo: [
    /\btempo\b/, /\brace\b/, /\bextra turn\b/, /\bfree turn\b/,
    /\bmove count\b/, /\bone move\b/, /\beach turn\b/,
  ],
  initiative: [
    /\bforce(?:s|d|ing)?\b/, /\bmust (?:answer|respond|reply|block)\b/,
    /\bdirect threat\b/, /\battack(?:ing|er|s)?\b/, /\bthreaten\b/,
    /\bkeep.*pressure\b/,
  ],
  'space-control': [
    /\bcent(?:er|re|ral|ralise)\b/, /\bterritor/, /\bregion\b/, /\bspace\b/,
    /\bvaluable squares?\b/, /\bfile\b/, /\brank\b/, /\bdiagonal\b/,
    /\blane\b/, /\bcorner\b/, /\bedge\b/, /\bframework\b/,
  ],
  connection: [
    /\bconnect/, /\bsupport(?:ed|ing)?\b/, /\bbridge\b/, /\bgroup\b/,
    /\bcluster\b/, /\bphalanx\b/, /\bshoulder-to-shoulder\b/,
    /\bunbroken (?:line|wall)\b/,
  ],
  'material-efficiency': [
    /\bmaterial\b/, /\bcaptur/, /\btrade pieces\b/, /\bexchange\b/,
    /\bpiece count\b/, /\bstone count\b/, /\bremove an enemy\b/,
    /\bworth\b/, /\bgain a piece\b/,
  ],
  structure: [
    /\bstructure\b/, /\bformation\b/, /\bback row\b/, /\bback rank\b/,
    /\bcastle\b/, /\bshape\b/, /\bwall\b/, /\bscreen\b/, /\bpawn chain\b/,
    /\beyes?\b/, /\blibert(?:y|ies)\b/,
  ],
  mobility: [
    /\bmobilit/, /\blegal moves?\b/, /\bavailable moves?\b/, /\bchoices?\b/,
    /\bkeep lanes? open\b/, /\brestrict/, /\bno reply\b/, /\bmust pass\b/,
    /\bblockade\b/, /\bcramp/,
  ],
  defence: [
    /\bdefen[cs]/, /\bprotect/, /\bsafe(?:guard|ty)?\b/, /\bshield\b/,
    /\bblock\b/, /\bdeny\b/, /\bavoid\b/, /\bnever leave\b/,
    /\bking safety\b/, /\bintact\b/,
  ],
  endgame: [
    /\bendgame\b/, /\bconvert\b/, /\bsimplif/, /\bpromotion\b/, /\bpromote\b/,
    /\bcrown\b/, /\blast stone\b/, /\bgame ends\b/, /\bstable squares?\b/,
  ],
  'pattern-recognition': [
    /\bpattern\b/, /\bthree-in-a-row\b/, /\bfour-in-a-row\b/, /\bfive-in-a-row\b/,
    /\bmill\b/, /\balign/, /\bopen three\b/, /\bopen four\b/, /\btwo eyes\b/,
    /\bbracket/, /\bintersection\b/,
  ],
};

export function conceptIdsForPrinciples(principles: readonly string[]): StrategyConceptId[] {
  const text = principles
    .filter((principle): principle is string => typeof principle === 'string')
    .join(' ')
    .toLocaleLowerCase();
  if (!text.trim()) return [];
  return STRATEGY_CONCEPTS
    .filter((concept) => PRINCIPLE_PATTERNS[concept.id].some((pattern) => pattern.test(text)))
    .map((concept) => concept.id);
}

export function classifyPrinciples(principles: readonly string[]): StrategyConcept[] {
  return conceptIdsForPrinciples(principles).map((id) => STRATEGY_CONCEPT_BY_ID[id]);
}

export interface GameConceptAffinity {
  conceptId: StrategyConceptId;
  /** Relative importance within this game, from supporting idea to defining idea. */
  weight: number;
  role: 'primary' | 'supporting';
}

const affinity = (
  ...entries: ReadonlyArray<readonly [StrategyConceptId, number, ('primary' | 'supporting')?]>
): readonly GameConceptAffinity[] => entries.map(([conceptId, weight, role = 'supporting']) => ({
  conceptId,
  weight: Math.max(0.1, Math.min(1, weight)),
  role,
}));

/**
 * Authored concept fingerprints for every currently registered game. These are
 * not claims about player mastery; they only describe what a game can train.
 */
export const GAME_CONCEPT_AFFINITIES: Readonly<Record<string, readonly GameConceptAffinity[]>> = {
  chess: affinity(['calculation', 1, 'primary'], ['tactics', 1, 'primary'], ['initiative', .85], ['space-control', .8], ['material-efficiency', .85], ['defence', .8], ['endgame', .8], ['pattern-recognition', .75]),
  xiangqi: affinity(['initiative', 1, 'primary'], ['tactics', .95, 'primary'], ['mobility', .85], ['calculation', .85], ['defence', .75], ['material-efficiency', .7]),
  shogi: affinity(['initiative', 1, 'primary'], ['calculation', .95, 'primary'], ['material-efficiency', .9], ['defence', .85], ['tactics', .85], ['structure', .7]),
  tafl: affinity(['space-control', 1, 'primary'], ['defence', .95, 'primary'], ['structure', .85], ['mobility', .8], ['calculation', .65]),
  checkers: affinity(['calculation', .9, 'primary'], ['tactics', .9, 'primary'], ['tempo', .8], ['material-efficiency', .8], ['endgame', .75], ['structure', .7]),
  draughts: affinity(['calculation', 1, 'primary'], ['tactics', .9, 'primary'], ['material-efficiency', .85], ['space-control', .8], ['endgame', .8], ['structure', .75]),
  alquerque: affinity(['tactics', 1, 'primary'], ['calculation', .9, 'primary'], ['material-efficiency', .8], ['tempo', .65], ['pattern-recognition', .6]),
  breakthrough: affinity(['tempo', 1, 'primary'], ['connection', .9, 'primary'], ['structure', .85], ['calculation', .75], ['mobility', .7]),
  'fox-and-hounds': affinity(['structure', 1, 'primary'], ['mobility', .95, 'primary'], ['space-control', .8], ['tempo', .7], ['defence', .7]),
  'nine-mens-morris': affinity(['pattern-recognition', 1, 'primary'], ['tactics', .9, 'primary'], ['mobility', .75], ['space-control', .75], ['material-efficiency', .7]),
  'three-mens-morris': affinity(['pattern-recognition', 1, 'primary'], ['tactics', .9, 'primary'], ['space-control', .8], ['defence', .75]),
  'mu-torere': affinity(['mobility', 1, 'primary'], ['tempo', .9, 'primary'], ['space-control', .85], ['calculation', .75], ['pattern-recognition', .65]),
  backgammon: affinity(['calculation', 1, 'primary'], ['tempo', .95, 'primary'], ['structure', .9], ['mobility', .75], ['endgame', .75], ['pattern-recognition', .65]),
  'dots-and-boxes': affinity(['calculation', 1, 'primary'], ['tempo', .95, 'primary'], ['initiative', .8], ['endgame', .75], ['pattern-recognition', .7]),
  pentago: affinity(['pattern-recognition', 1, 'primary'], ['tactics', .95, 'primary'], ['calculation', .85], ['initiative', .75], ['defence', .7]),
  quarto: affinity(['pattern-recognition', 1, 'primary'], ['calculation', .9, 'primary'], ['tactics', .8], ['defence', .75], ['initiative', .65]),
  tally: affinity(['space-control', 1, 'primary'], ['pattern-recognition', .9, 'primary'], ['tactics', .75], ['defence', .7]),
  squava: affinity(['pattern-recognition', 1, 'primary'], ['tactics', .95, 'primary'], ['defence', .8], ['initiative', .75]),
  'order-and-chaos': affinity(['pattern-recognition', 1, 'primary'], ['defence', .9, 'primary'], ['tactics', .85], ['initiative', .75], ['calculation', .7]),
  ultimate: affinity(['space-control', 1, 'primary'], ['tempo', .9, 'primary'], ['pattern-recognition', .85], ['initiative', .8], ['calculation', .75]),
  surakarta: affinity(['calculation', 1, 'primary'], ['tactics', .95, 'primary'], ['mobility', .85], ['material-efficiency', .75], ['pattern-recognition', .65]),
  cohesion: affinity(['connection', 1, 'primary'], ['space-control', .9, 'primary'], ['structure', .85], ['mobility', .75], ['defence', .65]),
  domineering: affinity(['space-control', 1, 'primary'], ['mobility', .95, 'primary'], ['tempo', .85], ['calculation', .75], ['endgame', .65]),
  reversi: affinity(['mobility', 1, 'primary'], ['space-control', .9, 'primary'], ['tempo', .8], ['endgame', .8], ['structure', .7], ['material-efficiency', .65]),
  'lines-of-action': affinity(['connection', 1, 'primary'], ['mobility', .9, 'primary'], ['space-control', .8], ['structure', .75], ['calculation', .7]),
  konane: affinity(['mobility', 1, 'primary'], ['tempo', .9, 'primary'], ['calculation', .85], ['tactics', .75], ['endgame', .7]),
  clobber: affinity(['mobility', 1, 'primary'], ['tempo', .95, 'primary'], ['calculation', .85], ['material-efficiency', .75], ['endgame', .7]),
  teeko: affinity(['connection', 1, 'primary'], ['pattern-recognition', .95, 'primary'], ['mobility', .8], ['space-control', .75], ['tactics', .7]),
  'five-field-kono': affinity(['tempo', 1, 'primary'], ['mobility', .9, 'primary'], ['structure', .8], ['calculation', .75], ['space-control', .65]),
  amazons: affinity(['space-control', 1, 'primary'], ['mobility', 1, 'primary'], ['calculation', .85], ['structure', .75], ['endgame', .7]),
  'connect-four': affinity(['pattern-recognition', 1, 'primary'], ['tactics', .95, 'primary'], ['space-control', .8], ['initiative', .8], ['defence', .75]),
  mancala: affinity(['tempo', 1, 'primary'], ['calculation', .9, 'primary'], ['material-efficiency', .85], ['initiative', .75], ['endgame', .75]),
  go: affinity(['connection', 1, 'primary'], ['space-control', 1, 'primary'], ['structure', .95], ['mobility', .8], ['initiative', .75], ['endgame', .75]),
  gomoku: affinity(['pattern-recognition', 1, 'primary'], ['initiative', .95, 'primary'], ['tactics', .9], ['space-control', .75], ['defence', .75]),
  pente: affinity(['pattern-recognition', 1, 'primary'], ['tactics', .95, 'primary'], ['initiative', .85], ['material-efficiency', .75], ['defence', .7]),
  hex: affinity(['connection', 1, 'primary'], ['space-control', .95, 'primary'], ['structure', .85], ['initiative', .75], ['calculation', .7]),
  hexapawn: affinity(['tempo', 1, 'primary'], ['calculation', .95, 'primary'], ['endgame', .85], ['tactics', .8], ['structure', .7]),
  'tic-tac-toe': affinity(['pattern-recognition', 1, 'primary'], ['tactics', .9, 'primary'], ['space-control', .8], ['defence', .75]),
};

export function affinitiesForGame(gameId: string | undefined): readonly GameConceptAffinity[] {
  return gameId ? GAME_CONCEPT_AFFINITIES[gameId] ?? [] : [];
}

export function conceptsForGame(gameId: string | undefined): StrategyConcept[] {
  return affinitiesForGame(gameId).map(({ conceptId }) => STRATEGY_CONCEPT_BY_ID[conceptId]);
}

export function affinityFor(gameId: string, conceptId: StrategyConceptId): number {
  return affinitiesForGame(gameId).find((entry) => entry.conceptId === conceptId)?.weight ?? 0;
}
