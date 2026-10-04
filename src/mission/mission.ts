/**
 * Mission 01 recon rules: the objective chain the operator works through in
 * Mission Control. Pure and deterministic so every transition is tested;
 * `Game` feeds it sensor gains and positions and renders the events.
 *
 *   locate      → (correct MARK)                 → photograph
 *   photograph  → (photo of the truck)           → track        PRIMARY COMPLETE · objective updated
 *   track       → (camera on the stopped truck)  → landing      objective updated: a barge
 *   landing     → (photo of the barge)           → extract      recon complete
 *   any phase   → (extract: done / weather / fuel / by choice once primary is done) → extract
 *
 * Sensors answer different questions: radar (where, moving), optical (size,
 * count, road; best photos; haze hurts), thermal (size, count, engine heat;
 * sees through haze; fair photos), SIGINT (radio on or off).
 */
import { DESTINATION, DESTINATION_TAIL, MINE_ROAD_PTS, MISSION_01, RETURNS, SECTOR_7, type ReturnDef, type ReturnId, type Sector } from './mission01';
import type { Pt } from '../world/worldData';
import { DETECT_THRESHOLD } from '../sensors/radar';

export type Phase = 'locate' | 'photograph' | 'track' | 'landing' | 'extract';
export type Imager = 'optical' | 'thermal';
export type ExtractReason = 'complete' | 'manual' | 'weather' | 'fuel';

export interface ReturnState {
  id: ReturnId;
  detection: number;
  detected: boolean;
  /** Not yet part of the picture (revealed by a dynamic objective). */
  hidden: boolean;
  /** Size and count known (camera). */
  resolved: boolean;
  roadKnown: boolean;
  heatKnown: boolean;
  radioKnown: boolean;
  /** Player's identification of this return. */
  verdict: 'none' | 'correct' | 'wrong';
  /** Last position the aircraft saw it at. */
  lastKnown: { x: number; z: number } | null;
  /** Seconds the camera has held it in view. */
  look: number;
}

export interface MissionState {
  phase: Phase;
  returns: Record<ReturnId, ReturnState>;
  falsePositives: number;
  wrongIds: ReturnId[];
  targetIdentified: boolean;
  primaryComplete: boolean;
  destinationConfirmed: boolean;
  transferPhotographed: boolean;
  /** 0..1 progress toward confirming the destination. */
  confirm: number;
  /** Best photograph quality (0..1) of the truck and of the barge. */
  photos: { truck: number; barge: number };
  photosTaken: number;
  extractReason: ExtractReason | null;
  time: number;
}

export interface MissionEvent {
  type: 'detected' | 'resolved' | 'wrong' | 'photo' | 'objective-complete' | 'new-objective' | 'objective-updated' | 'recon-complete';
  title: string;
  text: string;
  id?: ReturnId;
}

export interface Objective {
  /** PRIMARY / SECONDARY / EXTRACTION */
  kicker: string;
  /** Short imperative shown in the indicator. */
  title: string;
  /** One supporting line: what to look for, or how to do it. */
  detail: string;
  done: boolean;
}

/** How long the camera must stay on the stopped truck to confirm where it went. */
export const CONFIRM_SECONDS = 2.5;
/** Mission radar works a little faster than the open case: vehicles move, the sortie is short. */
export const MISSION_RATE = 2.5;
/** Seconds of steady camera time to identify a return (before crew and haze). */
export const CAMERA_SECONDS = 1.6;
/** Slant range at which a camera can still make out a vehicle. */
export const CAMERA_RANGE = 600;
/** SIGINT hears emitters within this range. */
export const SIGINT_RANGE = 1400;

export interface StationContext {
  station?: 'pilot' | 'operator';
  inArea?: boolean;
  truckStopped?: boolean;
}

export const RETURN_BY_ID: Readonly<Record<ReturnId, ReturnDef>> = Object.fromEntries(RETURNS.map((r) => [r.id, r])) as Record<ReturnId, ReturnDef>;
export const TARGET: ReturnDef = RETURNS.find((r) => r.isTarget)!;
export const BARGE: ReturnDef = RETURN_BY_ID.E;

export function newMission(): MissionState {
  const returns = {} as Record<ReturnId, ReturnState>;
  for (const r of RETURNS) returns[r.id] = { id: r.id, detection: 0, detected: false, hidden: !!r.hidden, resolved: false, roadKnown: false, heatKnown: false, radioKnown: false, verdict: 'none', lastKnown: null, look: 0 };
  return {
    phase: 'locate',
    returns,
    falsePositives: 0,
    wrongIds: [],
    targetIdentified: false,
    primaryComplete: false,
    destinationConfirmed: false,
    transferPhotographed: false,
    confirm: 0,
    photos: { truck: 0, barge: 0 },
    photosTaken: 0,
    extractReason: null,
    time: 0,
  };
}

