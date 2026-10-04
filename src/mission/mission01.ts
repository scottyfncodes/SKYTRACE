/**
 * MISSION 01: FIND THE TRUCK. All mission content lives here; the rules in
 * `mission.ts` only read it.
 *
 * The puzzle: four vehicle returns, each matching the intelligence on every
 * point but one. Only the supply truck matches all four.
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

export type ReturnId = 'A' | 'B' | 'C' | 'D';

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
    truth: 'A farm lorry on the main road, west of Sector 7.',
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

export const MISSION_01 = {
  code: 'MISSION 01',
  title: 'FIND THE TRUCK',
  objective: 'Locate the missing supply truck inside Sector 7.',
  success: 'Mark the truck, confirm where it goes, then return to base.',
  /** Layer 2: what the pilot knows before take-off. */
  intel: [
    'Last radio contact 10 minutes ago, driving a road inside Sector 7 (east of base, outlined in amber).',
    'It is a large cargo truck: bigger than our scout patrol of three light 4x4s, which is also in the sector.',
    'It should still be moving.',
  ],
  /** Compact reminder shown under the objective while searching. */
  intelShort: 'LARGE · MOVING · ON A ROAD · IN SECTOR 7',
  fuelSeconds: 420,
  operations: { area: SECTOR_7, orbitAgl: 260 },
  /** While the crew watched the truck, haze settled over the basin. */
  handback: { visibility: 0.42, notices: ['LOW VISIBILITY · HAZE OVER THE BASIN'] },
} as const satisfies MissionDef;
