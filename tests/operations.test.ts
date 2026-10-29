/** RECON → EXECUTE → ESCAPE: the recon scan, the escape route, and the data behind them, checked against the real valley. */
import { describe, expect, it } from 'vitest';
import { MISSIONS, MISSION_BY_ID } from '../src/rescue/missions';
import { inView, newScan, SCAN_TIME, tickScan, type Contact } from '../src/rescue/recon';
import { escapeDone, gatesPassed, newEscape, offRouteDistance, tickEscape, type EscapeDef } from '../src/rescue/route';
import { defaultLoadout, planOf } from '../src/rescue/loadout';
import { newProgress } from '../src/rescue/progress';
import { newRun, objective, tickRun, escaping, type RunEvent } from '../src/rescue/run';
import { getHeightField, canyonDist } from '../src/world/terrain';
import { CANYON } from '../src/world/worldData';

const hf = getHeightField();
const ground = (x: number, z: number) => hf.sample(x, z);
const DT = 1 / 30;

describe('the escape route data', () => {
  // (the river run's arches sit on the water: tests/water.test.ts checks those)
  for (const m of MISSIONS.filter((x) => x.ready && x.escape && !x.water)) {
    it(`${m.id}: every gate stands clear of the ground, and the line between them can be flown`, () => {
      const e = newEscape(m.escape!, ground);
      expect(e.gates.length).toBeGreaterThanOrEqual(5);
      // the first gate is close to where you pick them up
      expect(Math.hypot(e.gates[0].x - m.site.x, e.gates[0].z - m.site.z)).toBeLessThan(140);
      for (const g of e.gates) expect(g.y - ground(g.x, g.z)).toBeGreaterThanOrEqual(g.r + 4);
      for (let i = 0; i < e.gates.length - 1; i++) {
        const a = e.gates[i];
        const b = e.gates[i + 1];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4);
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const y = a.y + (b.y - a.y) * t;
          expect(ground(x, z), `${m.id} gate ${i}→${i + 1}`).toBeLessThan(y - 4);
        }
        // gates are a rhythm, not a slalom: 50 to 140 m apart
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(50);
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(140);
      }
    });
  }

  it('the gorge gates run between the canyon walls, below the rim', () => {
    const m = MISSION_BY_ID['canyon-crash'];
    const e = newEscape(m.escape!, ground);
    // all but the exit gate (which climbs out over the quarry) are inside the walls
    for (const g of e.gates.slice(0, -2)) {
      expect(canyonDist(g.x, g.z).d).toBeLessThan(CANYON.floor + 8);
      expect(g.y).toBeLessThan(ground(g.x + 70, g.z));
    }
  });
});

const ROUTE: EscapeDef = {
  name: 'Test',
  reason: '',
  gates: [
    [0, 0, 20],
    [0, -100, 20],
    [0, -200, 20],
  ],
  r: 12,
  corridor: 50,
  par: 10,
};

describe('flying the escape', () => {
  const flat = () => 0;

  it('counts a gate when you fly through it, and a miss when you fly past it', () => {
    const e = newEscape(ROUTE, flat);
    const ev = [...tickEscape(e, { x: 0, y: 20, z: 20 }, 0, DT), ...tickEscape(e, { x: 0, y: 20, z: -5 }, 0.5, DT)];
    expect(ev).toContainEqual({ type: 'gate', index: 0 });
    // past the second gate, 30 m to the side
    ev.push(...tickEscape(e, { x: 30, y: 20, z: -95 }, 2, DT), ...tickEscape(e, { x: 30, y: 20, z: -105 }, 2.2, DT));
    expect(ev).toContainEqual({ type: 'gate-missed', index: 1 });
    // too high over the third
    ev.push(...tickEscape(e, { x: 0, y: 60, z: -195 }, 4, DT), ...tickEscape(e, { x: 0, y: 60, z: -205 }, 4.2, DT));
    expect(ev).toContainEqual({ type: 'gate-missed', index: 2 });
    expect(ev).toContainEqual({ type: 'escape-done' });
    expect(escapeDone(e)).toBe(true);
    expect(gatesPassed(e)).toBe(1);
    expect(e.result).toEqual(['passed', 'missed', 'missed']);
  });

  it('a gate is never missed from the far side of the valley', () => {
    const e = newEscape(ROUTE, flat);
    tickEscape(e, { x: 600, y: 20, z: 20 }, 0, DT);
    expect(tickEscape(e, { x: 600, y: 20, z: -20 }, 1, DT)).toEqual([]);
    expect(e.next).toBe(0);
  });

  it('flying the wrong way back through a gate does not count', () => {
    const e = newEscape(ROUTE, flat);
    tickEscape(e, { x: 0, y: 20, z: -10 }, 0, DT);
    expect(tickEscape(e, { x: 0, y: 20, z: 10 }, 1, DT)).toEqual([]);
  });

  it('straying off the route once it has started is noticed, and so is coming back', () => {
    const e = newEscape(ROUTE, flat);
    tickEscape(e, { x: 0, y: 20, z: 10 }, 0, DT);
    tickEscape(e, { x: 0, y: 20, z: -5 }, 0.2, DT);
    expect(tickEscape(e, { x: 120, y: 20, z: -60 }, 1, DT)).toContainEqual({ type: 'off-route' });
    expect(offRouteDistance(e, { x: 120, z: -60 })).toBeCloseTo(120, 0);
    expect(tickEscape(e, { x: 5, y: 20, z: -70 }, 2, DT)).toContainEqual({ type: 'on-route' });
    expect(e.offRoute).toBeGreaterThan(0);
  });
});

