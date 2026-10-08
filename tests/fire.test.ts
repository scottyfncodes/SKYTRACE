/**
 * Wildfire missions, played through the pure modules: the fire spreads with
 * the wind and up the slopes, retardant lines stop it, water knocks it down,
 * and Mission Control's choice of aircraft decides how you fight it.
 */
import { describe, expect, it } from 'vitest';
import { BURNING, BURNT, breached, canReach, cellAt, createFire, dropRetardant, dropWater, fireStats, frontDistance, stepFire, timeToReach, UNBURNT, OUT, type FireSpec } from '../src/fire/fireSim';
import { canFireAction, CALL_DELAY, CALL_LEN, fireAction, LINE_LEN, RELOAD, SCOOP_TIME, waterUnder } from '../src/fire/fireRun';
import { canLaunch, checkLoadout, defaultLoadout, planOf, type Loadout } from '../src/rescue/loadout';
import { MISSIONS, MISSION_BY_ID, type MissionDef } from '../src/rescue/missions';
import { isAvailable, newProgress, recordRescue } from '../src/rescue/progress';
import { canHoist, fireHead, newRun, objective, tickRun, type RunEvent, type RunState } from '../src/rescue/run';
import { debrief } from '../src/rescue/debrief';
import { windAt } from '../src/rescue/wind';
import { VEHICLE_BY_ID } from '../src/rescue/catalog';

const DT = 0.1;

const flat = { height: () => 20, forest: () => 1 };
const spec = (o: Partial<FireSpec> = {}): FireSpec => ({ area: { x: 0, z: 0, size: 640 }, ignitions: [{ x: 0, z: -200, r: 15 }], threats: [{ name: 'Town', icon: '🏘️', x: 0, z: 250, r: 30 }], spread: 1, embers: 0, head: 0, ...o });
const south = { x: 0, z: 8 };

// ------------------------------------------------------------------ a pilot for the tests
interface Pilot {
  run: RunState;
  x: number;
  z: number;
  agl: number;
  speed: number;
  vx: number;
  vz: number;
  ev: RunEvent[];
}

function launch(def: MissionDef, l: Loadout): Pilot {
  const plan = planOf(def, l);
  const run = newRun(def, plan);
  const p: Pilot = { run, x: -800, z: 680, agl: 30, speed: 0, vx: 0, vz: 0, ev: [] };
  step(p, DT);
  return p;
}

const over = (p: Pilot) => p.run.stage === 'complete' || p.run.stage === 'failed';

function step(p: Pilot, dt: number): void {
  p.ev.push(...tickRun(p.run, { x: p.x, z: p.z, agl: p.agl, speed: p.speed, vx: p.vx, vz: p.vz }, dt, { spotMult: 1 }, false));
}

/** Fly straight to (x, z) at `speed`, `agl` over the ground. */
function flyTo(p: Pilot, x: number, z: number, speed: number, agl: number): void {
  p.agl = agl;
  for (let i = 0; i < 4000 && !over(p); i++) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < 2) break;
    const s = Math.min(speed, d / DT);
    p.vx = ((x - p.x) / d) * s;
    p.vz = ((z - p.z) / d) * s;
    p.speed = s;
    p.x += p.vx * DT;
    p.z += p.vz * DT;
    step(p, DT);
  }
  p.vx = p.vz = 0;
}

function wait(p: Pilot, seconds: number): void {
  for (let t = 0; t < seconds && !over(p); t += DT) step(p, DT);
}

