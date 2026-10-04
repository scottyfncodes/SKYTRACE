import { describe, expect, it } from 'vitest';
import { DESTINATION, MISSION_01, RETURNS, SECTOR_7, TARGET_SPEED_TO_DESTINATION, type ReturnId } from '../src/mission/mission01';
import {
  buildDebrief,
  CONFIRM_SECONDS,
  describeReturn,
  destinationRoute,
  fail,
  formatTime,
  identify,
  inSector,
  isActive,
  land,
  mismatchReason,
  MISSION_RATE,
  newMission,
  objectiveFor,
  RETURN_BY_ID,
  scanReturn,
  TARGET,
  updateDestination,
  type MissionState,
} from '../src/mission/mission';
import { RouteMover } from '../src/mission/vehicles';
import { canResolve, detectionGain, radarParams } from '../src/sensors/radar';
import { pauseTransition } from '../src/game/modes';

/** Hold the radar over a return from a given altitude until `seconds` pass. */
function scan(m: MissionState, id: ReturnId, agl: number, seconds: number, dist = 20): void {
  const p = radarParams(agl);
  const def = RETURN_BY_ID[id];
  for (let t = 0; t < seconds; t += 0.05) scanReturn(m, id, detectionGain(0.05, p, dist, def, false, MISSION_RATE), canResolve(p, def), 600, 300);
}

