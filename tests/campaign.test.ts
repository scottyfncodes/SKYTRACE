/**
 * The case file as a campaign: five operations on one engine, the phases
 * answering each other, and the pass flown every way it can go.
 */
import { describe, expect, it } from 'vitest';
import { DECOYS, DEFAULT_RETURNS, rollReturns, type ReturnDef } from '../src/mission/mission01';
import { OPERATIONS, operationFor } from '../src/mission/operations';
import { cleanOperation, clockNote, escapePressure, FIRST_RING_FAST, FIRST_RING_SLOW, firstRingScale, MISS_HAZE, planExecute, RING_BY_RANK } from '../src/operation/consequence';
import { CONTACT_PACE, CONTACT_SLACK, onClock, planDropRun, retargetRing, rings, ringScale, startWindow, tickLeg } from '../src/operation/gates';
import { capabilities, defaultLoadout } from '../src/operation/loadout';
import { activeLeg, beginExecute, beginReturn, launch, newOperation, tickOperation } from '../src/operation/operation';
import { CASE_FILE } from '../src/operation/story';
import { newBoard } from '../src/control/board';
import { spawnLook, SPAWN_SECONDS } from '../src/mission/missionScene';
import { boardStep } from '../src/ui/missionBoard';
import { threadRings } from './helpers';

const cap = capabilities(defaultLoadout());
const flat = () => 0;
const within = (s: string, n: number) => expect(s.length, `"${s}" is ${s.length} chars (budget ${n})`).toBeLessThanOrEqual(n);
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('the operations: one per page, each pushed further', () => {
  it('one operation per line of the case file, in order, on the same world', () => {
    expect(OPERATIONS).toHaveLength(CASE_FILE.length);
    OPERATIONS.forEach((o, i) => {
      expect(o.page).toBe(i);
      expect(o.story.hook).toBe(CASE_FILE[i]);
      expect(o.operations.area).toBe(OPERATIONS[0].operations.area);
      expect(o.outbound).toBe(OPERATIONS[0].outbound);
      expect(o.control.corridors).toBe(OPERATIONS[0].control.corridors);
    });
    expect(new Set(OPERATIONS.map((o) => o.id)).size).toBe(OPERATIONS.length);
    expect(operationFor(-3)).toBe(OPERATIONS[0]);
    expect(operationFor(99)).toBe(OPERATIONS[OPERATIONS.length - 1]);
  });

  it('every page reads at a glance', () => {
    for (const o of OPERATIONS) {
      within(o.story.hook, 70);
      within(o.title, 18);
      for (const p of ['recon', 'execute', 'escape'] as const) {
        within(o.story[p].title, 18);
        within(o.story[p].line, 44);
        within(o.story.verbs[p], 8);
      }
      within(o.execute.done.kicker, 16);
      within(o.execute.missed.kicker, 16);
      within(o.escape.reaction.tagged, 28);
      within(o.escape.reaction.missed, 28);
      expect(o.risks).toHaveLength(3);
    }
  });

  it('the board clock gets shorter and the tower lies more as the pages turn', () => {
    const seconds = OPERATIONS.map((o) => o.control.seconds);
    for (let i = 1; i < seconds.length; i++) expect(seconds[i]).toBeLessThanOrEqual(seconds[i - 1]);
    expect(seconds[0]).toBeGreaterThan(seconds[seconds.length - 1]);
    expect(OPERATIONS[0].control.wrongForecasts ?? 1).toBe(1);
    expect(OPERATIONS[OPERATIONS.length - 1].control.wrongForecasts).toBe(2);
  });

  it('EXECUTE and ESCAPE escalate: the ring never grows, the clocks never loosen, the last page has it all', () => {
    const first = OPERATIONS[0];
    const last = OPERATIONS[OPERATIONS.length - 1];
    for (const o of OPERATIONS) {
      expect(o.execute.r).toBeLessThanOrEqual(first.execute.r);
      expect(o.escape.pace).toBeLessThanOrEqual(first.escape.pace);
      expect(o.execute.agl).toBeGreaterThanOrEqual(20);
    }
    expect(last.execute.halt).toBe('never');
    expect(last.execute.window).toBeGreaterThan(0);
    expect(last.escape.contact).toBe(true);
    expect(last.escape.visibility).toBeLessThan(1);
    // the archetypes the pages prove: a halt, a rolling target, a window, a skim
    expect(OPERATIONS.map((o) => o.execute.halt)).toContain('never');
    expect(OPERATIONS.some((o) => o.execute.window > 0)).toBe(true);
    expect(OPERATIONS.some((o) => !o.execute.drops && o.execute.agl < 30)).toBe(true);
  });

  it('the tower misplaces as many storms as the page says', () => {
    for (let seed = 1; seed < 20; seed++) {
      for (const o of OPERATIONS) {
        const b = newBoard(o.control, DEFAULT_RETURNS, ['radar', 'optical'], seeded(seed));
        const liars = Object.values(b.cells).filter((c) => c.truth === 'storm' && c.forecast === 'clear').length;
        expect(liars).toBe(o.control.wrongForecasts ?? 1);
        // never a storm forecast on a stretch that is one, never two forecasts on one stretch
        expect(Object.values(b.cells).filter((c) => c.forecast === 'storm').length).toBe(2);
      }
    }
  });
});

