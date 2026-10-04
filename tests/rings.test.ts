/**
 * Ring routes: the flying half of every operation. The rings are taken in
 * order by crossing their plane inside the hoop; a miss moves the route on;
 * on the way home a RADAR CONTACT puts each ring on a shrinking clock.
 * The Mission 01 routes are flown here by a simple pilot through the real
 * flight model, with every aircraft.
 */
import { describe, expect, it } from 'vitest';
import { FLIGHT, initialAircraft, stepAircraft, type AircraftState, type FlightPerf } from '../src/flight/aircraft';
import { wrapAngle } from '../src/core/math';
import { MISSION_01 } from '../src/mission/mission01';
import { AIRCRAFT } from '../src/operation/catalog';
import {
  CLOSED_SCALE,
  currentGate,
  inHazard,
  joinRing,
  legComplete,
  newLeg,
  placeRoute,
  ringScale,
  ringTally,
  rings,
  tickLeg,
  type AircraftFix,
  type LegDef,
  type LegState,
  type Ring,
  type Route,
} from '../src/operation/gates';
import { capabilities, defaultLoadout, withAircraft } from '../src/operation/loadout';
import { activeLeg, beginReturn, flightObjective, landAtBase, launch, newOperation, tickOperation } from '../src/operation/operation';
import { stageResults } from '../src/operation/score';
import { newMission } from '../src/mission/mission';
import { BASE, RUNWAY } from '../src/world/worldData';
import { heightAt } from '../src/world/terrain';

const flat = () => 0;
const fix = (x: number, z: number, y = 100, agl = y): AircraftFix => ({ x, z, y, agl });

/** Three rings due east along z = 0, 100 m up, 200 m apart. */
const LINE: LegDef = {
  id: 'outbound',
  title: 'FLY THE RINGS',
  gates: [
    { kind: 'ring', id: 'a', x: 200, z: 0, agl: 100, r: 30 },
    { kind: 'ring', id: 'b', x: 400, z: 0, agl: 100, r: 30 },
    { kind: 'ring', id: 'c', x: 600, z: 0, agl: 100, r: 30 },
  ],
  hazards: [],
};
const line = () => placeRoute(LINE, flat, { x: 0, z: 0 });

/** Fly a straight segment in small steps (crossings are found between frames). */
function flyLine(s: LegState, r: Route, from: [number, number, number], to: [number, number, number], steps = 20, ceiling = 400) {
  const ev = [];
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const y = from[1] + (to[1] - from[1]) * k;
    ev.push(...tickLeg(s, r, fix(from[0] + (to[0] - from[0]) * k, from[2] + (to[2] - from[2]) * k, y), 0.1, ceiling));
  }
  return ev;
}

