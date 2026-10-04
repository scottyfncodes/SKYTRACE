/**
 * A loadout is the player's plan: aircraft, who sits in its seats, and what
 * fills its equipment bays. `capabilities` turns it into the concrete rules
 * the rest of the game reads, so every choice changes how the job is done.
 */
import type { FlightPerf } from '../flight/aircraft';
import { AIRCRAFT, AIRCRAFT_BY_ID, CREW_BY_ID, type EquipmentId, type SeatRole } from './catalog';

export interface Loadout {
  aircraft: string;
  /** Seat → crew id (null = empty seat). */
  crew: Partial<Record<SeatRole, string | null>>;
  equipment: EquipmentId[];
}

export function defaultLoadout(): Loadout {
  return { aircraft: 'kestrel', crew: {}, equipment: ['radar', 'optical'] };
}

export interface Capabilities {
  aircraftName: string;
  perf: FlightPerf;
  fuelSeconds: number;
  stealthCeiling: number;
  /** Multiplier on turbulence and storm damage (0..1). */
  weatherExposure: number;
  /** Who flies while the player operates. */
  flightControl: { mode: 'autopilot' | 'crew'; label: string };
  orbit: { r: number; agl: number };
  /** Multiplier on camera identification time (lower is faster). */
  identifyTime: number;
  /** Added to photograph quality (0..). */
  photoBonus: number;
  /** Navigation aid: gates and weather on the scope from take-off. */
  routeAware: boolean;
  sensors: Set<EquipmentId>;
}

const skill = (id: string | null | undefined, k: 'piloting' | 'navigation' | 'sensors' | 'identification' | 'weather') => (id ? (CREW_BY_ID[id]?.skills[k] ?? 0) : 0);

export function capabilities(l: Loadout): Capabilities {
  const ac = AIRCRAFT_BY_ID[l.aircraft] ?? AIRCRAFT[0];
  const seated = (r: SeatRole) => (ac.seats.includes(r) ? (l.crew[r] ?? null) : null);
  const copilot = seated('copilot');
  const navigator = seated('navigator');
  const sensorOp = seated('sensor');
  const piloting = skill(copilot, 'piloting');
  const weather = Math.max(skill(copilot, 'weather'), skill(navigator, 'weather'));
  const navigation = Math.max(skill(copilot, 'navigation'), skill(navigator, 'navigation'));
  return {
    aircraftName: ac.name,
    perf: ac.perf,
    fuelSeconds: ac.fuelSeconds,
    stealthCeiling: ac.stealthCeiling,
    weatherExposure: (1 - ac.weatherTolerance) * (1 - 0.15 * weather),
    flightControl: copilot ? { mode: 'crew', label: `${CREW_BY_ID[copilot].name} HAS CONTROL` } : { mode: 'autopilot', label: 'AUTOPILOT FLYING' },
    // a copilot flies a tighter orbit than the autopilot: closer looks, better photographs
    orbit: { r: ac.orbit.r - (copilot ? 30 + 10 * piloting : 0), agl: ac.orbit.agl - (copilot ? 10 * piloting : 0) },
    identifyTime: 1 - 0.15 * skill(sensorOp, 'sensors'),
    photoBonus: 0.05 * skill(sensorOp, 'identification'),
    routeAware: navigation >= 2,
    sensors: new Set(l.equipment),
  };
}

export interface LoadoutCheck {
  ok: boolean;
  /** Capability checklist for the mission, in order. */
  items: { label: string; ok: boolean; required: boolean }[];
  /** Why TAKE OFF is unavailable (empty when ok). */
  reason: string;
}

/** Is this loadout able to fly Mission 01's primary objective? */
export function checkLoadout(l: Loadout, unlocked: (id?: string) => boolean): LoadoutCheck {
  const ac = AIRCRAFT_BY_ID[l.aircraft];
  const has = (e: EquipmentId) => l.equipment.includes(e);
  const imaging = has('optical') || has('thermal');
  const items = [
    { label: 'SEARCH · find the vehicles (radar)', ok: has('radar'), required: true },
    { label: 'IDENTIFY · tell them apart (optical or thermal)', ok: imaging, required: true },
    { label: 'PHOTOGRAPH · evidence (optical or thermal)', ok: imaging, required: true },
    { label: 'SEE THROUGH HAZE (thermal)', ok: has('thermal'), required: false },
    { label: 'HEAR RADIOS (SIGINT)', ok: has('sigint'), required: false },
  ];
  let reason = '';
  if (!ac || !unlocked(ac.unlock)) reason = 'CHOOSE AN AVAILABLE AIRCRAFT';
  else if (l.equipment.length > ac.slots) reason = `${ac.name} CARRIES ${ac.slots} SYSTEMS`;
  else if (!has('radar')) reason = 'THE PRIMARY OBJECTIVE NEEDS THE SEARCH RADAR';
  else if (!imaging) reason = 'THE PRIMARY OBJECTIVE NEEDS AN IMAGING SENSOR';
  else {
    for (const [seat, id] of Object.entries(l.crew)) {
      if (!id) continue;
      const c = CREW_BY_ID[id];
      if (!c || c.role !== seat || !ac.seats.includes(seat as SeatRole) || !unlocked(c.unlock)) reason = 'CREW DOES NOT FIT THIS AIRCRAFT';
    }
  }
  return { ok: !reason, items, reason };
}

/** Change aircraft: keep crew that still has a seat and equipment that still fits. */
export function withAircraft(l: Loadout, id: string): Loadout {
  const ac = AIRCRAFT_BY_ID[id];
  if (!ac) return l;
  const crew: Loadout['crew'] = {};
  for (const r of ac.seats) crew[r] = l.crew[r] ?? null;
  const eq = l.equipment.slice(0, ac.slots);
  return { aircraft: id, crew, equipment: eq };
}

/**
 * Toggle a system in or out of the bays. When the bays are full the newest
 * system swaps out the most recently added one, so the core fit you chose
 * first (usually the search radar) stays aboard.
 */
export function toggleEquipment(l: Loadout, e: EquipmentId): Loadout {
  const ac = AIRCRAFT_BY_ID[l.aircraft];
  if (l.equipment.includes(e)) return { ...l, equipment: l.equipment.filter((x) => x !== e) };
  const eq = [...l.equipment];
  while (ac && eq.length >= ac.slots) eq.pop();
  eq.push(e);
  return { ...l, equipment: eq };
}

export function seatCrew(l: Loadout, seat: SeatRole, id: string | null): Loadout {
  const crew = { ...l.crew };
  // one person, one seat
  if (id) for (const k of Object.keys(crew) as SeatRole[]) if (crew[k] === id) crew[k] = null;
  crew[seat] = id;
  return { ...l, crew };
}
