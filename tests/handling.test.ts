import { describe, expect, it } from 'vitest';
import { easeTo, FLIGHT, initialAircraft, stepAircraft, type AircraftState } from '../src/flight/aircraft';
import { assistedDrift, newWindEstimate } from '../src/flight/assist';
import { shapeAxis } from '../src/core/input';
import { VEHICLE_BY_ID } from '../src/rescue/catalog';
import { stepHover, type HoverVel } from '../src/rescue/hover';
import { HOVER_DRIFT, windAt } from '../src/rescue/wind';
import { HOIST_MAX_SPEED } from '../src/rescue/run';
import { wrapAngle } from '../src/core/math';

const flat = () => 0;
const DT = 1 / 60;
const HELI = VEHICLE_BY_ID['rescue-heli'];
const STORM = { speed: 11, from: 280, gust: 0.6 };
const still = { roll: 0, pitch: 0, throttleDelta: 0 };

/** Sit in a hover (lever down, hands off) for `sec` in the storm; how far did it wander? */
function hoverInFlight(assist: boolean, sec: number): number {
  let a: AircraftState = { ...initialAircraft(0, 100, 0, 0), speed: 0, throttle: 0 };
  const est = newWindEstimate();
  for (let i = 0; i < sec / DT; i++) {
    const w = windAt(STORM, i * DT);
    const drift = assistedDrift(est, { x: w.x * HOVER_DRIFT, z: w.z * HOVER_DRIFT }, DT, assist);
    a = stepAircraft(a, still, DT, flat, HELI.perf!, { drift });
  }
  return Math.hypot(a.x, a.z);
}

/** The hoist hover, stick let go, in the storm. */
function hoverOverSite(assist: boolean, sec: number): number {
  let a: AircraftState = { ...initialAircraft(0, 22, 0, 0), speed: 0, throttle: 0 };
  const v: HoverVel = { vx: 0, vz: 0 };
  const est = newWindEstimate();
  let worst = 0;
  for (let i = 0; i < sec / DT; i++) {
    const w = windAt(STORM, i * DT);
    const drift = assistedDrift(est, { x: w.x * HOVER_DRIFT, z: w.z * HOVER_DRIFT }, DT, assist);
    a = stepHover(a, v, { x: 0, y: 0 }, { maxSpeed: 6.5, response: 1.8, drift, holdY: 22, clearance: 9, hold: assist ? 0.8 : 0 }, flat, DT);
    if (i * DT > 4) worst = Math.max(worst, Math.hypot(a.x, a.z));
  }
  return worst;
}

describe('hover assist', () => {
  it('a hands-off helicopter in a storm drifts away without the assist, and stays put with it', () => {
    expect(hoverInFlight(false, 15)).toBeGreaterThan(25);
    expect(hoverInFlight(true, 15)).toBeLessThan(6);
  });

  it('over the rescue, with the stick let go, the hover holds its spot through the gusts', () => {
    expect(hoverOverSite(false, 20)).toBeGreaterThan(20);
    expect(hoverOverSite(true, 20)).toBeLessThan(2.5);
  });

  it('learns the wind over a second or two, so a gust still pushes for a moment', () => {
    const est = newWindEstimate();
    const first = assistedDrift(est, { x: 3, z: 0 }, DT, true);
    expect(first.x).toBeGreaterThan(2.9);
    for (let i = 0; i < 60 * 6; i++) assistedDrift(est, { x: 3, z: 0 }, DT, true);
    expect(assistedDrift(est, { x: 3, z: 0 }, DT, true).x).toBeLessThan(0.05);
  });

  it('switched off, the full push comes through and the estimate is forgotten', () => {
    const est = { x: 2, z: 1 };
    expect(assistedDrift(est, { x: 3, z: 0 }, DT, false)).toEqual({ x: 3, z: 0 });
    expect(est).toEqual({ x: 0, z: 0 });
  });

  it('moving the hover stick moves it, and it holds where it is let go', () => {
    let a: AircraftState = { ...initialAircraft(0, 22, 0, 0), speed: 0, throttle: 0 };
    const v: HoverVel = { vx: 0, vz: 0 };
    const P = { maxSpeed: 6.5, response: 1.8, drift: { x: 0, z: 0 }, holdY: 22, clearance: 9, hold: 0.8 };
    for (let i = 0; i < 60 * 2; i++) a = stepHover(a, v, { x: 1, y: 0 }, P, flat, DT);
    expect(a.x).toBeGreaterThan(5);
    for (let i = 0; i < 60 * 1; i++) a = stepHover(a, v, { x: 0, y: 0 }, P, flat, DT);
    const x = a.x;
    for (let i = 0; i < 60 * 4; i++) a = stepHover(a, v, { x: 0, y: 0 }, P, flat, DT);
    expect(Math.abs(a.x - x)).toBeLessThan(2.5);
    expect(Math.hypot(v.vx, v.vz)).toBeLessThan(0.2);
  });
});