describe('ring routes', () => {
  it('rings face along the route and stand above the ground', () => {
    const r = placeRoute(LINE, () => 40, { x: 0, z: 0 });
    const [a] = rings(r);
    expect(a.y).toBe(140);
    expect(a.nx).toBeCloseTo(1, 5);
    expect(a.nz).toBeCloseTo(0, 5);
    // a corner ring faces halfway between the way in and the way out
    const bent = placeRoute({ ...LINE, gates: [LINE.gates[0], { kind: 'ring', id: 'b', x: 200, z: -200, agl: 100, r: 30 }] }, flat, { x: 0, z: 0 });
    const c = rings(bent)[0];
    expect(Math.atan2(-c.nz, c.nx)).toBeCloseTo(Math.PI / 4, 5);
  });

  it('are taken in order: through the hoop clears it and the next one becomes the target', () => {
    const r = line();
    const s = newLeg(r);
    expect(currentGate(s, r)!.id).toBe('a');
    const ev = flyLine(s, r, [0, 100, 0], [300, 100, 5]);
    expect(ev.map((e) => e.type)).toEqual(['gate-passed']);
    expect(ev[0].text).toBe('1/3');
    expect(s.status.a).toBe('passed');
    expect(currentGate(s, r)!.id).toBe('b');
    const ev2 = flyLine(s, r, [300, 100, 5], [700, 110, -10]);
    expect(ev2.map((e) => e.type)).toEqual(['gate-passed', 'gate-passed', 'leg-complete']);
    expect(legComplete(s, r)).toBe(true);
    expect(ringTally(s, r)).toEqual({ hit: 3, total: 3 });
  });

  it('a near miss still counts (the hoop that counts is a little bigger than the one you see)', () => {
    const r = line();
    const s = newLeg(r);
    flyLine(s, r, [0, 100, 34], [300, 100, 34]);
    expect(s.status.a).toBe('passed');
  });

  it('crossing outside the hoop is a miss, and the route moves on (no loop back)', () => {
    const r = line();
    const s = newLeg(r);
    const ev = flyLine(s, r, [0, 100, 80], [300, 100, 80]);
    expect(ev.map((e) => e.type)).toEqual(['gate-missed']);
    expect(s.status.a).toBe('missed');
    expect(currentGate(s, r)!.id).toBe('b');
    // too high is as much a miss as too wide
    flyLine(s, r, [300, 160, 0], [500, 160, 0]);
    expect(s.status.b).toBe('missed');
  });

  it('crossing far from the ring is ignored; flying back through the plane is not a miss', () => {
    const r = line();
    const s = newLeg(r);
    flyLine(s, r, [0, 100, 600], [300, 100, 600]);
    expect(s.status.a).toBe('pending');
    const s2 = newLeg(r);
    flyLine(s2, r, [300, 100, 80], [0, 100, 80]);
    expect(s2.status.a).toBe('pending');
  });

  it('flying straight through a later ring marks the skipped ones missed', () => {
    const r = line();
    const s = newLeg(r);
    s.prev = { x: 380, y: 100, z: 0 };
    const ev = tickLeg(s, r, fix(420, 0), 0.1, 400);
    expect(ev.map((e) => e.type)).toEqual(['gate-missed', 'gate-passed']);
    expect(s.status).toMatchObject({ a: 'missed', b: 'passed', c: 'pending' });
    expect(currentGate(s, r)!.id).toBe('c');
  });

  it('a radar-watched area sees an aircraft above its stealth ceiling, once', () => {
    const r = placeRoute({ ...LINE, radar: { id: 'sec', label: 'SECTOR', x0: 300, z0: -100, x1: 700, z1: 100 } }, flat, { x: 0, z: 0 });
    const s = newLeg(r);
    expect(tickLeg(s, r, fix(350, 0, 150, 150), 0.1, 200).map((e) => e.type)).toEqual([]);
    expect(tickLeg(s, r, fix(360, 0, 260, 260), 0.1, 200).map((e) => e.type)).toEqual(['detected']);
    expect(tickLeg(s, r, fix(370, 0, 260, 260), 0.1, 200).map((e) => e.type)).toEqual([]);
    expect(s.detected).toBe(true);
  });
});

