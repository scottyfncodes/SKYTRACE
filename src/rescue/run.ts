/**
 * One rescue, from lift-off to the debrief: what stage it is in, who is where,
 * the fuel, and what to do next. Pure and tested; the game feeds it the
 * helicopter's position and acts on the events it returns.
 *
 *   takeoff → search → rescue (hover + hoist) → return → complete
 *      ↑________________ more people still out there _____|
 */
import { placeSurvivors, type Survivor } from './hoist';
import { escapeDone, newEscape, tickEscape, type EscapeState } from './route';
import { newScan, nextContact, tickScan, type ScanState } from './recon';
import type { Plan } from './loadout';
import type { MissionDef } from './missions';
import { PADS, type PadId } from '../world/worldData';
import { forestAt, getHeightField } from '../world/terrain';
import { cellX, cellZ, BURNING, type TerrainSampler } from '../fire/fireSim';
import { newFireOps, nearestThreat, RELOAD, THREAT_WORDS, threatLevel, tickFire, type FireEvent, type FireOps } from '../fire/fireRun';
import { found, newHandoff, peopleAt, tickHandoff, type HandoffEvent, type HandoffOps } from './handoff';

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
  /** The escape route home, flown once everyone is aboard (null: none on this call). */
  escape: EscapeState | null;
  /** Times the aircraft was flown into the ground. */
  scrapes: number;
  /** Mission time when they were found (null: not yet). */
  foundAt: number | null;
  /** People lifted into the basket and reeled in. */
  lifts: number;
  /** Times someone had to step back from a basket that moved away. */
  stepBacks: number;
  /** Recon: which contacts have been identified (null: this call has none). */
  scan: ScanState | null;
  /** The contact identified most recently (for the radio). */
  lastIdentified: number;
  /** A water rescue: the river, the rafts, the hand-off to the boat. */
  handoff: HandoffOps | null;
}

export type RunEvent = 'cleared' | 'gate' | 'gate-missed' | 'escape-done' | 'off-route' | 'on-route' | 'airborne' | 'signal' | 'spotted' | 'cabin-full' | 'all-aboard' | 'low-fuel' | 'out-of-fuel' | 'delivered' | 'complete' | FireEvent | HandoffEvent;

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
    survivors: placeSurvivors(def.site, def.survivors, def.spots),
    capacity: plan.capacity,
    bumps: 0,
    trips: 0,
    lowFuelWarned: false,
    failReason: null,
    endTime: 0,
    ops: def.fire ? newFireOps(def.fire, def.wind, terrain, plan.attack, plan.fillMult) : null,
    escape: def.escape ? newEscape(def.escape, terrain.height) : null,
    scrapes: 0,
    foundAt: null,
    lifts: 0,
    stepBacks: 0,
    scan: def.contacts ? newScan(def.contacts) : null,
    lastIdentified: -1,
    handoff: def.handoff ? newHandoff(def.handoff) : null,
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
  /** Altitude (m, world): the escape gates need it. */
  y?: number;
  /** Heading (rad): recon looks along the nose. */
  yaw?: number;
  /** Ground velocity (m/s), for where dropped water lands. */
  vx?: number;
  vz?: number;
}

export function distToSite(r: RunState, p: { x: number; z: number }): number {
  return Math.hypot(p.x - r.def.site.x, p.z - r.def.site.z);
}

/**
 * Where the next lift happens: the spot of the waiting person nearest to
 * `p` (usually everyone stands together; on some calls one is elsewhere).
 * Falls back to the site.
 */
export function hoistSpot(r: RunState, p: { x: number; z: number }): { x: number; z: number } {
  let best: { x: number; z: number } = r.def.site;
  let bd = Infinity;
  for (const s of r.survivors) {
    if (s.state !== 'waiting' && s.state !== 'walking' && s.state !== 'boarding') continue;
    const d = Math.hypot(p.x - s.homeX, p.z - s.homeZ);
    if (d < bd) {
      bd = d;
      best = { x: s.homeX, z: s.homeZ };
    }
  }
  return best;
}

