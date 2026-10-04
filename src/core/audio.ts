/**
 * Procedural soundscape with WebAudio. No audio assets: engine, wind, radar sweep,
 * contact acquisition, stamps and chimes are all synthesised.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;
  private started = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);

      // noise source for wind and effects
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;

      // engine: two detuned saws through a low pass
      this.engineFilter = ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc = ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 62;
      this.engineOsc2 = ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.value = 31;
      const o2g = ctx.createGain();
      o2g.gain.value = 0.35;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc2.connect(o2g).connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
      this.engineOsc2.start();

      // wind
      const wind = ctx.createBufferSource();
      wind.buffer = buf;
      wind.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 500;
      this.windFilter.Q.value = 0.6;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
      wind.start();
      this.started = true;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Continuous flight bed. throttle 0..1, speed m/s, active = in flight. */
  updateFlight(throttle: number, speed: number, active: boolean, scanning: boolean): void {
    if (!this.ctx || !this.engineGain || !this.engineOsc || !this.engineOsc2 || !this.engineFilter || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    const tc = 0.12;
    const eg = active ? 0.07 + throttle * 0.1 : 0;
    this.engineGain.gain.setTargetAtTime(eg * (scanning ? 0.6 : 1), t, tc);
    this.engineOsc.frequency.setTargetAtTime(52 + throttle * 50, t, tc);
    this.engineOsc2.frequency.setTargetAtTime(26 + throttle * 25, t, tc);
    this.engineFilter.frequency.setTargetAtTime(300 + throttle * 500, t, tc);
    const w = active ? 0.02 + (speed / 95) * 0.14 : 0.015;
    this.windGain.gain.setTargetAtTime(w * (scanning ? 0.5 : 1), t, tc);
    this.windFilter.frequency.setTargetAtTime(350 + speed * 6, t, tc);
  }

  private tone(freq: number, dur: number, gain = 0.2, type: OscillatorType = 'sine', when = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFreq: number, type: BiquadFilterType = 'lowpass', sweepTo?: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo !== undefined) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  radarOn(): void {
    this.tone(640, 0.12, 0.12, 'triangle');
    this.tone(960, 0.18, 0.1, 'triangle', 0.08);
  }
  radarOff(): void {
    this.tone(720, 0.14, 0.1, 'triangle');
    this.tone(480, 0.2, 0.08, 'triangle', 0.08);
  }
  sweepTick(): void {
    this.tone(1180, 0.05, 0.035, 'sine');
  }
  contact(): void {
    this.tone(880, 0.09, 0.18, 'square');
    this.tone(1320, 0.22, 0.14, 'square', 0.1);
  }
  resolved(): void {
    this.tone(660, 0.12, 0.14, 'triangle');
    this.tone(880, 0.12, 0.14, 'triangle', 0.12);
    this.tone(1320, 0.3, 0.14, 'triangle', 0.24);
  }
  observed(): void {
    this.tone(523, 0.1, 0.1, 'triangle');
    this.tone(784, 0.25, 0.1, 'triangle', 0.1);
  }
  mark(): void {
    this.noise(0.12, 0.35, 900, 'lowpass');
    this.tone(180, 0.1, 0.25, 'sine');
  }
  drop(): void {
    this.noise(0.9, 0.25, 2400, 'bandpass', 300);
  }
  sensorLink(): void {
    this.tone(1046, 0.06, 0.12, 'sine');
    this.tone(1318, 0.06, 0.12, 'sine', 0.08);
    this.tone(1568, 0.2, 0.12, 'sine', 0.16);
  }
  link(): void {
    this.tone(392, 0.15, 0.12, 'triangle');
    this.tone(587, 0.3, 0.12, 'triangle', 0.15);
  }
  unlockSound(): void {
    this.tone(523, 0.12, 0.12, 'triangle');
    this.tone(659, 0.12, 0.12, 'triangle', 0.12);
    this.tone(784, 0.12, 0.12, 'triangle', 0.24);
    this.tone(1046, 0.4, 0.12, 'triangle', 0.36);
  }
  warn(): void {
    this.tone(330, 0.2, 0.12, 'square');
  }
  click(): void {
    this.tone(2000, 0.03, 0.05, 'square');
  }
  land(): void {
    this.noise(1.4, 0.3, 600, 'lowpass', 120);
  }
}