describe('RADAR CONTACT: the urgency of the way home', () => {
  const alerted: LegDef = { ...LINE, id: 'return', title: 'RETURN TO BASE', gates: [{ ...LINE.gates[0], alert: true } as LegDef['gates'][number], LINE.gates[1], LINE.gates[2]] };

  it('passing the alert ring raises contact; the next ring gets a clock and shrinks as it runs', () => {
    const r = placeRoute(alerted, flat, { x: 0, z: 0 });
    const s = newLeg(r);
    const ev = flyLine(s, r, [0, 100, 0], [210, 100, 0]);
    expect(ev.map((e) => e.type)).toEqual(['gate-passed', 'contact']);
    expect(s.contact).toBe(true);
    expect(ringScale(s)).toBe(1);
    tickLeg(s, r, fix(212, 0), 0.1, 400);
    expect(s.clockMax).toBeGreaterThan(6);
    expect(s.clockMax).toBeLessThan(15);
    for (let i = 0; i < 40; i++) tickLeg(s, r, fix(212, 0), 0.1, 400);
    expect(ringScale(s)).toBeLessThan(1);
    expect(ringScale(s)).toBeGreaterThanOrEqual(CLOSED_SCALE);
  });

  it('a ring whose clock runs out closes: missed, and the next ring starts its own clock', () => {
    const r = placeRoute(alerted, flat, { x: 0, z: 0 });
    const s = newLeg(r);
    flyLine(s, r, [0, 100, 0], [210, 100, 0]);
    const ev = [];
    for (let i = 0; i < 300 && s.index === 1; i++) ev.push(...tickLeg(s, r, fix(212, 0), 0.1, 400));
    expect(ev.map((e) => e.type)).toEqual(['gate-missed']);
    expect(s.status.b).toBe('missed');
    expect(currentGate(s, r)!.id).toBe('c');
    tickLeg(s, r, fix(212, 0), 0.1, 400);
    expect(s.clock).toBeCloseTo(s.clockMax, 5);
  });

  it('under contact the closing hoop really is smaller', () => {
    const r = placeRoute(alerted, flat, { x: 0, z: 0 });
    const s = newLeg(r, true);
    tickLeg(s, r, fix(0, 0), 0.1, 400);
    s.clock = 0.01; // nearly closed: 30 m × 0.55 × grace ≈ 21 m
    flyLine(s, r, [100, 100, 30], [300, 100, 30], 4);
    expect(s.status.a).toBe('missed');
  });

  it('flown at a steady pace the clock is never the problem', () => {
    const r = placeRoute(alerted, flat, { x: 0, z: 0 });
    const s = newLeg(r, true);
    for (let x = 0; x <= 700; x += 4.5) tickLeg(s, r, fix(x, 0), 0.1, 400); // 45 m/s
    expect(ringTally(s, r)).toEqual({ hit: 3, total: 3 });
  });
});

describe('the join ring: flying again the moment recon ends', () => {
  it('stands ahead of the aircraft, turned toward the route, below the cloud deck', () => {
    // heading north (yaw 0), the route lies due west
    const j = joinRing({ x: 0, y: 400, z: 0, yaw: 0 }, { x: -1000, z: 0 }, flat, 300);
    expect(Math.hypot(j.x, j.z)).toBeCloseTo(380, 0);
    expect(j.z).toBeLessThan(0); // still ahead
    expect(j.x).toBeLessThan(0); // turned toward the route
    expect(Math.atan2(-j.x, -j.z)).toBeCloseTo(Math.PI / 4, 3); // by at most 45 degrees
    expect(j.y).toBeLessThanOrEqual(240);
    expect(j.y).toBeGreaterThanOrEqual(70);
    // already pointing at the route: straight ahead
    const k = joinRing({ x: 0, y: 150, z: 0, yaw: Math.PI / 2 }, { x: -1000, z: 0 }, flat, 300);
    expect(k.x).toBeCloseTo(-380, 0);
    expect(k.z).toBeCloseTo(0, 0);
    expect(k.y).toBe(150);
  });
});

