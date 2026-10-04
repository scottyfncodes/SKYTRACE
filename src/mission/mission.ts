/**
 * Mission rules: a small, explicit objective state machine. Pure and
 * deterministic so every transition is covered by tests; `Game` feeds it
 * radar gains and positions and renders the events it returns.
 *
 *   locate  → (correct MARK)            → destination
 *   destination → (stop confirmed)      → rtb
 *   rtb     → (landed at base)          → complete
 *   any active phase → (fuel / abort)   → failed
 */
import { DESTINATION, DESTINATION_TAIL, MINE_ROAD_PTS, MISSION_01, RETURNS, SECTOR_7, type ReturnDef, type ReturnId, type Sector } from './mission01';
import type { Pt } from '../world/worldData';
import { DETECT_THRESHOLD, RESOLVE_THRESHOLD } from '../sensors/radar';

export type Phase = 'locate' | 'destination' | 'rtb' | 'complete' | 'failed';

export interface ReturnState {
  id: ReturnId;
  detection: number;
  detected: boolean;
  resolved: boolean;
  /** Player's identification of this return. */
  verdict: 'none' | 'correct' | 'wrong';
  /** Last position the aircraft saw it at. */
  lastKnown: { x: number; z: number } | null;
  /** Seconds the camera has held it in view (identification). */
  look: number;
}

export interface MissionState {
  phase: Phase;
  returns: Record<ReturnId, ReturnState>;
  falsePositives: number;
  wrongIds: ReturnId[];
  targetIdentified: boolean;
  destinationConfirmed: boolean;
  /** 0..1 progress toward confirming the destination. */
  confirm: number;
  time: number;
  failReason: 'fuel' | 'aborted' | null;
}

export interface MissionEvent {
  type: 'detected' | 'resolved' | 'wrong' | 'objective-complete' | 'new-objective' | 'final-objective' | 'mission-complete' | 'mission-failed';
  title: string;
  text: string;
  id?: ReturnId;
}

export interface Objective {
  /** Short imperative shown in the HUD indicator. */
  title: string;
  /** One supporting line: what to look for, or how to do it. */
  detail: string;
  done: boolean;
}

/** How long the aircraft must stay over the truck's stop to confirm it. */
export const CONFIRM_SECONDS = 2.5;
export const CONFIRM_RANGE = 320;
/** Mission radar works a little faster than the open case: vehicles move, the sortie is short. */
export const MISSION_RATE = 2.5;
export const MARK_RANGE = 340;
/** Seconds of steady camera time to identify a return's size, count and road. */
export const CAMERA_SECONDS = 1.6;
/** Slant range at which the camera can still make out a vehicle. */
export const CAMERA_RANGE = 600;

/** Where the player is sitting, and whether they can open Mission Control from here. */
export interface StationContext {
  station?: 'pilot' | 'operator';
  inArea?: boolean;
  truckStopped?: boolean;
}

export function newMission(): MissionState {
  const returns = {} as Record<ReturnId, ReturnState>;
  for (const r of RETURNS) returns[r.id] = { id: r.id, detection: 0, detected: false, resolved: false, verdict: 'none', lastKnown: null, look: 0 };
  return { phase: 'locate', returns, falsePositives: 0, wrongIds: [], targetIdentified: false, destinationConfirmed: false, confirm: 0, time: 0, failReason: null };
}

export const RETURN_BY_ID: Readonly<Record<ReturnId, ReturnDef>> = Object.fromEntries(RETURNS.map((r) => [r.id, r])) as Record<ReturnId, ReturnDef>;
export const TARGET: ReturnDef = RETURNS.find((r) => r.isTarget)!;

export function inSector(x: number, z: number, s: Sector = SECTOR_7): boolean {
  return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
}

export function isActive(m: MissionState): boolean {
  return m.phase === 'locate' || m.phase === 'destination' || m.phase === 'rtb';
}

/** Does the current objective need the operator station (recon work), or the pilot? */
export function operatorWork(m: MissionState): boolean {
  return m.phase === 'locate' || m.phase === 'destination';
}

/**
 * The objective never changes with the station; the supporting line does,
 * so it always names the next thing to do from where the player is sitting.
 */
export function objectiveFor(m: MissionState, ctx: StationContext = {}): Objective {
  const pilot = ctx.station === 'pilot';
  switch (m.phase) {
    case 'locate':
      return {
        title: 'LOCATE THE SUPPLY TRUCK',
        detail: !pilot ? MISSION_01.intelShort : ctx.inArea ? 'IN SECTOR 7 · OPEN MISSION CONTROL' : 'FLY TO SECTOR 7 · THEN OPEN MISSION CONTROL',
        done: false,
      };
    case 'destination':
      return {
        title: "CONFIRM THE TRUCK'S DESTINATION",
        detail: pilot
          ? ctx.inArea
            ? 'OPEN MISSION CONTROL TO TRACK THE TRUCK'
            : 'FLY BACK TO SECTOR 7 · THEN OPEN MISSION CONTROL'
          : ctx.truckStopped
            ? 'TRUCK HAS STOPPED · HOLD THE CAMERA ON IT'
            : 'TRACK THE TRUCK WITH THE CAMERA UNTIL IT STOPS',
        done: false,
      };
    case 'rtb':
      return { title: 'RETURN TO BASE', detail: 'FLY LOW OVER THE AIRFIELD TO LAND', done: false };
    case 'complete':
      return { title: 'MISSION COMPLETE', detail: '', done: true };
    case 'failed':
      return { title: 'MISSION INCOMPLETE', detail: '', done: false };
  }
}

