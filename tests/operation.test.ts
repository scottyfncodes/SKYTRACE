import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_BY_ID, CREW, EQUIPMENT } from '../src/operation/catalog';
import { capabilities, checkLoadout, defaultLoadout, seatCrew, toggleEquipment, withAircraft, type Loadout } from '../src/operation/loadout';
import { currentGate, legComplete, missedCount, newLeg, passLanding, placeRoute, rings, tickLeg, totalExposure, type LegDef } from '../src/operation/gates';
import { threadRings } from './helpers';
import { activeLeg, beginReturn, damagedPerf, endOperation, STRIKE_EVERY, stormDamagePerSecond, flightObjective, landAtBase, launch, newOperation, reconVisibility, tickOperation, windowLeft } from '../src/operation/operation';
import { buildReport, disciplineScore, gradeFor } from '../src/operation/score';
import { CAREER_KEY, isUnlocked, loadCareer, newCareer, nextUnlock, recordOperation, saveCareer, UNLOCKS } from '../src/operation/career';
import { MISSION_01 } from '../src/mission/mission01';
import { identify, inspectReturn, newMission, photograph, scanReturn, updateDestination } from '../src/mission/mission';
import { FLIGHT } from '../src/flight/aircraft';

const all = () => true;
const fix = (x: number, z: number, y = 200, agl = 150) => ({ x, z, y, agl });

describe('preflight: aircraft, crew, equipment', () => {
  it('offers distinct aircraft with real trade-offs, one locked', () => {
    const [k, h, al] = AIRCRAFT;
    expect(k.perf).toBe(FLIGHT); // the original aircraft is unchanged
    expect(k.stealthCeiling).toBeGreaterThan(h.stealthCeiling);
    expect(h.fuelSeconds).toBeGreaterThan(k.fuelSeconds);
    expect(h.slots).toBeGreaterThan(k.slots);
    expect(h.weatherTolerance).toBeGreaterThan(k.weatherTolerance);
    expect(k.seats).toEqual([]);
    expect(h.seats).toEqual(['copilot', 'sensor']);
    expect(al.unlock).toBe('albatross');
    expect(CREW.length).toBeGreaterThanOrEqual(4);
    expect(EQUIPMENT.map((e) => e.id)).toEqual(['radar', 'optical', 'thermal', 'sigint']);
  });

  it('the default loadout can fly the mission', () => {
    expect(checkLoadout(defaultLoadout(), all).ok).toBe(true);
  });

  it('refuses loadouts that cannot complete the primary objective, saying why', () => {
    const l = defaultLoadout();
    expect(checkLoadout({ ...l, equipment: ['optical'] }, all).reason).toMatch(/RADAR/);
    expect(checkLoadout({ ...l, equipment: ['radar', 'sigint'] }, all).reason).toMatch(/IMAGING/);
    expect(checkLoadout({ ...l, equipment: ['radar', 'optical', 'thermal'] }, all).reason).toMatch(/KESTREL CARRIES 2/);
    expect(checkLoadout({ ...l, aircraft: 'albatross' }, (id) => !id).reason).toMatch(/AVAILABLE AIRCRAFT/);
    expect(checkLoadout({ ...withAircraft(l, 'heron'), crew: { copilot: 'okafor' } }, all).reason).toMatch(/CREW/);
  });

  it('switching aircraft keeps what fits', () => {
    let l: Loadout = withAircraft(defaultLoadout(), 'heron');
    l = toggleEquipment(l, 'thermal');
    l = seatCrew(l, 'copilot', 'adeyemi');
    expect(l.equipment).toEqual(['radar', 'optical', 'thermal']);
    const k = withAircraft(l, 'kestrel');
    expect(k.equipment).toEqual(['radar', 'optical']);
    expect(k.crew).toEqual({});
  });

  it('a full bay swaps out the newest system, keeping the radar; one crew member, one seat', () => {
    let l = toggleEquipment(defaultLoadout(), 'thermal'); // kestrel: 2 bays
    expect(l.equipment).toEqual(['radar', 'thermal']);
    expect(checkLoadout(l, all).ok).toBe(true);
    l = withAircraft(defaultLoadout(), 'albatross');
    l = seatCrew(l, 'copilot', 'halvorsen');
    l = seatCrew(l, 'navigator', 'halvorsen');
    expect(l.crew.copilot).toBeNull();
    expect(l.crew.navigator).toBe('halvorsen');
  });

  it('crew change how the job is done', () => {
    const solo = capabilities(withAircraft(defaultLoadout(), 'heron'));
    expect(solo.flightControl).toEqual({ mode: 'autopilot', label: 'AUTOPILOT FLYING' });
    const crewed = capabilities(seatCrew(seatCrew(withAircraft(defaultLoadout(), 'heron'), 'copilot', 'adeyemi'), 'sensor', 'okafor'));
    expect(crewed.flightControl).toEqual({ mode: 'crew', label: 'M. ADEYEMI HAS CONTROL' });
    expect(crewed.orbit.r).toBeLessThan(solo.orbit.r);
    expect(crewed.identifyTime).toBeLessThan(solo.identifyTime);
    expect(crewed.weatherExposure).toBeLessThan(solo.weatherExposure);
    expect(solo.routeAware).toBe(false);
    expect(capabilities(seatCrew(withAircraft(defaultLoadout(), 'heron'), 'copilot', 'halvorsen')).routeAware).toBe(true);
    const k = capabilities(defaultLoadout());
    expect(k.stealthCeiling).toBe(450);
    expect(k.weatherExposure).toBeGreaterThan(solo.weatherExposure);
  });
});