/** Lay a line of `len` across the wind, `gap` ahead of the head of the fire toward its nearest threat. */
function lineAhead(p: Pilot, gap: number, offset = 0, aimAt?: { x: number; z: number }, toward?: { x: number; z: number }, len = LINE_LEN): void {
  const ops = p.run.ops!;
  const head = aimAt ?? fireHead(ops)!;
  const th = toward ?? ops.spec.threats.reduce((a, b) => (Math.hypot(b.x - head.x, b.z - head.z) < Math.hypot(a.x - head.x, a.z - head.z) ? b : a));
  const d = Math.hypot(th.x - head.x, th.z - head.z);
  const ux = (th.x - head.x) / d;
  const uz = (th.z - head.z) / d;
  const cx = head.x + ux * gap - uz * offset;
  const cz = head.z + uz * gap + ux * offset;
  const half = len / 2;
  flyTo(p, cx + uz * (half + 60), cz - ux * (half + 60), 60, 60);
  flyTo(p, cx + uz * half, cz - ux * half, 50, 60);
  // press DROP as soon as it lights up, and fly the line
  const ex = cx - uz * (half + 40);
  const ez = cz + ux * (half + 40);
  let started = false;
  for (let i = 0; i < 40 && !over(p); i++) {
    if (!started) {
      const e = fireAction(ops, { x: p.x, z: p.z, agl: p.agl, speed: p.speed }, p.run.t);
      started = e.length > 0;
      p.ev.push(...e);
    }
    const t = (i + 1) / 40;
    flyTo(p, cx + uz * half + (ex - cx - uz * half) * t, cz - ux * half + (ez - cz + ux * half) * t, 50, 60);
  }
}

function fillBucket(p: Pilot): void {
  const ops = p.run.ops!;
  const w = ops.spec.water[0];
  flyTo(p, w.x, w.z, 50, 12);
  p.speed = 3;
  for (let i = 0; i < 400 && ops.load === 0 && !over(p); i++) step(p, DT);
}

function bucketOn(p: Pilot, at: { x: number; z: number }): void {
  flyTo(p, at.x, at.z, 50, 30);
  p.speed = 2;
  p.ev.push(...fireAction(p.run.ops!, { x: p.x, z: p.z, agl: p.agl, speed: p.speed }, p.run.t));
  wait(p, 1.5);
}

/** Bucket after bucket on the head of the fire until it is over. */
function waterUntilDone(p: Pilot, limit = 600): void {
  while (!over(p) && p.run.t < limit) {
    if (p.run.ops!.load === 0) fillBucket(p);
    const head = fireHead(p.run.ops!);
    if (!head) {
      wait(p, 2);
      continue;
    }
    bucketOn(p, head);
  }
}

const L = (vehicle: Loadout['vehicle'], crew: Loadout['crew'] = 'winch', equipment: Loadout['equipment'] = []): Loadout => ({ vehicle, crew, equipment });

// ------------------------------------------------------------------ the fire
describe('the fire', () => {
  it('spreads, burns out behind its front, and leaves ash', () => {
    const f = createFire(spec(), flat);
    const s0 = fireStats(f);
    for (let t = 0; t < 120; t++) stepFire(f, { x: 0, z: 0 }, 1);
    const s1 = fireStats(f);
    expect(s1.burning + s1.burnt).toBeGreaterThan((s0.burning + s0.burnt) * 5);
    expect(s1.burnt).toBeGreaterThan(0);
    expect(f.state[cellAt(f, 0, -200)]).toBe(BURNT);
  });

  it('runs with the wind: much faster downwind than upwind', () => {
    const f = createFire(spec({ ignitions: [{ x: 0, z: 0, r: 15 }], threats: [] }), flat);
    for (let t = 0; t < 90; t++) stepFire(f, south, 1);
    let down = 0;
    let up = 0;
    for (let z = 0; z < 320; z += 5) if (f.state[cellAt(f, 0, z)] !== UNBURNT) down = z;
    for (let z = 0; z > -320; z -= 5) if (f.state[cellAt(f, 0, z)] !== UNBURNT) up = -z;
    expect(down).toBeGreaterThan(up * 2.5);
  });

  it('runs uphill faster than down', () => {
    const slope = { height: (_x: number, z: number) => 100 - z * 0.3, forest: () => 1 };
    const f = createFire(spec({ ignitions: [{ x: 0, z: 0, r: 15 }], threats: [] }), slope);
    for (let t = 0; t < 90; t++) stepFire(f, { x: 0, z: 0 }, 1);
    let upslope = 0;
    let downslope = 0;
    for (let z = 0; z > -320; z -= 5) if (f.state[cellAt(f, 0, z)] !== UNBURNT) upslope = -z;
    for (let z = 0; z < 320; z += 5) if (f.state[cellAt(f, 0, z)] !== UNBURNT) downslope = z;
    expect(upslope).toBeGreaterThan(downslope * 1.5);
  });

  it('does not cross water', () => {
    const river = { height: (_x: number, z: number) => (Math.abs(z) < 20 ? -3 : 20), forest: () => 1 };
    const f = createFire(spec({ ignitions: [{ x: 0, z: -100, r: 15 }] }), river);
    for (let t = 0; t < 400; t++) stepFire(f, south, 1);
    expect(f.state[cellAt(f, 0, 100)]).toBe(UNBURNT);
    expect(canReach(f, f.spec.threats[0])).toBe(false);
  });

  it('is deterministic', () => {
    const run = () => {
      const f = createFire(spec({ embers: 2 }), flat);
      for (let t = 0; t < 100; t++) stepFire(f, { x: 0, z: 12 }, 1);
      return Array.from(f.state).join('');
    };
    expect(run()).toBe(run());
  });

  it('reaches the town if nobody stops it, and says when', () => {
    const f = createFire(spec(), flat);
    const eta = timeToReach(f, f.spec.threats[0], south)!;
    expect(eta).toBeGreaterThan(30);
    for (let t = 0; t < eta + 2; t++) stepFire(f, south, 1);
    expect(breached(f, f.spec.threats[0])).toBe(true);
  });
});

