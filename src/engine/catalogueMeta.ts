/**
 * Lightweight catalogue metadata for the landing page and onboarding.
 *
 * The full registry imports every game's engine, AI and (large) tutorial, so any
 * module that touches it drags all of that into the initial bundle. The landing
 * and the first-run onboarding only need a count, a few emblems and a handful of
 * starter games — so they read this tiny, dependency-free module instead.
 * `GAME_COUNT` is the full engine count; `CATALOGUE_WORLD_COUNT` is the number
 * of cards after closely related variants are grouped into one world.
 */
export const GAME_COUNT = 38;
export const CATALOGUE_WORLD_COUNT = 32;

export interface StarterMeta { id: string; name: string; emoji: string; tagline: string }

export const STARTERS: StarterMeta[] = [
  { id: 'chess', name: 'Chess', emoji: '♛', tagline: 'The royal game — the deepest classic of all.' },
  { id: 'connect-four', name: 'Connect Four', emoji: '🔴', tagline: 'Drop discs and make four in a row.' },
  { id: 'checkers', name: 'Checkers', emoji: '⛂', tagline: 'Jump, capture and crown your kings.' },
  { id: 'gomoku', name: 'Gomoku', emoji: '⚫', tagline: 'Line up five before your opponent.' },
];

/** Emblems used for the landing's decorative teaser strip. */
export const SAMPLE_EMOJIS = ['♛', '⛀', '🔴', '⚫', '🌀', '🎲', '🦊', '🟡', '⛓️', '🎯', '🔀', '♟'];

/** Ids "Surprise me" can drop you into. */
export const SURPRISE_IDS = ['chess', 'checkers', 'reversi', 'connect-four', 'gomoku', 'go', 'backgammon', 'hex', 'surakarta', 'ultimate', 'fox-and-hounds', 'amazons', 'order-and-chaos'];
