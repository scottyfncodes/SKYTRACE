/**
 * What the squadron owns: aircraft, crew and equipment. Plain data; the
 * effects of a choice are derived in `loadout.ts` so each difference is a
 * gameplay difference (how you can approach the job), not a +10% stat.
 */
import { FLIGHT, type FlightPerf } from '../flight/aircraft';

export type SeatRole = 'copilot' | 'navigator' | 'sensor';
export type EquipmentId = 'radar' | 'optical' | 'thermal' | 'sigint';
export type Signature = 'low' | 'medium' | 'high';

export interface AircraftDef {
  id: string;
  name: string;
  /** One line: what this aircraft is for. */
  role: string;
  /** What it means for the mission, in the player's words. */
  notes: string[];
  perf: FlightPerf;
  fuelSeconds: number;
  /** Crew seats besides the player. */
  seats: SeatRole[];
  slots: number;
  signature: Signature;
  /** Highest AGL that stays under the ridge radar on entry to a defended area. */
  stealthCeiling: number;
  /** 0 = fragile in weather, 1 = all-weather. Scales turbulence and damage. */
  weatherTolerance: number;
  /** Autopilot orbit while the player operates the sensors. */
  orbit: { r: number; agl: number };
  /** Career unlock id; absent = available from the start. */
  unlock?: string;
}

export const AIRCRAFT: readonly AircraftDef[] = [
  {
    id: 'kestrel',
    name: 'KESTREL',
    role: 'Single-seat light recon',
    notes: ['Fast and quiet: enter defended areas up to 450 m', 'Short legs: no fuel for long detours', 'You fly and operate; the autopilot orbits wide', 'Light airframe: storms hit hard'],
    perf: FLIGHT,
    fuelSeconds: 380,
    seats: [],
    slots: 2,
    signature: 'low',
    stealthCeiling: 450,
    weatherTolerance: 0.2,
    orbit: { r: 300, agl: 300 },
  },
  {
    id: 'heron',
    name: 'HERON',
    role: 'Two-crew patrol aircraft',
    notes: ['Copilot can fly the orbit: tighter, closer looks', 'Sensor operator seat', 'Long range; rides out weather', 'Louder: enter defended areas below 300 m'],
    perf: { ...FLIGHT, minSpeed: 28, maxSpeed: 74, rollRate: 2.1, turnGain: 0.82, accel: 0.75 },
    fuelSeconds: 560,
    seats: ['copilot', 'sensor'],
    slots: 3,
    signature: 'medium',
    stealthCeiling: 300,
    weatherTolerance: 0.65,
    orbit: { r: 240, agl: 250 },
  },
  {
    id: 'albatross',
    name: 'ALBATROSS',
    role: 'Long-range survey aircraft',
    notes: ['Full crew: copilot, navigator, sensor operator', 'Four equipment bays', 'Heavy and loud: enter defended areas below 220 m', 'All-weather'],
    perf: { ...FLIGHT, minSpeed: 26, maxSpeed: 66, rollRate: 1.8, turnGain: 0.72, accel: 0.6 },
    fuelSeconds: 720,
    seats: ['copilot', 'navigator', 'sensor'],
    slots: 4,
    signature: 'high',
    stealthCeiling: 220,
    weatherTolerance: 0.85,
    orbit: { r: 220, agl: 240 },
    unlock: 'albatross',
  },
];

export interface CrewSkills {
  /** Flying the orbit (tighter, steadier). */
  piloting?: number;
  /** Route awareness: gates and weather on the scope from take-off. */
  navigation?: number;
  /** Speed on the sensors (identification). */
  sensors?: number;
  /** Quality of evidence (photographs). */
  identification?: number;
  /** Eases turbulence and storm damage. */
  weather?: number;
}

export interface CrewDef {
  id: string;
  name: string;
  role: SeatRole;
  skills: CrewSkills;
  note: string;
  unlock?: string;
}

export const CREW: readonly CrewDef[] = [
  { id: 'adeyemi', name: 'M. ADEYEMI', role: 'copilot', skills: { piloting: 3, weather: 2 }, note: 'Holds a tight, steady orbit. Eases turbulence.' },
  { id: 'halvorsen', name: 'R. HALVORSEN', role: 'copilot', skills: { piloting: 1, navigation: 3 }, note: 'Calls the route: gates and storm cells on your scope from take-off.' },
  { id: 'okafor', name: 'J. OKAFOR', role: 'sensor', skills: { sensors: 3, identification: 1 }, note: 'Fast on the sensors. Identifies returns quicker.' },
  { id: 'vance', name: 'T. VANCE', role: 'sensor', skills: { sensors: 1, identification: 3 }, note: 'A sharp eye: better evidence photographs.', unlock: 'vance' },
  { id: 'reyes', name: 'L. REYES', role: 'navigator', skills: { navigation: 3, weather: 2 }, note: 'Plots around weather; storms show on the scope from take-off.', unlock: 'albatross' },
];

export interface EquipmentDef {
  id: EquipmentId;
  name: string;
  /** What question this sensor answers. */
  answers: string;
  /** What it cannot do. */
  limits: string;
  unlock?: string;
}

export const EQUIPMENT: readonly EquipmentDef[] = [
  { id: 'radar', name: 'SEARCH RADAR', answers: 'Finds vehicles; shows if they move', limits: 'Cannot tell what they are' },
  { id: 'optical', name: 'OPTICAL CAMERA', answers: 'Size, count, road; best photographs', limits: 'Degraded by haze' },
  { id: 'thermal', name: 'THERMAL IMAGER', answers: 'Size, count, engine heat; sees through haze', limits: 'Fair photographs; no road detail' },
  { id: 'sigint', name: 'SIGINT RECEIVER', answers: 'Which vehicles transmit on the radio', limits: 'Bearing only; cannot photograph', unlock: 'sigint' },
];

export const AIRCRAFT_BY_ID = Object.fromEntries(AIRCRAFT.map((a) => [a.id, a])) as Record<string, AircraftDef>;
export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c])) as Record<string, CrewDef>;
export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e])) as Record<EquipmentId, EquipmentDef>;

export const SEAT_LABEL: Record<SeatRole, string> = { copilot: 'COPILOT', navigator: 'NAVIGATOR', sensor: 'SENSOR OPERATOR' };
