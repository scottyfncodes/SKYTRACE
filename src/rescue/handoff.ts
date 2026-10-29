/**
 * A rescue in two vehicles. The Search Aircraft finds them; then something
 * fast on the ground (the Rescue Boat on the river, the Trail Bike in the
 * forest) races in, picks them up and brings them home.
 *
 * On the river the people drift with the current, the cold water is the
 * clock, and the aircraft drops a raft on a low pass first (where it lands
 * depends on your height and speed: lead them). On a trail they stay put,
 * and the bike goes in as soon as they are found. Pure, deterministic,
 * tested.
 */
import { WATER_LEVEL } from '../world/worldData';
import { CURRENT, riverAt, riverPoint } from '../water/river';

export type GroundVehicle = 'boat' | 'bike';

export interface HandoffSpec {
  /** What goes in once they are found. */
  vehicle: GroundVehicle;
  /** On the river: where they went in (metres along it, and off its centre line), and the share of the current they drift at. */
  river?: { s: number; side: number; drift: number };
  /** On land: where they are. */
  at?: { x: number; z: number };
  /** Seconds they can hold on before help reaches them (a raft stops it). 0: no clock. */
  clock: number;
  /** Rafts aboard the aircraft (0: nothing to drop, the ground vehicle goes as soon as they are found). */
  drops: number;
  /** A raft landing within this of them is close enough to swim to (m). */
  reach: number;
  /** Where the ground vehicle sets off from, facing the way in. */
  start: { x: number; z: number; yaw: number };
  /** Where it brings them: the boat station, the ambulance at the trailhead. */
  home: { name: string; x: number; z: number; yaw: number };
  /** Rapids: metres along the river. At speed the boat flies off them. */
  rapids?: readonly number[];
  /** Ramps on the trail: the bike flies off them at speed. */
  ramps?: readonly { x: number; z: number; yaw: number }[];
  /** The plan, in one line, for Pre-Flight. */
  brief: string;
}

export type DropFall = 'falling' | 'floating';

/** A raft, in the air or on the river. */
export interface Drop {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: DropFall;
  /** Floating: where on the river it is (it drifts). */
  s: number;
  side: number;
  yaw: number;
}

export interface HandoffOps {
  spec: HandoffSpec;
  /** The aircraft finds them (and drops); then the ground vehicle. */
  phase: 'air' | 'ground';
  /** On the river: where the people are along it. */
  s: number;
  side: number;
  /** Seconds left on the clock. */
  clock: number;
  clockWarned: boolean;
  drops: number;
  /** Every raft dropped, in the air or on the water. */
  dropped: Drop[];
  /** They are in a raft (the index of it in `dropped`). */
  caught: number;
  /** Distance from them of each raft that landed (m). */
  landings: number[];
  /** Seconds until the ground vehicle takes over (counts down once the aircraft is done). */
  handoffIn: number;
  /** Getting them aboard: 0..1. */
  pull: number;
  /** Mission time the ground vehicle set off. */
  groundT: number | null;
}

export type HandoffEvent = 'drop-away' | 'drop-landed' | 'drop-missed' | 'caught' | 'clock-warn' | 'clock-out' | 'handoff' | 'pulling' | 'picked-up';

/** How each ground vehicle picks people up and arrives home. */
export interface Pickup {
  /** Within this of them, under this speed, they come aboard (m, m/s); further than `lost` and it starts over. */
  range: number;
  speed: number;
  lost: number;
  /** Seconds to get everyone aboard (the paramedic halves it). */
  time: number;
  /** Within this of home, this slow, you have arrived (m, m/s). */
  homeRange: number;
  homeSpeed: number;
}

export const PICKUP: Record<GroundVehicle, Pickup> = {
  // the crew leans over the side and hauls them in: come alongside, ease off
  boat: { range: 16, speed: 10, lost: 26, time: 2.6, homeRange: 22, homeSpeed: 7 },
  // she climbs on the back: pull up next to her and stop
  bike: { range: 9, speed: 3.5, lost: 16, time: 1.8, homeRange: 16, homeSpeed: 4 },
};

