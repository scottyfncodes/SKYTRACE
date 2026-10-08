/**
 * Rescue calls as data. A mission says what happened, where, to how many
 * people, in what conditions, and what it takes; the game does the rest.
 *
 * A new rescue of an existing kind is a new entry. A new kind (water, fire)
 * needs its capability on a vehicle or piece of equipment, and the mechanic
 * that capability unlocks.
 */
import type { Attack, Capability, CrewId, EquipmentId, VehicleId } from './catalog';
import type { FireSpec } from '../fire/fireSim';
import { LEDGES, type PadId } from '../world/worldData';

export type MissionId = 'mountain-rescue' | 'lost-hiker' | 'summit-storm' | 'spot-fire' | 'wind-fire' | 'mountain-fire' | 'hotspots' | 'forest-fire' | 'capsized-boat' | 'flood' | 'injured-skier' | 'distress-beacon';
export type RescueType = 'mountain' | 'forest' | 'water' | 'fire' | 'flood' | 'snow' | 'beacon';
export type Visibility = 'good' | 'fair' | 'poor';
/** How the people waiting for you show where they are. */
export type Signal = 'flare' | 'smoke' | 'none';
export type SurvivorLook = 'climber' | 'hiker' | 'skier';

/** A wildfire call: the fire itself, and what the crews are up against. */
export interface FireMission extends FireSpec {
  /** One word for the kind of fire, for the call list and Pre-Flight. */
  kind: string;
  /** Ground crews take over after this long (s from launch): hold the fire until then. 0: no hold (a rescue). */
  hold: number;
  /** Where a helicopter can fill its bucket. */
  water: readonly { name: string; x: number; z: number; r: number }[];
  /** Burned share of the forest (0..1) that still earns the "forest saved" star. */
  goodSpread: number;
  /** What Pre-Flight says about each way of fighting this fire. */
  advice: Partial<Record<Attack | 'none', string>>;
}

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
  /** A wildfire: the fire, the places it threatens, the water. */
  fire?: FireMission;
  /** Built and playable in this version. */
  ready: boolean;
  /** A clean rescue of this mission opens this one (none: open from the start). */
  unlockedBy?: MissionId;
}

/**
 * Fire calls use the same radio beats as a rescue: `signal` when the smoke is
 * in sight, `spotted` over the fire, `allAboard` when a line first holds the
 * front (or, with people trapped, when they are aboard), `landed` when the
 * crews take over.
 */
