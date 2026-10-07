/**
 * The squadron's career: credits, experience and what has been unlocked.
 * Stored separately from the open case save and from control preferences.
 * Unlocks are data, so new aircraft, crew and equipment slot in naturally.
 */
import type { Grade, Report } from './score';
import type { Loadout } from './loadout';

export const CAREER_KEY = 'skytrace.career.v1';

export interface Career {
  version: 1;
  credits: number;
  xp: number;
  operations: number;
  completed: number;
  best: Record<string, Grade>;
  /** Best Mission Control score per mission. */
  controlBest: Record<string, number>;
  unlocked: string[];
  lastLoadout: Loadout | null;
  /** Pages of the case file turned (see `story.ts`). */
  caseFile: number;
  /** The last page was flown clean: the case is closed (every page stays open to replay). */
  caseClosed: boolean;
}

export interface UnlockDef {
  id: string;
  xp: number;
  label: string;
}

/** In order of experience needed. */
export const UNLOCKS: readonly UnlockDef[] = [
  { id: 'vance', xp: 150, label: 'Sensor operator T. VANCE' },
  { id: 'sigint', xp: 280, label: 'SIGINT receiver' },
  { id: 'albatross', xp: 520, label: 'ALBATROSS survey aircraft · navigator L. REYES' },
];

interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function newCareer(): Career {
  return { version: 1, credits: 0, xp: 0, operations: 0, completed: 0, best: {}, controlBest: {}, unlocked: [], lastLoadout: null, caseFile: 0, caseClosed: false };
}

export function loadCareer(storage: Storage): Career {
  try {
    const raw = storage.getItem(CAREER_KEY);
    if (!raw) return newCareer();
    const c = JSON.parse(raw) as Partial<Career>;
    if (c.version !== 1) return newCareer();
    return { ...newCareer(), ...c, unlocked: Array.isArray(c.unlocked) ? c.unlocked : [], best: c.best ?? {}, controlBest: c.controlBest ?? {}, caseFile: typeof c.caseFile === 'number' ? c.caseFile : 0, caseClosed: !!c.caseClosed };
  } catch {
    return newCareer();
  }
}

export function saveCareer(c: Career, storage: Storage): void {
  try {
    storage.setItem(CAREER_KEY, JSON.stringify(c));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

/** Items without an unlock id are available from the start. */
export function isUnlocked(c: Career, id?: string): boolean {
  return !id || c.unlocked.includes(id);
}

const ORDER: Grade[] = ['F', 'D', 'C', 'B', 'A', 'S'];

/** Bank an operation's rewards. Returns the unlocks it earned. */
export function recordOperation(c: Career, missionId: string, r: Report): UnlockDef[] {
  c.operations += 1;
  if (r.success) c.completed += 1;
  c.credits += r.credits;
  c.xp += r.xp;
  const prev = c.best[missionId];
  if (!prev || ORDER.indexOf(r.grade) > ORDER.indexOf(prev)) c.best[missionId] = r.grade;
  const earned = UNLOCKS.filter((u) => c.xp >= u.xp && !c.unlocked.includes(u.id));
  for (const u of earned) c.unlocked.push(u.id);
  return earned;
}

export function nextUnlock(c: Career): UnlockDef | null {
  return UNLOCKS.find((u) => !c.unlocked.includes(u.id)) ?? null;
}