describe('RECON answers EXECUTE', () => {
  const X = OPERATIONS[0].execute;

  it('the rank sizes the ring; a confirmed target pulls over, a hunch keeps rolling', () => {
    const ace = planExecute(X, { rank: 'ACE', confirmed: true });
    expect(ace.r).toBe(X.r);
    expect(ace.halts).toBe(true);
    expect(ace.line).toMatch(/pulls over/i);
    const hunch = planExecute(X, { rank: 'SOLID', confirmed: false });
    expect(hunch.halts).toBe(false);
    expect(hunch.line).toMatch(/rolling/i);
    expect(hunch.r).toBe(Math.round(X.r * RING_BY_RANK.SOLID));
    const scramble = planExecute(X, { rank: 'SCRAMBLE', confirmed: true });
    expect(scramble.r).toBeLessThan(hunch.r);
    expect(scramble.r).toBeGreaterThanOrEqual(24); // still a ring you can fly
    for (const l of [ace.line!, hunch.line!]) within(l, 44);
  });

  it('a page that never halts, or always does, says nothing about it; no board means the authored ring', () => {
    expect(planExecute({ ...X, halt: 'never' }, { rank: 'ACE', confirmed: true })).toMatchObject({ halts: false, line: null });
    expect(planExecute({ ...X, halt: 'always' }, { rank: 'ACE', confirmed: false })).toMatchObject({ halts: true, line: null });
    expect(planExecute(X, null)).toMatchObject({ r: X.r, halts: false });
  });

  it('every page: the plan keeps the ring flyable at every rank', () => {
    for (const o of OPERATIONS) for (const rank of ['ACE', 'SOLID', 'ROUGH', 'SCRAMBLE'] as const) expect(planExecute(o.execute, { rank, confirmed: false }).r).toBeGreaterThanOrEqual(22);
  });
});

describe('EXECUTE answers ESCAPE', () => {
  const E = OPERATIONS[0].escape;
  const exit = { contactFromStart: false, visibility: 0.7 };

  it('a pass made is the plan Mission Control built', () => {
    expect(escapePressure(E, 'tagged', exit)).toEqual({ contact: false, visibility: 0.7, pace: E.pace, line: null });
  });

  it('a pass missed was seen: radar from the first ring and a shade less to see by', () => {
    const p = escapePressure(E, 'missed', exit);
    expect(p.contact).toBe(true);
    expect(p.visibility).toBeCloseTo(0.7 - MISS_HAZE, 5);
    expect(p.line).toMatch(/radar/i);
    within(p.line!, 44);
  });

  it('no target at all: they know you are here anyway', () => {
    const p = escapePressure(E, 'skipped', exit);
    expect(p.contact).toBe(true);
    expect(p.visibility).toBe(0.7);
    within(p.line!, 44);
  });

  it('the page can demand contact and cap the weather; the board can only make it worse', () => {
    const hard = OPERATIONS[OPERATIONS.length - 1].escape;
    const p = escapePressure(hard, 'tagged', { contactFromStart: false, visibility: 0.9 });
    expect(p.contact).toBe(true);
    expect(p.visibility).toBe(hard.visibility);
    expect(escapePressure(E, 'tagged', { contactFromStart: true, visibility: 0.4 })).toMatchObject({ contact: true, visibility: 0.4 });
    expect(escapePressure(E, 'missed', { contactFromStart: false, visibility: 0.35 }).visibility).toBeGreaterThanOrEqual(0.3);
  });

  it('a clean operation is found, passed and home', () => {
    expect(cleanOperation(true, 'tagged')).toBe(true);
    expect(cleanOperation(true, 'missed')).toBe(false);
    expect(cleanOperation(false, 'tagged')).toBe(false);
  });
});

