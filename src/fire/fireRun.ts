/**
 * Fighting the fire, as part of a mission run: the load you carry, how you
 * drop it, where you fill up, the tanker a spotter leads in, and the fire
 * nobody fought (for the debrief). Pure and tested; the game feeds it where
 * the aircraft is and acts on the events it returns.
 *
 *   Tanker      DROP lays a retardant line along your flight path (2 a load;
 *               reload by flying low over the airfield).
 *   Helicopter  DROP lets the bucket go just ahead of you; fill it again by
 *               hovering low over the river or a dip tank.
 *   Spotter     MARK flies the line you want; Tanker 42 drops along it a few
 *               seconds later (3 calls).
 */
import type { Attack } from '../rescue/catalog';
import type { FireMission } from '../rescue/missions';
import { windAt } from '../rescue/wind';
import { breached, canReach, cloneFire, createFire, dropRetardant, dropWater, fireStats, frontDistance, inArea, stepFire, type FireState, type FireWind, type TerrainSampler, type Threat } from './fireSim';

/** A retardant line is this long and this wide (m). */
export const LINE_LEN = 230;
/** Tanker 42 is a big air tanker: the lines a spotter calls are longer (m). */
export const CALL_LEN = 320;
export const LINE_WIDTH = 40;
/** A bucket of water covers this radius (m) and takes this long to fall (s). */
export const WATER_R = 24;
export const WATER_FALL = 0.9;
/** Highest you can drop from (m above the ground). Generous: aim, not precision. */
export const DROP_AGL: Record<Attack, number> = { retardant: 160, water: 80, lead: 320 };
/** Fill the bucket: this low (m over the surface) and this slow (m/s), for this long (s). */
export const SCOOP_AGL = 18;
export const SCOOP_SPEED = 14;
export const SCOOP_TIME = 3.5;
/** Reload the tanker: low over the airfield. */
export const RELOAD = { x: -810, z: 730, r: 190, agl: 70, time: 3 } as const;
/** Tanker 42: how long after a mark it drops, and how fast it flies the line. */
export const CALL_DELAY = 14;
export const CALL_SPEED = 55;

export const LOAD: Record<Attack, number> = { retardant: 2, water: 1, lead: 3 };

export interface LeadCall {
  pts: [number, number][];
  len: number;
  /** When Tanker 42 starts its drop (run time, s). */
  at: number;
  /** Metres of the line painted so far. */
  painted: number;
}

export interface FireOps {
  fire: FireState;
  /** The same fire, never fought: what would have happened without you. */
  shadow: FireState;
  spec: FireMission;
  attack: Attack | null;
  load: number;
  loadMax: number;
  /** Bucket filling / tanker reloading: 0..1. */
  fill: number;
  fillTime: number;
  drops: number;
  /** A tanker line being laid: where the last piece ended, metres still to go. */
  dropping: { x: number; z: number; left: number } | null;
  /** A spotter marking a line. */
  marking: { pts: [number, number][]; left: number } | null;
  calls: LeadCall[];
  /** Water in the air. */
  falling: { x: number; z: number; at: number }[];
  /** Seconds until ground crews take over (hold missions). */
  holdLeft: number;
  /** 0..1: how close the fire is to the nearest place it threatens (1: there). */
  threat: number;
  maxThreat: number;
  startDist: number[];
  contained: boolean;
  /** How the fire ended: put out or cut off, or held until the crews arrived. */
  outcome: 'contained' | 'held' | null;
  /** The place the fire reached (a loss). */
  lost: Threat | null;
  arrived: boolean;
  lineHeld: boolean;
  /** Cells retardant has stopped, last we looked. */
  heldCells: number;
  threatLevel: number;
  checkIn: number;
  spotFires: number;
}

export type FireEvent =
  | 'over-fire'
  | 'drop'
  | 'line-laid'
  | 'water-hit'
  | 'water-missed'
  | 'empty'
  | 'filling'
  | 'full'
  | 'reloaded'
  | 'mark-start'
  | 'marked'
  | 'tanker-drop'
  | 'spot-fire'
  | 'line-holding'
  | 'threat-up'
  | 'contained'
  | 'held'
  | 'breached';

export interface FireWhere {
  x: number;
  z: number;
  agl: number;
  speed: number;
  /** Ground velocity (m/s): water carries on forward as it falls. */
  vx?: number;
  vz?: number;
}

/** The wind the fire feels (the mission's wind with its gusts). */
export const fireWind = (w: { speed: number; from: number; gust: number }, t: number): FireWind => windAt(w, t);