describe('the operation: FLY → OPERATE → FLY AGAIN', () => {
  const cap = capabilities(defaultLoadout());
  const def = MISSION_01;
  /** Thread every ring of the active leg (straight through each centre). */
  const flyRoute = (op: ReturnType<typeof newOperation>, upTo = Infinity) => {
    const leg = activeLeg(op)!;
    const rs = rings(leg.def);
    let p = { x: rs[0].x - rs[0].nx * 60, y: rs[0].y, z: rs[0].z - rs[0].nz * 60 };
    tickOperation(op, def, { ...p, agl: 80 }, 0.1, cap);
    for (const r of rs.slice(0, Math.min(upTo, rs.length))) {
      for (const k of [-20, 20]) {
        p = { x: r.x + r.nx * k, y: r.y, z: r.z + r.nz * k };
        tickOperation(op, def, { ...p, agl: r.agl }, 0.4, cap);
      }
    }
  };

  it('outbound: WHEELS UP objective is the first ring; the last ring puts the crew ON STATION', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    expect(flightObjective(op, def, cap)).toMatchObject({ kicker: 'OUTBOUND 1/8', title: 'FLY THE RINGS' });
    flyRoute(op, 7);
    expect(op.stage).toBe('outbound');
    expect(flightObjective(op, def, cap)!.kicker).toBe('OUTBOUND 8/8');
    expect(flightObjective(op, def, cap)!.detail).toBe(`BELOW ${cap.stealthCeiling} m`);
    const r8 = rings(op.routes.outbound)[7];
    const ev = [
      ...tickOperation(op, def, { x: r8.x - r8.nx * 20, y: r8.y, z: r8.z - r8.nz * 20, agl: 80 }, 0.4, cap).events,
      ...tickOperation(op, def, { x: r8.x + r8.nx * 20, y: r8.y, z: r8.z + r8.nz * 20, agl: 80 }, 0.4, cap).events,
    ];
    expect(ev.map((e) => e.type)).toEqual(['gate-passed', 'leg-complete']);
    expect(op.stage).toBe('recon');
    expect(op.outbound.detected).toBe(false);
    expect(activeLeg(op)).toBeNull();
  });

  it('recon complete: the way home opens with a ring right ahead, and ends at the runway', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    flyRoute(op);
    expect(op.stage).toBe('recon');
    const pose = { x: 600, y: 300, z: 300, yaw: Math.PI / 2 };
    beginReturn(op, def, pose, flat);
    expect(op.stage).toBe('return');
    const join = rings(op.routes.return)[0];
    expect(join.id).toBe('join');
    expect(Math.hypot(join.x - pose.x, join.z - pose.z)).toBeCloseTo(380, 0);
    expect(op.ret.contact).toBe(false);
    expect(flightObjective(op, def, cap)).toMatchObject({ kicker: 'RETURN 1/8', title: 'RETURN TO BASE' });
    flyRoute(op);
    expect(op.ret.contact).toBe(true); // leaving the sector raised RADAR CONTACT
    expect(flightObjective(op, def, cap)!.title).toBe('LAND AT BASE');
    expect(ringTally(op.ret, op.routes.return)).toEqual({ hit: 8, total: 8 });
    landAtBase(op, def);
    expect(op.stage).toBe('debrief');
    expect(stageResults(newMission(), op, def).map((x) => x.word)).toEqual(['CLEAN', 'NO PHOTO', 'CLEAN']);
  });

  it('spotted on the way in: the radar has you from the first ring home', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    tickOperation(op, def, { x: 700, y: 600, z: 100, agl: 600 }, 0.1, cap);
    expect(op.outbound.detected).toBe(true);
    flyRoute(op);
    beginReturn(op, def, { x: 600, y: 200, z: 300, yaw: Math.PI / 2 }, flat);
    expect(op.ret.contact).toBe(true);
    expect(flightObjective(op, def, cap)!.title).toBe('RADAR CONTACT');
  });

  it('missed rings show on the scorecard as a ring count', () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    const rs = rings(op.routes.outbound);
    // fly wide of the first two rings
    for (const r of rs.slice(0, 2)) {
      tickOperation(op, def, { x: r.x - r.nx * 20 - r.nz * 90, y: r.y, z: r.z - r.nz * 20 + r.nx * 90, agl: 100 }, 0.4, cap);
      tickOperation(op, def, { x: r.x + r.nx * 20 - r.nz * 90, y: r.y, z: r.z + r.nz * 20 + r.nx * 90, agl: 100 }, 0.4, cap);
    }
    expect(ringTally(op.outbound, op.routes.outbound)).toEqual({ hit: 0, total: 8 });
    expect(op.outbound.index).toBe(2);
    flyRoute(op);
    expect(stageResults(newMission(), op, def)[0]).toMatchObject({ ok: false, word: '6/8 RINGS' });
  });
});