/** What the card says about a return. Size, count and road need a resolved (low) pass. */
export function describeReturn(m: MissionState, id: ReturnId, x: number, z: number, moving: boolean): { head: string; traits: string[]; resolved: boolean } {
  const st = m.returns[id];
  const def = RETURN_BY_ID[id];
  const traits: string[] = [];
  if (st.resolved) traits.push(def.count > 1 ? `${def.count} ${def.size.toUpperCase()} VEHICLES` : `${def.size.toUpperCase()} VEHICLE`);
  else traits.push('SIZE ? · USE THE CAMERA');
  traits.push(moving ? 'MOVING' : 'STATIONARY');
  if (st.resolved) traits.push(def.onRoad ? 'ON ROAD' : 'OFF ROAD');
  traits.push(inSector(x, z) ? 'IN SECTOR 7' : 'OUTSIDE SECTOR 7');
  return { head: `RETURN ${id}`, traits, resolved: st.resolved };
}

/** The first way a return contradicts the mission intelligence, or null for the truck. */
export function mismatchReason(def: ReturnDef, x: number, z: number): string | null {
  if (def.size !== 'large' || def.count !== 1) return `${def.count > 1 ? `${def.count} small vehicles` : 'a small vehicle'}, not one large truck`;
  if (!def.moving) return 'stationary, but the truck should be moving';
  if (!def.onRoad) return 'off road, but the truck was driving a road';
  if (!inSector(x, z)) return 'outside Sector 7';
  return null;
}

/**
 * Add radar confidence to a return. `canResolve` is the existing radar rule
 * (scan quality high enough for detail). Returns the events this caused.
 */
export function scanReturn(m: MissionState, id: ReturnId, gain: number, canResolve: boolean, x: number, z: number): MissionEvent[] {
  if (!isActive(m) || gain <= 0) return [];
  const st = m.returns[id];
  const ev: MissionEvent[] = [];
  st.detection += gain;
  st.lastKnown = { x, z };
  if (!st.detected && st.detection >= DETECT_THRESHOLD) {
    st.detected = true;
    ev.push({ type: 'detected', title: `RETURN ${id}`, text: `RADAR RETURN ${id} · VEHICLE`, id });
  }
  if (st.detected && !st.resolved && canResolve && st.detection >= RESOLVE_THRESHOLD) {
    st.resolved = true;
    const def = RETURN_BY_ID[id];
    ev.push({ type: 'resolved', title: `RETURN ${id}`, text: `RETURN ${id} RESOLVED · ${def.count > 1 ? `${def.count} ${def.size.toUpperCase()} VEHICLES` : `${def.size.toUpperCase()} VEHICLE`}`, id });
  }
  return ev;
}

/**
 * Camera time on a selected return. Radar finds and tracks; only the camera
 * shows what a return is (size, count, road). `inView` means selected,
 * slewed and within camera range.
 */
export function inspectReturn(m: MissionState, id: ReturnId, dt: number, inView: boolean): MissionEvent[] {
  if (!isActive(m) || !inView) return [];
  const st = m.returns[id];
  if (!st.detected || st.resolved) return [];
  st.look += dt;
  if (st.look < CAMERA_SECONDS) return [];
  st.resolved = true;
  const def = RETURN_BY_ID[id];
  return [{ type: 'resolved', title: `RETURN ${id}`, text: `CAMERA · RETURN ${id} IS ${def.count > 1 ? `${def.count} ${def.size.toUpperCase()} VEHICLES` : `A ${def.size.toUpperCase()} VEHICLE`}`, id }];
}

/** Player marks a return as "this is the truck". */
export function identify(m: MissionState, id: ReturnId): { result: 'correct' | 'wrong' | 'already' | 'unknown' | 'inactive'; events: MissionEvent[] } {
  if (m.phase !== 'locate') return { result: 'inactive', events: [] };
  const st = m.returns[id];
  if (!st.detected) return { result: 'unknown', events: [] };
  if (st.verdict !== 'none') return { result: 'already', events: [] };
  const def = RETURN_BY_ID[id];
  if (!def.isTarget) {
    st.verdict = 'wrong';
    m.falsePositives += 1;
    m.wrongIds.push(id);
    return { result: 'wrong', events: [{ type: 'wrong', title: 'NEGATIVE', text: `RETURN ${id} IS NOT THE SUPPLY TRUCK · CHECK THE INTEL`, id }] };
  }
  st.verdict = 'correct';
  m.targetIdentified = true;
  m.phase = 'destination';
  return {
    result: 'correct',
    events: [
      { type: 'objective-complete', title: 'OBJECTIVE COMPLETE', text: 'Supply truck located.', id },
      { type: 'new-objective', title: 'NEW OBJECTIVE', text: "Confirm the truck's destination. Track it until it stops." },
    ],
  };
}