describe('retardant and water', () => {
  it('a retardant line across the whole front stops it dead: contained', () => {
    const f = createFire(spec(), flat);
    for (let t = 0; t < 20; t++) stepFire(f, south, 1);
    expect(canReach(f, f.spec.threats[0])).toBe(true);
    dropRetardant(f, -330, 0, 330, 0, 40);
    expect(canReach(f, f.spec.threats[0])).toBe(false);
    for (let t = 0; t < 400; t++) stepFire(f, south, 1);
    expect(breached(f, f.spec.threats[0])).toBe(false);
    expect(f.state[cellAt(f, 0, 100)]).toBe(UNBURNT);
    // the front ran into the line and stopped there
    expect(f.held.some((h) => h === 1)).toBe(true);
  });

  it('a short line slows the head, and the fire runs round its ends', () => {
    const run = (line: boolean) => {
      const f = createFire(spec(), flat);
      for (let t = 0; t < 20; t++) stepFire(f, south, 1);
      if (line) dropRetardant(f, -110, 0, 110, 0, 40);
      for (let t = 0; t < 900; t++) {
        stepFire(f, south, 1);
        if (breached(f, f.spec.threats[0])) return t;
      }
      return 900;
    };
    const none = run(false);
    const short = run(true);
    expect(short).toBeGreaterThan(none + 20);
    expect(short).toBeLessThan(900);
  });

  it('water puts out what it lands on and wets the ground around it', () => {
    const f = createFire(spec({ ignitions: [{ x: 0, z: 0, r: 20 }] }), flat);
    stepFire(f, { x: 0, z: 0 }, 2);
    const before = fireStats(f).burning;
    expect(before).toBeGreaterThan(10);
    dropWater(f, 0, 0, 30);
    expect(fireStats(f).burning).toBe(0);
    expect(f.state[cellAt(f, 0, 0)]).toBe(OUT);
    expect(f.wet[cellAt(f, 25, 0)]).toBeGreaterThan(0.3);
  });

  it('embers start spot fires ahead of the front in a strong wind, but not across a line', () => {
    const f = createFire(spec({ embers: 3, ignitions: [{ x: 0, z: -250, r: 30 }] }), flat);
    for (let t = 0; t < 120; t++) stepFire(f, { x: 0, z: 12 }, 1);
    expect(f.spots.length).toBeGreaterThan(0);
    const g = createFire(spec({ embers: 3, ignitions: [{ x: 0, z: -250, r: 30 }] }), flat);
    dropRetardant(g, -330, -150, 330, -150, 40);
    for (let t = 0; t < 300; t++) stepFire(g, { x: 0, z: 12 }, 1);
    for (const s of g.spots) expect(s.z).toBeLessThan(-150);
  });
});

