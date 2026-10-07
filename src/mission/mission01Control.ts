/**
 * MISSION 01 · MISSION CONTROL: the board between the two flights.
 *
 * Three ways home from Sector 7, each with two stretches nobody has looked
 * at yet. Two storm cells, a low cloud deck, a radar site, a supply cache
 * and one clear stretch are dealt across the six spots every operation.
 * The rules live in `control/board.ts`; this file is only content.
 */
import type { ControlDef } from '../control/board';

/** The brief's clues, in order (also on the mission def). */
export const CLUES_01: readonly string[] = ['LARGE', 'MOVING', 'ON A ROAD', 'RADIO DEAD', 'IN SECTOR 7'];

const FINAL = { agl: 35, r: 34, cue: 'LINE UP · RUNWAY' } as const;

export const CONTROL_01: ControlDef = {
  minutes: 12,
  fuelPerMinute: 0.025,
  limited: { drone: 2, scouts: 1 },
  cellMix: ['storm', 'storm', 'cloud', 'radar', 'cache', 'clear'],
  landing: { x: 528, z: 556, label: 'RIVER LANDING' },
  clues: CLUES_01,
  corridors: [
    {
      id: 'north',
      label: 'NORTH RIDGE',
      short: 'NORTH',
      note: 'Long way round over the high ground',
      rings: [
        { kind: 'ring', id: 'n1', x: 560, z: 150, agl: 110, r: 36 },
        { kind: 'ring', id: 'n2', x: 340, z: 40, agl: 120, r: 34 },
        { kind: 'ring', id: 'n3', x: 100, z: -20, agl: 130, r: 34 },
        { kind: 'ring', id: 'n4', x: -150, z: 40, agl: 120, r: 34 },
        { kind: 'ring', id: 'n5', x: -370, z: 230, agl: 100, r: 34 },
        { kind: 'ring', id: 'n6', x: -500, z: 500, agl: 80, r: 34 },
        { kind: 'ring', id: 'nf', x: -600, z: 760, ...FINAL },
      ],
      shortcut: 'n3',
      cells: [
        { id: 'N1', x: 220, z: 10 },
        { id: 'N2', x: -270, z: 120 },
      ],
    },
    {
      id: 'centre',
      label: 'CENTRE LINE',
      short: 'CENTRE',
      note: 'Straight at the base: short and quick',
      rings: [
        { kind: 'ring', id: 'c1', x: 520, z: 320, agl: 90, r: 34 },
        { kind: 'ring', id: 'c2', x: 300, z: 300, agl: 90, r: 34 },
        { kind: 'ring', id: 'c3', x: 80, z: 330, agl: 100, r: 32 },
        { kind: 'ring', id: 'c4', x: -150, z: 400, agl: 90, r: 32 },
        { kind: 'ring', id: 'c5', x: -380, z: 560, agl: 70, r: 32 },
        { kind: 'ring', id: 'cf', x: -600, z: 760, ...FINAL },
      ],
      shortcut: 'c3',
      cells: [
        { id: 'C1', x: 190, z: 310 },
        { id: 'C2', x: -265, z: 470 },
      ],
    },
    {
      id: 'river',
      label: 'RIVER VALLEY',
      short: 'RIVER',
      note: 'Low and winding along the water',
      rings: [
        { kind: 'ring', id: 'r1', x: 430, z: 470, agl: 90, r: 34 },
        { kind: 'ring', id: 'r2', x: 270, z: 610, agl: 70, r: 32 },
        { kind: 'ring', id: 'r3', x: 90, z: 560, agl: 90, r: 32 },
        { kind: 'ring', id: 'r4', x: -110, z: 660, agl: 60, r: 30 },
        { kind: 'ring', id: 'r5', x: -290, z: 600, agl: 90, r: 30 },
        { kind: 'ring', id: 'r6', x: -450, z: 690, agl: 60, r: 30 },
        { kind: 'ring', id: 'rf', x: -600, z: 760, ...FINAL },
      ],
      shortcut: 'r4',
      cells: [
        { id: 'R1', x: 180, z: 590 },
        { id: 'R2', x: -200, z: 640 },
      ],
    },
  ],
};
