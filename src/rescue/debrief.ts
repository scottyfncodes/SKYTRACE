/** The debrief: who came home, how long it took, how it went. Three lines, not a spreadsheet. */
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

export function debrief(r: RunState): Debrief {
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
