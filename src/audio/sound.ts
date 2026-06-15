/**
 * sound.ts — Tiny Web Audio sound engine for the board-game app.
 *
 * Everything is synthesized at runtime with the Web Audio API (oscillators,
 * gain envelopes and a touch of filtered noise) — there are NO external audio
 * assets to load. Sounds are intentionally short, crisp and modern: think a
 * polished app / Chess.com-style move click rather than a retro arcade bleep.
 *
 * The module is safe to import in Node / during SSR: no `AudioContext` is
 * constructed at import time, and every browser-only access is guarded.
 *
 * Typical usage:
 * ```ts
 * import { resumeAudio, playSound, toggleMuted } from '@/audio/sound';
 *
 * // On the first user gesture (click / keydown):
 * resumeAudio();
 *
 * playSound('move');
 * ```
 */

/** Names of every sound the engine can play. */
export type SoundName =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'promote'
  | 'win'
  | 'lose'
  | 'draw'
  | 'select'
  | 'illegal'
  | 'click';

/** localStorage key used to persist the mute preference. */
const MUTE_STORAGE_KEY = 'gm-muted';

/**
 * Master output level. Every voice is additionally scaled by its own per-note
 * gain, so this just keeps the whole engine comfortably below clipping.
 */
const MASTER_GAIN = 0.9;

/**
 * Lazily-created shared AudioContext. Created only in the browser, on demand,
 * so importing this module never throws in Node / during SSR.
 */
let ctx: AudioContext | null = null;

/** Shared master gain node, created alongside the context. */
let master: GainNode | null = null;

/** Cached mute state (mirrors localStorage so reads are cheap). */
let muted = false;
let muteLoaded = false;

/**
 * Returns the global AudioContext constructor if one exists in this
 * environment (standard `AudioContext` or the legacy WebKit-prefixed name),
 * or `undefined` when running outside a browser.
 */
function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

/**
 * Lazily creates (once) and returns the shared AudioContext plus its master
 * gain node, or `null` when the Web Audio API is unavailable (e.g. Node/SSR).
 */
function getContext(): { ctx: AudioContext; master: GainNode } | null {
  if (ctx && master) return { ctx, master };

  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    return { ctx, master };
  } catch {
    // Construction can throw under unusual autoplay/security policies.
    ctx = null;
    master = null;
    return null;
  }
}

/**
 * Resumes the shared AudioContext. Browsers start contexts in a "suspended"
 * state until a user gesture occurs, so call this from your first
 * click / keydown / pointerdown handler. Safe to call repeatedly and safe to
 * call in Node (it simply does nothing).
 */
export function resumeAudio(): void {
  const c = getContext();
  if (!c) return;
  if (c.ctx.state === 'suspended') {
    // Fire-and-forget; ignore rejection (e.g. no gesture yet).
    void c.ctx.resume().catch(() => {});
  }
}

/** Reads the persisted mute flag from localStorage (guarded for Node/SSR). */
function loadMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Ensures the cached mute state has been hydrated from storage exactly once. */
function ensureMuteLoaded(): void {
  if (muteLoaded) return;
  muted = loadMuted();
  muteLoaded = true;
}

/** Returns whether sound is currently muted. */
export function isMuted(): boolean {
  ensureMuteLoaded();
  return muted;
}

/**
 * Sets the mute state and persists it to localStorage. When muted,
 * {@link playSound} becomes a no-op.
 */
export function setMuted(m: boolean): void {
  muted = m;
  muteLoaded = true;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, m ? 'true' : 'false');
    } catch {
      // Ignore quota / privacy-mode write failures.
    }
  }
}

/** Toggles the mute state, persists it, and returns the new value. */
export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

/** Options for a single synthesized {@link tone}. */
interface ToneOptions {
  /** Starting frequency in Hz. */
  freq: number;
  /** Duration in seconds. */
  dur: number;
  /** Oscillator waveform. Defaults to `'triangle'` (soft, woody). */
  type?: OscillatorType;
  /** Start time offset (seconds) relative to "now". Defaults to `0`. */
  when?: number;
  /** Peak gain for this note (kept modest, ~0.15–0.25). Defaults to `0.2`. */
  gain?: number;
  /** Optional target frequency for a quick portamento glide. */
  slideTo?: number;
}

/**
 * Plays one short oscillator note with a quick attack and a smooth exponential
 * release, scheduled on the shared context. Returns silently if Web Audio is
 * unavailable. This is the workhorse helper that keeps every sound DRY.
 */
function tone(opts: ToneOptions): void {
  const c = getContext();
  if (!c) return;

  const { freq, dur, type = 'triangle', when = 0, gain = 0.2, slideTo } = opts;

  const t0 = c.ctx.currentTime + when;
  const osc = c.ctx.createOscillator();
  const g = c.ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (typeof slideTo === 'number') {
    // Glide for a tasteful pitch bend (used by the "promote" feel etc.).
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(slideTo, 1),
      t0 + dur,
    );
  }

  // Gain envelope: ramp up fast from ~silence, then exponentially decay.
  // Exponential ramps can't target 0, so we use a tiny floor.
  const attack = Math.min(0.008, dur * 0.25);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g);
  g.connect(c.master);

  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Options for a short {@link noiseBurst} transient. */
