/**
 * The recon loop, spelled out for the operator:
 *
 *   FIND (radar) → PICK (a return) → LOOK (camera) → MATCH (the clues) → MARK
 *
 * Pure: the console shows the step strip, the clue card and one primary
 * action from what this module decides.
 */
import type { Phase } from './mission';
import type { ReturnId } from './mission01';

export type ClueCheck = 'yes' | 'no' | 'unknown';

/** Each clue from the brief against what the sensors know about a return. */
export function checkClues(clues: readonly string[], traits: readonly string[]): { clue: string; check: ClueCheck }[] {
  const has = (t: string) => traits.includes(t);
  return clues.map((clue) => {
    let check: ClueCheck = 'unknown';
    switch (clue) {
      case 'LARGE':
        check = has('LARGE') ? 'yes' : has('SMALL') || has('3 SMALL') || has('BOAT') ? 'no' : 'unknown';
        break;
      case 'MOVING':
        check = has('MOVING') ? 'yes' : has('PARKED') ? 'no' : 'unknown';
        break;
      case 'ON A ROAD':
        check = has('ON ROAD') ? 'yes' : has('OFF ROAD') || has('RIVER') ? 'no' : 'unknown';
        break;
      case 'RADIO DEAD':
        check = has('RADIO DEAD') ? 'yes' : has('RADIO ON') ? 'no' : 'unknown';
        break;
      case 'IN SECTOR 7':
        check = has('SECTOR 7') ? 'yes' : has('OUT OF SECTOR') ? 'no' : 'unknown';
        break;
    }
    return { clue, check };
  });
}

export type Sensor = 'radar' | 'optical' | 'thermal' | 'sigint';

/** Which sensors can settle each clue. */
export const CLUE_SENSORS: Record<string, readonly Sensor[]> = {
  LARGE: ['optical', 'thermal'],
  MOVING: ['radar'],
  'ON A ROAD': ['optical'],
  'RADIO DEAD': ['sigint'],
  'IN SECTOR 7': ['radar'],
};

type Checks = readonly { clue: string; check: ClueCheck }[];

/** The next open clue a fitted sensor can settle (null: nothing more to learn with this kit). */
export function nextCheck(checks: Checks, fitted: readonly Sensor[]): { clue: string; sensor: Sensor } | null {
  for (const c of checks) {
    if (c.check !== 'unknown') continue;
    const sensor = (CLUE_SENSORS[c.clue] ?? []).find((x) => fitted.includes(x));
    if (sensor) return { clue: c.clue, sensor };
  }
  return null;
}

/** Open clues nothing on board can settle: the risk the loadout left you with. */
export function blindClues(checks: Checks, fitted: readonly Sensor[]): string[] {
  return checks.filter((c) => c.check === 'unknown' && !(CLUE_SENSORS[c.clue] ?? []).some((x) => fitted.includes(x))).map((c) => c.clue);
}

export type Verdict = 'match' | 'mismatch' | 'unchecked' | 'check';

/**
 * Any clue contradicted → mismatch; not looked at yet → unchecked; a clue a
 * fitted sensor could still settle → check; otherwise a match (clues no
 * fitted sensor can settle stay open).
 */
export function clueVerdict(checks: Checks, resolved: boolean, fitted: readonly Sensor[] = []): Verdict {
  if (checks.some((c) => c.check === 'no')) return 'mismatch';
  if (!resolved) return 'unchecked';
  return nextCheck(checks, fitted) ? 'check' : 'match';
}

export type GuideStep = 'find' | 'pick' | 'look' | 'match' | 'mark';
export type GuideAction = 'radar' | 'look' | 'check' | 'next' | 'mark' | 'photo';

export interface GuideInput {
  phase: Phase;
  anyDetected: boolean;
  selected: ReturnId | null;
  /** A camera is the active sensor. */
  camera: boolean;
  /** The selected return has been looked at (size known). */
  resolved: boolean;
  /** The operator's call on the selected return. */
  marked: 'none' | 'correct' | 'wrong';
  verdict: Verdict;
  /** With verdict 'check': the clue to settle and the sensor that can. */
  check?: { clue: string; sensor: Sensor } | null;
}

const SHORT: Record<string, string> = { LARGE: 'SIZE', MOVING: 'MOVING', 'ON A ROAD': 'ROAD', 'RADIO DEAD': 'RADIO', 'IN SECTOR 7': 'SECTOR' };

export interface Guide {
  /** The step strip (locate phase only). */
  steps: { id: GuideStep; label: string; done: boolean; on: boolean }[] | null;
  /** The one thing to do next: a button when `action` is set, a cue otherwise. */
  next: { action: GuideAction | null; label: string } | null;
}

const LABELS: Record<GuideStep, string> = { find: 'FIND', pick: 'PICK', look: 'LOOK', match: 'MATCH', mark: 'MARK' };
const ORDER: GuideStep[] = ['find', 'pick', 'look', 'match', 'mark'];

export function reconGuide(i: GuideInput): Guide {
  if (i.phase === 'photograph') return { steps: null, next: i.camera ? { action: 'photo', label: 'TAKE THE PHOTO' } : { action: 'look', label: '📷 CAMERA ON THE TRUCK' } };
  if (i.phase === 'landing') return { steps: null, next: i.camera ? { action: 'photo', label: 'PHOTOGRAPH THE BARGE' } : { action: 'look', label: '📷 CAMERA ON THE BARGE' } };
  if (i.phase !== 'locate') return { steps: null, next: null };

  let step: GuideStep;
  let next: Guide['next'];
  const sel = i.selected;
  if (!i.anyDetected) {
    step = 'find';
    next = i.camera ? { action: 'radar', label: 'BACK TO RADAR' } : { action: null, label: 'RADAR SWEEPING · TAP MAP TO MOVE' };
  } else if (!sel || i.marked === 'wrong') {
    step = 'pick';
    next = { action: null, label: 'TAP A RETURN TO CHECK IT' };
  } else if (!i.resolved) {
    step = 'look';
    next = i.camera ? { action: null, label: `LOOKING AT ${sel}…` } : { action: 'look', label: `📷 LOOK AT ${sel}` };
  } else if (i.verdict === 'check' && i.check) {
    step = 'match';
    const c = i.check;
    next = { action: 'check', label: c.sensor === 'sigint' ? `SIGINT · LISTEN TO ${sel}` : `${c.sensor.toUpperCase()} ON ${sel} · ${SHORT[c.clue] ?? c.clue}?` };
  } else if (i.verdict === 'mismatch') {
    step = 'match';
    next = { action: 'next', label: 'NOT IT · NEXT RETURN' };
  } else {
    step = 'mark';
    next = { action: 'mark', label: `MARK ${sel} AS THE TRUCK` };
  }
  const at = ORDER.indexOf(step);
  return { steps: ORDER.map((id, k) => ({ id, label: LABELS[id], done: k < at, on: k === at })), next };
}
