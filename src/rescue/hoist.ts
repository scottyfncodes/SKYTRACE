/**
 * The rescue hoist: a basket on a cable under a hovering helicopter, and the
 * people it is for.
 *
 * The basket hangs as a pendulum from the winch. Moving the helicopter, and
 * the wind, set it swinging; a longer cable swings slower and wider. Let it
 * down onto the ground near someone and they walk over and climb in; lift it
 * away too soon and they step back. Reel it in with someone inside and they
 * are aboard. Pure, deterministic, frame-rate independent.
 */
import { approach, clamp } from '../core/math';

export type SurvivorState = 'waiting' | 'walking' | 'boarding' | 'basket' | 'aboard' | 'delivered';

export interface Survivor {
  id: number;
  /** Where they were found. They never wander further from it than the reach. */
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  state: SurvivorState;
  /** Climbing in: 0..1. */
  board: number;
}

export interface Basket {
  /** Cable paid out (m). */
  len: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  grounded: boolean;
  /** Who is in it. */
  carrying: number | null;
}

export interface HoistParams {
  maxLen: number;
  /** Winch speed (m/s). */
  winchSpeed: number;
  /** The basket has to come down this close to where someone is (m). */
  reach: number;
  /** Seconds to climb in once they reach it. */
  boardTime: number;
  /** Damping ratio of the swing (0.2: lively, 1: dead). */
  damping: number;
  /** How far the wind blows the basket off plumb at full cable, per m/s of wind (m). */
  windSwing: number;
  /** Walking speed (m/s). */
  walk: number;
}

export const HOIST: HoistParams = { maxLen: 40, winchSpeed: 6, reach: 6, boardTime: 1.3, damping: 0.22, windSwing: 0.35, walk: 2.4 };

/** The winch hangs this far under the helicopter's centre. */
export const WINCH_DROP = 1.6;
/** From the hook to the basket's floor (m). */
export const BASKET_H = 1.8;
/** The ring drawn around the people: land the basket inside it (m beyond the reach). */
export const RING_PAD = 2;

export type HoistEvent =
  | { type: 'touchdown'; hard: boolean }
  | { type: 'liftoff' }
  | { type: 'walking'; id: number }
  | { type: 'boarded'; id: number }
  | { type: 'secured'; id: number }
  | { type: 'stepped-back'; id: number }
  | { type: 'bump'; id: number };

