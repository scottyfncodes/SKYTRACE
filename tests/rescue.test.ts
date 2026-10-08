/**
 * The rescue, played through the pure modules: hover over the climbers,
 * lower the basket, they climb in, reel them up, take them home.
 */
import { describe, expect, it } from 'vitest';
import { initialAircraft } from '../src/flight/aircraft';
import { BASKET_H, HOIST, newBasket, placeSurvivors, stepHoist, swing, WINCH_DROP, type Anchor, type HoistEvent } from '../src/rescue/hoist';
import { stepHover, type HoverVel } from '../src/rescue/hover';
import { defaultLoadout, planOf } from '../src/rescue/loadout';
import { MISSION_BY_ID } from '../src/rescue/missions';
import { newProgress } from '../src/rescue/progress';
import { aboard, canHoist, canLand, delivered, HOIST_ZONE, landAtPad, newRun, objective, tickRun, type RunEvent } from '../src/rescue/run';
import { debrief } from '../src/rescue/debrief';
import { windAt } from '../src/rescue/wind';
import { getHeightField } from '../src/world/terrain';
import { PADS } from '../src/world/worldData';

const hf = getHeightField();
const ground = (x: number, z: number) => hf.sample(x, z);
const flat = () => 10;
const DT = 1 / 60;

describe('the hoist', () => {
  const still: Anchor = { x: 0, y: 40, z: 0, vx: 0, vz: 0 };

  it('stows with the helicopter and pays out on command', () => {
    const b = newBasket(still);
    stepHoist(b, [], still, { x: 0, z: 0 }, flat, 0, HOIST, DT);
    expect(b.len).toBe(0);
    expect(b.y).toBeCloseTo(40 - WINCH_DROP - BASKET_H, 1);
    for (let i = 0; i < 60; i++) stepHoist(b, [], still, { x: 0, z: 0 }, flat, 40, HOIST, DT);
    expect(b.len).toBeCloseTo(HOIST.winchSpeed, 0); // one second of winch
  });

  it('touches down on the ground under it and says so', () => {
    const b = newBasket(still);
    const ev: HoistEvent[] = [];
    for (let i = 0; i < 60 * 8; i++) ev.push(...stepHoist(b, [], still, { x: 0, z: 0 }, flat, 40, HOIST, DT));
    expect(b.grounded).toBe(true);
    expect(b.y).toBeCloseTo(10, 3);
    expect(ev.filter((e) => e.type === 'touchdown')).toHaveLength(1);
  });

  it('swings when the helicopter moves, and settles when it stops', () => {
    const b = newBasket(still);
    for (let i = 0; i < 300; i++) stepHoist(b, [], still, { x: 0, z: 0 }, flat, 20, HOIST, DT);
    const a: Anchor = { ...still };
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      a.vx = 6;
      a.x += 6 * DT;
      stepHoist(b, [], a, { x: 0, z: 0 }, flat, 20, HOIST, DT);
    }
    a.vx = 0;
    for (let i = 0; i < 240; i++) {
      stepHoist(b, [], a, { x: 0, z: 0 }, flat, 20, HOIST, DT);
      peak = Math.max(peak, swing(b, a));
    }
    expect(peak).toBeGreaterThan(1);
    for (let i = 0; i < 60 * 30; i++) stepHoist(b, [], a, { x: 0, z: 0 }, flat, 20, HOIST, DT);
    expect(swing(b, a)).toBeLessThan(0.3);
  });

  it('a steadier crew damps the swing', () => {
    const run = (damping: number) => {
      const P = { ...HOIST, damping };
      const b = newBasket(still);
      const a: Anchor = { ...still };
      for (let i = 0; i < 300; i++) stepHoist(b, [], a, { x: 0, z: 0 }, flat, 20, P, DT);
      a.x = 5;
      let sum = 0;
      for (let i = 0; i < 600; i++) {
        stepHoist(b, [], a, { x: 0, z: 0 }, flat, 20, P, DT);
        sum += swing(b, a);
      }
      return sum;
    };
    expect(run(HOIST.damping * 2.2)).toBeLessThan(run(HOIST.damping) * 0.8);
  });

  it('the wind blows the basket off plumb', () => {
    const b = newBasket(still);
    for (let i = 0; i < 60 * 20; i++) stepHoist(b, [], still, { x: 8, z: 0 }, () => -100, 30, HOIST, DT);
    expect(b.x).toBeGreaterThan(1.5);
  });

  it('someone near the basket walks over, climbs in, and is aboard when it is reeled in', () => {
    const people = placeSurvivors({ x: 3, z: 0 }, 1);
    const b = newBasket(still);
    const ev: HoistEvent[] = [];
    for (let i = 0; i < 60 * 10; i++) ev.push(...stepHoist(b, people, still, { x: 0, z: 0 }, flat, 40, HOIST, DT));
    expect(ev.map((e) => e.type)).toContain('walking');
    expect(ev.map((e) => e.type)).toContain('boarded');
    expect(people[0].state).toBe('basket');
    expect(b.carrying).toBe(0);
    for (let i = 0; i < 60 * 10; i++) ev.push(...stepHoist(b, people, still, { x: 0, z: 0 }, flat, 0, HOIST, DT));
    expect(people[0].state).toBe('aboard');
    expect(ev.map((e) => e.type)).toContain('secured');
  });

  it('nobody comes for a basket out of reach', () => {
    const people = placeSurvivors({ x: HOIST.reach + 3, z: 0 }, 1);
    const b = newBasket(still);
    for (let i = 0; i < 60 * 12; i++) stepHoist(b, people, still, { x: 0, z: 0 }, flat, 40, HOIST, DT);
    expect(b.grounded).toBe(true);
    expect(people[0].state).toBe('waiting');
  });

  it('lift the basket too soon and they step back; a full cabin takes nobody', () => {
    const people = placeSurvivors({ x: 1, z: 0 }, 1);
    const b = newBasket(still);
    for (let i = 0; i < 60 * 8 && people[0].state !== 'boarding'; i++) stepHoist(b, people, still, { x: 0, z: 0 }, flat, 40, HOIST, DT);
    expect(people[0].state).toBe('boarding');
    const ev: HoistEvent[] = [];
    for (let i = 0; i < 60 * 2; i++) ev.push(...stepHoist(b, people, still, { x: 0, z: 0 }, flat, 0, HOIST, DT));
    expect(b.carrying).toBeNull();
    expect(people[0].state).toBe('waiting');
    const c = newBasket(still);
    for (let i = 0; i < 60 * 12; i++) stepHoist(c, people, still, { x: 0, z: 0 }, flat, 40, HOIST, DT, true);
    expect(people[0].state).toBe('waiting');
  });

  it('dropping someone back on the ground is a bump', () => {
    const people = placeSurvivors({ x: 0, z: 0 }, 1);
    const b = newBasket(still);
    for (let i = 0; i < 60 * 10; i++) stepHoist(b, people, still, { x: 0, z: 0 }, flat, 40, HOIST, DT);
    expect(b.carrying).toBe(0);
    const ev: HoistEvent[] = [];
    for (let i = 0; i < 60 * 3; i++) ev.push(...stepHoist(b, people, still, { x: 0, z: 0 }, flat, 15, HOIST, DT));
    expect(b.grounded).toBe(false);
    for (let i = 0; i < 60 * 4; i++) ev.push(...stepHoist(b, people, still, { x: 0, z: 0 }, flat, 40, HOIST, DT));
    expect(ev.filter((e) => e.type === 'bump')).toHaveLength(1);
  });

  it('a slack basket is dragged along when the helicopter wanders off', () => {
    const b = newBasket(still);
    for (let i = 0; i < 60 * 8; i++) stepHoist(b, [], still, { x: 0, z: 0 }, flat, 31, HOIST, DT);
    expect(b.grounded).toBe(true);
    const a: Anchor = { ...still };
    for (let i = 0; i < 60 * 8; i++) {
      a.x += 4 * DT;
      a.vx = 4;
      stepHoist(b, [], a, { x: 0, z: 0 }, flat, 31, HOIST, DT);
    }
    expect(b.x).toBeGreaterThan(5);
    expect(Math.hypot(b.x - a.x, b.y + BASKET_H - (a.y - WINCH_DROP))).toBeLessThanOrEqual(31 + BASKET_H + 0.5);
  });
});

