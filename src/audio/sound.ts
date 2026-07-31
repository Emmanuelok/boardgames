/**
 * Original, procedural game audio for Grandmaster.
 *
 * The palette is rendered at runtime from short physical-model-inspired
 * impacts, friction textures and damped resonators. It contains no samples,
 * copied melodies, network requests, background music or autoplay.
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
  /** Semantic chain/cascade depth. Larger values add lift, capped at 12. */
  depth?: number;
  /** Stereo placement from -1 (left) to 1 (right). Defaults to centre. */
  pan?: number;
}

export type SoundIntensityMode = 'cinematic' | 'balanced' | 'quiet';

export const SOUND_INTENSITY_MODES: readonly SoundIntensityMode[] = [
  'quiet',
  'balanced',
  'cinematic',
] as const;

export const MUTE_STORAGE_KEY = 'gm-muted';
export const SOUND_INTENSITY_STORAGE_KEY = 'gm-sound-intensity';

const DEFAULT_INTENSITY_MODE: SoundIntensityMode = 'balanced';
const MODE_PROFILE: Record<
  SoundIntensityMode,
  {
    gain: number;
    expression: number;
    ambience: number;
    brightness: number;
    tail: number;
  }
> = {
  quiet: {
    gain: 0.32,
    expression: 0.78,
    ambience: 0.42,
    brightness: 0.82,
    tail: 0.82,
  },
  balanced: {
    gain: 0.56,
    expression: 1,
    ambience: 0.78,
    brightness: 1,
    tail: 1,
  },
  cinematic: {
    gain: 0.7,
    expression: 1.1,
    ambience: 1.08,
    brightness: 1.06,
    tail: 1.12,
  },
};

// Recipes now use one or two rich sources instead of many always-running
// oscillators. A smaller cap is safer during rapid cascades on mobile.
const MAX_ACTIVE_VOICES = 32;
const MAX_RENDER_RATE = 24_000;
const MAX_RENDER_SECONDS = 0.9;
const MATERIAL_VARIANT_COUNT = 3;
const MAX_CACHED_MATERIAL_BUFFERS = 96;
const SILENCE = 0.0001;
const MASTER_RAMP_SECONDS = 0.012;

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

interface Resonance {
  freq: number;
  level: number;
  /** Exponential damping per second. */
  decay: number;
  /** Small frequency movement in Hz per second. */
  glide?: number;
}

interface ImpactOptions {
  dur: number;
  gain: number;
  seed: number;
  resonances: readonly Resonance[];
  when?: number;
  pan?: number;
  space?: number;
  /** 0 = padded/wooden, 1 = glass/metal. */
  hardness?: number;
  /** Short broadband contact component. */
  transient?: number;
  /** Low, non-tonal body under the resonances. */
  body?: number;
}

interface TextureOptions {
  dur: number;
  gain: number;
  seed: number;
  when?: number;
  pan?: number;
  space?: number;
  cutoffFrom?: number;
  cutoffTo?: number;
  reverse?: boolean;
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
const materialBufferCaches = new WeakMap<AudioContext, Map<string, AudioBuffer>>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function expressionFor(
  intensity: number,
  profile: SoundIntensityMode,
): number {
  return (0.4 + clamp(intensity, 0, 1) * 0.6)
    * MODE_PROFILE[profile].expression;
}

function resolveOptions(options?: SoundOptions): ResolvedSoundOptions {
  const intensity = clamp(finiteOr(options?.intensity, 0.62), 0, 1);
  const profile = getSoundIntensityMode();
  return {
    intensity,
    depth: Math.round(clamp(finiteOr(options?.depth, 1), 0, 12)),
    pan: clamp(finiteOr(options?.pan, 0), -1, 1),
    expression: expressionFor(intensity, profile),
    profile,
  };
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
    // A broken AudioParam must never affect game state.
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

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Nodes may already be disconnected.
  }
}

function releaseClosedGraph(): void {
  if (!graph) return;
  const stale = graph;
  graph = null;
  [...activeVoices].forEach((voice) => {
    try {
      voice.source.stop();
    } catch {
      // Closed contexts may already have ended their sources.
    }
    voice.cleanup();
  });
  materialBufferCaches.delete(stale.ctx);
  safeDisconnect(stale.input);
  safeDisconnect(stale.output);
}

