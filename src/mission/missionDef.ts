/**
 * What every SKYTRACE mission declares. The game's grammar is
 *
 *   FLY TO TARGET → MISSION CONTROL → OPERATE → (objective) → FLY HOME → LAND → DEBRIEF
 *
 * so a mission states where Mission Control can be opened, how the autopilot
 * holds the aircraft there, and what the pilot inherits when the operator
 * work is done and the aircraft is handed back.
 */
export interface OperationsArea {
  id: string;
  label: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface MissionDef {
  code: string;
  title: string;
  objective: string;
  success: string;
  intel: readonly string[];
  intelShort: string;
  fuelSeconds: number;
  /** Where Mission Control is available, and the autopilot orbit height there. */
  operations: { area: OperationsArea; orbitAgl: number };
  /**
   * Conditions that changed while the player was heads-down, applied when
   * the operator work is complete and the pilot takes the aircraft back.
   * `visibility` is 0..1 (1 = clear).
   */
  handback: { visibility: number; notices: readonly string[] };
}

/** Is a point inside an operations area? */
export function inArea(a: OperationsArea, x: number, z: number): boolean {
  return x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
}
