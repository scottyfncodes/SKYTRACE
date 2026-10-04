import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyVerticalMode, DEFAULT_PREFS, loadPrefs, PREFS_KEY, savePrefs } from '../src/core/settings';
import { Input } from '../src/core/input';
import { initialAircraft, stepAircraft, type FlightInput } from '../src/flight/aircraft';
import { clear, load, newState, save, SAVE_KEY, type Storage } from '../src/intel/state';

function memStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('vertical mode', () => {
  const samples: FlightInput[] = [];
  for (const roll of [-1, -0.4, 0, 0.6, 1]) for (const pitch of [-1, -0.3, 0, 0.25, 1]) for (const throttleDelta of [-1, 0, 1]) samples.push({ roll, pitch, throttleDelta });

  it('standard returns the input unchanged', () => {
    for (const s of samples) expect(applyVerticalMode(s, 'standard')).toBe(s);
  });
  it('inverted flips only the pitch sign', () => {
    for (const s of samples) {
      const out = applyVerticalMode(s, 'inverted');
      expect(out.pitch).toBe(s.pitch === 0 ? 0 : -s.pitch);
      expect(Object.is(out.pitch, -0)).toBe(false);
      expect(out.roll).toBe(s.roll);
      expect(out.throttleDelta).toBe(s.throttleDelta);
    }
  });
  it('standard flight trajectory is bit-identical to raw input', () => {
    const flat = () => 0;
    let a = initialAircraft(0, 200, 0, 0);
    let b = initialAircraft(0, 200, 0, 0);
    for (let i = 0; i < 600; i++) {
      const inp = samples[i % samples.length];
      a = stepAircraft(a, inp, 1 / 60, flat);
      b = stepAircraft(b, applyVerticalMode(inp, 'standard'), 1 / 60, flat);
    }
    expect(b).toEqual(a);
  });
  it('inverted climb input descends and vice versa, throttle unaffected', () => {
    const flat = () => 0;
    let std = initialAircraft(0, 300, 0, 0);
    let inv = initialAircraft(0, 300, 0, 0);
    const up: FlightInput = { roll: 0, pitch: 1, throttleDelta: 1 };
    for (let i = 0; i < 90; i++) {
      std = stepAircraft(std, applyVerticalMode(up, 'standard'), 1 / 60, flat);
      inv = stepAircraft(inv, applyVerticalMode(up, 'inverted'), 1 / 60, flat);
    }
    expect(std.y).toBeGreaterThan(300);
    expect(inv.y).toBeLessThan(300);
    expect(inv.throttle).toBe(std.throttle);
  });
});

describe('preference persistence', () => {
  it('defaults to standard for existing players with no preference saved', () => {
    const st = memStorage();
    expect(loadPrefs(st)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.verticalMode).toBe('standard');
  });
  it('round-trips and rejects junk', () => {
    const st = memStorage();
    savePrefs({ verticalMode: 'inverted' }, st);
    expect(loadPrefs(st).verticalMode).toBe('inverted');
    st.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs(st).verticalMode).toBe('standard');
    st.setItem(PREFS_KEY, JSON.stringify({ verticalMode: 'sideways' }));
    expect(loadPrefs(st).verticalMode).toBe('standard');
  });
  it('survives New Case and is independent of the case save', () => {
    const st = memStorage();
    savePrefs({ verticalMode: 'inverted' }, st);
    const s = newState();
    s.sortie = 3;
    save(s, st);
    expect(load(st)!.sortie).toBe(3);
    clear(st); // what NEW CASE does
    expect(st.map.has(SAVE_KEY)).toBe(false);
    expect(loadPrefs(st).verticalMode).toBe('inverted');
  });
  it('tolerates storage that throws', () => {
    const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadPrefs(bad).verticalMode).toBe('standard');
    expect(() => savePrefs({ verticalMode: 'inverted' }, bad)).not.toThrow();
  });
});

