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
  private rainGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private thunderIn = 3;
  private creakIn = 4;
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

      // storm bed: hiss of rain on the canopy, a low rumble under it
      const rain = ctx.createBufferSource();
      rain.buffer = buf;
      rain.loop = true;
      const rainF = ctx.createBiquadFilter();
      rainF.type = 'highpass';
      rainF.frequency.value = 2600;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      rain.connect(rainF).connect(this.rainGain).connect(this.master);
      rain.start();
      const rumble = ctx.createBufferSource();
      rumble.buffer = buf;
      rumble.loop = true;
      rumble.playbackRate.value = 0.5;
      const rumbleF = ctx.createBiquadFilter();
      rumbleF.type = 'lowpass';
      rumbleF.frequency.value = 110;
      this.rumbleGain = ctx.createGain();
      this.rumbleGain.gain.value = 0;
      rumble.connect(rumbleF).connect(this.rumbleGain).connect(this.master);
      rumble.start();
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

  /**
   * Weather around the aircraft: storm proximity 0..1 (1 = inside), airframe
   * damage 0..1. Rain and rumble swell as a cell closes in, thunder rolls
   * at random (nearer, louder, sooner), and a hurt airframe creaks.
   */
  updateWeather(dt: number, storm: number, damage: number): void {
    if (!this.ctx || !this.rainGain || !this.rumbleGain) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(storm * storm * 0.22, t, 0.4);
    this.rumbleGain.gain.setTargetAtTime(storm * 0.55, t, 0.6);
    if (storm > 0.15) {
      this.thunderIn -= dt;
      if (this.thunderIn <= 0) {
        this.thunder(storm);
        this.thunderIn = 2.5 + Math.random() * 6 * (1.4 - storm);
      }
    }
    if (damage > 0.35) {
      this.creakIn -= dt;
      if (this.creakIn <= 0) {
        this.creak(damage);
        this.creakIn = 2 + Math.random() * 5 * (1.2 - damage);
      }
    }
  }

  /** A roll of thunder; `near` 0..1 brings it closer: louder, sharper, a crack on top. */
  thunder(near = 0.5): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.6;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300 + near * 900, t);
    f.frequency.exponentialRampToValueAtTime(55, t + 3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + near * 0.55, t + 0.08 + (1 - near) * 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 3.3);
    if (near > 0.7) this.noise(0.18, 0.35 * near, 3200, 'highpass');
  }

  /** Lightning into the airframe: a crack, a metallic bang, and the thunder right on top. */
  strike(): void {
    this.noise(0.25, 0.7, 4000, 'highpass');
    this.tone(140, 0.5, 0.3, 'square');
    this.tone(97, 0.8, 0.25, 'sawtooth', 0.02);
    this.thunder(1);
  }

  /** The airframe groaning under load. */
  creak(damage: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70 + Math.random() * 40, t);
    o.frequency.linearRampToValueAtTime(45 + Math.random() * 20, t + 0.7);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 380;
    f.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.08 + damage * 0.12, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.85);
  }

  /** Through a ring: a rush of air and a bright two-note chime. */
  ring(): void {
    this.noise(0.35, 0.3, 2600, 'bandpass', 500);
    this.tone(988, 0.12, 0.13, 'triangle', 0.04);
    this.tone(1480, 0.3, 0.12, 'triangle', 0.13);
  }

  /** Wide of a ring: a flat buzz. */
  ringMissed(): void {
    this.tone(196, 0.28, 0.14, 'sawtooth');
    this.tone(185, 0.28, 0.1, 'square', 0.02);
  }

  /** RADAR CONTACT heartbeat; urgency 0..1 sharpens it. */
  pulse(urgency: number): void {
    this.tone(880 + urgency * 440, 0.06, 0.06 + urgency * 0.08, 'square');
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
