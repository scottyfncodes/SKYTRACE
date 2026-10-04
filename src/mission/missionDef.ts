/**
 * What every SKYTRACE operation declares. The grammar is
 *
 *   PREFLIGHT → OUTBOUND (gates) → RECON (Mission Control) → RETURN (gates) → DEBRIEF
 *
 * The flying legs are lists of gates and hazards (`operation/gates.ts`);
 * the recon objectives live in the mission's own rules module.
 */
import type { LegDef } from '../operation/gates';

export interface OperationsArea {
  id: string;
  label: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Briefing {
  /** "LOCATE THE MISSING SUPPLY TRUCK" */
  headline: string;
  primary: string;
  /** Known secondary objectives (more may be issued in the field). */
  secondaries: string[];
  weather: string;
  conditions: string;
  targetArea: string;
  constraints: string[];
  window: string;
  threats: string[];
}

export interface MissionDef {
  id: string;
  code: string;
  title: string;
  objective: string;
  success: string;
  intel: readonly string[];
  intelShort: string;
  briefing: Briefing;
  /** What identifies the target: a handful of tags, read at a glance. */
  clues: readonly string[];
  /** The three things that will bite, one line each. */
  risks: readonly { icon: string; text: string }[];
  /** Where Mission Control is available. The orbit comes from the aircraft and crew. */
  operations: { area: OperationsArea };
  /** Seconds on station before the weather front forces extraction. */
  reconWindow: number;
  /** Visibility (0..1) by the end of the recon window, as the front arrives. */
  reconVisibilityEnd: number;
  outbound: LegDef;
  /** The return leg: conditions the pilot inherits after extraction. */
  return: LegDef & { visibility: number; notices: readonly string[] };
}

/** Is a point inside an operations area? */
export function inArea(a: OperationsArea, x: number, z: number): boolean {
  return x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
}