describe('recon: identify the right vehicle', () => {
  const contacts: Contact[] = [
    { x: 0, z: -150, kind: 'logtruck', label: 'TRUCK', clear: 'Not them.' },
    { x: 120, z: -100, kind: 'wreck', label: 'TRUCK', clear: '', target: true },
  ];

  it('looks along the nose: in range and in the cone, not behind or off to the side', () => {
    const s = newScan(contacts);
    expect(inView(contacts, s, { x: 0, z: 0, yaw: 0, agl: 50 })).toBe(0);
    expect(inView(contacts, s, { x: 0, z: 0, yaw: Math.PI, agl: 50 })).toBe(-1);
    expect(inView(contacts, s, { x: 0, z: 400, yaw: 0, agl: 50 })).toBe(-1);
    expect(inView(contacts, s, { x: 0, z: 0, yaw: 0, agl: 400 })).toBe(-1);
  });

  it('takes about a second of looking, then clears a decoy or finds the one', () => {
    const s = newScan(contacts);
    const p = { x: 0, z: 0, yaw: 0, agl: 50 };
    let ev = tickScan(contacts, s, p, SCAN_TIME * 0.5);
    expect(ev).toEqual([]);
    ev = tickScan(contacts, s, p, SCAN_TIME * 0.6);
    expect(ev).toEqual([{ type: 'cleared', index: 0 }]);
    // turn to the other one
    const q = { x: 0, z: 0, yaw: Math.atan2(-120, 100), agl: 50 };
    for (let t = 0; t < SCAN_TIME * 1.1; t += DT) ev.push(...tickScan(contacts, s, q, DT));
    expect(ev).toContainEqual({ type: 'found', index: 1 });
  });

  it('looking away lets the scan fade instead of finishing it later', () => {
    const s = newScan(contacts);
    tickScan(contacts, s, { x: 0, z: 0, yaw: 0, agl: 50 }, SCAN_TIME * 0.8);
    tickScan(contacts, s, { x: 0, z: 0, yaw: Math.PI, agl: 50 }, 1);
    expect(s.progress[0]).toBeLessThan(0.5);
  });
});

describe('the flagship: Canyon Crash, start to finish (state only)', () => {
  it('recon finds them only by identifying the wreck; everyone aboard turns the way home into the gorge escape', () => {
    const def = MISSION_BY_ID['canyon-crash'];
    const plan = planOf(def, defaultLoadout(def, newProgress()));
    const r = newRun(def, plan);
    const ev: RunEvent[] = [];
    const tick = (x: number, z: number, yaw: number, agl = 40, speed = 30) => ev.push(...tickRun(r, { x, z, y: ground(x, z) + agl, yaw, agl, speed }, DT, plan, false));
    tick(-800, 680, 0, 25);
    expect(r.stage).toBe('search');
    expect(objective(r, false, false, { x: -800, z: 680 }).title).toBe('FIND THE CRASHED TRUCK');
    // flying straight over the wreck at speed without looking at it (facing away) does not find it
    for (let i = 0; i < 30; i++) tick(def.site.x, def.site.z - 40, 0);
    expect(r.spotted).toBe(false);
    expect(ev).toContain('signal');
    // nose on the logging truck: cleared
    const lt = def.contacts![0];
    for (let i = 0; i < 45; i++) tick(lt.x, lt.z + 120, 0);
    expect(ev).toContain('cleared');
    expect(r.spotted).toBe(false);
    // nose on the wreck: found
    const w = def.contacts![2];
    for (let i = 0; i < 45; i++) tick(w.x, w.z + 120, 0);
    expect(ev).toContain('spotted');
    expect(r.stage).toBe('rescue');
    expect(r.foundAt).not.toBeNull();
    // both lifted (the hoist itself is covered elsewhere)
    for (const s of r.survivors) s.state = 'aboard';
    tick(def.site.x, def.site.z, 0, 20, 5);
    expect(r.stage).toBe('return');
    expect(escaping(r)).toBe(true);
    expect(objective(r, false).target?.kind).toBe('gate');
  });
});
