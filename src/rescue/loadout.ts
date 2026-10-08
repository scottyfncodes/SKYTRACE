/**
 * The Pre-Flight plan: one vehicle, one crew member, a couple of pieces of
 * kit. What a plan can do is derived here, and so is anything the player
 * should know before they launch it.
 */
import type { FlightPerf } from '../flight/aircraft';
import { CREW, CREW_BY_ID, EQUIPMENT, EQUIPMENT_BY_ID, VEHICLES, VEHICLE_BY_ID, type Capability, type CrewId, type EquipmentId, type VehicleId } from './catalog';
import { HOIST, type HoistParams } from './hoist';
import type { MissionDef } from './missions';
import { isAvailable, isOpen, type Progress } from './progress';

export interface Loadout {
  vehicle: VehicleId;
  crew: CrewId;
  equipment: EquipmentId[];
}

export interface Note {
  text: string;
  /** Launching is not possible until this is fixed. */
  blocking: boolean;
}

const CAP_NEED: Record<Capability, string> = {
  hover: 'This rescue needs a helicopter.',
  hoist: 'Take the rescue basket: there is nowhere to land.',
  beacon: 'A beacon receiver is needed to find them.',
  thermal: 'A thermal camera is needed.',
  water: 'This rescue needs a boat or a swimmer.',
  fire: 'This rescue needs a water bucket.',
  search: 'This rescue needs a search aircraft.',
};

export function capsOf(l: Loadout): Set<Capability> {
  const caps = new Set<Capability>(VEHICLE_BY_ID[l.vehicle].caps);
  for (const e of l.equipment) for (const c of EQUIPMENT_BY_ID[e].caps) caps.add(c);
  return caps;
}

export function defaultLoadout(def: MissionDef, p: Progress): Loadout {
  const last = p.last[def.id];
  if (last && isValid(last, p)) return { ...last, equipment: [...last.equipment] };
  const r = def.recommended;
  const vehicle = isAvailable(p, VEHICLE_BY_ID[r.vehicle]) ? r.vehicle : VEHICLES.find((v) => isAvailable(p, v))!.id;
  const crew = isOpen(p, CREW_BY_ID[r.crew]) ? r.crew : CREW.find((c) => isOpen(p, c))!.id;
  const slots = VEHICLE_BY_ID[vehicle].slots;
  const equipment = r.equipment.filter((e) => isAvailable(p, EQUIPMENT_BY_ID[e])).slice(0, slots);
  if (!equipment.includes('basket') && def.requires.includes('hoist')) equipment.unshift('basket');
  return { vehicle, crew, equipment: equipment.slice(0, slots) };
}

function isValid(l: Loadout, p: Progress): boolean {
  const v = VEHICLE_BY_ID[l.vehicle];
  return !!v && isAvailable(p, v) && !!CREW_BY_ID[l.crew] && isOpen(p, CREW_BY_ID[l.crew]) && Array.isArray(l.equipment) && l.equipment.length <= v.slots && l.equipment.every((e) => EQUIPMENT_BY_ID[e] && isAvailable(p, EQUIPMENT_BY_ID[e]));
}

/** Pick a vehicle; kit that no longer fits comes off the end. */
export function withVehicle(l: Loadout, id: VehicleId): Loadout {
  return { ...l, vehicle: id, equipment: l.equipment.slice(0, VEHICLE_BY_ID[id].slots) };
}

export function withCrew(l: Loadout, id: CrewId): Loadout {
  return { ...l, crew: id };
}

/** Add or remove a piece of kit. Adding to full slots swaps out the oldest. */
export function toggleEquipment(l: Loadout, id: EquipmentId): Loadout {
  if (l.equipment.includes(id)) return { ...l, equipment: l.equipment.filter((e) => e !== id) };
  const slots = VEHICLE_BY_ID[l.vehicle].slots;
  const eq = [...l.equipment, id];
  while (eq.length > slots) eq.shift();
  return { ...l, equipment: eq };
}

/** What the player should know before launching this plan on this mission. */
export function checkLoadout(def: MissionDef, l: Loadout): Note[] {
  const notes: Note[] = [];
  const caps = capsOf(l);
  for (const need of def.requires) if (!caps.has(need)) notes.push({ text: CAP_NEED[need], blocking: true });
  const v = VEHICLE_BY_ID[l.vehicle];
  if (v.capacity > 0 && v.capacity < def.survivors) notes.push({ text: `Room for ${v.capacity}: ${def.survivors} people means ${Math.ceil(def.survivors / v.capacity)} trips.`, blocking: false });
  if (def.wind.speed >= 9 && v.windFactor > 0.7) notes.push({ text: 'Strong gusts: a light helicopter will be pushed around.', blocking: false });
  if (def.signal === 'smoke' && !caps.has('beacon') && l.crew !== 'spotter') notes.push({ text: 'Big search area: a beacon receiver or a spotter will help.', blocking: false });
  if (def.visibility === 'poor' && !caps.has('thermal')) notes.push({ text: 'Low cloud: they will be hard to see without thermal.', blocking: false });
  return notes;
}

export const canLaunch = (def: MissionDef, l: Loadout): boolean => !checkLoadout(def, l).some((n) => n.blocking);

/** Everything the flight and the rescue need to know about a plan. */
export interface Plan {
  perf: FlightPerf;
  capacity: number;
  windFactor: number;
  hoist: HoistParams;
  spotMult: number;
  beacon: boolean;
  thermal: boolean;
  fuelMult: number;
  style: 'rescue' | 'heavy';
}

export function planOf(def: MissionDef, l: Loadout): Plan {
  const v = VEHICLE_BY_ID[l.vehicle];
  const c = CREW_BY_ID[l.crew].effect;
  const caps = capsOf(l);
  return {
    perf: v.perf!,
    capacity: v.capacity,
    windFactor: v.windFactor,
    hoist: { ...HOIST, reach: def.reach, damping: HOIST.damping * (c.swingDamp ?? 1), boardTime: HOIST.boardTime * (c.boardTime ?? 1) },
    spotMult: (c.spotRange ?? 1) * (caps.has('thermal') ? 2 : 1),
    beacon: caps.has('beacon'),
    thermal: caps.has('thermal'),
    fuelMult: v.fuel,
    style: v.style ?? 'rescue',
  };
}

/** The choices Pre-Flight shows, open or not. */
export const choices = { vehicles: VEHICLES, crew: CREW, equipment: EQUIPMENT };
