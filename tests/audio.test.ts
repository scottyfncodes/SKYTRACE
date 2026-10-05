/**
 * The soundscape is synthesised with WebAudio. A tiny fake AudioContext lets
 * us check what plays when: silence outside storms, rain and thunder as a cell
 * closes in, a strike's crack, creaks from a hurt airframe.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioSystem } from '../src/core/audio';

const log: string[] = [];
class Param {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
}
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  playbackRate = new Param();
  type = '';
  buffer: unknown = null;
  loop = false;
  constructor(public kind: string) {}
  connect(n: Node) { return n; }
  start() { log.push(`start:${this.kind}${this.loop ? ':loop' : ''}`); }
  stop() {}
}
class FakeCtx {
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = new Node('dest');
  createGain() { return new Node('gain'); }
  createBiquadFilter() { return new Node('filter'); }
  createOscillator() { return new Node('osc'); }
  createBufferSource() { return new Node('noise'); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  resume() {}
}
(globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };

const oneShots = () => log.filter((l) => !l.endsWith(':loop') && l !== 'start:osc' ).length;

describe('soundscape', () => {
  let a: AudioSystem;
  beforeEach(() => {
    a = new AudioSystem();
    a.unlock();
    log.length = 0;
  });

  it('clear air: no rain, no thunder, no creaks', () => {
    for (let i = 0; i < 300; i++) a.updateWeather(0.1, 0, 0);
    expect(log).toEqual([]);
  });

  it('inside a storm: thunder rolls, and keeps rolling', () => {
    for (let i = 0; i < 300; i++) a.updateWeather(0.1, 1, 0);
    expect(log.filter((l) => l === 'start:noise').length).toBeGreaterThanOrEqual(3);
  });

  it('a lightning strike is a crack, a bang and the thunder on top', () => {
    a.strike();
    expect(log.filter((l) => l === 'start:noise').length).toBeGreaterThanOrEqual(3);
    expect(log.filter((l) => l === 'start:osc').length).toBeGreaterThanOrEqual(2);
  });

  it('a badly damaged airframe creaks; a sound one does not', () => {
    for (let i = 0; i < 200; i++) a.updateWeather(0.1, 0, 0.2);
    expect(log).toEqual([]);
    for (let i = 0; i < 200; i++) a.updateWeather(0.1, 0, 0.8);
    expect(log.filter((l) => l === 'start:osc').length).toBeGreaterThanOrEqual(3);
  });

  it('rings and the contact pulse make themselves heard', () => {
    a.ring();
    a.ringMissed();
    a.pulse(0.5);
    expect(oneShots() + log.filter((l) => l === 'start:osc').length).toBeGreaterThanOrEqual(5);
  });
});
