import { describe, expect, it } from 'vitest';
import { DESTINATION, MISSION_01, RETURNS, SECTOR_7, TARGET_SPEED_TO_DESTINATION, type ReturnId } from '../src/mission/mission01';
import {
  BARGE,
  CAMERA_SECONDS,
  canExtract,
  CONFIRM_SECONDS,
  describeReturn,
  destinationRoute,
  evidenceGrade,
  extract,
  formatTime,
  identify,
  inSector,
  inspectReturn,
  intelligence,
  listenReturn,
  mismatchReason,
  MISSION_RATE,
  newMission,
  operatorWork,
  photograph,
  photoQuality,
  reconObjective,
  RETURN_BY_ID,
  scanReturn,
  secondaries,
  TARGET,
  updateDestination,
  type MissionState,
} from '../src/mission/mission';
import { RouteMover } from '../src/mission/vehicles';
import { detectionGain, radarParams } from '../src/sensors/radar';
import { pauseTransition } from '../src/game/modes';

/** Hold the radar over a return from a given altitude. */
function scan(m: MissionState, id: ReturnId, agl: number, seconds: number, dist = 20): void {
  const p = radarParams(agl);
  const def = RETURN_BY_ID[id];
  for (let t = 0; t < seconds; t += 0.05) scanReturn(m, id, detectionGain(0.05, p, dist, def, false, MISSION_RATE), 600, 300);
}
const look = (m: MissionState, id: ReturnId, sensor: 'optical' | 'thermal' = 'optical') => inspectReturn(m, id, CAMERA_SECONDS + 0.01, true, sensor);
/** Locate and identify the truck. */
const found = () => {
  const m = newMission();
  scan(m, 'C', 150, 6);
  look(m, 'C');
  identify(m, 'C');
  return m;
};

