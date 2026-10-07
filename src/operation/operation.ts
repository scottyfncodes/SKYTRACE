/**
 * The operation: the stages of every SKYTRACE mission, played as three
 * phases (`phases.ts`): RECON (outbound rings, Mission Control), EXECUTE
 * (the drop run) and ESCAPE (the timed rings home).
 *
 *   PREFLIGHT ─launch─▶ OUTBOUND ─gates done─▶ RECON ─▶ EXECUTE ─drop─▶ RETURN ─land─▶ DEBRIEF
 *                         (fly)          (Mission Control)  (fly)          (fly)
 *   RECON ─no target─▶ RETURN;  any flying stage ─fuel / abort─▶ DEBRIEF
 *
 * Pure: `Game` feeds it the aircraft's position each frame and renders the
 * events. The recon objectives themselves live in the mission's rules.
 */
import type { MissionDef } from '../mission/missionDef';
import { CONTACT_PACE, currentGate, inHazard, joinRing, legComplete, newLeg, passLanding, placeRoute, ringOrdinal, rings, startWindow, tickLeg, type AircraftFix, type LegEvent, type LegState, type Route } from './gates';
import { BASE } from '../world/worldData';
import type { Capabilities, Loadout } from './loadout';
import type { FlightPerf } from '../flight/aircraft';
import type { ExecResult } from './phases';

export type Stage = 'preflight' | 'outbound' | 'recon' | 'execute' | 'return' | 'debrief';

export const STAGES: readonly { id: Stage; label: string }[] = [
  { id: 'preflight', label: 'PREFLIGHT' },
  { id: 'outbound', label: 'OUTBOUND' },
  { id: 'recon', label: 'RECON' },
  { id: 'execute', label: 'EXECUTE' },
  { id: 'return', label: 'RETURN' },
  { id: 'debrief', label: 'DEBRIEF' },
];

export interface OperationState {
  stage: Stage;
  loadout: Loadout;
  /** The two legs, placed in the world (the way home is re-placed when recon ends). */
  routes: { outbound: Route; return: Route; execute: Route | null };
  outbound: LegState;
  ret: LegState;
  /** The drop run (null until it starts). */
  exec: LegState | null;
  /** How the drop went: through the ring, wide of it, or never flown. */
  execResult: ExecResult;
  /** Seconds since arriving on station (the recon window runs from here). */
  reconElapsed: number;
  frontArrived: boolean;
  /** Airframe damage 0..1 from weather (1: the aircraft breaks up). */
  damage: number;
  /** Seconds inside storm cells (lightning strikes on a fixed rhythm). */
  stormTime: number;
  outcome: 'landed' | 'fuel' | 'aborted' | 'destroyed' | null;
  /** Seconds since take-off. */
  time: number;
}

type Ground = (x: number, z: number) => number;
const flat: Ground = () => 0;

export function newOperation(def: MissionDef, loadout: Loadout, ground: Ground = flat): OperationState {
  const outbound = placeRoute(def.outbound, ground, BASE);
  const ret = placeRoute(def.return, ground, { x: (def.operations.area.x0 + def.operations.area.x1) / 2, z: (def.operations.area.z0 + def.operations.area.z1) / 2 });
  return { stage: 'preflight', loadout, routes: { outbound, return: ret, execute: null }, outbound: newLeg(outbound), ret: newLeg(ret), exec: null, execResult: null, reconElapsed: 0, frontArrived: false, damage: 0, stormTime: 0, outcome: null, time: 0 };
}

export function launch(op: OperationState): void {
  if (op.stage === 'preflight') op.stage = 'outbound';
}

export function isFlying(op: OperationState): boolean {
  return op.stage === 'outbound' || op.stage === 'recon' || op.stage === 'execute' || op.stage === 'return';
}

/** The leg the pilot is flying right now (null on station). */
export function activeLeg(op: OperationState, _def?: MissionDef): { def: Route; state: LegState } | null {
  if (op.stage === 'outbound') return { def: op.routes.outbound, state: op.outbound };
  if (op.stage === 'execute' && op.routes.execute && op.exec) return { def: op.routes.execute, state: op.exec };
  if (op.stage === 'return') return { def: op.routes.return, state: op.ret };
  return null;
}