export function inSector(x: number, z: number, s: Sector = SECTOR_7): boolean {
  return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
}

/** Is there still recon work for the operator? */
export function operatorWork(m: MissionState): boolean {
  return m.phase !== 'extract';
}

export function canExtract(m: MissionState): boolean {
  return m.primaryComplete && m.phase !== 'extract';
}

/**
 * The recon objective. Its title never changes with the seat; the detail
 * names the next step from where the player is sitting.
 */
export function reconObjective(m: MissionState, ctx: StationContext = {}): Objective {
  const pilot = ctx.station === 'pilot';
  const openMc = ctx.inArea ? 'OPEN MISSION CONTROL' : 'FLY BACK TO SECTOR 7';
  switch (m.phase) {
    case 'locate':
      return { kicker: 'PRIMARY', title: 'FIND THE SUPPLY TRUCK', detail: pilot ? openMc : MISSION_01.intelShort, done: false };
    case 'photograph':
      return { kicker: 'PRIMARY', title: 'PHOTOGRAPH THE TRUCK', detail: pilot ? openMc : 'CAMERA ON C · TAKE PHOTO', done: false };
    case 'track':
      return { kicker: 'BONUS', title: 'FOLLOW THE TRUCK', detail: pilot ? openMc : ctx.truckStopped ? 'IT STOPPED · HOLD THE CAMERA ON IT' : 'KEEP THE CAMERA ON IT', done: false };
    case 'landing':
      return { kicker: 'BONUS', title: 'PHOTOGRAPH THE BARGE', detail: pilot ? openMc : 'CAMERA ON E · TAKE PHOTO', done: false };
    case 'extract':
      return { kicker: 'EXTRACT', title: 'FLY HOME', detail: '', done: true };
  }
}

/** What the console says about a return: each sensor adds its own facts. */
export function describeReturn(m: MissionState, id: ReturnId, x: number, z: number, moving: boolean): { head: string; traits: string[]; resolved: boolean } {
  const st = m.returns[id];
  const def = RETURN_BY_ID[id];
  const traits: string[] = [];
  if (st.resolved) traits.push(def.kind === 'vessel' ? 'BOAT' : def.count > 1 ? `${def.count} SMALL` : def.size === 'large' ? 'LARGE' : 'SMALL');
  else traits.push('SIZE ?');
  traits.push(moving ? 'MOVING' : 'PARKED');
  if (st.roadKnown) traits.push(def.kind === 'vessel' ? 'RIVER' : def.onRoad ? 'ON ROAD' : 'OFF ROAD');
  if (st.heatKnown) traits.push(def.engine === 'running' ? 'ENGINE ON' : 'ENGINE COLD');
  if (st.radioKnown) traits.push(def.radio ? 'RADIO ON' : 'RADIO DEAD');
  traits.push(inSector(x, z) ? 'SECTOR 7' : 'OUT OF SECTOR');
  return { head: `RETURN ${id}`, traits, resolved: st.resolved };
}

/** The first way a return contradicts the mission intelligence, or null for the truck. */
export function mismatchReason(def: ReturnDef, x: number, z: number): string | null {
  if (def.kind === 'vessel') return 'a vessel on the river, not a truck';
  if (def.size !== 'large' || def.count !== 1) return `${def.count > 1 ? `${def.count} small vehicles` : 'a small vehicle'}, not one large truck`;
  if (!def.moving) return 'stationary, but the truck should be moving';
  if (!def.onRoad) return 'off road, but the truck was driving a road';
  if (!inSector(x, z)) return 'outside Sector 7';
  return null;
}

/** RADAR: add confidence to a return within the footprint. */
export function scanReturn(m: MissionState, id: ReturnId, gain: number, x: number, z: number): MissionEvent[] {
  const st = m.returns[id];
  if (gain <= 0 || st.hidden) return [];
  st.detection += gain;
  st.lastKnown = { x, z };
  if (!st.detected && st.detection >= DETECT_THRESHOLD) {
    st.detected = true;
    return [{ type: 'detected', title: `RETURN ${id}`, text: `RADAR RETURN ${id} · ${RETURN_BY_ID[id].kind === 'vessel' ? 'VESSEL' : 'VEHICLE'}`, id }];
  }
  return [];
}

