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
import { DESTINATION, MISSION_01, RETURNS, TARGET_SPEED_TO_DESTINATION, type ReturnId } from '../src/mission/mission01';
import {
  CAMERA_RANGE,
  destinationRoute,
  identify,
  inspectReturn,
  MISSION_RATE,
  newMission,
  operatorWork,
  photograph,
  photoQuality,
  RETURN_BY_ID,
  scanReturn,
  TARGET,
  updateDestination,
} from '../src/mission/mission';
import { capabilities, checkLoadout, defaultLoadout, seatCrew, toggleEquipment, withAircraft } from '../src/operation/loadout';
import { beginReturn, flightObjective, landAtBase, launch, newOperation, reconVisibility, tickOperation } from '../src/operation/operation';
import { buildReport } from '../src/operation/score';
import { newCareer, recordOperation } from '../src/operation/career';
import { AIRCRAFT_BY_ID } from '../src/operation/catalog';
import { RouteMover } from '../src/mission/vehicles';
import { detectionGain, radarParams } from '../src/sensors/radar';
import { BASE } from '../src/world/worldData';
import { threadRings } from './helpers';

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
  const orbit = (): Orbit => ({ x: 700, z: 130, r: ORBIT_RADIUS, agl: 260, throttle: 0.35 });

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

  it('flies every aircraft type with its own performance profile', () => {
    for (const id of ['kestrel', 'heron', 'albatross']) {
      const P = AIRCRAFT_BY_ID[id].perf;
      const o = orbit();
      let a = initialAircraft(400, ground(400, 300) + 200, 300, 0);
      for (let i = 0; i < 120 * 60; i++) a = stepAircraft(a, orbitInput(a, o, ground, P), 1 / 60, ground, P);
      expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeLessThan(o.r + 80);
      expect(a.speed).toBeLessThanOrEqual(P.maxSpeed * 1.15);
    }
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
    expect(h.status).toHaveLength(1);
    expect(h.status[0]).toMatch(/^BASE 2\d\d° · 1\.\d km · FUEL 1:15$/);
    expect(buildHandover({ reason: 'manual', x: 0, z: 0, agl: 260, fuelSeconds: 300, sessionTime: 10, baseX: 0, baseZ: -1000, terrainWarning: false, notices: [] }).warnings).toEqual([]);
  });
});

