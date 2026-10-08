/**
 * The rescue fleet: vehicles, crew and equipment as plain data.
 *
 * Every entry is a tool with an obvious job, not a stat sheet. A vehicle says
 * what it is for in three words or fewer per strength; equipment says what it
 * lets you do. Adding a vehicle or a piece of kit is adding an entry here (and
 * a mesh, if it flies something new).
 */
import type { FlightPerf } from '../flight/aircraft';
import type { MissionId } from './missions';

/** What a loadout can do. Missions require these; equipment and vehicles grant them. */
export type Capability = 'hover' | 'hoist' | 'beacon' | 'thermal' | 'water' | 'fire' | 'search';

export type VehicleId = 'rescue-heli' | 'heavy-heli' | 'search-plane' | 'rescue-boat';
export type EquipmentId = 'basket' | 'beacon' | 'thermal' | 'medkit' | 'swimmer' | 'bucket' | 'towline' | 'raft';
export type CrewId = 'winch' | 'medic' | 'spotter';

export interface VehicleDef {
  id: VehicleId;
  name: string;
  icon: string;
  kind: 'helicopter' | 'plane' | 'boat';
  /** One line: what it is for. */
  tagline: string;
  strengths: readonly string[];
  /** People it can carry home in one trip. */
  capacity: number;
  /** Equipment it can take. */
  slots: number;
  caps: readonly Capability[];
  /** Flight profile (rotorcraft when it has a climb rate). */
  perf: FlightPerf | null;
  /** How much the wind pushes it around in a hover (1: a lot, 0.5: half). */
  windFactor: number;
  /** Fuel relative to the mission's standard allowance. */
  fuel: number;
  /** Which model to draw. */
  style: 'rescue' | 'heavy' | null;
  /** Built and flyable in this version. */
  ready: boolean;
  /** A clean rescue of this mission puts it in the hangar (none: there from the start). */
  unlockedBy?: MissionId;
}

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  icon: string;
  /** One line: what it lets you do. */
  does: string;
  caps: readonly Capability[];
  ready: boolean;
  unlockedBy?: MissionId;
}

export interface CrewDef {
  id: CrewId;
  name: string;
  role: string;
  icon: string;
  /** One line: what they change. */
  perk: string;
  /** Multipliers on the rescue: basket swing damping, survivor boarding time, spotting range. */
  effect: { swingDamp?: number; boardTime?: number; spotRange?: number };
  unlockedBy?: MissionId;
}

const ROTOR_BASE = { minSpeed: 0, maxRoll: 0.5, maxPitch: 0.5, rollRate: 2.4, pitchRate: 3.2, ceiling: 760, floorAgl: 5, bounds: 1180 } as const;

export const VEHICLES: readonly VehicleDef[] = [
  {
    id: 'rescue-heli',
    name: 'Rescue Helicopter',
    icon: '🚁',
    kind: 'helicopter',
    tagline: 'Hover, hoist, bring them home.',
    strengths: ['Hovers', 'Rescue hoist', 'Nimble'],
    capacity: 2,
    slots: 2,
    caps: ['hover'],
    perf: { ...ROTOR_BASE, maxSpeed: 52, turnGain: 2.1, accel: 0.75, climbRate: 14 },
    windFactor: 1,
    fuel: 1,
    style: 'rescue',
    ready: true,
  },
  {
    id: 'heavy-heli',
    name: 'Heavy Rescue Helicopter',
    icon: '🚁',
    kind: 'helicopter',
    tagline: 'Bigger cabin, steady in a gale.',
    strengths: ['Carries 4', 'Steady in wind', '3 equipment slots'],
    capacity: 4,
    slots: 3,
    caps: ['hover'],
    perf: { ...ROTOR_BASE, maxSpeed: 44, turnGain: 1.6, accel: 0.55, climbRate: 10, rollRate: 1.8 },
    windFactor: 0.5,
    fuel: 1.25,
    style: 'heavy',
    ready: true,
    unlockedBy: 'lost-hiker',
  },
  {
    id: 'search-plane',
    name: 'Search Aircraft',
    icon: '✈️',
    kind: 'plane',
    tagline: 'Fast and far. Finds them, marks them.',
    strengths: ['Fast', 'Long range', 'Finds beacons'],
    capacity: 0,
    slots: 2,
    caps: ['search'],
    perf: null,
    windFactor: 0,
    fuel: 2,
    style: null,
    ready: false,
  },
  {
    id: 'rescue-boat',
    name: 'Rescue Boat',
    icon: '🚤',
    kind: 'boat',
    tagline: 'Lakes, rivers and floods.',
    strengths: ['Water rescue', 'Tows boats', 'Carries 6'],
    capacity: 6,
    slots: 2,
    caps: ['water'],
    perf: null,
    windFactor: 0,
    fuel: 1,
    style: null,
    ready: false,
  },
];

export const EQUIPMENT: readonly EquipmentDef[] = [
  { id: 'basket', name: 'Rescue Basket', icon: '🛟', does: 'Lower it on the hoist and lift people aboard.', caps: ['hoist'], ready: true },
  { id: 'beacon', name: 'Beacon Receiver', icon: '📡', does: "Points at a survivor's phone signal.", caps: ['beacon'], ready: true, unlockedBy: 'mountain-rescue' },
  { id: 'thermal', name: 'Thermal Camera', icon: '🌡️', does: 'Spots people from twice as far, even in cloud.', caps: ['thermal'], ready: true, unlockedBy: 'lost-hiker' },
  { id: 'medkit', name: 'Medical Kit', icon: '🩹', does: 'Treat the injured before you lift them.', caps: [], ready: false },
  { id: 'swimmer', name: 'Rescue Swimmer', icon: '🏊', does: 'Goes into the water to bring people out.', caps: ['water'], ready: false },
  { id: 'bucket', name: 'Water Bucket', icon: '🪣', does: 'Scoop from the lake, drop on the flames.', caps: ['fire'], ready: false },
  { id: 'towline', name: 'Tow Line', icon: '🪢', does: 'Pull a stranded boat to safety.', caps: ['water'], ready: false },
  { id: 'raft', name: 'Rescue Raft', icon: '🛶', does: 'Drop a raft to people in the water.', caps: ['water'], ready: false },
];

export const CREW: readonly CrewDef[] = [
  { id: 'winch', name: 'Sam', role: 'Winch Operator', icon: '🧑‍🔧', perk: 'Steadier basket: half the swing.', effect: { swingDamp: 2.2 } },
  { id: 'medic', name: 'Jo', role: 'Paramedic', icon: '🧑‍⚕️', perk: 'Gets people into the basket twice as fast.', effect: { boardTime: 0.5 } },
  { id: 'spotter', name: 'Ari', role: 'Spotter', icon: '🔭', perk: 'Spots people from much further away.', effect: { spotRange: 1.6 }, unlockedBy: 'mountain-rescue' },
];

export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map((v) => [v.id, v])) as Record<VehicleId, VehicleDef>;
export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e])) as Record<EquipmentId, EquipmentDef>;
export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<CrewId, CrewDef>;
