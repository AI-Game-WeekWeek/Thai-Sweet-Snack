import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../../src/config/gameConfig';
import { AudioManager } from '../../src/audio/AudioManager';
import { SOUND_IDS } from '../../src/dessert/types';

class FakeParam {
  value = 0;
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
}
class FakeNode {
  connected = true;
  connect() { return this; }
  disconnect() { this.connected = false; }
}
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = 'sine';
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class FakeCtx {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  nodesCreated = 0;
  resumeImpl: () => Promise<void> = () => Promise.resolve();
  resume() { return this.resumeImpl(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); this.nodesCreated++; return s; }
  createOscillator() { const s = new FakeSource(); this.sources.push(s); this.nodesCreated++; return s; }
  createBiquadFilter() { this.nodesCreated++; return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(), Q: new FakeParam() }); }
  createGain() { this.nodesCreated++; return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  endAll() { for (const s of this.sources) s.onended?.(); }
}

function mk(maxVoices = 8) {
  const ctx = new FakeCtx();
  const cfg = { ...defaultConfig, audio: { ...defaultConfig.audio, maxVoices } };
  const a = new AudioManager(cfg, () => ctx as unknown as AudioContext);
  return { ctx, a };
}

describe('AudioManager', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('play before unlock returns false; after unlock returns true', () => {
    const { a } = mk();
    expect(a.play('pour', 1)).toBe(false);
    a.unlock();
    expect(a.play('pour', 1)).toBe(true);
    expect(a.activeVoices).toBe(1);
  });

  it('every SoundId has a recipe', () => {
    const { a } = mk(100);
    a.unlock();
    for (const id of SOUND_IDS) expect(a.play(id, 1), id).toBe(true);
  });

  it('an unknown sound id returns false without throwing', () => {
    const { a } = mk();
    a.unlock();
    expect(a.play('nope' as never, 1)).toBe(false);
  });

  it('voice cap steals the oldest voice', () => {
    const { a, ctx } = mk(3);
    a.unlock();
    for (let i = 0; i < 10; i++) a.play('stir', 1);
    expect(a.activeVoices).toBe(3);
    expect(ctx.sources.filter((s) => s.stopped).length).toBeGreaterThanOrEqual(7);
  });

  it('stopRound stops only that round and returns the count', () => {
    const { a } = mk();
    a.unlock();
    a.play('pour', 1);
    a.play('stir', 1);
    a.play('pop', 2);
    expect(a.stopRound(1)).toBe(2);
    expect(a.activeVoices).toBe(1);
  });

  it('finished voices are released (onended) and ending twice is safe', () => {
    const { a, ctx } = mk();
    a.unlock();
    a.play('pour', 1);
    ctx.endAll();
    ctx.endAll();
    expect(a.activeVoices).toBe(0);
  });

  it('muted creates no nodes; unmuting works again', () => {
    const { a, ctx } = mk();
    a.unlock();
    const before = ctx.nodesCreated;
    a.setMuted(true);
    expect(a.play('pour', 1)).toBe(false);
    expect(ctx.nodesCreated).toBe(before);
    a.setMuted(false);
    expect(a.play('pour', 1)).toBe(true);
  });

  it('muting stops voices that are already playing', () => {
    const { a } = mk();
    a.unlock();
    a.play('pour', 1);
    a.setMuted(true);
    expect(a.activeVoices).toBe(0);
  });

  it('a throwing context factory is silent, never throws', () => {
    const a = new AudioManager(defaultConfig, () => {
      throw new Error('no audio');
    });
    expect(() => a.unlock()).not.toThrow();
    expect(a.play('pour', 1)).toBe(false);
  });

  it('a rejecting resume() causes no unhandled rejection', async () => {
    const { a, ctx } = mk();
    ctx.state = 'suspended';
    ctx.resumeImpl = () => Promise.reject(new Error('blocked'));
    a.unlock();
    await new Promise((r) => setTimeout(r, 10));
    // Handled inside AudioManager (logged); an unhandled rejection would make vitest fail the run.
    expect(console.warn).toHaveBeenCalled();
  });

  it('a node failure while building a voice is caught', () => {
    const { a, ctx } = mk();
    a.unlock();
    ctx.createGain = () => {
      throw new Error('boom');
    };
    expect(a.play('pour', 1)).toBe(false);
    expect(a.activeVoices).toBe(0);
  });

  it('running reports whether the context is actually producing sound', () => {
    const { a, ctx } = mk();
    expect(a.running).toBe(false);
    ctx.state = 'suspended';
    a.unlock();
    expect(a.running).toBe(false);
    ctx.state = 'running';
    expect(a.running).toBe(true);
  });

  it('unlock keeps retrying resume() while the context is suspended', () => {
    const { a, ctx } = mk();
    let resumes = 0;
    ctx.state = 'suspended';
    ctx.resumeImpl = () => { resumes++; return Promise.resolve(); };
    a.unlock();
    a.unlock();
    a.unlock();
    expect(resumes).toBe(3);
  });

  it('a registered recorded sample replaces the synthesized sound once decoded; a broken sample keeps the synth', async () => {
    const { ctx, a } = mk();
    (ctx as unknown as { decodeAudioData: (d: ArrayBuffer) => Promise<unknown> }).decodeAudioData = async () => ({ duration: 1 });
    a.unlock();
    a.registerSample('ghost', 'data:audio/mpeg;base64,AAAA');
    a.registerSample('meow', 'data:audio/mpeg;base64,@@@@');
    (ctx as unknown as { decodeAudioData: (d: ArrayBuffer) => Promise<unknown> }).decodeAudioData = async (d: ArrayBuffer) => {
      if (d.byteLength === 0) throw new Error('bad');
      return { duration: 1 };
    };
    await new Promise((r) => setTimeout(r, 20));
    const before = ctx.sources.length;
    expect(a.play('ghost', 1)).toBe(true);
    expect(ctx.sources.length - before).toBe(1); // one buffer source, no oscillator or noise built
    expect(a.play('meow', 1)).toBe(true); // falls back to the synthesized meow when the sample failed
    expect(a.activeVoices).toBe(2);
  });

  it('speak() plays a recorded voice file when one is registered for the line (no device voice needed)', async () => {
    const { ctx, a } = mk();
    (ctx as unknown as { decodeAudioData: (d: ArrayBuffer) => Promise<unknown> }).decodeAudioData = async () => ({ duration: 1 });
    a.unlock();
    expect(a.speak('เอา… ข้าวต้มมัด… ค่ะ', 1, 1.3, 0.7, 'female', 'voice-order-x-f')).toBe(false); // nothing registered, no device voice in the test
    a.registerSample('voice-order-x-f', 'data:audio/mpeg;base64,AAAA');
    await new Promise((r) => setTimeout(r, 20));
    const before = ctx.sources.length;
    expect(a.speak('เอา… ข้าวต้มมัด… ค่ะ', 1, 1.3, 0.7, 'female', 'voice-order-x-f')).toBe(true);
    expect(ctx.sources.length - before).toBe(1);
  });
});