describe('the pass, flown every way', () => {
  const toStation = (def = OPERATIONS[0]) => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    threadRings(op, cap, def);
    expect(op.stage).toBe('recon');
    return op;
  };

  it('a rolling target: the ring follows it and is still taken by flying through it', () => {
    const def = OPERATIONS[1];
    const op = toStation(def);
    const run = planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat, { r: def.execute.r, agl: def.execute.agl, cue: def.execute.cue });
    beginExecute(op, run.route, 0);
    expect(rings(op.routes.execute!)[0].cue).toBe(def.execute.cue);
    // it drives 60 m down the road while you are on the run in
    const g = retargetRing(op.routes.execute!, 'drop', { x: 760, z: 140 }, (x) => (x > 740 ? 12 : 0))!;
    expect(g).toMatchObject({ x: 760, z: 140, y: 12 + def.execute.agl });
    expect(retargetRing(op.routes.execute!, 'nope', { x: 0, z: 0 }, flat)).toBeNull();
    threadRings(op, cap, def);
    expect(op.execResult).toBe('tagged');
  });

  it('a window: the ring is on a clock from the first frame and closes on you', () => {
    const def = OPERATIONS[2];
    const op = toStation(def);
    const run = planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat, { r: def.execute.r, agl: def.execute.agl });
    beginExecute(op, run.route, def.execute.window);
    expect(onClock(op.exec!)).toBe(true);
    expect(op.exec!.clock).toBe(def.execute.window);
    // loiter well short of the ring: the hoop shrinks, then shuts
    const r = rings(op.routes.execute!)[0];
    const far = { x: r.x - r.nx * 500, y: r.y, z: r.z - r.nz * 500, agl: r.agl };
    tickOperation(op, def, far, 0.1, cap);
    tickOperation(op, def, far, def.execute.window / 2, cap);
    expect(ringScale(op.exec!)).toBeLessThan(1);
    expect(ringScale(op.exec!)).toBeGreaterThan(0.5);
    tickOperation(op, def, far, def.execute.window, cap);
    expect(op.execResult).toBe('missed');
    expect(op.exec!.clock).toBeNull(); // the leg moved on: nothing left to time
  });

  it('a window, made in time: TAGGED, and the way home is on the page pace', () => {
    const def = OPERATIONS[2];
    const op = toStation(def);
    beginExecute(op, planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat).route, def.execute.window);
    threadRings(op, cap, def);
    expect(op.execResult).toBe('tagged');
    const press = escapePressure(def.escape, op.execResult, { contactFromStart: false, visibility: 0.7 });
    beginReturn(op, def, { x: 720, y: 60, z: 100, yaw: 0 }, flat, press.contact, press.pace);
    expect(op.ret.pace).toBe(def.escape.pace);
    expect(op.ret.contact).toBe(false);
    // the first clock is set from that pace
    const first = rings(op.routes.return)[0];
    const a = { x: first.x - first.nx * 200, y: first.y, z: first.z - first.nz * 200, agl: first.agl };
    tickOperation(op, def, a, 0.01, cap);
    expect(op.ret.clockMax).toBeCloseTo(200 / def.escape.pace + CONTACT_SLACK, 1);
    expect(op.ret.clockMax).toBeGreaterThan(200 / CONTACT_PACE + CONTACT_SLACK);
  });

  it('a pass missed puts the radar on you from the first ring home', () => {
    const def = OPERATIONS[0];
    const op = toStation(def);
    beginExecute(op, planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat).route);
    const r = rings(op.routes.execute!)[0];
    for (const k of [-20, 20]) tickOperation(op, def, { x: r.x + r.nx * k - r.nz * 100, y: r.y, z: r.z + r.nz * k + r.nx * 100, agl: r.agl }, 0.4, cap);
    expect(op.execResult).toBe('missed');
    const press = escapePressure(def.escape, op.execResult, { contactFromStart: false, visibility: 0.7 });
    beginReturn(op, def, { x: 720, y: 60, z: 100, yaw: 0 }, flat, press.contact, press.pace);
    expect(op.ret.contact).toBe(true);
    expect(onClock(op.ret)).toBe(true);
  });

  it('the skim: a low ring with its own words, nothing dropped', () => {
    const def = OPERATIONS[3];
    const run = planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat, { agl: def.execute.agl, r: def.execute.r, cue: def.execute.cue });
    const r = rings(run.route)[0];
    expect(r.agl).toBe(22);
    expect(r.y).toBe(22);
    expect(def.execute.drops).toBe(false);
    expect(run.start.y).toBeGreaterThan(r.y);
  });

  it('a window on a fresh leg starts closing at once', () => {
    const op = toStation();
    beginExecute(op, planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat).route);
    startWindow(op.exec!, 12);
    const r = rings(op.routes.execute!)[0];
    const ev = tickLeg(op.exec!, op.routes.execute!, { x: r.x - 400, y: r.y, z: r.z, agl: r.agl }, 13, cap.stealthCeiling);
    expect(ev.map((e) => e.type)).toContain('gate-missed');
    expect(op.exec!.index).toBe(1);
    expect(activeLeg(op)!.def.id).toBe('execute');
  });
});

