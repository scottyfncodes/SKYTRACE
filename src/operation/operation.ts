/**
 * The operation: the five stages of every SKYTRACE mission.
 *
 *   PREFLIGHT ─launch─▶ OUTBOUND ─outbound gates done─▶ RECON ─extract─▶ RETURN ─land─▶ DEBRIEF
 *                         (fly)                       (Mission Control)   (fly)
 *   any flying stage ─fuel / abort─▶ DEBRIEF
 *
 * Pure: `Game` feeds it the aircraft's position each frame and renders the
 * events. The recon objectives themselves live in the mission's rules.
 */
import type { MissionDef } from '../mission/missionDef';
import { currentGate, inHazard, legComplete, newLeg, passLanding, tickLeg, type AircraftFix, type LegEvent, type LegState } from './gates';
import type { Capabilities, Loadout } from './loadout';

export type Stage = 'preflight' | 'outbound' | 'recon' | 'return' | 'debrief';

export const STAGES: readonly { id: Stage; label: string }[] = [
  { id: 'preflight', label: 'PREFLIGHT' },
  { id: 'outbound', label: 'OUTBOUND' },
  { id: 'recon', label: 'RECON' },
  { id: 'return', label: 'RETURN' },
  { id: 'debrief', label: 'DEBRIEF' },
];

export interface OperationState {
  stage: Stage;
  loadout: Loadout;
  outbound: LegState;
  ret: LegState;
  /** Seconds since arriving on station (the recon window runs from here). */
  reconElapsed: number;
  frontArrived: boolean;
  /** Airframe damage 0..1 from weather. */
  damage: number;
  outcome: 'landed' | 'fuel' | 'aborted' | null;
  /** Seconds since take-off. */
  time: number;
}

export function newOperation(def: MissionDef, loadout: Loadout): OperationState {
  return { stage: 'preflight', loadout, outbound: newLeg(def.outbound), ret: newLeg(def.return), reconElapsed: 0, frontArrived: false, damage: 0, outcome: null, time: 0 };
}

export function launch(op: OperationState): void {
  if (op.stage === 'preflight') op.stage = 'outbound';
}

export function isFlying(op: OperationState): boolean {
  return op.stage === 'outbound' || op.stage === 'recon' || op.stage === 'return';
}

/** The leg the pilot is flying right now (null on station). */
export function activeLeg(op: OperationState, def: MissionDef): { def: MissionDef['outbound']; state: LegState } | null {
  if (op.stage === 'outbound') return { def: def.outbound, state: op.outbound };
  if (op.stage === 'return') return { def: def.return, state: op.ret };
  return null;
}

/** One frame of flight: gates, hazards, weather damage, and the recon window. */
export function tickOperation(op: OperationState, def: MissionDef, a: AircraftFix, dt: number, cap: Capabilities): { events: LegEvent[]; frontArrived: boolean } {
  if (!isFlying(op)) return { events: [], frontArrived: false };
  op.time += dt;
  const events: LegEvent[] = [];
  const leg = activeLeg(op, def);
  if (leg) {
    events.push(...tickLeg(leg.state, leg.def, a, dt, cap.stealthCeiling));
    for (const h of leg.def.hazards) if (h.kind === 'storm' && inHazard(h, a)) op.damage = Math.min(1, op.damage + dt * 0.03 * cap.weatherExposure);
    if (op.stage === 'outbound' && legComplete(op.outbound, def.outbound)) op.stage = 'recon';
  }
  let front = false;
  if (op.stage === 'recon') {
    op.reconElapsed += dt;
    if (!op.frontArrived && op.reconElapsed >= def.reconWindow) {
      op.frontArrived = true;
      front = true;
    }
  }
  return { events, frontArrived: front };
}

/** Recon is over (objectives done, extracted by choice, weather or fuel): fly home. */
export function beginReturn(op: OperationState): void {
  if (op.stage === 'recon' || op.stage === 'outbound') op.stage = 'return';
}

/** Touch-down at base. Only the return leg ends with a landing. */
export function landAtBase(op: OperationState, def: MissionDef): LegEvent[] {
  if (op.stage !== 'return') return [];
  const ev = passLanding(op.ret, def.return);
  if (!ev.length) {
    // came home without flying the planned route: the remaining gates are missed
    for (const g of def.return.gates) if (op.ret.status[g.id] === 'pending' && g.kind !== 'land') op.ret.status[g.id] = 'missed';
    op.ret.status.land = 'passed';
    op.ret.index = def.return.gates.length;
  }
  op.stage = 'debrief';
  op.outcome = 'landed';
  return ev;
}

export function endOperation(op: OperationState, outcome: 'fuel' | 'aborted'): void {
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

/** The pilot's objective on a flying leg: the current gate. */
export function flightObjective(op: OperationState, def: MissionDef, cap: Capabilities): { kicker: string; title: string; detail: string } | null {
  const leg = activeLeg(op, def);
  if (!leg) return null;
  const g = currentGate(leg.state, leg.def);
  if (!g) return null;
  const n = leg.def.gates.length;
  const kicker = `${op.stage === 'outbound' ? 'OUTBOUND' : 'RETURN'} · GATE ${leg.state.index + 1} OF ${n}`;
  const detail = g.kind === 'enterArea' && g.stealth ? `STAY BELOW ${cap.stealthCeiling} m · ${g.detail}` : g.detail;
  return { kicker, title: g.objective, detail };
}

export function damageGrade(d: number): 'NONE' | 'MINOR' | 'MODERATE' | 'HEAVY' {
  if (d < 0.02) return 'NONE';
  if (d < 0.25) return 'MINOR';
  if (d < 0.5) return 'MODERATE';
  return 'HEAVY';
}
