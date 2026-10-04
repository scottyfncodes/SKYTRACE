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

export const RETURNS: readonly ReturnDef[] = [
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
    secondaries: ['Reach Sector 7 undetected', 'Further tasking may follow once the truck is found'],
    weather: 'Clear at take-off. A storm cell sits over the main road between base and the sector.',
    conditions: 'A front arrives from the west about 5 minutes after you reach the sector: haze first, then a cloud deck at 300 m and a new storm cell across the direct route home.',
    targetArea: 'Sector 7: the eastern roads, outlined in amber. Grid I–K / 5–9.',
    constraints: ['Route north of the storm via Waypoint ALPHA', 'Enter Sector 7 low: the ridge radar sees anything above your stealth ceiling', 'Land at base before fuel runs out'],
    window: '5:00 on station before the front forces extraction',
    threats: ['Ridge radar watching the sector', 'Storm cell over the main road', 'Our own scout patrol is in the sector: do not misidentify it'],
  },
  clues: ['LARGE', 'MOVING', 'ON A ROAD', 'RADIO DEAD', 'IN SECTOR 7'],
  risks: [
    { icon: '⛈', text: 'Storm on the direct route · go via ALPHA' },
    { icon: '📡', text: 'Ridge radar · enter the sector low' },
    { icon: '⏱', text: '5 min on station before the weather turns' },
  ],
  operations: { area: SECTOR_7 },
  reconWindow: 300,
  reconVisibilityEnd: 0.55,
  outbound: {
    id: 'outbound',
    gates: [
      { kind: 'waypoint', id: 'alpha', label: 'ALPHA', x: -280, z: 200, r: 150, objective: 'FLY TO ALPHA', detail: 'GO AROUND THE STORM' },
      { kind: 'enterArea', id: 'sector', label: 'SECTOR 7', area: SECTOR_7, stealth: true, objective: 'ENTER SECTOR 7 LOW', detail: 'UNDER THE RADAR' },
    ],
    hazards: [{ kind: 'storm', id: 'storm1', label: 'STORM CELL', x: -80, z: 480, r: 230 }],
  },
  return: {
    id: 'return',
    gates: [
      { kind: 'waypoint', id: 'bravo', label: 'BRAVO', x: -140, z: 650, r: 160, objective: 'FLY TO BRAVO', detail: 'UNDER THE CLOUDS · AROUND THE STORM' },
      { kind: 'land', id: 'land', label: 'LANDING', objective: 'LAND AT BASE', detail: 'LOW OVER THE RUNWAY' },
    ],
    hazards: [
      { kind: 'storm', id: 'storm2', label: 'STORM CELL', x: 20, z: 260, r: 230 },
      { kind: 'ceiling', id: 'deck', label: 'CLOUD DECK', y: 300 },
    ],
    visibility: 0.45,
    notices: ['CLOUDS AT 300 m · STAY BELOW', 'NEW STORM ON THE DIRECT ROUTE'],
  },
} as const satisfies MissionDef;