// ---------------------------------------------------------------- Mission 01, flown

const ground = (x: number, z: number) => heightAt(x, z);

/** A plain pilot: bank toward a point just short of the ring (lining up with it), pitch toward its height. */
function steer(a: AircraftState, r: Ring, P: FlightPerf) {
  const lead = Math.min(50, 0.35 * Math.hypot(r.x - a.x, r.z - a.z));
  const want = Math.atan2(-(r.x - r.nx * lead - a.x), -(r.z - r.nz * lead - a.z));
  const err = wrapAngle(want - a.yaw);
  const roll = Math.max(-1, Math.min(1, -err * 2.2));
  const d = Math.hypot(r.x - a.x, r.z - a.z);
  const wantPitch = Math.max(-0.45, Math.min(0.45, (r.y - a.y) / Math.max(50, d * 0.8)));
  return { roll, pitch: Math.max(-1, Math.min(1, wantPitch / P.maxPitch)), throttleDelta: (0.7 - a.throttle) * 2 };
}

function fly(route: Route, a0: AircraftState, P: FlightPerf, stealthCeiling: number, opts: { takeoff?: boolean; contact?: boolean; maxT?: number } = {}) {
  const s = newLeg(route, opts.contact);
  let a = a0;
  let t = 0;
  let minClearance = Infinity;
  const dt = 0.05;
  while (!legComplete(s, route) && t < (opts.maxT ?? 200)) {
    const g = currentGate(s, route)!;
    if (g.kind !== 'ring') break;
    const inp = steer(a, g, P);
    if (opts.takeoff && t < 4.5) {
      inp.pitch = Math.max(inp.pitch, 0.7);
      inp.roll = 0;
      inp.throttleDelta = 0;
    }
    a = stepAircraft(a, inp, dt, ground, P);
    t += dt;
    if (t > 6) minClearance = Math.min(minClearance, a.agl);
    tickLeg(s, route, { x: a.x, y: a.y, z: a.z, agl: a.agl }, dt, stealthCeiling);
  }
  return { s, a, t, minClearance };
}

const takeoff = (P: FlightPerf) => {
  const a = initialAircraft(RUNWAY.x1 + 16, ground(RUNWAY.x1 + 16, RUNWAY.z) + 2, RUNWAY.z, BASE.heading);
  a.speed = 40;
  a.throttle = 0.8;
  void P;
  return a;
};