describe('mission 01 content', () => {
  it('loads with one clear objective and a single target', () => {
    const m = newMission();
    expect(m.phase).toBe('locate');
    expect(Object.keys(m.returns).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(RETURNS.filter((r) => r.isTarget)).toHaveLength(1);
    expect(TARGET.id).toBe('C');
    expect(MISSION_01.briefing.headline).toBe('LOCATE THE MISSING SUPPLY TRUCK');
    const ob = reconObjective(m, { station: 'operator' });
    expect(ob).toEqual({ kicker: 'PRIMARY', title: 'LOCATE THE SUPPLY TRUCK', detail: MISSION_01.intelShort, done: false });
    expect(m.returns.E.hidden).toBe(true);
    expect(Object.values(m.returns).every((r) => !r.detected && r.verdict === 'none')).toBe(true);
  });

  it('the briefing covers everything a crew needs before take-off', () => {
    const b = MISSION_01.briefing;
    for (const k of ['primary', 'weather', 'conditions', 'targetArea', 'window'] as const) expect(b[k].length).toBeGreaterThan(10);
    expect(b.secondaries.length).toBeGreaterThan(0);
    expect(b.constraints.length).toBeGreaterThan(0);
    expect(b.threats.length).toBeGreaterThan(0);
  });

  it('each decoy contradicts the intel on exactly one point, wherever it drives', () => {
    for (const r of RETURNS.filter((x) => x.kind !== 'vessel')) {
      const mv = new RouteMover(r.route, r.speed, r.start, true);
      const reasons = new Set<string | null>();
      for (let t = 0; t < 400; t += 0.5) {
        mv.step(0.5);
        reasons.add(mismatchReason(r, mv.x, mv.z));
      }
      expect(reasons.size).toBe(1);
      const [why] = [...reasons];
      if (r.isTarget) expect(why).toBeNull();
      else expect(why).toBeTruthy();
    }
    expect(mismatchReason(RETURN_BY_ID.A, 612, 452)).toMatch(/stationary/);
    expect(mismatchReason(RETURN_BY_ID.B, 600, 250)).toMatch(/small/);
    expect(mismatchReason(RETURN_BY_ID.D, 0, 600)).toMatch(/outside Sector 7/);
  });

  it('each sensor has a clue to give: engines and radios differ in the right places', () => {
    expect(RETURN_BY_ID.A.engine).toBe('cold'); // parked
    expect(RETURN_BY_ID.C.engine).toBe('running');
    expect(RETURN_BY_ID.C.radio).toBe(false); // the dead radio from the briefing
    expect(RETURN_BY_ID.B.radio).toBe(true); // our scouts talk
    expect(MISSION_01.intel.join(' ')).toMatch(/silent/);
  });

  it('the truck starts inside Sector 7 and its destination is inside too', () => {
    const c = new RouteMover(TARGET.route, TARGET.speed, TARGET.start, true);
    expect(inSector(c.x, c.z)).toBe(true);
    expect(inSector(DESTINATION.x, DESTINATION.z)).toBe(true);
    expect(inSector(SECTOR_7.x0 - 1, SECTOR_7.z0)).toBe(false);
  });
});

describe('sensors', () => {
  it('radar detects; size stays unknown until a camera looks', () => {
    const m = newMission();
    scan(m, 'B', 450, 6);
    expect(m.returns.B.detected).toBe(true);
    expect(describeReturn(m, 'B', 600, 250, true).traits).toEqual(['SIZE ? · USE A CAMERA', 'MOVING', 'IN SECTOR 7']);
  });

  it('optical gives size, count and road; thermal gives size, count and engine heat', () => {
    const m = newMission();
    scan(m, 'B', 150, 6);
    scan(m, 'A', 150, 6);
    expect(look(m, 'B', 'optical')[0].text).toBe('OPTICAL · RETURN B IS 3 SMALL VEHICLES');
    expect(describeReturn(m, 'B', 600, 250, true).traits).toEqual(['3 SMALL VEHICLES', 'MOVING', 'ON ROAD', 'IN SECTOR 7']);
    expect(look(m, 'A', 'thermal')[0].text).toBe('THERMAL · RETURN A IS A LARGE VEHICLE · ENGINE COLD');
    expect(describeReturn(m, 'A', 612, 452, false).traits).toEqual(['LARGE VEHICLE', 'STATIONARY', 'ENGINE COLD', 'IN SECTOR 7']);
    // a second camera adds its own fact
    expect(look(m, 'A', 'optical')[0].text).toMatch(/OPTICAL/);
    expect(describeReturn(m, 'A', 612, 452, false).traits).toContain('ON ROAD');
    expect(look(m, 'A', 'optical')).toEqual([]);
  });

  it('identification needs steady camera time in view', () => {
    const m = newMission();
    scan(m, 'C', 150, 6);
    expect(inspectReturn(m, 'C', 5, false)).toEqual([]);
    expect(inspectReturn(m, 'C', CAMERA_SECONDS / 2, true)).toEqual([]);
    expect(inspectReturn(m, 'C', CAMERA_SECONDS / 2 + 0.01, true)).toHaveLength(1);
    expect(inspectReturn(m, 'D', 5, true)).toEqual([]); // not detected yet
  });

  it('SIGINT tells transmitting from silent', () => {
    const m = newMission();
    scan(m, 'B', 150, 6);
    scan(m, 'C', 150, 6);
    expect(listenReturn(m, 'B', true)[0].text).toBe('SIGINT · RETURN B IS TRANSMITTING');
    expect(listenReturn(m, 'C', false)).toEqual([]);
    expect(listenReturn(m, 'C', true)[0].text).toBe('SIGINT · RETURN C IS RADIO SILENT');
    expect(describeReturn(m, 'C', 700, 100, true).traits).toContain('RADIO SILENT');
    expect(listenReturn(m, 'C', true)).toEqual([]);
  });

  it('the barge cannot be found until the recon reveals it', () => {
    const m = newMission();
    scanReturn(m, 'E', 10, 528, 556);
    expect(m.returns.E.detected).toBe(false);
  });

  it('photo quality: optical is sharpest, haze hurts optical not thermal, range and crew matter', () => {
    const q = (o: Partial<Parameters<typeof photoQuality>[0]>) => photoQuality({ sensor: 'optical', slant: 300, visibility: 1, bonus: 0, ...o });
    expect(q({})).toBeGreaterThan(q({ sensor: 'thermal' }));
    expect(q({ visibility: 0.5 })).toBeLessThan(q({}));
    expect(q({ sensor: 'thermal', visibility: 0.5 })).toBe(q({ sensor: 'thermal' }));
    expect(q({ slant: 550 })).toBeLessThan(q({}));
    expect(q({ bonus: 0.15 })).toBeGreaterThan(q({}));
    expect(evidenceGrade(0)).toBe('NONE');
    expect(evidenceGrade(0.9)).toBe('EXCELLENT');
    expect(evidenceGrade(0.7)).toBe('GOOD');
    expect(evidenceGrade(0.5)).toBe('FAIR');
    expect(evidenceGrade(0.2)).toBe('POOR');
  });
});

describe('recon objectives and dynamic updates', () => {
  it('cannot mark a return that has not been detected', () => {
    expect(identify(newMission(), 'C').result).toBe('unknown');
  });

  it('a wrong identification counts a false positive and does not complete the objective', () => {
    const m = newMission();
    scan(m, 'D', 150, 6);
    const r = identify(m, 'D');
    expect(r.result).toBe('wrong');
    expect(m.phase).toBe('locate');
    expect(m.falsePositives).toBe(1);
    expect(identify(m, 'D').result).toBe('already');
    expect(m.falsePositives).toBe(1);
  });

  it('LOCATE → PHOTOGRAPH, announced in order', () => {
    const m = newMission();
    scan(m, 'C', 150, 6);
    const r = identify(m, 'C');
    expect(r.events.map((e) => [e.type, e.text])).toEqual([
      ['objective-complete', 'Supply truck located.'],
      ['new-objective', 'Photograph the truck as evidence.'],
    ]);
    expect(m.phase).toBe('photograph');
    expect(reconObjective(m, { station: 'operator' }).title).toBe('PHOTOGRAPH THE TRUCK');
  });

  it('a photograph needs an identified target; it completes the primary and updates the objective', () => {
    const m = newMission();
    scan(m, 'C', 150, 6);
    identify(m, 'C'); // marked from radar alone: a gamble that paid off
    expect(photograph(m, 'C', 0.9).result).toBe('unidentified');
    look(m, 'C');
    const r = photograph(m, 'C', 0.9);
    expect(r.result).toBe('primary');
    expect(r.events.map((e) => e.type)).toEqual(['objective-complete', 'objective-updated']);
    expect(r.events[0].text).toBe('Truck photographed · evidence EXCELLENT.');
    expect(m.primaryComplete).toBe(true);
    expect(m.phase).toBe('track');
    expect(reconObjective(m, { station: 'operator' })).toMatchObject({ kicker: 'SECONDARY', title: "CONFIRM THE TRUCK'S DESTINATION" });
    expect(canExtract(m)).toBe(true);
    // a better shot later improves the evidence; a worse one keeps the best
    photograph(m, 'C', 0.95);
    photograph(m, 'C', 0.2);
    expect(m.photos.truck).toBe(0.95);
  });

  it('photographing anything else in the photograph phase does nothing for the objective', () => {
    const m = found();
    scan(m, 'A', 150, 6);
    look(m, 'A');
    expect(photograph(m, 'A', 0.9).result).toBe('untasked');
    expect(m.phase).toBe('photograph');
  });

  it('TRACK: confirmed only when the truck has stopped and a camera is on it; the barge appears', () => {
    const m = found();
    photograph(m, 'C', 0.8);
    for (let t = 0; t < 10; t += 0.1) expect(updateDestination(m, 0.1, false, true)).toEqual([]);
    for (let t = 0; t < 10; t += 0.1) updateDestination(m, 0.1, true, false);
    expect(m.phase).toBe('track');
    const ev = [];
    for (let t = 0; t <= CONFIRM_SECONDS + 0.2; t += 0.1) ev.push(...updateDestination(m, 0.1, true, true));
    expect(ev.map((e) => e.type)).toEqual(['objective-complete', 'objective-updated']);
    expect(ev[0].text).toContain(DESTINATION.name);
    expect(ev[1].text).toMatch(/barge/);
    expect(m.phase).toBe('landing');
    expect(m.returns.E.detected && !m.returns.E.hidden).toBe(true);
    expect(reconObjective(m, { station: 'operator' }).title).toBe('PHOTOGRAPH THE BARGE');
  });

  it('LANDING: photographing the barge completes the recon', () => {
    const m = found();
    photograph(m, 'C', 0.8);
    updateDestination(m, CONFIRM_SECONDS + 1, true, true);
    look(m, BARGE.id, 'thermal');
    const r = photograph(m, BARGE.id, 0.7);
    expect(r.result).toBe('transfer');
    expect(r.events.map((e) => e.type)).toEqual(['objective-complete', 'recon-complete']);
    expect(m.phase).toBe('extract');
    expect(m.extractReason).toBe('complete');
    expect(operatorWork(m)).toBe(false);
    expect(reconObjective(m).kicker).toBe('EXTRACTION');
  });

  it('extraction: by choice only once the primary is done; forced by weather or fuel any time', () => {
    const m = newMission();
    expect(extract(m, 'manual')).toEqual([]);
    expect(m.phase).toBe('locate');
    expect(extract(m, 'weather')[0].title).toBe('WEATHER FRONT');
    expect(m.phase).toBe('extract');
    expect(extract(m, 'fuel')).toEqual([]);
    const m2 = found();
    photograph(m2, 'C', 0.8);
    expect(extract(m2, 'manual')[0].title).toBe('EXTRACTING');
    expect(m2.extractReason).toBe('manual');
  });

  it('in the pilot seat the objective says how to get back to the recon', () => {
    const m = newMission();
    expect(reconObjective(m, { station: 'pilot', inArea: true }).detail).toBe('OPEN MISSION CONTROL');
    expect(reconObjective(m, { station: 'pilot', inArea: false }).detail).toMatch(/FLY BACK TO SECTOR 7/);
    expect(reconObjective(m, { station: 'operator', truckStopped: true }).title).toBe('LOCATE THE SUPPLY TRUCK');
  });

  it('secondaries are issued in the field as the recon unfolds', () => {
    const m = found();
    expect(secondaries(m, false).map((s) => s.issued)).toEqual([true, false, false]);
    photograph(m, 'C', 0.8);
    updateDestination(m, CONFIRM_SECONDS + 1, true, true);
    const s = secondaries(m, true);
    expect(s.map((x) => x.issued)).toEqual([true, true, true]);
    expect(s.map((x) => x.done)).toEqual([false, true, false]);
  });

  it('intelligence reports what the recon established and why decoys were not the truck', () => {
    const m = found();
    scan(m, 'A', 150, 6);
    expect(identify(m, 'A').result).toBe('inactive'); // marking closes once the truck is found
    photograph(m, 'C', 0.8);
    updateDestination(m, CONFIRM_SECONDS + 1, true, true);
    expect(intelligence(m)[0]).toMatch(/Sallow river landing/);
    expect(intelligence(m).join(' ')).toMatch(/Return A: A broken-down quarry lorry.*stationary/);
  });
});

describe('the truck drives to its destination once photographed', () => {
  it('builds a road route from its current mine-road segment to the landing', () => {
    const r = destinationRoute(765, 50, 1);
    expect(r[0]).toEqual([765, 50]);
    expect(r[1]).toEqual([770, 160]);
    expect(r[r.length - 1]).toEqual([DESTINATION.x, DESTINATION.z]);
  });

  it('arrives from anywhere on its circuit within a short follow', () => {
    for (const start of [0, 200, 400, 600, 800, 1000]) {
      const mv = new RouteMover(TARGET.route, TARGET.speed, start, true);
      mv.setRoute(destinationRoute(mv.x, mv.z, mv.segment), false);
      mv.speed = TARGET_SPEED_TO_DESTINATION;
      let t = 0;
      while (!mv.arrived && t < 300) {
        mv.step(0.1);
        t += 0.1;
      }
      expect(mv.arrived).toBe(true);
      expect(t).toBeLessThan(110);
    }
  });

  it('ping-pong vehicles stay on their road and parked ones never move', () => {
    const a = new RouteMover(RETURN_BY_ID.A.route, 0, 0, true);
    a.step(5);
    expect([a.x, a.z, a.moving]).toEqual([612, 452, false]);
    const b = new RouteMover(RETURN_BY_ID.B.route, RETURN_BY_ID.B.speed, 0, true);
    for (let i = 0; i < 2000; i++) {
      b.step(0.1);
      expect(b.x).toBeGreaterThanOrEqual(470 - 1e-6);
      expect(b.x).toBeLessThanOrEqual(690 + 1e-6);
    }
  });
});

describe('misc', () => {
  it('formats time as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(222)).toBe('03:42');
  });
  it('pause transitions: flight ↔ paused, other screens ignore it', () => {
    expect(pauseTransition('flight')).toBe('paused');
    expect(pauseTransition('paused')).toBe('flight');
    for (const m of ['title', 'preflight', 'intel', 'debrief'] as const) expect(pauseTransition(m)).toBeNull();
  });
});
