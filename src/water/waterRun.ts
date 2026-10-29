/**
 * A water rescue, in two vehicles. The Search Aircraft finds the people in
 * the river and drops them a raft on a low pass (where it lands depends on
 * your height and speed: lead them). Then the Rescue Boat races out from the
 * boat station, swings alongside, and the crew pulls them in. The river
 * carries everyone downstream the whole time, and the cold water is the
 * clock until they have a raft. Pure, deterministic, tested.
 */
import { WATER_LEVEL } from '../world/worldData';
import { CURRENT, riverAt, riverPoint } from './river';

export interface WaterSpec {
  /** Where they went in: metres along the river and off its centre line. */
  s: number;
  side: number;
  /** They drift at this share of the current. */
  drift: number;
  /** Seconds in the cold water before they cannot hold on (a raft stops the clock). */
  cold: number;
  /** Rafts aboard the aircraft. */
  rafts: number;
  /** A raft landing within this of them is close enough to swim to (m). */
  reach: number;
  /** Where the Rescue Boat waits, and where it brings them back to. */
  station: { name: string; x: number; z: number; yaw: number };
  /** Rapids: metres along the river. At speed the boat flies off them. */
  rapids: readonly number[];
}

export type RaftState = 'falling' | 'floating';

export interface Raft {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  state: RaftState;
  /** Floating: where on the river it is (it drifts). */
  s: number;
  side: number;
  yaw: number;
}

export interface WaterOps {
  spec: WaterSpec;
  /** The aircraft finds them and drops the raft; then the boat. */
  phase: 'air' | 'boat';
  /** The people: where on the river they are. */
  s: number;
  side: number;
  /** Seconds of cold left. */
  cold: number;
  coldWarned: boolean;
  rafts: number;
  /** Every raft dropped, in the air or on the water. */
  dropped: Raft[];
  /** They are in a raft (the index of it in `dropped`). */
  rafted: number;
  /** Distance from them of each raft that landed (m). */
  landings: number[];
  /** Seconds until the boat takes over (counts down once the drops are done). */
  handoffIn: number;
  /** Pulling them aboard the boat: 0..1. */
  pull: number;
  /** Mission time the boat left the station. */
  boatT: number | null;
}

export type WaterEvent = 'raft-away' | 'raft-landed' | 'raft-missed' | 'rafted' | 'cold-warn' | 'too-cold' | 'handoff' | 'pulling' | 'picked-up';

/** Raft physics: it falls, and the air slows its forward travel. */
const G = 9.8;
const AIR_DRAG = 0.5;
/** Above this a raft drop is too high to place (m). */
export const RAFT_MAX_AGL = 90;
/** The boat can pull them aboard within this of them, under this speed (m, m/s); further than `PULL_LOST` and the line slips. */
export const PULL_RANGE = 16;
export const PULL_SPEED = 10;
const PULL_LOST = 26;
/** Seconds to pull everyone aboard (the paramedic halves it). */
export const PULL_TIME = 2.6;
/** The boat ties up within this of the station, this slow (m, m/s). */
export const DOCK_RANGE = 22;
export const DOCK_SPEED = 7;
/** Seconds between the raft landing (or the last one missing) and the boat taking over. */
const HANDOFF = 3.2;

export function newWater(spec: WaterSpec): WaterOps {
  return { spec, phase: 'air', s: spec.s, side: spec.side, cold: spec.cold, coldWarned: false, rafts: spec.rafts, dropped: [], rafted: -1, landings: [], handoffIn: -1, pull: 0, boatT: null };
}

