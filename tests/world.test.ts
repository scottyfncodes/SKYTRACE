import { describe, expect, it } from 'vitest';
import { forestAt, getHeightField, heightAt } from '../src/world/terrain';
import { TruckSim } from '../src/world/truck';
import { BASE, CLEARINGS, FLATS, TRUCK_ROUTE, gridRef } from '../src/world/worldData';
import { CONTACTS } from '../src/intel/scenario';

describe('terrain', () => {
  it('is flat enough at the base and dry at every contact', () => {
    const hf = getHeightField();
    const hb = hf.sample(BASE.x, BASE.z);
    expect(hb).toBeGreaterThan(3);
    for (const dx of [-100, 0, 100]) for (const dz of [-30, 0, 30]) expect(Math.abs(hf.sample(BASE.x + dx, BASE.z + dz) - hb)).toBeLessThan(1.5);
    for (const c of CONTACTS) expect(heightAt(c.x, c.z)).toBeGreaterThan(2);
  });
  it('carves the river below water level', () => {
    expect(heightAt(-480, 20)).toBeLessThan(0);
    expect(heightAt(450, 520)).toBeLessThan(0);
  });
  it('hides the shed inside the forest but leaves the clearing open', () => {
    const clearing = CLEARINGS[0];
    expect(forestAt(clearing.x, clearing.z)).toBeLessThan(0.15);
    // dense forest ring around it
    let ring = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) ring += forestAt(clearing.x + Math.cos(a) * 110, clearing.z + Math.sin(a) * 110);
    expect(ring / 12).toBeGreaterThan(0.5);
  });
  it('has flat regions for every contact that needs one', () => {
    expect(FLATS.length).toBeGreaterThan(5);
  });
  it('produces grid references', () => {
    expect(gridRef(-1200, -1200)).toBe('A-1');
    expect(gridRef(1199, 1199)).toBe('L-12');
    expect(gridRef(720, 380)).toBe('J-8');
  });
});

describe('truck circuit', () => {
  it('drives the whole loop, hides under cover and waits at stops', () => {
    const t = new TruckSim(1);
    const segsSeen = new Set<number>();
    let hiddenFrames = 0;
    let waitFrames = 0;
    for (let i = 0; i < 60 * 600; i++) {
      t.step(1 / 60);
      segsSeen.add(t.seg);
      if (t.hidden) hiddenFrames++;
      if (!t.moving) waitFrames++;
    }
    expect(segsSeen.size).toBe(TRUCK_ROUTE.length);
    expect(hiddenFrames).toBeGreaterThan(0);
    expect(waitFrames).toBeGreaterThan(0);
    expect(Math.abs(t.x)).toBeLessThan(1200);
  });
});