describe('mission 01 content', () => {
  it('loads with one clear objective and a single target', () => {
    const m = newMission();
    expect(m.phase).toBe('locate');
    expect(Object.keys(m.returns).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(RETURNS.filter((r) => r.isTarget)).toHaveLength(1);
    expect(TARGET.id).toBe('C');
    expect(MISSION_01.title).toBe('FIND THE TRUCK');
    expect(MISSION_01.objective).toMatch(/Locate the missing supply truck/);
    expect(MISSION_01.success).toMatch(/return to base/i);
    const ob = objectiveFor(m);
    expect(ob.title).toBe('LOCATE THE SUPPLY TRUCK');
    expect(ob.detail).toBe(MISSION_01.intelShort);
    expect(Object.values(m.returns).every((r) => !r.detected && r.verdict === 'none')).toBe(true);
  });

  it('each decoy contradicts the intel on exactly one point, wherever it drives', () => {
    for (const r of RETURNS) {
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

  it('the truck starts inside Sector 7 and its destination is inside too', () => {
    const c = new RouteMover(TARGET.route, TARGET.speed, TARGET.start, true);
    expect(inSector(c.x, c.z)).toBe(true);
    expect(inSector(DESTINATION.x, DESTINATION.z)).toBe(true);
    expect(inSector(SECTOR_7.x0 - 1, SECTOR_7.z0)).toBe(false);
  });
});

describe('recon / scanning', () => {
  it('detects from altitude but needs a low pass to resolve size', () => {
    const m = newMission();
    scan(m, 'B', 450, 6);
    expect(m.returns.B.detected).toBe(true);
    expect(m.returns.B.resolved).toBe(false);
    const card = describeReturn(m, 'B', 600, 250, true);
    expect(card.traits[0]).toMatch(/SIZE \?/);
    scan(m, 'B', 150, 6);
    expect(m.returns.B.resolved).toBe(true);
    expect(describeReturn(m, 'B', 600, 250, true).traits).toEqual(['3 SMALL VEHICLES', 'MOVING', 'ON ROAD', 'IN SECTOR 7']);
  });

  it('reports detection then resolution as events, once each', () => {
    const m = newMission();
    const p = radarParams(120);
    const def = RETURN_BY_ID.C;
    const types: string[] = [];
    for (let t = 0; t < 10; t += 0.05) for (const e of scanReturn(m, 'C', detectionGain(0.05, p, 20, def, false, MISSION_RATE), canResolve(p, def), 700, 100)) types.push(e.type);
    expect(types).toEqual(['detected', 'resolved']);
    expect(m.returns.C.lastKnown).toEqual({ x: 700, z: 100 });
  });

  it('cards say whether a return is outside Sector 7', () => {
    const m = newMission();
    scan(m, 'D', 150, 6);
    expect(describeReturn(m, 'D', 0, 600, true).traits).toContain('OUTSIDE SECTOR 7');
    expect(describeReturn(m, 'A', 612, 452, false).traits).toContain('STATIONARY');
  });
});

describe('identification and objective progression', () => {
  it('cannot mark a return that has not been detected', () => {
    const m = newMission();
    expect(identify(m, 'C').result).toBe('unknown');
    expect(m.phase).toBe('locate');
  });

  it('a wrong identification counts a false positive and does not complete the objective', () => {
    const m = newMission();
    scan(m, 'D', 150, 6);
    const r = identify(m, 'D');
    expect(r.result).toBe('wrong');
    expect(r.events[0].type).toBe('wrong');
    expect(m.phase).toBe('locate');
    expect(m.targetIdentified).toBe(false);
    expect(m.falsePositives).toBe(1);
    expect(identify(m, 'D').result).toBe('already');
    expect(m.falsePositives).toBe(1);
    expect(isActive(m)).toBe(true);
  });

  it('the correct identification completes the objective and announces the next one, in order', () => {
    const m = newMission();
    scan(m, 'C', 150, 6);
    const r = identify(m, 'C');
    expect(r.result).toBe('correct');
    expect(r.events.map((e) => e.type)).toEqual(['objective-complete', 'new-objective']);
    expect(r.events[0].text).toBe('Supply truck located.');
    expect(r.events[1].text).toMatch(/Confirm the truck's destination/);
    expect(m.phase).toBe('destination');
    expect(objectiveFor(m).title).toBe("CONFIRM THE TRUCK'S DESTINATION");
    expect(objectiveFor(m, true).detail).toMatch(/STOPPED/);
    // marking is over once the truck is found
    scan(m, 'A', 150, 6);
    expect(identify(m, 'A').result).toBe('inactive');
    expect(m.falsePositives).toBe(0);
  });

  it('destination is confirmed only once the truck has stopped and the aircraft is over it', () => {
    const m = newMission();
    scan(m, 'C', 150, 6);
    identify(m, 'C');
    for (let t = 0; t < 10; t += 0.1) expect(updateDestination(m, 0.1, false, 50)).toEqual([]);
    expect(m.confirm).toBe(0);
    for (let t = 0; t < 10; t += 0.1) updateDestination(m, 0.1, true, 900);
    expect(m.phase).toBe('destination');
    const events = [];
    for (let t = 0; t <= CONFIRM_SECONDS + 0.2; t += 0.1) events.push(...updateDestination(m, 0.1, true, 120));
    expect(events.map((e) => e.type)).toEqual(['objective-complete', 'final-objective']);
    expect(events[0].text).toContain(DESTINATION.name);
    expect(events[1].text).toBe('Return to base.');
    expect(m.phase).toBe('rtb');
    expect(m.destinationConfirmed).toBe(true);
    expect(objectiveFor(m).title).toBe('RETURN TO BASE');
  });

  it('landing only completes the mission in the return-to-base phase', () => {
    const m = newMission();
    expect(land(m).ok).toBe(false);
    expect(m.phase).toBe('locate');
    m.phase = 'rtb';
    const r = land(m);
    expect(r.ok).toBe(true);
    expect(m.phase).toBe('complete');
    expect(objectiveFor(m).done).toBe(true);
    expect(isActive(m)).toBe(false);
    expect(fail(m, 'fuel')).toEqual([]);
  });
});

describe('the truck drives to its destination once found', () => {
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
      expect(Math.hypot(mv.x - DESTINATION.x, mv.z - DESTINATION.z)).toBeLessThan(0.01);
      mv.step(1);
      expect(mv.moving).toBe(false);
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
    expect(b.moving).toBe(true);
  });
});

describe('debrief', () => {
  it('summarises a clean, complete sortie', () => {
    const m = newMission();
    scan(m, 'C', 150, 6);
    scan(m, 'A', 150, 6);
    identify(m, 'C');
    for (let t = 0; t <= CONFIRM_SECONDS + 0.2; t += 0.1) updateDestination(m, 0.1, true, 50);
    land(m);
    m.time = 222.4;
    const d = buildDebrief(m, 0.613);
    expect(d.success).toBe(true);
    expect(d.headline).toBe('MISSION COMPLETE');
    const row = (l: string) => d.rows.find((r) => r.label === l)!.value;
    expect(row('Objective')).toBe('Complete');
    expect(row('Supply truck identified')).toBe('Yes · Return C');
    expect(row('Destination confirmed')).toBe(DESTINATION.name);
    expect(row('False positives')).toBe('0');
    expect(row('Time')).toBe('03:42');
    expect(row('Fuel remaining')).toBe('61%');
    expect(row('Recon findings')).toBe('2 of 4 returns');
    expect(d.findings).toHaveLength(2);
  });

  it('records false positives with the reason they did not match', () => {
    const m = newMission();
    scan(m, 'A', 150, 6);
    identify(m, 'A');
    fail(m, 'fuel');
    const d = buildDebrief(m, 0);
    expect(d.success).toBe(false);
    expect(d.headline).toMatch(/FUEL/);
    expect(d.rows.find((r) => r.label === 'False positives')!.value).toBe('1');
    expect(d.rows.find((r) => r.label === 'Supply truck identified')!.value).toBe('No');
    expect(d.findings[0]).toMatch(/marked in error.*stationary/);
  });

  it('formats mission time as mm:ss', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(59.9)).toBe('00:59');
    expect(formatTime(222)).toBe('03:42');
  });
});

describe('pause transitions', () => {
  it('pauses flight, resumes from pause, ignores other screens', () => {
    expect(pauseTransition('flight')).toBe('paused');
    expect(pauseTransition('paused')).toBe('flight');
    expect(pauseTransition('title')).toBeNull();
    expect(pauseTransition('intel')).toBeNull();
    expect(pauseTransition('debrief')).toBeNull();
  });
});
