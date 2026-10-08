/**
 * One rescue, from lift-off to the debrief: what stage it is in, who is where,
 * the fuel, and what to do next. Pure and tested; the game feeds it the
 * helicopter's position and acts on the events it returns.
 *
 *   takeoff → search → rescue (hover + hoist) → return → complete
 *      ↑________________ more people still out there _____|
 */
import { placeSurvivors, type Survivor } from './hoist';
import type { Plan } from './loadout';
import type { MissionDef } from './missions';
import { PADS, type PadId } from '../world/worldData';
import { forestAt, getHeightField } from '../world/terrain';
import { cellX, cellZ, BURNING, type TerrainSampler } from '../fire/fireSim';
import { newFireOps, nearestThreat, RELOAD, THREAT_WORDS, threatLevel, tickFire, type FireEvent, type FireOps } from '../fire/fireRun';

/**
 * A wildfire call adds the fire to the run: `attack` is the stage you spend
 * fighting it (takeoff → attack → complete), and a fire with people trapped
 * in its path runs alongside the usual rescue stages.
 */
export type Stage = 'takeoff' | 'search' | 'rescue' | 'attack' | 'return' | 'complete' | 'failed';

export interface RunState {
  def: MissionDef;
  stage: Stage;
  /** Seconds since lift-off was cleared. */
  t: number;
  fuel: number;
  fuelMax: number;
  /** The signal (flare, smoke) has gone up. */
  signalled: boolean;
  /** You have seen them. */
  spotted: boolean;
  survivors: Survivor[];
  capacity: number;
  /** Times the basket hit the ground with someone in it. */
  bumps: number;
  /** Round trips to the hospital. */
  trips: number;
  lowFuelWarned: boolean;
  failReason: string | null;
  /** Mission time at the end. */
  endTime: number;
  /** The fire, on a wildfire call. */
  ops: FireOps | null;
}

export type RunEvent = 'airborne' | 'signal' | 'spotted' | 'cabin-full' | 'all-aboard' | 'low-fuel' | 'out-of-fuel' | 'delivered' | 'complete' | FireEvent;

/** Within this of the site, slow enough, you can come into a hover and hoist (m, m/s). */
export const HOIST_ZONE = 60;
export const HOIST_MAX_SPEED = 22;
/** Over the pad, this low and this slow, you land (m, m, m/s). */
export const PAD_RADIUS = 18;
export const LAND_AGL = 14;
export const LAND_SPEED = 9;

let valley: TerrainSampler | null = null;
const valleyTerrain = (): TerrainSampler => {
  if (!valley) {
    const hf = getHeightField();
    valley = { height: (x, z) => hf.sample(x, z), forest: forestAt };
  }
  return valley;
};

export function newRun(def: MissionDef, plan: Plan, terrain: TerrainSampler = valleyTerrain()): RunState {
  const fuel = def.fuel * plan.fuelMult;
  return {
    def,
    stage: 'takeoff',
    t: 0,
    fuel,
    fuelMax: fuel,
    signalled: false,
    spotted: false,
    survivors: placeSurvivors(def.site, def.survivors),
    capacity: plan.capacity,
    bumps: 0,
    trips: 0,
    lowFuelWarned: false,
    failReason: null,
    endTime: 0,
    ops: def.fire ? newFireOps(def.fire, def.wind, terrain, plan.attack, plan.fillMult) : null,
  };
}

export const aboard = (r: RunState): number => r.survivors.filter((s) => s.state === 'aboard' || s.state === 'basket').length;
export const delivered = (r: RunState): number => r.survivors.filter((s) => s.state === 'delivered').length;
/** Still on the ground waiting for the basket. */
export const waiting = (r: RunState): number => r.survivors.filter((s) => s.state === 'waiting' || s.state === 'walking' || s.state === 'boarding').length;
export const cabinFull = (r: RunState): boolean => aboard(r) >= r.capacity;
const over = (r: RunState) => r.stage === 'complete' || r.stage === 'failed';

export interface Where {
  x: number;
  z: number;
  agl: number;
  speed: number;
  /** Ground velocity (m/s), for where dropped water lands. */
  vx?: number;
  vz?: number;
}

export function distToSite(r: RunState, p: { x: number; z: number }): number {
  return Math.hypot(p.x - r.def.site.x, p.z - r.def.site.z);
}