function resumeGraph(audio: AudioGraph): void {
  const state = String(audio.ctx.state);
  if (state === 'running' || state === 'closed') return;
  try {
    void Promise.resolve(audio.ctx.resume()).catch(() => {});
  } catch {
    // Some Web Audio implementations throw synchronously.
  }
}

/**
 * Shared headroom and room-tail graph. A moderate compressor catches stacked
 * cascade peaks without flattening every tactile transient.
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
      compressor.threshold.value = -17;
      compressor.knee.value = 22;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.18;
      input.connect(compressor);
      compressor.connect(output);
      dynamicsConnected = true;
    } catch {
      // Dry fallback for partial implementations.
    }
    if (!dynamicsConnected) input.connect(output);
    output.connect(audioContext.destination);

    let delay: DelayNode | undefined;
    try {
      delay = audioContext.createDelay(0.55);
      const feedback = audioContext.createGain();
      const wet = audioContext.createGain();
      delay.delayTime.value = 0.092;
      feedback.gain.value = 0.105;
      wet.gain.value = 0.24;
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

export function resumeAudio(): void {
  const audio = getGraph();
  if (audio) resumeGraph(audio);
}

export function isMuted(): boolean {
  ensureMuteLoaded();
  return muted;
}

export function setMuted(nextMuted: boolean): void {
  muted = Boolean(nextMuted);
  muteLoaded = true;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
    } catch {
      // Persistence is optional.
    }
  }
  updateOutputLevel();
}

export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

export function getSoundIntensityMode(): SoundIntensityMode {
  ensureIntensityLoaded();
  return intensityMode;
}

export function setSoundIntensityMode(
  nextMode: SoundIntensityMode,
): SoundIntensityMode {
  intensityMode = isIntensityMode(nextMode) ? nextMode : DEFAULT_INTENSITY_MODE;
  intensityLoaded = true;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SOUND_INTENSITY_STORAGE_KEY, intensityMode);
    } catch {
      // The in-memory preference remains useful.
    }
  }
  updateOutputLevel();
  return intensityMode;
}

export function cycleSoundIntensityMode(): SoundIntensityMode {
  const current = SOUND_INTENSITY_MODES.indexOf(getSoundIntensityMode());
  return setSoundIntensityMode(
    SOUND_INTENSITY_MODES[(current + 1) % SOUND_INTENSITY_MODES.length],
  );
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
      // An already-ended source can reject another stop.
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
    // Minimal shims may not expose onended.
  }
  activeVoices.push({ source, nodes, cleanup });
}

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
    // Centre-panned dry fallback.
  }

  tail.connect(audio.input);
  if (!audio.delay || space <= 0) return;
  try {
    const send = audio.ctx.createGain();
    ensureIntensityLoaded();
    send.gain.value = clamp(
      space * MODE_PROFILE[intensityMode].ambience,
      0,
      0.27,
    );
    tail.connect(send);
    send.connect(audio.delay);
    nodes.push(send);
  } catch {
    // Dry route is already connected.
  }
}

function makeRng(seed: number): () => number {
  let state = (seed | 0) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 0x80000000) - 1;
  };
}

function renderRate(audio: AudioGraph): number {
  return Math.max(8_000, Math.min(MAX_RENDER_RATE, audio.ctx.sampleRate));
}

function materialNumber(value: number | undefined): string {
  return finiteOr(value, 0).toFixed(5);
}

function materialSeed(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * AudioBuffers belong to one AudioContext, so each context receives its own
 * small LRU. A material shape has three deterministic variants; repeated game
 * cues rotate through those buffers instead of synthesizing on the UI thread.
 */
