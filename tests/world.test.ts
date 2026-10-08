import { describe, expect, it } from 'vitest';
import { forestAt, getHeightField, heightAt } from '../src/world/terrain';
import { BASE, CLEARINGS, FLATS, LEDGES, PADS, PEAK, gridRef } from '../src/world/worldData';

describe('terrain', () => {
  const hf = getHeightField();

  it('is flat enough at the base and on both helipads', () => {
    const hb = hf.sample(BASE.x, BASE.z);
    expect(hb).toBeGreaterThan(3);
    for (const dx of [-100, 0, 100]) for (const dz of [-30, 0, 30]) expect(Math.abs(hf.sample(BASE.x + dx, BASE.z + dz) - hb)).toBeLessThan(1.5);
    for (const p of Object.values(PADS)) {
      const h = hf.sample(p.x, p.z);
      expect(h, p.id).toBeGreaterThan(3);
      for (const [dx, dz] of [[-p.r, 0], [p.r, 0], [0, -p.r], [0, p.r]]) expect(Math.abs(hf.sample(p.x + dx, p.z + dz) - h), p.id).toBeLessThan(0.6);
      expect(forestAt(p.x, p.z), p.id).toBe(0);
    }
  });

  it('raises Mount Kell well above the ridge, with level ledges cut into it', () => {
    const top = hf.sample(PEAK.x, PEAK.z);
    expect(top).toBeGreaterThan(400);
    for (const l of Object.values(LEDGES)) {
      const h = hf.sample(l.x, l.z);
      expect(h).toBeGreaterThan(250);
      for (const [dx, dz] of [[-5, 0], [5, 0], [0, -5], [0, 5]]) expect(Math.abs(hf.sample(l.x + dx, l.z + dz) - h)).toBeLessThan(2);
      // and the mountain falls away around them: this is a narrow shelf, not a plateau
      let drop = 0;
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) drop = Math.max(drop, h - hf.sample(l.x + Math.cos(a) * 30, l.z + Math.sin(a) * 30));
      expect(drop).toBeGreaterThan(10);
    }
  });

  it('carves the river below water level', () => {
    expect(heightAt(-480, 20)).toBeLessThan(0);
    expect(heightAt(450, 520)).toBeLessThan(0);
  });

  it('leaves the forest clearing open inside a dense ring of trees', () => {
    const clearing = CLEARINGS[0];
    expect(forestAt(clearing.x, clearing.z)).toBeLessThan(0.15);
    let ring = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) ring += forestAt(clearing.x + Math.cos(a) * 110, clearing.z + Math.sin(a) * 110);
    expect(ring / 12).toBeGreaterThan(0.5);
  });

  it('has its flat regions', () => {
    expect(FLATS.length).toBeGreaterThan(5);
  });

  it('produces grid references', () => {
    expect(gridRef(-1200, -1200)).toBe('A-1');
    expect(gridRef(1199, 1199)).toBe('L-12');
    expect(gridRef(720, 380)).toBe('J-8');
  });
});