interface NoiseOptions {
  /** Duration in seconds. */
  dur: number;
  /** Start time offset (seconds) relative to "now". Defaults to `0`. */
  when?: number;
  /** Peak gain (kept low — this is a transient, not a tone). Defaults `0.08`. */
  gain?: number;
  /** Low-pass cutoff in Hz to keep the burst soft/woody. Defaults `2600`. */
  cutoff?: number;
}

/**
 * Plays a very short burst of low-pass-filtered white noise — used to add a
 * percussive "transient" to woody hits (e.g. the punchier capture thock).
 * Returns silently if Web Audio is unavailable.
 */
function noiseBurst(opts: NoiseOptions): void {
  const c = getContext();
  if (!c) return;

  const { dur, when = 0, gain = 0.08, cutoff = 2600 } = opts;
  const t0 = c.ctx.currentTime + when;

  const frames = Math.max(1, Math.floor(c.ctx.sampleRate * dur));
  const buffer = c.ctx.createBuffer(1, frames, c.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const src = c.ctx.createBufferSource();
  src.buffer = buffer;

  const filter = c.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;

  const g = c.ctx.createGain();
  g.gain.setValueAtTime(Math.max(gain, 0.0002), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(g);
  g.connect(c.master);

  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/**
 * Map of each SoundName to its synthesis recipe. Frequencies use an
 * equal-tempered scale; durations are deliberately tiny so playback feels
 * instantaneous and never annoying.
 */
const RECIPES: Record<SoundName, () => void> = {
  // Soft wooden "tock": one short, low triangle blip.
  move: () => {
    tone({ freq: 220, dur: 0.12, type: 'triangle', gain: 0.22, slideTo: 180 });
  },

  // Punchier "thock": lower body tone + a tiny filtered-noise transient.
  capture: () => {
    noiseBurst({ dur: 0.05, gain: 0.1, cutoff: 1800 });
    tone({ freq: 170, dur: 0.14, type: 'triangle', gain: 0.24, slideTo: 120 });
  },

  // Bright two-note alert (rising perfect-fourth-ish), sine for clarity.
  check: () => {
    tone({ freq: 880, dur: 0.1, type: 'sine', gain: 0.18, when: 0 });
    tone({ freq: 1175, dur: 0.13, type: 'sine', gain: 0.18, when: 0.1 });
  },

  // Quick double tock (the rook + king feel).
  castle: () => {
    tone({ freq: 240, dur: 0.08, type: 'triangle', gain: 0.2, when: 0 });
    tone({ freq: 200, dur: 0.1, type: 'triangle', gain: 0.2, when: 0.09 });
  },

  // Rising arpeggio, 3 notes (C5–E5–G5).
  promote: () => {
    tone({ freq: 523.25, dur: 0.1, type: 'triangle', gain: 0.18, when: 0 });
    tone({ freq: 659.25, dur: 0.1, type: 'triangle', gain: 0.18, when: 0.09 });
    tone({ freq: 783.99, dur: 0.16, type: 'triangle', gain: 0.18, when: 0.18 });
  },

  // Pleasant major fanfare, 4 notes up (C5–E5–G5–C6).
  win: () => {
    tone({ freq: 523.25, dur: 0.12, type: 'triangle', gain: 0.2, when: 0 });
    tone({ freq: 659.25, dur: 0.12, type: 'triangle', gain: 0.2, when: 0.11 });
    tone({ freq: 783.99, dur: 0.12, type: 'triangle', gain: 0.2, when: 0.22 });
    tone({ freq: 1046.5, dur: 0.22, type: 'triangle', gain: 0.21, when: 0.33 });
  },

  // Soft descending minor pair (A4 → F4).
  lose: () => {
    tone({ freq: 440, dur: 0.16, type: 'sine', gain: 0.18, when: 0 });
    tone({ freq: 349.23, dur: 0.24, type: 'sine', gain: 0.18, when: 0.14 });
  },

  // Neutral two-note (same pitch, gentle) — feels balanced/inconclusive.
  draw: () => {
    tone({ freq: 392, dur: 0.12, type: 'sine', gain: 0.17, when: 0 });
    tone({ freq: 392, dur: 0.16, type: 'sine', gain: 0.15, when: 0.13 });
  },

  // Very soft, high, fast tick for selecting a piece/square.
  select: () => {
    tone({ freq: 1320, dur: 0.05, type: 'sine', gain: 0.12 });
  },

  // Short low buzz to signal an illegal/blocked action.
  illegal: () => {
    tone({ freq: 140, dur: 0.16, type: 'sawtooth', gain: 0.16, slideTo: 110 });
  },

  // Tiny UI tick for generic button/menu clicks.
  click: () => {
    tone({ freq: 660, dur: 0.04, type: 'triangle', gain: 0.13 });
  },
};

/**
 * Plays the named sound. No-op when muted, when the name is unknown, or when
 * the Web Audio API is unavailable (Node/SSR or unsupported browser). Never
 * throws.
 */
export function playSound(name: SoundName): void {
  if (isMuted()) return;

  const recipe = RECIPES[name];
  if (!recipe) return;

  const c = getContext();
  if (!c) return;

  // Best-effort resume: some browsers leave the context suspended until a
  // gesture, and scheduling onto a suspended context is harmless.
  if (c.ctx.state === 'suspended') {
    void c.ctx.resume().catch(() => {});
  }

  try {
    recipe();
  } catch {
    // Swallow any scheduling error so audio never breaks game logic.
  }
}
