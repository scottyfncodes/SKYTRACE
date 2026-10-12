/**
 * The escape: once everyone is aboard, the way home is a route, not a
 * straight line. A short run of gates down out of the danger (the storm, the
 * gusts on the ridge, the smoke), with a reason on the radio. Fly through
 * them and you are out quickly and cleanly; stray off the route and the
 * conditions you are escaping catch you (turbulence). Missing a gate never
 * fails the rescue, it costs points.
 *
 * Also the route guidance: where the nav arrow, the minimap and the
 * chevrons in the sky point next. Pure, deterministic, tested.
 */

/** A gate as authored: ground position and height above the ground (m). */
export type GatePoint = readonly [x: number, z: number, agl: number];

export interface EscapeDef {
  /** What the route is, for the HUD ("Down the gully"). */
  name: string;
  /** Why it exists, said on the radio when it starts. */
  reason: string;
  gates: readonly GatePoint[];
  /** Gate radius (m). */
  r: number;
  /** Off the route by more than this (m, sideways) and the turbulence starts. */
  corridor: number;
  /** A good time from the first gate to the last (s). */
  par: number;
}

export interface Gate {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Which way to fly through it (unit, on the ground plane). */
  nx: number;
  nz: number;
}

export type GateResult = 'pending' | 'passed' | 'missed';

export interface EscapeState {
  def: EscapeDef;
  gates: Gate[];
  result: GateResult[];
  /** Index of the next gate (gates.length when done). */
  next: number;
  /** Run time when the first gate was crossed, and when the last one was. */
  t0: number | null;
  t1: number | null;
  /** Seconds spent off the route. */
  offRoute: number;
  off: boolean;
  last: { x: number; y: number; z: number } | null;
}

export type EscapeEvent = { type: 'gate'; index: number } | { type: 'gate-missed'; index: number } | { type: 'escape-done' } | { type: 'off-route' } | { type: 'on-route' };

/** Gates in the world: on the terrain, each facing along the route. */
export function buildGates(def: EscapeDef, ground: (x: number, z: number) => number): Gate[] {
  const pts = def.gates;
  return pts.map(([x, z, agl], i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = b[0] - a[0];
    let nz = b[1] - a[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    return { x, y: ground(x, z) + agl, z, r: def.r, nx, nz };
  });
}

export function newEscape(def: EscapeDef, ground: (x: number, z: number) => number): EscapeState {
  const gates = buildGates(def, ground);
  return { def, gates, result: gates.map(() => 'pending'), next: 0, t0: null, t1: null, offRoute: 0, off: false, last: null };
}

export const escapeDone = (e: EscapeState): boolean => e.next >= e.gates.length;
export const gatesPassed = (e: EscapeState): number => e.result.filter((r) => r === 'passed').length;

/** Sideways distance (m) from the route's centre line, on the ground plane. */
export function offRouteDistance(e: EscapeState, p: { x: number; z: number }): number {
  const g = e.gates;
  if (g.length === 0) return 0;
  // from the gate just behind the next one to the end
  const from = Math.max(0, e.next - 1);
  let best = Math.hypot(p.x - g[from].x, p.z - g[from].z);
  for (let i = from; i < g.length - 1; i++) {
    const ax = g[i].x;
    const az = g[i].z;
    const dx = g[i + 1].x - ax;
    const dz = g[i + 1].z - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.z - (az + dz * t)));
  }
  return best;
}

/**
 * Advance the escape with the aircraft's new position. A gate counts when
 * the aircraft crosses its plane: inside the ring it is passed, outside it
 * is missed (only crossings within a few hundred metres count, so a gate is
 * never "missed" from the far side of the valley).
 */
export function tickEscape(e: EscapeState, p: { x: number; y: number; z: number }, t: number, dt: number): EscapeEvent[] {
  const ev: EscapeEvent[] = [];
  const prev = e.last;
  e.last = { x: p.x, y: p.y, z: p.z };
  if (escapeDone(e) || !prev) return ev;
  // one gate per step at most is plenty at any speed this game flies
  const g = e.gates[e.next];
  const before = (prev.x - g.x) * g.nx + (prev.z - g.z) * g.nz;
  const after = (p.x - g.x) * g.nx + (p.z - g.z) * g.nz;
  if (before < 0 && after >= 0) {
    const k = before / (before - after);
    const cx = prev.x + (p.x - prev.x) * k;
    const cy = prev.y + (p.y - prev.y) * k;
    const cz = prev.z + (p.z - prev.z) * k;
    const side = Math.hypot(cx - g.x, cz - g.z);
    if (side < 260) {
      const off = Math.hypot(side, cy - g.y);
      const hit = off <= g.r;
      e.result[e.next] = hit ? 'passed' : 'missed';
      ev.push(hit ? { type: 'gate', index: e.next } : { type: 'gate-missed', index: e.next });
      if (e.t0 === null) e.t0 = t;
      e.next++;
      if (escapeDone(e)) {
        e.t1 = t;
        e.off = false;
        ev.push({ type: 'escape-done' });
        return ev;
      }
    }
  }
  // the corridor: once you have started down the route, stay near it
  if (e.t0 !== null) {
    const off = offRouteDistance(e, p) > e.def.corridor;
    if (off) e.offRoute += dt;
    if (off !== e.off) {
      e.off = off;
      ev.push({ type: off ? 'off-route' : 'on-route' });
    }
  }
  return ev;
}

/** Seconds from the first gate to the last (null until it is flown). */
export const escapeTime = (e: EscapeState): number | null => (e.t0 !== null && e.t1 !== null ? e.t1 - e.t0 : null);
