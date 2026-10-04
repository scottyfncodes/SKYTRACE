import { describe, expect, it } from 'vitest';
import { initialAircraft, stepAircraft, type AircraftState } from '../src/flight/aircraft';
import { orbitInput, type Orbit } from '../src/flight/autopilot';
import { getHeightField } from '../src/world/terrain';
import {
  BINGO_FUEL,
  bearingDeg,
  buildHandover,
  engageOperator,
  forcedHandback,
  handBack,
  newCrew,
  operatorAvailability,
  ORBIT_RADIUS,
  retaskOrbit,
  tickCrew,
} from '../src/mission/crew';
import { inArea } from '../src/mission/missionDef';
import { DESTINATION, MISSION_01, RETURNS, TARGET_SPEED_TO_DESTINATION } from '../src/mission/mission01';
import {
  buildDebrief,
  CAMERA_SECONDS,
  destinationRoute,
  identify,
  inspectReturn,
  land,
  MISSION_RATE,
  newMission,
  objectiveFor,
  operatorWork,
  RETURN_BY_ID,
  scanReturn,
  TARGET,
  updateDestination,
} from '../src/mission/mission';
import { RouteMover } from '../src/mission/vehicles';
import { detectionGain, radarParams } from '../src/sensors/radar';
import { BASE } from '../src/world/worldData';

const hf = getHeightField();
const ground = (x: number, z: number) => hf.sample(x, z);
const fly = (a: AircraftState, o: Orbit, seconds: number, each?: (a: AircraftState) => void) => {
  for (let i = 0; i < seconds * 60; i++) {
    a = stepAircraft(a, orbitInput(a, o, ground), 1 / 60, ground);
    each?.(a);
  }
  return a;
};

describe('autopilot (operator station: the aircraft flies itself)', () => {
  const orbit = (): Orbit => ({ x: 700, z: 130, r: ORBIT_RADIUS, agl: MISSION_01.operations.orbitAgl, throttle: 0.35 });

  it('settles into the orbit from any entry, over real terrain, with no player input', () => {
    for (const [x, z, yaw] of [
      [-300, 700, -Math.PI / 2],
      [700, 130, 0],
      [400, -200, 2],
      [950, 500, -2.5],
    ] as const) {
      const o = orbit();
      let minR = Infinity;
      let maxR = 0;
      let minAgl = Infinity;
      let maxAgl = 0;
      // settle for 90 s, then measure the next 60 s
      let a = fly(initialAircraft(x, ground(x, z) + 150, z, yaw), o, 90);
      a = fly(a, o, 60, (s) => {
        const r = Math.hypot(s.x - o.x, s.z - o.z);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minAgl = Math.min(minAgl, s.agl);
        maxAgl = Math.max(maxAgl, s.agl);
      });
      expect(minR).toBeGreaterThan(o.r - 60);
      expect(maxR).toBeLessThan(o.r + 60);
      expect(minAgl).toBeGreaterThan(o.agl - 50);
      expect(maxAgl).toBeLessThan(o.agl + 50);
      expect(a.throttle).toBeCloseTo(o.throttle, 1);
    }
  });

  it('follows the orbit when the operator re-tasks it', () => {
    const o = orbit();
    let a = fly(initialAircraft(700, ground(700, 130) + 260, 130, 0), o, 60);
    o.x = 500;
    o.z = 450;
    a = fly(a, o, 90);
    expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeLessThan(o.r + 60);
  });

  it('uses the unchanged flight model: same input, same trajectory', () => {
    const o = orbit();
    const start = initialAircraft(600, ground(600, 200) + 250, 200, 0);
    expect(fly(start, o, 20)).toEqual(fly(start, o, 20));
  });
});

