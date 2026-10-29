/**
 * The Trail Bike and Lost Hiker: the Search Aircraft finds her smoke, the
 * bike rides in up the forest track, she climbs on, and out by the haul road
 * to the ambulance. Played through the pure modules on the real valley.
 */
import { describe, expect, it } from 'vitest';
import { MISSION_BY_ID } from '../src/rescue/missions';
import { defaultLoadout, planOf } from '../src/rescue/loadout';
import { newProgress } from '../src/rescue/progress';
import { aboard, landAtPad, newRun, objective, tickRun, type RunEvent } from '../src/rescue/run';
import { scoreRun } from '../src/rescue/score';
import { canArrive, PICKUP, rampAt } from '../src/rescue/handoff';
import { newEscape } from '../src/rescue/route';
import { bikeSpeed, newBike, stepBike, topSpeed, type BikeEnv, type BikeState } from '../src/land/bike';
import { trailAt, trailPoint, trailYaw } from '../src/land/trail';
import { forestAt, getHeightField } from '../src/world/terrain';

const hf = getHeightField();
const ground = (x: number, z: number) => hf.sample(x, z);
const DT = 1 / 30;
const def = MISSION_BY_ID['lost-hiker'];
const spec = def.handoff!;
const env: BikeEnv = { height: ground, brush: forestAt, trail: trailAt, ramp: (x, z) => rampAt(spec, x, z), water: (x, z) => ground(x, z) < -0.5 };

/** A rider who steers at `to` and holds the throttle at `throttle` (0..1). */
function ride(b: BikeState, to: { x: number; z: number }, throttle: number): BikeState {
  let e = Math.atan2(-(to.x - b.x), -(to.z - b.z)) - b.yaw;
  while (e > Math.PI) e -= 2 * Math.PI;
  while (e < -Math.PI) e += 2 * Math.PI;
  return stepBike(b, { steer: Math.max(-1, Math.min(1, -e * 3)), throttleDelta: (throttle - b.throttle) * 8 }, DT, env);
}

describe('the trails', () => {
  it('knows where the tracks are', () => {
    const p = trailPoint('foresttrack', 300);
    expect(trailAt(p.x, p.z)).toBe(1);
    expect(trailAt(p.x + 40, p.z)).toBe(0);
    // points along a track stay on it
    for (const s of [50, 200, 400]) {
      const q = trailPoint('haul', s);
      expect(trailAt(q.x, q.z)).toBe(1);
    }
  });
});

describe('the Trail Bike', () => {
  const onTrack = (s: number) => {
    const p = trailPoint('haul', s);
    return newBike(p.x, p.z, trailYaw('haul', s, true), ground(p.x, p.z));
  };

  it('is fast on the trail and slow in the brush', () => {
    const p = trailPoint('foresttrack', 100);
    expect(topSpeed(env, p.x, p.z)).toBeGreaterThan(25);
    // deep in Keld Forest, away from the track
    expect(topSpeed(env, p.x + 60, p.z)).toBeLessThan(10);
  });

  it('gets up to speed on the track', () => {
    let b = onTrack(560);
    const to = trailPoint('haul', 380);
    for (let i = 0; i < 4 / DT; i++) b = ride(b, to, 1);
    expect(bikeSpeed(b)).toBeGreaterThan(20);
  });

  it('flies off a ramp at speed, and rolls over it slowly', () => {
    const r = spec.ramps![1];
    const fly = (throttle: number) => {
      // line up 80 m before the ramp, on the track, heading over it
      const p = trailPoint('haul', 470 + 80);
      let b = newBike(p.x, p.z, trailYaw('haul', 550, true), ground(p.x, p.z));
      b.throttle = throttle;
      b.speed = throttle * 28;
      let peak = 0;
      let landed = 0;
      for (let i = 0; i < 6 / DT; i++) {
        b = ride(b, { x: r.x + (r.x - p.x), z: r.z + (r.z - p.z) }, throttle);
        peak = Math.max(peak, b.agl);
        landed = Math.max(landed, b.landed);
      }
      return { peak, landed };
    };
    const fast = fly(1);
    expect(fast.peak).toBeGreaterThan(1.5);
    expect(fast.landed).toBeGreaterThan(2);
    expect(fly(0.25).peak).toBeLessThan(0.3);
  });

  it('stops at the river: it never rides into deep water', () => {
    // from the forest track's south end, flat out at the river
    const p = trailPoint('foresttrack', 700);
    let b = newBike(p.x, p.z, 0, ground(p.x, p.z));
    let hit = false;
    for (let i = 0; i < 10 / DT; i++) {
      b = ride(b, { x: 470, z: 545 }, 1);
      expect(ground(b.x, b.z)).toBeGreaterThan(-0.6);
      hit ||= !!b.contact;
    }
    expect(hit).toBe(true);
  });
});

