/**
 * Flight routes: the flying half of an operation. A leg is an ordered line
 * of rings the pilot has to fly through (the next ring is the objective),
 * plus hazards that are live for the whole leg (storm cells, a cloud deck,
 * a radar-watched area). Pure and testable.
 *
 * A ring is a vertical hoop facing along the route. It is passed by
 * crossing its plane inside the hoop, and missed by crossing the plane
 * outside it: the route moves on either way, so a mistake costs points,
 * never a loop back. On the way home every ring is on a clock that starts
 * the moment the previous ring is hit: the hoop shrinks while it runs and
 * closes when it runs out. A RADAR CONTACT puts outbound rings on it too.
 */
import type { OperationsArea } from '../mission/missionDef';

/** As authored: where the ring stands, how high above the ground, how wide. */
export interface RingSpec {
  kind: 'ring';
  id: string;
  x: number;
  z: number;
  agl: number;
  r: number;
  /** A word or two for the objective line (optional: the ring says it all). */
  cue?: string;
  /** Passing this ring raises RADAR CONTACT (the clock starts on the next one). */
  alert?: boolean;
  /** An opportunity: flying through it earns a bonus; passing it by costs nothing. */
  bonus?: boolean;
}

/** Passed by the landing itself (Game decides when the aircraft is down). */
export interface LandSpec {
  kind: 'land';
  id: string;
  label: string;
  objective: string;
  detail: string;
}

export type GateSpec = RingSpec | LandSpec;

/** A placed ring: centre height above sea level and the horizontal facing (unit normal). */
export interface Ring extends RingSpec {
  y: number;
  nx: number;
  nz: number;
}

export type Gate = Ring | LandSpec;

export type HazardDef =
  | { kind: 'storm'; id: string; label: string; x: number; z: number; r: number }
  /** Cloud deck at an altitude (MSL): above it the pilot is flying blind. */
  | { kind: 'ceiling'; id: string; label: string; y: number };

export interface LegDef {
  id: 'outbound' | 'execute' | 'return';
  /** The pilot's objective while flying the rings. */
  title: string;
  gates: readonly GateSpec[];
  hazards: readonly HazardDef[];
  /** Above the aircraft's stealth ceiling inside this area, the radar sees you. */
  radar?: OperationsArea;
}

/** A leg with its rings placed in the world. */
export interface Route {
  id: LegDef['id'];
  title: string;
  gates: Gate[];
  hazards: readonly HazardDef[];
  radar?: OperationsArea;
}

export type GateStatus = 'pending' | 'passed' | 'missed';

export interface LegState {
  index: number;
  status: Record<string, GateStatus>;
  inside: Record<string, boolean>;
  /** Seconds spent inside each hazard. */
  exposure: Record<string, number>;
  /** Seen by the radar. */
  detected: boolean;
  /** Last position, for plane crossings. */
  prev: { x: number; y: number; z: number } | null;
  /** RADAR CONTACT: the radar has you (the rings turn red as they close). */
  contact: boolean;
  /** Every ring is on a clock (the way home), contact or not. */
  timed: boolean;
  /** Seconds left on the current ring (null: starts next tick). */
  clock: number | null;
  clockMax: number;
}

export interface LegEvent {
  type: 'gate-passed' | 'gate-missed' | 'leg-complete' | 'detected' | 'contact' | 'hazard-enter' | 'hazard-exit';
  id: string;
  text: string;
}

export interface AircraftFix {
  x: number;
  z: number;
  /** Height above sea level. */
  y: number;
  agl: number;
}

/** Hidden forgiveness: the hoop you see is a little smaller than the one that counts. */
export const RING_GRACE = 1.25;
/** Crossing the plane this many radii from the centre is a miss; further out it is ignored. */
export const MISS_BAND = 5;
/** On the clock each ring gets distance / pace + slack seconds. */
export const CONTACT_PACE = 40;
export const CONTACT_SLACK = 6;
/** The hoop closes to this fraction of its size as the clock runs out. */
export const CLOSED_SCALE = 0.55;
/** The join ring turns at most this far from the nose toward the route (radians): a portrait phone shows only about ±15 degrees. */
export const JOIN_TURN = Math.PI / 60;
/** The join ring is never steeper below the nose than this (radians): a glide, not a dive. */
export const JOIN_GLIDE = Math.PI / 12;
/** A route ring closer than this to the join ring is taken by the join ring (m: about three tight turning radii). */
export const JOIN_MERGE = 200;

type Ground = (x: number, z: number) => number;
type Pt = { x: number; z: number };

const unit = (dx: number, dz: number): [number, number] => {
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
};

