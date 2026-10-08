/**
 * Rescue calls as data. A mission says what happened, where, to how many
 * people, in what conditions, and what it takes; the game does the rest.
 *
 * A new rescue of an existing kind is a new entry. A new kind (water, fire)
 * needs its capability on a vehicle or piece of equipment, and the mechanic
 * that capability unlocks.
 */
import type { Capability, CrewId, EquipmentId, VehicleId } from './catalog';
import { LEDGES, type PadId } from '../world/worldData';

export type MissionId = 'mountain-rescue' | 'lost-hiker' | 'summit-storm' | 'capsized-boat' | 'forest-fire' | 'flood' | 'injured-skier' | 'distress-beacon';
export type RescueType = 'mountain' | 'forest' | 'water' | 'fire' | 'flood' | 'snow' | 'beacon';
export type Visibility = 'good' | 'fair' | 'poor';
/** How the people waiting for you show where they are. */
export type Signal = 'flare' | 'smoke' | 'none';
export type SurvivorLook = 'climber' | 'hiker' | 'skier';

export interface MissionDef {
  id: MissionId;
  type: RescueType;
  title: string;
  icon: string;
  /** Where, in a few words. */
  place: string;
  /** What happened, in one line. */
  situation: string;
  /** Pre-Flight condition chips. */
  terrain: string;
  elevation: number;
  wind: { speed: number; from: number; gust: number };
  visibility: Visibility;
  /** The people and where they are (a ground point; they stand around it). */
  site: { x: number; z: number };
  survivors: number;
  look: SurvivorLook;
  /** What the call gives you: a rough area to search. */
  search: { x: number; z: number; r: number };
  signal: Signal;
  /** The signal goes up when you are this close (m). */
  signalRange: number;
  /** You can make them out from this close (m). */
  spotRange: number;
  /** How close to them the basket has to land for them to reach it (m). */
  reach: number;
  startPad: PadId;
  deliverTo: PadId;
  requires: readonly Capability[];
  recommended: { vehicle: VehicleId; crew: CrewId; equipment: readonly EquipmentId[] };
  /** Seconds of fuel on the standard helicopter. */
  fuel: number;
  /** A good time, for the third star (seconds). */
  par: number;
  /** Radio, short: the call, and what is said along the way. */
  radio: {
    call: readonly string[];
    launch: string;
    signal: string;
    spotted: string;
    allAboard: string;
    landed: string;
  };
  /** Built and playable in this version. */
  ready: boolean;
  /** A clean rescue of this mission opens this one (none: open from the start). */
  unlockedBy?: MissionId;
}

const COMING = { site: { x: 0, z: 0 }, search: { x: 0, z: 0, r: 0 }, signal: 'none', signalRange: 0, spotRange: 0, reach: 0, startPad: 'base', deliverTo: 'hospital', fuel: 0, par: 0, elevation: 0, look: 'hiker' } as const;
const NO_RADIO = { call: [], launch: '', signal: '', spotted: '', allAboard: '', landed: '' };