// ------------------------------------------------------------------ Mission Control
describe('Mission Control on a fire', () => {
  const fires = MISSIONS.filter((m) => m.fire && m.ready);

  it('there are wildfire calls of every kind, and the first two are open from the start', () => {
    expect(fires.map((m) => m.fire!.kind)).toEqual(expect.arrayContaining(['Small fire', 'Wind-driven', 'Uphill', '3 hotspots', 'Fire + rescue']));
    const p = newProgress();
    expect(isAvailable(p, MISSION_BY_ID['spot-fire'])).toBe(true);
    expect(isAvailable(p, MISSION_BY_ID['wind-fire'])).toBe(true);
    expect(isAvailable(p, MISSION_BY_ID['hotspots'])).toBe(false);
    expect(isAvailable(p, VEHICLE_BY_ID.tanker)).toBe(true);
    expect(isAvailable(p, VEHICLE_BY_ID['fire-heli'])).toBe(true);
    expect(isAvailable(p, VEHICLE_BY_ID['spotter-plane'])).toBe(false);
  });

  it('every fire starts away from what it threatens, and would reach it before the crews arrive', () => {
    for (const def of fires) {
      const run = newRun(def, planOf(def, defaultLoadout(def, newProgress())));
      const f = run.ops!.fire;
      for (const th of def.fire!.threats) expect(frontDistance(f, th), `${def.id} ${th.name}`).toBeGreaterThan(40);
      expect(def.fire!.threats.some((th) => canReach(f, th)), def.id).toBe(true);
      const eta = Math.min(...def.fire!.threats.map((th) => timeToReach(f, th, windAt(def.wind, 0), 700) ?? Infinity));
      if (def.fire!.hold > 0) expect(eta, def.id).toBeLessThan(def.fire!.hold);
      expect(eta, def.id).toBeGreaterThan(90);
      expect(def.fire!.water.length).toBeGreaterThan(0);
    }
  });

  it('picks a different aircraft for different fires', () => {
    expect(MISSION_BY_ID['spot-fire'].recommended.vehicle).toBe('fire-heli');
    expect(MISSION_BY_ID['wind-fire'].recommended.vehicle).toBe('tanker');
    expect(MISSION_BY_ID['hotspots'].recommended.vehicle).toBe('spotter-plane');
  });

  it('a rescue helicopter with no bucket cannot fight a fire; with the bucket it can', () => {
    const def = MISSION_BY_ID['spot-fire'];
    expect(canLaunch(def, L('rescue-heli', 'winch', ['basket']))).toBe(false);
    expect(checkLoadout(def, L('rescue-heli', 'winch', ['basket'])).some((n) => n.blocking && /fire/i.test(n.text))).toBe(true);
    expect(canLaunch(def, L('rescue-heli', 'winch', ['bucket']))).toBe(true);
    expect(planOf(def, L('rescue-heli', 'winch', ['bucket'])).attack).toBe('water');
  });

  it('the aircraft fight fire differently, and Pre-Flight says how', () => {
    const def = MISSION_BY_ID['wind-fire'];
    const tanker = planOf(def, L('tanker'));
    const heli = planOf(def, L('fire-heli'));
    const spot = planOf(def, L('spotter-plane'));
    expect([tanker.attack, heli.attack, spot.attack]).toEqual(['retardant', 'water', 'lead']);
    expect(tanker.kind).toBe('plane');
    expect(heli.kind).toBe('helicopter');
    expect(spot.forecast).toBe(true);
    expect(tanker.forecast).toBe(false);
    expect(planOf(def, L('tanker', 'spotter')).forecast).toBe(true);
    expect(VEHICLE_BY_ID.tanker.perf!.turnGain).toBeLessThan(VEHICLE_BY_ID['spotter-plane'].perf!.turnGain);
    expect(checkLoadout(def, L('tanker')).find((n) => n.info)?.text).toMatch(/retardant/);
    expect(checkLoadout(def, L('fire-heli')).some((n) => !n.info && /bucket/.test(n.text))).toBe(true);
    expect(checkLoadout(MISSION_BY_ID['mountain-fire'], L('tanker')).some((n) => /steep/i.test(n.text))).toBe(true);
  });

  it('fire + rescue needs the hoist; going without water is allowed but flagged', () => {
    const def = MISSION_BY_ID['forest-fire'];
    expect(canLaunch(def, L('tanker'))).toBe(false);
    expect(canLaunch(def, L('rescue-heli', 'medic', ['basket']))).toBe(true);
    expect(checkLoadout(def, L('rescue-heli', 'medic', ['basket'])).map((n) => n.text).join(' ')).toMatch(/racing the fire/);
    expect(canLaunch(def, L('fire-heli', 'medic', ['basket']))).toBe(true);
  });
});

