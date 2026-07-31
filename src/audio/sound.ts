/**
 * Original procedural audio for the Grandmaster game platform.
 *
 * Every cue is synthesized at runtime. There are no samples, copied melodies,
 * network requests, or autoplaying tracks. The engine is deliberately lazy and
 * SSR-safe: an AudioContext is created only after a sound/resume call, which is
 * expected to happen from a user gesture.
 */

/** Names of every sound the engine can play. Existing names remain stable. */
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
  | 'click'
  | 'levelup'
  | 'coin'
  | 'place'
  | 'rotate'
  | 'score'
  | 'cascade'
  | 'combo'
  | 'special'
  | 'objective'
  | 'power'
  | 'complete'
  | 'undo';

/** Per-play expression controls. All values are clamped before synthesis. */
export interface SoundOptions {
  /** Expressive strength from 0 (subtle) to 1 (full). Defaults to 0.62. */
  intensity?: number;
  /** Semantic chain/cascade depth. Larger values add harmonic lift, capped at 12. */
  depth?: number;
  /** Stereo placement from -1 (left) to 1 (right). Defaults to centre. */
  pan?: number;
}

/**
 * Overall mix profiles. Profiles change output strength, voice expression, and
 * spatial ambience, but never remove gameplay cues.
 */
export type SoundIntensityMode = 'cinematic' | 'balanced' | 'quiet';

/** Ordered modes, suitable for rendering in a settings control. */
export const SOUND_INTENSITY_MODES: readonly SoundIntensityMode[] = [
  'quiet',
  'balanced',
  'cinematic',
] as const;

/** Storage keys are exported so settings/migrations can refer to one source. */
export const MUTE_STORAGE_KEY = 'gm-muted';
export const SOUND_INTENSITY_STORAGE_KEY = 'gm-sound-intensity';

const DEFAULT_INTENSITY_MODE: SoundIntensityMode = 'balanced';
const MODE_PROFILE: Record<
  SoundIntensityMode,
  { gain: number; expression: number; ambience: number }
> = {
  quiet: { gain: 0.38, expression: 0.8, ambience: 0.52 },
  balanced: { gain: 0.68, expression: 1, ambience: 1 },
  cinematic: { gain: 0.9, expression: 1.12, ambience: 1.2 },
};
const MAX_ACTIVE_VOICES = 56;
const SILENCE = 0.0001;
const MASTER_RAMP_SECONDS = 0.01;

interface AudioGraph {
  ctx: AudioContext;
  input: GainNode;
  output: GainNode;
  delay?: DelayNode;
}

interface ResolvedSoundOptions {
  intensity: number;
  depth: number;
  pan: number;
  expression: number;
  profile: SoundIntensityMode;
}

interface ToneOptions {
  freq: number;
  dur: number;
  type?: OscillatorType;
  when?: number;
  gain?: number;
  attack?: number;
  slideTo?: number;
  pan?: number;
  space?: number;
}

interface NoiseOptions {
  dur: number;
  seed: number;
  when?: number;
  gain?: number;
  cutoff?: number;
  cutoffTo?: number;
  filterType?: BiquadFilterType;
  pan?: number;
  space?: number;
}

interface ActiveVoice {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
  cleanup: () => void;
}

let graph: AudioGraph | null = null;
let muted = false;
let muteLoaded = false;
let intensityMode: SoundIntensityMode = DEFAULT_INTENSITY_MODE;
let intensityLoaded = false;
let eventSequence = 0;
const activeVoices: ActiveVoice[] = [];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveOptions(options?: SoundOptions): ResolvedSoundOptions {
  const intensity = clamp(finiteOr(options?.intensity, 0.62), 0, 1);
  const profile = getSoundIntensityMode();
  return {
    intensity,
    depth: Math.round(clamp(finiteOr(options?.depth, 1), 0, 12)),
    pan: clamp(finiteOr(options?.pan, 0), -1, 1),
    // A zero-intensity cue is still quietly legible for accessibility.
    expression: expressionFor(intensity, profile),
    profile,
  };
}