export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'mountain-rescue',
    type: 'mountain',
    title: 'Mountain Rescue',
    icon: '🏔️',
    place: 'Mount Kell · north ridge',
    situation: 'Two climbers stranded on a high ridge.',
    terrain: 'High ridge',
    elevation: 290,
    wind: { speed: 6, from: 315, gust: 0.35 },
    visibility: 'good',
    site: { x: LEDGES.northRidge.x, z: LEDGES.northRidge.z },
    survivors: 2,
    look: 'climber',
    search: { x: 150, z: -590, r: 170 },
    signal: 'flare',
    signalRange: 650,
    spotRange: 300,
    reach: 6,
    startPad: 'base',
    deliverTo: 'hospital',
    requires: ['hover', 'hoist'],
    recommended: { vehicle: 'rescue-heli', crew: 'winch', equipment: ['basket'] },
    fuel: 480,
    par: 240,
    radio: {
      call: ['Rescue One, two climbers stuck on the north ridge of Mount Kell.', "They can't get down. Wind is picking up."],
      launch: 'Rescue One, cleared for lift. Head north to Mount Kell.',
      signal: "That's them! They've fired a flare.",
      spotted: 'Two climbers on the ledge. Bring us into a hover above them.',
      allAboard: 'Both climbers aboard! Take them to Varrow Hospital.',
      landed: "They're safe. Great flying, Rescue One.",
    },
    ready: true,
  },
  {
    id: 'lost-hiker',
    type: 'forest',
    title: 'Lost Hiker',
    icon: '🌲',
    place: 'Keld Forest',
    situation: "A hiker hasn't come home. Last phone ping: Keld Forest.",
    terrain: 'Dense forest',
    elevation: 75,
    wind: { speed: 3, from: 200, gust: 0.25 },
    visibility: 'fair',
    site: { x: 236, z: -186 },
    survivors: 1,
    look: 'hiker',
    search: { x: 330, z: -60, r: 320 },
    signal: 'smoke',
    signalRange: 340,
    spotRange: 170,
    reach: 5,
    startPad: 'base',
    deliverTo: 'hospital',
    requires: ['hover', 'hoist'],
    recommended: { vehicle: 'rescue-heli', crew: 'spotter', equipment: ['basket', 'beacon'] },
    fuel: 480,
    par: 230,
    radio: {
      call: ['Rescue One, a hiker is missing in Keld Forest.', 'Her phone pinged once. The search area is big.'],
      launch: 'Rescue One, cleared for lift. Search Keld Forest.',
      signal: "Smoke over the trees! She's lit a fire.",
      spotted: "There she is, in the clearing. Watch the trees on the way down.",
      allAboard: "She's aboard. Varrow Hospital, please.",
      landed: 'Hiker delivered. Well found, Rescue One.',
    },
    ready: true,
    unlockedBy: 'mountain-rescue',
  },
  {
    id: 'summit-storm',
    type: 'mountain',
    title: 'Storm on the Summit',
    icon: '⛈️',
    place: 'Mount Kell · summit shelf',
    situation: 'Three climbers caught by a storm near the summit.',
    terrain: 'Summit cliffs',
    elevation: 410,
    wind: { speed: 11, from: 280, gust: 0.6 },
    visibility: 'poor',
    site: { x: LEDGES.summit.x, z: LEDGES.summit.z },
    survivors: 3,
    look: 'climber',
    search: { x: 330, z: -760, r: 150 },
    signal: 'flare',
    signalRange: 520,
    spotRange: 190,
    reach: 5,
    startPad: 'base',
    deliverTo: 'hospital',
    requires: ['hover', 'hoist'],
    recommended: { vehicle: 'heavy-heli', crew: 'winch', equipment: ['basket', 'thermal'] },
    fuel: 600,
    par: 330,
    radio: {
      call: ['Rescue One, three climbers trapped near the summit.', 'Strong gusts and low cloud. This one is hard.'],
      launch: 'Rescue One, cleared for lift. Mind the gusts up top.',
      signal: 'Flare in the cloud, near the summit!',
      spotted: 'Three of them on the shelf. Hold it steady in this wind.',
      allAboard: 'Everyone aboard! Get them down to the hospital.',
      landed: 'All three safe. That was outstanding, Rescue One.',
    },
    ready: true,
    unlockedBy: 'lost-hiker',
  },
  // Built on the same rails, waiting for their vehicles and kit.
  { ...COMING, id: 'capsized-boat', type: 'water', title: 'Capsized Boat', icon: '🚤', place: 'Varrow Lake', situation: 'A sailing boat flipped. People in the water.', terrain: 'Open water', wind: { speed: 7, from: 270, gust: 0.4 }, visibility: 'good', survivors: 3, requires: ['water'], recommended: { vehicle: 'rescue-boat', crew: 'medic', equipment: ['swimmer'] }, radio: NO_RADIO, ready: false },
  { ...COMING, id: 'forest-fire', type: 'fire', title: 'Forest Fire', icon: '🔥', place: 'Keld Forest', situation: 'Hikers trapped by a wildfire.', terrain: 'Burning forest', wind: { speed: 8, from: 225, gust: 0.5 }, visibility: 'poor', survivors: 2, requires: ['hover', 'hoist', 'fire'], recommended: { vehicle: 'heavy-heli', crew: 'spotter', equipment: ['basket', 'bucket'] }, radio: NO_RADIO, ready: false },
  { ...COMING, id: 'flood', type: 'flood', title: 'Flood Rescue', icon: '🌊', place: 'Varrow village', situation: 'Families on rooftops as the river rises.', terrain: 'Flooded streets', wind: { speed: 5, from: 180, gust: 0.3 }, visibility: 'fair', survivors: 5, requires: ['hover', 'hoist'], recommended: { vehicle: 'heavy-heli', crew: 'winch', equipment: ['basket'] }, radio: NO_RADIO, ready: false },
  { ...COMING, id: 'injured-skier', type: 'snow', title: 'Injured Skier', icon: '⛷️', place: 'Mount Kell · east bowl', situation: 'A skier hurt off-piste.', terrain: 'Snow bowl', wind: { speed: 6, from: 0, gust: 0.4 }, visibility: 'fair', survivors: 1, requires: ['hover', 'hoist'], recommended: { vehicle: 'rescue-heli', crew: 'medic', equipment: ['basket', 'medkit'] }, radio: NO_RADIO, ready: false },
  { ...COMING, id: 'distress-beacon', type: 'beacon', title: 'Distress Beacon', icon: '📡', place: 'Somewhere in the basin', situation: 'An emergency beacon is transmitting.', terrain: 'Unknown', wind: { speed: 4, from: 90, gust: 0.2 }, visibility: 'good', survivors: 1, requires: ['search'], recommended: { vehicle: 'search-plane', crew: 'spotter', equipment: ['beacon'] }, radio: NO_RADIO, ready: false },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m])) as Record<MissionId, MissionDef>;

/** Wind direction as a compass word ("from the north-west" → "NW"). */
export function compassWord(deg: number): string {
  const words = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return words[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Light, moderate, strong: how wind reads on a phone. */
export function windWord(speed: number): 'Calm' | 'Light wind' | 'Moderate wind' | 'Strong wind' {
  if (speed < 2) return 'Calm';
  if (speed < 5) return 'Light wind';
  if (speed < 9) return 'Moderate wind';
  return 'Strong wind';
}

export const VISIBILITY_WORD: Record<Visibility, string> = { good: 'Good visibility', fair: 'Hazy', poor: 'Low cloud' };