describe('the hover', () => {
  const P = { maxSpeed: 7, response: 1.6, drift: { x: 0, z: 0 }, holdY: 60, clearance: 10 };

  it('holds still with no stick and no wind, and holds its height', () => {
    let a = { ...initialAircraft(0, 60, 0, 0), speed: 0 };
    const v: HoverVel = { vx: 0, vz: 0 };
    for (let i = 0; i < 600; i++) a = stepHover(a, v, { x: 0, y: 0 }, P, flat, DT);
    expect(Math.hypot(a.x, a.z)).toBeLessThan(0.01);
    expect(a.y).toBeCloseTo(60, 1);
  });

  it('stick forward goes forward, stick right goes right, whatever the heading', () => {
    for (const yaw of [0, Math.PI / 2, -2]) {
      let a = { ...initialAircraft(0, 60, 0, yaw), speed: 0 };
      const v: HoverVel = { vx: 0, vz: 0 };
      for (let i = 0; i < 120; i++) a = stepHover(a, v, { x: 0, y: 1 }, P, flat, DT);
      expect(-Math.sin(yaw) * a.x + -Math.cos(yaw) * a.z).toBeGreaterThan(4);
      let b = { ...initialAircraft(0, 60, 0, yaw), speed: 0 };
      const w: HoverVel = { vx: 0, vz: 0 };
      for (let i = 0; i < 120; i++) b = stepHover(b, w, { x: 1, y: 0 }, P, flat, DT);
      expect(Math.cos(yaw) * b.x + -Math.sin(yaw) * b.z).toBeGreaterThan(4);
    }
  });

  it('the wind pushes it unless you push back', () => {
    const windy = { ...P, drift: { x: 2, z: 0 } };
    let a = { ...initialAircraft(0, 60, 0, 0), speed: 0 };
    const v: HoverVel = { vx: 0, vz: 0 };
    for (let i = 0; i < 300; i++) a = stepHover(a, v, { x: 0, y: 0 }, windy, flat, DT);
    expect(a.x).toBeGreaterThan(5);
    let b = { ...initialAircraft(0, 60, 0, 0), speed: 0 };
    const w: HoverVel = { vx: 0, vz: 0 };
    for (let i = 0; i < 300; i++) b = stepHover(b, w, { x: -2 / 7, y: 0 }, windy, flat, DT);
    expect(Math.abs(b.x)).toBeLessThan(0.5);
  });

  it('never sinks into the ground under it', () => {
    let a = { ...initialAircraft(0, 60, 0, 0), speed: 0 };
    const v: HoverVel = { vx: 0, vz: 0 };
    const hill = (x: number) => (x > 20 ? 80 : 10);
    for (let i = 0; i < 600; i++) a = stepHover(a, v, { x: 1, y: 0 }, P, hill, DT);
    expect(a.agl).toBeGreaterThan(P.clearance - 3.01);
  });
});

