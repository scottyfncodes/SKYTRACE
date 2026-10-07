/**
 * What every SKYTRACE operation declares. The grammar is
 *
 *   PREFLIGHT → OUTBOUND (gates) → RECON (Mission Control) → EXECUTE (drop run) → RETURN (gates) → DEBRIEF
 *
 * and is played as three phases the player always recognises:
 * RECON → EXECUTE → ESCAPE (`operation/phases.ts`).
 *
 * The flying legs are lists of gates and hazards (`operation/gates.ts`);
 * the recon objectives live in the mission's own rules module.
 */
import type { LegDef } from '../operation/gates';
import type { MissionStory } from '../operation/phases';
import type { ControlDef } from '../control/board';

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

/**
 * EXECUTE, as data: where the ring over the target stands, whether the
 * target holds still for it, whether the pass is on a clock, and what the
 * stamps say. A drop, a skim, a photo pass and a pickup are all one ring
 * with different numbers and words.
 */
export interface ExecuteProfile {
  /** How far out the run starts (m). */
  run: number;
  /** How high over the target the ring stands (m AGL), and how wide, before Mission Control's rank scales it. */
  agl: number;
  r: number;
  /** When the target holds still for the run: always, only once Mission Control confirmed it on evidence, or never (tag it rolling). */
  halt: 'always' | 'confirmed' | 'never';
  /** Seconds to make the pass before the target reaches cover (0: no clock; the pressure comes after). */
  window: number;
  /** The word on the ring. */
  cue: string;
  /** Something leaves the aircraft on the pass (a parachute package). */
  drops: boolean;
  /** The stamps: through the ring, and wide of it. */
  done: { kicker: string; text: string };
  missed: { kicker: string; text: string };
}

/** ESCAPE, as data: how hard the way home pushes, and how the world answers the pass. */
export interface EscapeProfile {
  /** Metres per second the ring clocks allow (lower: tighter). */
  pace: number;
  /** RADAR CONTACT from the first ring whatever the board found. */
  contact: boolean;
  /** A cap on visibility on the way home (1: the Exit Profile decides). */
  visibility: number;
  /** The world's answer to the pass, one line each: made, and missed. */
  reaction: { tagged: string; missed: string };
}

export interface MissionDef {
  id: string;
  code: string;
  /** Which page of the case file this operation is (0-based). */
  page: number;
  title: string;
  objective: string;
  success: string;
  intel: readonly string[];
  intelShort: string;
  briefing: Briefing;
  /** The story, told in the three phases: RECON → EXECUTE → ESCAPE. */
  story: MissionStory;
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
  /** Mission Control: the board between the flights. */
  control: ControlDef;
  execute: ExecuteProfile;
  escape: EscapeProfile;
}

/** Is a point inside an operations area? */
export function inArea(a: OperationsArea, x: number, z: number): boolean {
  return x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
}
