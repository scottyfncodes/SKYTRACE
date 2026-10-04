import { describe, expect, it } from 'vitest';
import { CONTACTS, HYPOTHESES } from '../src/intel/scenario';
import { capabilities, deriveLeads, deserialize, evidenceFor, fileAssessment, load, markContact, markDetected, markObserved, markResolved, newState, save, serialize, stageOf, type Storage } from '../src/intel/state';
import { passNight, registerSensor, preliminaryDownload, targetsInRange } from '../src/sensors/equipment';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('scenario integrity', () => {
  it('links point at existing contacts and hypotheses cite existing contacts', () => {
    const ids = new Set(CONTACTS.map((c) => c.id));
    for (const c of CONTACTS) for (const l of c.links) expect(ids.has(l.to)).toBe(true);
    for (const h of HYPOTHESES) for (const e of h.evidence) expect(ids.has(e.id)).toBe(true);
    expect(HYPOTHESES.filter((h) => h.correct)).toHaveLength(1);
  });
  it('contacts needing sensor data define sensor text', () => {
    for (const h of HYPOTHESES) for (const e of h.evidence) if (e.stage === 'sensor') expect(CONTACTS.find((c) => c.id === e.id)!.texts.sensor).toBeTruthy();
  });
});

describe('investigation state', () => {
  it('assigns codenames in order of discovery and records notes', () => {
    const s = newState();
    const ev = markDetected(s, 'quarry', 700, 390, 80);
    expect(s.contacts.quarry.codename).toBe('K-1');
    expect(ev[0].type).toBe('detected');
    markObserved(s, 'tower');
    expect(s.contacts.tower.codename).toBe('K-2');
    expect(s.notes.length).toBe(2);
    expect(stageOf(s.contacts.quarry)).toBe('detected');
    expect(stageOf(s.contacts.tower)).toBe('observed');
  });
  it('marking requires a known contact', () => {
    const s = newState();
    expect(markContact(s, 'mine')).toHaveLength(0);
    markDetected(s, 'mine', 680, -420, 50);
    expect(markContact(s, 'mine')).toHaveLength(1);
    expect(s.contacts.mine.marked).toBe(true);
    expect(markContact(s, 'mine')).toHaveLength(0);
  });
  it('discovers connections when both ends are known and the stage is met', () => {
    const s = newState();
    markResolved(s, 'quarry');
    expect(s.links).toHaveLength(0);
    markDetected(s, 'haulroad', 470, 80, 90);
    expect(s.links).toContain('quarry>haulroad');
  });
  it('unlocks capabilities from progress', () => {
    const s = newState();
    expect(capabilities(s).radarMult).toBe(1);
    markDetected(s, 'quarry', 0, 0, 10);
    markDetected(s, 'mine', 0, 0, 10);
    const ev = markDetected(s, 'tower', 0, 0, 10);
    expect(ev.some((e) => e.type === 'unlock')).toBe(true);
    expect(capabilities(s).radarMult).toBeGreaterThan(1);
  });
  it('round-trips through storage', () => {
    const s = newState();
    markDetected(s, 'quarry', 700, 390, 80);
    markContact(s, 'quarry');
    s.sortie = 2;
    const st = memStorage();
    save(s, st);
    const back = load(st)!;
    expect(back.sortie).toBe(2);
    expect(back.contacts.quarry.marked).toBe(true);
    expect(back.contacts.quarry.codename).toBe('K-1');
    expect(deserialize('not json')).toBeNull();
    expect(deserialize(JSON.stringify({ version: 9 }))).toBeNull();
    expect(serialize(back)).toContain('"sortie":2');
  });
  it('derives leads that change with the state', () => {
    const s = newState();
    const first = deriveLeads(s);
    expect(first[0].text).toMatch(/quarry/i);
    markDetected(s, 'clearing', 240, -170, 90);
    const leads = deriveLeads(s);
    expect(leads.some((l) => l.contact === 'clearing' && /low/i.test(l.text))).toBe(true);
  });
});

describe('sensor packages', () => {
  it('registers targets within range and reports after a night', () => {
    const s = newState();
    expect(targetsInRange(240, -170)).toContain('clearing');
    expect(targetsInRange(0, 0)).toHaveLength(0);
    const sensor = registerSensor(s, 250, -160);
    expect(sensor.id).toBe('S-1');
    expect(sensor.targets).toContain('clearing');
    const ev = passNight(s);
    expect(s.contacts.clearing.sensor).toBe(true);
    expect(ev.some((e) => e.type === 'sensor')).toBe(true);
    expect(sensor.nightsLeft).toBe(2);
    expect(capabilities(s).signalAnalyser).toBe(true);
  });
  it('a sensor with nothing in range still reports', () => {
    const s = newState();
    const sensor = registerSensor(s, 0, 0);
    passNight(s);
    expect(sensor.logs[0]).toMatch(/no activity/i);
    const ev = preliminaryDownload(s, sensor);
    expect(ev).toHaveLength(1);
    expect(preliminaryDownload(s, sensor)).toHaveLength(0);
  });
});

describe('assessment', () => {
  it('rejects wrong hypotheses and holds unsupported correct ones', () => {
    const s = newState();
    expect(fileAssessment(s, 'nothing').result).toBe('rejected');
    expect(fileAssessment(s, 'extraction').result).toBe('weak');
    expect(s.assessment.closed).toBe(false);
  });
  it('accepts the correct hypothesis once the marked evidence chain is complete', () => {
    const s = newState();
    const h = HYPOTHESES.find((x) => x.correct)!;
    for (const e of h.evidence) {
      markResolved(s, e.id);
      markContact(s, e.id);
    }
    registerSensor(s, 240, -170);
    passNight(s);
    const ev = evidenceFor(s, 'extraction');
    expect(ev.have).toBe(ev.total);
    expect(fileAssessment(s, 'extraction').result).toBe('accepted');
    expect(s.assessment.closed).toBe(true);
  });
});