function expressionFor(
  intensity: number,
  profile: SoundIntensityMode,
): number {
  return (0.42 + clamp(intensity, 0, 1) * 0.58)
    * MODE_PROFILE[profile].expression;
}

function withIntensityFloor(
  options: ResolvedSoundOptions,
  floor: number,
): ResolvedSoundOptions {
  const intensity = Math.max(options.intensity, floor);
  if (intensity === options.intensity) return options;
  return {
    ...options,
    intensity,
    expression: expressionFor(intensity, options.profile),
  };
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const audioWindow = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
}

function loadMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function ensureMuteLoaded(): void {
  if (muteLoaded) return;
  muted = loadMuted();
  muteLoaded = true;
}

function isIntensityMode(value: string | null): value is SoundIntensityMode {
  return value === 'cinematic' || value === 'balanced' || value === 'quiet';
}

function loadIntensityMode(): SoundIntensityMode {
  if (typeof localStorage === 'undefined') return DEFAULT_INTENSITY_MODE;
  try {
    const saved = localStorage.getItem(SOUND_INTENSITY_STORAGE_KEY);
    return isIntensityMode(saved) ? saved : DEFAULT_INTENSITY_MODE;
  } catch {
    return DEFAULT_INTENSITY_MODE;
  }
}

function ensureIntensityLoaded(): void {
  if (intensityLoaded) return;
  intensityMode = loadIntensityMode();
  intensityLoaded = true;
}

function rampAudioParam(
  param: AudioParam,
  target: number,
  audioContext: AudioContext,
): void {
  try {
    const now = audioContext.currentTime;
    const current = Number.isFinite(param.value) ? param.value : target;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(target, now + MASTER_RAMP_SECONDS);
    return;
  } catch {
    // Partial Web Audio shims may omit automation methods.
  }
  try {
    param.value = target;
  } catch {
    // A read-only/broken AudioParam should not affect game state.
  }
}

function updateOutputLevel(): void {
  if (!graph) return;
  ensureMuteLoaded();
  ensureIntensityLoaded();
  rampAudioParam(
    graph.output.gain,
    muted ? 0 : MODE_PROFILE[intensityMode].gain,
    graph.ctx,
  );
}

function releaseClosedGraph(): void {
  if (!graph) return;
  const stale = graph;
  graph = null;
  [...activeVoices].forEach((voice) => {
    try {
      voice.source.stop();
    } catch {
      // A closed context may already have ended each source.
    }
    voice.cleanup();
  });
  safeDisconnect(stale.input);
  safeDisconnect(stale.output);
}

function resumeGraph(audio: AudioGraph): void {
  const state = String(audio.ctx.state);
  if (state === 'running' || state === 'closed') return;
  try {
    void Promise.resolve(audio.ctx.resume()).catch(() => {});
  } catch {
    // Some partial Web Audio implementations throw synchronously.
  }
}

/**
 * Creates the shared dynamics and ambience graph. Each voice enters a
 * high-ratio compressor for peak control (not a brick-wall limiter) before
 * output; a restrained feedback delay provides optional space. Every optional
 * Web Audio feature has a dry fallback.
 */
function getGraph(): AudioGraph | null {
  if (graph && String(graph.ctx.state) === 'closed') releaseClosedGraph();
  if (graph) return graph;

  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  try {
    const audioContext = new Ctor();
    const input = audioContext.createGain();
    const output = audioContext.createGain();
    output.gain.value = 0;

    let dynamicsConnected = false;
    try {
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -22;
      compressor.knee.value = 18;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.24;
      input.connect(compressor);
      compressor.connect(output);
      dynamicsConnected = true;
    } catch {
      // Older/partial implementations still get the dry master path.
    }
    if (!dynamicsConnected) input.connect(output);
    output.connect(audioContext.destination);

    let delay: DelayNode | undefined;
    try {
      delay = audioContext.createDelay(0.8);
      const feedback = audioContext.createGain();
      const wet = audioContext.createGain();
      delay.delayTime.value = 0.115;
      feedback.gain.value = 0.16;
      wet.gain.value = 0.42;
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(input);
    } catch {
      delay = undefined;
    }

    graph = { ctx: audioContext, input, output, delay };
    updateOutputLevel();
    return graph;
  } catch {
    graph = null;
    return null;
  }
}