describe('flight legs: hazards and the Mission 01 routes', () => {
  const leg: LegDef = {
    id: 'outbound',
    title: 'FLY THE RINGS',
    gates: [{ kind: 'ring', id: 'a', x: 0, z: 0, agl: 100, r: 40 }],
    hazards: [
      { kind: 'storm', id: 'st', label: 'STORM CELL', x: 300, z: 0, r: 100 },
      { kind: 'ceiling', id: 'deck', label: 'DECK', y: 300 },
    ],
  };
  const route = placeRoute(leg, () => 0, { x: -500, z: 0 });

  it('counts time inside storm cells and above the cloud deck', () => {
    const s = newLeg(route);
    expect(tickLeg(s, route, fix(300, 0, 200), 1, 400).map((e) => e.type)).toEqual(['hazard-enter']);
    tickLeg(s, route, fix(300, 10, 350), 1, 400);
    tickLeg(s, route, fix(-900, 0, 200), 1, 400);
    expect(totalExposure(s, route, 'storm')).toBe(2);
    expect(totalExposure(s, route, 'ceiling')).toBe(1);
  });

  it('the landing gate is passed by touching down', () => {
    const ret = placeRoute({ id: 'return', title: 'RETURN TO BASE', gates: [{ kind: 'land', id: 'land', label: 'LANDING', objective: 'LAND', detail: '' }], hazards: [] }, () => 0, { x: 0, z: 0 });
    const s = newLeg(ret);
    expect(tickLeg(s, ret, fix(0, 0), 1, 400)).toEqual([]);
    expect(currentGate(s, ret)!.kind).toBe('land');
    expect(passLanding(s, ret).map((e) => e.type)).toEqual(['gate-passed', 'leg-complete']);
    expect(legComplete(s, ret)).toBe(true);
    expect(missedCount(s)).toBe(0);
  });

  it('Mission 01: the direct routes cross the storms; the ring routes go round them', () => {
    const along = (st: { x: number; z: number }, pts: { x: number; z: number }[]) => {
      let min = Infinity;
      for (let i = 1; i < pts.length; i++)
        for (let t = 0; t <= 1; t += 0.01) min = Math.min(min, Math.hypot(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t - st.x, pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t - st.z));
      return min;
    };
    const A = MISSION_01.operations.area;
    const sector = { x: (A.x0 + A.x1) / 2, z: (A.z0 + A.z1) / 2 };
    const base = { x: -820, z: 760 };
    const { routes } = newOperation(MISSION_01, defaultLoadout());
    const s1 = MISSION_01.outbound.hazards[0] as { x: number; z: number; r: number };
    expect(along(s1, [base, sector])).toBeLessThan(s1.r);
    expect(along(s1, [base, ...rings(routes.outbound)])).toBeGreaterThan(s1.r);
    const s2 = MISSION_01.return.hazards.find((h) => h.kind === 'storm') as { x: number; z: number; r: number };
    expect(along(s2, [sector, base])).toBeLessThan(s2.r);
    expect(along(s2, [...rings(routes.return), base])).toBeGreaterThan(s2.r);
  });
});