/** SIGINT: hear whether a detected return in range is transmitting. */
export function listenReturn(m: MissionState, id: ReturnId, inRange: boolean): MissionEvent[] {
  const st = m.returns[id];
  if (!inRange || !st.detected || st.radioKnown) return [];
  st.radioKnown = true;
  return [{ type: 'resolved', title: `RETURN ${id}`, text: `SIGINT · RETURN ${id} ${RETURN_BY_ID[id].radio ? 'IS TRANSMITTING' : 'IS RADIO SILENT'}`, id }];
}

/**
 * CAMERA time on a selected return. `seconds` is the time this sensor needs
 * (crew and haze included). Optical learns the road; thermal the engine heat.
 */
export function inspectReturn(m: MissionState, id: ReturnId, dt: number, inView: boolean, sensor: Imager = 'optical', seconds = CAMERA_SECONDS): MissionEvent[] {
  const st = m.returns[id];
  if (!inView || !st.detected) return [];
  const learnsNew = !st.resolved || (sensor === 'optical' ? !st.roadKnown : !st.heatKnown);
  if (!learnsNew) return [];
  st.look += dt;
  if (st.look < seconds) return [];
  st.look = 0;
  st.resolved = true;
  if (sensor === 'optical') st.roadKnown = true;
  else st.heatKnown = true;
  const def = RETURN_BY_ID[id];
  const what = def.count > 1 ? `${def.count} ${def.size.toUpperCase()} VEHICLES` : `A ${def.size.toUpperCase()} ${def.kind === 'vessel' ? 'VESSEL' : 'VEHICLE'}`;
  const text = sensor === 'optical' ? `OPTICAL · RETURN ${id} IS ${what}` : `THERMAL · RETURN ${id} IS ${what} · ENGINE ${def.engine === 'running' ? 'RUNNING' : 'COLD'}`;
  return [{ type: 'resolved', title: `RETURN ${id}`, text, id }];
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
    return { result: 'wrong', events: [{ type: 'wrong', title: 'NEGATIVE', text: `RETURN ${id} IS NOT THE TRUCK`, id }] };
  }
  st.verdict = 'correct';
  m.targetIdentified = true;
  m.phase = 'photograph';
  return {
    result: 'correct',
    events: [
      { type: 'objective-complete', title: 'TARGET LOCKED', text: 'SUPPLY TRUCK', id },
      { type: 'new-objective', title: 'NEXT', text: 'PHOTOGRAPH IT' },
    ],
  };
}

/** Evidence quality of one photograph (0..1). */
export function photoQuality(p: { sensor: Imager; slant: number; visibility: number; bonus: number }): number {
  const base = p.sensor === 'optical' ? 1 : 0.72;
  const range = Math.max(0.4, Math.min(1, 1.15 - p.slant / 1000));
  const haze = p.sensor === 'optical' ? 0.45 + 0.55 * Math.max(0, Math.min(1, p.visibility)) : 1;
  return Math.max(0, Math.min(1, base * range * haze + p.bonus));
}

export function evidenceGrade(q: number): 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'NONE' {
  if (q <= 0) return 'NONE';
  if (q >= 0.85) return 'EXCELLENT';
  if (q >= 0.65) return 'GOOD';
  if (q >= 0.4) return 'FAIR';
  return 'POOR';
}

/** Take a photograph of an identified return. */
export function photograph(m: MissionState, id: ReturnId, quality: number): { result: 'primary' | 'transfer' | 'improved' | 'untasked' | 'unidentified'; events: MissionEvent[] } {
  const st = m.returns[id];
  if (!st.detected || !st.resolved) return { result: 'unidentified', events: [{ type: 'photo', title: 'NO PHOTO', text: 'IDENTIFY IT FIRST', id }] };
  m.photosTaken += 1;
  const grade = evidenceGrade(quality);
  if (id === TARGET.id && m.targetIdentified) {
    const better = quality > m.photos.truck;
    m.photos.truck = Math.max(m.photos.truck, quality);
    if (m.phase === 'photograph') {
      m.primaryComplete = true;
      m.phase = 'track';
      return {
        result: 'primary',
        events: [
          { type: 'objective-complete', title: 'PRIMARY DONE', text: grade, id },
          { type: 'objective-updated', title: 'IT\'S MOVING', text: 'FOLLOW THE TRUCK' },
        ],
      };
    }
    return { result: 'improved', events: [{ type: 'photo', title: 'PHOTO', text: better ? `BETTER SHOT · ${grade}` : `${grade} · KEPT THE BEST`, id }] };
  }
  if (id === BARGE.id && !st.hidden) {
    m.photos.barge = Math.max(m.photos.barge, quality);
    if (m.phase === 'landing') {
      m.transferPhotographed = true;
      m.phase = 'extract';
      m.extractReason = 'complete';
      return {
        result: 'transfer',
        events: [
          { type: 'objective-complete', title: 'TRANSFER CAUGHT', text: grade, id },
          { type: 'recon-complete', title: 'RECON COMPLETE', text: 'HEAD HOME' },
        ],
      };
    }
  }
  return { result: 'untasked', events: [{ type: 'photo', title: 'PHOTO', text: 'NOT THE TARGET', id }] };
}

