/**
 * The river rescue: the Search Aircraft's raft drop, the hand-off, and the
 * Rescue Boat, played through the pure modules on the real valley.
 */
import { describe, expect, it } from 'vitest';
import { MISSION_BY_ID } from '../src/rescue/missions';
import { defaultLoadout, planOf } from '../src/rescue/loadout';
import { newProgress } from '../src/rescue/progress';
import { aboard, landAtPad, newRun, objective, tickRun, type RunEvent } from '../src/rescue/run';
import { scoreRun } from '../src/rescue/score';
import { debrief } from '../src/rescue/debrief';
import { newEscape } from '../src/rescue/route';
import { boatSpeed, JUMP_SPEED, newBoat, stepBoat, type BoatEnv, type BoatState } from '../src/water/boat';
import { CURRENT, currentAt, DEEP, riverAt, riverPoint } from '../src/water/river';
import { canArrive, canDropItem, dropItem, newHandoff, PICKUP, dropLanding, rapidAt, peopleAt, tickHandoff, type HandoffOps } from '../src/rescue/handoff';
import { getHeightField } from '../src/world/terrain';

const hf = getHeightField();
const ground = (x: number, z: number) => hf.sample(x, z);
const DT = 1 / 30;
const def = MISSION_BY_ID['capsized-boat'];
const spec = def.handoff!;
const env: BoatEnv = { height: ground, current: currentAt, rapid: (x, z) => rapidAt(spec, x, z) };
const deep = (x: number, z: number) => ground(x, z) < DEEP;

describe('the river', () => {
  it('knows where along it a point is, and which way the water runs', () => {
    for (const s of [300, 900, 1500, 2400]) {
      const p = riverPoint(s, 10);
      const r = riverAt(p.x, p.z);
      expect(r.s).toBeCloseTo(s, 0);
      expect(r.side).toBeCloseTo(10, 0);
    }
    // the Varrow runs west to east
    const c = currentAt(riverPoint(1000).x, riverPoint(1000).z);
    expect(c.x).toBeGreaterThan(0);
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(CURRENT, 1);
    // and the current dies away at the banks
    const bank = riverPoint(1000, 34);
    expect(Math.hypot(currentAt(bank.x, bank.z).x, currentAt(bank.x, bank.z).z)).toBeLessThan(0.05);
  });
});

describe('the Rescue Boat', () => {
  const start = () => {
    const p = riverPoint(1300);
    return newBoat(p.x, p.z, Math.atan2(-p.dx, -p.dz));
  };
  const drive = (b: BoatState, steer: number, throttle: number, sec: number, each?: (b: BoatState) => void) => {
    for (let i = 0; i < sec / DT; i++) {
      b = stepBoat(b, { steer, throttleDelta: throttle }, DT, env);
      each?.(b);
    }
    return b;
  };

  it('gets up to speed quickly, and stops when you back off', () => {
    let b = drive(start(), 0, 1, 4);
    expect(boatSpeed(b)).toBeGreaterThan(20);
    expect(b.pitch).toBeGreaterThan(0.03); // up on the plane
    b = drive(b, 0, -1, 4);
    expect(boatSpeed(b)).toBeLessThan(4);
  });

  it('slides through a hard turn: the hull points further round than it travels', () => {
    let b = drive(start(), 0, 1, 3);
    let slide = 0;
    b = drive(b, 1, 1, 0.8, (q) => {
      const travel = Math.atan2(-(q.vx ?? 0), -(q.vz ?? 0));
      let d = travel - q.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      slide = Math.max(slide, Math.abs(d));
    });
    expect(slide).toBeGreaterThan(0.1);
    expect(b.roll).toBeGreaterThan(0.05); // leaning into the turn
  });

  it('never climbs out of the river: it glances off the bank and loses speed', () => {
    let b = start();
    let hits = 0;
    // flat out with the wheel hard over: into the bank, again and again
    b = drive(b, 0.35, 1, 30, (q) => {
      expect(deep(q.x, q.z)).toBe(true);
      if (q.contact) hits++;
    });
    expect(hits).toBeGreaterThan(0);
  });

  it('drifts downstream with nobody at the wheel', () => {
    const b0 = start();
    const b = drive(b0, 0, 0, 10);
    expect(riverAt(b.x, b.z).s - riverAt(b0.x, b0.z).s).toBeGreaterThan(8);
  });

  it('flies off a rapid at speed, and only at speed', () => {
    const s = spec.rapids![0];
    const from = riverPoint(s - 120);
    const launch = (throttle: number, steps: number) => {
      let b = newBoat(from.x, from.z, Math.atan2(-from.dx, -from.dz));
      b.throttle = throttle;
      b.speed = throttle * 26;
      let peak = 0;
      let landed = 0;
      for (let i = 0; i < steps; i++) {
        b = stepBoat(b, { steer: 0, throttleDelta: 0 }, DT, env);
        peak = Math.max(peak, b.agl);
        landed = Math.max(landed, b.landed);
      }
      return { peak, landed };
    };
    const fast = launch(1, 300);
    expect(fast.peak).toBeGreaterThan(1.5);
    expect(fast.landed).toBeGreaterThan(3);
    const slow = launch((JUMP_SPEED - 3) / 26, 600);
    expect(slow.peak).toBe(0);
  });
});

