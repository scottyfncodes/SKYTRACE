/**
 * Crew stations: the player is either the PILOT (flying) or the OPERATOR
 * (running the reconnaissance systems while the autopilot flies). Pure state,
 * so the rules for switching jobs are tested independently of rendering.
 *
 *   pilot ──(in the operations area, with recon work to do)──▶ operator
 *   operator ──(take controls / work done / bingo fuel)──────▶ pilot  + hand-over report
 *
 * The hand-back is a gameplay event: the pilot inherits whatever happened
 * while they were heads-down (position, fuel, time, weather, hazards).
 */
import type { Orbit } from '../flight/autopilot';

export type Station = 'pilot' | 'operator';
export type HandbackReason = 'manual' | 'complete' | 'fuel';

export interface CrewState {
  station: Station;
  orbit: Orbit | null;
  /** Total seconds spent as operator this sortie. */
  timeOnStation: number;
  /** Seconds into the current operator session. */
  sessionTime: number;
  entries: number;
}

/** Below this fraction of fuel the operator is handed the aircraft back. */
export const BINGO_FUEL = 0.2;
export const ORBIT_RADIUS = 260;

export function newCrew(): CrewState {
  return { station: 'pilot', orbit: null, timeOnStation: 0, sessionTime: 0, entries: 0 };
}

export interface OperatorContext {
  /** Aircraft is inside the mission's operations area. */
  inArea: boolean;
  /** The current objective has recon work for the operator. */
  operatorWork: boolean;
  fuelFraction: number;
  areaLabel: string;
}

/** Can the player switch to the operator station right now? `reason` is shown to the player when not. */
export function operatorAvailability(c: CrewState, ctx: OperatorContext): { ok: boolean; reason: string } {
  if (c.station === 'operator') return { ok: false, reason: 'ALREADY IN MISSION CONTROL' };
  if (!ctx.operatorWork) return { ok: false, reason: 'NO RECON TASK · FLY THE AIRCRAFT' };
  if (ctx.fuelFraction <= BINGO_FUEL) return { ok: false, reason: 'BINGO FUEL · RETURN TO BASE' };
  if (!ctx.inArea) return { ok: false, reason: `MISSION CONTROL OPENS INSIDE ${ctx.areaLabel}` };
  return { ok: true, reason: '' };
}

/** Engage the autopilot in an orbit around the aircraft's current position. */
export function engageOperator(c: CrewState, x: number, z: number, agl: number, throttle = 0.35): Orbit {
  c.station = 'operator';
  c.sessionTime = 0;
  c.entries += 1;
  c.orbit = { x, z, r: ORBIT_RADIUS, agl, throttle };
  return c.orbit;
}

export function tickCrew(c: CrewState, dt: number): void {
  if (c.station !== 'operator') return;
  c.timeOnStation += dt;
  c.sessionTime += dt;
}

/** Re-task the orbit (the operator directs the aircraft; they never fly it). */
export function retaskOrbit(c: CrewState, x: number, z: number, limit = 1100): void {
  if (!c.orbit) return;
  c.orbit.x = Math.max(-limit, Math.min(limit, x));
  c.orbit.z = Math.max(-limit, Math.min(limit, z));
}

/** Does the operator have to give the aircraft back without being asked? */
export function forcedHandback(c: CrewState, ctx: { fuelFraction: number; operatorWork: boolean }): HandbackReason | null {
  if (c.station !== 'operator') return null;
  if (ctx.fuelFraction <= BINGO_FUEL) return 'fuel';
  if (!ctx.operatorWork) return 'complete';
  return null;
}

export function handBack(c: CrewState): void {
  c.station = 'pilot';
  c.orbit = null;
}

/** Compass bearing (degrees, 0 = north, clockwise) from one point to another. */
export function bearingDeg(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const b = (Math.atan2(toX - fromX, -(toZ - fromZ)) * 180) / Math.PI;
  return Math.round((b + 360) % 360) % 360;
}

export interface HandoverInput {
  reason: HandbackReason;
  x: number;
  z: number;
  agl: number;
  fuelSeconds: number;
  sessionTime: number;
  baseX: number;
  baseZ: number;
  terrainWarning: boolean;
  /** Mission-specific changes the pilot inherits (weather, traffic, hazards). */
  notices: readonly string[];
}

export interface Handover {
  title: string;
  /** Warnings first: what demands the pilot's attention right now. */
  warnings: string[];
  /** Situation: where the aircraft is and what to do. */
  status: string[];
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The report the pilot gets the instant they are flying again. */
export function buildHandover(h: HandoverInput): Handover {
  const warnings: string[] = [];
  if (h.reason === 'fuel') warnings.push('BINGO FUEL');
  if (h.terrainWarning || h.agl < 60) warnings.push('TERRAIN · CLIMB');
  warnings.push(...h.notices);
  const dist = Math.hypot(h.baseX - h.x, h.baseZ - h.z);
  const hdg = String(bearingDeg(h.x, h.z, h.baseX, h.baseZ)).padStart(3, '0');
  const status = [`RETURN HEADING ${hdg}° · BASE ${(dist / 1000).toFixed(1)} km`, `FUEL ${mmss(h.fuelSeconds)} · ${mmss(h.sessionTime)} ON STATION`];
  return { title: 'YOU HAVE CONTROL', warnings, status };
}
