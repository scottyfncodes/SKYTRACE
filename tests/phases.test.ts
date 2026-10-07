/**
 * RECON → EXECUTE → ESCAPE: the three phases every mission is played in,
 * the drop run that is EXECUTE, and the copy that tells the player which
 * phase they are in without a paragraph.
 */
import { describe, expect, it } from 'vitest';
import { MISSION_01 } from '../src/mission/mission01';
import { DROP_AGL, DROP_RUN, onClock, planDropRun, rings } from '../src/operation/gates';
import { capabilities, defaultLoadout } from '../src/operation/loadout';
import { activeLeg, beginExecute, beginReturn, flightObjective, launch, newOperation, tickOperation } from '../src/operation/operation';
import { PHASES, phaseMarks, phaseOf } from '../src/operation/phases';
import { advanceCaseFile, CASE_FILE, currentLead } from '../src/operation/story';
import { newCareer } from '../src/operation/career';
import { threadRings } from './helpers';

const def = MISSION_01;
const cap = capabilities(defaultLoadout());
const flat = () => 0;
const within = (s: string, n: number) => expect(s.length, `"${s}" is ${s.length} chars (budget ${n})`).toBeLessThanOrEqual(n);

describe('phases', () => {
  it('every flying stage belongs to exactly one phase', () => {
    expect(phaseOf('preflight')).toBeNull();
    expect(phaseOf('outbound')).toBe('recon');
    expect(phaseOf('recon')).toBe('recon');
    expect(phaseOf('execute')).toBe('execute');
    expect(phaseOf('return')).toBe('escape');
    expect(phaseOf('debrief')).toBeNull();
    expect(PHASES.map((p) => `${p.n} ${p.label}`)).toEqual(['01 RECON', '02 EXECUTE', '03 ESCAPE']);
  });

  it('the dots show where you are and how execute went', () => {
    expect(phaseMarks('outbound', null)).toEqual(['now', 'todo', 'todo']);
    expect(phaseMarks('execute', null)).toEqual(['done', 'now', 'todo']);
    expect(phaseMarks('return', 'tagged')).toEqual(['done', 'done', 'now']);
    expect(phaseMarks('return', 'missed')).toEqual(['done', 'failed', 'now']);
    expect(phaseMarks('return', 'skipped')).toEqual(['done', 'failed', 'now']);
  });
});

describe('the drop run (EXECUTE)', () => {
  it('starts on the map, nose on the target, with one ring low over it', () => {
    const target = { x: 720, z: 100 };
    const run = planDropRun(target, { x: 600, z: 200 }, flat);
    const fx = -Math.sin(run.start.yaw);
    const fz = -Math.cos(run.start.yaw);
    const [dx, dz] = [target.x - run.start.x, target.z - run.start.z];
    expect(Math.hypot(dx, dz)).toBeCloseTo(DROP_RUN, 0);
    expect((fx * dx + fz * dz) / Math.hypot(dx, dz)).toBeCloseTo(1, 5); // dead ahead
    const rs = rings(run.route);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ id: 'drop', x: target.x, z: target.z, agl: DROP_AGL });
    expect(run.start.y).toBeGreaterThan(rs[0].y); // a glide in, never a climb
    expect(Math.atan2(run.start.y - rs[0].y, DROP_RUN)).toBeLessThan(Math.PI / 10);
  });

  it('swings the approach round rather than start off the map', () => {
    const run = planDropRun({ x: 950, z: 100 }, { x: 1100, z: 100 }, flat);
    expect(Math.abs(run.start.x)).toBeLessThanOrEqual(1050);
    expect(Math.abs(run.start.z)).toBeLessThanOrEqual(1050);
  });

  it('clears the terrain on the way in', () => {
    const hill = (x: number) => (x > 300 && x < 400 ? 180 : 0);
    const run = planDropRun({ x: 720, z: 0 }, { x: 0, z: 0 }, (x) => hill(x));
    expect(run.start.y).toBeGreaterThanOrEqual(180 + 70);
  });
});

describe('RECON → EXECUTE → ESCAPE, flown', () => {
  const toStation = () => {
    const op = newOperation(def, defaultLoadout());
    launch(op);
    threadRings(op, cap);
    expect(op.stage).toBe('recon');
    return op;
  };

  it('through the drop ring: TAGGED, then the timed rings home', () => {
    const op = toStation();
    beginExecute(op, planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat).route);
    expect(op.stage).toBe('execute');
    expect(activeLeg(op)!.def.id).toBe('execute');
    expect(onClock(op.exec!)).toBe(false); // EXECUTE is focused, not rushed
    expect(flightObjective(op, def, cap)).toEqual({ kicker: 'ONE PASS', title: 'COMPLETE THE DROP', detail: 'DROP ZONE' });
    threadRings(op, cap);
    expect(op.execResult).toBe('tagged');
    expect(op.stage).toBe('execute'); // the world reacts before the escape starts
    beginReturn(op, def, { x: 720, y: 60, z: 100, yaw: 0 }, flat);
    expect(op.stage).toBe('return');
    expect(op.ret.timed).toBe(true); // ESCAPE: every ring on a clock
    expect(op.execResult).toBe('tagged');
  });

  it('wide of the drop ring: MISSED; no target at all: SKIPPED', () => {
    const op = toStation();
    beginExecute(op, planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat).route);
    const r = rings(op.routes.execute!)[0];
    for (const k of [-20, 20]) tickOperation(op, def, { x: r.x + r.nx * k - r.nz * 100, y: r.y, z: r.z + r.nz * k + r.nx * 100, agl: r.agl }, 0.4, cap);
    expect(op.execResult).toBe('missed');

    const op2 = toStation();
    beginReturn(op2);
    expect(op2.execResult).toBe('skipped');
  });

  it('abandoning the run counts as a miss', () => {
    const op = toStation();
    beginExecute(op, planDropRun({ x: 720, z: 100 }, { x: 600, z: 200 }, flat).route);
    beginReturn(op);
    expect(op.execResult).toBe('missed');
  });
});

describe('the story, at a glance', () => {
  it('every phase is a short title and one short line', () => {
    const S = def.story;
    within(S.hook, 44);
    for (const p of ['recon', 'execute', 'escape'] as const) {
      within(S[p].title, 18);
      within(S[p].line, 44);
      within(S.verbs[p], 8);
    }
  });

  it('the case file turns a page only on a clean operation, and stops at the end', () => {
    const c = newCareer();
    expect(currentLead(c)).toEqual({ page: 1, total: CASE_FILE.length, text: CASE_FILE[0] });
    expect(advanceCaseFile(c, false)).toBeNull();
    expect(advanceCaseFile(c, true)).toBe(CASE_FILE[1]);
    expect(currentLead(c).page).toBe(2);
    for (let i = 0; i < 10; i++) advanceCaseFile(c, true);
    expect(currentLead(c).page).toBe(CASE_FILE.length);
    for (const line of CASE_FILE) within(line, 70);
  });
});