/**
 * EXECUTE: the target is found, now do the thing. The drop run is a short
 * leg of its own (usually one ring over the target). Normally it is not on a
 * clock (the pressure comes after); a mission with a window puts the ring
 * on one from the first frame. The result is read off the ring.
 */
export function beginExecute(op: OperationState, route: Route, window = 0): void {
  if (op.stage !== 'recon') return;
  op.stage = 'execute';
  op.routes.execute = route;
  op.exec = newLeg(route);
  if (window > 0) startWindow(op.exec, window);
}

/** The drop ring was flown through (tagged) or wide of (missed); null while pending. */
export function dropResult(op: OperationState): ExecResult {
  const r = op.routes.execute;
  if (!r || !op.exec) return null;
  const last = r.gates[r.gates.length - 1];
  const st = last ? op.exec.status[last.id] : 'pending';
  return st === 'passed' ? 'tagged' : st === 'missed' ? 'missed' : null;
}

/**
 * Storm cells are destructive. Inside one the airframe takes a steady
 * pounding, and lightning strikes on a fixed rhythm take a big bite out of
 * it. Light airframes suffer most. At full damage the aircraft breaks up.
 */
export const STORM_WEAR = 0.045;
export const STRIKE_EVERY = 2.2;
export const STRIKE_DAMAGE = 0.1;

export function stormDamagePerSecond(weatherExposure: number): number {
  return STORM_WEAR * weatherExposure + (STRIKE_DAMAGE * (0.5 + weatherExposure)) / STRIKE_EVERY;
}

/** A damaged airframe flies worse: slower, more sluggish in roll and pitch. */
export function damagedPerf(P: FlightPerf, damage: number): FlightPerf {
  const d = Math.max(0, Math.min(1, damage));
  if (d === 0) return P;
  return { ...P, maxSpeed: Math.max(P.minSpeed + 8, P.maxSpeed * (1 - 0.3 * d)), rollRate: P.rollRate * (1 - 0.4 * d), pitchRate: P.pitchRate * (1 - 0.3 * d), turnGain: P.turnGain * (1 - 0.25 * d) };
}

export type WeatherHit = { type: 'strike'; damage: number } | { type: 'destroyed' };

/** One frame of flight: gates, hazards, weather damage, and the recon window. */
export function tickOperation(op: OperationState, def: MissionDef, a: AircraftFix, dt: number, cap: Capabilities): { events: LegEvent[]; frontArrived: boolean; hits: WeatherHit[] } {
  if (!isFlying(op)) return { events: [], frontArrived: false, hits: [] };
  const hits: WeatherHit[] = [];
  op.time += dt;
  const events: LegEvent[] = [];
  const leg = activeLeg(op, def);
  if (leg) {
    events.push(...tickLeg(leg.state, leg.def, a, dt, cap.stealthCeiling));
    if (leg.def.hazards.some((h) => h.kind === 'storm' && inHazard(h, a))) {
      op.stormTime += dt;
      op.damage = Math.min(1, op.damage + dt * STORM_WEAR * cap.weatherExposure);
      // the first strike lands a moment after entering, then on the rhythm
      if (Math.floor((op.stormTime + STRIKE_EVERY * 0.6) / STRIKE_EVERY) > Math.floor((op.stormTime - dt + STRIKE_EVERY * 0.6) / STRIKE_EVERY)) {
        const bite = STRIKE_DAMAGE * (0.5 + cap.weatherExposure);
        op.damage = Math.min(1, op.damage + bite);
        hits.push({ type: 'strike', damage: bite });
      }
      if (op.damage >= 1) {
        op.stage = 'debrief';
        op.outcome = 'destroyed';
        hits.push({ type: 'destroyed' });
        return { events, frontArrived: false, hits };
      }
    }
    if (op.stage === 'outbound' && legComplete(op.outbound, op.routes.outbound)) op.stage = 'recon';
    if (op.stage === 'execute' && op.execResult === null) op.execResult = dropResult(op);
  }
  let front = false;
  if (op.stage === 'recon') {
    op.reconElapsed += dt;
    if (!op.frontArrived && op.reconElapsed >= def.reconWindow) {
      op.frontArrived = true;
      front = true;
    }
  }
  return { events, frontArrived: front, hits };
}