/** Resumes audio after a user gesture. Safe to call repeatedly and during SSR. */
export function resumeAudio(): void {
  const audio = getGraph();
  if (!audio) return;
  resumeGraph(audio);
}

/** Returns whether all game audio is currently muted. */
export function isMuted(): boolean {
  ensureMuteLoaded();
  return muted;
}

/** Sets and persists mute. Active tails are silenced through the master output. */
export function setMuted(nextMuted: boolean): void {
  muted = Boolean(nextMuted);
  muteLoaded = true;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
    } catch {
      // Storage is optional (privacy mode, full quota, SSR).
    }
  }
  updateOutputLevel();
}

/** Toggles mute, persists it, and returns the resulting state. */
export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

/** Returns the persisted master sound profile. */
export function getSoundIntensityMode(): SoundIntensityMode {
  ensureIntensityLoaded();
  return intensityMode;
}

/** Sets the master sound profile and returns the accepted value. */
export function setSoundIntensityMode(
  nextMode: SoundIntensityMode,
): SoundIntensityMode {
  intensityMode = isIntensityMode(nextMode) ? nextMode : DEFAULT_INTENSITY_MODE;
  intensityLoaded = true;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SOUND_INTENSITY_STORAGE_KEY, intensityMode);
    } catch {
      // The in-memory preference remains useful when persistence is blocked.
    }
  }
  updateOutputLevel();
  return intensityMode;
}

/** Advances quiet → balanced → cinematic → quiet for compact controls. */
export function cycleSoundIntensityMode(): SoundIntensityMode {
  const currentIndex = SOUND_INTENSITY_MODES.indexOf(getSoundIntensityMode());
  const nextIndex = (currentIndex + 1) % SOUND_INTENSITY_MODES.length;
  return setSoundIntensityMode(SOUND_INTENSITY_MODES[nextIndex]);
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Nodes may already be disconnected by their host browser.
  }
}

function registerVoice(
  source: AudioScheduledSourceNode,
  nodes: AudioNode[],
): void {
  while (activeVoices.length >= MAX_ACTIVE_VOICES) {
    const oldest = activeVoices.shift();
    if (!oldest) break;
    try {
      oldest.source.stop();
    } catch {
      // A previously-ended source may reject an additional stop.
    }
    oldest.cleanup();
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const index = activeVoices.findIndex((voice) => voice.source === source);
    if (index >= 0) activeVoices.splice(index, 1);
    safeDisconnect(source);
    nodes.forEach(safeDisconnect);
  };

  try {
    source.onended = cleanup;
  } catch {
    // A minimal Web Audio shim may not expose onended.
  }
  activeVoices.push({ source, nodes, cleanup });
}

/**
 * Routes a voice to the dry bus, plus a small ambience send when supported.
 * StereoPanner is optional so older Safari/WebView builds stay functional.
 */
function routeVoice(
  audio: AudioGraph,
  voiceGain: GainNode,
  pan: number,
  space: number,
  nodes: AudioNode[],
): void {
  let tail: AudioNode = voiceGain;
  try {
    const panner = audio.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    tail.connect(panner);
    tail = panner;
    nodes.push(panner);
  } catch {
    // Centre-panned dry audio is the compatibility fallback.
  }

  tail.connect(audio.input);
  if (!audio.delay || space <= 0) return;
  try {
    const send = audio.ctx.createGain();
    ensureIntensityLoaded();
    send.gain.value = clamp(
      space * MODE_PROFILE[intensityMode].ambience,
      0,
      0.36,
    );
    tail.connect(send);
    send.connect(audio.delay);
    nodes.push(send);
  } catch {
    // The dry route is already connected.
  }
}