describe('wind', () => {
  it('blows from where it says, gusting around its speed', () => {
    const w = { speed: 6, from: 0, gust: 0.4 }; // from the north: toward +z
    let maxS = 0;
    let minS = Infinity;
    for (let t = 0; t < 60; t += 0.25) {
      const v = windAt(w, t);
      expect(v.z).toBeGreaterThan(0);
      maxS = Math.max(maxS, v.speed);
      minS = Math.min(minS, v.speed);
    }
    expect(minS).toBeGreaterThanOrEqual(6);
    expect(maxS).toBeGreaterThan(7);
    expect(windAt(w, 3.7)).toEqual(windAt(w, 3.7));
  });
});

describe('a mountain rescue, start to finish', () => {
  const def = MISSION_BY_ID['mountain-rescue'];
  const plan = planOf(def, defaultLoadout(def, newProgress()));

  it('the first loadout is the one the call recommends, and it can do the job', () => {
    const l = defaultLoadout(def, newProgress());
    expect(l).toEqual({ vehicle: 'rescue-heli', crew: 'winch', equipment: ['basket'] });
    expect(plan.capacity).toBe(2);
  });

  it('lift-off, search, spot, hover, hoist both, fly home, complete', () => {
    const r = newRun(def, plan);
    const ev: RunEvent[] = [];
    const tick = (x: number, z: number, agl: number, speed: number, hoisting = false, dt = 0.1) => ev.push(...tickRun(r, { x, z, agl, speed }, dt, plan, hoisting));
    tick(PADS.base.x, PADS.base.z, 2, 0);
    expect(r.stage).toBe('takeoff');
    expect(objective(r, false).target).toBeNull();
    tick(PADS.base.x, PADS.base.z, 25, 5);
    expect(r.stage).toBe('search');
    expect(objective(r, false).target?.kind).toBe('search');
    // no hoisting before they are found
    expect(canHoist(r, { x: def.site.x, z: def.site.z, agl: 30, speed: 0 }).ok).toBe(false);
    tick(def.site.x, def.site.z + 600, 120, 50);
    expect(ev).toContain('signal');
    expect(r.spotted).toBe(false);
    tick(def.site.x, def.site.z + 200, 60, 30);
    expect(ev).toContain('spotted');
    expect(r.stage).toBe('rescue');
    expect(objective(r, false).target?.kind).toBe('site');
    expect(canHoist(r, { x: def.site.x, z: def.site.z + HOIST_ZONE + 10, agl: 30, speed: 5 }).ok).toBe(false);
    expect(canHoist(r, { x: def.site.x, z: def.site.z + 20, agl: 30, speed: 40 }).why).toBe('SLOW DOWN');
    expect(canHoist(r, { x: def.site.x, z: def.site.z + 20, agl: 30, speed: 5 }).ok).toBe(true);

    // the hover: hold over the ledge, lower, wait, raise, twice
    const gy = ground(def.site.x, def.site.z);
    let a = { ...initialAircraft(def.site.x + 1.5, gy + 22, def.site.z, 0), speed: 0 };
    const v: HoverVel = { vx: 0, vz: 0 };
    const b = newBasket({ x: a.x, y: a.y, z: a.z, vx: 0, vz: 0 });
    const hov = { maxSpeed: 7, response: 1.6, drift: { x: 0, z: 0 }, holdY: gy + 22, clearance: 10 };
    const hoistEv: HoistEvent[] = [];
    let cmd = 40;
    for (let i = 0; i < 60 * 60 && r.survivors.some((s) => s.state !== 'aboard'); i++) {
      const wind = windAt(def.wind, r.t);
      hov.drift = { x: wind.x * 0.3, z: wind.z * 0.3 };
      // a pilot who holds over the next person waiting, pushing back against the drift
      const next = r.survivors.find((s) => s.state !== 'aboard') ?? r.survivors[0];
      const ex = next.homeX - a.x;
      const ez = next.homeZ - a.z;
      const stick = { x: Math.max(-1, Math.min(1, (ex * 0.6 - hov.drift.x) / 7)), y: Math.max(-1, Math.min(1, -(ez * 0.6 - hov.drift.z) / 7)) };
      a = stepHover(a, v, stick, hov, ground, DT);
      const e = stepHoist(b, r.survivors, { x: a.x, y: a.y, z: a.z, vx: v.vx, vz: v.vz }, wind, ground, cmd, plan.hoist, DT, aboard(r) >= r.capacity);
      hoistEv.push(...e);
      if (e.some((x) => x.type === 'boarded')) cmd = 0;
      if (e.some((x) => x.type === 'secured')) cmd = 40;
      tick(a.x, a.z, a.agl, a.speed, true, DT);
    }
    expect(aboard(r)).toBe(2);
    expect(hoistEv.filter((e) => e.type === 'secured')).toHaveLength(2);
    // out of the hover, the rescue turns for home
    tick(a.x, a.z, a.agl, 10);
    expect(ev).toContain('all-aboard');
    expect(r.stage).toBe('return');
    expect(objective(r, false).target?.kind).toBe('pad');

    const H = PADS.hospital;
    expect(canLand(r, { x: H.x, z: H.z, agl: 40, speed: 5 })).toBe(false);
    expect(canLand(r, { x: H.x + 5, z: H.z, agl: 10, speed: 5 })).toBe(true);
    ev.push(...landAtPad(r));
    expect(ev).toContain('complete');
    expect(r.stage).toBe('complete');
    expect(delivered(r)).toBe(2);
    const d = debrief(r);
    expect(d.success).toBe(true);
    expect(d.rescued).toBe(2);
    expect(d.lines[0].text).toBe('2 survivors rescued');
    expect(d.stars).toBeGreaterThanOrEqual(2);
  });

  it('a cabin that is full goes home and comes back for the rest', () => {
    const storm = MISSION_BY_ID['summit-storm'];
    const r = newRun(storm, { ...plan, capacity: 2 });
    r.stage = 'rescue';
    r.spotted = true;
    r.survivors[0].state = 'aboard';
    r.survivors[1].state = 'aboard';
    const ev = tickRun(r, { x: storm.site.x, z: storm.site.z, agl: 30, speed: 3 }, 0.1, plan, false);
    expect(ev).toContain('cabin-full');
    expect(r.stage).toBe('return');
    expect(canHoist(r, { x: storm.site.x, z: storm.site.z, agl: 30, speed: 0 }).ok).toBe(false);
    expect(landAtPad(r)).toEqual(['delivered']);
    expect(r.stage).toBe('takeoff');
    expect(objective(r, false).detail).toBe('Back for the other one');
    expect(r.trips).toBe(1);
    expect(tickRun(r, { x: PADS.hospital.x, z: PADS.hospital.z, agl: 25, speed: 2 }, 0.1, plan, false)).toContain('airborne');
    expect(r.stage).toBe('rescue');
    expect(canHoist(r, { x: storm.site.x, z: storm.site.z, agl: 30, speed: 0 }).ok).toBe(true);
  });

  it('running out of fuel fails the mission, and the debrief says so', () => {
    const r = newRun(def, plan);
    const ev = tickRun(r, { x: 0, z: 0, agl: 50, speed: 30 }, r.fuel + 1, plan, false);
    expect(ev).toContain('out-of-fuel');
    expect(r.stage).toBe('failed');
    expect(tickRun(r, { x: 0, z: 0, agl: 50, speed: 30 }, 1, plan, false)).toEqual([]);
    const d = debrief(r);
    expect(d.success).toBe(false);
    expect(d.stars).toBe(0);
    expect(d.headline).toBe('MISSION FAILED');
  });

  it('warns once on low fuel', () => {
    const r = newRun(def, plan);
    const ev = [...tickRun(r, { x: 0, z: 0, agl: 50, speed: 30 }, r.fuelMax * 0.8, plan, false), ...tickRun(r, { x: 0, z: 0, agl: 50, speed: 30 }, 1, plan, false)];
    expect(ev.filter((e) => e === 'low-fuel')).toHaveLength(1);
  });

  it('a better spotter (or a thermal camera) sees them from further away', () => {
    const r1 = newRun(def, plan);
    const r2 = newRun(def, plan);
    const p = { x: def.site.x, z: def.site.z + def.spotRange * 1.3, agl: 60, speed: 30 };
    tickRun(r1, p, 0.1, { spotMult: 1 }, false);
    tickRun(r2, p, 0.1, { spotMult: 1.6 }, false);
    expect(r1.spotted).toBe(false);
    expect(r2.spotted).toBe(true);
  });
});

describe('every playable rescue site', () => {
  it('stands people on open, level, dry ground the helicopter can hover over', async () => {
    const { MISSIONS } = await import('../src/rescue/missions');
    const { forestAt } = await import('../src/world/terrain');
    for (const m of MISSIONS.filter((x) => x.ready)) {
      const h = ground(m.site.x, m.site.z);
      expect(h, m.id).toBeGreaterThan(5);
      for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) expect(Math.abs(ground(m.site.x + dx, m.site.z + dz) - h), m.id).toBeLessThan(2);
      expect(forestAt(m.site.x, m.site.z), m.id).toBeLessThan(0.1);
      // the call's search area contains them
      expect(Math.hypot(m.search.x - m.site.x, m.search.z - m.site.z), m.id).toBeLessThan(m.search.r);
      expect(m.signalRange).toBeGreaterThan(m.spotRange);
    }
  });
});