describe('crew stations', () => {
  const ctx = { inArea: true, operatorWork: true, fuelFraction: 0.8, areaLabel: 'SECTOR 7' };

  it('starts in the pilot seat', () => {
    const c = newCrew();
    expect(c.station).toBe('pilot');
    expect(c.orbit).toBeNull();
  });

  it('Mission Control opens only in the operations area, with recon work, and fuel to spare', () => {
    const c = newCrew();
    expect(operatorAvailability(c, ctx).ok).toBe(true);
    expect(operatorAvailability(c, { ...ctx, inArea: false }).reason).toBe('MISSION CONTROL OPENS INSIDE SECTOR 7');
    expect(operatorAvailability(c, { ...ctx, operatorWork: false }).ok).toBe(false);
    expect(operatorAvailability(c, { ...ctx, fuelFraction: BINGO_FUEL }).reason).toMatch(/BINGO/);
    engageOperator(c, 0, 0, 260);
    expect(operatorAvailability(c, ctx).ok).toBe(false);
  });

  it('engaging hands the aircraft to the autopilot; handing back clears it', () => {
    const c = newCrew();
    const o = engageOperator(c, 650, 120, 260);
    expect(c.station).toBe('operator');
    expect(o).toEqual({ x: 650, z: 120, r: ORBIT_RADIUS, agl: 260, throttle: 0.35 });
    tickCrew(c, 5);
    retaskOrbit(c, 5000, -5000);
    expect(c.orbit).toMatchObject({ x: 1100, z: -1100 });
    handBack(c);
    expect(c.station).toBe('pilot');
    expect(c.orbit).toBeNull();
    tickCrew(c, 5);
    expect(c.timeOnStation).toBe(5);
    engageOperator(c, 0, 0, 260);
    tickCrew(c, 2);
    expect(c.timeOnStation).toBe(7);
    expect(c.sessionTime).toBe(2);
    expect(c.entries).toBe(2);
  });

  it('forces a hand-back on bingo fuel or when the recon work is done', () => {
    const c = newCrew();
    expect(forcedHandback(c, { fuelFraction: 0.1, operatorWork: true })).toBeNull();
    engageOperator(c, 0, 0, 260);
    expect(forcedHandback(c, { fuelFraction: 0.5, operatorWork: true })).toBeNull();
    expect(forcedHandback(c, { fuelFraction: 0.19, operatorWork: true })).toBe('fuel');
    expect(forcedHandback(c, { fuelFraction: 0.5, operatorWork: false })).toBe('complete');
  });

  it('reports compass bearings', () => {
    expect(bearingDeg(0, 0, 0, -100)).toBe(0);
    expect(bearingDeg(0, 0, 100, 0)).toBe(90);
    expect(bearingDeg(0, 0, 0, 100)).toBe(180);
    expect(bearingDeg(0, 0, -100, 0)).toBe(270);
  });

  it('the hand-over puts what needs attention first, then where to go', () => {
    const h = buildHandover({ reason: 'fuel', x: 700, z: 130, agl: 40, fuelSeconds: 75, sessionTime: 130, baseX: BASE.x, baseZ: BASE.z, terrainWarning: false, notices: ['LOW VISIBILITY · HAZE OVER THE BASIN'] });
    expect(h.title).toBe('YOU HAVE CONTROL');
    expect(h.warnings).toEqual(['BINGO FUEL', 'TERRAIN · CLIMB', 'LOW VISIBILITY · HAZE OVER THE BASIN']);
    expect(h.status[0]).toMatch(/^RETURN HEADING 2\d\d° · BASE 1\.\d km$/);
    expect(h.status[1]).toBe('FUEL 1:15 · 2:10 ON STATION');
    expect(buildHandover({ reason: 'manual', x: 0, z: 0, agl: 260, fuelSeconds: 300, sessionTime: 10, baseX: 0, baseZ: -1000, terrainWarning: false, notices: [] }).warnings).toEqual([]);
  });
});

describe('mission 01 in the two-station model', () => {
  it('declares an operations area and what changes by hand-back', () => {
    const A = MISSION_01.operations.area;
    expect(inArea(A, (A.x0 + A.x1) / 2, (A.z0 + A.z1) / 2)).toBe(true);
    expect(inArea(A, BASE.x, BASE.z)).toBe(false);
    expect(MISSION_01.handback.visibility).toBeLessThan(1);
    expect(MISSION_01.handback.notices[0]).toMatch(/VISIBILITY/);
  });

  it('recon objectives belong to the operator; flying home belongs to the pilot', () => {
    const m = newMission();
    expect(operatorWork(m)).toBe(true);
    m.phase = 'destination';
    expect(operatorWork(m)).toBe(true);
    m.phase = 'rtb';
    expect(operatorWork(m)).toBe(false);
  });

  it('the objective stays the same in both seats; the next step depends on the seat', () => {
    const m = newMission();
    const out = objectiveFor(m, { station: 'pilot', inArea: false });
    const inn = objectiveFor(m, { station: 'pilot', inArea: true });
    const op = objectiveFor(m, { station: 'operator', inArea: true });
    expect(new Set([out.title, inn.title, op.title]).size).toBe(1);
    expect(out.detail).toBe('FLY TO SECTOR 7 · THEN OPEN MISSION CONTROL');
    expect(inn.detail).toBe('IN SECTOR 7 · OPEN MISSION CONTROL');
    expect(op.detail).toBe(MISSION_01.intelShort);
    m.phase = 'destination';
    expect(objectiveFor(m, { station: 'pilot', inArea: true }).detail).toMatch(/OPEN MISSION CONTROL/);
    expect(objectiveFor(m, { station: 'operator' }).detail).toMatch(/CAMERA/);
  });

  it('radar finds returns but only the camera identifies them', () => {
    const m = newMission();
    expect(inspectReturn(m, 'B', 5, true)).toEqual([]); // nothing to look at yet
    scanReturn(m, 'B', 2, false, 600, 250);
    expect(m.returns.B.detected && !m.returns.B.resolved).toBe(true);
    expect(inspectReturn(m, 'B', 5, false)).toEqual([]); // out of view
    expect(inspectReturn(m, 'B', CAMERA_SECONDS / 2, true)).toEqual([]);
    const ev = inspectReturn(m, 'B', CAMERA_SECONDS / 2 + 0.01, true);
    expect(ev[0].text).toBe('CAMERA · RETURN B IS 3 SMALL VEHICLES');
    expect(m.returns.B.resolved).toBe(true);
  });
});

