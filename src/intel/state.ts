import { CONTACTS, CONTACT_BY_ID, HYPOTHESES, UNLOCKS, type ContactDef } from './scenario';
import { gridRef } from '../world/worldData';

export const SAVE_KEY = 'skytrace.save.v1';
export const COVERAGE_N = 48;

export type Stage = 'unknown' | 'detected' | 'observed' | 'resolved' | 'sensor';

export interface ContactState {
  id: string;
  codename: string; // "K-3"
  detection: number; // accumulated radar confidence
  detected: boolean;
  observed: boolean;
  resolved: boolean;
  sensor: boolean; // sensor data received
  marked: boolean;
  /** Last known position with uncertainty radius (metres). */
  lastKnown: { x: number; z: number; r: number; sortie: number } | null;
  firstSortie: number;
}

export interface SensorState {
  id: string; // "S-1"
  x: number;
  z: number;
  deployedSortie: number;
  nightsLeft: number;
  targets: string[]; // contact ids in range
  prelim: boolean; // preliminary in-flight download done
  reported: boolean; // nightly report delivered
  logs: string[];
}

export interface Note {
  sortie: number;
  kind: 'observation' | 'radar' | 'mark' | 'sensor' | 'link' | 'system' | 'unlock';
  text: string;
  contact?: string;
}

export interface SaveState {
  version: 1;
  sortie: number; // completed sorties
  contacts: Record<string, ContactState>;
  nextCodename: number;
  nextSensor: number;
  sensors: SensorState[];
  coverage: number[]; // COVERAGE_N^2 values 0..1
  paths: number[][]; // last sorties' flight paths [x,z,x,z...]
  notes: Note[];
  unlocks: string[];
  links: string[]; // "from>to"
  assessment: { filed: string | null; result: 'accepted' | 'rejected' | 'weak' | null; closed: boolean };
  waypoint: string | null;
  seenIntro: boolean;
}

export function newState(): SaveState {
  const contacts: Record<string, ContactState> = {};
  for (const c of CONTACTS) {
    contacts[c.id] = {
      id: c.id,
      codename: '',
      detection: 0,
      detected: false,
      observed: false,
      resolved: false,
      sensor: false,
      marked: false,
      lastKnown: null,
      firstSortie: 0,
    };
  }
  return {
    version: 1,
    sortie: 0,
    contacts,
    nextCodename: 1,
    nextSensor: 1,
    sensors: [],
    coverage: new Array(COVERAGE_N * COVERAGE_N).fill(0),
    paths: [],
    notes: [],
    unlocks: [],
    links: [],
    assessment: { filed: null, result: null, closed: false },
    waypoint: null,
    seenIntro: false,
  };
}

export function stageOf(c: ContactState): Stage {
  if (c.sensor) return 'sensor';
  if (c.resolved) return 'resolved';
  if (c.observed) return 'observed';
  if (c.detected) return 'detected';
  return 'unknown';
}
const STAGE_RANK: Record<Stage, number> = { unknown: 0, detected: 1, observed: 2, resolved: 3, sensor: 4 };
export function hasStage(c: ContactState, s: Stage): boolean {
  // observed and detected are parallel tracks: treat either as "known"
  if (s === 'detected') return c.detected || c.observed || c.resolved || c.sensor;
  if (s === 'observed') return c.observed || c.resolved || c.sensor;
  return STAGE_RANK[stageOf(c)] >= STAGE_RANK[s];
}
export function isKnown(c: ContactState): boolean {
  return c.detected || c.observed;
}

// ---------- persistence ----------
export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function serialize(s: SaveState): string {
  return JSON.stringify(s);
}

export function deserialize(json: string): SaveState | null {
  try {
    const raw = JSON.parse(json) as Partial<SaveState>;
    if (!raw || raw.version !== 1 || typeof raw.contacts !== 'object') return null;
    const base = newState();
    const s: SaveState = { ...base, ...raw, contacts: { ...base.contacts } };
    for (const id of Object.keys(base.contacts)) {
      const rc = (raw.contacts as Record<string, Partial<ContactState>>)[id];
      if (rc) s.contacts[id] = { ...base.contacts[id], ...rc };
    }
    if (!Array.isArray(s.coverage) || s.coverage.length !== COVERAGE_N * COVERAGE_N) s.coverage = base.coverage;
    s.assessment = { ...base.assessment, ...(raw.assessment ?? {}) };
    return s;
  } catch {
    return null;
  }
}