/** Advance the rescue. `hoisting`: the helicopter is in a hover over the site. */
export function tickRun(r: RunState, p: Where, dt: number, plan: Pick<Plan, 'spotMult'>, hoisting: boolean): RunEvent[] {
  if (over(r)) return [];
  const ev: RunEvent[] = [];
  r.t += dt;
  r.fuel = Math.max(0, r.fuel - dt);
  if (r.stage === 'takeoff' && p.agl > 18) {
    r.stage = r.def.survivors === 0 ? 'attack' : r.spotted ? 'rescue' : 'search';
    ev.push('airborne');
  }
  if (r.ops) {
    const fe = tickFire(r.ops, p, r.t, dt, r.def.wind, r.def.survivors === 0 || waiting(r) > 0);
    ev.push(...fe);
    if (fe.includes('breached')) {
      fail(r, `The fire reached ${r.ops.lost!.name}.`);
      return ev;
    }
    if ((fe.includes('contained') || fe.includes('held')) && r.def.survivors === 0) {
      r.stage = 'complete';
      r.endTime = r.t;
      ev.push('complete');
      return ev;
    }
  }
  const d = distToSite(r, p);
  if (!r.signalled && r.def.signal !== 'none' && d < r.def.signalRange) {
    r.signalled = true;
    ev.push('signal');
  }
  if (!r.spotted && d < r.def.spotRange * plan.spotMult) {
    r.spotted = true;
    r.signalled = true;
    if (r.stage === 'search') r.stage = 'rescue';
    ev.push('spotted');
  }
  if (r.stage === 'rescue' && !hoisting && aboard(r) > 0 && (cabinFull(r) || waiting(r) === 0)) {
    r.stage = 'return';
    ev.push(waiting(r) === 0 ? 'all-aboard' : 'cabin-full');
  }
  if (!r.lowFuelWarned && r.fuel < r.fuelMax * 0.25) {
    r.lowFuelWarned = true;
    ev.push('low-fuel');
  }
  if (r.fuel <= 0) {
    fail(r, 'Out of fuel. Rescue Two is taking over.');
    ev.push('out-of-fuel');
  }
  return ev;
}

export function fail(r: RunState, reason: string): void {
  if (over(r)) return;
  r.stage = 'failed';
  r.failReason = reason;
  r.endTime = r.t;
}

/** Can the helicopter come into a hover over them and use the hoist right now? */
export function canHoist(r: RunState, p: Where): { ok: boolean; why: string } {
  if (over(r) || r.stage === 'takeoff') return { ok: false, why: '' };
  if (!r.spotted) return { ok: false, why: 'FIND THEM FIRST' };
  if (waiting(r) === 0) return { ok: false, why: '' };
  if (cabinFull(r)) return { ok: false, why: 'CABIN FULL' };
  if (distToSite(r, p) > HOIST_ZONE) return { ok: false, why: '' };
  if (p.speed > HOIST_MAX_SPEED) return { ok: false, why: 'SLOW DOWN' };
  return { ok: true, why: '' };
}

/** Over a pad, low and slow, with people to drop off. */
export function canLand(r: RunState, p: Where, pad: PadId = r.def.deliverTo): boolean {
  if (over(r) || aboard(r) === 0) return false;
  const P = PADS[pad];
  return Math.hypot(p.x - P.x, p.z - P.z) < PAD_RADIUS && p.agl < LAND_AGL && p.speed < LAND_SPEED;
}

/** Wheels down at the hospital: everyone aboard is handed over. */
export function landAtPad(r: RunState): RunEvent[] {
  if (over(r)) return [];
  let n = 0;
  for (const s of r.survivors)
    if (s.state === 'aboard') {
      s.state = 'delivered';
      n++;
    }
  if (n === 0) return [];
  r.trips++;
  if (delivered(r) === r.survivors.length) {
    r.stage = 'complete';
    r.endTime = r.t;
    return ['delivered', 'complete'];
  }
  // lift off again and go back for the others
  r.stage = 'takeoff';
  return ['delivered'];
}

export interface Objective {
  icon: string;
  title: string;
  detail: string;
  /** Where the nav arrow points. */
  target: { x: number; z: number; kind: TargetKind; label: string } | null;
}

export type TargetKind = 'search' | 'site' | 'pad' | 'fire' | 'water' | 'base';

