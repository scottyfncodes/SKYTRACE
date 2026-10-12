/**
 * The score: a short, honest breakdown of how the operation went, and a
 * medal. Each row is something you did and can do better next time: find
 * them sooner, lift them cleanly, fly the escape, keep it off the ground.
 *
 * Time is one row among several and never the biggest: a careful rescue
 * beats a fast, rough one. Pure, tested.
 */
import { fireStats } from '../fire/fireSim';
import { decoysCleared } from './recon';
import { escapeTime, gatesPassed } from './route';
import { delivered, type RunState } from './run';

export type Medal = 'gold' | 'silver' | 'bronze';

export interface ScoreRow {
  /** RECON / EXECUTE / ESCAPE / FLYING / TIME, or the fire's own. */
  label: string;
  detail: string;
  points: number;
  max: number;
}

export interface Score {
  rows: ScoreRow[];
  total: number;
  max: number;
  medal: Medal | null;
}

/** Share of the maximum for each medal. */
export const GOLD = 0.88;
export const SILVER = 0.7;

export const medalOf = (total: number, max: number, success: boolean): Medal | null => (!success ? null : total >= max * GOLD ? 'gold' : total >= max * SILVER ? 'silver' : 'bronze');
export const MEDAL_STARS: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const sec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function finish(rows: ScoreRow[], success: boolean): Score {
  const total = rows.reduce((a, r) => a + r.points, 0);
  const max = rows.reduce((a, r) => a + r.max, 0);
  return { rows, total, max, medal: medalOf(total, max, success) };
}

/** A rescue: recon, the lifts, the escape, the flying, the clock. */
export function rescueScore(r: RunState): Score {
  const def = r.def;
  const success = r.stage === 'complete';
  const rows: ScoreRow[] = [];
  const total = r.survivors.length;
  const home = delivered(r);
  rows.push({ label: 'RESCUE', detail: `${home} of ${total} home safe`, points: Math.round((600 * home) / Math.max(1, total)), max: 600 });

  // recon: found them quickly (a good find is a third of par)
  const findPar = def.par * 0.33;
  let recon = 0;
  let reconDetail = 'Not found';
  if (r.foundAt !== null) {
    recon = Math.round(150 + 150 * clamp01(1 - (r.foundAt - findPar) / findPar));
    reconDetail = `Found in ${sec(r.foundAt)}`;
  }
  let reconMax = 300;
  if (def.contacts && r.scan) {
    const decoys = def.contacts.filter((c) => !c.target).length;
    const cleared = decoysCleared(def.contacts, r.scan);
    recon += 40 * cleared;
    reconMax += 40 * decoys;
    reconDetail += ` · ${cleared}/${decoys} checked`;
  }
  rows.push({ label: 'RECON', detail: reconDetail, points: recon, max: reconMax });

  // the lifts: every bump with someone in the basket, every step back, costs
  const lift = Math.max(0, 400 - 120 * r.bumps - 40 * r.stepBacks) * (home / Math.max(1, total));
  const liftDetail = r.bumps === 0 && r.stepBacks === 0 ? 'Clean lifts' : [r.bumps ? `${r.bumps} bump${r.bumps > 1 ? 's' : ''}` : '', r.stepBacks ? `${r.stepBacks} step-back${r.stepBacks > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
  rows.push({ label: 'HOIST', detail: liftDetail, points: Math.round(lift), max: 400 });

  // the escape
  if (r.escape) {
    const e = r.escape;
    const n = e.gates.length;
    const passed = gatesPassed(e);
    const t = escapeTime(e);
    const quick = t !== null && t <= e.def.par;
    const rough = Math.min(120, Math.round(e.offRoute * 10));
    const pts = Math.max(0, 50 * passed + (quick ? 100 : 0) - rough);
    rows.push({ label: 'ESCAPE', detail: `${passed}/${n} gates${t !== null ? ` · ${t.toFixed(1)} s` : ''}${e.offRoute > 1 ? ' · off route' : ''}`, points: pts, max: 50 * n + 100 });
  }

  // the flying: never put it into the ground
  rows.push({ label: 'FLYING', detail: r.scrapes === 0 ? 'No scrapes' : `${r.scrapes} scrape${r.scrapes > 1 ? 's' : ''}`, points: Math.max(0, 200 - 70 * r.scrapes), max: 200 });

  // the clock: at most a sixth of the score
  const time = r.endTime || r.t;
  rows.push({ label: 'TIME', detail: `${sec(time)} · par ${sec(def.par)}`, points: success ? Math.round(300 * clamp01(1 - (time - def.par) / def.par)) : 0, max: 300 });
  return finish(rows, success);
}

/** A fire: the places safe, the forest saved, the fire kept away, the drops that counted. */
export function fireScore(r: RunState): Score {
  const ops = r.ops!;
  const success = r.stage === 'complete';
  const burned = fireStats(ops.fire).spread;
  const without = fireStats(ops.shadow).spread;
  const saved = without > 0 ? clamp01((without - burned) / without) : 1;
  const rows: ScoreRow[] = [
    { label: 'SAFE', detail: success ? `${ops.spec.threats.map((t) => t.name).join(' · ')}` : 'Not held', points: success ? 800 : 0, max: 800 },
    { label: 'FOREST', detail: `${Math.round(burned * 100)}% burned · ${Math.round(without * 100)}% without you`, points: Math.round(500 * (burned <= ops.spec.goodSpread ? 1 : saved * 0.8)), max: 500 },
    { label: 'DISTANCE', detail: ops.maxThreat < 0.75 ? 'Kept well away' : 'It got close', points: Math.round(300 * clamp01((1 - ops.maxThreat) / 0.25)), max: 300 },
  ];
  return finish(rows, success);
}

export const scoreRun = (r: RunState): Score => (r.ops && r.def.survivors === 0 ? fireScore(r) : rescueScore(r));
