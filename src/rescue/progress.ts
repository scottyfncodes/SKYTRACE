/**
 * Progression: which rescues are done, how well, and what that has opened.
 * Unlocks are not stored; they follow from what is done (`unlockedBy` on each
 * mission, vehicle, crew member and piece of equipment), so data changes never
 * strand a save.
 */
import { CREW, EQUIPMENT, VEHICLES, type CrewDef, type EquipmentDef, type VehicleDef } from './catalog';
import { MISSIONS, type MissionDef, type MissionId } from './missions';
import type { Loadout } from './loadout';

export const PROGRESS_KEY = 'skytrace.rescue.v1';

export interface MissionRecord {
  stars: number;
  /** Best time (s). */
  best: number;
  rescues: number;
}

export interface Progress {
  done: Partial<Record<MissionId, MissionRecord>>;
  /** The last plan flown on each mission. */
  last: Partial<Record<MissionId, Loadout>>;
  /** Survivors brought home, ever. */
  saved: number;
}

export const newProgress = (): Progress => ({ done: {}, last: {}, saved: 0 });

type Lockable = { unlockedBy?: MissionId; ready: boolean };
export const isOpen = (p: Progress, item: { unlockedBy?: MissionId }): boolean => !item.unlockedBy || !!p.done[item.unlockedBy];
export const isAvailable = (p: Progress, item: Lockable): boolean => item.ready && isOpen(p, item);

/** Everything a finished mission opens. */
export function opensWith(id: MissionId): { missions: MissionDef[]; vehicles: VehicleDef[]; equipment: EquipmentDef[]; crew: CrewDef[] } {
  return {
    missions: MISSIONS.filter((m) => m.unlockedBy === id && m.ready),
    vehicles: VEHICLES.filter((v) => v.unlockedBy === id && v.ready),
    equipment: EQUIPMENT.filter((e) => e.unlockedBy === id && e.ready),
    crew: CREW.filter((c) => c.unlockedBy === id),
  };
}

/**
 * Record a completed rescue. Returns the names of what it opened for the
 * first time (empty on a replay).
 */
export function recordRescue(p: Progress, id: MissionId, r: { stars: number; time: number; rescued: number }, loadout: Loadout): string[] {
  const first = !p.done[id];
  const prev = p.done[id];
  p.done[id] = { stars: Math.max(prev?.stars ?? 0, r.stars), best: Math.min(prev?.best ?? Infinity, r.time), rescues: (prev?.rescues ?? 0) + 1 };
  p.last[id] = { ...loadout, equipment: [...loadout.equipment] };
  p.saved += r.rescued;
  if (!first) return [];
  const o = opensWith(id);
  return [...o.missions.map((m) => `${m.icon} ${m.title}`), ...o.vehicles.map((v) => `${v.icon} ${v.name}`), ...o.equipment.map((e) => `${e.icon} ${e.name}`), ...o.crew.map((c) => `${c.icon} ${c.role}`)];
}

/** The next rescue to fly: the first open one not yet done, else the first. */
export function nextMission(p: Progress): MissionDef {
  const open = MISSIONS.filter((m) => isAvailable(p, m));
  return open.find((m) => !p.done[m.id]) ?? open[0];
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadProgress(s: Store): Progress {
  try {
    const raw = s.getItem(PROGRESS_KEY);
    if (!raw) return newProgress();
    const p = JSON.parse(raw) as Partial<Progress>;
    const known = new Set(MISSIONS.map((m) => m.id as string));
    const done: Progress['done'] = {};
    for (const [k, v] of Object.entries(p.done ?? {})) if (known.has(k) && v && typeof v.stars === 'number') done[k as MissionId] = v;
    return { done, last: p.last ?? {}, saved: typeof p.saved === 'number' ? p.saved : 0 };
  } catch {
    return newProgress();
  }
}

export function saveProgress(p: Progress, s: Store): void {
  try {
    s.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress lives for this session */
  }
}