describe('operation stages', () => {
  const cap = capabilities(defaultLoadout());
  const def = MISSION_01;

  it('preflight → outbound → recon → return → debrief', () => {
    const op = newOperation(def, defaultLoadout());
    expect(op.stage).toBe('preflight');
    expect(tickOperation(op, def, fix(0, 0), 1, cap).events).toEqual([]);
    launch(op);
    expect(op.stage).toBe('outbound');
    expect(flightObjective(op, def, cap)).toEqual({ kicker: 'RING 1/8', title: 'REACH SECTOR 7', detail: '' });
    threadRings(op, cap);
    expect(op.stage).toBe('recon');
    expect(activeLeg(op, def)).toBeNull();
    expect(flightObjective(op, def, cap)).toBeNull();
    beginReturn(op);
    expect(op.stage).toBe('return');
    expect(flightObjective(op, def, cap)!.title).toBe('GET OUT');
    threadRings(op, cap);
    expect(flightObjective(op, def, cap)!.title).toBe('LAND AT BASE');
    landAtBase(op, def);
    expect(op.stage).toBe('debrief');
    expect(op.outcome).toBe('landed');
  });

  it('the weather front closes the recon window and haze builds toward it', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    threadRings(op, cap);
    expect(reconVisibility(op, def)).toBeCloseTo(1, 1);
    let arrived = 0;
    for (let t = 0; t < def.reconWindow + 5; t += 1) if (tickOperation(op, def, fix(700, 100), 1, cap).frontArrived) arrived++;
    expect(arrived).toBe(1);
    expect(windowLeft(op, def)).toBe(0);
    expect(reconVisibility(op, def)).toBeCloseTo(def.reconVisibilityEnd, 5);
  });

  it('storm cells are destructive: a steady pounding plus lightning on a rhythm, worst for light airframes', () => {
    const inStorm = (l: Loadout, seconds: number, dt = 0.1) => {
      const op = newOperation(def, l);
      launch(op);
      const strikes: number[] = [];
      for (let t = 0; t < seconds && op.stage !== 'debrief'; t += dt) {
        const { hits } = tickOperation(op, def, fix(-80, 480), dt, capabilities(l));
        if (hits.some((h) => h.type === 'strike')) strikes.push(op.stormTime);
      }
      return { op, strikes };
    };
    // strikes: the first a moment after entering, then every STRIKE_EVERY seconds
    const { strikes } = inStorm(withAircraft(defaultLoadout(), 'albatross'), 8);
    expect(strikes[0]).toBeGreaterThan(0.5);
    expect(strikes[0]).toBeLessThan(1.2);
    expect(strikes[1] - strikes[0]).toBeCloseTo(STRIKE_EVERY, 0);
    // five seconds in a storm: the KESTREL is badly hurt, the ALBATROSS shrugs it off better
    const k5 = inStorm(defaultLoadout(), 5).op.damage;
    const a5 = inStorm(withAircraft(defaultLoadout(), 'albatross'), 5).op.damage;
    expect(k5).toBeGreaterThan(0.35);
    expect(a5).toBeLessThan(k5 * 0.6);
    expect(stormDamagePerSecond(capabilities(defaultLoadout()).weatherExposure)).toBeGreaterThan(stormDamagePerSecond(capabilities(withAircraft(defaultLoadout(), 'heron')).weatherExposure));
  });

  it('stay in a storm and the aircraft breaks up: AIRCRAFT LOST', () => {
    const lost = (id: 'kestrel' | 'heron' | 'albatross') => {
      const l = withAircraft(defaultLoadout(), id);
      const op = newOperation(def, l);
      launch(op);
      let t = 0;
      let destroyed = false;
      for (; t < 120 && op.stage !== 'debrief'; t += 0.1) destroyed = tickOperation(op, def, fix(-80, 480), 0.1, capabilities(l)).hits.some((h) => h.type === 'destroyed') || destroyed;
      expect(destroyed).toBe(true);
      expect(op.stage).toBe('debrief');
      expect(op.outcome).toBe('destroyed');
      expect(op.damage).toBe(1);
      return t;
    };
    const k = lost('kestrel');
    const h = lost('heron');
    const a = lost('albatross');
    expect(k).toBeLessThan(15);
    expect(k).toBeLessThan(h);
    expect(h).toBeLessThan(a);
    const op = newOperation(def, defaultLoadout());
    launch(op);
    for (let t = 0; t < 30 && op.stage !== 'debrief'; t += 0.1) tickOperation(op, def, fix(-80, 480), 0.1, cap);
    const r = buildReport(newMission(), op, def, 0.5, 0);
    expect(r.headline).toBe('AIRCRAFT LOST · STORM DAMAGE');
    expect(r.grade).toBe('F');
    expect(r.rows.find((x) => x.label === 'Airframe damage')!.value).toBe('DESTROYED');
  });

  it('a damaged airframe flies worse (the flight model itself is unchanged)', () => {
    const P = capabilities(defaultLoadout()).perf;
    expect(damagedPerf(P, 0)).toBe(P);
    const half = damagedPerf(P, 0.5);
    const worst = damagedPerf(P, 1);
    for (const k of ['maxSpeed', 'rollRate', 'pitchRate', 'turnGain'] as const) {
      expect(half[k]).toBeLessThan(P[k]);
      expect(worst[k]).toBeLessThan(half[k]);
    }
    expect(worst.maxSpeed).toBeGreaterThan(P.minSpeed);
    expect(P.maxSpeed).toBe(92); // the original profile is never mutated
  });

  it('outside the storms nothing hurts', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    for (let t = 0; t < 30; t += 0.5) expect(tickOperation(op, def, fix(-600, 700), 0.5, cap).hits).toEqual([]);
    expect(op.damage).toBe(0);
  });

  it('landing home early off-route misses the remaining rings; fuel ends the operation', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    beginReturn(op);
    landAtBase(op, def);
    expect(op.ret.status.r1).toBe('missed');
    expect(op.ret.status.land).toBe('passed');
    const op2 = newOperation(def, defaultLoadout());
    launch(op2);
    endOperation(op2, 'fuel');
    expect(op2.stage).toBe('debrief');
    expect(op2.outcome).toBe('fuel');
  });
});

