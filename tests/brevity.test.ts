/**
 * Word budgets. The game is read at a glance, mostly on a phone, mid-flight:
 * if a line here grows past its budget it belongs behind a "more" toggle.
 */
import { describe, expect, it } from 'vitest';
import { MISSION_01 } from '../src/mission/mission01';
import {
  CAMERA_SECONDS,
  extract,
  identify,
  inspectReturn,
  newMission,
  photograph,
  reconObjective,
  scanReturn,
  updateDestination,
  type MissionEvent,
  type Phase,
} from '../src/mission/mission';
import { buildHandover } from '../src/mission/crew';
import { CREW, EQUIPMENT, AIRCRAFT } from '../src/operation/catalog';
import { capabilities, defaultLoadout, withAircraft } from '../src/operation/loadout';
import { beginReturn, flightObjective, landAtBase, launch, newOperation, tickOperation, endOperation } from '../src/operation/operation';
import { rings, type LegDef } from '../src/operation/gates';
import { threadRings } from './helpers';
import { stageResults } from '../src/operation/score';
import { aircraftBars } from '../src/ui/preflight';

const within = (s: string, n: number) => expect(s.length, `"${s}" is ${s.length} chars (budget ${n})`).toBeLessThanOrEqual(n);

describe('word budgets', () => {
  it('objectives: a short title and one short line, in every phase and seat', () => {
    const m = newMission();
    for (const phase of ['locate', 'photograph', 'track', 'landing', 'extract'] as Phase[]) {
      m.phase = phase;
      for (const ctx of [{ station: 'operator' as const }, { station: 'operator' as const, truckStopped: true }, { station: 'pilot' as const, inArea: true }, { station: 'pilot' as const, inArea: false }]) {
        const o = reconObjective(m, ctx);
        within(o.title, 22);
        within(o.detail, 40);
        within(o.kicker, 8);
      }
    }
    for (const leg of [MISSION_01.outbound, MISSION_01.return] as LegDef[]) {
      within(leg.title, 16);
      for (const g of leg.gates) {
        if (g.kind === 'ring') {
          // the ring is the instruction: at most a word or two beside it
          if (g.cue) within(g.cue, 18);
          continue;
        }
        within(g.objective, 20);
        within(g.detail, 36);
        within(g.label, 10);
      }
    }
    for (const id of AIRCRAFT.map((a) => a.id)) {
      const cap = capabilities(withAircraft(defaultLoadout(), id));
      const op = newOperation(MISSION_01, defaultLoadout());
      launch(op);
      const check = () => {
        const fo = flightObjective(op, MISSION_01, cap);
        if (!fo) return;
        within(fo.title, 16);
        within(fo.detail, 24);
        within(fo.kicker, 14);
      };
      for (const r of rings(op.routes.outbound)) {
        check();
        tickOperation(op, MISSION_01, { x: r.x - r.nx * 10, y: r.y, z: r.z - r.nz * 10, agl: r.agl }, 0.1, cap);
        tickOperation(op, MISSION_01, { x: r.x + r.nx * 10, y: r.y, z: r.z + r.nz * 10, agl: r.agl }, 0.1, cap);
      }
      op.outbound.detected = true;
      beginReturn(op);
      for (const r of rings(op.routes.return)) {
        check();
        tickOperation(op, MISSION_01, { x: r.x - r.nx * 10, y: r.y, z: r.z - r.nz * 10, agl: r.agl }, 0.1, cap);
        tickOperation(op, MISSION_01, { x: r.x + r.nx * 10, y: r.y, z: r.z + r.nz * 10, agl: r.agl }, 0.1, cap);
      }
      check();
    }
  });

  it('every stamp and banner the recon can raise is a few words', () => {
    const events: MissionEvent[] = [];
    const m = newMission();
    for (const id of ['A', 'C'] as const) {
      events.push(...scanReturn(m, id, 2, 700, 100));
      events.push(...inspectReturn(m, id, CAMERA_SECONDS + 0.1, true));
    }
    events.push(...identify(m, 'A').events);
    events.push(...identify(m, 'C').events);
    events.push(...photograph(m, 'A', 0.8).events);
    events.push(...photograph(m, 'C', 0.8).events);
    events.push(...photograph(m, 'C', 0.9).events);
    events.push(...updateDestination(m, 5, true, true));
    events.push(...inspectReturn(m, 'E', 5, true, 'thermal'));
    events.push(...photograph(m, 'E', 0.6).events);
    events.push(...extract(newMission(), 'weather'));
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) {
      if (e.type === 'detected' || e.type === 'resolved') continue; // pilot feed lines, not banners
      within(e.title, 18);
      within(e.text, 28);
    }
  });

  it('the briefing at a glance: clues, risks, one-line goal', () => {
    within(MISSION_01.briefing.primary, 60);
    within(MISSION_01.briefing.headline, 32);
    expect(MISSION_01.clues.length).toBeLessThanOrEqual(5);
    for (const c of MISSION_01.clues) within(c, 12);
    expect(MISSION_01.risks).toHaveLength(3);
    for (const r of MISSION_01.risks) within(r.text, 44);
  });

  it('crew and equipment speak in tags', () => {
    for (const c of CREW) within(c.tag, 20);
    for (const e of EQUIPMENT) within(e.tag, 22);
  });

  it('the hand-back report is a few short lines', () => {
    const h = buildHandover({ reason: 'fuel', x: 700, z: 130, agl: 40, fuelSeconds: 75, sessionTime: 130, baseX: -820, baseZ: 760, terrainWarning: false, notices: MISSION_01.return.notices });
    expect(h.status).toHaveLength(1);
    expect(h.warnings.length).toBeLessThanOrEqual(4);
    for (const l of [...h.warnings, ...h.status]) within(l, 34);
  });
});