export function save(s: SaveState, storage: Storage): void {
  try {
    storage.setItem(SAVE_KEY, serialize(s));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}
export function load(storage: Storage): SaveState | null {
  try {
    const json = storage.getItem(SAVE_KEY);
    return json ? deserialize(json) : null;
  } catch {
    return null;
  }
}
export function clear(storage: Storage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- mutations (return events for UI/audio) ----------
export interface IntelEvent {
  type: 'detected' | 'observed' | 'resolved' | 'marked' | 'link' | 'unlock' | 'sensor' | 'note';
  text: string;
  contact?: string;
}

function ensureCodename(s: SaveState, c: ContactState): void {
  if (!c.codename) {
    c.codename = `K-${s.nextCodename++}`;
    c.firstSortie = s.sortie + 1;
  }
}

export function noteFor(s: SaveState, kind: Note['kind'], text: string, contact?: string): void {
  s.notes.push({ sortie: s.sortie + 1, kind, text, contact });
}

export function markDetected(s: SaveState, id: string, x: number, z: number, r: number): IntelEvent[] {
  const c = s.contacts[id];
  const def = CONTACT_BY_ID[id];
  const ev: IntelEvent[] = [];
  const first = !c.detected;
  c.detected = true;
  ensureCodename(s, c);
  // mobile contacts update their last-known on every detection; others only improve
  if (!c.lastKnown || def.mobile || r < c.lastKnown.r) c.lastKnown = { x, z, r, sortie: s.sortie + 1 };
  if (first) {
    const text = `${c.codename} radar return at ${gridRef(x, z)}: ${def.texts.detected}`;
    noteFor(s, 'radar', text, id);
    ev.push({ type: 'detected', text: `RADAR RETURN  ${c.codename}  ${gridRef(x, z)}`, contact: id });
    ev.push(...checkUnlocks(s));
    ev.push(...checkLinks(s));
  }
  return ev;
}

export function markObserved(s: SaveState, id: string): IntelEvent[] {
  const c = s.contacts[id];
  const def = CONTACT_BY_ID[id];
  if (c.observed) return [];
  c.observed = true;
  ensureCodename(s, c);
  if (!c.lastKnown || c.lastKnown.r > 30) c.lastKnown = { x: def.x, z: def.z, r: 25, sortie: s.sortie + 1 };
  noteFor(s, 'observation', `${c.codename} visual, ${def.name} (${gridRef(def.x, def.z)}): ${def.texts.observed}`, id);
  const ev: IntelEvent[] = [{ type: 'observed', text: `VISUAL  ${c.codename}  ${def.name.toUpperCase()}`, contact: id }];
  ev.push(...checkUnlocks(s));
  ev.push(...checkLinks(s));
  return ev;
}

export function markResolved(s: SaveState, id: string): IntelEvent[] {
  const c = s.contacts[id];
  const def = CONTACT_BY_ID[id];
  if (c.resolved) return [];
  c.resolved = true;
  c.detected = true;
  ensureCodename(s, c);
  c.lastKnown = { x: def.x, z: def.z, r: def.mobile ? 60 : 15, sortie: s.sortie + 1 };
  noteFor(s, 'radar', `${c.codename} resolved: ${def.texts.resolved}`, id);
  const ev: IntelEvent[] = [{ type: 'resolved', text: `CONTACT RESOLVED  ${c.codename}`, contact: id }];
  ev.push(...checkUnlocks(s));
  ev.push(...checkLinks(s));
  return ev;
}

export function markContact(s: SaveState, id: string): IntelEvent[] {
  const c = s.contacts[id];
  if (!isKnown(c) || c.marked) return [];
  c.marked = true;
  const def = CONTACT_BY_ID[id];
  const pos = c.lastKnown ?? { x: def.x, z: def.z };
  noteFor(s, 'mark', `${c.codename} marked on the intelligence map at ${gridRef(pos.x, pos.z)}.`, id);
  return [{ type: 'marked', text: `MARKED  ${c.codename}  ${gridRef(pos.x, pos.z)}`, contact: id }];
}

export function markSensorData(s: SaveState, id: string): IntelEvent[] {
  const c = s.contacts[id];
  const def = CONTACT_BY_ID[id];
  if (c.sensor || !def.texts.sensor) return [];
  c.sensor = true;
  c.resolved = true;
  c.detected = true;
  ensureCodename(s, c);
  c.lastKnown = { x: def.x, z: def.z, r: def.mobile ? 60 : 15, sortie: s.sortie + 1 };
  noteFor(s, 'sensor', `${c.codename} ${def.texts.sensor}`, id);
  const ev: IntelEvent[] = [{ type: 'sensor', text: `SENSOR DATA  ${c.codename}`, contact: id }];
  ev.push(...checkUnlocks(s));
  ev.push(...checkLinks(s));
  return ev;
}

function stageMet(c: ContactState, needs: 'observed' | 'detected' | 'resolved' | 'sensor'): boolean {
  return hasStage(c, needs);
}

export function checkLinks(s: SaveState): IntelEvent[] {
  const ev: IntelEvent[] = [];
  for (const def of CONTACTS) {
    const from = s.contacts[def.id];
    for (const l of def.links) {
      const key = `${def.id}>${l.to}`;
      if (s.links.includes(key)) continue;
      const to = s.contacts[l.to];
      if (stageMet(from, l.needs) && isKnown(to)) {
        s.links.push(key);
        const toDef = CONTACT_BY_ID[l.to];
        const text = `${from.codename} ${def.name}: ${l.label} ${to.codename} ${toDef.name}.`;
        noteFor(s, 'link', text, def.id);
        ev.push({ type: 'link', text: `CONNECTION  ${from.codename} → ${to.codename}`, contact: def.id });
      }
    }
  }
  return ev;
}

export function checkUnlocks(s: SaveState): IntelEvent[] {
  const ev: IntelEvent[] = [];
  const known = Object.values(s.contacts).filter(isKnown).length;
  const resolved = Object.values(s.contacts).filter((c) => c.resolved).length;
  const sensed = Object.values(s.contacts).some((c) => c.sensor);
  const grant = (id: string) => {
    if (s.unlocks.includes(id)) return;
    s.unlocks.push(id);
    const def = UNLOCKS.find((u) => u.id === id)!;
    noteFor(s, 'unlock', `${def.name}: ${def.text}`);
    ev.push({ type: 'unlock', text: `UNLOCKED  ${def.name.toUpperCase()}` });
  };
  if (known >= 3) grant('resolution');
  if (sensed) grant('signal');
  if (resolved >= 5) grant('endurance');
  return ev;
}

export function hasUnlock(s: SaveState, id: string): boolean {
  return s.unlocks.includes(id);
}

export function capabilities(s: SaveState): { radarMult: number; rateMult: number; sensorsPerSortie: number; fuelMult: number; signalAnalyser: boolean } {
  return {
    radarMult: hasUnlock(s, 'resolution') ? 1.25 : 1,
    rateMult: hasUnlock(s, 'resolution') ? 1.35 : 1,
    sensorsPerSortie: hasUnlock(s, 'endurance') ? 2 : 1,
    fuelMult: hasUnlock(s, 'endurance') ? 1.4 : 1,
    signalAnalyser: hasUnlock(s, 'signal'),
  };
}

// ---------- coverage ----------
export function coverageIndex(x: number, z: number): number {
  const half = 1200;
  const i = Math.max(0, Math.min(COVERAGE_N - 1, Math.floor(((x + half) / (half * 2)) * COVERAGE_N)));
  const j = Math.max(0, Math.min(COVERAGE_N - 1, Math.floor(((z + half) / (half * 2)) * COVERAGE_N)));
  return j * COVERAGE_N + i;
}
export function addCoverage(s: SaveState, x: number, z: number, radius: number, amount: number): void {
  const cell = 2400 / COVERAGE_N;
  const r = Math.ceil(radius / cell);
  const ci = Math.floor((x + 1200) / cell);
  const cj = Math.floor((z + 1200) / cell);
  for (let j = cj - r; j <= cj + r; j++) {
    if (j < 0 || j >= COVERAGE_N) continue;
    for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= COVERAGE_N) continue;
      const cx = -1200 + (i + 0.5) * cell;
      const cz = -1200 + (j + 0.5) * cell;
      if (Math.hypot(cx - x, cz - z) <= radius) {
        const k = j * COVERAGE_N + i;
        s.coverage[k] = Math.min(1, s.coverage[k] + amount);
      }
    }
  }
}

