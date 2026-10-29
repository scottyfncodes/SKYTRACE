/**
 * The Varrow River as a course: where along it a point is, which way the
 * water runs there, and how hard. People in the water drift with it; the
 * boat feels it. Pure, tested.
 */
import { RIVER, type Pt } from '../world/worldData';

/** The current down the middle of the river (m/s). */
export const CURRENT = 1.6;
/** Below this the terrain is open water a boat can run on (m). */
export const DEEP = -0.8;

/** Length of each segment, and the running total at its start. */
const SEGS = (() => {
  const out: { ax: number; az: number; dx: number; dz: number; len: number; s0: number }[] = [];
  let s = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i];
    const dx = RIVER[i + 1][0] - ax;
    const dz = RIVER[i + 1][1] - az;
    const len = Math.hypot(dx, dz);
    out.push({ ax, az, dx: dx / len, dz: dz / len, len, s0: s });
    s += len;
  }
  return out;
})();
export const RIVER_LENGTH = SEGS[SEGS.length - 1].s0 + SEGS[SEGS.length - 1].len;

export interface RiverSpot {
  /** Distance along the river from its western end (m). */
  s: number;
  /** Sideways distance from the centre line (m, positive: right bank looking downstream). */
  side: number;
  /** Which way the water runs here (unit). */
  dx: number;
  dz: number;
}

/** Where on the river a point is. */
export function riverAt(x: number, z: number): RiverSpot {
  let best: RiverSpot = { s: 0, side: Infinity, dx: SEGS[0].dx, dz: SEGS[0].dz };
  let bd = Infinity;
  for (const g of SEGS) {
    const t = Math.max(0, Math.min(g.len, (x - g.ax) * g.dx + (z - g.az) * g.dz));
    const px = g.ax + g.dx * t;
    const pz = g.az + g.dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < bd) {
      bd = d;
      // right of the flow: (-dz, dx) in this x-east, z-south frame
      const side = (x - px) * -g.dz + (z - pz) * g.dx;
      best = { s: g.s0 + t, side, dx: g.dx, dz: g.dz };
    }
  }
  return best;
}

/** The point `s` metres along the river, `side` metres off its centre line, and the flow there. */
export function riverPoint(s: number, side = 0): { x: number; z: number; dx: number; dz: number } {
  const c = Math.max(0, Math.min(RIVER_LENGTH, s));
  const g = SEGS.find((q) => c <= q.s0 + q.len) ?? SEGS[SEGS.length - 1];
  const t = c - g.s0;
  return { x: g.ax + g.dx * t - g.dz * side, z: g.az + g.dz * t + g.dx * side, dx: g.dx, dz: g.dz };
}

/** The current's push at a point (m/s): strongest mid-river, nothing on the banks. */
export function currentAt(x: number, z: number): { x: number; z: number } {
  const r = riverAt(x, z);
  const k = Math.max(0, 1 - (r.side / 34) ** 2);
  return { x: r.dx * CURRENT * k, z: r.dz * CURRENT * k };
}

/** A stretch of the river as gates for the run home: evenly spaced from `s0` to `s1`, weaving `weave` m either side. */
export function riverGates(s0: number, s1: number, n: number, weave: number, agl: number): readonly (readonly [number, number, number])[] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s = s0 + ((s1 - s0) * i) / Math.max(1, n - 1);
    const p = riverPoint(s, i % 2 === 0 ? -weave : weave);
    out.push([Math.round(p.x), Math.round(p.z), agl]);
  }
  return out;
}

export type { Pt };