describe('progression across the two families', () => {
  it('after a fire, NEXT offers another fire; rescue progression is unchanged', async () => {
    const { nextMission } = await import('../src/rescue/progress');
    const p = newProgress();
    expect(nextMission(p).id).toBe('mountain-rescue');
    recordRescue(p, 'spot-fire', { stars: 2, time: 120, rescued: 0 }, L('fire-heli'));
    expect(nextMission(p, MISSION_BY_ID['spot-fire']).id).toBe('wind-fire');
    expect(nextMission(p, MISSION_BY_ID['mountain-rescue']).id).toBe('mountain-rescue');
    // finishing a fire opens the fire + rescue call
    expect(isAvailable(p, MISSION_BY_ID['forest-fire'])).toBe(true);
    expect(p.saved).toBe(0);
  });
});

// ------------------------------------------------------------------ loads
describe('loads: retardant, water and tanker calls run out', () => {
  it('the tanker carries two lines, then has to reload at the airfield', () => {
    const p = launch(MISSION_BY_ID['wind-fire'], L('tanker'));
    const ops = p.run.ops!;
    expect(ops.load).toBe(2);
    lineAhead(p, 120);
    expect(p.ev).toContain('line-laid');
    expect(ops.load).toBe(1);
    lineAhead(p, 120, LINE_LEN - 20);
    expect(ops.load).toBe(0);
    expect(p.ev).toContain('empty');
    const where = { x: p.x, z: p.z, agl: 60, speed: 50 };
    expect(canFireAction(ops, where)).toEqual({ ok: false, why: 'TANKS EMPTY' });
    expect(objective(p.run, false, false, p).title).toMatch(/RELOAD/);
    // too high over the airfield: nothing
    flyTo(p, RELOAD.x, RELOAD.z, 70, 200);
    wait(p, 4);
    expect(ops.load).toBe(0);
    p.agl = 40;
    wait(p, 4);
    expect(p.ev).toContain('reloaded');
    expect(ops.load).toBe(2);
  });

  it('too high, or away from the fire, the drop button does nothing', () => {
    const p = launch(MISSION_BY_ID['wind-fire'], L('tanker'));
    const ops = p.run.ops!;
    expect(canFireAction(ops, { x: -800, z: 680, agl: 60, speed: 50 }).ok).toBe(false);
    expect(canFireAction(ops, { x: 250, z: -120, agl: 400, speed: 50 })).toEqual({ ok: false, why: 'TOO HIGH' });
    expect(canFireAction(ops, { x: 250, z: -120, agl: 120, speed: 50 }).ok).toBe(true);
    expect(fireAction(ops, { x: -800, z: 680, agl: 60, speed: 50 }, 0)).toEqual([]);
    expect(ops.load).toBe(2);
  });

  it('the bucket empties with one drop and fills again low and slow over water', () => {
    const p = launch(MISSION_BY_ID['spot-fire'], L('fire-heli'));
    const ops = p.run.ops!;
    bucketOn(p, fireHead(ops)!);
    expect(ops.load).toBe(0);
    expect(p.ev).toContain('water-hit');
    expect(objective(p.run, false, false, p).title).toBe('FILL THE BUCKET');
    const w = ops.spec.water[0];
    expect(waterUnder(ops, w)).toBeTruthy();
    // fast over the river: no water
    flyTo(p, w.x, w.z, 50, 12);
    p.speed = 30;
    wait(p, SCOOP_TIME + 1);
    expect(ops.load).toBe(0);
    p.speed = 4;
    const t0 = p.run.t;
    wait(p, SCOOP_TIME + 0.5);
    expect(ops.load).toBe(1);
    expect(p.ev).toContain('full');
    expect(p.run.t - t0).toBeGreaterThanOrEqual(SCOOP_TIME - 0.2);
  });

  it('the winch operator fills the bucket twice as fast', () => {
    const def = MISSION_BY_ID['spot-fire'];
    expect(newRun(def, planOf(def, L('fire-heli', 'winch'))).ops!.fillTime).toBeCloseTo(newRun(def, planOf(def, L('fire-heli', 'medic'))).ops!.fillTime / 2);
  });

  it('the spotter marks a line and Tanker 42 drops it later; three calls', () => {
    const p0 = newProgress();
    recordRescue(p0, 'wind-fire', { stars: 1, time: 1, rescued: 0 }, L('tanker'));
    const def = MISSION_BY_ID['hotspots'];
    expect(defaultLoadout(def, p0).vehicle).toBe('spotter-plane');
    const p = launch(def, L('spotter-plane', 'spotter'));
    const ops = p.run.ops!;
    expect(ops.load).toBe(3);
    lineAhead(p, 70, 0, undefined, undefined, CALL_LEN);
    expect(p.ev).toContain('marked');
    expect(ops.load).toBe(2);
    const call = ops.calls[0];
    expect(call.painted).toBe(0);
    // nothing on the ground yet
    const mid = call.pts[Math.floor(call.pts.length / 2)];
    expect(ops.fire.retardant[cellAt(ops.fire, mid[0], mid[1])]).toBe(0);
    wait(p, CALL_DELAY + call.len / 50);
    expect(p.ev).toContain('tanker-drop');
    expect(call.painted).toBeCloseTo(call.len);
    expect(ops.fire.retardant[cellAt(ops.fire, mid[0], mid[1])]).toBeGreaterThan(0.5);
    lineAhead(p, 70, 0, undefined, undefined, CALL_LEN);
    lineAhead(p, 70, 0, undefined, undefined, CALL_LEN);
    expect(ops.load).toBe(0);
    expect(canFireAction(ops, { x: 230, z: -140, agl: 60, speed: 50 }).why).toBe('NO CALLS LEFT');
  });
});