describe('Lost Hiker, the call', () => {
  it('puts her by her fire just off the forest track, under the canopy', () => {
    expect(trailAt(def.site.x, def.site.z)).toBe(0);
    expect(forestAt(def.site.x, def.site.z)).toBeGreaterThan(0.8);
    const p = trailPoint('foresttrack', 175);
    expect(Math.hypot(def.site.x - p.x, def.site.z - p.z)).toBeLessThan(12);
    expect(Math.hypot(def.site.x - def.search.x, def.site.z - def.search.z)).toBeLessThan(def.search.r);
  });

  it('sets the bike off and brings it home on the tracks, with arches and ramps on them', () => {
    expect(trailAt(spec.start.x, spec.start.z)).toBe(1);
    expect(trailAt(spec.home.x, spec.home.z)).toBe(1);
    for (const r of spec.ramps!) expect(trailAt(r.x, r.z)).toBe(1);
    const e = newEscape(def.escape!, ground);
    for (const g of e.gates) {
      expect(trailAt(g.x, g.z)).toBeGreaterThan(0.9);
      // an arch over the trail: its crown above the ground, its foot below
      expect(g.y - ground(g.x, g.z)).toBeGreaterThan(1);
      expect(g.y - ground(g.x, g.z)).toBeLessThan(g.r);
    }
    for (let i = 0; i < e.gates.length - 1; i++) {
      const d = Math.hypot(e.gates[i + 1].x - e.gates[i].x, e.gates[i + 1].z - e.gates[i].z);
      expect(d).toBeGreaterThan(40);
      expect(d).toBeLessThan(140);
    }
  });

  it('is flown with the Search Aircraft, the spotter and the beacon receiver', () => {
    const p = newProgress();
    p.done['mountain-rescue'] = { stars: 3, best: 200, rescues: 1 };
    const l = defaultLoadout(def, p);
    expect(l).toEqual({ vehicle: 'search-plane', crew: 'spotter', equipment: ['beacon'] });
  });

  it('plays through: find the smoke, ride in, she climbs on, out through the arches to the ambulance', () => {
    const plan = planOf(def, { vehicle: 'search-plane', crew: 'spotter', equipment: ['beacon'] });
    const r = newRun(def, plan);
    const ev: RunEvent[] = [];
    // the aircraft over the forest
    for (let i = 0; i < 1 / DT; i++) ev.push(...tickRun(r, { x: 200, y: 160, z: 300, agl: 60, speed: 40 }, DT, plan, false));
    for (let i = 0; i < 5 / DT; i++) ev.push(...tickRun(r, { x: def.site.x, y: 140, z: def.site.z + 150, agl: 60, speed: 40 }, DT, plan, false));
    expect(ev).toContain('signal');
    expect(ev).toContain('spotted');
    expect(ev).toContain('handoff');
    expect(objective(r, false).title).toBe('RIDE IN');
    // the bike, ridden by a simple rider: to her, stop; then the arches; then the ambulance
    let b = newBike(spec.start.x, spec.start.z, spec.start.yaw, ground(spec.start.x, spec.start.z));
    const gates = r.escape!.gates;
    let t = 0;
    let air = 0;
    while (r.stage !== 'complete' && t < 240) {
      const w = r.handoff!;
      let to: { x: number; z: number };
      let throttle = 1;
      if (r.stage === 'rescue') {
        to = def.site;
        throttle = Math.max(0, Math.min(1, (Math.hypot(to.x - b.x, to.z - b.z) - 4) / 50));
      } else if (r.escape!.next < gates.length) {
        const g = gates[r.escape!.next];
        to = { x: g.x + g.nx * 12, z: g.z + g.nz * 12 };
      } else {
        to = spec.home;
        throttle = Math.max(0, Math.min(1, (Math.hypot(to.x - b.x, to.z - b.z) - 3) / 60));
      }
      b = ride(b, to, throttle);
      if (b.agl > 0.5) air += DT;
      ev.push(...tickRun(r, { x: b.x, y: b.y, z: b.z, agl: b.agl, speed: bikeSpeed(b) }, DT, plan, false));
      if (r.stage === 'return' && canArrive(w, { x: b.x, z: b.z, speed: bikeSpeed(b) })) {
        expect(landAtPad(r)).toContain('complete');
      }
      t += DT;
    }
    expect(r.stage).toBe('complete');
    expect(ev).toContain('picked-up');
    expect(aboard(r) + r.survivors.filter((s) => s.state === 'delivered').length).toBe(1);
    expect(r.escape!.result.filter((x) => x === 'passed').length).toBeGreaterThanOrEqual(7);
    expect(air).toBeGreaterThan(0.5); // off the ramps
    expect(t).toBeLessThan(150);
    const rows = scoreRun(r).rows.map((x) => x.label);
    expect(rows).not.toContain('RAFT');
    expect(rows).not.toContain('HOIST');
    expect(rows).toContain('HANDLING');
    expect(PICKUP.bike.range).toBeLessThan(PICKUP.boat.range);
  });
});