describe('the raft drop', () => {
  /** An aircraft low over the river, flying downstream at the people, `back` metres short of them. */
  const pass = (ops: HandoffOps, back: number, agl: number, speed = 40) => {
    const g = peopleAt(ops);
    const c = currentAt(g.x, g.z);
    const l = Math.hypot(c.x, c.z);
    return { x: g.x - (c.x / l) * back, y: agl, z: g.z - (c.z / l) * back, vx: (c.x / l) * speed, vz: (c.z / l) * speed, agl };
  };
  const settle = (ops: HandoffOps, sec: number) => {
    const ev: string[] = [];
    for (let i = 0; i < sec / DT; i++) ev.push(...tickHandoff(ops, i * DT, DT, null));
    return ev;
  };

  it('lands where the preview says it will', () => {
    const ops = newHandoff(spec);
    const m = pass(ops, 200, 45);
    const at = dropLanding(m);
    dropItem(ops, m, true);
    const r = ops.dropped[0];
    for (let i = 0; i < 300 && r.state === 'falling'; i++) tickHandoff(ops, 0, DT, null);
    expect(r.state).toBe('floating');
    // (the raft settles onto the river's course where it lands)
    expect(Math.hypot(r.x - at.x, r.z - at.z)).toBeLessThan(3);
  });

  it('a raft led right onto them: they climb in, the cold stops, and the boat takes over', () => {
    const ops = newHandoff(spec);
    // let go where it will come down on them: lead them by the fall
    const m0 = pass(ops, 0, 40);
    const lead = dropLanding(m0);
    const m = { ...m0, x: m0.x - (lead.x - m0.x), z: m0.z - (lead.z - m0.z) };
    expect(dropItem(ops, m, true)).toEqual(['drop-away']);
    expect(canDropItem(ops, m, true).why).toBe('RAFT FALLING');
    const ev = settle(ops, 8);
    expect(ev).toContain('caught');
    expect(ev).toContain('handoff');
    expect(ops.phase).toBe('ground');
    const cold = ops.clock;
    settle(ops, 20);
    expect(ops.clock).toBe(cold);
  });

  it('a raft dropped right over them falls long: the aircraft has to lead them', () => {
    const ops = newHandoff(spec);
    dropItem(ops, pass(ops, 0, 60, 50), true);
    expect(settle(ops, 6)).toContain('drop-missed');
    expect(ops.drops).toBe(1);
    expect(ops.phase).toBe('air');
  });

  it('no raft from too high, or before they are found', () => {
    const ops = newHandoff(spec);
    expect(canDropItem(ops, pass(ops, 150, 120), true)).toEqual({ ok: false, why: 'TOO HIGH' });
    expect(canDropItem(ops, pass(ops, 150, 40), false).ok).toBe(false);
  });

  it('with both rafts missed the boat still goes, against the cold', () => {
    const ops = newHandoff(spec);
    for (let k = 0; k < 2; k++) {
      dropItem(ops, pass(ops, -150, 40), true);
      settle(ops, 7);
    }
    expect(ops.drops).toBe(0);
    expect(ops.caught).toBe(-1);
    expect(ops.phase).toBe('ground');
    expect(settle(ops, spec.clock)).toContain('clock-out');
  });

  it('the boat pulls them in only alongside and slow; it ties up only at the station', () => {
    const ops = newHandoff(spec);
    ops.phase = 'ground';
    const g = peopleAt(ops);
    // too fast: nothing
    for (let i = 0; i < 60; i++) tickHandoff(ops, 0, DT, { x: g.x + 5, z: g.z, speed: 15 });
    expect(ops.pull).toBe(0);
    // alongside, slow: everyone aboard in the pull time
    const ev: string[] = [];
    for (let i = 0; i < (PICKUP.boat.time + 0.2) / DT; i++) {
      const p = peopleAt(ops);
      ev.push(...tickHandoff(ops, 0, DT, { x: p.x + 5, z: p.z, speed: 4 }));
    }
    expect(ev).toContain('pulling');
    expect(ev).toContain('picked-up');
    expect(canArrive(ops, { x: spec.home.x, z: spec.home.z, speed: 3 })).toBe(true);
    expect(canArrive(ops, { x: spec.home.x, z: spec.home.z, speed: 12 })).toBe(false);
    expect(canArrive(ops, { x: g.x, z: g.z, speed: 3 })).toBe(false);
  });
});

