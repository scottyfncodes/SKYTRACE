/**
 * MISSION 01: FIND THE TRUCK. All mission content lives here; the rules in
 * `mission.ts` only read it.
 *
 * The puzzle: four vehicle returns, each matching the intelligence on every
 * point but one. Only the supply truck matches all four. Each sensor answers
 * a different part of the question (radar: where and moving; optical: size
 * and road; thermal: size and engine heat; SIGINT: radio).
 *
 * The operation: route north of a storm cell, enter the sector low, find and
 * photograph the truck before the weather front arrives, then follow what the
 * recon turns up, and fly home under a cloud deck around a new storm.
 */
import type { Pt } from '../world/worldData';
import type { MissionDef } from './missionDef';

export interface Sector {
  id: string;
  label: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Sector 7: the eastern roads, from the haul road to the river landing. */
export const SECTOR_7: Sector = { id: 'sector7', label: 'SECTOR 7', x0: 400, z0: -300, x1: 1000, z1: 560 };

export type ReturnId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface ReturnDef {
  id: ReturnId;
  /** What the radar resolves it to. */
  size: 'large' | 'small';
  count: number;
  moving: boolean;
  onRoad: boolean;
  /** Route it drives (ping-pong) or the point it is parked at. */
  route: readonly Pt[];
  speed: number;
  /** Starting distance along the route, metres. */
  start: number;
  signature: number;
  concealment: number;
  isTarget: boolean;
  /** Thermal: is an engine running? */
  engine: 'running' | 'cold';
  /** SIGINT: is it transmitting? */
  radio: boolean;
  /** Not on the radar until the recon reveals it (dynamic objective). */
  hidden?: boolean;
  kind?: 'vehicle' | 'vessel';
  /** Plain-language identity, revealed in the debrief. */
  truth: string;
}

const MINE_ROAD: readonly Pt[] = [
  [720, 360],
  [770, 160],
  [760, -60],
  [720, -230],
];

/** The fixed cast (the original Mission 01): the title screen, the tests and `?roll=fixed`. */
export const DEFAULT_RETURNS: readonly ReturnDef[] = [
  {
    id: 'A',
    size: 'large',
    count: 1,
    moving: false,
    onRoad: true,
    route: [[612, 452]],
    speed: 0,
    start: 0,
    signature: 0.7,
    concealment: 0.1,
    isTarget: false,
    engine: 'cold',
    radio: false,
    truth: 'A broken-down quarry lorry parked beside the main road.',
  },
  {
    id: 'B',
    size: 'small',
    count: 3,
    moving: true,
    onRoad: true,
    route: [
      [690, 340],
      [560, 190],
      [470, 80],
    ],
    speed: 11,
    start: 120,
    signature: 0.6,
    concealment: 0.1,
    isTarget: false,
    engine: 'running',
    radio: true,
    truth: 'Our own scout patrol: three light 4x4s working the haul road.',
  },
  {
    id: 'C',
    size: 'large',
    count: 1,
    moving: true,
    onRoad: true,
    route: MINE_ROAD,
    speed: 12,
    start: 380,
    signature: 0.7,
    concealment: 0.1,
    isTarget: true,
    engine: 'running',
    radio: false,
    truth: 'The missing supply truck, circling the mine road with a dead radio.',
  },
  {
    id: 'D',
    size: 'large',
    count: 1,
    moving: true,
    onRoad: true,
    route: [
      [-150, 620],
      [0, 600],
      [200, 575],
      [350, 555],
    ],
    speed: 12,
    start: 260,
    signature: 0.7,
    concealment: 0.1,
    isTarget: false,
    engine: 'running',
    radio: false,
    truth: 'A farm lorry on the main road, west of Sector 7.',
  },
  {
    id: 'E',
    size: 'large',
    count: 1,
    moving: false,
    onRoad: false,
    route: [[528, 556]],
    speed: 0,
    start: 0,
    signature: 0.8,
    concealment: 0.1,
    isTarget: false,
    engine: 'running',
    radio: true,
    hidden: true,
    kind: 'vessel',
    truth: 'A river barge, engines running, taking the truck\'s cargo off the landing.',
  },
];

/** The returns this operation is played with (re-rolled at every take-off). */
export let RETURNS: readonly ReturnDef[] = DEFAULT_RETURNS;
export function setReturns(defs: readonly ReturnDef[]): void {
  RETURNS = defs;
}

type Decoy = Omit<ReturnDef, 'id'>;
const by = (id: ReturnId) => DEFAULT_RETURNS.find((r) => r.id === id)!;
const strip = ({ id: _id, ...rest }: ReturnDef): Decoy => rest;

/**
 * The look-alikes. Each fits the brief on every point but one, and each is
 * caught out by a different sensor: radar (parked, outside the sector), a
 * camera (three small vehicles), or only the OPTICAL camera (off the road).
 */
export const DECOYS: Record<'parked' | 'scouts' | 'west' | 'field', Decoy> = {
  parked: strip(by('A')),
  scouts: strip(by('B')),
  west: strip(by('D')),
  field: {
    size: 'large',
    count: 1,
    moving: true,
    onRoad: false,
    route: [
      [900, 280],
      [950, 120],
      [930, -60],
      [880, -200],
    ],
    speed: 8,
    start: 0,
    signature: 0.7,
    concealment: 0.1,
    isTarget: false,
    engine: 'running',
    radio: false,
    truth: 'A tractor-trailer cutting across the fields east of the mine road: off road the whole time.',
  },
};

const routeLength = (pts: readonly Pt[]) => pts.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

/**
 * A fresh puzzle for each operation: three of the four look-alikes, the
 * letters A–D shuffled, everything starting at a different point on its
 * road. The truck is always on the mine road (the recon that follows needs
 * it there); the barge is always E.
 */
export function rollReturns(rand: () => number): ReturnDef[] {
  const pool = Object.values(DECOYS);
  // drop one look-alike at random
  pool.splice(Math.floor(rand() * pool.length), 1);
  const cast: Decoy[] = [strip(by('C')), ...pool];
  const letters: ReturnId[] = ['A', 'B', 'C', 'D'];
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const rolled = cast.map((d, i) => ({ ...d, id: letters[i], start: d.route.length > 1 ? rand() * routeLength(d.route) : 0 }) as ReturnDef);
  rolled.push(by('E'));
  return rolled.sort((a, b) => a.id.localeCompare(b.id));
}

/** Where the truck goes once it has been found: back down the mine road, along the main road to the landing. */
export const DESTINATION = { name: 'Sallow river landing', short: 'RIVER LANDING', x: 520, z: 495 } as const;
export const DESTINATION_TAIL: readonly Pt[] = [
  [700, 380],
  [600, 440],
  [430, 505],
  [455, 470],
  [520, 495],
];
export const MINE_ROAD_PTS = MINE_ROAD;
export const TARGET_SPEED_TO_DESTINATION = 17;

export const OPERATIONS_AREA = SECTOR_7;

export const MISSION_01 = {
  id: 'mission01',
  code: 'MISSION 01',
  title: 'FIND THE TRUCK',
  objective: 'Locate, identify and photograph the missing supply truck in Sector 7.',
  success: 'Photograph the truck, act on what you find, then fly home and land.',
  /** Layer 2: what the crew knows before take-off. */
  intel: [
    'Last radio contact 10 minutes ago, driving a road inside Sector 7. Its radio has been silent since.',
    'It is a large cargo truck: bigger than our scout patrol of three light 4x4s, which is also in the sector.',
    'It should still be moving.',
  ],
  /** Compact reminder shown under the objective while searching. */
  intelShort: 'LARGE · MOVING · ON A ROAD · IN SECTOR 7',
  briefing: {
    headline: 'LOCATE THE MISSING SUPPLY TRUCK',
    primary: 'Find the supply truck in Sector 7 and photograph it.',
    secondaries: ['Reach Sector 7 undetected', 'Find out where the truck is going', 'Scout a clean way home'],
    weather: 'Clear at take-off. A storm cell sits over the main road between base and the sector.',
    conditions: 'A front arrives from the west 12 minutes after you reach the sector. Three ways home, each unscouted: storms, low cloud and radar are out there. How you fly home depends on what Mission Control finds.',
    targetArea: 'Sector 7: the eastern roads, outlined in amber. Grid I–K / 5–9.',
    constraints: ['Fly the ring route north of the storm', 'Enter Sector 7 low: the ridge radar sees anything above your stealth ceiling', 'Land at base before fuel runs out'],
    window: '12 min at Mission Control before the front arrives',
    threats: ['Ridge radar watching the sector', 'Storm cell over the main road', 'Our own scout patrol is in the sector: do not misidentify it'],
  },
  clues: ['LARGE', 'MOVING', 'ON A ROAD', 'RADIO DEAD', 'IN SECTOR 7'],
  risks: [
    { icon: '◯', text: 'Fly the rings · around the storm' },
    { icon: '📡', text: 'Ridge radar · rings take you in low' },
    { icon: '⏱', text: 'Mission Control · 12 min to plan the exit' },
  ],
  operations: { area: SECTOR_7 },
  reconWindow: 300,
  reconVisibilityEnd: 0.55,
  // Out: climb away from the runway, swing north around the storm, cross the
  // high ground, then drop under the ridge radar into the sector.
  outbound: {
    id: 'outbound',
    title: 'FLY THE RINGS',
    gates: [
      { kind: 'ring', id: 'o1', x: -560, z: 760, agl: 120, r: 44 },
      { kind: 'ring', id: 'o2', x: -370, z: 610, agl: 140, r: 40 },
      { kind: 'ring', id: 'o3', x: -300, z: 340, agl: 200, r: 38, cue: 'AROUND THE STORM' },
      { kind: 'ring', id: 'o4', x: -80, z: 160, agl: 240, r: 38 },
      { kind: 'ring', id: 'o5', x: 170, z: 60, agl: 200, r: 36 },
      { kind: 'ring', id: 'o6', x: 330, z: 170, agl: 130, r: 36, cue: 'LOW' },
      { kind: 'ring', id: 'o7', x: 500, z: 220, agl: 90, r: 34, cue: 'LOW' },
      { kind: 'ring', id: 'o8', x: 660, z: 150, agl: 80, r: 38, cue: 'LOW' },
    ],
    hazards: [{ kind: 'storm', id: 'storm1', label: 'STORM CELL', x: -80, z: 480, r: 230 }],
    radar: SECTOR_7,
  },
  // Home: lower, tighter, a slalom between the new storm and the river under
  // the cloud deck. Leaving the sector raises RADAR CONTACT: every ring is on a clock.
  return: {
    id: 'return',
    title: 'RETURN TO BASE',
    gates: [
      { kind: 'ring', id: 'r1', x: 430, z: 470, agl: 90, r: 34, alert: true },
      { kind: 'ring', id: 'r2', x: 270, z: 610, agl: 70, r: 32 },
      { kind: 'ring', id: 'r3', x: 90, z: 560, agl: 90, r: 32 },
      { kind: 'ring', id: 'r4', x: -110, z: 660, agl: 60, r: 30 },
      { kind: 'ring', id: 'r5', x: -290, z: 600, agl: 90, r: 30 },
      { kind: 'ring', id: 'r6', x: -450, z: 690, agl: 60, r: 30 },
      { kind: 'ring', id: 'r7', x: -600, z: 760, agl: 35, r: 34, cue: 'LINE UP · RUNWAY' },
      { kind: 'land', id: 'land', label: 'LANDING', objective: 'LAND AT BASE', detail: 'LOW OVER THE RUNWAY' },
    ],
    hazards: [
      { kind: 'storm', id: 'storm2', label: 'STORM CELL', x: 20, z: 260, r: 230 },
      { kind: 'ceiling', id: 'deck', label: 'CLOUD DECK', y: 300 },
    ],
    visibility: 0.45,
    notices: ['CLOUDS AT 300 m · STAY BELOW', 'STORM ON THE DIRECT ROUTE'],
  },
} as const satisfies MissionDef;