function cachedMaterialBuffer(
  audioContext: AudioContext,
  shapeKey: string,
  seed: number,
  render: (stableSeed: number) => AudioBuffer,
): AudioBuffer {
  let cache = materialBufferCaches.get(audioContext);
  if (!cache) {
    cache = new Map();
    materialBufferCaches.set(audioContext, cache);
  }

  const variant = (seed >>> 0) % MATERIAL_VARIANT_COUNT;
  const cacheKey = `${shapeKey}|variant:${variant}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    // Refresh insertion order so frequently-used move materials survive bursts
    // of one-off completion and power sounds.
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const buffer = render(materialSeed(cacheKey));
  cache.set(cacheKey, buffer);
  while (cache.size > MAX_CACHED_MATERIAL_BUFFERS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  return buffer;
}

/**
 * Renders a struck material into one short buffer. The broadband contact,
 * damped inharmonic resonances and low body share an envelope, so the result
 * behaves like one object rather than a stack of disconnected beeps.
 */
function scheduleImpact(options: ImpactOptions): void {
  const audio = getGraph();
  if (!audio) return;

  const duration = clamp(options.dur, 0.018, MAX_RENDER_SECONDS);
  const sampleRate = renderRate(audio);
  const frames = Math.max(2, Math.floor(sampleRate * duration));
  const hardness = clamp(options.hardness ?? 0.5, 0, 1);
  const transient = clamp(options.transient ?? 0.24, 0, 1);
  const body = clamp(options.body ?? 0.08, 0, 1);
  const resonanceKey = options.resonances.map((resonance) => [
    materialNumber(resonance.freq),
    materialNumber(resonance.level),
    materialNumber(resonance.decay),
    materialNumber(resonance.glide),
  ].join(',')).join(';');
  const shapeKey = [
    'impact',
    sampleRate,
    frames,
    materialNumber(hardness),
    materialNumber(transient),
    materialNumber(body),
    resonanceKey,
  ].join('|');
  const buffer = cachedMaterialBuffer(
    audio.ctx,
    shapeKey,
    options.seed,
    (stableSeed) => {
      const rendered = audio.ctx.createBuffer(1, frames, sampleRate);
      const data = rendered.getChannelData(0);
      const rng = makeRng(stableSeed);
      const phases = options.resonances.map(() => rng() * Math.PI);
      let lowNoise = 0;
      let previousNoise = 0;
      let peak = 0;

      for (let index = 0; index < frames; index += 1) {
        const time = index / sampleRate;
        const random = rng();
        const color = 0.025 + hardness * 0.19;
        lowNoise += (random - lowNoise) * color;
        const contactNoise = hardness > 0.56
          ? (random - previousNoise) * 0.72 + lowNoise * 0.28
          : lowNoise;
        previousNoise = random;

        const contactEnvelope = Math.exp(
          -time * (105 + hardness * 410),
        );
        const bodyEnvelope = Math.exp(-time * (17 + hardness * 8));
        const microAttack = 1 - Math.exp(-time * 1_600);
        let sample = contactNoise * contactEnvelope * transient;
        sample += lowNoise * bodyEnvelope * body;

        options.resonances.forEach((resonance, resonanceIndex) => {
          const frequency = clamp(
            resonance.freq + (resonance.glide ?? 0) * time,
            24,
            sampleRate * 0.44,
          );
          sample += Math.sin(
            Math.PI * 2 * frequency * time + phases[resonanceIndex],
          ) * resonance.level * Math.exp(-time * resonance.decay) * microAttack;
        });

        // Soft saturation catches rare deterministic peaks without hard clipping.
        sample = sample / (1 + Math.abs(sample) * 0.48);
        data[index] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }

      // Keep different recipes on a predictable headroom scale.
      if (peak > 0.92) {
        const scale = 0.92 / peak;
        for (let index = 0; index < frames; index += 1) data[index] *= scale;
      }
      return rendered;
    },
  );

  const t0 = audio.ctx.currentTime + Math.max(0, options.when ?? 0);
  const source = audio.ctx.createBufferSource();
  source.buffer = buffer;
  const voiceGain = audio.ctx.createGain();
  const gain = clamp(options.gain, 0.002, 0.3);
  voiceGain.gain.setValueAtTime(gain, t0);
  voiceGain.gain.linearRampToValueAtTime(gain * 0.88, t0 + duration * 0.55);
  voiceGain.gain.exponentialRampToValueAtTime(SILENCE, t0 + duration);
  source.connect(voiceGain);
  const nodes: AudioNode[] = [voiceGain];
  routeVoice(
    audio,
    voiceGain,
    options.pan ?? 0,
    options.space ?? 0,
    nodes,
  );
  registerVoice(source, nodes);
  source.start(t0);
  source.stop(t0 + duration + 0.02);
}

/**
 * Emergency compatibility layer only. Modern browsers use rendered impacts;
 * this subdued oscillator prevents complete silence in partial Web Audio
 * implementations that expose oscillators but not AudioBuffer.
 */
function scheduleFallbackResonator(options: ImpactOptions): void {
  const audio = getGraph();
  if (!audio || options.resonances.length === 0) return;
  try {
    const t0 = audio.ctx.currentTime + Math.max(0, options.when ?? 0);
    const duration = Math.min(options.dur, 0.18);
    const oscillator = audio.ctx.createOscillator();
    const voiceGain = audio.ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(
      Math.max(24, options.resonances[0].freq),
      t0,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(24, options.resonances[0].freq * 0.88),
      t0 + duration,
    );
    voiceGain.gain.setValueAtTime(SILENCE, t0);
    voiceGain.gain.exponentialRampToValueAtTime(
      Math.min(0.045, options.gain * 0.35),
      t0 + 0.003,
    );
    voiceGain.gain.exponentialRampToValueAtTime(SILENCE, t0 + duration);
    oscillator.connect(voiceGain);
    const nodes: AudioNode[] = [voiceGain];
    routeVoice(
      audio,
      voiceGain,
      options.pan ?? 0,
      Math.min(options.space ?? 0, 0.04),
      nodes,
    );
    registerVoice(oscillator, nodes);
    oscillator.start(t0);
    oscillator.stop(t0 + duration + 0.02);
  } catch {
    // Sound remains optional.
  }
}

function impact(options: ImpactOptions): void {
  try {
    scheduleImpact(options);
  } catch {
    scheduleFallbackResonator(options);
  }
}

/** Renders filtered friction/air for slides, rotations and power blooms. */
function scheduleTexture(options: TextureOptions): void {
  const audio = getGraph();
  if (!audio) return;
  const duration = clamp(options.dur, 0.025, MAX_RENDER_SECONDS);
  const sampleRate = renderRate(audio);
  const frames = Math.max(2, Math.floor(sampleRate * duration));
  const cutoffFrom = clamp(options.cutoffFrom ?? 420, 80, 9_000);
  const cutoffTo = clamp(options.cutoffTo ?? 4_800, 80, 9_000);
  const shapeKey = [
    'texture',
    sampleRate,
    frames,
    materialNumber(cutoffFrom),
    materialNumber(cutoffTo),
    options.reverse ? 'reverse' : 'forward',
  ].join('|');
  const buffer = cachedMaterialBuffer(
    audio.ctx,
    shapeKey,
    options.seed,
    (stableSeed) => {
      const rendered = audio.ctx.createBuffer(1, frames, sampleRate);
      const data = rendered.getChannelData(0);
      const rng = makeRng(stableSeed);
      let low = 0;
      let previousLow = 0;

      for (let index = 0; index < frames; index += 1) {
        const progress = index / (frames - 1);
        const sweep = options.reverse ? 1 - progress : progress;
        const cutoff = cutoffFrom * ((cutoffTo / cutoffFrom) ** sweep);
        const coefficient = 1 - Math.exp(
          (-Math.PI * 2 * cutoff) / sampleRate,
        );
        low += (rng() - low) * coefficient;
        const band = low - previousLow;
        previousLow += (low - previousLow) * 0.08;
        const arch = Math.sin(Math.PI * progress) ** 1.35;
        const motion = options.reverse
          ? arch * (0.36 + progress * 0.64)
          : arch * (1 - progress * 0.36);
        data[index] = band * motion * 0.9;
      }
      return rendered;
    },
  );

  const t0 = audio.ctx.currentTime + Math.max(0, options.when ?? 0);
  const source = audio.ctx.createBufferSource();
  source.buffer = buffer;
  const voiceGain = audio.ctx.createGain();
  const gain = clamp(options.gain, 0.002, 0.22);
  voiceGain.gain.setValueAtTime(gain, t0);
  voiceGain.gain.exponentialRampToValueAtTime(SILENCE, t0 + duration);
  source.connect(voiceGain);
  const nodes: AudioNode[] = [voiceGain];
  routeVoice(
    audio,
    voiceGain,
    options.pan ?? 0,
    options.space ?? 0,
    nodes,
  );
  registerVoice(source, nodes);
  source.start(t0);
  source.stop(t0 + duration + 0.02);
}

function texture(options: TextureOptions): void {
  try {
    scheduleTexture(options);
  } catch {
    // The associated impact remains audible.
  }
}

function depthPitch(depth: number, semitones = 0.72): number {
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

interface StrikeRecipe extends Omit<ImpactOptions, 'gain' | 'seed' | 'dur'> {
  dur: number;
  gain: number;
  layer?: number;
}

function strike(
  o: ResolvedSoundOptions,
  sequence: number,
  name: SoundName,
  recipe: StrikeRecipe,
): void {
  const profile = MODE_PROFILE[o.profile];
  impact({
    ...recipe,
    dur: recipe.dur * profile.tail,
    gain: recipe.gain * o.expression,
    seed: sequenceSeed(name, sequence, recipe.layer),
    hardness: clamp(
      (recipe.hardness ?? 0.5) * profile.brightness,
      0,
      1,
    ),
    pan: clamp(recipe.pan ?? o.pan, -1, 1),
  });
}

interface MotionRecipe extends Omit<TextureOptions, 'gain' | 'seed' | 'dur'> {
  dur: number;
  gain: number;
  layer?: number;
}

function motion(
  o: ResolvedSoundOptions,
  sequence: number,
  name: SoundName,
  recipe: MotionRecipe,
): void {
  const profile = MODE_PROFILE[o.profile];
  texture({
    ...recipe,
    dur: recipe.dur * profile.tail,
    gain: recipe.gain * o.expression,
    seed: sequenceSeed(name, sequence, recipe.layer),
    cutoffFrom: (recipe.cutoffFrom ?? 420) * profile.brightness,
    cutoffTo: (recipe.cutoffTo ?? 4_800) * profile.brightness,
    pan: clamp(recipe.pan ?? o.pan, -1, 1),
  });
}

type Recipe = (
  options: ResolvedSoundOptions,
  sequence: number,
  name: SoundName,
) => void;

const RECIPES: Record<SoundName, Recipe> = {
  select: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.052,
      gain: 0.15,
      hardness: 0.82,
      transient: 0.24,
      body: 0.012,
      resonances: [
        { freq: 930, level: 0.32, decay: 92 },
        { freq: 2_080, level: 0.09, decay: 135 },
      ],
    });
  },

  click: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.046,
      gain: 0.14,
      hardness: 0.58,
      transient: 0.32,
      body: 0.025,
      resonances: [
        { freq: 560, level: 0.26, decay: 82 },
        { freq: 1_410, level: 0.06, decay: 120 },
      ],
    });
  },

  move: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.088,
      gain: 0.055,
      cutoffFrom: 310,
      cutoffTo: 1_450,
      pan: o.pan - 0.035,
    });
    strike(o, sequence, name, {
      dur: 0.14,
      gain: 0.19,
      when: 0.04,
      hardness: 0.36,
      transient: 0.24,
      body: 0.13,
      space: 0.025,
      pan: o.pan + 0.025,
      layer: 1,
      resonances: [
        { freq: 176, level: 0.3, decay: 31, glide: -80 },
        { freq: 462, level: 0.17, decay: 48 },
        { freq: 910, level: 0.045, decay: 74 },
      ],
    });
  },

  place: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.16,
      gain: 0.21,
      hardness: 0.44,
      transient: 0.3,
      body: 0.16,
      space: 0.025,
      resonances: [
        { freq: 226, level: 0.34, decay: 28, glide: -90 },
        { freq: 610, level: 0.16, decay: 45 },
        { freq: 1_180, level: 0.055, decay: 72 },
      ],
    });
  },

  capture: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.235,
      gain: 0.23,
      hardness: 0.54,
      transient: 0.48,
      body: 0.2,
      space: 0.06,
      resonances: [
        { freq: 108, level: 0.38, decay: 20, glide: -62 },
        { freq: 318, level: 0.25, decay: 31 },
        { freq: 835, level: 0.11, decay: 52 },
        { freq: 1_590, level: 0.04, decay: 78 },
      ],
    });
    strike(o, sequence, name, {
      dur: 0.082,
      gain: 0.095,
      when: 0.032,
      pan: o.pan + 0.045,
      hardness: 0.72,
      transient: 0.24,
      body: 0.02,
      layer: 1,
      resonances: [
        { freq: 710, level: 0.28, decay: 68 },
        { freq: 1_940, level: 0.08, decay: 106 },
      ],
    });
  },

  illegal: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.16,
      gain: 0.18,
      hardness: 0.12,
      transient: 0.2,
      body: 0.27,
      resonances: [
        { freq: 102, level: 0.38, decay: 26, glide: -115 },
        { freq: 246, level: 0.12, decay: 44 },
      ],
    });
  },

  check: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.105,
      gain: 0.16,
      hardness: 0.76,
      transient: 0.28,
      body: 0.02,
      pan: o.pan - 0.07,
      space: 0.055,
      resonances: [
        { freq: 640, level: 0.3, decay: 55 },
        { freq: 1_510, level: 0.095, decay: 78 },
      ],
    });
    strike(o, sequence, name, {
      dur: 0.155,
      gain: 0.17,
      when: 0.084,
      hardness: 0.8,
      transient: 0.24,
      body: 0.015,
      pan: o.pan + 0.07,
      space: 0.08,
      layer: 1,
      resonances: [
        { freq: 860, level: 0.32, decay: 46 },
        { freq: 2_060, level: 0.08, decay: 72 },
      ],
    });
  },

  castle: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.145,
      gain: 0.2,
      hardness: 0.4,
      transient: 0.3,
      body: 0.15,
      pan: o.pan - 0.18,
      resonances: [
        { freq: 188, level: 0.32, decay: 29 },
        { freq: 510, level: 0.15, decay: 48 },
      ],
    });
    strike(o, sequence, name, {
      dur: 0.17,
      gain: 0.22,
      when: 0.105,
      hardness: 0.42,
      transient: 0.34,
      body: 0.16,
      pan: o.pan + 0.18,
      space: 0.035,
      layer: 1,
      resonances: [
        { freq: 164, level: 0.36, decay: 27 },
        { freq: 455, level: 0.16, decay: 45 },
      ],
    });
  },

  rotate: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.21,
      gain: 0.085,
      cutoffFrom: 260,
      cutoffTo: 3_800,
      space: 0.065,
    });
    strike(o, sequence, name, {
      dur: 0.13,
      gain: 0.2,
      when: 0.17,
      hardness: 0.58,
      transient: 0.42,
      body: 0.1,
      layer: 1,
      resonances: [
        { freq: 144, level: 0.3, decay: 30 },
        { freq: 590, level: 0.17, decay: 52 },
        { freq: 1_360, level: 0.05, decay: 80 },
      ],
    });
  },

  score: (o, sequence, name) => {
    const lift = depthPitch(o.depth, 0.58);
    strike(o, sequence, name, {
      dur: 0.18,
      gain: 0.18,
      hardness: 0.84,
      transient: 0.22,
      body: 0.012,
      space: 0.085,
      resonances: [
        { freq: 650 * lift, level: 0.3, decay: 46 },
        { freq: 1_618 * lift, level: 0.11, decay: 62 },
        { freq: 2_520 * lift, level: 0.045, decay: 86 },
      ],
    });
  },

  cascade: (o, sequence, name) => {
    const lift = depthPitch(o.depth);
    motion(o, sequence, name, {
      dur: 0.1 + Math.min(o.depth, 6) * 0.008,
      gain: 0.045 + Math.min(o.depth, 6) * 0.004,
      cutoffFrom: 520 * lift,
      cutoffTo: 4_400 * lift,
      space: 0.07,
    });
    strike(o, sequence, name, {
      dur: 0.17,
      gain: 0.19 + Math.min(o.depth, 6) * 0.006,
      when: 0.025,
      hardness: 0.78,
      transient: 0.42,
      body: 0.055,
      space: 0.1,
      layer: 1,
      resonances: [
        { freq: 240 * lift, level: 0.25, decay: 34 },
        { freq: 720 * lift, level: 0.24, decay: 47 },
        { freq: 1_770 * lift, level: 0.09, decay: 69 },
      ],
    });
  },

  combo: (o, sequence, name) => {
    const lift = depthPitch(o.depth, 0.65);
    const weight = Math.min(o.depth, 6);
    strike(o, sequence, name, {
      dur: 0.25 + weight * 0.012,
      gain: 0.215 + weight * 0.006,
      hardness: 0.7,
      transient: 0.36,
      body: 0.12,
      space: 0.14,
      resonances: [
        { freq: 132, level: 0.3, decay: 22 },
        { freq: 430 * lift, level: 0.27, decay: 31 },
        { freq: 680 * lift, level: 0.19, decay: 40 },
        { freq: 1_130 * lift, level: 0.08, decay: 57 },
      ],
    });
    strike(o, sequence, name, {
      dur: 0.14,
      gain: 0.12,
      when: 0.072,
      hardness: 0.88,
      transient: 0.2,
      body: 0.008,
      pan: o.pan + 0.055,
      space: 0.13,
      layer: 1,
      resonances: [
        { freq: 1_040 * lift, level: 0.28, decay: 48 },
        { freq: 2_460 * lift, level: 0.08, decay: 75 },
      ],
    });
  },

  coin: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.22,
      gain: 0.17,
      hardness: 0.96,
      transient: 0.18,
      body: 0.008,
      space: 0.09,
      resonances: [
        { freq: 1_180, level: 0.28, decay: 34 },
        { freq: 1_910, level: 0.2, decay: 42 },
        { freq: 3_070, level: 0.1, decay: 55 },
        { freq: 4_490, level: 0.04, decay: 72 },
      ],
    });
  },

  undo: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.16,
      gain: 0.067,
      cutoffFrom: 520,
      cutoffTo: 3_700,
      reverse: true,
      space: 0.035,
    });
    strike(o, sequence, name, {
      dur: 0.095,
      gain: 0.135,
      when: 0.12,
      hardness: 0.5,
      transient: 0.24,
      body: 0.05,
      layer: 1,
      resonances: [
        { freq: 360, level: 0.24, decay: 50 },
        { freq: 760, level: 0.09, decay: 74 },
      ],
    });
  },

  lose: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.24,
      gain: 0.15,
      hardness: 0.2,
      transient: 0.18,
      body: 0.16,
      space: 0.08,
      resonances: [
        { freq: 210, level: 0.3, decay: 20, glide: -115 },
        { freq: 355, level: 0.13, decay: 28, glide: -150 },
      ],
    });
  },

  draw: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.18,
      gain: 0.15,
      hardness: 0.42,
      transient: 0.22,
      body: 0.07,
      pan: o.pan - 0.075,
      resonances: [
        { freq: 310, level: 0.26, decay: 31 },
        { freq: 610, level: 0.09, decay: 47 },
      ],
    });
    strike(o, sequence, name, {
      dur: 0.18,
      gain: 0.15,
      when: 0.11,
      hardness: 0.42,
      transient: 0.22,
      body: 0.07,
      pan: o.pan + 0.075,
      layer: 1,
      resonances: [
        { freq: 310, level: 0.26, decay: 31 },
        { freq: 610, level: 0.09, decay: 47 },
      ],
    });
  },

  promote: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.27,
      gain: 0.054,
      cutoffFrom: 620,
      cutoffTo: 5_900,
      space: 0.13,
    });
    strike(o, sequence, name, {
      dur: 0.32,
      gain: 0.21,
      when: 0.09,
      hardness: 0.86,
      transient: 0.2,
      body: 0.035,
      space: 0.16,
      layer: 1,
      resonances: [
        { freq: 420, level: 0.23, decay: 23 },
        { freq: 660, level: 0.2, decay: 28 },
        { freq: 1_045, level: 0.14, decay: 38 },
        { freq: 2_180, level: 0.05, decay: 56 },
      ],
    });
  },

  special: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.34,
      gain: 0.075,
      cutoffFrom: 290,
      cutoffTo: 7_100,
      space: 0.16,
    });
    strike(o, sequence, name, {
      dur: 0.38,
      gain: 0.235,
      when: 0.105,
      hardness: 0.72,
      transient: 0.34,
      body: 0.17,
      space: 0.18,
      layer: 1,
      resonances: [
        { freq: 74, level: 0.4, decay: 13, glide: -32 },
        { freq: 330, level: 0.22, decay: 22 },
        { freq: 520, level: 0.18, decay: 27 },
        { freq: 1_280, level: 0.075, decay: 44 },
      ],
    });
  },

  power: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.39,
      gain: 0.08,
      cutoffFrom: 180,
      cutoffTo: 5_800,
      space: 0.14,
    });
    strike(o, sequence, name, {
      dur: 0.45,
      gain: 0.25,
      when: 0.115,
      hardness: 0.56,
      transient: 0.4,
      body: 0.24,
      space: 0.14,
      layer: 1,
      resonances: [
        { freq: 58, level: 0.48, decay: 10, glide: -18 },
        { freq: 116, level: 0.28, decay: 15 },
        { freq: 348, level: 0.17, decay: 24 },
        { freq: 930, level: 0.06, decay: 42 },
      ],
    });
  },

  objective: (o, sequence, name) => {
    strike(o, sequence, name, {
      dur: 0.31,
      gain: 0.205,
      hardness: 0.74,
      transient: 0.2,
      body: 0.045,
      space: 0.15,
      resonances: [
        { freq: 390, level: 0.24, decay: 25 },
        { freq: 610, level: 0.2, decay: 30 },
        { freq: 970, level: 0.15, decay: 38 },
        { freq: 1_920, level: 0.05, decay: 57 },
      ],
    });
  },

  win: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.5,
      gain: 0.07,
      cutoffFrom: 240,
      cutoffTo: 7_400,
      space: 0.2,
    });
    strike(o, sequence, name, {
      dur: 0.58,
      gain: 0.255,
      when: 0.13,
      hardness: 0.64,
      transient: 0.4,
      body: 0.22,
      space: 0.2,
      layer: 1,
      resonances: [
        { freq: 64, level: 0.48, decay: 8.5, glide: -15 },
        { freq: 196, level: 0.25, decay: 14 },
        { freq: 294, level: 0.22, decay: 17 },
        { freq: 490, level: 0.17, decay: 22 },
        { freq: 1_180, level: 0.06, decay: 39 },
      ],
    });
  },

  complete: (o, sequence, name) => {
    motion(o, sequence, name, {
      dur: 0.52,
      gain: 0.074,
      cutoffFrom: 260,
      cutoffTo: 7_800,
      space: 0.22,
    });
    strike(o, sequence, name, {
      dur: 0.64,
      gain: 0.26,
      when: 0.115,
      hardness: 0.68,
      transient: 0.4,
      body: 0.23,
      space: 0.22,
      layer: 1,
      resonances: [
        { freq: 62, level: 0.46, decay: 8.2, glide: -14 },
        { freq: 220, level: 0.22, decay: 13 },
        { freq: 330, level: 0.21, decay: 16 },
        { freq: 550, level: 0.17, decay: 21 },
        { freq: 880, level: 0.12, decay: 28 },
        { freq: 1_960, level: 0.045, decay: 47 },
      ],
    });
  },

  levelup: (o, sequence, name) => {
    RECIPES.complete(withIntensityFloor(o, 0.74), sequence, name);
  },
};

/**
 * Plays one cue. Unknown names, unsupported Web Audio, mute state and synthesis
 * faults are safe no-ops, so sound can never interrupt gameplay.
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
    // Audio is enhancement only.
  }
}