describe('report, rewards and career', () => {
  const def = MISSION_01;
  const flown = (opts: { fp?: boolean; detected?: boolean; photo?: number; full?: boolean }) => {
    const m = newMission();
    scanReturn(m, 'C', 2, 700, 100);
    if (opts.fp) {
      scanReturn(m, 'A', 2, 612, 452);
      identify(m, 'A');
    }
    inspectReturn(m, 'C', 2, true);
    identify(m, 'C');
    photograph(m, 'C', opts.photo ?? 0.9);
    if (opts.full) {
      updateDestination(m, 3, true, true);
      inspectReturn(m, 'E', 2, true);
      photograph(m, 'E', 0.8);
    }
    const op = newOperation(def, defaultLoadout());
    launch(op);
    const cap = capabilities(defaultLoadout());
    if (opts.detected) tickOperation(op, def, fix(700, 100, 700, 600), 0.1, cap);
    threadRings(op, cap);
    beginReturn(op);
    threadRings(op, cap);
    landAtBase(op, def);
    return { m, op };
  };

  it('a clean, complete operation reports well', () => {
    const { m, op } = flown({ full: true });
    const r = buildReport(m, op, def, 0.5, 120);
    expect(r.success).toBe(true);
    expect(r.headline).toBe('MISSION COMPLETE');
    const v = (l: string) => r.rows.find((x) => x.label === l)!.value;
    expect(v('Primary objective')).toBe('COMPLETE');
    expect(v('Secondary objectives')).toBe('3/3');
    expect(v('Target identification')).toBe('100%');
    expect(v('Evidence quality')).toBe('EXCELLENT');
    expect(v('Flight discipline')).toBe('EXCELLENT');
    expect(v('Fuel remaining')).toBe('50%');
    expect(v('Airframe damage')).toBe('NONE');
    expect(['S', 'A']).toContain(r.grade);
    expect(r.credits).toBeGreaterThan(0);
    expect(r.xp).toBeGreaterThan(0);
    expect(r.intelligence[0]).toMatch(/Sallow river landing/);
    expect(r.intelligence[1]).toMatch(/barge/);
  });

  it('mistakes cost: false positives, detection, poor evidence', () => {
    const good = buildReport(...(Object.values(flown({ full: true })) as [never, never]), def, 0.5, 100);
    const { m, op } = flown({ fp: true, detected: true, photo: 0.3 });
    const r = buildReport(m, op, def, 0.5, 100);
    const v = (l: string) => r.rows.find((x) => x.label === l)!.value;
    expect(v('Target identification')).toBe('75%');
    expect(v('Evidence quality')).toBe('POOR');
    expect(v('Secondary objectives')).toBe('0/3');
    expect(disciplineScore(op, def)).toBe(80);
    expect(r.score).toBeLessThan(good.score);
  });

  it('grades', () => {
    expect(gradeFor(2000, false, true)).toBe('F');
    expect(gradeFor(300, true, false)).toBe('D');
    expect(gradeFor(1200, true, true)).toBe('S');
    expect(gradeFor(800, true, true)).toBe('B');
  });

  it('banks rewards, unlocks by experience, persists, keeps the best grade', () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const c = loadCareer(st);
    expect(c).toEqual(newCareer());
    expect(isUnlocked(c, undefined)).toBe(true);
    expect(isUnlocked(c, 'albatross')).toBe(false);
    const { m, op } = flown({ full: true });
    const r = buildReport(m, op, def, 0.5, 100);
    const earned = recordOperation(c, def.id, r);
    expect(c.operations).toBe(1);
    expect(c.completed).toBe(1);
    expect(c.xp).toBe(r.xp);
    expect(earned.map((u) => u.id)).toEqual(UNLOCKS.filter((u) => u.xp <= r.xp).map((u) => u.id));
    recordOperation(c, def.id, { ...r, grade: 'D', success: false, xp: 0, credits: 0 });
    expect(c.best[def.id]).toBe(r.grade);
    saveCareer(c, st);
    expect(store.has(CAREER_KEY)).toBe(true);
    expect(loadCareer(st)).toEqual(c);
    c.xp = 10000;
    recordOperation(c, def.id, r);
    expect(nextUnlock(c)).toBeNull();
    st.setItem(CAREER_KEY, '{bad');
    expect(loadCareer(st)).toEqual(newCareer());
  });

  it('every aircraft can be selected and its stats read', () => {
    for (const a of AIRCRAFT) {
      const cap = capabilities(withAircraft(defaultLoadout(), a.id));
      expect(cap.aircraftName).toBe(AIRCRAFT_BY_ID[a.id].name);
      expect(cap.fuelSeconds).toBeGreaterThan(300);
    }
  });
});