/**
 * Place a leg in the world: ring heights over the terrain and each ring
 * facing along the route (the average of the way in and the way out).
 */
export function placeRoute(leg: LegDef, ground: Ground, from: Pt, join?: Ring): Route {
  let specs = leg.gates;
  if (join) {
    const j = join;
    // a route ring right on top of the join ring could only be taken by looping back on its clock: the join ring stands in for it
    let k = 0;
    const merge = (g: GateSpec | undefined): g is RingSpec => g?.kind === 'ring' && !g.bonus && specs[k + 1]?.kind === 'ring' && Math.hypot(g.x - j.x, g.z - j.z) < JOIN_MERGE;
    while (merge(specs[k])) {
      if ((specs[k] as RingSpec).alert) join = { ...join, alert: true };
      k++;
    }
    specs = specs.slice(k);
  }
  const gates: Gate[] = join ? [join] : [];
  let prev: Pt = join ?? from;
  for (let i = 0; i < specs.length; i++) {
    const g = specs[i];
    if (g.kind !== 'ring') {
      gates.push(g);
      continue;
    }
    const [ix, iz] = unit(g.x - prev.x, g.z - prev.z);
    const next = specs.slice(i + 1).find((s): s is RingSpec => s.kind === 'ring');
    let [nx, nz] = [ix, iz];
    if (next) [nx, nz] = unit(ix + unit(next.x - g.x, next.z - g.z)[0], iz + unit(next.x - g.x, next.z - g.z)[1]);
    gates.push({ ...g, y: ground(g.x, g.z) + g.agl, nx, nz });
    prev = g;
  }
  return { id: leg.id, title: leg.title, gates, hazards: leg.hazards, radar: leg.radar };
}

/**
 * The first ring of the way home, placed where the pilot sees it the moment
 * they have the controls: dead ahead of the nose (turned at most a few
 * degrees toward the route, so it stays in frame even on a narrow phone
 * screen), at the aircraft's height unless the ground or a cloud deck says
 * otherwise.
 */
export function joinRing(pose: { x: number; y: number; z: number; yaw: number }, toward: Pt, ground: Ground, ceilingY = Infinity, dist = 380): Ring {
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const [tx, tz] = unit(toward.x - pose.x, toward.z - pose.z);
  // turn from the heading toward the route, only a little: it must be in view
  const cross = fx * tz - fz * tx;
  const dot = fx * tx + fz * tz;
  const ang = Math.max(-JOIN_TURN, Math.min(JOIN_TURN, Math.atan2(cross, dot)));
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const nx = fx * c - fz * s;
  const nz = fx * s + fz * c;
  const lim = 1100;
  const at = (d: number) => {
    const x = Math.max(-lim, Math.min(lim, pose.x + nx * d));
    const z = Math.max(-lim, Math.min(lim, pose.z + nz * d));
    const g = ground(x, z);
    return { x, z, g, y: Math.max(g + 70, Math.min(pose.y, ceilingY - 60, g + 260)) };
  };
  let p = at(dist);
  // well below the nose (above a cloud deck, say): lay it further out, a glide away
  const drop = pose.y - p.y;
  if (drop > dist * Math.tan(JOIN_GLIDE)) p = at(Math.min(1000, drop / Math.tan(JOIN_GLIDE)));
  return { kind: 'ring', id: 'join', x: p.x, z: p.z, agl: p.y - p.g, r: 40, y: p.y, nx, nz };
}

/** How far out the drop run starts, how high over the target the drop ring stands, and how wide. */
export const DROP_RUN = 620;
export const DROP_AGL = 40;
export const DROP_R = 42;

/**
 * EXECUTE: line the aircraft up on the target. The run starts DROP_RUN metres
 * out on the aircraft's side of the target (swung round if that would leave
 * the map), nose on the target, a shallow glide above the terrain on the way
 * in; one big ring stands low over the target itself. Fly through it: drop.
 */