/**
 * Recon is over (objectives done, extracted by choice, weather or fuel): fly
 * home. Given the aircraft's pose, the way home starts with a ring right
 * ahead of it. Spotted on the way in (or sent out with RADAR CONTACT by the
 * Exit Profile), the radar has you from the first ring. `def.return` is the
 * leg Mission Control generated.
 */
export function beginReturn(op: OperationState, def?: Pick<MissionDef, 'return'>, pose?: { x: number; y: number; z: number; yaw: number }, ground: Ground = flat, contact = false, pace = CONTACT_PACE): void {
  if (op.stage !== 'recon' && op.stage !== 'outbound' && op.stage !== 'execute') return;
  // no drop run flown (no target), or one abandoned: execute did not happen
  if (op.execResult === null) op.execResult = op.stage === 'execute' ? 'missed' : 'skipped';
  op.stage = 'return';
  if (def && pose) {
    const first = def.return.gates.find((g) => g.kind === 'ring');
    const deck = def.return.hazards.find((h) => h.kind === 'ceiling');
    const join = joinRing(pose, first && first.kind === 'ring' ? first : BASE, ground, deck && deck.kind === 'ceiling' ? deck.y : Infinity);
    op.routes.return = placeRoute(def.return, ground, pose, join);
  }
  op.ret = newLeg(op.routes.return, op.outbound.detected || contact, true, pace);
}

/** Touch-down at base. Only the return leg ends with a landing. */
export function landAtBase(op: OperationState, def: MissionDef): LegEvent[] {
  if (op.stage !== 'return') return [];
  void def;
  const route = op.routes.return;
  const ev = passLanding(op.ret, route);
  if (!ev.length) {
    // came home without flying the planned route: the remaining rings are missed
    for (const g of route.gates) if (op.ret.status[g.id] === 'pending' && g.kind !== 'land') op.ret.status[g.id] = 'missed';
    op.ret.status.land = 'passed';
    op.ret.index = route.gates.length;
  }
  op.stage = 'debrief';
  op.outcome = 'landed';
  return ev;
}

export function endOperation(op: OperationState, outcome: 'fuel' | 'aborted' | 'destroyed'): void {
  if (!isFlying(op)) return;
  op.stage = 'debrief';
  op.outcome = outcome;
}

/** Visibility on station: haze builds as the front approaches. */
export function reconVisibility(op: OperationState, def: MissionDef): number {
  const k = Math.max(0, Math.min(1, op.reconElapsed / def.reconWindow));
  return 1 - (1 - def.reconVisibilityEnd) * k;
}

export function windowLeft(op: OperationState, def: MissionDef): number {
  return Math.max(0, def.reconWindow - op.reconElapsed);
}

/** The pilot's objective on a flying leg: the next ring (the ring itself is the instruction). */
export function flightObjective(op: OperationState, def: MissionDef, cap: Capabilities): { kicker: string; title: string; detail: string } | null {
  void def;
  const leg = activeLeg(op);
  if (!leg) return null;
  const g = currentGate(leg.state, leg.def);
  if (!g) return null;
  if (g.kind === 'land') return { kicker: 'FINAL', title: g.objective, detail: g.detail };
  const n = rings(leg.def).length;
  const kicker = n > 1 ? `RING ${ringOrdinal(leg.def, g.id)}` : op.stage === 'execute' ? 'ONE PASS' : 'RING';
  const title = leg.state.contact ? 'RADAR CONTACT' : leg.def.title;
  const detail = g.cue === 'LOW' ? `BELOW ${cap.stealthCeiling} m` : (g.cue ?? (leg.state.contact ? 'BEAT THE CLOCK' : ''));
  return { kicker, title, detail };
}

export function damageGrade(d: number): 'NONE' | 'MINOR' | 'MODERATE' | 'HEAVY' {
  if (d < 0.02) return 'NONE';
  if (d < 0.25) return 'MINOR';
  if (d < 0.5) return 'MODERATE';
  return 'HEAVY';
}