/** Advance destination confirmation: the truck has stopped and the aircraft is over it. */
export function updateDestination(m: MissionState, dt: number, truckArrived: boolean, distToTruck: number): MissionEvent[] {
  if (m.phase !== 'destination') return [];
  if (truckArrived && distToTruck <= CONFIRM_RANGE) m.confirm = Math.min(1, m.confirm + dt / CONFIRM_SECONDS);
  else m.confirm = Math.max(0, m.confirm - dt / (CONFIRM_SECONDS * 2));
  if (m.confirm < 1) return [];
  m.destinationConfirmed = true;
  m.phase = 'rtb';
  return [
    { type: 'objective-complete', title: 'OBJECTIVE COMPLETE', text: `Destination confirmed: ${DESTINATION.name}.` },
    { type: 'final-objective', title: 'FINAL OBJECTIVE', text: 'Return to base.' },
  ];
}

/** Landing only completes the mission once the recon is done. */
export function land(m: MissionState): { ok: boolean; events: MissionEvent[] } {
  if (m.phase !== 'rtb') return { ok: false, events: [] };
  m.phase = 'complete';
  return { ok: true, events: [{ type: 'mission-complete', title: 'MISSION COMPLETE', text: 'Sortie complete. Debrief follows.' }] };
}

export function fail(m: MissionState, reason: 'fuel' | 'aborted'): MissionEvent[] {
  if (!isActive(m)) return [];
  m.phase = 'failed';
  m.failReason = reason;
  return [{ type: 'mission-failed', title: 'MISSION INCOMPLETE', text: reason === 'fuel' ? 'Fuel exhausted. Recovered on reserves.' : 'Mission aborted.' }];
}

export interface DebriefRow {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}

export interface Debrief {
  headline: string;
  success: boolean;
  rows: DebriefRow[];
  /** Short notes on each return, so the player can check their reasoning. */
  findings: string[];
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Debrief data. `positions` are where each return was when it was last seen,
 * used to explain why a false positive did not match the intel.
 */
export function buildDebrief(m: MissionState, fuelFraction: number, timeOnStation = 0): Debrief {
  const success = m.phase === 'complete';
  const detected = RETURNS.filter((r) => m.returns[r.id].detected);
  const headline = success ? 'MISSION COMPLETE' : m.failReason === 'fuel' ? 'MISSION INCOMPLETE · FUEL EXHAUSTED' : 'MISSION INCOMPLETE · ABORTED';
  const rows: DebriefRow[] = [
    { label: 'Objective', value: success ? 'Complete' : 'Incomplete', tone: success ? 'good' : 'bad' },
    { label: 'Supply truck identified', value: m.targetIdentified ? `Yes · Return ${TARGET.id}` : 'No', tone: m.targetIdentified ? 'good' : 'bad' },
    { label: 'Destination confirmed', value: m.destinationConfirmed ? DESTINATION.name : 'No', tone: m.destinationConfirmed ? 'good' : 'bad' },
    { label: 'False positives', value: String(m.falsePositives), tone: m.falsePositives === 0 ? 'good' : 'bad' },
    { label: 'Time', value: formatTime(m.time) },
    { label: 'Time in mission control', value: formatTime(timeOnStation) },
    { label: 'Fuel remaining', value: `${Math.round(Math.max(0, Math.min(1, fuelFraction)) * 100)}%` },
    { label: 'Recon findings', value: `${detected.length} of ${RETURNS.length} returns` },
  ];
  const findings = detected.map((r) => {
    const st = m.returns[r.id];
    const pos = st.lastKnown ?? { x: r.route[0][0], z: r.route[0][1] };
    const why = mismatchReason(r, pos.x, pos.z);
    const tag = st.verdict === 'wrong' ? ' (marked in error)' : st.verdict === 'correct' ? ' (marked)' : '';
    return `Return ${r.id}${tag}: ${r.truth}${why ? ` It was ${why}.` : ''}`;
  });
  return { headline, success, rows, findings };
}

/**
 * The road the truck takes once found: from where it is, back down the mine
 * road to the quarry junction, then along the main road to the landing.
 * `segment` is the mine-road segment it is currently on.
 */
export function destinationRoute(x: number, z: number, segment: number): Pt[] {
  const pts: Pt[] = [[x, z]];
  for (let i = Math.min(segment, MINE_ROAD_PTS.length - 1); i >= 0; i--) pts.push(MINE_ROAD_PTS[i]);
  pts.push(...DESTINATION_TAIL);
  return pts;
}