export function newFireOps(spec: FireMission, wind: { speed: number; from: number; gust: number }, T: TerrainSampler, attack: Attack | null, fillMult = 1): FireOps {
  const fire = createFire(spec, T);
  // the fire has a head start: it was burning before anyone called it in
  for (let t = 0; t < spec.head; t += 1) stepFire(fire, fireWind(wind, t - spec.head), 1);
  const startDist = spec.threats.map((th) => Math.max(1, frontDistance(fire, th)));
  return {
    fire,
    shadow: cloneFire(fire),
    spec,
    attack,
    load: attack ? LOAD[attack] : 0,
    loadMax: attack ? LOAD[attack] : 0,
    fill: 0,
    fillTime: (attack === 'retardant' ? RELOAD.time : SCOOP_TIME) * fillMult,
    drops: 0,
    dropping: null,
    marking: null,
    calls: [],
    falling: [],
    holdLeft: spec.hold,
    threat: 0,
    maxThreat: 0,
    startDist,
    contained: false,
    outcome: null,
    lost: null,
    arrived: false,
    lineHeld: false,
    heldCells: 0,
    threatLevel: 0,
    checkIn: 0,
    spotFires: 0,
  };
}

const segLen = (pts: [number, number][]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Where along a polyline `d` metres in (clamped). */
export function along(pts: [number, number][], d: number): { x: number; z: number; dx: number; dz: number } {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az) || 1e-6;
    if (left <= L || i === pts.length - 1) {
      const t = Math.min(1, left / L);
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / L, dz: (bz - az) / L };
    }
    left -= L;
  }
  const p = pts[0];
  return { x: p[0], z: p[1], dx: 0, dz: -1 };
}

/** Paint a polyline from d0 to d1 metres in. */
function paint(f: FireState, pts: [number, number][], d0: number, d1: number): void {
  const step = 8;
  for (let d = d0; d < d1; d += step) {
    const a = along(pts, d);
    const b = along(pts, Math.min(d1, d + step));
    dropRetardant(f, a.x, a.z, b.x, b.z, LINE_WIDTH);
  }
}

/** Is there water to fill from here? */
export function waterUnder(ops: FireOps, p: { x: number; z: number }): { name: string; x: number; z: number; r: number } | null {
  return ops.spec.water.find((w) => Math.hypot(p.x - w.x, p.z - w.z) < w.r) ?? null;
}

export const canFill = (ops: FireOps, p: FireWhere): boolean => {
  if (ops.attack === 'water') return ops.load < ops.loadMax && !!waterUnder(ops, p) && p.agl < SCOOP_AGL && p.speed < SCOOP_SPEED;
  if (ops.attack === 'retardant') return ops.load < ops.loadMax && Math.hypot(p.x - RELOAD.x, p.z - RELOAD.z) < RELOAD.r && p.agl < RELOAD.agl;
  return false;
};

export interface FireAction {
  ok: boolean;
  /** Why not, in two or three words (empty: nothing to say). */
  why: string;
}

/** Can the fire button do its thing right now? */
export function canFireAction(ops: FireOps, p: FireWhere, busy = false): FireAction {
  const a = ops.attack;
  if (!a || busy) return { ok: false, why: '' };
  if (ops.dropping || ops.marking) return { ok: false, why: '' };
  if (ops.load <= 0) return { ok: false, why: a === 'lead' ? 'NO CALLS LEFT' : a === 'water' ? 'BUCKET EMPTY' : 'TANKS EMPTY' };
  if (!inArea(ops.fire, p.x, p.z, 40)) return { ok: false, why: '' };
  if (p.agl > DROP_AGL[a]) return { ok: false, why: 'TOO HIGH' };
  return { ok: true, why: '' };
}

/** Press the fire button: drop, or start marking a line. */
export function fireAction(ops: FireOps, p: FireWhere, now: number, busy = false): FireEvent[] {
  if (!canFireAction(ops, p, busy).ok) return [];
  ops.drops++;
  if (ops.attack === 'retardant') {
    ops.dropping = { x: p.x, z: p.z, left: LINE_LEN };
    return ['drop'];
  }
  if (ops.attack === 'water') {
    ops.load = 0;
    ops.falling.push({ x: p.x + (p.vx ?? 0) * WATER_FALL, z: p.z + (p.vz ?? 0) * WATER_FALL, at: now + WATER_FALL });
    return ['drop', 'empty'];
  }
  ops.marking = { pts: [[p.x, p.z]], left: CALL_LEN };
  return ['mark-start'];
}