/** Track the truck to its stop: a camera has to be on it once it has stopped. */
export function updateDestination(m: MissionState, dt: number, truckArrived: boolean, cameraOnTruck: boolean): MissionEvent[] {
  if (m.phase !== 'track') return [];
  if (truckArrived && cameraOnTruck) m.confirm = Math.min(1, m.confirm + dt / CONFIRM_SECONDS);
  else m.confirm = Math.max(0, m.confirm - dt / (CONFIRM_SECONDS * 2));
  if (m.confirm < 1) return [];
  m.destinationConfirmed = true;
  m.phase = 'landing';
  // the recon turns up something nobody briefed: the cargo is going onto a barge
  const e = m.returns[BARGE.id];
  e.hidden = false;
  e.detected = true;
  e.detection = Math.max(e.detection, DETECT_THRESHOLD);
  e.lastKnown = { x: BARGE.route[0][0], z: BARGE.route[0][1] };
  return [
    { type: 'objective-complete', title: 'DESTINATION FOUND', text: DESTINATION.short },
    { type: 'objective-updated', title: 'A BARGE!', text: 'PHOTOGRAPH IT · RETURN E' },
  ];
}

/** Leave the area: by choice once the primary is done, or forced (weather, fuel). */
export function extract(m: MissionState, reason: ExtractReason): MissionEvent[] {
  if (m.phase === 'extract') return [];
  if (reason === 'manual' && !m.primaryComplete) return [];
  m.phase = 'extract';
  m.extractReason = reason;
  const text = reason === 'manual' || reason === 'complete' ? 'HEAD HOME' : 'EXTRACT NOW';
  return [{ type: 'recon-complete', title: reason === 'weather' ? 'WEATHER FRONT' : reason === 'fuel' ? 'BINGO FUEL' : 'EXTRACTING', text }];
}

export interface Secondary {
  label: string;
  done: boolean;
  /** Issued in the field (unknown at the briefing). */
  issued: boolean;
}

export function secondaries(m: MissionState, detected: boolean): Secondary[] {
  return [
    { label: 'Undetected', done: !detected, issued: true },
    { label: 'Followed the truck', done: m.destinationConfirmed, issued: m.primaryComplete },
    { label: 'Caught the transfer', done: m.transferPhotographed, issued: m.destinationConfirmed },
  ];
}

/** Intelligence for the report: what the recon actually established. */
export function intelligence(m: MissionState): string[] {
  const out: string[] = [];
  if (m.destinationConfirmed) out.push(`The supply truck drove to ${DESTINATION.name}.`);
  if (m.transferPhotographed) out.push('Its cargo was transferred to a river barge: it is leaving the basin by water.');
  else if (m.destinationConfirmed) out.push('A barge was loading at the landing. Its cargo is unconfirmed.');
  for (const r of RETURNS) {
    const st = m.returns[r.id];
    if (!st.detected || r.id === BARGE.id) continue;
    const pos = st.lastKnown ?? { x: r.route[0][0], z: r.route[0][1] };
    const why = mismatchReason(r, pos.x, pos.z);
    const tag = st.verdict === 'wrong' ? ' (marked in error)' : st.verdict === 'correct' ? ' (marked)' : '';
    out.push(`Return ${r.id}${tag}: ${r.truth}${why ? ` It was ${why}.` : ''}`);
  }
  return out;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The road the truck takes once photographed: from where it is, back down
 * the mine road to the quarry junction, then along the main road to the
 * landing. `segment` is the mine-road segment it is currently on.
 */
export function destinationRoute(x: number, z: number, segment: number): Pt[] {
  const pts: Pt[] = [[x, z]];
  for (let i = Math.min(segment, MINE_ROAD_PTS.length - 1); i >= 0; i--) pts.push(MINE_ROAD_PTS[i]);
  pts.push(...DESTINATION_TAIL);
  return pts;
}