function scheduleTone(options: ToneOptions): void {
  const audio = getGraph();
  if (!audio) return;

  const {
    freq,
    dur,
    type = 'triangle',
    when = 0,
    gain = 0.12,
    attack = Math.min(0.009, dur * 0.22),
    slideTo,
    pan = 0,
    space = 0,
  } = options;
  const t0 = audio.ctx.currentTime + Math.max(0, when);
  const oscillator = audio.ctx.createOscillator();
  const voiceGain = audio.ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(1, freq), t0);
  if (typeof slideTo === 'number') {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, slideTo),
      t0 + dur,
    );
  }
  voiceGain.gain.setValueAtTime(SILENCE, t0);
  voiceGain.gain.exponentialRampToValueAtTime(
    Math.max(SILENCE * 2, gain),
    t0 + attack,
  );
  voiceGain.gain.exponentialRampToValueAtTime(SILENCE, t0 + dur);

  oscillator.connect(voiceGain);
  const localNodes: AudioNode[] = [voiceGain];
  routeVoice(audio, voiceGain, pan, space, localNodes);
  registerVoice(oscillator, localNodes);
  oscillator.start(t0);
  oscillator.stop(t0 + dur + 0.025);
}

/** One broken oscillator layer must not prevent later recipe layers. */
function tone(options: ToneOptions): void {
  try {
    scheduleTone(options);
  } catch {
    // Layer-level isolation keeps the rest of the cue audible.
  }
}

/** Small deterministic PRNG: reproducible texture without Math.random(). */
function fillDeterministicNoise(data: Float32Array, seed: number): void {
  let state = (seed | 0) || 0x6d2b79f5;
  for (let index = 0; index < data.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[index] = ((state >>> 0) / 0x80000000) - 1;
  }
}

function scheduleNoiseBurst(options: NoiseOptions): void {
  const audio = getGraph();
  if (!audio) return;

  const {
    dur,
    seed,
    when = 0,
    gain = 0.05,
    cutoff = 2400,
    cutoffTo,
    filterType = 'lowpass',
    pan = 0,
    space = 0,
  } = options;
  const t0 = audio.ctx.currentTime + Math.max(0, when);
  const frames = Math.max(1, Math.floor(audio.ctx.sampleRate * dur));
  const buffer = audio.ctx.createBuffer(1, frames, audio.ctx.sampleRate);
  fillDeterministicNoise(buffer.getChannelData(0), seed);

  const source = audio.ctx.createBufferSource();
  source.buffer = buffer;
  const filter = audio.ctx.createBiquadFilter();
  const voiceGain = audio.ctx.createGain();
  filter.type = filterType;
  filter.frequency.setValueAtTime(cutoff, t0);
  if (typeof cutoffTo === 'number') {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(1, cutoffTo),
      t0 + dur,
    );
  }
  filter.Q.value = filterType === 'bandpass' ? 0.9 : 0.35;
  voiceGain.gain.setValueAtTime(SILENCE, t0);
  voiceGain.gain.exponentialRampToValueAtTime(
    Math.max(SILENCE * 2, gain),
    t0 + Math.min(0.006, dur * 0.18),
  );
  voiceGain.gain.exponentialRampToValueAtTime(SILENCE, t0 + dur);

  source.connect(filter);
  filter.connect(voiceGain);
  const localNodes: AudioNode[] = [filter, voiceGain];
  routeVoice(audio, voiceGain, pan, space, localNodes);
  registerVoice(source, localNodes);
  source.start(t0);
  source.stop(t0 + dur + 0.025);
}

/** Optional noise/filter support can fail without silencing oscillator layers. */
function noiseBurst(options: NoiseOptions): void {
  try {
    scheduleNoiseBurst(options);
  } catch {
    // Layer-level isolation keeps the tonal body/transient available.
  }
}

function depthPitch(depth: number, semitones = 0.8): number {
  return 2 ** ((Math.min(depth, 8) * semitones) / 12);
}

