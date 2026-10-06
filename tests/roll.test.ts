/**
 * Every operation is a fresh puzzle: the truck's letter is shuffled, three of
 * four look-alikes are out there, each broken by a different clue, and the
 * loadout decides which clues the crew can actually check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { rng } from '../src/core/math';
import { mismatchReason, newMission, RETURN_BY_ID, TARGET, useReturns } from '../src/mission/mission';
import { DECOYS, DEFAULT_RETURNS, MINE_ROAD_PTS, MISSION_01, RETURNS, rollReturns, SECTOR_7, type ReturnDef, type ReturnId } from '../src/mission/mission01';
import { clueChecks, newBoard, ruledOut, useAsset, type AssetId } from '../src/control/board';
import { CONTROL_01 } from '../src/mission/mission01Control';
import type { EquipmentId } from '../src/operation/catalog';
import { heightAt } from '../src/world/terrain';
import { ROADS, WATER_LEVEL } from '../src/world/worldData';

afterEach(() => useReturns(DEFAULT_RETURNS));

const rolls = (n: number) => Array.from({ length: n }, (_, i) => rollReturns(rng(1000 + i)));
const decoysOf = (cast: ReturnDef[]) => cast.filter((r) => !r.isTarget && r.kind !== 'vessel');

describe('the roll', () => {
  it('always a fair cast: one truck on the mine road, three look-alikes, the barge as E', () => {
    for (const cast of rolls(300)) {
      expect(cast.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
      const trucks = cast.filter((r) => r.isTarget);
      expect(trucks).toHaveLength(1);
      expect(trucks[0].route).toEqual(MINE_ROAD_PTS);
      expect(cast[4]).toMatchObject({ kind: 'vessel', hidden: true });
      const decoys = decoysOf(cast);
      expect(decoys).toHaveLength(3);
      // each look-alike breaks the brief on exactly one point
      for (const d of decoys) expect(mismatchReason(d, d.route[0][0], d.route[0][1]), d.truth).not.toBeNull();
      // and at least one of them can only be caught by looking (a camera)
      expect(decoys.some((d) => d.size === 'small' || d.count > 1 || !d.onRoad)).toBe(true);
    }
  });

  it('really varies: the truck takes every letter, every look-alike sits some runs out, starts differ', () => {
    const cast = rolls(300);
    expect(new Set(cast.map((c) => c.find((r) => r.isTarget)!.id))).toEqual(new Set(['A', 'B', 'C', 'D']));
    for (const d of Object.values(DECOYS)) {
      const present = cast.filter((c) => c.some((r) => r.truth === d.truth)).length;
      expect(present, d.truth).toBeGreaterThan(150);
      expect(present, d.truth).toBeLessThan(300);
    }
    expect(new Set(cast.map((c) => Math.round(c.find((r) => r.isTarget)!.start))).size).toBeGreaterThan(100);
    // the same seed is the same puzzle
    expect(rollReturns(rng(7))).toEqual(rollReturns(rng(7)));
  });

  it('the new look-alike really is off road, on dry ground, inside the sector', () => {
    const segDist = (x: number, z: number, a: readonly number[], b: readonly number[]) => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    };
    const A = MISSION_01.operations.area;
    for (const [x, z] of DECOYS.field.route) {
      const near = Math.min(...ROADS.flatMap((r) => r.pts.slice(1).map((p, i) => segDist(x, z, r.pts[i], p))));
      expect(near).toBeGreaterThan(80);
      expect(heightAt(x, z)).toBeGreaterThan(WATER_LEVEL + 5);
      expect(x > A.x0 && x < A.x1 && z > A.z0 && z < A.z1).toBe(true);
    }
  });

  it('playing a roll re-points the mission at it', () => {
    const cast = rollReturns(rng(42));
    useReturns(cast);
    const truck = cast.find((r) => r.isTarget)!;
    expect(TARGET.id).toBe(truck.id);
    expect(RETURN_BY_ID[truck.id]).toBe(truck);
    expect(RETURNS).toBe(cast);
    const m = newMission();
    expect(m.returns.E.hidden).toBe(true);
    useReturns(DEFAULT_RETURNS);
    expect(TARGET.id).toBe('C');
  });
});

describe('the loadout decides what can be checked (on the Mission Control board)', () => {
  /** A cast with the off-road lorry as A and the truck as C. */
  const withField = (): ReturnDef[] => DEFAULT_RETURNS.map((r) => (r.id === 'A' ? { ...DECOYS.field, id: 'A' as ReturnId } : r));
  const sector = (r: ReturnDef) => r.route.every(([x, z]) => x >= SECTOR_7.x0 && x <= SECTOR_7.x1 && z >= SECTOR_7.z0 && z <= SECTOR_7.z1);
  const looked = (cast: ReturnDef[], id: ReturnId, assets: AssetId[], kit: EquipmentId[]) => {
    const b = newBoard(CONTROL_01, cast, kit, rng(7));
    for (const a of assets) useAsset(b, cast, sector, MISSION_01.clues, a, a === 'sigint' ? { kind: 'none' } : { kind: 'return', id });
    const r = cast.find((x) => x.id === id)!;
    return clueChecks(r, b.returns[id]!, sector(r), MISSION_01.clues);
  };
  const check = (cs: ReturnType<typeof looked>, clue: string) => cs.find((c) => c.clue === clue)!.check;

  it('the optical camera catches the off-road look-alike', () => {
    const cs = looked(withField(), 'A', ['optical'], ['radar', 'optical']);
    expect(check(cs, 'ON A ROAD')).toBe('no');
    expect(ruledOut(cs)).toBe(true);
  });

  it('with only thermal it is indistinguishable from the truck: the road stays a question', () => {
    const decoy = looked(withField(), 'A', ['thermal'], ['radar', 'thermal']);
    const truck = looked(withField(), 'C', ['thermal'], ['radar', 'thermal']);
    expect(ruledOut(decoy)).toBe(false);
    expect(ruledOut(truck)).toBe(false);
    expect(check(decoy, 'ON A ROAD')).toBe('?');
  });

  it('SIGINT on board: the radio clue gets checked too', () => {
    const cs = looked(DEFAULT_RETURNS as ReturnDef[], 'C', ['optical', 'sigint'], ['radar', 'optical', 'sigint']);
    expect(cs.every((c) => c.check === 'yes')).toBe(true);
  });

  it('without SIGINT the radio clue is a known blind spot, never a reason to doubt the truck', () => {
    const cs = looked(DEFAULT_RETURNS as ReturnDef[], 'C', ['optical'], ['radar', 'optical']);
    expect(ruledOut(cs)).toBe(false);
    expect(cs.filter((c) => c.check === '?').map((c) => c.clue)).toEqual(['RADIO DEAD']);
  });
});