export interface Anchor {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

export function newBasket(a: Anchor): Basket {
  return { len: 0, x: a.x, y: a.y - WINCH_DROP - BASKET_H, z: a.z, vx: a.vx, vz: a.vz, grounded: false, carrying: null };
}

export function placeSurvivors(site: { x: number; z: number }, n: number): Survivor[] {
  const out: Survivor[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + 0.6;
    const r = n === 1 ? 0 : 2.2;
    const x = site.x + Math.cos(a) * r;
    const z = site.z + Math.sin(a) * r;
    out.push({ id: i, homeX: x, homeZ: z, x, z, state: 'waiting', board: 0 });
  }
  return out;
}

/** How far the basket is from someone's spot, on the ground (m). */
export const basketDistance = (b: Basket, s: Survivor): number => Math.hypot(b.x - s.homeX, b.z - s.homeZ);

/** Horizontal swing: how far the basket is off plumb under the winch (m). */
export const swing = (b: Basket, a: Anchor): number => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * One step of the hoist. `cmdLen` is where the winch is told to go (the
 * slider). `cabinFull`: nobody else can come aboard. Mutates the basket and
 * the survivors; returns what happened.
 */
export function stepHoist(b: Basket, people: Survivor[], a: Anchor, wind: { x: number; z: number }, ground: (x: number, z: number) => number, cmdLen: number, P: HoistParams, dt: number, cabinFull = false): HoistEvent[] {
  const ev: HoistEvent[] = [];
  dt = clamp(dt, 0, 0.05);
  const winchY = a.y - WINCH_DROP;
  const hookY = winchY - BASKET_H;
  const prevLen = b.len;
  b.len = approach(b.len, clamp(cmdLen, 0, P.maxLen), P.winchSpeed * dt);
  const paying = b.len - prevLen;

  // pendulum about the winch, pushed off plumb by the wind
  const L = Math.max(b.len, 2.5);
  const w2 = 9.8 / L;
  const w = Math.sqrt(w2);
  const off = P.windSwing * (b.len / P.maxLen);
  const tx = a.x + wind.x * off;
  const tz = a.z + wind.z * off;
  const c = 2 * P.damping * w;
  b.vx += (w2 * (tx - b.x) - c * (b.vx - a.vx)) * dt;
  b.vz += (w2 * (tz - b.z) - c * (b.vz - a.vz)) * dt;
  // a stowed basket rides with the helicopter
  if (b.len < 0.5) {
    const k = 1 - b.len / 0.5;
    b.vx += (a.vx - b.vx) * k;
    b.vz += (a.vz - b.vz) * k;
    b.x += (a.x - b.x) * k;
    b.z += (a.z - b.z) * k;
  }
  b.x += b.vx * dt;
  b.z += b.vz * dt;

  // hang under the winch, or sit on the ground with slack
  const hd = Math.hypot(b.x - a.x, b.z - a.z);
  let y = hookY - Math.sqrt(Math.max(0, b.len * b.len - Math.min(hd * hd, b.len * b.len * 0.8)));
  const g = ground(b.x, b.z);
  const wasGrounded = b.grounded;
  if (y <= g) {
    y = g;
    b.grounded = true;
    // on the ground it slides to a stop...
    const f = Math.exp(-7 * dt);
    b.vx *= f;
    b.vz *= f;
    // ...unless the cable is taut, and then it is dragged toward the winch
    const drop = hookY - g;
    const free = Math.sqrt(Math.max(0, b.len * b.len - drop * drop));
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > free && d > 0) {
      const k = free / d;
      const nx = a.x + (b.x - a.x) * k;
      const nz = a.z + (b.z - a.z) * k;
      b.vx = (nx - b.x) / Math.max(dt, 1e-4);
      b.vz = (nz - b.z) / Math.max(dt, 1e-4);
      b.x = nx;
      b.z = nz;
    }
  } else b.grounded = false;
  b.y = y;
  if (b.grounded && !wasGrounded) {
    const hard = paying > P.winchSpeed * dt * 0.85 && Math.hypot(b.vx - a.vx, b.vz - a.vz) > 2.5;
    ev.push({ type: 'touchdown', hard });
    if (b.carrying !== null) ev.push({ type: 'bump', id: b.carrying });
  } else if (!b.grounded && wasGrounded) ev.push({ type: 'liftoff' });

  // the person in the basket rides in it; reel them in and they are aboard
  if (b.carrying !== null) {
    const s = people[b.carrying];
    s.x = b.x;
    s.z = b.z;
    if (b.len < 0.4) {
      s.state = 'aboard';
      b.carrying = null;
      ev.push({ type: 'secured', id: s.id });
    }
    return ev;
  }

  // someone near a grounded basket comes over and climbs in
  const reachable = (s: Survivor) => b.grounded && !cabinFull && basketDistance(b, s) <= P.reach;
  let active = people.find((s) => s.state === 'walking' || s.state === 'boarding') ?? null;
  if (!active) {
    let best = Infinity;
    for (const s of people) {
      if (s.state !== 'waiting' || !reachable(s)) continue;
      const d = basketDistance(b, s);
      if (d < best) {
        best = d;
        active = s;
      }
    }
    if (active) {
      active.state = 'walking';
      ev.push({ type: 'walking', id: active.id });
    }
  }
  if (active) {
    if (!reachable(active)) {
      if (active.board > 0.15) ev.push({ type: 'stepped-back', id: active.id });
      active.state = 'waiting';
      active.board = 0;
    } else {
      const d = Math.hypot(b.x - active.x, b.z - active.z);
      if (d > 1.1) {
        const step = Math.min(d - 1.0, P.walk * dt);
        active.x += ((b.x - active.x) / d) * step;
        active.z += ((b.z - active.z) / d) * step;
        active.state = 'walking';
      } else {
        active.state = 'boarding';
        active.board = Math.min(1, active.board + dt / P.boardTime);
        if (active.board >= 1) {
          active.state = 'basket';
          b.carrying = active.id;
          ev.push({ type: 'boarded', id: active.id });
        }
      }
    }
  }
  // everyone else drifts back to their spot
  for (const s of people) {
    if (s.state !== 'waiting') continue;
    const d = Math.hypot(s.homeX - s.x, s.homeZ - s.z);
    if (d > 0.05) {
      const step = Math.min(d, P.walk * 0.5 * dt);
      s.x += ((s.homeX - s.x) / d) * step;
      s.z += ((s.homeZ - s.z) / d) * step;
    }
  }
  return ev;
}