// ------------------------------------------------------------------ whole missions
describe('wildfire missions, flown', () => {
  it('Keld Forest Fire: left alone, it burns Ashby and the mission fails', () => {
    const p = launch(MISSION_BY_ID['wind-fire'], L('tanker'));
    flyTo(p, 250, -120, 60, 200);
    wait(p, 400);
    expect(p.run.stage).toBe('failed');
    expect(p.ev).toContain('breached');
    expect(p.run.failReason).toMatch(/Ashby/);
    const d = debrief(p.run);
    expect(d.success).toBe(false);
    expect(d.stars).toBe(0);
  });

  it('Keld Forest Fire: two tanker lines across the head hold it until the crews arrive', () => {
    const p = launch(MISSION_BY_ID['wind-fire'], L('tanker'));
    const head = fireHead(p.run.ops!)!;
    lineAhead(p, 140, -LINE_LEN / 2 + 15, head);
    lineAhead(p, 140, LINE_LEN / 2 - 15, head);
    expect(p.run.ops!.load).toBe(0);
    wait(p, 400);
    expect(p.run.stage).toBe('complete');
    expect(p.ev).toContain('line-holding');
    expect(p.ev).toContain('held');
    const d = debrief(p.run);
    expect(d.success).toBe(true);
    expect(d.headline).toMatch(/FIRE (HELD|CONTAINED)/);
    expect(d.lines[0].text).toMatch(/Ashby is safe/);
    // the consequence: less forest burned than without you
    expect(d.lines[1].text).toMatch(/without you/);
    expect(d.stars).toBeGreaterThanOrEqual(2);
  });

  it('Lightning Strike: bucket after bucket from the fire helicopter puts it out', () => {
    const p = launch(MISSION_BY_ID['spot-fire'], L('fire-heli'));
    waterUntilDone(p);
    expect(p.run.stage).toBe('complete');
    expect(p.run.ops!.outcome).toBe('contained');
    expect(debrief(p.run).headline).toBe('FIRE CONTAINED');
    expect(p.run.t).toBeLessThan(MISSION_BY_ID['spot-fire'].fire!.hold);
  });

  it('Mountain Fire: the helicopter keeps it off the hut', () => {
    const p = launch(MISSION_BY_ID['mountain-fire'], L('fire-heli', 'winch'));
    waterUntilDone(p);
    expect(p.run.stage).toBe('complete');
  });

  it('Dry Lightning: a called line between each fire and what it threatens saves all three places', () => {
    const p = launch(MISSION_BY_ID['hotspots'], L('spotter-plane', 'spotter'));
    const ops = p.run.ops!;
    // the most urgent first: the spotter's forecast says which place the fire reaches first
    const eta = (th: (typeof ops.spec.threats)[number]) => timeToReach(ops.fire, th, windAt(MISSION_BY_ID['hotspots'].wind, 0), 600) ?? 999;
    const order = [...ops.spec.threats].sort((a, b) => eta(a) - eta(b));
    for (const th of order) {
      const f = ops.fire;
      let near = { x: th.x, z: th.z - 100 };
      let bd = Infinity;
      for (let k = 0; k < f.state.length; k++) {
        if (f.state[k] !== BURNING) continue;
        const x = f.x0 + ((k % f.n) + 0.5) * f.cell;
        const z = f.z0 + (Math.floor(k / f.n) + 0.5) * f.cell;
        const d = Math.hypot(x - th.x, z - th.z);
        if (d < bd) {
          bd = d;
          near = { x, z };
        }
      }
      // a line across the gap, just short of the place itself
      lineAhead(p, Math.max(20, bd - th.r - 40), 0, near, th, CALL_LEN);
    }
    expect(p.ev.filter((e) => e === 'marked')).toHaveLength(3);
    wait(p, 400);
    expect(p.run.failReason).toBeNull();
    expect(p.run.stage).toBe('complete');
  });

  it('Trapped by Fire: quick hoisting gets them out; dawdle and the fire gets there first', () => {
    const def = MISSION_BY_ID['forest-fire'];
    const slow = launch(def, L('fire-heli', 'medic', ['basket']));
    flyTo(slow, def.site.x, def.site.z, 50, 30);
    wait(slow, 300);
    expect(slow.run.stage).toBe('failed');
    expect(slow.run.failReason).toMatch(/hikers/);
    const quick = launch(def, L('fire-heli', 'medic', ['basket']));
    flyTo(quick, def.site.x, def.site.z, 50, 30);
    expect(quick.run.spotted).toBe(true);
    quick.speed = 5;
    expect(canHoist(quick.run, { x: quick.x, z: quick.z, agl: 30, speed: 5 }).ok).toBe(true);
    // everyone up into the cabin (the hoist itself is tested with the rescues)
    for (const s of quick.run.survivors) s.state = 'aboard';
    wait(quick, 200);
    expect(quick.run.stage).toBe('return');
    expect(quick.run.failReason).toBeNull();
  });

  it('a successful drop visibly changes the situation: ash and red line on the map, fire stopped short', () => {
    const p = launch(MISSION_BY_ID['wind-fire'], L('tanker'));
    const head = fireHead(p.run.ops!)!;
    lineAhead(p, 140, -LINE_LEN / 2 + 15, head);
    lineAhead(p, 140, LINE_LEN / 2 - 15, head);
    wait(p, 120);
    const f = p.run.ops!.fire;
    const shadow = p.run.ops!.shadow;
    expect(fireStats(f).spread).toBeLessThan(fireStats(shadow).spread);
    expect(f.retardant.some((r) => r > 0.5)).toBe(true);
  });
});