const FIRE = { site: { x: 0, z: 0 }, survivors: 0, look: 'hiker', signal: 'none', signalRange: 0, spotRange: 0, reach: 6, startPad: 'base', deliverTo: 'hospital', visibility: 'fair' } as const;

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
  {
    ...FIRE,
    id: 'spot-fire',
    type: 'fire',
    title: 'Lightning Strike',
    icon: '🔥',
    place: 'Hollin Wood',
    situation: 'Lightning has lit a small fire near a campsite.',
    terrain: 'Mixed forest',
    elevation: 60,
    wind: { speed: 4, from: 225, gust: 0.2 },
    visibility: 'good',
    search: { x: -540, z: -230, r: 120 },
    requires: ['fire'],
    recommended: { vehicle: 'fire-heli', crew: 'winch', equipment: [] },
    fuel: 420,
    par: 150,
    radio: {
      call: ['Fire One, lightning strike in Hollin Wood.', "It's small, but it's creeping toward the campsite."],
      launch: 'Fire One, cleared for lift. Fill up at the river on the way.',
      signal: 'Smoke ahead. That is our fire.',
      spotted: 'Over the fire. Put water on the hottest part.',
      allAboard: 'Good hit! It is knocking down.',
      landed: 'Fire is out. Campsite is safe. Nice work, Fire One.',
    },
    fire: {
      kind: 'Small fire',
      area: { x: -530, z: -230, size: 420 },
      ignitions: [{ x: -585, z: -190, r: 12 }],
      threats: [{ name: 'Hollin Campsite', icon: '⛺', x: -445, z: -330, r: 22 }],
      spread: 1,
      embers: 0,
      head: 30,
      hold: 240,
      water: [{ name: 'Varrow River', x: -640, z: -112, r: 40 }],
      goodSpread: 0.04,
      advice: { retardant: 'A tanker is a lot of plane for a fire this small.', lead: 'Three tanker lines for one small fire: overkill.' },
    },
    ready: true,
  },
  {
    ...FIRE,
    id: 'wind-fire',
    type: 'fire',
    title: 'Keld Forest Fire',
    icon: '🌬️',
    place: 'Keld Forest · Ashby',
    situation: 'A wind-driven fire is running at Ashby.',
    terrain: 'Dense forest',
    elevation: 80,
    wind: { speed: 9, from: 350, gust: 0.3 },
    visibility: 'fair',
    search: { x: 250, z: -120, r: 260 },
    requires: ['fire'],
    recommended: { vehicle: 'tanker', crew: 'spotter', equipment: [] },
    fuel: 420,
    par: 300,
    radio: {
      call: ['All units: fire in Keld Forest, running south on a strong wind.', 'Ashby is in its path. Ground crews are five minutes out.'],
      launch: 'Tanker One, airborne. Ashby is south of the fire.',
      signal: 'Smoke column in sight. It is moving fast.',
      spotted: 'Over the fire. Get a line in ahead of the head.',
      allAboard: 'The line is holding! The head has stopped.',
      landed: 'Ground crews have it. Ashby is safe. Outstanding, Tanker One.',
    },
    fire: {
      kind: 'Wind-driven',
      area: { x: 250, z: -120, size: 660 },
      ignitions: [{ x: 200, z: -340, r: 16 }],
      threats: [{ name: 'Ashby', icon: '🏘️', x: 270, z: 110, r: 36 }],
      spread: 0.9,
      embers: 1,
      head: 60,
      hold: 300,
      water: [{ name: 'Varrow River', x: 40, z: 280, r: 45 }],
      goodSpread: 0.22,
      advice: { water: 'A front this wide outruns one bucket at a time.', none: '' },
    },
    ready: true,
  },
  {
    ...FIRE,
    id: 'mountain-fire',
    type: 'fire',
    title: 'Mountain Fire',
    icon: '⛰️',
    place: 'Mount Kell · south slopes',
    situation: 'Fire climbing Mount Kell toward the mountain hut.',
    terrain: 'Steep slopes',
    elevation: 190,
    wind: { speed: 5, from: 180, gust: 0.35 },
    visibility: 'fair',
    search: { x: 110, z: -470, r: 200 },
    requires: ['fire'],
    recommended: { vehicle: 'fire-heli', crew: 'spotter', equipment: [] },
    fuel: 480,
    par: 260,
    radio: {
      call: ['Fire One, fire on the south slopes of Mount Kell.', 'It is running uphill at Kell Hut. Steep ground.'],
      launch: 'Fire One, cleared for lift. Dip tank is by the tower.',
      signal: 'Smoke on the mountain. It is climbing.',
      spotted: 'Over the fire. Hit the top edge, where it is climbing.',
      allAboard: 'That slowed it. Keep it off the ridge.',
      landed: 'Ground crews are on the ridge. Kell Hut is safe. Great flying.',
    },
    fire: {
      kind: 'Uphill',
      area: { x: 100, z: -470, size: 460 },
      ignitions: [{ x: 110, z: -380, r: 14 }],
      threats: [{ name: 'Kell Hut', icon: '🛖', x: 130, z: -560, r: 22 }],
      spread: 1.5,
      embers: 0.6,
      head: 40,
      hold: 270,
      water: [{ name: 'Dip tank', x: -40, z: -470, r: 26 }],
      goodSpread: 0.12,
      advice: { retardant: 'Steep ground: a tanker struggles to get low over the ridges.' },
    },
    ready: true,
    unlockedBy: 'wind-fire',
  },
  {
    ...FIRE,
    id: 'hotspots',
    type: 'fire',
    title: 'Dry Lightning',
    icon: '⚡',
    place: 'Keld Forest',
    situation: 'A storm has started three fires at once.',
    terrain: 'Dense forest',
    elevation: 80,
    wind: { speed: 2, from: 260, gust: 0.3 },
    visibility: 'good',
    search: { x: 230, z: -140, r: 300 },
    requires: ['fire'],
    recommended: { vehicle: 'spotter-plane', crew: 'spotter', equipment: [] },
    fuel: 480,
    par: 300,
    radio: {
      call: ['All units: dry lightning over Keld Forest.', 'Three fires, three places in danger. Pick your fights.'],
      launch: 'Lead One, airborne. Find the fire that matters most.',
      signal: 'I count three smoke columns.',
      spotted: 'Over the fires. Which one goes first?',
      allAboard: 'That one is held. Next!',
      landed: 'Ground crews are in. Everyone is safe. Superb call-making.',
    },
    fire: {
      kind: '3 hotspots',
      area: { x: 230, z: -140, size: 640 },
      ignitions: [
        { x: 60, z: -290, r: 12 },
        { x: 400, z: -290, r: 12 },
        { x: 250, z: -30, r: 12 },
      ],
      threats: [
        { name: 'Keld Lodge', icon: '🏠', x: -40, z: -200, r: 22 },
        { name: 'Forest School', icon: '🏫', x: 500, z: -190, r: 22 },
        { name: 'Ashby', icon: '🏘️', x: 270, z: 110, r: 30 },
      ],
      spread: 0.8,
      embers: 0,
      head: 40,
      hold: 280,
      water: [{ name: 'Varrow River', x: 40, z: 280, r: 45 }],
      goodSpread: 0.12,
      advice: { retardant: 'Three fires and two lines a load: you will be reloading.' },
    },
    ready: true,
    unlockedBy: 'wind-fire',
  },
  {
    ...FIRE,
    id: 'forest-fire',
    type: 'fire',
    title: 'Trapped by Fire',
    icon: '🆘',
    place: 'Keld Forest · the clearing',
    situation: 'Two hikers are trapped as a fire closes in.',
    terrain: 'Burning forest',
    elevation: 75,
    wind: { speed: 6, from: 270, gust: 0.4 },
    visibility: 'fair',
    site: { x: 236, z: -186 },
    survivors: 2,
    look: 'hiker',
    search: { x: 236, z: -186, r: 120 },
    signal: 'smoke',
    signalRange: 600,
    spotRange: 260,
    reach: 6,
    requires: ['hover', 'hoist'],
    recommended: { vehicle: 'fire-heli', crew: 'medic', equipment: ['basket'] },
    fuel: 480,
    par: 260,
    radio: {
      call: ['Rescue One, two hikers cut off by a fire in Keld Forest.', 'They are in the clearing. The fire is coming from the west.'],
      launch: 'Rescue One, cleared for lift. Hurry.',
      signal: 'Smoke over the trees. They are just east of it.',
      spotted: 'Got them in the clearing. Fire is close.',
      allAboard: 'Both aboard! Get them to the hospital.',
      landed: 'Both safe. That was close, Rescue One.',
    },
    fire: {
      kind: 'Fire + rescue',
      area: { x: 200, z: -180, size: 520 },
      ignitions: [{ x: 60, z: -150, r: 14 }],
      threats: [{ name: 'the hikers', icon: '🆘', x: 236, z: -186, r: 24 }],
      spread: 0.85,
      embers: 0.6,
      head: 30,
      hold: 0,
      water: [{ name: 'Varrow River', x: 40, z: 280, r: 45 }],
      goodSpread: 0.12,
      advice: { none: 'No water: you are racing the fire.', retardant: '', lead: '' },
    },
    ready: true,
    unlockedBy: 'spot-fire',
  },
  // Built on the same rails, waiting for their vehicles and kit.
  { ...COMING, id: 'capsized-boat', type: 'water', title: 'Capsized Boat', icon: '🚤', place: 'Varrow Lake', situation: 'A sailing boat flipped. People in the water.', terrain: 'Open water', wind: { speed: 7, from: 270, gust: 0.4 }, visibility: 'good', survivors: 3, requires: ['water'], recommended: { vehicle: 'rescue-boat', crew: 'medic', equipment: ['swimmer'] }, radio: NO_RADIO, ready: false },
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