// ---------- leads ----------
export interface Lead {
  text: string;
  contact: string | null;
  priority: number;
}

export function deriveLeads(s: SaveState): Lead[] {
  const leads: Lead[] = [];
  const knownCount = Object.values(s.contacts).filter(isKnown).length;
  if (knownCount < 2) {
    leads.push({ text: 'Begin with the two sites named in the assignment: the quarry (J-8) and the mine (J-4).', contact: 'quarry', priority: 10 });
  }
  for (const def of CONTACTS) {
    const c = s.contacts[def.id];
    if (!isKnown(c)) continue;
    const tag = `${c.codename}: `;
    if (!c.resolved) {
      if (c.detected && def.leads.detected) leads.push({ text: tag + def.leads.detected, contact: def.id, priority: 8 });
      else if (c.observed && def.leads.observed) leads.push({ text: tag + def.leads.observed, contact: def.id, priority: 7 });
      else if (c.detected) leads.push({ text: `${tag}unresolved return at ${gridRef(c.lastKnown?.x ?? def.x, c.lastKnown?.z ?? def.z)}. Make a lower pass with the radar on.`, contact: def.id, priority: 6 });
      else if (c.observed && def.kind !== 'landmark' && def.kind !== 'settlement') leads.push({ text: `${tag}seen but not scanned. Put the radar on it.`, contact: def.id, priority: 5 });
    } else if (def.texts.sensor && !c.sensor) {
      const hasSensorNearby = s.sensors.some((sn) => sn.targets.includes(def.id) && sn.nightsLeft > 0);
      if (hasSensorNearby) leads.push({ text: `${tag}a sensor is listening here. Fly a sortie and return for its report.`, contact: def.id, priority: 4 });
      else if (def.leads.resolved) leads.push({ text: tag + def.leads.resolved, contact: def.id, priority: 7 });
    } else if (c.resolved && def.leads.resolved && !c.sensor && !def.texts.sensor) {
      leads.push({ text: tag + def.leads.resolved, contact: def.id, priority: 6 });
    }
    if (isKnown(c) && !c.marked) leads.push({ text: `${tag}not yet marked. Mark it on the next pass to include it in the assessment.`, contact: def.id, priority: 3 });
  }
  for (const sn of s.sensors) {
    if (sn.nightsLeft > 0 && sn.targets.length === 0) leads.push({ text: `${sn.id} hears nothing in range. It may be worth recovering effort elsewhere.`, contact: null, priority: 2 });
  }
  if (!s.assessment.closed) {
    const h = HYPOTHESES.find((x) => x.correct)!;
    const have = h.evidence.filter((e) => hasStage(s.contacts[e.id], e.stage)).length;
    if (have >= Math.ceil(h.evidence.length * 0.75)) leads.push({ text: 'The evidence may now support an assessment. Review the chain and file it.', contact: null, priority: 9 });
  }
  leads.sort((a, b) => b.priority - a.priority);
  return leads;
}