describe('the whole operation: PREFLIGHT → OUTBOUND → RECON → RETURN → DEBRIEF', () => {
  it('plays Mission 01 end to end with a crewed HERON', () => {
    // PREFLIGHT: aircraft, crew, equipment
    let l = withAircraft(defaultLoadout(), 'heron');
    l = seatCrew(seatCrew(l, 'copilot', 'adeyemi'), 'sensor', 'okafor');
    l = toggleEquipment(l, 'thermal');
    expect(checkLoadout(l, () => true).ok).toBe(true);
    const cap = capabilities(l);
    const def = MISSION_01;
    const op = newOperation(def, l, ground);
    launch(op);
    const m = newMission();
    const crew = newCrew();
    const A = def.operations.area;
    const movers = new Map(RETURNS.map((r) => [r.id, new RouteMover(r.route, r.speed, r.start, true)]));
    const fixOf = (a: AircraftState) => ({ x: a.x, z: a.z, y: a.y, agl: a.agl });

    // OUTBOUND: Mission Control is closed until the gates are flown
    let a = initialAircraft(BASE.x, ground(BASE.x, BASE.z) + 200, BASE.z, -Math.PI / 2);
    expect(operatorAvailability(crew, { inArea: inArea(A, a.x, a.z), operatorWork: op.stage === 'recon', fuelFraction: 1, areaLabel: A.label }).ok).toBe(false);
    const end = threadRings(op, cap);
    a = { ...a, x: end.x, z: end.z, y: end.y, agl: end.agl };
    expect(op.stage).toBe('recon');
    expect(op.outbound.detected).toBe(false); // under the HERON's 300 m stealth ceiling

    // RECON: the copilot flies a tight orbit; the player operates
    expect(operatorAvailability(crew, { inArea: inArea(A, a.x, a.z), operatorWork: operatorWork(m), fuelFraction: 0.8, areaLabel: A.label }).ok).toBe(true);
    const orbit = engageOperator(crew, a.x, a.z, cap.orbit.agl);
    orbit.r = cap.orbit.r;
    const target = movers.get(TARGET.id)!;
    const sim = (dt: number) => {
      a = stepAircraft(a, orbitInput(a, orbit, ground, cap.perf), dt, ground, cap.perf);
      movers.forEach((mv) => mv.step(dt));
      tickCrew(crew, dt);
      return tickOperation(op, def, fixOf(a), dt, cap);
    };
    const slant = (id: ReturnId) => {
      const mv = movers.get(id)!;
      return Math.hypot(mv.x - a.x, mv.z - a.z, a.y - ground(mv.x, mv.z));
    };
    const dt = 1 / 20;
    // radar: search
    for (let t = 0; t < 240 && !m.returns.C.detected; t += dt) {
      sim(dt);
      const p = radarParams(a.agl);
      for (const [id, mv] of movers) scanReturn(m, id, detectionGain(dt, p, Math.hypot(mv.x - a.x, mv.z - a.z), RETURN_BY_ID[id], false, MISSION_RATE), mv.x, mv.z);
    }
    expect(m.returns.C.detected).toBe(true);
    // camera on C (orbit follows): identify, mark, photograph
    for (let t = 0; t < 60 && !m.returns.C.resolved; t += dt) {
      retaskOrbit(crew, target.x, target.z);
      sim(dt);
      inspectReturn(m, 'C', dt, slant('C') < CAMERA_RANGE, 'optical', 1.6 * cap.identifyTime);
    }
    expect(identify(m, 'C').result).toBe('correct');
    const q = photoQuality({ sensor: 'optical', slant: slant('C'), visibility: reconVisibility(op, def), bonus: cap.photoBonus });
    expect(q).toBeGreaterThan(0.65); // a crewed HERON gets close, clear evidence
    expect(photograph(m, 'C', q).result).toBe('primary');
    target.setRoute(destinationRoute(target.x, target.z, target.segment), false);
    target.speed = TARGET_SPEED_TO_DESTINATION;
    // dynamic: track to the stop, then the barge appears
    for (let t = 0; t < 200 && m.phase === 'track'; t += dt) {
      retaskOrbit(crew, target.x, target.z);
      sim(dt);
      updateDestination(m, dt, target.arrived, slant('C') < CAMERA_RANGE);
    }
    expect(m.phase).toBe('landing');
    expect(Math.hypot(target.x - DESTINATION.x, target.z - DESTINATION.z)).toBeLessThan(1);
    for (let t = 0; t < 60 && !m.returns.E.resolved; t += dt) {
      retaskOrbit(crew, movers.get('E')!.x, movers.get('E')!.z);
      sim(dt);
      inspectReturn(m, 'E', dt, slant('E') < CAMERA_RANGE, 'thermal', 1.6 * cap.identifyTime);
    }
    expect(photograph(m, 'E', 0.7).result).toBe('transfer');
    expect(op.stage).toBe('recon');
    expect(op.frontArrived).toBe(false); // done inside the window

    // EXTRACTION: Mission Control hands back; the return leg brings the weather
    expect(forcedHandback(crew, { fuelFraction: 0.5, operatorWork: operatorWork(m) })).toBe('complete');
    handBack(crew);
    beginReturn(op, def, { x: a.x, y: a.y, z: a.z, yaw: a.yaw }, ground);
    expect(op.stage).toBe('return');
    expect(flightObjective(op, def, cap)!.title).toBe('RETURN TO BASE');
    expect(op.routes.return.gates[0].id).toBe('join');
    const deck = def.return.hazards.find((h) => h.kind === 'ceiling')!;
    // the copilot flies low: this crew comes back under the new cloud deck (the KESTREL's autopilot does not)
    expect(a.y).toBeLessThan(deck.y);
    const kestrelOrbitY = ground(700, 130) + capabilities(defaultLoadout()).orbit.agl;
    expect(kestrelOrbitY).toBeGreaterThan(deck.y);
    const ho = buildHandover({ reason: 'complete', x: a.x, z: a.z, agl: a.agl, fuelSeconds: 200, sessionTime: crew.sessionTime, baseX: BASE.x, baseZ: BASE.z, terrainWarning: false, notices: def.return.notices });
    expect(ho.title).toBe('YOU HAVE CONTROL');
    expect(ho.warnings).toEqual([...def.return.notices]);

    // RETURN: through the rings under the deck, round the storm, land
    threadRings(op, cap);
    expect(op.ret.contact).toBe(true);
    expect(flightObjective(op, def, cap)!.title).toBe('LAND AT BASE');
    landAtBase(op, def);
    expect(op.stage).toBe('debrief');

    // DEBRIEF: report and rewards
    const r = buildReport(m, op, def, 0.55, crew.timeOnStation);
    expect(r.success).toBe(true);
    expect(r.rows.find((x) => x.label === 'Secondary objectives')!.value).toBe('3/3');
    expect(['S', 'A', 'B']).toContain(r.grade);
    const career = newCareer();
    recordOperation(career, def.id, r);
    expect(career.completed).toBe(1);
    expect(career.xp).toBeGreaterThan(0);
  });
});
