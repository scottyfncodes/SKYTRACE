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

export type VehicleId = 'rescue-heli' | 'heavy-heli' | 'fire-heli' | 'tanker' | 'spotter-plane' | 'search-plane' | 'rescue-boat';
/** How an aircraft fights fire: water from a bucket, a retardant line, or leading the tanker in. */
export type Attack = 'water' | 'retardant' | 'lead';
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
  style: 'rescue' | 'heavy' | 'fire' | 'tanker' | 'spotter' | null;
  /** How it fights fire (built in). */
  attack?: Attack;
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
  /** How it fights fire. */
  attack?: Attack;
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
  /** The same, on a fire call. */
  firePerk: string;
  /** Multipliers on the rescue: basket swing damping, survivor boarding time, spotting range; on a fire, bucket fill time and the forecast. */
  effect: { swingDamp?: number; boardTime?: number; spotRange?: number; fill?: number; forecast?: boolean };
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
    id: 'fire-heli',
    name: 'Fire Helicopter',
    icon: '🚁',
    kind: 'helicopter',
    tagline: 'Water bucket built in. Goes anywhere.',
    strengths: ['Water bucket', 'Very nimble', 'Steep ground'],
    capacity: 2,
    slots: 1,
    caps: ['hover', 'fire'],
    attack: 'water',
    perf: { ...ROTOR_BASE, maxSpeed: 56, turnGain: 2.4, accel: 0.85, climbRate: 16, rollRate: 2.8 },
    windFactor: 0.8,
    fuel: 1,
    style: 'fire',
    ready: true,
  },
  {
    id: 'tanker',
    name: 'Fire Tanker',
    icon: '✈️',
    kind: 'plane',
    tagline: 'Lays long retardant lines.',
    strengths: ['Long lines', 'Big loads', 'Wide turns'],
    capacity: 0,
    slots: 0,
    caps: ['fire'],
    attack: 'retardant',
    perf: { minSpeed: 34, maxSpeed: 74, maxRoll: 0.75, maxPitch: 0.4, rollRate: 1.3, pitchRate: 1.1, turnGain: 0.62, accel: 0.6, ceiling: 820, floorAgl: 22, bounds: 1180 },
    windFactor: 0,
    fuel: 1.4,
    style: 'tanker',
    ready: true,
  },
  {
    id: 'spotter-plane',
    name: 'Fire Spotter',
    icon: '🛩️',
    kind: 'plane',
    tagline: 'Reads the fire, leads the tanker in.',
    strengths: ['Fast', 'Sees the spread', 'Calls 3 drops'],
    capacity: 0,
    slots: 0,
    caps: ['fire'],
    attack: 'lead',
    perf: { minSpeed: 26, maxSpeed: 88, maxRoll: 1.05, maxPitch: 0.55, rollRate: 2.8, pitchRate: 1.8, turnGain: 1.15, accel: 1, ceiling: 820, floorAgl: 16, bounds: 1180 },
    windFactor: 0,
    fuel: 1.8,
    style: 'spotter',
    ready: true,
    unlockedBy: 'wind-fire',
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
  { id: 'bucket', name: 'Water Bucket', icon: '🪣', does: 'Scoop from the river, drop on the flames.', caps: ['fire'], attack: 'water', ready: true },
  { id: 'towline', name: 'Tow Line', icon: '🪢', does: 'Pull a stranded boat to safety.', caps: ['water'], ready: false },
  { id: 'raft', name: 'Rescue Raft', icon: '🛶', does: 'Drop a raft to people in the water.', caps: ['water'], ready: false },
];

export const CREW: readonly CrewDef[] = [
  { id: 'winch', name: 'Sam', role: 'Winch Operator', icon: '🧑‍🔧', perk: 'Steadier basket: half the swing.', firePerk: 'Fills the bucket twice as fast.', effect: { swingDamp: 2.2, fill: 0.5 } },
  { id: 'medic', name: 'Jo', role: 'Paramedic', icon: '🧑‍⚕️', perk: 'Gets people into the basket twice as fast.', firePerk: 'Gets trapped people aboard twice as fast.', effect: { boardTime: 0.5 } },
  { id: 'spotter', name: 'Ari', role: 'Spotter', icon: '🔭', perk: 'Spots people from much further away.', firePerk: 'Reads the fire: shows where it will be.', effect: { spotRange: 1.6, forecast: true }, unlockedBy: 'mountain-rescue' },
];

export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map((v) => [v.id, v])) as Record<VehicleId, VehicleDef>;
export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e])) as Record<EquipmentId, EquipmentDef>;
export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<CrewId, CrewDef>;