export const distToSpot = (r: RunState, p: { x: number; z: number }): number => {
  const s = hoistSpot(r, p);
  return Math.hypot(p.x - s.x, p.z - s.z);
};

/** Advance the rescue. `hoisting`: the helicopter is in a hover over the site. */
export function tickRun(r: RunState, p: Where, dt: number, plan: Pick<Plan, 'spotMult'> & Partial<Pick<Plan, 'pullMult'>>, hoisting: boolean): RunEvent[] {
  if (over(r)) return [];
  const ev: RunEvent[] = [];
  r.t += dt;
  r.fuel = Math.max(0, r.fuel - dt);
  if (r.stage === 'takeoff' && p.agl > 18) {
    r.stage = r.def.survivors === 0 ? 'attack' : r.spotted ? 'rescue' : 'search';
    ev.push('airborne');
  }
  if (r.handoff) return tickHandoffRun(r, p, dt, plan, ev);
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
  if (r.scan && r.def.contacts) {
    // recon: they are found by identifying the right contact, not by flying near
    if (!r.signalled && r.stage !== 'takeoff' && r.def.contacts.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 420)) {
      r.signalled = true;
      ev.push('signal');
    }
    if (!r.spotted && p.yaw !== undefined && r.stage !== 'takeoff') {
      for (const e of tickScan(r.def.contacts, r.scan, { x: p.x, z: p.z, yaw: p.yaw, agl: p.agl }, dt, plan.spotMult)) {
        r.lastIdentified = e.index;
        if (e.type === 'cleared') ev.push('cleared');
        else {
          r.spotted = true;
          r.signalled = true;
          r.foundAt = r.t;
          if (r.stage === 'search') r.stage = 'rescue';
          ev.push('spotted');
        }
      }
    }
  } else if (!r.signalled && r.def.signal !== 'none' && d < r.def.signalRange) {
    r.signalled = true;
    ev.push('signal');
  }
  if (!r.scan && !r.spotted && d < r.def.spotRange * plan.spotMult) {
    r.spotted = true;
    r.signalled = true;
    r.foundAt = r.t;
    if (r.stage === 'search') r.stage = 'rescue';
    ev.push('spotted');
  }
  if (r.stage === 'rescue' && !hoisting && aboard(r) > 0 && (cabinFull(r) || waiting(r) === 0)) {
    r.stage = 'return';
    ev.push(waiting(r) === 0 ? 'all-aboard' : 'cabin-full');
  }
  if (escaping(r) && p.y !== undefined) {
    for (const e of tickEscape(r.escape!, { x: p.x, y: p.y, z: p.z }, r.t, dt)) ev.push(e.type);
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

/**
 * A two-vehicle rescue's stages: search (the aircraft finds them), rescue
 * (the raft, then the boat or the bike alongside), return (the run home
 * through the arches). On the river the people drift all the way.
 */
function tickHandoffRun(r: RunState, p: Where, dt: number, plan: Pick<Plan, 'spotMult'> & Partial<Pick<Plan, 'pullMult'>>, ev: RunEvent[]): RunEvent[] {
  const w = r.handoff!;
  const g = peopleAt(w);
  const n = r.survivors.length;
  r.survivors.forEach((s, i) => {
    if (s.state !== 'waiting') return;
    const off = (i - (n - 1) / 2) * 2.4;
    s.x = s.homeX = g.x + off;
    s.z = s.homeZ = g.z + off * 0.5;
  });
  const d = Math.hypot(p.x - g.x, p.z - g.z);
  if (!r.signalled && r.stage === 'search' && r.def.signal !== 'none' && d < r.def.signalRange) {
    r.signalled = true;
    ev.push('signal');
  }
  if (!r.spotted && r.stage === 'search' && d < r.def.spotRange * plan.spotMult) {
    r.spotted = true;
    r.signalled = true;
    r.foundAt = r.t;
    r.stage = 'rescue';
    found(w);
    ev.push('spotted');
  }
  const ground = w.phase === 'ground' ? { x: p.x, z: p.z, speed: p.speed } : null;
  for (const e of tickHandoff(w, r.t, dt, ground, plan.pullMult ?? 1)) {
    ev.push(e);
    if (e === 'clock-out') {
      fail(r, 'The cold got them before help did.');
      return ev;
    }
    if (e === 'handoff') {
      // the boat (or the bike) brings its own tank
      r.fuel = r.fuelMax = Math.max(r.fuelMax, 360);
      r.lowFuelWarned = false;
    }
    if (e === 'picked-up') {
      for (const s of r.survivors) if (s.state === 'waiting') s.state = 'aboard';
      r.lifts = n;
      r.stage = 'return';
      ev.push('all-aboard');
    }
  }
  if (escaping(r) && p.y !== undefined) {
    for (const e of tickEscape(r.escape!, { x: p.x, y: p.y, z: p.z }, r.t, dt)) ev.push(e.type);
  }
  if (!r.lowFuelWarned && r.fuel < r.fuelMax * 0.25) {
    r.lowFuelWarned = true;
    ev.push('low-fuel');
  }
  if (r.fuel <= 0) {
    fail(r, w.phase === 'air' ? 'Out of fuel. Search Two is taking over.' : w.spec.vehicle === 'boat' ? 'Out of fuel. The second boat is on its way.' : 'Out of fuel. The second bike is on its way.');
    ev.push('out-of-fuel');
  }
  return ev;
}

/** Everyone is aboard and the escape route is still to fly. */
export const escaping = (r: RunState): boolean => r.stage === 'return' && !!r.escape && !escapeDone(r.escape) && waiting(r) === 0;

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
  if (distToSpot(r, p) > HOIST_ZONE) return { ok: false, why: '' };
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

export type TargetKind = 'search' | 'site' | 'pad' | 'fire' | 'water' | 'base' | 'gate';

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

/** What to do next on a water rescue. */
export function handoffObjective(r: RunState, beacon = false): Objective {
  const w = r.handoff!;
  const def = r.def;
  const g = peopleAt(w);
  const boat = w.spec.vehicle === 'boat';
  const who = { x: g.x, z: g.z, kind: 'site' as const, label: w.caught >= 0 ? 'RAFT' : boat ? 'SWIMMERS' : def.survivors === 1 ? 'HIKER' : 'THEM' };
  const home = w.spec.home;
  const ride = boat ? 'The Rescue Boat' : 'The Trail Bike';
  switch (r.stage) {
    case 'takeoff':
      return { icon: '✈️', title: 'AIRBORNE', detail: def.place, target: null };
    case 'search':
      if (boat) return { icon: '🔎', title: 'FIND THEM', detail: 'Fly low along the river', target: { x: def.search.x, z: def.search.z, kind: 'search', label: 'SEARCH AREA' } };
      if (beacon) return { icon: '📡', title: def.survivors === 1 ? 'FIND THE HIKER' : 'FIND THEM', detail: 'Follow the beacon', target: { x: g.x, z: g.z, kind: 'site', label: 'BEACON' } };
      return { icon: '🔎', title: def.survivors === 1 ? 'FIND THE HIKER' : 'FIND THEM', detail: r.signalled ? 'Look for the smoke' : `Search ${def.place}`, target: { x: def.search.x, z: def.search.z, kind: 'search', label: 'SEARCH AREA' } };
    case 'rescue':
      if (w.phase === 'air') {
        if (w.dropped.some((d) => d.state === 'falling')) return { icon: '🛶', title: 'RAFT AWAY!', detail: 'Watch it fall', target: who };
        if (w.caught >= 0) return { icon: '🛶', title: "THEY'RE IN THE RAFT", detail: `${ride} is launching`, target: null };
        if (w.drops === 0) return { icon: '🚤', title: w.spec.drops > 0 ? 'NO RAFT' : 'FOUND!', detail: `${ride} is on its way`, target: null };
        return { icon: '🛶', title: 'DROP THE RAFT', detail: `${w.drops} ${w.drops === 1 ? 'raft' : 'rafts'} · low pass, lead them`, target: who };
      }
      if (boat) {
        if (w.pull > 0) return { icon: '🚤', title: 'PULLING THEM IN', detail: 'Stay alongside', target: who };
        return { icon: '🚤', title: 'GET ALONGSIDE', detail: `${w.caught >= 0 ? 'In the raft' : 'In the water'} · slow down next to them`, target: who };
      }
      if (w.pull > 0) return { icon: '🏍️', title: 'CLIMBING ON', detail: 'Hold it there', target: who };
      return { icon: '🏍️', title: 'RIDE IN', detail: 'Up the trail · stop right next to her', target: who };
    case 'return':
      if (escaping(r)) {
        const e = r.escape!;
        const gate = e.gates[e.next];
        return { icon: '🏁', title: e.def.name.toUpperCase(), detail: `Arch ${e.next + 1} of ${e.gates.length} · ${aboard(r)} aboard`, target: { x: gate.x, z: gate.z, kind: 'gate', label: `ARCH ${e.next + 1}` } };
      }
      if (boat) return { icon: '⚓', title: 'BACK TO THE STATION', detail: `${aboard(r)} aboard · ease in to the jetty`, target: { x: home.x, z: home.z, kind: 'pad', label: 'BOAT STATION' } };
      return { icon: '🚑', title: 'TO THE AMBULANCE', detail: `${home.name} · pull up beside it`, target: { x: home.x, z: home.z, kind: 'pad', label: 'AMBULANCE' } };
    case 'complete':
      return { icon: '✅', title: 'RESCUE COMPLETE', detail: '', target: null };
    default:
      return { icon: '⚠️', title: 'MISSION FAILED', detail: r.failReason ?? '', target: null };
  }
}

/** `beacon`: a beacon receiver is fitted, and points at them while you search. */
export function objective(r: RunState, hoisting: boolean, beacon = false, pos?: { x: number; z: number }): Objective {
  const def = r.def;
  if (r.handoff) return handoffObjective(r, beacon);
  const who = def.survivors === 1 ? (def.look === 'hiker' ? 'THE HIKER' : 'THEM') : def.look === 'climber' ? 'THE CLIMBERS' : 'THEM';
  const pad = PADS[def.deliverTo];
  const spot = pos ? hoistSpot(r, pos) : def.site;
  const site = { x: spot.x, z: spot.z, kind: 'site' as const, label: waiting(r) === 1 ? 'SURVIVOR' : 'SURVIVORS' };
  switch (r.stage) {
    case 'takeoff':
      if (r.def.survivors === 0) return { icon: '🔥', title: 'AIRBORNE', detail: def.place, target: null };
      return { icon: '🚁', title: 'LIFTING OFF', detail: r.trips > 0 ? `Back for the other ${waiting(r) === 1 ? 'one' : waiting(r)}` : def.place, target: null };
    case 'search':
      if (r.scan && def.contacts && def.recon) {
        const i = nextContact(def.contacts, r.scan, pos ?? def.search);
        const left = r.scan.identified.filter((x) => !x).length;
        const c = i >= 0 ? def.contacts[i] : null;
        return { icon: '🔭', title: def.recon.title, detail: `${def.recon.detail} · ${left} to check`, target: c ? { x: c.x, z: c.z, kind: 'search', label: c.label } : null };
      }
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
      if (escaping(r)) {
        const e = r.escape!;
        const g = e.gates[e.next];
        return { icon: '🏁', title: e.def.name.toUpperCase(), detail: `Gate ${e.next + 1} of ${e.gates.length} · ${aboard(r)} aboard`, target: { x: g.x, z: g.z, kind: 'gate', label: `GATE ${e.next + 1}` } };
      }
      return { icon: '🏥', title: 'FLY TO THE HOSPITAL', detail: `${aboard(r)} aboard · land on the H`, target: { x: pad.x, z: pad.z, kind: 'pad', label: 'HOSPITAL' } };
    case 'complete':
      if (r.ops && def.survivors === 0) return { icon: '✅', title: r.ops.outcome === 'contained' ? 'FIRE CONTAINED' : 'FIRE HELD', detail: '', target: null };
      return { icon: '✅', title: 'RESCUE COMPLETE', detail: '', target: null };
    case 'failed':
      return { icon: '⚠️', title: 'MISSION FAILED', detail: r.failReason ?? '', target: null };
  }
}
