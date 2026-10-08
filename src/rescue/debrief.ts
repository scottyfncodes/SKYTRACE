/** The debrief: who came home, how long it took, how it went. Three lines, not a spreadsheet. */
import { fireStats } from '../fire/fireSim';
import { delivered, type RunState } from './run';

export interface Debrief {
  success: boolean;
  headline: string;
  rescued: number;
  total: number;
  time: number;
  stars: number;
  extraction: string;
  lines: { icon: string; text: string }[];
}

export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * A fire's debrief: did the places it threatened come through, how much of
 * the forest burned (and how much would have, without you), what you dropped.
 * Stars: the job done, the forest saved, and the fire kept well away.
 */
export function fireDebrief(r: RunState): Debrief {
  const ops = r.ops!;
  const time = r.endTime || r.t;
  const success = r.stage === 'complete';
  const burned = fireStats(ops.fire).spread;
  const without = fireStats(ops.shadow).spread;
  const saved = burned <= ops.spec.goodSpread;
  const kept = ops.maxThreat < 0.75;
  const stars = success ? 1 + (saved ? 1 : 0) + (kept ? 1 : 0) : 0;
  const names = ops.spec.threats.map((t) => t.name).join(' and ');
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const what = ops.attack === 'water' ? (ops.drops === 1 ? 'bucket' : 'buckets') : ops.attack === 'lead' ? (ops.drops === 1 ? 'line called' : 'lines called') : ops.drops === 1 ? 'retardant line' : 'retardant lines';
  const lines = [
    { icon: success ? ops.spec.threats[0].icon : '🔥', text: success ? `${names} ${ops.spec.threats.length > 1 ? 'are' : 'is'} safe` : r.failReason ?? 'Mission failed' },
    { icon: '🌲', text: `${pct(burned)} of the forest burned${without > burned + 0.005 ? ` · ${pct(without)} without you` : ''}` },
    { icon: ops.attack === 'water' ? '💧' : ops.attack === 'lead' ? '📍' : '🟥', text: `${ops.drops} ${what} · ${clock(time)}` },
  ];
  const extraction = !success ? 'Fire not stopped' : ops.outcome === 'contained' ? 'Fire contained' : 'Fire held for the crews';
  return { success, headline: success ? (ops.outcome === 'contained' ? 'FIRE CONTAINED' : 'FIRE HELD') : 'MISSION FAILED', rescued: 0, total: 0, time, stars, extraction, lines };
}

export function debrief(r: RunState): Debrief {
  if (r.ops && r.def.survivors === 0) return fireDebrief(r);
  const rescued = delivered(r);
  const total = r.survivors.length;
  const time = r.endTime || r.t;
  const success = r.stage === 'complete';
  const fast = time <= r.def.par;
  const smooth = r.bumps === 0;
  const stars = success ? 1 + (fast ? 1 : 0) + (smooth ? 1 : 0) : 0;
  const extraction = !success ? 'Rescue incomplete' : smooth && fast ? 'Excellent extraction' : smooth ? 'Smooth extraction' : r.bumps === 1 ? 'A bump on the way up' : 'A bumpy ride up';
  const people = (n: number) => (n === 1 ? '1 survivor' : `${n} survivors`);
  const lines = [
    { icon: '👤', text: `${people(rescued)} rescued${success ? '' : ` of ${total}`}` },
    { icon: '⏱', text: `${clock(time)} mission time${success ? (fast ? ' · fast!' : ` · par ${clock(r.def.par)}`) : ''}` },
    { icon: smooth ? '🛟' : '〰️', text: success ? extraction : r.failReason ?? 'Mission failed' },
  ];
  return { success, headline: success ? 'RESCUE COMPLETE' : 'MISSION FAILED', rescued, total, time, stars, extraction, lines };
}
