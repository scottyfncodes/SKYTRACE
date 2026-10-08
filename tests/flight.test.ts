import { describe, expect, it } from 'vitest';
import { FLIGHT, forwardVector, initialAircraft, stepAircraft } from '../src/flight/aircraft';
import { headingDeg } from '../src/core/math';
import { VEHICLE_BY_ID } from '../src/rescue/catalog';

const flat = () => 0;

describe('flight model', () => {
  it('flies straight and level with no input', () => {
    let a = initialAircraft(0, 100, 0, 0);
    for (let i = 0; i < 100; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, flat);
    expect(a.z).toBeLessThan(-50);
    expect(Math.abs(a.x)).toBeLessThan(0.01);
    expect(Math.abs(a.y - 100)).toBeLessThan(0.5);
  });
  it('banks right to turn clockwise and reports a compass heading', () => {
    let a = initialAircraft(0, 100, 0, 0);
    for (let i = 0; i < 120; i++) a = stepAircraft(a, { roll: 1, pitch: 0, throttleDelta: 0 }, 1 / 60, flat);
    expect(a.roll).toBeGreaterThan(0.5);
    const hdg = headingDeg(a.yaw);
    expect(hdg).toBeGreaterThan(5);
    expect(hdg).toBeLessThan(180);
    expect(a.x).toBeGreaterThan(0);
  });
  it('climbs with positive pitch input and respects the ceiling', () => {
    let a = initialAircraft(0, 100, 0, 0);
    for (let i = 0; i < 300; i++) a = stepAircraft(a, { roll: 0, pitch: 1, throttleDelta: 1 }, 1 / 30, flat);
    expect(a.y).toBeGreaterThan(150);
    for (let i = 0; i < 3000; i++) a = stepAircraft(a, { roll: 0, pitch: 1, throttleDelta: 1 }, 1 / 30, flat);
    expect(a.y).toBeLessThanOrEqual(FLIGHT.ceiling + 0.01);
  });
  it('never flies into terrain', () => {
    let a = initialAircraft(0, 30, 0, 0);
    const hill = (_x: number, z: number) => (z < -200 ? 120 : 0);
    let minAgl = Infinity;
    for (let i = 0; i < 1200; i++) {
      a = stepAircraft(a, { roll: 0, pitch: -1, throttleDelta: 0 }, 1 / 60, hill);
      minAgl = Math.min(minAgl, a.agl);
    }
    expect(minAgl).toBeGreaterThanOrEqual(FLIGHT.floorAgl - 0.01);
  });
  it('turns back at the edge of the area', () => {
    let a = initialAircraft(1150, 200, 0, Math.PI / 2 * -1); // facing east
    for (let i = 0; i < 600; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, flat);
    expect(a.x).toBeLessThanOrEqual(FLIGHT.bounds + 0.01);
    const f = forwardVector(a);
    expect(f[0]).toBeLessThan(0.5);
  });
  it('throttle changes speed', () => {
    let a = initialAircraft(0, 100, 0, 0);
    a.throttle = 0.2;
    for (let i = 0; i < 400; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, flat);
    const slow = a.speed;
    for (let i = 0; i < 400; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 1 }, 1 / 60, flat);
    expect(a.speed).toBeGreaterThan(slow + 15);
  });
});

describe('the helicopter (same stick, same lever, flown as a rotorcraft)', () => {
  const P = VEHICLE_BY_ID['rescue-heli'].perf!;

  it('hovers in place with the lever down and no stick', () => {
    let a = { ...initialAircraft(0, 100, 0, 0), speed: 20, throttle: 0 };
    for (let i = 0; i < 60 * 10; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, flat, P);
    expect(a.speed).toBeLessThan(0.5);
    const x = a.x;
    const z = a.z;
    for (let i = 0; i < 60 * 5; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, flat, P);
    expect(Math.hypot(a.x - x, a.z - z)).toBeLessThan(1);
    expect(a.y).toBeCloseTo(100, 3);
  });

  it('climbs and descends straight up and down on the stick, even at a standstill', () => {
    let a = { ...initialAircraft(0, 100, 0, 0), speed: 0, throttle: 0 };
    for (let i = 0; i < 60 * 3; i++) a = stepAircraft(a, { roll: 0, pitch: 1, throttleDelta: 0 }, 1 / 60, flat, P);
    expect(a.y).toBeGreaterThan(130);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(0.5);
    for (let i = 0; i < 60 * 3; i++) a = stepAircraft(a, { roll: 0, pitch: -1, throttleDelta: 0 }, 1 / 60, flat, P);
    expect(a.y).toBeLessThan(110);
  });

  it('pivots in a hover: bank turns it round on the spot', () => {
    let a = { ...initialAircraft(0, 100, 0, 0), speed: 0, throttle: 0 };
    for (let i = 0; i < 60; i++) a = stepAircraft(a, { roll: 1, pitch: 0, throttleDelta: 0 }, 1 / 60, flat, P);
    expect(headingDeg(a.yaw)).toBeGreaterThan(20);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(0.5);
  });

  it('the lever sets forward speed, level, up to its top speed', () => {
    let a = { ...initialAircraft(0, 100, 0, 0), speed: 0, throttle: 1 };
    for (let i = 0; i < 60 * 10; i++) a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, flat, P);
    expect(a.speed).toBeGreaterThan(P.maxSpeed * 0.95);
    expect(a.speed).toBeLessThanOrEqual(P.maxSpeed);
    expect(a.z).toBeLessThan(-200);
    expect(a.y).toBeCloseTo(100, 3);
  });

  it('never flies into a mountainside: rising ground ahead lifts it', () => {
    let a = { ...initialAircraft(0, 30, 0, 0), speed: P.maxSpeed, throttle: 1 };
    const wall = (_x: number, z: number) => (z < -150 ? Math.min(300, (-150 - z) * 1.2) : 0);
    let minAgl = Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      a = stepAircraft(a, { roll: 0, pitch: 0, throttleDelta: 0 }, 1 / 60, wall, P);
      minAgl = Math.min(minAgl, a.agl);
    }
    expect(minAgl).toBeGreaterThanOrEqual(P.floorAgl - 0.01);
  });

  it('the heavy helicopter is slower and lazier than the light one', () => {
    const H = VEHICLE_BY_ID['heavy-heli'].perf!;
    expect(H.maxSpeed).toBeLessThan(P.maxSpeed);
    expect(H.turnGain).toBeLessThan(P.turnGain);
    expect(H.climbRate!).toBeLessThan(P.climbRate!);
  });

  it('the aeroplane model is unchanged by the rotorcraft option', () => {
    expect(FLIGHT.climbRate).toBeUndefined();
  });
});
