import { beforeEach, describe, expect, it, vi } from 'vitest';

class MockAudioParam {
  value = 0;
  readonly values: Array<{ method: string; value: number; time: number }> = [];
  readonly cancelScheduledValues = vi.fn((time: number) => {
    this.values.push({ method: 'cancel', value: this.value, time });
    return this;
  });

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.values.push({ method: 'set', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.values.push({ method: 'exponential', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    this.values.push({ method: 'linear', value, time });
    return this;
  }
}

class MockAudioNode {
  readonly connections: MockAudioNode[] = [];
  readonly disconnect = vi.fn();

  connect<T extends MockAudioNode>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }
}

class MockGainNode extends MockAudioNode {
  readonly gain = new MockAudioParam();
}

class MockDynamicsCompressorNode extends MockAudioNode {
  readonly threshold = new MockAudioParam();
  readonly knee = new MockAudioParam();
  readonly ratio = new MockAudioParam();
  readonly attack = new MockAudioParam();
  readonly release = new MockAudioParam();
}

class MockDelayNode extends MockAudioNode {
  readonly delayTime = new MockAudioParam();
}

class MockStereoPannerNode extends MockAudioNode {
  readonly pan = new MockAudioParam();
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine';
  readonly frequency = new MockAudioParam();
  readonly detune = new MockAudioParam();
  onended: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: MockAudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class MockBiquadFilterNode extends MockAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new MockAudioParam();
  readonly Q = new MockAudioParam();
}

class MockAudioBuffer {
  readonly data: Float32Array;

  constructor(frames: number) {
    this.data = new Float32Array(frames);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  readonly currentTime = 12;
  readonly sampleRate = 8000;
  readonly destination = new MockAudioNode();
  state: AudioContextState = 'suspended';
  readonly gains: MockGainNode[] = [];
  readonly compressors: MockDynamicsCompressorNode[] = [];
  readonly delays: MockDelayNode[] = [];
  readonly panners: MockStereoPannerNode[] = [];
  readonly oscillators: MockOscillatorNode[] = [];
  readonly buffers: MockAudioBuffer[] = [];
  readonly bufferRequests: Array<{ frames: number; sampleRate: number }> = [];
  readonly bufferSources: MockBufferSourceNode[] = [];
  readonly filters: MockBiquadFilterNode[] = [];
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });

  constructor() {
    MockAudioContext.instances.push(this);
  }

  createGain(): MockGainNode {
    const node = new MockGainNode();
    this.gains.push(node);
    return node;
  }

  createDynamicsCompressor(): MockDynamicsCompressorNode {
    const node = new MockDynamicsCompressorNode();
    this.compressors.push(node);
    return node;
  }

  createDelay(): MockDelayNode {
    const node = new MockDelayNode();
    this.delays.push(node);
    return node;
  }

  createStereoPanner(): MockStereoPannerNode {
    const node = new MockStereoPannerNode();
    this.panners.push(node);
    return node;
  }

  createOscillator(): MockOscillatorNode {
    const node = new MockOscillatorNode();
    this.oscillators.push(node);
    return node;
  }

  createBuffer(
    _channels: number,
    frames: number,
    sampleRate = this.sampleRate,
  ): MockAudioBuffer {
    const buffer = new MockAudioBuffer(frames);
    this.buffers.push(buffer);
    this.bufferRequests.push({ frames, sampleRate });
    return buffer;
  }

  createBufferSource(): MockBufferSourceNode {
    const node = new MockBufferSourceNode();
    this.bufferSources.push(node);
    return node;
  }

  createBiquadFilter(): MockBiquadFilterNode {
    const node = new MockBiquadFilterNode();
    this.filters.push(node);
    return node;
  }
}

const installAudioContext = (
  Constructor: typeof MockAudioContext | null = MockAudioContext,
) => {
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: Constructor ?? undefined,
  });
  Object.defineProperty(window, 'webkitAudioContext', {
    configurable: true,
    writable: true,
    value: undefined,
  });
};