export function planDropRun(target: Pt, from: Pt, ground: Ground, title = 'COMPLETE THE DROP', limit = 1050): { start: { x: number; y: number; z: number; yaw: number }; route: Route } {
  let [dx, dz] = unit(from.x - target.x, from.z - target.z);
  if (dx === 0 && dz === 0) [dx, dz] = [0, 1];
  let sx = target.x + dx * DROP_RUN;
  let sz = target.z + dz * DROP_RUN;
  for (let k = 1; k < 12 && (Math.abs(sx) > limit || Math.abs(sz) > limit); k++) {
    // swing the approach round until it starts on the map
    const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
    const [ux, uz] = unit(from.x - target.x, from.z - target.z);
    dx = ux * Math.cos(a) - uz * Math.sin(a);
    dz = ux * Math.sin(a) + uz * Math.cos(a);
    sx = target.x + dx * DROP_RUN;
    sz = target.z + dz * DROP_RUN;
  }
  sx = Math.max(-limit, Math.min(limit, sx));
  sz = Math.max(-limit, Math.min(limit, sz));
  // clear the ground all the way in
  let high = -Infinity;
  for (let t = 0; t <= 1; t += 0.05) high = Math.max(high, ground(sx + (target.x - sx) * t, sz + (target.z - sz) * t));
  const gy = ground(target.x, target.z);
  const y = Math.max(high + 70, ground(sx, sz) + 110, gy + DROP_AGL + 60);
  const [nx, nz] = unit(target.x - sx, target.z - sz);
  const ring: Ring = { kind: 'ring', id: 'drop', x: target.x, z: target.z, agl: DROP_AGL, r: DROP_R, y: gy + DROP_AGL, nx, nz, cue: 'DROP ZONE' };
  return { start: { x: sx, y, z: sz, yaw: Math.atan2(-nx, -nz) }, route: { id: 'execute', title, gates: [ring], hazards: [] } };
}

export function newLeg(route: Route, contact = false, timed = false): LegState {
  const status: Record<string, GateStatus> = {};
  for (const g of route.gates) status[g.id] = 'pending';
  const inside: Record<string, boolean> = {};
  const exposure: Record<string, number> = {};
  for (const h of route.hazards) {
    inside[h.id] = false;
    exposure[h.id] = 0;
  }
  return { index: 0, status, inside, exposure, detected: false, prev: null, contact, timed, clock: null, clockMax: 0 };
}

export function currentGate(s: LegState, route: Route): Gate | null {
  return route.gates[s.index] ?? null;
}

export function legComplete(s: LegState, route: Route): boolean {
  return s.index >= route.gates.length;
}

export function rings(route: Route): Ring[] {
  return route.gates.filter((g): g is Ring => g.kind === 'ring');
}

/** "3/8": where a ring sits in its route. */
export function ringOrdinal(route: Route, id: string): string {
  const rs = rings(route);
  return `${rs.findIndex((r) => r.id === id) + 1}/${rs.length}`;
}

/** The current ring is on a clock (the way home, or under contact). */
export const onClock = (s: LegState): boolean => s.timed || s.contact;

/** How open the current ring is (1 = full size; shrinks as its clock runs). */
export function ringScale(s: LegState): number {
  if (!onClock(s) || s.clock === null || s.clockMax <= 0) return 1;
  return CLOSED_SCALE + (1 - CLOSED_SCALE) * Math.max(0, Math.min(1, s.clock / s.clockMax));
}

export function inHazard(h: HazardDef, a: AircraftFix): boolean {
  if (h.kind === 'storm') return Math.hypot(a.x - h.x, a.z - h.z) < h.r;
  return a.y > h.y;
}

const inside = (A: OperationsArea, x: number, z: number) => x >= A.x0 && x <= A.x1 && z >= A.z0 && z <= A.z1;

/** Where the segment prev→a crosses the ring's plane, and how far from the centre (null: no crossing). */
function crossing(g: Ring, p: { x: number; y: number; z: number }, a: AircraftFix): { off: number; forward: boolean } | null {
  const d0 = (p.x - g.x) * g.nx + (p.z - g.z) * g.nz;
  const d1 = (a.x - g.x) * g.nx + (a.z - g.z) * g.nz;
  if (d0 === d1 || (d0 > 0 && d1 > 0) || (d0 < 0 && d1 < 0) || d0 === 0) return null;
  const t = d0 / (d0 - d1);
  const x = p.x + (a.x - p.x) * t;
  const y = p.y + (a.y - p.y) * t;
  const z = p.z + (a.z - p.z) * t;
  return { off: Math.hypot(x - g.x, y - g.y, z - g.z), forward: d0 < 0 };
}

function advance(s: LegState, route: Route, to: number, ev: LegEvent[]): void {
  s.index = to;
  s.clock = null;
  if (legComplete(s, route)) ev.push({ type: 'leg-complete', id: route.id, text: route.id === 'outbound' ? 'ON STATION' : route.id === 'execute' ? 'DROP' : 'HOME' });
}

function raiseContact(s: LegState, ev: LegEvent[], id: string): void {
  if (s.contact) return;
  s.contact = true;
  s.clock = null;
  ev.push({ type: 'contact', id, text: 'RADAR CONTACT' });
}

/**
 * Advance a leg one frame. Rings are taken in order; flying through a later
 * ring (up to two ahead) marks the skipped ones missed.
 */