/** Where the people are now. */
export function swimmers(ops: WaterOps): { x: number; z: number } {
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
export function raftLanding(p: Mover): { x: number; z: number; t: number } {
  const h = Math.max(0, p.y - 2 - WATER_LEVEL);
  const t = Math.sqrt((2 * h) / G);
  const k = (1 - Math.exp(-AIR_DRAG * t)) / AIR_DRAG;
  return { x: p.x + p.vx * k, z: p.z + p.vz * k, t };
}

/** Can a raft go now? (`why`: what is stopping it, for the button.) */
export function canDropRaft(ops: WaterOps, p: Mover, spotted: boolean): { ok: boolean; why: string } {
  if (ops.phase !== 'air' || ops.rafted >= 0 || ops.rafts === 0) return { ok: false, why: '' };
  if (!spotted) return { ok: false, why: '' };
  if (ops.dropped.some((r) => r.state === 'falling')) return { ok: false, why: 'RAFT FALLING' };
  const g = swimmers(ops);
  if (Math.hypot(p.x - g.x, p.z - g.z) > 420) return { ok: false, why: '' };
  if (p.agl > RAFT_MAX_AGL) return { ok: false, why: 'TOO HIGH' };
  return { ok: true, why: '' };
}

/** Let a raft go: it leaves the aircraft with the aircraft's speed. */
export function dropRaft(ops: WaterOps, p: Mover, spotted: boolean): WaterEvent[] {
  if (!canDropRaft(ops, p, spotted).ok) return [];
  ops.rafts--;
  ops.dropped.push({ x: p.x, y: p.y - 2, z: p.z, vx: p.vx, vy: 0, vz: p.vz, state: 'falling', s: 0, side: 0, yaw: Math.atan2(-p.vx, -p.vz) });
  return ['raft-away'];
}

/** The drift for people and rafts: down the river, easing off the banks. */
function drift(s: number, side: number, share: number, dt: number): { s: number; side: number } {
  return { s: s + CURRENT * share * dt, side: side * (1 - 0.04 * dt) };
}

/**
 * Advance the water: the drift, falling rafts, the cold, the hand-off to the
 * boat, and the pull aboard. `boat`: the boat's position and speed once it is
 * on the water.
 */
export function tickWater(ops: WaterOps, t: number, dt: number, boat: { x: number; z: number; speed: number } | null, pullTime = PULL_TIME): WaterEvent[] {
  const ev: WaterEvent[] = [];
  const sp = ops.spec;
  // the people drift; a raft they are in carries them
  const d = drift(ops.s, ops.side, sp.drift, dt);
  ops.s = d.s;
  ops.side = d.side;
  const g = swimmers(ops);
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
        if (miss <= sp.reach && ops.rafted < 0) {
          ops.rafted = i;
          ev.push('raft-landed', 'rafted');
        } else ev.push('raft-missed');
        if (ops.rafted >= 0 || ops.rafts === 0) ops.handoffIn = HANDOFF;
      }
    } else {
      // a raft drifts (an empty one a little quicker: nobody dragging in the water)
      const q = drift(r.s, r.side, sp.drift * (i === ops.rafted ? 1 : 1.1), dt);
      r.s = q.s;
      r.side = q.side;
      const p = riverPoint(r.s, r.side);
      r.x = p.x;
      r.z = p.z;
      r.yaw += dt * (i === ops.rafted ? 0.15 : 0.3);
    }
  }
  // the people swim over to a raft that landed close, and ride it from then on
  if (ops.rafted >= 0) {
    const r = ops.dropped[ops.rafted];
    const k = Math.min(1, dt * 1.5);
    ops.s += (r.s - ops.s) * k;
    ops.side += (r.side - ops.side) * k;
  }
  // the cold, until they are in a raft (or the boat has them)
  if (ops.rafted < 0 && ops.pull < 1) {
    ops.cold = Math.max(0, ops.cold - dt);
    if (!ops.coldWarned && ops.cold < 45) {
      ops.coldWarned = true;
      ev.push('cold-warn');
    }
    if (ops.cold <= 0) {
      ev.push('too-cold');
      return ev;
    }
  }
  // the hand-off: the aircraft's part is done, the boat goes
  if (ops.phase === 'air' && ops.handoffIn >= 0) {
    ops.handoffIn -= dt;
    if (ops.handoffIn < 0) {
      ops.phase = 'boat';
      ops.boatT = t;
      ev.push('handoff');
    }
  }
  // alongside in the boat: the crew pulls them in
  if (ops.phase === 'boat' && boat && ops.pull < 1) {
    const dist = Math.hypot(boat.x - g.x, boat.z - g.z);
    if (dist < PULL_RANGE && boat.speed < PULL_SPEED) {
      if (ops.pull === 0) ev.push('pulling');
      ops.pull = Math.min(1, ops.pull + dt / pullTime);
      if (ops.pull >= 1) ev.push('picked-up');
    } else if (dist > PULL_LOST && ops.pull > 0) ops.pull = Math.max(0, ops.pull - dt / pullTime);
  }
  return ev;
}

/** How close the best raft landed (m), or null when none has. */
export const bestLanding = (ops: WaterOps): number | null => (ops.landings.length ? Math.min(...ops.landings) : null);

/** Close enough to the station, slow enough, to tie up. */
export function canDock(ops: WaterOps, boat: { x: number; z: number; speed: number }): boolean {
  const st = ops.spec.station;
  return ops.pull >= 1 && Math.hypot(boat.x - st.x, boat.z - st.z) < DOCK_RANGE && boat.speed < DOCK_SPEED;
}

/** Is there a rapid under this point? (A band of white water across the river.) */
export function rapidAt(spec: WaterSpec, x: number, z: number): boolean {
  const r = riverAt(x, z);
  return spec.rapids.some((s) => Math.abs(r.s - s) < 4);
}