/** The head of the fire: the burning cell closest to what it threatens. */
export function fireHead(ops: FireOps): { x: number; z: number } | null {
  const th = nearestThreat(ops);
  const f = ops.fire;
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < f.state.length; k++) {
    if (f.state[k] !== BURNING) continue;
    const d = Math.hypot(cellX(f, k) - th.x, cellZ(f, k) - th.z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best < 0 ? null : { x: cellX(f, best), z: cellZ(f, best) };
}

const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** What to do next on a fire. */
export function fireObjective(r: RunState, p: { x: number; z: number }): Objective {
  const ops = r.ops!;
  const th = nearestThreat(ops);
  const status = `${th.name} · ${THREAT_WORDS[threatLevel(ops.threat)]}`;
  const head = fireHead(ops);
  const fireTarget = head ? { ...head, kind: 'fire' as const, label: 'FIRE FRONT' } : null;
  if (ops.dropping) return { icon: '🟥', title: 'DROPPING!', detail: 'Hold your line', target: null };
  if (ops.marking) return { icon: '📍', title: 'FLY THE LINE', detail: 'Tanker 42 will follow you', target: null };
  if (ops.attack === 'water' && ops.load === 0 && ops.falling.length === 0) {
    const w = [...ops.spec.water].sort((a, b) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(p.x - b.x, p.z - b.z))[0];
    return { icon: '💧', title: 'FILL THE BUCKET', detail: `${w.name} · hover low over it`, target: { x: w.x, z: w.z, kind: 'water', label: w.name.toUpperCase() } };
  }
  if (ops.attack === 'retardant' && ops.load === 0) return { icon: '⛽', title: 'RELOAD AT THE AIRFIELD', detail: 'Fly low over the runway', target: { x: RELOAD.x, z: RELOAD.z, kind: 'base', label: 'AIRFIELD' } };
  if (!ops.attack || (ops.attack === 'lead' && ops.load === 0)) {
    const left = ops.spec.hold > 0 ? `Crews in ${clockOf(ops.holdLeft)}` : status;
    return { icon: '👀', title: ops.calls.some((c) => c.painted < c.len) ? 'TANKER 42 INBOUND' : 'WATCH THE FIRE', detail: left, target: fireTarget };
  }
  if (!ops.arrived) return { icon: '🔥', title: 'FLY TO THE FIRE', detail: r.def.place, target: fireTarget };
  const title = ops.attack === 'retardant' ? 'LAY A LINE AHEAD OF IT' : ops.attack === 'water' ? 'DROP ON THE FIRE' : 'MARK A LINE AHEAD OF IT';
  return { icon: ops.attack === 'water' ? '💧' : ops.attack === 'retardant' ? '🟥' : '📍', title, detail: status, target: fireTarget };
}

/** `beacon`: a beacon receiver is fitted, and points at them while you search. */
export function objective(r: RunState, hoisting: boolean, beacon = false, pos?: { x: number; z: number }): Objective {
  const def = r.def;
  const who = def.survivors === 1 ? (def.look === 'hiker' ? 'THE HIKER' : 'THEM') : def.look === 'climber' ? 'THE CLIMBERS' : 'THEM';
  const pad = PADS[def.deliverTo];
  const site = { x: def.site.x, z: def.site.z, kind: 'site' as const, label: def.survivors === 1 ? 'SURVIVOR' : 'SURVIVORS' };
  switch (r.stage) {
    case 'takeoff':
      if (r.def.survivors === 0) return { icon: '🔥', title: 'AIRBORNE', detail: def.place, target: null };
      return { icon: '🚁', title: 'LIFTING OFF', detail: r.trips > 0 ? `Back for the other ${waiting(r) === 1 ? 'one' : waiting(r)}` : def.place, target: null };
    case 'search':
      if (beacon) return { icon: '📡', title: `FIND ${who}`, detail: 'Follow the beacon', target: { ...site, label: 'BEACON' } };
      return { icon: '🔎', title: `FIND ${who}`, detail: r.signalled ? `Look for the ${def.signal === 'smoke' ? 'smoke' : 'flare'}` : `Search ${def.place}`, target: { x: def.search.x, z: def.search.z, kind: 'search', label: 'SEARCH AREA' } };
    case 'rescue': {
      if (hoisting) {
        const left = waiting(r);
        return { icon: '🛟', title: 'LOWER THE BASKET', detail: left === 1 ? 'Hold steady over them' : `${left} people waiting · hold steady`, target: site };
      }
      if (aboard(r) > 0 && waiting(r) > 0 && !cabinFull(r)) return { icon: '🛟', title: 'HOVER OVER THEM', detail: `${waiting(r)} still waiting`, target: site };
      return { icon: '🛟', title: 'HOVER OVER THEM', detail: r.trips > 0 ? `${waiting(r)} still waiting` : 'Slow down and come in above', target: site };
    }
    case 'attack':
      return fireObjective(r, pos ?? { x: def.search.x, z: def.search.z });
    case 'return':
      return { icon: '🏥', title: 'FLY TO THE HOSPITAL', detail: `${aboard(r)} aboard · land on the H`, target: { x: pad.x, z: pad.z, kind: 'pad', label: 'HOSPITAL' } };
    case 'complete':
      if (r.ops && def.survivors === 0) return { icon: '✅', title: r.ops.outcome === 'contained' ? 'FIRE CONTAINED' : 'FIRE HELD', detail: '', target: null };
      return { icon: '✅', title: 'RESCUE COMPLETE', detail: '', target: null };
    case 'failed':
      return { icon: '⚠️', title: 'MISSION FAILED', detail: r.failReason ?? '', target: null };
  }
}