describe('a ring irises in', () => {
  it('opens from a point, overshoots a touch, settles at full size with the halo calm', () => {
    expect(spawnLook(0).scale).toBeLessThan(0.05);
    expect(spawnLook(0).halo).toBeCloseTo(1, 5);
    const mid = spawnLook(0.5);
    expect(mid.scale).toBeGreaterThan(0.8);
    expect(spawnLook(1)).toEqual({ scale: 1, halo: 0.3 });
    expect(SPAWN_SECONDS).toBeLessThan(0.8); // never hides the ring for long
  });
});

describe('Mission Control runs on a clock, and the clock sets the first ring home', () => {
  it('time to spare makes the first ring wait; none makes it close early; the rest of the route is untouched', () => {
    expect(firstRingScale(1)).toBe(FIRST_RING_SLOW);
    expect(firstRingScale(0)).toBe(FIRST_RING_FAST);
    expect(firstRingScale(0.5)).toBeCloseTo((FIRST_RING_SLOW + FIRST_RING_FAST) / 2, 5);
    expect(firstRingScale(7)).toBe(FIRST_RING_SLOW);
    const def = OPERATIONS[0];
    const fly = (first: number) => {
      const op = newOperation(def, defaultLoadout());
      launch(op);
      threadRings(op, cap, def);
      beginReturn(op, def, { x: 720, y: 60, z: 100, yaw: 0 }, flat, false, def.escape.pace, first);
      const rs = rings(op.routes.return);
      const at = (r: (typeof rs)[number]) => ({ x: r.x - r.nx * 200, y: r.y, z: r.z - r.nz * 200, agl: r.agl });
      tickOperation(op, def, at(rs[0]), 0.01, cap);
      const firstClock = op.ret.clockMax;
      // through the first ring, then the second ring's clock is the usual one
      for (const k of [-20, 20]) tickOperation(op, def, { x: rs[0].x + rs[0].nx * k, y: rs[0].y, z: rs[0].z + rs[0].nz * k, agl: rs[0].agl }, 0.4, cap);
      tickOperation(op, def, at(rs[1]), 0.01, cap);
      return { firstClock, secondClock: op.ret.clockMax };
    };
    const slow = fly(FIRST_RING_SLOW);
    const fast = fly(FIRST_RING_FAST);
    expect(slow.firstClock).toBeCloseTo(fast.firstClock * (FIRST_RING_SLOW / FIRST_RING_FAST), 1);
    expect(slow.secondClock).toBeCloseTo(fast.secondClock, 1);
  });

  it('the escape card says what the clock bought you', () => {
    expect(clockNote(40)).toEqual({ t: '40 s SPARE · FIRST RING HOLDS', bad: false });
    expect(clockNote(9)).toMatchObject({ bad: true });
    expect(clockNote(0)).toEqual({ t: 'OUT OF TIME · FIRST RING CLOSING', bad: true });
    for (const s of [0, 9, 40]) within(clockNote(s).t, 34);
  });

  it('the board is two steps: marking the truck ends the first for good; a player can go on without one', () => {
    expect(boardStep(false, false)).toBe('find');
    expect(boardStep(false, true)).toBe('exit');
    expect(boardStep(true, false)).toBe('exit');
    expect(boardStep(true, true)).toBe('exit');
  });

  it('six look-alikes are dealt, each caught by something different, and the new ones really break the brief', () => {
    const cast = rollReturns(seeded(11));
    expect(cast.filter((r) => !r.hidden)).toHaveLength(6);
    const A = OPERATIONS[0].operations.area;
    const out = (r: ReturnDef) => !r.route.every(([x, z]) => x >= A.x0 && x <= A.x1 && z >= A.z0 && z <= A.z1);
    expect(out({ ...DECOYS.north, id: 'A' })).toBe(true);
    expect(out({ ...DECOYS.quarry, id: 'A' })).toBe(false);
    expect(out({ ...DECOYS.convoy, id: 'A' })).toBe(false);
    expect(DECOYS.quarry.radio).toBe(true);
    expect(DECOYS.convoy.count).toBe(2);
  });
});