export function tickLeg(s: LegState, route: Route, a: AircraftFix, dt: number, stealthCeiling: number): LegEvent[] {
  const ev: LegEvent[] = [];
  for (const h of route.hazards) {
    const now = inHazard(h, a);
    if (now) s.exposure[h.id] += dt;
    if (now !== s.inside[h.id]) {
      s.inside[h.id] = now;
      ev.push({ type: now ? 'hazard-enter' : 'hazard-exit', id: h.id, text: now ? (h.kind === 'storm' ? 'TURBULENCE' : 'IN CLOUD') : h.kind === 'storm' ? 'CLEAR OF THE STORM' : 'BELOW THE CLOUDS' });
    }
  }
  if (route.radar && !s.detected && a.agl > stealthCeiling && inside(route.radar, a.x, a.z)) {
    s.detected = true;
    ev.push({ type: 'detected', id: route.radar.id, text: 'SPOTTED BY RADAR' });
  }

  const g = currentGate(s, route);
  if (g?.kind === 'ring') {
    // ---- the clock (the way home, or under contact)
    if (onClock(s)) {
      if (s.clock === null) {
        s.clockMax = Math.hypot(g.x - a.x, g.y - a.y, g.z - a.z) / CONTACT_PACE + CONTACT_SLACK;
        s.clock = s.clockMax;
      } else s.clock -= dt;
    }
    // ---- through the hoop?
    let done = false;
    if (s.prev) {
      for (let j = s.index; j < Math.min(route.gates.length, s.index + 3); j++) {
        const r = route.gates[j];
        if (r.kind !== 'ring') break;
        const c = crossing(r, s.prev, a);
        if (!c) continue;
        const hit = r.r * RING_GRACE * (j === s.index ? ringScale(s) : 1);
        if (c.off <= hit) {
          for (let k = s.index; k < j; k++) {
            s.status[route.gates[k].id] = 'missed';
            ev.push({ type: 'gate-missed', id: route.gates[k].id, text: ringOrdinal(route, route.gates[k].id) });
          }
          s.status[r.id] = 'passed';
          ev.push({ type: 'gate-passed', id: r.id, text: ringOrdinal(route, r.id) });
          if (r.alert) raiseContact(s, ev, r.id);
          advance(s, route, j + 1, ev);
          done = true;
          break;
        }
        if (j === s.index && c.forward && c.off < r.r * MISS_BAND) {
          s.status[r.id] = 'missed';
          ev.push({ type: 'gate-missed', id: r.id, text: ringOrdinal(route, r.id) });
          if (r.alert) raiseContact(s, ev, r.id);
          advance(s, route, j + 1, ev);
          done = true;
          break;
        }
      }
    }
    // ---- the hoop closes
    if (!done && onClock(s) && s.clock !== null && s.clock <= 0) {
      s.status[g.id] = 'missed';
      ev.push({ type: 'gate-missed', id: g.id, text: ringOrdinal(route, g.id) });
      advance(s, route, s.index + 1, ev);
    }
  }
  s.prev = { x: a.x, y: a.y, z: a.z };
  return ev;
}

/** The landing gate is passed by the Game when the aircraft is down at base. */
export function passLanding(s: LegState, route: Route): LegEvent[] {
  const g = currentGate(s, route);
  if (!g || g.kind !== 'land') return [];
  s.status[g.id] = 'passed';
  s.index += 1;
  return [{ type: 'gate-passed', id: g.id, text: g.label }, { type: 'leg-complete', id: route.id, text: 'HOME' }];
}

/** Rings missed (opportunities passed by do not count). */
export function missedCount(s: LegState, route?: Route): number {
  const bonus = new Set(route ? rings(route).filter((r) => r.bonus).map((r) => r.id) : []);
  return Object.entries(s.status).filter(([id, v]) => v === 'missed' && !bonus.has(id)).length;
}

/** Opportunity rings flown through. */
export function bonusTaken(s: LegState, route: Route): Ring[] {
  return rings(route).filter((r) => r.bonus && s.status[r.id] === 'passed');
}

/** Rings flown through / rings in the route (opportunities aside). */
export function ringTally(s: LegState, route: Route): { hit: number; total: number } {
  const rs = rings(route).filter((r) => !r.bonus);
  return { hit: rs.filter((r) => s.status[r.id] === 'passed').length, total: rs.length };
}

export function totalExposure(s: LegState, route: Route, kind: HazardDef['kind']): number {
  return route.hazards.filter((h) => h.kind === kind).reduce((t, h) => t + s.exposure[h.id], 0);
}