/** Drop physics: it falls, and the air slows its forward travel. */
const G = 9.8;
const AIR_DRAG = 0.5;
/** Above this a raft drop is too high to place (m). */
export const DROP_MAX_AGL = 90;
/** Seconds between the aircraft's part ending and the ground vehicle taking over. */
const HANDOFF = 3.2;

export function newHandoff(spec: HandoffSpec): HandoffOps {
  return { spec, phase: 'air', s: spec.river?.s ?? 0, side: spec.river?.side ?? 0, clock: spec.clock, clockWarned: false, drops: spec.drops, dropped: [], caught: -1, landings: [], handoffIn: -1, pull: 0, groundT: null };
}

/** Where the people are now. */
export function peopleAt(ops: HandoffOps): { x: number; z: number } {
  if (!ops.spec.river) return ops.spec.at ?? { x: 0, z: 0 };
  const p = riverPoint(ops.s, ops.side);
  return { x: p.x, z: p.z };
}

export interface Mover {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  agl: number;
}

/** Where a raft let go now would land on the water (and how long it falls). */
export function dropLanding(p: Mover): { x: number; z: number; t: number } {
  const h = Math.max(0, p.y - 2 - WATER_LEVEL);
  const t = Math.sqrt((2 * h) / G);
  const k = (1 - Math.exp(-AIR_DRAG * t)) / AIR_DRAG;
  return { x: p.x + p.vx * k, z: p.z + p.vz * k, t };
}

/** Can a raft go now? (`why`: what is stopping it, for the button.) */
export function canDropItem(ops: HandoffOps, p: Mover, spotted: boolean): { ok: boolean; why: string } {
  if (ops.phase !== 'air' || ops.caught >= 0 || ops.drops === 0) return { ok: false, why: '' };
  if (!spotted) return { ok: false, why: '' };
  if (ops.dropped.some((r) => r.state === 'falling')) return { ok: false, why: 'RAFT FALLING' };
  const g = peopleAt(ops);
  if (Math.hypot(p.x - g.x, p.z - g.z) > 420) return { ok: false, why: '' };
  if (p.agl > DROP_MAX_AGL) return { ok: false, why: 'TOO HIGH' };
  return { ok: true, why: '' };
}

/** Let a raft go: it leaves the aircraft with the aircraft's speed. */
export function dropItem(ops: HandoffOps, p: Mover, spotted: boolean): HandoffEvent[] {
  if (!canDropItem(ops, p, spotted).ok) return [];
  ops.drops--;
  ops.dropped.push({ x: p.x, y: p.y - 2, z: p.z, vx: p.vx, vy: 0, vz: p.vz, state: 'falling', s: 0, side: 0, yaw: Math.atan2(-p.vx, -p.vz) });
  return ['drop-away'];
}

/** They have been found: with nothing to drop, the ground vehicle goes now. */
export function found(ops: HandoffOps): void {
  if (ops.drops === 0 && ops.handoffIn < 0 && ops.phase === 'air') ops.handoffIn = HANDOFF;
}

/** The drift for people and rafts: down the river, easing off the banks. */
function drift(s: number, side: number, share: number, dt: number): { s: number; side: number } {
  return { s: s + CURRENT * share * dt, side: side * (1 - 0.04 * dt) };
}

/**
 * Advance it: the drift, falling rafts, the clock, the hand-off, and getting
 * them aboard. `ground`: the ground vehicle's position and speed once it has
 * taken over.
 */
