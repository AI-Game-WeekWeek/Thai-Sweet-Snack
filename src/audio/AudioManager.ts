import type { GameConfig } from '../config/gameConfig';
import type { SoundId } from '../dessert/types';

/** One synthesized sound: filtered noise and/or a gliding tone, shaped by an attack/decay envelope. */
interface Recipe {
  durationSec: number;
  peak: number;
  attackSec: number;
  noise?: { filter: BiquadFilterType; freq: number; freqTo?: number; q: number };
  tone?: { type: OscillatorType; from: number; to: number; level: number };
  /** Amplitude wobble (stirring, bubbling). */
  lfo?: { hz: number; depth: number };
}

const RECIPES: Record<SoundId, Recipe> = {
  pour: { durationSec: 1.0, peak: 0.5, attackSec: 0.08, noise: { filter: 'bandpass', freq: 1900, freqTo: 1100, q: 0.9 }, lfo: { hz: 13, depth: 0.3 } },
  stir: { durationSec: 0.9, peak: 0.35, attackSec: 0.05, noise: { filter: 'bandpass', freq: 700, q: 2 }, lfo: { hz: 3, depth: 0.5 } },
  syrup: { durationSec: 0.9, peak: 0.3, attackSec: 0.1, noise: { filter: 'lowpass', freq: 500, q: 1 }, tone: { type: 'sine', from: 280, to: 520, level: 0.25 } },
  steam: { durationSec: 1.3, peak: 0.28, attackSec: 0.35, noise: { filter: 'highpass', freq: 2800, q: 0.5 } },
  slice: { durationSec: 0.14, peak: 0.55, attackSec: 0.005, noise: { filter: 'highpass', freq: 1800, q: 0.8 } },
  arrange: { durationSec: 0.18, peak: 0.45, attackSec: 0.004, tone: { type: 'sine', from: 880, to: 420, level: 1 } },
  sizzle: { durationSec: 1.1, peak: 0.3, attackSec: 0.05, noise: { filter: 'highpass', freq: 4200, q: 0.6 }, lfo: { hz: 17, depth: 0.45 } },
  boil: { durationSec: 1.2, peak: 0.35, attackSec: 0.12, noise: { filter: 'lowpass', freq: 450, q: 1.2 }, lfo: { hz: 6, depth: 0.6 } },
  pop: { durationSec: 0.28, peak: 0.5, attackSec: 0.01, tone: { type: 'sine', from: 620, to: 1240, level: 1 } },
  // Telephone trill and a coin ping (café surprise events).
  ring: { durationSec: 1.1, peak: 0.35, attackSec: 0.01, tone: { type: 'triangle', from: 760, to: 900, level: 1 }, lfo: { hz: 18, depth: 0.9 } },
  // Cooking details: spoon sloshing through batter, a drip landing in liquid, a bubble popping.
  slosh: { durationSec: 0.55, peak: 0.42, attackSec: 0.08, noise: { filter: 'bandpass', freq: 380, freqTo: 620, q: 1.6 }, lfo: { hz: 4, depth: 0.45 } },
  drip: { durationSec: 0.16, peak: 0.4, attackSec: 0.004, tone: { type: 'sine', from: 1900, to: 520, level: 1 } },
  bubble: { durationSec: 0.12, peak: 0.3, attackSec: 0.005, tone: { type: 'sine', from: 320, to: 760, level: 1 } },
  coin: { durationSec: 0.35, peak: 0.4, attackSec: 0.005, tone: { type: 'sine', from: 1400, to: 2100, level: 1 } },
};

interface Voice {
  id: number;
  roundId: number;
  sources: AudioScheduledSourceNode[];
  out: GainNode;
}

/** Web Audio synth with a voice cap. Any failure (no audio, blocked, node error) degrades to silence. */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private nextId = 1;
  private readonly voices = new Map<number, Voice>();

  constructor(
    private readonly config: GameConfig,
    private readonly createContext: () => AudioContext = () => new AudioContext(),
  ) {}

  get activeVoices(): number {
    return this.voices.size;
  }

  /** True when the context exists and is actually producing sound (not suspended by the browser). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Call from a user gesture (browsers block audio before one). Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = this.createContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.config.audio.master;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch((err) => console.warn('[AudioManager] resume blocked', err));
      }
    } catch (err) {
      console.warn('[AudioManager] audio unavailable, staying silent', err);
      this.ctx = null;
      this.master = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) for (const v of [...this.voices.values()]) this.stopVoice(v);
  }

  play(sound: SoundId, roundId: number): boolean {
    const recipe = RECIPES[sound] as Recipe | undefined;
    if (!recipe || this.muted || !this.ctx || !this.master) return false;
    try {
      const voice = this.build(this.ctx, this.master, recipe, roundId);
      this.voices.set(voice.id, voice);
      while (this.voices.size > this.config.audio.maxVoices) {
        const oldest = this.voices.values().next().value as Voice;
        this.stopVoice(oldest);
      }
      return true;
    } catch (err) {
      console.warn('[AudioManager] failed to play', sound, err);
      return false;
    }
  }

  stopRound(roundId: number): number {
    let n = 0;
    for (const v of [...this.voices.values()]) {
      if (v.roundId === roundId) {
        this.stopVoice(v);
        n++;
      }
    }
    return n;
  }

  private build(ctx: AudioContext, master: GainNode, r: Recipe, roundId: number): Voice {
    const now = ctx.currentTime;
    const end = now + r.durationSec;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(r.peak, now + r.attackSec);
    out.gain.linearRampToValueAtTime(0.0001, end);
    out.connect(master);
    const sources: AudioScheduledSourceNode[] = [];

    if (r.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = r.noise.filter;
      f.frequency.setValueAtTime(r.noise.freq, now);
      if (r.noise.freqTo) f.frequency.linearRampToValueAtTime(r.noise.freqTo, end);
      f.Q.value = r.noise.q;
      src.connect(f);
      f.connect(out);
      sources.push(src);
    }
    if (r.tone) {
      const osc = ctx.createOscillator();
      osc.type = r.tone.type;
      osc.frequency.setValueAtTime(r.tone.from, now);
      osc.frequency.exponentialRampToValueAtTime(r.tone.to, end);
      const lvl = ctx.createGain();
      lvl.gain.value = r.tone.level;
      osc.connect(lvl);
      lvl.connect(out);
      sources.push(osc);
    }
    if (r.lfo) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = r.lfo.hz;
      const depth = ctx.createGain();
      depth.gain.value = r.peak * r.lfo.depth;
      lfo.connect(depth);
      depth.connect(out.gain);
      sources.push(lfo);
    }

    const voice: Voice = { id: this.nextId++, roundId, sources, out };
    for (const s of sources) s.start(now);
    for (const s of sources) s.stop(end + 0.02);
    const first = sources[0];
    if (first) first.onended = () => this.release(voice);
    return voice;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.max(1, Math.floor(ctx.sampleRate));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  private release(v: Voice): void {
    if (!this.voices.delete(v.id)) return;
    try {
      v.out.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private stopVoice(v: Voice): void {
    for (const s of v.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.release(v);
  }
}