describe('the whole rhythm: FLIGHT → MISSION CONTROL → FLIGHT → LAND → DEBRIEF', () => {
  it('plays Mission 01 through both stations', () => {
    const m = newMission();
    const crew = newCrew();
    const A = MISSION_01.operations.area;
    const movers = new Map(RETURNS.map((r) => [r.id, new RouteMover(r.route, r.speed, r.start, true)]));
    const step = (dt: number) => movers.forEach((mv) => mv.step(dt));

    // PILOT: at base, Mission Control is not available
    let a = initialAircraft(BASE.x, ground(BASE.x, BASE.z) + 200, BASE.z, -Math.PI / 2);
    expect(operatorAvailability(crew, { inArea: inArea(A, a.x, a.z), operatorWork: operatorWork(m), fuelFraction: 1, areaLabel: A.label }).ok).toBe(false);

    // (the pilot flies to the sector)
    a = { ...a, x: 700, z: 130, y: ground(700, 130) + 260 };
    expect(operatorAvailability(crew, { inArea: inArea(A, a.x, a.z), operatorWork: operatorWork(m), fuelFraction: 0.8, areaLabel: A.label }).ok).toBe(true);
    const orbit = engageOperator(crew, a.x, a.z, MISSION_01.operations.orbitAgl);

    // OPERATOR: radar sweeps while the autopilot orbits
    const target = movers.get(TARGET.id)!;
    let t = 0;
    while (!m.returns.C.detected && t < 240) {
      const dt = 1 / 20;
      a = stepAircraft(a, orbitInput(a, orbit, ground), dt, ground);
      step(dt);
      tickCrew(crew, dt);
      const p = radarParams(a.agl);
      for (const [id, mv] of movers) scanReturn(m, id, detectionGain(dt, p, Math.hypot(mv.x - a.x, mv.z - a.z), RETURN_BY_ID[id], false, MISSION_RATE), false, mv.x, mv.z);
      t += dt;
    }
    expect(m.returns.C.detected).toBe(true);
    // camera on C: the orbit follows it until it is identified
    for (let i = 0; i < 40 * 20 && !m.returns.C.resolved; i++) {
      const dt = 1 / 20;
      retaskOrbit(crew, target.x, target.z);
      a = stepAircraft(a, orbitInput(a, orbit, ground), dt, ground);
      step(dt);
      tickCrew(crew, dt);
      const slant = Math.hypot(target.x - a.x, target.z - a.z, a.y - ground(target.x, target.z));
      inspectReturn(m, 'C', dt, slant < 600);
    }
    expect(m.returns.C.resolved).toBe(true);
    expect(identify(m, 'C').result).toBe('correct');
    target.setRoute(destinationRoute(target.x, target.z, target.segment), false);
    target.speed = TARGET_SPEED_TO_DESTINATION;
    // track the truck to its stop and hold the camera on it
    for (let i = 0; i < 200 * 20 && m.phase === 'destination'; i++) {
      const dt = 1 / 20;
      retaskOrbit(crew, target.x, target.z);
      a = stepAircraft(a, orbitInput(a, orbit, ground), dt, ground);
      step(dt);
      tickCrew(crew, dt);
      const slant = Math.hypot(target.x - a.x, target.z - a.z, a.y - ground(target.x, target.z));
      updateDestination(m, dt, target.arrived, slant < 600 ? 0 : Infinity);
    }
    expect(m.phase).toBe('rtb');
    expect(Math.hypot(target.x - DESTINATION.x, target.z - DESTINATION.z)).toBeLessThan(1);

    // work done: Mission Control hands the aircraft back
    expect(forcedHandback(crew, { fuelFraction: 0.5, operatorWork: operatorWork(m) })).toBe('complete');
    const ho = buildHandover({ reason: 'complete', x: a.x, z: a.z, agl: a.agl, fuelSeconds: 200, sessionTime: crew.sessionTime, baseX: BASE.x, baseZ: BASE.z, terrainWarning: a.terrainWarning, notices: MISSION_01.handback.notices });
    handBack(crew);
    expect(crew.station).toBe('pilot');
    expect(ho.warnings).toContain('LOW VISIBILITY · HAZE OVER THE BASIN');
    expect(objectiveFor(m, { station: 'pilot' }).title).toBe('RETURN TO BASE');

    // PILOT: fly home and land
    expect(land(m).ok).toBe(true);
    const d = buildDebrief(m, 0.5, crew.timeOnStation);
    expect(d.success).toBe(true);
    const row = d.rows.find((r) => r.label === 'Time in mission control')!;
    expect(crew.timeOnStation).toBeGreaterThan(20);
    expect(row.value).toMatch(/^\d\d:\d\d$/);
  });
});
