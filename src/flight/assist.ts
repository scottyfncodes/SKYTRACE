/**
 * Hover assist: the flight computer learns the wind and leans into it.
 *
 * A helicopter left alone in a steady wind drifts away with it, and on a
 * phone that means constant small corrections just to stay put. The assist
 * keeps a running estimate of the wind's push (it takes a second or two to
 * learn it) and cancels it. A steady wind stops mattering; a gust still
 * shoves you, briefly, until the estimate catches up. Turn it off and the
 * full push is yours to fly against. Pure, frame-rate independent.
 */

export interface WindEstimate {
  x: number;
  z: number;
}

/** Seconds the assist takes to learn a change in the wind (63%). */
export const ASSIST_LAG = 1.4;

export const newWindEstimate = (): WindEstimate => ({ x: 0, z: 0 });

/**
 * The push left over after the assist (m/s). Updates the estimate in place.
 * Off: the estimate decays and the full push comes through.
 */
export function assistedDrift(est: WindEstimate, drift: { x: number; z: number }, dt: number, on: boolean, lag = ASSIST_LAG): { x: number; z: number } {
  const k = 1 - Math.exp(-Math.max(0, dt) / lag);
  if (!on) {
    est.x = 0;
    est.z = 0;
    return { x: drift.x, z: drift.z };
  }
  est.x += (drift.x - est.x) * k;
  est.z += (drift.z - est.z) * k;
  return { x: drift.x - est.x, z: drift.z - est.z };
}
