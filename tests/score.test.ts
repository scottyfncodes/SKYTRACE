import { describe, expect, it } from 'vitest';
import { MISSION_BY_ID } from '../src/rescue/missions';
import { defaultLoadout, planOf } from '../src/rescue/loadout';
import { newProgress, recordRescue } from '../src/rescue/progress';
import { newRun, type RunState } from '../src/rescue/run';
import { rescueScore, GOLD } from '../src/rescue/score';
import { debrief } from '../src/rescue/debrief';

const def = MISSION_BY_ID['canyon-crash'];
const plan = planOf(def, defaultLoadout(def, newProgress()));

/** A finished canyon rescue: how long it took, how it went. */
function finished(o: { time: number; found: number; bumps?: number; stepBacks?: number; scrapes?: number; gates?: number; escape?: number; off?: number }): RunState {
  const r = newRun(def, plan);
  for (const s of r.survivors) s.state = 'delivered';
  r.stage = 'complete';
  r.t = r.endTime = o.time;
  r.foundAt = o.found;
  r.bumps = o.bumps ?? 0;
  r.stepBacks = o.stepBacks ?? 0;
  r.scrapes = o.scrapes ?? 0;
  r.scan!.identified = def.contacts!.map(() => true);
  const e = r.escape!;
  const g = o.gates ?? e.gates.length;
  e.result = e.gates.map((_, i) => (i < g ? 'passed' : 'missed'));
  e.next = e.gates.length;
  e.t0 = 100;
  e.t1 = 100 + (o.escape ?? 12);
  e.offRoute = o.off ?? 0;
  return r;
}

describe('the score', () => {
  it('a clean, quick rescue with a clean escape is gold, and three stars', () => {
    const s = rescueScore(finished({ time: 200, found: 60 }));
    expect(s.medal).toBe('gold');
    expect(s.total).toBeGreaterThanOrEqual(s.max * GOLD);
    expect(debrief(finished({ time: 200, found: 60 })).stars).toBe(3);
  });

  it('the clock is never more than a sixth of the score', () => {
    const s = rescueScore(finished({ time: 200, found: 60 }));
    const time = s.rows.find((r) => r.label === 'TIME')!;
    expect(time.max / s.max).toBeLessThanOrEqual(1 / 6);
  });

  it('a careful, slower rescue beats a fast, rough one', () => {
    const careful = rescueScore(finished({ time: 320, found: 90 }));
    const rough = rescueScore(finished({ time: 170, found: 50, bumps: 2, stepBacks: 2, scrapes: 2, gates: 3, off: 6 }));
    expect(careful.total).toBeGreaterThan(rough.total);
  });

  it('every row says what it is about, and no row goes over its max or below zero', () => {
    const s = rescueScore(finished({ time: 900, found: 400, bumps: 9, stepBacks: 9, scrapes: 9, gates: 0, off: 60 }));
    expect(s.rows.map((r) => r.label)).toEqual(['RESCUE', 'RECON', 'HOIST', 'ESCAPE', 'FLYING', 'TIME']);
    for (const r of s.rows) {
      expect(r.points).toBeGreaterThanOrEqual(0);
      expect(r.points).toBeLessThanOrEqual(r.max);
      expect(r.detail.length).toBeGreaterThan(2);
    }
    expect(s.medal).toBe('bronze');
  });

  it('a failed mission earns no medal and no stars', () => {
    const r = finished({ time: 200, found: 60 });
    r.stage = 'failed';
    expect(rescueScore(r).medal).toBeNull();
    expect(debrief(r).stars).toBe(0);
  });

  it('missing gates and straying off the route cost escape points', () => {
    const clean = rescueScore(finished({ time: 200, found: 60 })).rows.find((r) => r.label === 'ESCAPE')!;
    const messy = rescueScore(finished({ time: 200, found: 60, gates: 4, off: 5, escape: 30 })).rows.find((r) => r.label === 'ESCAPE')!;
    expect(clean.points).toBe(clean.max);
    expect(messy.points).toBeLessThan(clean.points - 150);
  });

  it('the best score is kept across replays, and old saves without one still load', () => {
    const p = newProgress();
    const l = defaultLoadout(def, p);
    recordRescue(p, 'canyon-crash', { stars: 2, time: 300, rescued: 2, score: 1800 }, l);
    recordRescue(p, 'canyon-crash', { stars: 1, time: 250, rescued: 2, score: 1200 }, l);
    expect(p.done['canyon-crash']!.score).toBe(1800);
    expect(p.done['canyon-crash']!.best).toBe(250);
    recordRescue(p, 'mountain-rescue', { stars: 1, time: 250, rescued: 2 }, l);
    expect(p.done['mountain-rescue']!.score).toBeUndefined();
  });
});