// ---------- assessment ----------
export function evidenceFor(s: SaveState, hId: string): { have: number; total: number; items: { text: string; met: boolean; marked: boolean }[] } {
  const h = HYPOTHESES.find((x) => x.id === hId)!;
  const items = h.evidence.map((e) => ({ text: e.text, met: hasStage(s.contacts[e.id], e.stage), marked: s.contacts[e.id].marked }));
  return { have: items.filter((i) => i.met && i.marked).length, total: items.length, items };
}

export function fileAssessment(s: SaveState, hId: string): { result: 'accepted' | 'rejected' | 'weak'; text: string } {
  const h = HYPOTHESES.find((x) => x.id === hId)!;
  const ev = evidenceFor(s, hId);
  s.assessment.filed = hId;
  if (!h.correct) {
    s.assessment.result = 'rejected';
    noteFor(s, 'system', `Assessment filed ("${h.title}") and returned: ${h.feedback}`);
    return { result: 'rejected', text: h.feedback };
  }
  if (ev.have < Math.ceil(ev.total * 0.75)) {
    s.assessment.result = 'weak';
    const text = `Plausible but unsupported: ${ev.have} of ${ev.total} marked evidence items. Resolve and mark more of the chain before filing again.`;
    noteFor(s, 'system', `Assessment filed ("${h.title}") and held: insufficient marked evidence.`);
    return { result: 'weak', text };
  }
  s.assessment.result = 'accepted';
  s.assessment.closed = true;
  noteFor(s, 'system', `Assessment accepted: ${h.feedback}`);
  return { result: 'accepted', text: h.feedback };
}

export function defOf(id: string): ContactDef {
  return CONTACT_BY_ID[id];
}
