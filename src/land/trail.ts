/**
 * The valley's tracks and roads as somewhere to ride: how much trail is
 * under a point (the bike is fastest on it), and points along a track for
 * ramps and the arches home. Pure, tested.
 */
import { segDist, smoothstep } from '../core/math';
import { ROADS, type Pt, type RoadDef } from '../world/worldData';

/** 1 on a road or track, easing to 0 a few metres past its edge. */
export function trailAt(x: number, z: number): number {
  let best = 0;
  for (const r of ROADS) {
    const half = r.width / 2;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      // cheap reject: well outside this segment's box
      if (x < Math.min(ax, bx) - 12 || x > Math.max(ax, bx) + 12 || z < Math.min(az, bz) - 12 || z > Math.max(az, bz) + 12) continue;
      const d = segDist(x, z, ax, az, bx, bz).d;
      best = Math.max(best, smoothstep(half + 3, half, d));
      if (best >= 1) return 1;
    }
  }
  return best;
}

/** Within `margin` metres of the edge of a road or track (trees stand back this far, so the chase view stays clear). */
export function nearTrail(x: number, z: number, margin: number): boolean {
  for (const r of ROADS) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      const m = r.width / 2 + margin;
      if (x < Math.min(ax, bx) - m || x > Math.max(ax, bx) + m || z < Math.min(az, bz) - m || z > Math.max(az, bz) + m) continue;
      if (segDist(x, z, ax, az, bx, bz).d < m) return true;
    }
  }
  return false;
}

const road = (id: string): RoadDef => {
  const r = ROADS.find((q) => q.id === id);
  if (!r) throw new Error(`no road ${id}`);
  return r;
};

export function trailLength(id: string): number {
  const p = road(id).pts;
  let l = 0;
  for (let i = 0; i < p.length - 1; i++) l += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  return l;
}

/** The point `s` metres along a track from its first point, `side` metres to the right, and the way the track runs there. */
export function trailPoint(id: string, s: number, side = 0): { x: number; z: number; dx: number; dz: number } {
  const p: readonly Pt[] = road(id).pts;
  let run = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i];
    const len = Math.hypot(p[i + 1][0] - ax, p[i + 1][1] - az);
    if (s <= run + len || i === p.length - 2) {
      const t = Math.max(0, Math.min(len, s - run));
      const dx = (p[i + 1][0] - ax) / len;
      const dz = (p[i + 1][1] - az) / len;
      return { x: ax + dx * t - dz * side, z: az + dz * t + dx * side, dx, dz };
    }
    run += len;
  }
  return { x: p[0][0], z: p[0][1], dx: 1, dz: 0 };
}

/** The yaw that faces along a track at `s` (forward = -sin, -cos), the way it runs or against it. */
export function trailYaw(id: string, s: number, back = false): number {
  const p = trailPoint(id, s);
  return back ? Math.atan2(p.dx, p.dz) : Math.atan2(-p.dx, -p.dz);
}

/** Arches along a track for the ride home: evenly spaced from `s0` to `s1`, `agl` metres up (their crown over the trail). */
export function trailGates(id: string, s0: number, s1: number, n: number, agl: number): readonly (readonly [number, number, number])[] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = trailPoint(id, s0 + ((s1 - s0) * i) / Math.max(1, n - 1));
    out.push([Math.round(p.x), Math.round(p.z), agl]);
  }
  return out;
}