describe('helicopter handling', () => {
  const P = HELI.perf!;

  it('flares to hoisting speed quickly with the lever down', () => {
    let a: AircraftState = { ...initialAircraft(0, 100, 0, 0), speed: P.maxSpeed, throttle: 0 };
    let t = 0;
    while (a.speed > HOIST_MAX_SPEED && t < 10) {
      a = stepAircraft(a, still, DT, flat, P);
      t += DT;
    }
    expect(t).toBeLessThan(3.2);
    expect(t).toBeGreaterThan(1); // a flare, not a wall
  });

  it('carries momentum through a hard turn: it slides, then settles onto the new heading', () => {
    let a: AircraftState = { ...initialAircraft(0, 100, 0, 0), speed: P.maxSpeed, throttle: 1 };
    let maxSlip = 0;
    for (let i = 0; i < 60 * 1.5; i++) {
      a = stepAircraft(a, { roll: 1, pitch: 0, throttleDelta: 0 }, DT, flat, P);
      const track = Math.atan2(-a.vx!, -a.vz!);
      maxSlip = Math.max(maxSlip, Math.abs(wrapAngle(track - a.yaw)));
    }
    expect(maxSlip).toBeGreaterThan(0.08);
    expect(maxSlip).toBeLessThan(0.9);
    for (let i = 0; i < 60 * 4; i++) a = stepAircraft(a, still, DT, flat, P);
    expect(Math.abs(wrapAngle(Math.atan2(-a.vx!, -a.vz!) - a.yaw))).toBeLessThan(0.03);
  });

  it('the heavy helicopter takes longer to stop than the light one', () => {
    const stop = (perf: typeof P) => {
      let a: AircraftState = { ...initialAircraft(0, 100, 0, 0), speed: 44, throttle: 0 };
      let t = 0;
      while (a.speed > 5 && t < 20) {
        a = stepAircraft(a, still, DT, flat, perf);
        t += DT;
      }
      return t;
    };
    expect(stop(VEHICLE_BY_ID['heavy-heli'].perf!)).toBeGreaterThan(stop(P));
  });
});

describe('aeroplane handling', () => {
  it('eases into a bank and settles without snapping', () => {
    let a = initialAircraft(0, 200, 0, 0);
    let biggest = 0;
    let last = 0;
    for (let i = 0; i < 120; i++) {
      a = stepAircraft(a, { roll: 1, pitch: 0, throttleDelta: 0 }, DT, flat);
      biggest = Math.max(biggest, Math.abs(a.roll - last));
      last = a.roll;
    }
    expect(a.roll).toBeGreaterThan(FLIGHT.maxRoll * 0.95);
    // the last steps into the full bank are small: it arrives softly
    const before = a.roll;
    a = stepAircraft(a, { roll: 1, pitch: 0, throttleDelta: 0 }, DT, flat);
    expect(Math.abs(a.roll - before)).toBeLessThan(0.005);
    expect(biggest).toBeLessThanOrEqual(FLIGHT.rollRate * DT + 1e-9);
  });

  it('levels its wings on its own when the stick is let go', () => {
    let a = initialAircraft(0, 200, 0, 0);
    for (let i = 0; i < 90; i++) a = stepAircraft(a, { roll: 1, pitch: 0, throttleDelta: 0 }, DT, flat);
    for (let i = 0; i < 90; i++) a = stepAircraft(a, still, DT, flat);
    expect(Math.abs(a.roll)).toBeLessThan(0.05);
  });

  it('reports a scrape when it is flown into the ground', () => {
    let a = initialAircraft(0, 40, 0, 0);
    let scrapes = 0;
    for (let i = 0; i < 240; i++) {
      a = stepAircraft(a, { roll: 0, pitch: -1, throttleDelta: 0 }, DT, flat);
      if (a.contact) scrapes++;
    }
    expect(scrapes).toBeGreaterThan(0);
  });

  it('easeTo never overshoots and respects its rate limit', () => {
    let v = 0;
    for (let i = 0; i < 200; i++) {
      const n = easeTo(v, 1, 6, 2, DT);
      expect(n - v).toBeLessThanOrEqual(2 * DT + 1e-12);
      expect(n).toBeLessThanOrEqual(1);
      v = n;
    }
    expect(v).toBeGreaterThan(0.99);
  });
});

describe('touch stick response', () => {
  it('has a dead zone, is gentle near the centre and reaches full at the edge', () => {
    expect(shapeAxis(0.05)).toBe(0);
    expect(shapeAxis(1)).toBeCloseTo(1, 6);
    expect(shapeAxis(-1)).toBeCloseTo(-1, 6);
    expect(shapeAxis(0.4)).toBeLessThan(0.4);
    let prev = 0;
    for (let v = 0.1; v <= 1; v += 0.05) {
      expect(shapeAxis(v)).toBeGreaterThan(prev);
      prev = shapeAxis(v);
    }
  });
});
