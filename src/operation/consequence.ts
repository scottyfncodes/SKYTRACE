/**
 * The phases answer each other. Nothing here is a new mechanic: it is the
 * numbers the existing ones run on, set by what happened before.
 *
 *   RECON → EXECUTE   the board's rank sizes the ring; a target identified
 *                     on evidence holds still for the run, one marked on a
 *                     hunch is still rolling (unless the mission says otherwise)
 *   EXECUTE → ESCAPE  a pass made is the plan Mission Control built; a pass
 *                     missed (or never flown) was seen: RADAR CONTACT from the
 *                     first ring, and the weather a shade worse
 *   BOARD → ESCAPE    what was left on Mission Control's clock sets how fast
 *                     the first ring home closes: lock with time to spare and
 *                     it waits for you; lock as the front arrives and it is
 *                     already shutting
 *
 * Pure, so every consequence is tested.
 */
import type { Rank } from '../control/board';
import type { EscapeProfile, ExecuteProfile } from '../mission/missionDef';
import type { ExecResult } from './phases';

/** How much of the authored ring each rank leaves you. */
export const RING_BY_RANK: Record<Rank, number> = { ACE: 1, SOLID: 0.9, ROUGH: 0.78, SCRAMBLE: 0.66 };

export interface ExecutePlan {
  run: number;
  agl: number;
  r: number;
  /** The target holds still for the run. */
  halts: boolean;
  window: number;
  /** The phase card's line when the consequence is worth a word (null: the mission's own line). */
  line: string | null;
}

export function planExecute(p: ExecuteProfile, control: { rank: Rank; confirmed: boolean } | null): ExecutePlan {
  const scale = control ? RING_BY_RANK[control.rank] : 1;
  const halts = p.halt === 'always' || (p.halt === 'confirmed' && !!control?.confirmed);
  let line: string | null = null;
  if (p.halt === 'confirmed') line = halts ? 'Confirmed. It pulls over. One ring over it.' : 'A hunch. Still rolling. Tag it on the move.';
  return { run: p.run, agl: p.agl, r: Math.round(p.r * scale), halts, window: p.window, line };
}

export interface EscapePressure {
  /** RADAR CONTACT from the first ring. */
  contact: boolean;
  /** Visibility on the way home. */
  visibility: number;
  pace: number;
  /** The phase card's line (null: the mission's own). */
  line: string | null;
}

/** A pass missed costs this much visibility on the way home. */
export const MISS_HAZE = 0.12;

export function escapePressure(p: EscapeProfile, exec: ExecResult, exit: { contactFromStart: boolean; visibility: number }): EscapePressure {
  const seen = exec !== 'tagged';
  const visibility = Math.max(0.3, Math.min(exit.visibility, p.visibility) - (exec === 'missed' ? MISS_HAZE : 0));
  const line = exec === 'missed' ? 'Seen. Radar has you from the first ring.' : exec === 'skipped' ? 'No target. They know you are here anyway.' : null;
  return { contact: exit.contactFromStart || p.contact || seen, visibility, pace: p.pace, line };
}

/** The first ring's clock, as a multiple of the usual one: generous with time to spare, tight with none. */
export const FIRST_RING_SLOW = 1.5;
export const FIRST_RING_FAST = 0.55;

export function firstRingScale(clockLeft: number): number {
  const k = Math.max(0, Math.min(1, clockLeft));
  return FIRST_RING_FAST + (FIRST_RING_SLOW - FIRST_RING_FAST) * k;
}

/** One line for the escape card about the clock you locked with. */
export function clockNote(secondsLeft: number): { t: string; bad: boolean } {
  const s = Math.round(secondsLeft);
  if (s <= 0) return { t: 'OUT OF TIME · FIRST RING CLOSING', bad: true };
  if (s < 15) return { t: `${s} s SPARE · FIRST RING TIGHT`, bad: true };
  return { t: `${s} s SPARE · FIRST RING HOLDS`, bad: false };
}

/** A clean operation: found, passed, home. The page turns on this. */
export function cleanOperation(success: boolean, exec: ExecResult): boolean {
  return success && exec === 'tagged';
}
