const FAULT_ALARM_INTERVAL_MS = 1100;
const DEFAULT_COOLDOWN_MS = 70;

/** Procedural SCADA-style SFX via the Web Audio API — no audio asset files, extending
 * the project's "hand-write the math" precedent (catenary solver, terrain noise) into
 * audio. A control-room aesthetic calls for clean synthesized tones, not "produced"
 * recordings. Every sound layers 2-3 oscillators through a shaped envelope and a
 * filter — a bare single oscillator is the classic cheap-ringtone tell. */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayed = new Map<string, number>();
  private lastFaultAlarmAt = -Infinity;

  /** Must be called from a user gesture — browsers block audio until one occurs. Safe
   * to call repeatedly; only the first call does anything. */
  unlock(): void {
    if (this.ctx) return;
    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(compressor);
    this.masterGain = masterGain;

    this.noiseBuffer = this.buildNoiseBuffer(ctx);
  }

  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const duration = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private canPlay(name: string, now: number, cooldownMs = DEFAULT_COOLDOWN_MS): boolean {
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < cooldownMs) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  /** One shaped oscillator: short linear attack, exponential decay, optional filter. */
  private tone(opts: {
    freq: number;
    endFreq?: number;
    type: OscillatorType;
    start: number;
    duration: number;
    peak: number;
    filterFreq?: number;
    filterType?: BiquadFilterType;
    filterEndFreq?: number;
  }): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, opts.start);
    if (opts.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(opts.endFreq, 1), opts.start + opts.duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, opts.start);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, opts.start + opts.duration);

    let node: AudioNode = osc;
    if (opts.filterFreq !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = opts.filterType ?? 'lowpass';
      filter.frequency.setValueAtTime(opts.filterFreq, opts.start);
      if (opts.filterEndFreq !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(opts.filterEndFreq, 1), opts.start + opts.duration);
      }
      osc.connect(filter);
      node = filter;
    }
    node.connect(gain);
    gain.connect(master);

    osc.start(opts.start);
    osc.stop(opts.start + opts.duration + 0.05);
  }

  /** A short burst of the shared noise buffer through a filter — for mechanical thunks,
   * electrical crackle, and storm texture. */
  private noiseBurst(opts: {
    start: number;
    duration: number;
    peak: number;
    filterFreq: number;
    filterType?: BiquadFilterType;
    filterEndFreq?: number;
  }): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    const buffer = this.noiseBuffer;
    if (!ctx || !master || !buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType ?? 'bandpass';
    filter.frequency.setValueAtTime(opts.filterFreq, opts.start);
    if (opts.filterEndFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(opts.filterEndFreq, 1), opts.start + opts.duration);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, opts.start);
    gain.gain.linearRampToValueAtTime(opts.peak, opts.start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, opts.start + opts.duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    source.start(opts.start);
    source.stop(opts.start + opts.duration + 0.05);
  }

  /** Shared sweep+shimmer power-up chain used by both a fresh energize and a repair —
   * related but distinct via base pitch/duration, not a full second implementation. */
  private playPowerUpSweep(baseFreq: number, sweepDuration: number, tailDuration: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;

    this.tone({
      freq: baseFreq,
      endFreq: baseFreq * 2.5,
      type: 'sine',
      start: now,
      duration: sweepDuration,
      peak: 0.5,
    });
    this.tone({
      freq: baseFreq * 2,
      endFreq: baseFreq * 5,
      type: 'triangle',
      start: now,
      duration: sweepDuration,
      peak: 0.18,
    });
    this.noiseBurst({
      start: now,
      duration: sweepDuration * 0.8,
      peak: 0.12,
      filterType: 'bandpass',
      filterFreq: baseFreq * 3,
      filterEndFreq: baseFreq * 8,
    });
    this.tone({
      freq: baseFreq * 2.5,
      type: 'sine',
      start: now + sweepDuration * 0.5,
      duration: tailDuration,
      peak: 0.08,
      filterFreq: baseFreq * 4,
      filterType: 'lowpass',
    });
  }

  playPlace(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst({ start: now, duration: 0.06, peak: 0.35, filterType: 'lowpass', filterFreq: 450 });
    this.tone({ freq: 180, endFreq: 85, type: 'sine', start: now, duration: 0.14, peak: 0.4 });
  }

  playPermitClear(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.tone({ freq: 700, type: 'triangle', start: now, duration: 0.16, peak: 0.22, filterFreq: 2200 });
    this.tone({ freq: 1050, type: 'triangle', start: now + 0.06, duration: 0.18, peak: 0.22, filterFreq: 2600 });
  }

  playSelect(): void {
    const ctx = this.ctx;
    if (!this.canPlay('select', ctx?.currentTime ?? 0) || !ctx) return;
    this.tone({
      freq: 1800,
      type: 'triangle',
      start: ctx.currentTime,
      duration: 0.05,
      peak: 0.1,
      filterFreq: 2000,
      filterType: 'bandpass',
    });
  }

  playDeny(): void {
    const ctx = this.ctx;
    if (!this.canPlay('deny', ctx?.currentTime ?? 0, 120) || !ctx) return;
    const now = ctx.currentTime;
    this.tone({
      freq: 220,
      endFreq: 140,
      type: 'square',
      start: now,
      duration: 0.15,
      peak: 0.16,
      filterFreq: 900,
      filterEndFreq: 400,
    });
    this.tone({
      freq: 226,
      endFreq: 144,
      type: 'square',
      start: now,
      duration: 0.15,
      peak: 0.14,
      filterFreq: 900,
      filterEndFreq: 400,
    });
  }

  playEnergize(): void {
    this.playPowerUpSweep(200, 0.45, 2.2);
  }

  playRepair(): void {
    this.playPowerUpSweep(260, 0.3, 1.2);
  }

  playUpgrade(tier: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const base = 220 * (1 + (tier - 1) * 0.12);
    for (const ratio of [1, 1.5, 2]) {
      this.tone({
        freq: base * ratio,
        type: ratio === 1 ? 'sine' : 'triangle',
        start: now,
        duration: 0.22,
        peak: ratio === 1 ? 0.28 : 0.16,
        filterFreq: 3000,
      });
    }
  }

  playStormStrike(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.noiseBurst({
      start: now,
      duration: 0.16,
      peak: 0.4,
      filterType: 'bandpass',
      filterFreq: 1800,
      filterEndFreq: 400,
    });
    this.tone({ freq: 70, endFreq: 40, type: 'sine', start: now, duration: 0.3, peak: 0.35 });
    this.stormAmbienceSwell(now);
  }

  /** A bounded ~5s ambience swell centered on a storm strike — not a persistent
   * "isStormActive" state, just a one-shot enveloped layer. */
  private stormAmbienceSwell(start: number): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    const buffer = this.noiseBuffer;
    if (!ctx || !master || !buffer) return;

    const duration = 5;

    // Wind: noise through a bandpass filter, swept by an LFO for gust motion.
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain);
    lfoGain.connect(windFilter.frequency);
    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0, start);
    windGain.gain.linearRampToValueAtTime(0.14, start + 0.6);
    windGain.gain.linearRampToValueAtTime(0.14, start + duration - 1);
    windGain.gain.linearRampToValueAtTime(0, start + duration);
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);

    // Rain hiss: noise through a highpass filter, steadier.
    const rain = ctx.createBufferSource();
    rain.buffer = buffer;
    rain.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 3500;
    const rainGain = ctx.createGain();
    rainGain.gain.setValueAtTime(0, start);
    rainGain.gain.linearRampToValueAtTime(0.05, start + 0.8);
    rainGain.gain.linearRampToValueAtTime(0.05, start + duration - 1);
    rainGain.gain.linearRampToValueAtTime(0, start + duration);
    rain.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);

    lfo.start(start);
    wind.start(start);
    rain.start(start);
    lfo.stop(start + duration);
    wind.stop(start + duration);
    rain.stop(start + duration);
  }

  /** Aggregate fault alarm — one shared periodic tick regardless of how many spans are
   * currently faulted, not one per span. Call every frame; internally no-ops unless
   * FAULT_ALARM_INTERVAL_MS has passed. `now` is `performance.now()`-based, matching the
   * rest of the game's timers, not AudioContext time. */
  updateFaultAlarm(now: number, faultCount: number): void {
    const ctx = this.ctx;
    if (!ctx || faultCount <= 0) return;
    if (now - this.lastFaultAlarmAt < FAULT_ALARM_INTERVAL_MS) return;
    this.lastFaultAlarmAt = now;

    const start = ctx.currentTime;
    this.tone({ freq: 880, type: 'sine', start, duration: 0.08, peak: 0.18, filterFreq: 1200 });
  }
}
