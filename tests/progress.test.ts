/**
 * Pre-Flight and progression: a plan is a vehicle, a crew member and a little
 * kit; Pre-Flight says plainly when a plan cannot do the job; finishing a
 * rescue opens harder ones and new tools.
 */
import { describe, expect, it } from 'vitest';
import { CREW, EQUIPMENT, VEHICLES } from '../src/rescue/catalog';
import { canLaunch, checkLoadout, defaultLoadout, planOf, toggleEquipment, withCrew, withVehicle } from '../src/rescue/loadout';
import { compassWord, MISSIONS, MISSION_BY_ID, windWord } from '../src/rescue/missions';
import { isAvailable, isOpen, loadProgress, newProgress, nextMission, PROGRESS_KEY, recordRescue, saveProgress } from '../src/rescue/progress';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const mountain = MISSION_BY_ID['mountain-rescue'];
const hiker = MISSION_BY_ID['lost-hiker'];
const storm = MISSION_BY_ID['summit-storm'];

describe('the catalogue', () => {
  it('every reference in a mission resolves to a real vehicle, crew member and piece of kit', () => {
    const v = new Set(VEHICLES.map((x) => x.id));
    const c = new Set(CREW.map((x) => x.id));
    const e = new Set(EQUIPMENT.map((x) => x.id));
    const m = new Set(MISSIONS.map((x) => x.id));
    for (const def of MISSIONS) {
      expect(v.has(def.recommended.vehicle), def.id).toBe(true);
      expect(c.has(def.recommended.crew), def.id).toBe(true);
      for (const k of def.recommended.equipment) expect(e.has(k), def.id).toBe(true);
      if (def.unlockedBy) expect(m.has(def.unlockedBy)).toBe(true);
    }
    for (const x of [...VEHICLES, ...EQUIPMENT, ...CREW]) if (x.unlockedBy) expect(m.has(x.unlockedBy)).toBe(true);
  });

  it('every playable rescue can be done with its recommended plan, and has radio for every beat', () => {
    for (const def of MISSIONS.filter((x) => x.ready)) {
      expect(canLaunch(def, { vehicle: def.recommended.vehicle, crew: def.recommended.crew, equipment: [...def.recommended.equipment] }), def.id).toBe(true);
      for (const line of [def.radio.launch, def.radio.signal, def.radio.spotted, def.radio.allAboard, def.radio.landed]) {
        expect(line.length, def.id).toBeGreaterThan(5);
        expect(line.split(' ').length, `${def.id}: keep radio short`).toBeLessThanOrEqual(14);
      }
      expect(def.situation.split(' ').length, 'one line').toBeLessThanOrEqual(12);
    }
  });

  it('the vehicles each have an obvious job, in a few words', () => {
    for (const v of VEHICLES) {
      expect(v.strengths.length).toBeLessThanOrEqual(3);
      for (const s of v.strengths) expect(s.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('reads the wind the way a phone screen should', () => {
    expect(compassWord(315)).toBe('NW');
    expect(compassWord(0)).toBe('N');
    expect(compassWord(-90)).toBe('W');
    expect(windWord(1)).toBe('Calm');
    expect(windWord(6)).toBe('Moderate wind');
    expect(windWord(11)).toBe('Strong wind');
  });
});

describe('Pre-Flight', () => {
  it('a new player starts with the basic helicopter, the basket and the first rescue', () => {
    const p = newProgress();
    expect(nextMission(p).id).toBe('mountain-rescue');
    expect(isAvailable(p, hiker)).toBe(false);
    expect(defaultLoadout(mountain, p)).toEqual({ vehicle: 'rescue-heli', crew: 'winch', equipment: ['basket'] });
    // the rescue helicopter, and the fire fleet's helicopter and tanker
    expect(VEHICLES.filter((v) => isAvailable(p, v)).map((v) => v.id)).toEqual(['rescue-heli', 'fire-heli', 'tanker']);
  });

  it('forgetting the basket blocks the launch and says why', () => {
    const l = toggleEquipment(defaultLoadout(mountain, newProgress()), 'basket');
    expect(l.equipment).toEqual([]);
    const notes = checkLoadout(mountain, l);
    expect(notes.some((n) => n.blocking && /basket/i.test(n.text))).toBe(true);
    expect(canLaunch(mountain, l)).toBe(false);
  });

  it('equipment fits the slots: a third piece pushes out the first', () => {
    let l = defaultLoadout(mountain, newProgress());
    l = toggleEquipment(l, 'beacon');
    expect(l.equipment).toEqual(['basket', 'beacon']);
    l = toggleEquipment(l, 'thermal');
    expect(l.equipment).toEqual(['beacon', 'thermal']);
    l = withVehicle({ ...l, equipment: ['basket', 'beacon', 'thermal'] }, 'rescue-heli');
    expect(l.equipment).toHaveLength(2);
  });

  it('warns (without blocking) about two trips, gusts, a big search and low cloud', () => {
    const l = { vehicle: 'rescue-heli' as const, crew: 'winch' as const, equipment: ['basket' as const] };
    const s = checkLoadout(storm, l).map((n) => n.text).join(' ');
    expect(s).toMatch(/2 trips/);
    expect(s).toMatch(/gusts/i);
    expect(s).toMatch(/thermal/i);
    expect(canLaunch(storm, l)).toBe(true);
    expect(checkLoadout(hiker, l).map((n) => n.text).join(' ')).toMatch(/beacon receiver or a spotter/);
    expect(checkLoadout(hiker, withCrew(l, 'spotter')).some((n) => /spotter/.test(n.text))).toBe(false);
  });

  it('the plan changes the rescue: steadier basket, faster boarding, sharper eyes, a bigger cabin', () => {
    const base = planOf(mountain, { vehicle: 'rescue-heli', crew: 'winch', equipment: ['basket'] });
    const medic = planOf(mountain, { vehicle: 'rescue-heli', crew: 'medic', equipment: ['basket'] });
    const spot = planOf(mountain, { vehicle: 'rescue-heli', crew: 'spotter', equipment: ['basket', 'thermal'] });
    const heavy = planOf(storm, { vehicle: 'heavy-heli', crew: 'winch', equipment: ['basket'] });
    expect(base.hoist.damping).toBeGreaterThan(medic.hoist.damping);
    expect(medic.hoist.boardTime).toBeLessThan(base.hoist.boardTime);
    expect(spot.spotMult).toBeGreaterThan(2.5);
    expect(heavy.capacity).toBeGreaterThanOrEqual(storm.survivors);
    expect(heavy.windFactor).toBeLessThan(base.windFactor);
    expect(base.hoist.reach).toBe(mountain.reach);
  });
});

describe('progression', () => {
  it('a clean mountain rescue opens the lost hiker, the beacon receiver and the spotter; then the storm and the heavy helicopter', () => {
    const p = newProgress();
    const l = defaultLoadout(mountain, p);
    const opened = recordRescue(p, 'mountain-rescue', { stars: 2, time: 200, rescued: 2 }, l);
    expect(opened.join(' ')).toMatch(/Lost Hiker/);
    expect(opened.join(' ')).toMatch(/Beacon Receiver/);
    expect(opened.join(' ')).toMatch(/Spotter/);
    expect(isAvailable(p, hiker)).toBe(true);
    expect(isOpen(p, CREW.find((c) => c.id === 'spotter')!)).toBe(true);
    expect(nextMission(p).id).toBe('lost-hiker');
    expect(isAvailable(p, storm)).toBe(false);
    const opened2 = recordRescue(p, 'lost-hiker', { stars: 1, time: 300, rescued: 1 }, defaultLoadout(hiker, p));
    expect(opened2.join(' ')).toMatch(/Storm on the Summit/);
    expect(opened2.join(' ')).toMatch(/Heavy Rescue Helicopter/);
    expect(defaultLoadout(storm, p).vehicle).toBe('heavy-heli');
    expect(p.saved).toBe(3);
  });

  it('a replay opens nothing new, keeps the best stars and time, and remembers the plan', () => {
    const p = newProgress();
    const l = defaultLoadout(mountain, p);
    recordRescue(p, 'mountain-rescue', { stars: 3, time: 150, rescued: 2 }, l);
    const again = recordRescue(p, 'mountain-rescue', { stars: 1, time: 260, rescued: 2 }, { ...l, crew: 'medic' });
    expect(again).toEqual([]);
    expect(p.done['mountain-rescue']).toEqual({ stars: 3, best: 150, rescues: 2 });
    expect(defaultLoadout(mountain, p).crew).toBe('medic');
  });

  it('saves and loads, and survives junk and unknown missions', () => {
    const st = mem();
    const p = newProgress();
    recordRescue(p, 'mountain-rescue', { stars: 2, time: 200, rescued: 2 }, defaultLoadout(mountain, p));
    saveProgress(p, st);
    expect(loadProgress(st).done['mountain-rescue']?.stars).toBe(2);
    st.setItem(PROGRESS_KEY, '{nope');
    expect(loadProgress(st)).toEqual(newProgress());
    st.setItem(PROGRESS_KEY, JSON.stringify({ done: { 'old-mission': { stars: 3, best: 1, rescues: 1 } }, saved: 'x' }));
    expect(loadProgress(st)).toEqual(newProgress());
  });

  it('a saved plan that no longer fits falls back to the recommended one', () => {
    const p = newProgress();
    p.last['mountain-rescue'] = { vehicle: 'heavy-heli', crew: 'winch', equipment: ['basket'] }; // not unlocked
    expect(defaultLoadout(mountain, p).vehicle).toBe('rescue-heli');
  });
});