/** Advance the fire and everything acting on it. `people`: someone is still waiting where the fire is going. */
export function tickFire(ops: FireOps, p: FireWhere, now: number, dt: number, wind: { speed: number; from: number; gust: number }, people = true): FireEvent[] {
  if (ops.outcome || ops.lost) return [];
  const ev: FireEvent[] = [];
  const f = ops.fire;
  const w = fireWind(wind, now);
  if (!ops.arrived && inArea(f, p.x, p.z, 20)) {
    ops.arrived = true;
    ev.push('over-fire');
  }
  // the tanker's line goes down along the path you fly
  if (ops.dropping) {
    const d = ops.dropping;
    const moved = Math.hypot(p.x - d.x, p.z - d.z);
    if (moved > 0) {
      dropRetardant(f, d.x, d.z, p.x, p.z, LINE_WIDTH);
      d.left -= moved;
      d.x = p.x;
      d.z = p.z;
    }
    if (d.left <= 0) {
      ops.dropping = null;
      ops.load--;
      ev.push('line-laid');
      if (ops.load <= 0) ev.push('empty');
    }
  }
  // the spotter's mark
  if (ops.marking) {
    const m = ops.marking;
    const last = m.pts[m.pts.length - 1];
    const moved = Math.hypot(p.x - last[0], p.z - last[1]);
    if (moved >= 6) {
      m.pts.push([p.x, p.z]);
      m.left -= moved;
    }
    if (m.left <= 0 || !inArea(f, p.x, p.z, 80)) {
      ops.marking = null;
      const len = segLen(m.pts);
      if (len >= 40) {
        ops.calls.push({ pts: m.pts, len, at: now + CALL_DELAY, painted: 0 });
        ops.load--;
        ev.push('marked');
      } else ops.drops--;
    }
  }
  // Tanker 42 flies the marked lines
  for (const c of ops.calls) {
    if (now < c.at || c.painted >= c.len) continue;
    if (c.painted === 0) ev.push('tanker-drop');
    const to = Math.min(c.len, (now - c.at) * CALL_SPEED);
    paint(f, c.pts, c.painted, to);
    c.painted = to;
    if (to >= c.len) ev.push('line-laid');
  }
  // water lands
  for (let i = ops.falling.length - 1; i >= 0; i--) {
    const wd = ops.falling[i];
    if (now < wd.at) continue;
    ops.falling.splice(i, 1);
    ev.push(dropWater(f, wd.x, wd.z, WATER_R) > 0 ? 'water-hit' : 'water-missed');
  }
  // filling up
  if (canFill(ops, p)) {
    if (ops.fill === 0) ev.push('filling');
    ops.fill += dt / ops.fillTime;
    if (ops.fill >= 1) {
      ops.fill = 0;
      ops.load = ops.loadMax;
      ev.push(ops.attack === 'retardant' ? 'reloaded' : 'full');
    }
  } else ops.fill = 0;
  // the fire moves (and so does the one nobody fought)
  const spots = stepFire(f, w, dt);
  stepFire(ops.shadow, w, dt);
  if (spots.length) {
    ops.spotFires += spots.length;
    ev.push('spot-fire');
  }
  // the line is holding: the front has run into retardant
  let held = 0;
  for (let k = 0; k < f.held.length; k++) held += f.held[k];
  if (held > ops.heldCells + 2 && !ops.lineHeld) {
    ops.lineHeld = true;
    ev.push('line-holding');
  }
  ops.heldCells = held;
  // how close it is to the places it threatens
  ops.threat = Math.max(...ops.spec.threats.map((th, i) => 1 - Math.min(1, frontDistance(f, th) / ops.startDist[i])));
  if (!people) ops.threat = 0;
  ops.maxThreat = Math.max(ops.maxThreat, ops.threat);
  const level = threatLevel(ops.threat);
  if (level > ops.threatLevel && level >= 2) ev.push('threat-up');
  ops.threatLevel = level;
  const hit = people ? ops.spec.threats.find((th) => breached(f, th)) : undefined;
  if (hit) {
    ops.lost = hit;
    ev.push('breached');
    return ev;
  }
  if (ops.spec.hold > 0) {
    ops.holdLeft = Math.max(0, ops.holdLeft - dt);
    // contained: nothing left burning, or no way left for it to reach anyone
    ops.checkIn -= dt;
    if (ops.checkIn <= 0) {
      ops.checkIn = 1;
      ops.contained = fireStats(f).burning === 0 || ops.spec.threats.every((th) => !canReach(f, th));
    }
    if (ops.contained) {
      ops.outcome = 'contained';
      ev.push('contained');
    } else if (ops.holdLeft <= 0) {
      ops.outcome = 'held';
      ev.push('held');
    }
  }
  return ev;
}

export const THREAT_WORDS = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'] as const;
export const threatLevel = (t: number): number => (t < 0.35 ? 0 : t < 0.6 ? 1 : t < 0.85 ? 2 : 3);

/** The place the fire is closest to. */
export function nearestThreat(ops: FireOps): Threat {
  let best = ops.spec.threats[0];
  let bd = Infinity;
  for (const th of ops.spec.threats) {
    const d = frontDistance(ops.fire, th);
    if (d < bd) {
      bd = d;
      best = th;
    }
  }
  return best;
}