describe('stage scorecard (debrief)', () => {
  const def = MISSION_01;
  const cap = capabilities(defaultLoadout());
  const fly = (opts: { detected?: boolean; photo?: number; storm?: number; landed?: boolean }) => {
    const m = newMission();
    scanReturn(m, 'C', 2, 700, 100);
    inspectReturn(m, 'C', 2, true);
    identify(m, 'C');
    if (opts.photo) photograph(m, 'C', opts.photo);
    const op = newOperation(def, defaultLoadout());
    launch(op);
    for (let t = 0; t < (opts.storm ?? 0); t += 1) tickOperation(op, def, { x: -80, z: 480, y: 200, agl: 150 }, 1, cap);
    if (opts.detected) tickOperation(op, def, { x: 700, z: 100, y: 700, agl: 600 }, 0.1, cap);
    threadRings(op, cap);
    beginReturn(op);
    threadRings(op, cap);
    if (opts.landed === false) endOperation(op, 'fuel');
    else landAtBase(op, def);
    return stageResults(m, op, def);
  };

  it('a clean run is three ticks', () => {
    const s = fly({ photo: 0.9 });
    expect(s.map((x) => [x.label, x.ok, x.word])).toEqual([
      ['OUTBOUND', true, 'CLEAN'],
      ['RECON', true, 'EXCELLENT'],
      ['RETURN', true, 'CLEAN'],
    ]);
  });

  it('each stage reports its own problem in one word', () => {
    expect(fly({ photo: 0.9, detected: true })[0]).toMatchObject({ ok: false, word: 'SPOTTED' });
    expect(fly({ photo: 0.9, storm: 5 })[0]).toMatchObject({ ok: true, word: 'BUMPY' });
    expect(fly({})[1]).toMatchObject({ ok: false, word: 'NO PHOTO' });
    expect(fly({ photo: 0.5 })[1]).toMatchObject({ ok: true, word: 'FAIR' });
    expect(fly({ photo: 0.9, landed: false })[2]).toMatchObject({ ok: false, word: 'LOST' });
  });
});

describe('preflight aircraft bars', () => {
  it('show real differences between aircraft, in range', () => {
    const [k, h] = AIRCRAFT.map(aircraftBars);
    const v = (bars: { label: string; v: number }[], l: string) => bars.find((b) => b.label === l)!.v;
    for (const bars of AIRCRAFT.map(aircraftBars))
      for (const b of bars) {
        expect(b.v).toBeGreaterThan(0);
        expect(b.v).toBeLessThanOrEqual(1);
      }
    expect(v(k, 'SPEED')).toBeGreaterThan(v(h, 'SPEED'));
    expect(v(k, 'STEALTH')).toBeGreaterThan(v(h, 'STEALTH'));
    expect(v(h, 'RANGE')).toBeGreaterThan(v(k, 'RANGE'));
    expect(v(h, 'WEATHER')).toBeGreaterThan(v(k, 'WEATHER'));
  });
});