export function tickHandoff(ops: HandoffOps, t: number, dt: number, ground: { x: number; z: number; speed: number } | null, pullMult = 1): HandoffEvent[] {
  const ev: HandoffEvent[] = [];
  const sp = ops.spec;
  const river = sp.river;
  // on the river the people drift; a raft they are in carries them
  if (river) {
    const d = drift(ops.s, ops.side, river.drift, dt);
    ops.s = d.s;
    ops.side = d.side;
  }
  const g = peopleAt(ops);
  for (const [i, r] of ops.dropped.entries()) {
    if (r.state === 'falling') {
      r.vy -= G * dt;
      const k = Math.exp(-AIR_DRAG * dt);
      r.vx *= k;
      r.vz *= k;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      if (r.y <= WATER_LEVEL + 0.3) {
        r.y = WATER_LEVEL + 0.3;
        r.state = 'floating';
        const at = riverAt(r.x, r.z);
        r.s = at.s;
        r.side = Math.max(-26, Math.min(26, at.side));
        const miss = Math.hypot(r.x - g.x, r.z - g.z);
        ops.landings.push(miss);
        if (miss <= sp.reach && ops.caught < 0) {
          ops.caught = i;
          ev.push('drop-landed', 'caught');
        } else ev.push('drop-missed');
        if (ops.caught >= 0 || ops.drops === 0) ops.handoffIn = HANDOFF;
      }
    } else if (river) {
      // a raft drifts (an empty one a little quicker: nobody dragging in the water)
      const q = drift(r.s, r.side, river.drift * (i === ops.caught ? 1 : 1.1), dt);
      r.s = q.s;
      r.side = q.side;
      const p = riverPoint(r.s, r.side);
      r.x = p.x;
      r.z = p.z;
      r.yaw += dt * (i === ops.caught ? 0.15 : 0.3);
    }
  }
  // the people swim over to a raft that landed close, and ride it from then on
  if (ops.caught >= 0) {
    const r = ops.dropped[ops.caught];
    const k = Math.min(1, dt * 1.5);
    ops.s += (r.s - ops.s) * k;
    ops.side += (r.side - ops.side) * k;
  }
  // the clock, until they are in a raft (or aboard)
  if (sp.clock > 0 && ops.caught < 0 && ops.pull < 1) {
    ops.clock = Math.max(0, ops.clock - dt);
    if (!ops.clockWarned && ops.clock < 45) {
      ops.clockWarned = true;
      ev.push('clock-warn');
    }
    if (ops.clock <= 0) {
      ev.push('clock-out');
      return ev;
    }
  }
  // the hand-off: the aircraft's part is done, the ground vehicle goes
  if (ops.phase === 'air' && ops.handoffIn >= 0) {
    ops.handoffIn -= dt;
    if (ops.handoffIn < 0) {
      ops.phase = 'ground';
      ops.groundT = t;
      ev.push('handoff');
    }
  }
  // alongside: the crew gets them aboard
  const pk = PICKUP[sp.vehicle];
  if (ops.phase === 'ground' && ground && ops.pull < 1) {
    const dist = Math.hypot(ground.x - g.x, ground.z - g.z);
    const time = pk.time * pullMult;
    if (dist < pk.range && ground.speed < pk.speed) {
      if (ops.pull === 0) ev.push('pulling');
      ops.pull = Math.min(1, ops.pull + dt / time);
      if (ops.pull >= 1) ev.push('picked-up');
    } else if (dist > pk.lost && ops.pull > 0) ops.pull = Math.max(0, ops.pull - dt / time);
  }
  return ev;
}

/** How close the best raft landed (m), or null when none has. */
export const bestLanding = (ops: HandoffOps): number | null => (ops.landings.length ? Math.min(...ops.landings) : null);

/** Everyone aboard, close enough to home and slow enough to stop there. */
export function canArrive(ops: HandoffOps, v: { x: number; z: number; speed: number }): boolean {
  const h = ops.spec.home;
  const pk = PICKUP[ops.spec.vehicle];
  return ops.pull >= 1 && Math.hypot(v.x - h.x, v.z - h.z) < pk.homeRange && v.speed < pk.homeSpeed;
}

/** Is there a ramp under this point? */
export function rampAt(spec: HandoffSpec, x: number, z: number): boolean {
  return !!spec.ramps?.some((r) => Math.hypot(x - r.x, z - r.z) < 3.5);
}

/** Is there a rapid under this point? (A band of white water across the river.) */
export function rapidAt(spec: HandoffSpec, x: number, z: number): boolean {
  if (!spec.rapids?.length) return false;
  const r = riverAt(x, z);
  return spec.rapids.some((s) => Math.abs(r.s - s) < 4);
}