describe('procedural sound engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    localStorage.clear();
    MockAudioContext.instances = [];
    installAudioContext();
  });

  it('keeps every original playSound call backward-compatible', async () => {
    const sound = await import('./sound');
    const originalNames = [
      'move',
      'capture',
      'check',
      'castle',
      'promote',
      'win',
      'lose',
      'draw',
      'select',
      'illegal',
      'click',
      'levelup',
      'coin',
    ] as const;

    expect(() => {
      originalNames.forEach((name) => sound.playSound(name));
    }).not.toThrow();

    const context = MockAudioContext.instances[0];
    expect(MockAudioContext.instances).toHaveLength(1);
    expect(context.resume).toHaveBeenCalled();
    expect(context.bufferSources.length).toBeGreaterThan(originalNames.length);
    // Oscillators are now an emergency fallback, not the primary palette.
    expect(context.oscillators).toHaveLength(0);
    expect(context.compressors).toHaveLength(1);
    expect(context.compressors[0].ratio.value).toBe(5);
    expect(context.delays).toHaveLength(1);
  });

  it('supports every semantic event and clamps expressive options', async () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const sound = await import('./sound');
    const semanticNames = [
      'place',
      'rotate',
      'score',
      'cascade',
      'combo',
      'special',
      'objective',
      'power',
      'complete',
      'undo',
    ] as const;

    expect(() => {
      semanticNames.forEach((name, index) => sound.playSound(name, {
        intensity: index % 2 ? 9 : -4,
        depth: 30,
        pan: index % 2 ? 5 : -5,
      }));
    }).not.toThrow();

    const context = MockAudioContext.instances[0];
    expect(context.bufferSources.length).toBeGreaterThan(semanticNames.length);
    expect(context.oscillators).toHaveLength(0);
    expect(context.panners.every(({ pan }) => pan.value >= -1 && pan.value <= 1))
      .toBe(true);
    expect(context.panners.some(({ pan }) => pan.value === -1)).toBe(true);
    expect(context.panners.some(({ pan }) => pan.value === 1)).toBe(true);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('generates the same procedural noise for the same first event', async () => {
    let sound = await import('./sound');
    sound.playSound('capture', { intensity: 0.8, depth: 3, pan: 0.2 });
    const first = Array.from(MockAudioContext.instances[0].buffers[0].data);

    vi.resetModules();
    MockAudioContext.instances = [];
    installAudioContext();
    sound = await import('./sound');
    sound.playSound('capture', { intensity: 0.8, depth: 3, pan: 0.2 });
    const second = Array.from(MockAudioContext.instances[0].buffers[0].data);

    expect(second).toEqual(first);
    expect(new Set(first.slice(0, 20)).size).toBeGreaterThan(10);
  });

  it('reuses a bounded three-variant material bank for high-rate move cues', async () => {
    const sound = await import('./sound');

    for (let index = 0; index < 80; index += 1) {
      sound.playSound('move', {
        intensity: index % 2 ? 0.55 : 0.85,
        pan: index % 3 === 0 ? -0.7 : 0.7,
      });
    }

    const context = MockAudioContext.instances[0];
    const generatedAfterWarmup = context.bufferRequests.length;
    const reusedBuffers = new Set(
      context.bufferSources.map(({ buffer }) => buffer),
    );

    // `move` has one friction texture and one impact. Each receives at most
    // three deterministic material variants, regardless of play count.
    expect(context.bufferSources).toHaveLength(160);
    expect(generatedAfterWarmup).toBeLessThanOrEqual(6);
    expect(reusedBuffers.size).toBeLessThanOrEqual(6);
    expect(reusedBuffers.size).toBeLessThan(context.bufferSources.length);

    for (let index = 0; index < 80; index += 1) {
      sound.playSound('move', { intensity: 0.7, pan: 0 });
    }
    expect(context.bufferRequests).toHaveLength(generatedAfterWarmup);
  });

  it('persists mute and prevents muted calls from constructing audio', async () => {
    let sound = await import('./sound');
    sound.setMuted(true);
    expect(sound.isMuted()).toBe(true);
    expect(localStorage.getItem(sound.MUTE_STORAGE_KEY)).toBe('true');
    sound.playSound('move');
    expect(MockAudioContext.instances).toHaveLength(0);

    vi.resetModules();
    sound = await import('./sound');
    expect(sound.isMuted()).toBe(true);
    sound.playSound('cascade', { depth: 4 });
    expect(MockAudioContext.instances).toHaveLength(0);

    expect(sound.toggleMuted()).toBe(false);
    sound.playSound('move');
    expect(MockAudioContext.instances).toHaveLength(1);
    expect(localStorage.getItem(sound.MUTE_STORAGE_KEY)).toBe('false');
  });

  it('persists and cycles quiet, balanced, and cinematic sound profiles', async () => {
    let sound = await import('./sound');
    expect(sound.getSoundIntensityMode()).toBe('balanced');
    expect(sound.setSoundIntensityMode('cinematic')).toBe('cinematic');
    expect(localStorage.getItem(sound.SOUND_INTENSITY_STORAGE_KEY))
      .toBe('cinematic');

    vi.resetModules();
    sound = await import('./sound');
    expect(sound.getSoundIntensityMode()).toBe('cinematic');
    sound.playSound('click');
    expect(MockAudioContext.instances[0].gains[1].gain.value).toBe(0.7);
    expect(sound.cycleSoundIntensityMode()).toBe('quiet');
    expect(MockAudioContext.instances[0].gains[1].gain.value).toBe(0.32);

    expect(sound.setSoundIntensityMode('not-a-mode' as never)).toBe('balanced');
  });

  it('silences active tails immediately at the shared master output', async () => {
    const sound = await import('./sound');
    sound.playSound('complete', { intensity: 1 });
    const output = MockAudioContext.instances[0].gains[1];
    expect(output.gain.value).toBe(0.56);

    sound.setMuted(true);
    expect(output.gain.value).toBe(0);
    sound.setMuted(false);
    expect(output.gain.value).toBe(0.56);
  });

  it('ramps master changes without clicks and has a direct-value fallback', async () => {
    let sound = await import('./sound');
    sound.playSound('click');
    let context = MockAudioContext.instances[0];
    let output = context.gains[1].gain;

    expect(output.values).toContainEqual({
      method: 'linear',
      value: 0.56,
      time: 12.012,
    });
    sound.setMuted(true);
    expect(output.values.at(-1)).toEqual({
      method: 'linear',
      value: 0,
      time: 12.012,
    });
    expect(output.cancelScheduledValues).toHaveBeenCalled();

    class AutomationFallbackContext extends MockAudioContext {
      override createGain(): MockGainNode {
        const node = super.createGain();
        if (this.gains.length === 2) {
          node.gain.cancelScheduledValues.mockImplementation(() => {
            throw new Error('automation unavailable');
          });
        }
        return node;
      }
    }
    vi.resetModules();
    localStorage.clear();
    MockAudioContext.instances = [];
    installAudioContext(AutomationFallbackContext);
    sound = await import('./sound');
    sound.playSound('click');
    context = MockAudioContext.instances[0];
    output = context.gains[1].gain;
    expect(output.value).toBe(0.56);
  });

  it('uses a subdued fallback only when rendered impact sources fail', async () => {
    class MissingBufferContext extends MockAudioContext {
      override createBuffer(): MockAudioBuffer {
        throw new Error('buffer unavailable');
      }
    }
    installAudioContext(MissingBufferContext);
    let sound = await import('./sound');
    expect(() => sound.playSound('capture')).not.toThrow();
    expect(MockAudioContext.instances[0].oscillators.length).toBeGreaterThan(0);

    class MissingBufferSourceContext extends MockAudioContext {
      override createBufferSource(): MockBufferSourceNode {
        throw new Error('buffer source unavailable');
      }
    }
    vi.resetModules();
    MockAudioContext.instances = [];
    installAudioContext(MissingBufferSourceContext);
    sound = await import('./sound');
    expect(() => sound.playSound('power')).not.toThrow();
    expect(MockAudioContext.instances[0].oscillators.length).toBeGreaterThan(0);
  });

  it('rebuilds a closed context and resumes interrupted contexts', async () => {
    const sound = await import('./sound');
    sound.playSound('move');
    const first = MockAudioContext.instances[0];
    first.state = 'closed';

    sound.playSound('score');
    expect(MockAudioContext.instances).toHaveLength(2);
    expect(first.gains[0].disconnect).toHaveBeenCalled();
    const recovered = MockAudioContext.instances[1];
    expect(recovered.bufferSources.length).toBeGreaterThan(0);

    recovered.state = 'interrupted' as AudioContextState;
    recovered.resume.mockClear();
    sound.resumeAudio();
    expect(recovered.resume).toHaveBeenCalledOnce();
    expect(recovered.state).toBe('running');
  });

  it('makes profiles differ in expression and spatial ambience, not only volume', async () => {
    const sound = await import('./sound');
    sound.setSoundIntensityMode('quiet');
    sound.playSound('special', { intensity: 0.7 });
    const context = MockAudioContext.instances[0];
    const quietGains = context.gains.slice(4);
    const quietPeak = Math.max(...quietGains.flatMap(({ gain }) => gain.values
      .filter(({ method }) => method === 'set')
      .map(({ value }) => value)));
    const quietAmbience = Math.max(...quietGains
      .filter(({ gain }) => gain.values.length === 0)
      .map(({ gain }) => gain.value));

    const cinematicStart = context.gains.length;
    sound.setSoundIntensityMode('cinematic');
    sound.playSound('special', { intensity: 0.7 });
    const cinematicGains = context.gains.slice(cinematicStart);
    const cinematicPeak = Math.max(...cinematicGains.flatMap(({ gain }) => gain.values
      .filter(({ method }) => method === 'set')
      .map(({ value }) => value)));
    const cinematicAmbience = Math.max(...cinematicGains
      .filter(({ gain }) => gain.values.length === 0)
      .map(({ gain }) => gain.value));

    expect(cinematicPeak).toBeGreaterThan(quietPeak);
    expect(cinematicAmbience).toBeGreaterThan(quietAmbience);
  });

  it('applies the level-up intensity floor to actual voice expression', async () => {
    const sound = await import('./sound');
    sound.playSound('complete', { intensity: 0 });
    const context = MockAudioContext.instances[0];
    const completeGains = context.gains.slice(4);
    const completePeak = Math.max(...completeGains.flatMap(({ gain }) => gain.values
      .filter(({ method }) => method === 'set')
      .map(({ value }) => value)));

    const levelupStart = context.gains.length;
    sound.playSound('levelup', { intensity: 0 });
    const levelupPeak = Math.max(...context.gains.slice(levelupStart)
      .flatMap(({ gain }) => gain.values
        .filter(({ method }) => method === 'set')
        .map(({ value }) => value)));

    expect(levelupPeak).toBeGreaterThan(completePeak);
  });

  it('caps rich voices during dense cascades and cleans up the oldest first', async () => {
    const sound = await import('./sound');

    for (let index = 0; index < 50; index += 1) {
      sound.playSound('click', {
        intensity: 1,
        pan: index % 2 ? 1 : -1,
      });
    }

    const context = MockAudioContext.instances[0];
    expect(context.bufferSources).toHaveLength(50);
    expect(context.bufferSources.some(({ stop }) =>
      stop.mock.calls.some((args) => args.length === 0))).toBe(true);
    expect(context.bufferSources[0].disconnect).toHaveBeenCalled();
  });

  it('bounds procedural render work on high-rate mobile audio contexts', async () => {
    class HighRateAudioContext extends MockAudioContext {
      override readonly sampleRate = 96_000;
    }
    installAudioContext(HighRateAudioContext);
    const sound = await import('./sound');
    sound.setSoundIntensityMode('cinematic');
    sound.playSound('complete', { intensity: 1 });

    const context = MockAudioContext.instances[0];
    expect(context.bufferRequests.length).toBeGreaterThan(0);
    expect(context.bufferRequests.every(({ sampleRate }) =>
      sampleRate <= 24_000)).toBe(true);
    expect(context.bufferRequests.every(({ frames }) =>
      frames <= 24_000 * 0.9)).toBe(true);
  });

  it('is a no-op during SSR/unsupported audio and for unknown runtime names', async () => {
    installAudioContext(null);
    const sound = await import('./sound');

    expect(() => sound.resumeAudio()).not.toThrow();
    expect(() => sound.playSound('move')).not.toThrow();
    expect(() => sound.playSound('unknown' as never)).not.toThrow();
    expect(MockAudioContext.instances).toHaveLength(0);
  });

  it('never lets browser scheduling faults interrupt game logic', async () => {
    class FaultyAudioContext extends MockAudioContext {
      override createOscillator(): MockOscillatorNode {
        throw new Error('simulated scheduling failure');
      }
    }
    installAudioContext(FaultyAudioContext);
    const sound = await import('./sound');

    expect(() => sound.playSound('move')).not.toThrow();
    expect(() => sound.playSound('objective', { intensity: 1 })).not.toThrow();
  });
});
