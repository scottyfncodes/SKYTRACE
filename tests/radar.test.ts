import { describe, expect, it } from 'vitest';
import { canObserve, canResolve, detectionGain, DETECT_THRESHOLD, radarParams, RESOLVE_THRESHOLD, uncertaintyFor } from '../src/sensors/radar';

describe('radar footprint and quality', () => {
  it('widens the footprint and lowers quality with altitude', () => {
    const low = radarParams(100);
    const high = radarParams(500);
    expect(high.radius).toBeGreaterThan(low.radius);
    expect(high.quality).toBeLessThan(low.quality);
    expect(low.quality).toBe(1);
  });
  it('applies the resolution upgrade multiplier', () => {
    expect(radarParams(200, 1.25).radius).toBeCloseTo(radarParams(200).radius * 1.25);
  });
  it('only accumulates confidence inside the footprint and when not hidden', () => {
    const p = radarParams(120);
    const def = { signature: 0.8, concealment: 0.1 };
    expect(detectionGain(1, p, p.radius + 1, def, false)).toBe(0);
    expect(detectionGain(1, p, 10, def, true)).toBe(0);
    expect(detectionGain(1, p, 10, def, false)).toBeGreaterThan(0);
  });
  it('cannot see a well concealed contact from high altitude but can from low', () => {
    const concealed = { signature: 0.8, concealment: 0.75 };
    expect(detectionGain(1, radarParams(500), 20, concealed, false)).toBe(0);
    expect(detectionGain(1, radarParams(80), 20, concealed, false)).toBeGreaterThan(0);
  });
  it('requires a low pass to resolve', () => {
    const def = { concealment: 0.1 };
    expect(canResolve(radarParams(500), def)).toBe(false);
    expect(canResolve(radarParams(120), def)).toBe(true);
  });
  it('reaches detection before resolution with sustained scanning', () => {
    const p = radarParams(120);
    const def = { signature: 0.7, concealment: 0.2 };
    let d = 0;
    let tDetect = -1;
    let tResolve = -1;
    for (let t = 0; t < 30; t += 0.05) {
      d += detectionGain(0.05, p, 40, def, false);
      if (tDetect < 0 && d >= DETECT_THRESHOLD) tDetect = t;
      if (tResolve < 0 && d >= RESOLVE_THRESHOLD) tResolve = t;
    }
    expect(tDetect).toBeGreaterThan(0);
    expect(tResolve).toBeGreaterThan(tDetect);
    expect(tResolve).toBeLessThan(20);
  });
  it('reports larger uncertainty for poor scans', () => {
    expect(uncertaintyFor(radarParams(500), 0)).toBeGreaterThan(uncertaintyFor(radarParams(100), 0));
  });
  it('visual observation depends on target visibility', () => {
    expect(canObserve({ visible: 'none' }, 10, 10)).toBe(false);
    expect(canObserve({ visible: 'clear' }, 200, 250)).toBe(true);
    expect(canObserve({ visible: 'low' }, 200, 250)).toBe(false);
    expect(canObserve({ visible: 'low' }, 60, 60)).toBe(true);
  });
});