describe('Capsized Canoe, the call', () => {
  it('puts them in the river, inside the search area, upstream of the station', () => {
    expect(deep(def.site.x, def.site.z)).toBe(true);
    expect(Math.hypot(def.site.x - def.search.x, def.site.z - def.search.z)).toBeLessThan(def.search.r);
    expect(deep(spec.home.x, spec.home.z)).toBe(true);
    expect(riverAt(spec.home.x, spec.home.z).s).toBeGreaterThan(spec.river!.s + 400);
    for (const s of spec.rapids!) {
      const p = riverPoint(s);
      expect(deep(p.x, p.z)).toBe(true);
      expect(s).toBeGreaterThan(spec.river!.s);
      expect(s).toBeLessThan(riverAt(spec.home.x, spec.home.z).s);
    }
  });

  it('the run home is a line of arches on open water the boat can drive', () => {
    const e = newEscape(def.escape!, ground);
    expect(e.gates.length).toBeGreaterThanOrEqual(5);
    for (const g of e.gates) {
      expect(deep(g.x, g.z)).toBe(true);
      // an arch standing on the water: the boat passes under its crown
      expect(Math.abs(g.y)).toBeLessThan(2);
    }
    for (let i = 0; i < e.gates.length - 1; i++) {
      const a = e.gates[i];
      const b = e.gates[i + 1];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      expect(d).toBeGreaterThan(40);
      expect(d).toBeLessThan(140);
      for (let k = 0; k <= 20; k++) expect(deep(a.x + ((b.x - a.x) * k) / 20, a.z + ((b.z - a.z) * k) / 20)).toBe(true);
    }
    // the last arch leads into the station
    const last = e.gates[e.gates.length - 1];
    expect(Math.hypot(last.x - spec.home.x, last.z - spec.home.z)).toBeLessThan(80);
  });

  it('is flown with the Search Aircraft, the raft and the paramedic, open from the start', () => {
    const l = defaultLoadout(def, newProgress());
    expect(l).toEqual({ vehicle: 'search-plane', crew: 'medic', equipment: ['raft'] });
    expect(planOf(def, l).kind).toBe('plane');
  });

  it('plays through: find them, raft them, boat them home', () => {
    const plan = planOf(def, defaultLoadout(def, newProgress()));
    const r = newRun(def, plan);
    const ev: RunEvent[] = [];
    const step = (p: { x: number; y: number; z: number; agl: number; speed: number }, sec: number) => {
      for (let i = 0; i < sec / DT; i++) ev.push(...tickRun(r, p, DT, plan, false));
    };
    // airborne, then over them
    step({ x: -500, y: 60, z: 600, agl: 60, speed: 40 }, 1);
    expect(r.stage).toBe('search');
    const g = peopleAt(r.handoff!);
    step({ x: g.x, y: 50, z: g.z - 100, agl: 50, speed: 40 }, 0.2);
    expect(ev).toContain('spotted');
    expect(objective(r, false).title).toBe('DROP THE RAFT');
    // a raft led onto them
    const at = { x: g.x, y: 40, z: g.z, vx: 40, vz: 0, agl: 40 };
    const lead = dropLanding(at);
    dropItem(r.handoff!, { ...at, x: at.x - (lead.x - at.x), z: at.z - (lead.z - at.z) }, true);
    step({ x: g.x + 300, y: 80, z: g.z, agl: 80, speed: 40 }, 8);
    expect(ev).toContain('handoff');
    expect(objective(r, false).title).toBe('GET ALONGSIDE');
    // alongside in the boat
    for (let i = 0; i < 4 / DT; i++) {
      const p = peopleAt(r.handoff!);
      ev.push(...tickRun(r, { x: p.x + 6, y: 0.5, z: p.z, agl: 0, speed: 3 }, DT, plan, false));
    }
    expect(ev).toContain('all-aboard');
    expect(aboard(r)).toBe(2);
    expect(r.stage).toBe('return');
    // down the arches to the station
    for (const gate of r.escape!.gates) {
      step({ x: gate.x - gate.nx * 20, y: 0.5, z: gate.z - gate.nz * 20, agl: 0, speed: 20 }, 0.1);
      step({ x: gate.x + gate.nx * 5, y: 0.5, z: gate.z + gate.nz * 5, agl: 0, speed: 20 }, 0.1);
    }
    expect(r.escape!.result.every((x) => x === 'passed')).toBe(true);
    expect(landAtPad(r)).toContain('complete');
    const d = debrief(r);
    expect(d.success).toBe(true);
    const raftRow = scoreRun(r).rows.find((x) => x.label === 'RAFT')!;
    expect(raftRow.points).toBeGreaterThan(300);
    expect(scoreRun(r).rows.map((x) => x.label)).toContain('HANDLING');
  });

  it('runs out of cold before a raft: the mission fails, and says why', () => {
    const plan = planOf(def, defaultLoadout(def, newProgress()));
    const r = newRun(def, plan);
    const far = { x: -500, y: 60, z: 600, agl: 60, speed: 40 };
    for (let i = 0; i < (spec.clock + 2) / DT && r.stage !== 'failed'; i++) tickRun(r, far, DT, plan, false);
    expect(r.stage).toBe('failed');
    expect(r.failReason).toMatch(/cold/);
  });
});
