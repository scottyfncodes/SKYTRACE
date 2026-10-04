import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_BY_ID, CREW, EQUIPMENT } from '../src/operation/catalog';
import { capabilities, checkLoadout, defaultLoadout, seatCrew, toggleEquipment, withAircraft, type Loadout } from '../src/operation/loadout';
import { currentGate, legComplete, missedCount, newLeg, passLanding, tickLeg, totalExposure, type LegDef } from '../src/operation/gates';
import { activeLeg, beginReturn, endOperation, flightObjective, landAtBase, launch, newOperation, reconVisibility, tickOperation, windowLeft } from '../src/operation/operation';
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

describe('mission gates and weather', () => {
  const leg: LegDef = {
    id: 'outbound',
    gates: [
      { kind: 'waypoint', id: 'a', label: 'ALPHA', x: 0, z: 0, r: 100, objective: 'FLY TO ALPHA', detail: '' },
      { kind: 'enterArea', id: 's', label: 'SECTOR', area: { id: 's', label: 'SECTOR 7', x0: 500, z0: -100, x1: 900, z1: 100 }, stealth: true, objective: 'ENTER LOW', detail: '' },
    ],
    hazards: [
      { kind: 'storm', id: 'st', label: 'STORM CELL', x: 300, z: 0, r: 100 },
      { kind: 'ceiling', id: 'deck', label: 'DECK', y: 300 },
    ],
  };

  it('takes gates in order', () => {
    const s = newLeg(leg);
    expect(currentGate(s, leg)!.id).toBe('a');
    expect(tickLeg(s, leg, fix(-500, 0), 0.1, 400)).toEqual([]);
    const ev = tickLeg(s, leg, fix(20, 0), 0.1, 400);
    expect(ev.map((e) => e.type)).toEqual(['gate-passed']);
    expect(currentGate(s, leg)!.id).toBe('s');
    const ev2 = tickLeg(s, leg, fix(600, 0, 200, 150), 0.1, 400);
    expect(ev2.map((e) => e.type)).toEqual(['gate-passed', 'leg-complete']);
    expect(legComplete(s, leg)).toBe(true);
    expect(s.detected).toBe(false);
  });

  it('skipping a gate marks it missed; entering high is detected', () => {
    const s = newLeg(leg);
    const ev = tickLeg(s, leg, fix(600, 0, 600, 500), 0.1, 400);
    expect(ev.map((e) => e.type)).toEqual(['hazard-enter', 'gate-missed', 'detected', 'gate-passed', 'leg-complete']);
    expect(missedCount(s)).toBe(1);
    expect(s.detected).toBe(true);
  });

  it('counts time inside storm cells and above the cloud deck', () => {
    const s = newLeg(leg);
    expect(tickLeg(s, leg, fix(300, 0, 200), 1, 400).map((e) => e.type)).toEqual(['hazard-enter']);
    tickLeg(s, leg, fix(300, 10, 350), 1, 400);
    tickLeg(s, leg, fix(-900, 0, 200), 1, 400);
    expect(totalExposure(s, leg, 'storm')).toBe(2);
    expect(totalExposure(s, leg, 'ceiling')).toBe(1);
  });

  it('the landing gate is passed by touching down', () => {
    const ret: LegDef = { id: 'return', gates: [{ kind: 'land', id: 'land', label: 'LANDING', objective: 'LAND', detail: '' }], hazards: [] };
    const s = newLeg(ret);
    expect(tickLeg(s, ret, fix(0, 0), 1, 400)).toEqual([]);
    expect(passLanding(s, ret).map((e) => e.type)).toEqual(['gate-passed', 'leg-complete']);
  });

  it('Mission 01: the direct route crosses the storm; the gate route does not', () => {
    const storm = MISSION_01.outbound.hazards[0];
    const along = (ax: number, az: number, bx: number, bz: number) => {
      let min = Infinity;
      for (let t = 0; t <= 1; t += 0.01) min = Math.min(min, Math.hypot(ax + (bx - ax) * t - storm.x, az + (bz - az) * t - storm.z));
      return min;
    };
    const A = MISSION_01.operations.area;
    const sx = (A.x0 + A.x1) / 2;
    const sz = (A.z0 + A.z1) / 2;
    const alpha = MISSION_01.outbound.gates[0] as { x: number; z: number };
    expect(along(-820, 760, sx, sz)).toBeLessThan(storm.r);
    expect(along(-820, 760, alpha.x, alpha.z)).toBeGreaterThan(storm.r);
    expect(along(alpha.x, alpha.z, sx, sz)).toBeGreaterThan(storm.r);
    // the return: the new storm blocks the direct route home; Bravo goes round it
    const s2 = MISSION_01.return.hazards.find((h) => h.kind === 'storm') as { x: number; z: number; r: number };
    const bravo = MISSION_01.return.gates[0] as { x: number; z: number };
    const d = (ax: number, az: number, bx: number, bz: number) => {
      let min = Infinity;
      for (let t = 0; t <= 1; t += 0.01) min = Math.min(min, Math.hypot(ax + (bx - ax) * t - s2.x, az + (bz - az) * t - s2.z));
      return min;
    };
    expect(d(sx, sz, -820, 760)).toBeLessThan(s2.r);
    expect(d(sx, sz, bravo.x, bravo.z)).toBeGreaterThan(s2.r);
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
    expect(flightObjective(op, def, cap)).toEqual({ kicker: 'OUTBOUND · GATE 1 OF 2', title: 'FLY TO WAYPOINT ALPHA', detail: 'ROUTE NORTH OF THE STORM CELL' });
    tickOperation(op, def, fix(-280, 200), 0.1, cap);
    expect(flightObjective(op, def, cap)!.detail).toBe('STAY BELOW 450 m · STAY UNDER THE RIDGE RADAR');
    tickOperation(op, def, fix(700, 100, 300, 200), 0.1, cap);
    expect(op.stage).toBe('recon');
    expect(activeLeg(op, def)).toBeNull();
    expect(flightObjective(op, def, cap)).toBeNull();
    beginReturn(op);
    expect(op.stage).toBe('return');
    expect(flightObjective(op, def, cap)!.title).toBe('FLY TO WAYPOINT BRAVO');
    tickOperation(op, def, fix(-140, 650, 200), 0.1, cap);
    expect(flightObjective(op, def, cap)!.title).toBe('LAND AT BASE');
    landAtBase(op, def);
    expect(op.stage).toBe('debrief');
    expect(op.outcome).toBe('landed');
  });

  it('the weather front closes the recon window and haze builds toward it', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    tickOperation(op, def, fix(-280, 200), 0.1, cap);
    tickOperation(op, def, fix(700, 100, 300, 200), 0.1, cap);
    expect(reconVisibility(op, def)).toBeCloseTo(1, 2);
    let arrived = 0;
    for (let t = 0; t < def.reconWindow + 5; t += 1) if (tickOperation(op, def, fix(700, 100), 1, cap).frontArrived) arrived++;
    expect(arrived).toBe(1);
    expect(windowLeft(op, def)).toBe(0);
    expect(reconVisibility(op, def)).toBeCloseTo(def.reconVisibilityEnd, 5);
  });

  it('storm cells damage light aircraft more than heavy ones', () => {
    const run = (l: Loadout) => {
      const op = newOperation(def, l);
      launch(op);
      for (let t = 0; t < 10; t += 0.5) tickOperation(op, def, fix(-80, 480), 0.5, capabilities(l));
      return op.damage;
    };
    const kd = run(defaultLoadout());
    const hd = run(withAircraft(defaultLoadout(), 'heron'));
    expect(kd).toBeGreaterThan(0.2);
    expect(hd).toBeLessThan(kd / 2);
  });

  it('landing home early off-route misses the remaining gates; fuel ends the operation', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    beginReturn(op);
    landAtBase(op, def);
    expect(op.ret.status.bravo).toBe('missed');
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
    tickOperation(op, def, fix(-280, 200), 0.1, capabilities(defaultLoadout()));
    tickOperation(op, def, fix(700, 100, opts.detected ? 700 : 300, opts.detected ? 600 : 200), 0.1, capabilities(defaultLoadout()));
    beginReturn(op);
    tickOperation(op, def, fix(-140, 650, 200), 0.1, capabilities(defaultLoadout()));
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
    expect(v('Equipment damage')).toBe('NONE');
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