function sequenceSeed(name: SoundName, sequence: number, layer = 0): number {
  let hash = 2166136261 ^ sequence ^ (layer * 0x9e3779b9);
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type Recipe = (
  options: ResolvedSoundOptions,
  sequence: number,
  name: SoundName,
) => void;

const RECIPES: Record<SoundName, Recipe> = {
  move: (o, sequence, name) => {
    noiseBurst({
      dur: 0.026,
      gain: 0.027 * o.expression,
      cutoff: 1850,
      pan: o.pan,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 205,
      slideTo: 158,
      dur: 0.13,
      gain: 0.13 * o.expression,
      pan: o.pan,
      space: 0.025,
    });
    tone({
      freq: 410,
      slideTo: 350,
      dur: 0.07,
      gain: 0.035 * o.expression,
      pan: o.pan,
    });
  },

  capture: (o, sequence, name) => {
    noiseBurst({
      dur: 0.065,
      gain: 0.07 * o.expression,
      cutoff: 1550,
      cutoffTo: 620,
      pan: o.pan,
      space: 0.04,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 138,
      slideTo: 82,
      dur: 0.2,
      type: 'triangle',
      gain: 0.17 * o.expression,
      pan: o.pan,
      space: 0.06,
    });
    tone({
      freq: 276,
      slideTo: 205,
      dur: 0.11,
      gain: 0.055 * o.expression,
      pan: o.pan,
    });
  },

  check: (o) => {
    tone({
      freq: 740,
      dur: 0.1,
      type: 'sine',
      gain: 0.095 * o.expression,
      pan: o.pan - 0.08,
      space: 0.08,
    });
    tone({
      freq: 987.77,
      dur: 0.17,
      type: 'sine',
      gain: 0.11 * o.expression,
      when: 0.085,
      pan: o.pan + 0.08,
      space: 0.1,
    });
  },

  castle: (o, sequence, name) => {
    RECIPES.move({ ...o, pan: clamp(o.pan - 0.18, -1, 1) }, sequence, name);
    tone({
      freq: 185,
      slideTo: 145,
      dur: 0.14,
      gain: 0.135 * o.expression,
      when: 0.105,
      pan: clamp(o.pan + 0.18, -1, 1),
      space: 0.04,
    });
  },

  promote: (o) => {
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, index) => tone({
      freq,
      dur: index === notes.length - 1 ? 0.27 : 0.12,
      gain: (index === notes.length - 1 ? 0.105 : 0.075) * o.expression,
      when: index * 0.075,
      pan: o.pan + (index - 1.5) * 0.04,
      space: 0.14,
    }));
  },

  win: (o, sequence, name) => {
    noiseBurst({
      dur: 0.32,
      gain: 0.028 * o.expression,
      cutoff: 700,
      cutoffTo: 3800,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.18,
      seed: sequenceSeed(name, sequence),
    });
    [392, 493.88, 587.33, 783.99].forEach((freq, index) => tone({
      freq,
      dur: index === 3 ? 0.46 : 0.2,
      type: index === 3 ? 'sine' : 'triangle',
      gain: (index === 3 ? 0.14 : 0.09) * o.expression,
      when: index * 0.115,
      pan: o.pan + (index - 1.5) * 0.055,
      space: 0.2,
    }));
    tone({
      freq: 98,
      slideTo: 65,
      dur: 0.35,
      gain: 0.1 * o.expression,
      when: 0.31,
      pan: o.pan,
      space: 0.08,
    });
  },

  lose: (o) => {
    [392, 329.63, 246.94].forEach((freq, index) => tone({
      freq,
      dur: index === 2 ? 0.32 : 0.18,
      type: 'sine',
      gain: 0.065 * o.expression,
      when: index * 0.13,
      pan: o.pan,
      space: 0.14,
    }));
  },

  draw: (o) => {
    tone({
      freq: 349.23,
      dur: 0.26,
      type: 'sine',
      gain: 0.07 * o.expression,
      pan: o.pan - 0.08,
      space: 0.12,
    });
    tone({
      freq: 440,
      dur: 0.26,
      type: 'sine',
      gain: 0.07 * o.expression,
      when: 0.13,
      pan: o.pan + 0.08,
      space: 0.12,
    });
  },

  select: (o) => {
    tone({
      freq: 1120,
      slideTo: 1320,
      dur: 0.045,
      type: 'sine',
      gain: 0.052 * o.expression,
      pan: o.pan,
    });
  },

  illegal: (o, sequence, name) => {
    noiseBurst({
      dur: 0.045,
      gain: 0.025 * o.expression,
      cutoff: 480,
      pan: o.pan,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 155,
      slideTo: 112,
      dur: 0.15,
      type: 'sawtooth',
      gain: 0.07 * o.expression,
      pan: o.pan,
    });
  },

  click: (o, sequence, name) => {
    noiseBurst({
      dur: 0.018,
      gain: 0.022 * o.expression,
      cutoff: 3200,
      pan: o.pan,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 720,
      slideTo: 620,
      dur: 0.035,
      gain: 0.04 * o.expression,
      pan: o.pan,
    });
  },

  levelup: (o, sequence, name) => {
    RECIPES.complete(withIntensityFloor(o, 0.72), sequence, name);
  },

  coin: (o, sequence, name) => {
    noiseBurst({
      dur: 0.028,
      gain: 0.022 * o.expression,
      cutoff: 6200,
      filterType: 'bandpass',
      pan: o.pan,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 1318.51,
      slideTo: 1567.98,
      dur: 0.09,
      type: 'sine',
      gain: 0.07 * o.expression,
      pan: o.pan - 0.06,
      space: 0.08,
    });
    tone({
      freq: 1975.53,
      dur: 0.14,
      type: 'sine',
      gain: 0.055 * o.expression,
      when: 0.065,
      pan: o.pan + 0.06,
      space: 0.1,
    });
  },

  place: (o, sequence, name) => {
    noiseBurst({
      dur: 0.03,
      gain: 0.032 * o.expression,
      cutoff: 2100,
      pan: o.pan,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 245,
      slideTo: 196,
      dur: 0.11,
      gain: 0.12 * o.expression,
      pan: o.pan,
      space: 0.03,
    });
    tone({
      freq: 735,
      dur: 0.055,
      gain: 0.032 * o.expression,
      pan: o.pan,
    });
  },

  rotate: (o, sequence, name) => {
    noiseBurst({
      dur: 0.22,
      gain: 0.034 * o.expression,
      cutoff: 550,
      cutoffTo: 4300,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.1,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 220,
      slideTo: 440,
      dur: 0.2,
      type: 'sine',
      gain: 0.052 * o.expression,
      pan: o.pan,
      space: 0.08,
    });
  },

  score: (o) => {
    const lift = depthPitch(o.depth, 0.55);
    tone({
      freq: 523.25 * lift,
      dur: 0.1,
      gain: 0.065 * o.expression,
      pan: o.pan - 0.05,
      space: 0.08,
    });
    tone({
      freq: 659.25 * lift,
      dur: 0.18,
      gain: 0.08 * o.expression,
      when: 0.075,
      pan: o.pan + 0.05,
      space: 0.12,
    });
  },

  cascade: (o, sequence, name) => {
    const lift = depthPitch(o.depth);
    noiseBurst({
      dur: 0.075 + Math.min(o.depth, 6) * 0.008,
      gain: (0.035 + Math.min(o.depth, 6) * 0.004) * o.expression,
      cutoff: 1250 * lift,
      cutoffTo: 3100 * lift,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.12,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 196 * lift,
      slideTo: 147 * lift,
      dur: 0.16,
      gain: (0.1 + Math.min(o.depth, 6) * 0.008) * o.expression,
      pan: o.pan,
      space: 0.08,
    });
    tone({
      freq: 587.33 * lift,
      slideTo: 783.99 * lift,
      dur: 0.15,
      type: 'sine',
      gain: 0.056 * o.expression,
      when: 0.035,
      pan: o.pan,
      space: 0.16,
    });
  },

  combo: (o) => {
    const lift = depthPitch(o.depth, 0.7);
    const count = clamp(2 + Math.floor(o.depth / 2), 2, 5);
    const chord = [392, 493.88, 587.33, 783.99, 987.77];
    for (let index = 0; index < count; index += 1) {
      tone({
        freq: chord[index] * lift,
        dur: index === count - 1 ? 0.24 : 0.105,
        gain: (index === count - 1 ? 0.092 : 0.062) * o.expression,
        when: index * 0.055,
        pan: clamp(o.pan + (index - (count - 1) / 2) * 0.06, -1, 1),
        space: 0.16,
      });
    }
  },

  special: (o, sequence, name) => {
    noiseBurst({
      dur: 0.31,
      gain: 0.026 * o.expression,
      cutoff: 950,
      cutoffTo: 6600,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.2,
      seed: sequenceSeed(name, sequence),
    });
    [440, 659.25, 880, 1318.51].forEach((freq, index) => tone({
      freq,
      dur: 0.24,
      type: 'sine',
      gain: 0.052 * o.expression,
      when: index * 0.047,
      pan: o.pan + (index - 1.5) * 0.045,
      space: 0.22,
    }));
  },

  objective: (o) => {
    [493.88, 622.25, 739.99].forEach((freq, index) => tone({
      freq,
      dur: index === 2 ? 0.3 : 0.13,
      gain: (index === 2 ? 0.105 : 0.075) * o.expression,
      when: index * 0.09,
      pan: o.pan + (index - 1) * 0.05,
      space: 0.17,
    }));
  },

  power: (o, sequence, name) => {
    noiseBurst({
      dur: 0.28,
      gain: 0.047 * o.expression,
      cutoff: 420,
      cutoffTo: 5200,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.16,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 82.41,
      slideTo: 61.74,
      dur: 0.32,
      gain: 0.15 * o.expression,
      when: 0.12,
      pan: o.pan,
      space: 0.08,
    });
    tone({
      freq: 329.63,
      slideTo: 659.25,
      dur: 0.31,
      type: 'sine',
      gain: 0.075 * o.expression,
      pan: o.pan,
      space: 0.18,
    });
  },

  complete: (o, sequence, name) => {
    noiseBurst({
      dur: 0.46,
      gain: 0.032 * o.expression,
      cutoff: 520,
      cutoffTo: 4700,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.22,
      seed: sequenceSeed(name, sequence),
    });
    [349.23, 440, 523.25, 698.46, 880].forEach((freq, index, notes) => tone({
      freq,
      dur: index === notes.length - 1 ? 0.58 : 0.2,
      type: index >= 3 ? 'sine' : 'triangle',
      gain: (index === notes.length - 1 ? 0.135 : 0.083) * o.expression,
      when: index * 0.1,
      pan: clamp(o.pan + (index - 2) * 0.055, -1, 1),
      space: 0.22,
    }));
    tone({
      freq: 87.31,
      slideTo: 58.27,
      dur: 0.4,
      gain: 0.105 * o.expression,
      when: 0.38,
      pan: o.pan,
      space: 0.1,
    });
  },

  undo: (o, sequence, name) => {
    noiseBurst({
      dur: 0.16,
      gain: 0.027 * o.expression,
      cutoff: 3100,
      cutoffTo: 620,
      filterType: 'bandpass',
      pan: o.pan,
      space: 0.06,
      seed: sequenceSeed(name, sequence),
    });
    tone({
      freq: 523.25,
      slideTo: 293.66,
      dur: 0.17,
      type: 'sine',
      gain: 0.056 * o.expression,
      pan: o.pan,
      space: 0.08,
    });
    tone({
      freq: 392,
      slideTo: 493.88,
      dur: 0.1,
      gain: 0.045 * o.expression,
      when: 0.115,
      pan: o.pan,
    });
  },
};

/**
 * Plays one cue. Unknown names, unsupported Web Audio, muted output, and any
 * synthesis failure are all safe no-ops so sound can never interrupt gameplay.
 */
export function playSound(name: SoundName, options?: SoundOptions): void {
  if (isMuted()) return;
  const recipe = RECIPES[name];
  if (!recipe) return;

  const audio = getGraph();
  if (!audio) return;
  resumeGraph(audio);

  eventSequence = (eventSequence + 1) >>> 0;
  try {
    recipe(resolveOptions(options), eventSequence, name);
  } catch {
    // Audio is enhancement only. Never let a browser audio fault reach game logic.
  }
}