// ---- the real Input class, driven through stubbed DOM events ----
type Handler = (e: Record<string, unknown>) => void;
function fakeEl() {
  const h: Record<string, Handler> = {};
  return {
    h,
    addEventListener: (t: string, f: Handler) => void (h[t] = f),
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 200 }),
    classList: { add: () => undefined, remove: () => undefined },
    style: {} as Record<string, string>,
  };
}

describe('Input vertical axis (stick + keyboard share one path)', () => {
  let win: Record<string, Handler>;
  beforeEach(() => {
    win = {};
    vi.stubGlobal('window', { addEventListener: (t: string, f: Handler) => void (win[t] = f) });
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  const make = () => {
    const zone = fakeEl();
    const knob = fakeEl();
    const thr = fakeEl();
    const input = new Input(zone as unknown as HTMLElement, knob as unknown as HTMLElement, thr as unknown as HTMLElement);
    const ev = (o: Record<string, unknown>) => ({ preventDefault: () => undefined, pointerId: 1, repeat: false, ...o });
    return {
      input,
      stick: (dx: number, dy: number) => {
        zone.h.pointerdown(ev({ clientX: 100, clientY: 100 }));
        zone.h.pointermove(ev({ clientX: 100 + dx, clientY: 100 + dy }));
      },
      release: () => zone.h.pointerup(ev({})),
      key: (key: string, down: boolean) => win[down ? 'keydown' : 'keyup'](ev({ key })),
      throttleAt: (y: number) => thr.h.pointerdown(ev({ clientY: y })),
    };
  };

  it('defaults to standard: stick up and ArrowUp climb (existing behaviour)', () => {
    const t = make();
    expect(t.input.verticalMode).toBe('standard');
    t.stick(0, -54);
    expect(t.input.read().pitch).toBe(1);
    t.release();
    t.key('ArrowUp', true);
    expect(t.input.read().pitch).toBe(1);
    t.key('ArrowUp', false);
    t.key('s', true);
    expect(t.input.read().pitch).toBe(-1);
  });

  it('inverted reverses stick and keyboard vertical input only', () => {
    const t = make();
    t.input.verticalMode = 'inverted';
    t.stick(30, -54);
    const s = t.input.read();
    expect(s.pitch).toBeLessThan(0);
    expect(s.roll).toBeGreaterThan(0); // roll not inverted
    t.release();
    t.key('ArrowUp', true);
    expect(t.input.read().pitch).toBe(-1);
    t.key('ArrowUp', false);
    t.key('ArrowDown', true);
    expect(t.input.read().pitch).toBe(1);
  });

  it('throttle is unaffected by the vertical mode', () => {
    for (const mode of ['standard', 'inverted'] as const) {
      const t = make();
      t.input.verticalMode = mode;
      t.key('Shift', true);
      expect(t.input.read().throttleDelta).toBe(1);
      t.key('Shift', false);
      t.key('z', true);
      expect(t.input.read().throttleDelta).toBe(-1);
      t.throttleAt(20); // near the top of a 200 px slider
      expect(t.input.touchThrottle).toBeCloseTo(0.9);
    }
  });

  it('O and Enter switch crew stations (Mission Control) without touching the flight axes', () => {
    const t = make();
    let n = 0;
    t.input.onAction('ops', () => n++);
    t.key('o', true);
    t.key('o', false);
    t.key('Enter', true);
    t.key('Enter', false);
    expect(n).toBe(2);
    expect(t.input.read()).toEqual({ roll: 0, pitch: 0, throttleDelta: 0 });
  });

  it('switching mode takes effect on the next read without re-touching', () => {
    const t = make();
    t.stick(0, -54);
    expect(t.input.read().pitch).toBe(1);
    t.input.verticalMode = 'inverted';
    expect(t.input.read().pitch).toBe(-1);
    t.input.verticalMode = 'standard';
    expect(t.input.read().pitch).toBe(1);
  });
});
