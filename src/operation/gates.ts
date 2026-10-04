/**
 * Mission gates: the flying half of an operation. A leg is an ordered list
 * of gates (the current one is the pilot's objective) plus hazards that are
 * live for the whole leg (storm cells, a cloud deck). Pure and testable.
 */
import type { OperationsArea } from '../mission/missionDef';

export type GateDef =
  | { kind: 'waypoint'; id: string; label: string; x: number; z: number; r: number; objective: string; detail: string }
  /** Enter a defended area; above the aircraft's stealth ceiling the ridge radar sees you. */
  | { kind: 'enterArea'; id: string; label: string; area: OperationsArea; stealth: boolean; objective: string; detail: string }
  /** Passed by the landing itself (Game decides when the aircraft is down). */
  | { kind: 'land'; id: string; label: string; objective: string; detail: string };

export type HazardDef =
  | { kind: 'storm'; id: string; label: string; x: number; z: number; r: number }
  /** Cloud deck at an altitude (MSL): above it the pilot is flying blind. */
  | { kind: 'ceiling'; id: string; label: string; y: number };

export interface LegDef {
  id: 'outbound' | 'return';
  gates: GateDef[];
  hazards: HazardDef[];
}

export type GateStatus = 'pending' | 'passed' | 'missed';

export interface LegState {
  index: number;
  status: Record<string, GateStatus>;
  inside: Record<string, boolean>;
  /** Seconds spent inside each hazard. */
  exposure: Record<string, number>;
  /** Seen by the defended area's radar on entry. */
  detected: boolean;
}

export interface LegEvent {
  type: 'gate-passed' | 'gate-missed' | 'leg-complete' | 'detected' | 'hazard-enter' | 'hazard-exit';
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

export function newLeg(def: LegDef): LegState {
  const status: Record<string, GateStatus> = {};
  for (const g of def.gates) status[g.id] = 'pending';
  const inside: Record<string, boolean> = {};
  const exposure: Record<string, number> = {};
  for (const h of def.hazards) {
    inside[h.id] = false;
    exposure[h.id] = 0;
  }
  return { index: 0, status, inside, exposure, detected: false };
}

export function currentGate(s: LegState, def: LegDef): GateDef | null {
  return def.gates[s.index] ?? null;
}

export function legComplete(s: LegState, def: LegDef): boolean {
  return s.index >= def.gates.length;
}

export function inHazard(h: HazardDef, a: AircraftFix): boolean {
  if (h.kind === 'storm') return Math.hypot(a.x - h.x, a.z - h.z) < h.r;
  return a.y > h.y;
}

function gateMet(g: GateDef, a: AircraftFix): boolean {
  if (g.kind === 'waypoint') return Math.hypot(a.x - g.x, a.z - g.z) < g.r;
  if (g.kind === 'enterArea') return a.x >= g.area.x0 && a.x <= g.area.x1 && a.z >= g.area.z0 && a.z <= g.area.z1;
  return false;
}

/**
 * Advance a leg. Gates are taken in order; flying straight to a later gate
 * marks the skipped ones missed (the route was not flown as planned).
 */
export function tickLeg(s: LegState, def: LegDef, a: AircraftFix, dt: number, stealthCeiling: number): LegEvent[] {
  const ev: LegEvent[] = [];
  for (const h of def.hazards) {
    const now = inHazard(h, a);
    if (now) s.exposure[h.id] += dt;
    if (now !== s.inside[h.id]) {
      s.inside[h.id] = now;
      ev.push({ type: now ? 'hazard-enter' : 'hazard-exit', id: h.id, text: now ? (h.kind === 'storm' ? `TURBULENCE · INSIDE THE ${h.label}` : `IN CLOUD · DESCEND BELOW ${Math.round(h.y)} m`) : h.kind === 'storm' ? `CLEAR OF THE ${h.label}` : 'BELOW THE CLOUD DECK' });
    }
  }
  for (let j = s.index; j < def.gates.length; j++) {
    const g = def.gates[j];
    if (!gateMet(g, a)) continue;
    for (let k = s.index; k < j; k++) {
      s.status[def.gates[k].id] = 'missed';
      ev.push({ type: 'gate-missed', id: def.gates[k].id, text: `${def.gates[k].label} MISSED` });
    }
    s.status[g.id] = 'passed';
    if (g.kind === 'enterArea' && g.stealth && a.agl > stealthCeiling) {
      s.detected = true;
      ev.push({ type: 'detected', id: g.id, text: `DETECTED · ENTERED ${g.area.label} AT ${Math.round(a.agl)} m` });
    }
    ev.push({ type: 'gate-passed', id: g.id, text: `${g.label} ✓` });
    s.index = j + 1;
    if (legComplete(s, def)) ev.push({ type: 'leg-complete', id: def.id, text: def.id === 'outbound' ? 'ON STATION' : 'HOME' });
    break;
  }
  return ev;
}

/** The landing gate is passed by the Game when the aircraft is down at base. */
export function passLanding(s: LegState, def: LegDef): LegEvent[] {
  const g = currentGate(s, def);
  if (!g || g.kind !== 'land') return [];
  s.status[g.id] = 'passed';
  s.index += 1;
  return [{ type: 'gate-passed', id: g.id, text: `${g.label} ✓` }, { type: 'leg-complete', id: def.id, text: 'HOME' }];
}

export function missedCount(s: LegState): number {
  return Object.values(s.status).filter((v) => v === 'missed').length;
}

export function totalExposure(s: LegState, def: LegDef, kind: HazardDef['kind']): number {
  return def.hazards.filter((h) => h.kind === kind).reduce((t, h) => t + s.exposure[h.id], 0);
}