describe('Mission 01 routes, flown through the real flight model', () => {
  const routes = newOperation(MISSION_01, defaultLoadout(), ground).routes;

  it('the take-off itself flies the first ring: WHEELS UP, then an instant GATE CLEARED', () => {
    for (const ac of AIRCRAFT) {
      const P = ac.perf;
      let a = takeoff(P);
      const r = rings(routes.outbound)[0];
      const s = newLeg(routes.outbound);
      for (let t = 0; t < 12 && s.index === 0; t += 0.05) {
        a = stepAircraft(a, { roll: 0, pitch: t < 4.5 ? 0.7 : 0, throttleDelta: 0 }, 0.05, ground, P);
        tickLeg(s, routes.outbound, { x: a.x, y: a.y, z: a.z, agl: a.agl }, 0.05, ac.stealthCeiling);
      }
      expect(s.status[r.id], ac.id).toBe('passed');
    }
  });

  it('every aircraft can fly the whole outbound route, under the radar, clear of the storm', () => {
    for (const ac of AIRCRAFT) {
      const { s, t, minClearance } = fly(routes.outbound, takeoff(ac.perf), ac.perf, ac.stealthCeiling, { takeoff: true });
      expect(ringTally(s, routes.outbound), ac.id).toEqual({ hit: 8, total: 8 });
      expect(s.detected, ac.id).toBe(false);
      expect(s.exposure.storm1, ac.id).toBe(0);
      expect(minClearance, ac.id).toBeGreaterThan(25);
      // a real flying phase, not a hop
      expect(t, ac.id).toBeGreaterThan(25);
      expect(t, ac.id).toBeLessThan(90);
    }
  });

  it('every aircraft can fly home from the sector through every ring, on the clock, below the clouds', () => {
    for (const ac of AIRCRAFT) {
      // wherever recon ended: over the barge, heading north-east in the orbit
      for (const pose of [
        { x: 560, y: ground(560, 520) + ac.orbit.agl, z: 520, yaw: -Math.PI / 4 },
        { x: 760, y: ground(760, -100) + ac.orbit.agl, z: -100, yaw: Math.PI },
      ]) {
        const op = newOperation(MISSION_01, withAircraft(defaultLoadout(), ac.id), ground);
        launch(op);
        op.stage = 'recon';
        beginReturn(op, MISSION_01, pose, ground);
        const a = initialAircraft(pose.x, pose.y, pose.z, pose.yaw);
        a.speed = 50;
        const { s, minClearance } = fly(op.routes.return, a, ac.perf, ac.stealthCeiling, { contact: true });
        expect(ringTally(s, op.routes.return), `${ac.id} from ${pose.x},${pose.z}`).toEqual({ hit: 8, total: 8 });
        expect(s.exposure.storm2, ac.id).toBe(0);
        expect(minClearance, ac.id).toBeGreaterThan(20);
      }
    }
  });

  it('every ring on the way home is below the cloud deck', () => {
    const deck = MISSION_01.return.hazards.find((h) => h.kind === 'ceiling')!;
    for (const r of rings(routes.return)) expect(inHazard(deck, { x: r.x, z: r.z, y: r.y + r.r, agl: 0 })).toBe(false);
  });

  it('the rings in the sector are under every aircraft\'s stealth ceiling', () => {
    const A = MISSION_01.operations.area;
    const low = Math.min(...AIRCRAFT.map((a) => a.stealthCeiling));
    for (const r of rings(routes.outbound)) if (r.x >= A.x0 - 100) expect(r.agl + r.r).toBeLessThan(low);
  });

  it('the routes are authored, not straight lines: turns, climbs and descents', () => {
    for (const route of [routes.outbound, routes.return]) {
      const rs = rings(route);
      const headings = rs.map((r) => Math.atan2(r.nx, r.nz));
      const turns = headings.slice(1).map((h, i) => Math.abs(wrapAngle(h - headings[i])));
      expect(Math.max(...turns)).toBeGreaterThan(0.5);
      const agls = rs.map((r) => r.agl);
      expect(Math.max(...agls) - Math.min(...agls)).toBeGreaterThan(40);
    }
  });

  it('the way home is the tighter, lower, more urgent route', () => {
    const stats = (route: Route) => {
      const rs = rings(route);
      const gaps = rs.slice(1).map((r, i) => Math.hypot(r.x - rs[i].x, r.z - rs[i].z));
      return { gap: gaps.reduce((a, b) => a + b, 0) / gaps.length, r: rs.reduce((a, b) => a + b.r, 0) / rs.length, agl: rs.reduce((a, b) => a + b.agl, 0) / rs.length };
    };
    const o = stats(routes.outbound);
    const h = stats(routes.return);
    expect(h.gap).toBeLessThan(o.gap);
    expect(h.r).toBeLessThan(o.r);
    expect(h.agl).toBeLessThan(o.agl);
    expect((MISSION_01.return.gates as LegDef['gates']).some((g) => g.kind === 'ring' && g.alert)).toBe(true);
  });
});

void FLIGHT;
