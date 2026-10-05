/**
 * The recon loop made explicit: FIND → PICK → LOOK → MATCH → MARK, a clue
 * card that ticks the brief's clues against what the sensors know, and one
 * primary action at each step.
 */
import { describe, expect, it } from 'vitest';
import { describeReturn, identify, inspectReturn, listenReturn, newMission, scanReturn } from '../src/mission/mission';
import { MISSION_01, RETURNS, type ReturnId } from '../src/mission/mission01';
import { checkClues, clueVerdict, reconGuide, type GuideInput } from '../src/mission/reconGuide';

const at = (id: ReturnId) => RETURNS.find((r) => r.id === id)!;
/** Detect, look at (optical), and optionally listen to a return, then read its clue card. */
function card(id: ReturnId, opts: { look?: boolean; listen?: boolean } = {}) {
  const m = newMission();
  if (id === 'E') m.returns.E.hidden = false;
  const r = at(id);
  const [x, z] = r.route[0];
  scanReturn(m, id, 5, x, z);
  if (opts.look !== false) inspectReturn(m, id, 10, true, 'optical');
  if (opts.listen) listenReturn(m, id, true);
  const traits = describeReturn(m, id, x, z, r.moving).traits;
  const checks = checkClues(MISSION_01.clues, traits);
  return { m, checks, verdict: clueVerdict(checks, m.returns[id].resolved), by: Object.fromEntries(checks.map((c) => [c.clue, c.check])) };
}

describe('the clue card', () => {
  it('the truck matches every clue it can check', () => {
    const c = card('C', { listen: true });
    expect(c.by).toEqual({ LARGE: 'yes', MOVING: 'yes', 'ON A ROAD': 'yes', 'RADIO DEAD': 'yes', 'IN SECTOR 7': 'yes' });
    expect(c.verdict).toBe('match');
  });

  it('each decoy is caught out by the clue it breaks', () => {
    expect(card('A').by.MOVING).toBe('no'); // parked
    expect(card('B').by.LARGE).toBe('no'); // three small 4x4s
    expect(card('B', { listen: true }).by['RADIO DEAD']).toBe('no'); // our own patrol, transmitting
    expect(card('D').by['IN SECTOR 7']).toBe('no'); // west of the sector
    expect(card('E').by.LARGE).toBe('no'); // a boat
    for (const id of ['A', 'B', 'D', 'E'] as ReturnId[]) expect(card(id).verdict, id).toBe('mismatch');
  });

  it('what has not been checked yet shows as unknown, never as a pass', () => {
    const c = card('C', { look: false });
    expect(c.by.LARGE).toBe('unknown');
    expect(c.by['RADIO DEAD']).toBe('unknown');
    expect(c.by.MOVING).toBe('yes'); // radar knows
    expect(c.verdict).toBe('unchecked');
    // radar alone can already rule out the parked lorry
    expect(card('A', { look: false }).verdict).toBe('mismatch');
  });
});

describe('the guide: one step lit, one thing to do', () => {
  const base: GuideInput = { phase: 'locate', anyDetected: false, selected: null, camera: false, resolved: false, marked: 'none', verdict: 'unchecked' };
  const on = (g: ReturnType<typeof reconGuide>) => g.steps!.find((s) => s.on)!.id;

  it('walks FIND → PICK → LOOK → MATCH → MARK', () => {
    let g = reconGuide(base);
    expect(on(g)).toBe('find');
    expect(g.steps!.map((s) => s.label)).toEqual(['FIND', 'PICK', 'LOOK', 'MATCH', 'MARK']);
    g = reconGuide({ ...base, anyDetected: true });
    expect(on(g)).toBe('pick');
    expect(g.next).toEqual({ action: null, label: 'TAP A RETURN TO CHECK IT' });
    g = reconGuide({ ...base, anyDetected: true, selected: 'C' });
    expect(on(g)).toBe('look');
    expect(g.next).toEqual({ action: 'look', label: '📷 LOOK AT C' });
    g = reconGuide({ ...base, anyDetected: true, selected: 'C', camera: true });
    expect(g.next!.action).toBeNull();
    g = reconGuide({ ...base, anyDetected: true, selected: 'C', camera: true, resolved: true, verdict: 'match' });
    expect(on(g)).toBe('mark');
    expect(g.next).toEqual({ action: 'mark', label: 'MARK C AS THE TRUCK' });
    expect(g.steps!.filter((s) => s.done).map((s) => s.id)).toEqual(['find', 'pick', 'look', 'match']);
  });

  it('a return that breaks a clue says so and offers the next one', () => {
    const g = reconGuide({ ...base, anyDetected: true, selected: 'A', camera: true, resolved: true, verdict: 'mismatch' });
    expect(on(g)).toBe('match');
    expect(g.next).toEqual({ action: 'next', label: 'NOT IT · NEXT RETURN' });
    // marked wrong anyway: back to picking
    expect(on(reconGuide({ ...base, anyDetected: true, selected: 'A', resolved: true, marked: 'wrong', verdict: 'mismatch' }))).toBe('pick');
  });

  it('on a camera with nothing found yet: back to the radar', () => {
    expect(reconGuide({ ...base, camera: true }).next).toEqual({ action: 'radar', label: 'BACK TO RADAR' });
  });

  it('after the truck is marked: photograph it; later the barge', () => {
    expect(reconGuide({ ...base, phase: 'photograph', camera: true })).toEqual({ steps: null, next: { action: 'photo', label: 'TAKE THE PHOTO' } });
    expect(reconGuide({ ...base, phase: 'photograph' }).next!.action).toBe('look');
    expect(reconGuide({ ...base, phase: 'landing', camera: true }).next!.action).toBe('photo');
    expect(reconGuide({ ...base, phase: 'track' })).toEqual({ steps: null, next: null });
  });

  it('every label fits on a phone button', () => {
    for (const id of ['A', 'B', 'C', 'D', 'E'] as ReturnId[])
      for (const g of [
        reconGuide({ ...base, anyDetected: true, selected: id }),
        reconGuide({ ...base, anyDetected: true, selected: id, resolved: true, verdict: 'match' }),
        reconGuide({ ...base, anyDetected: true, selected: id, resolved: true, verdict: 'mismatch' }),
        reconGuide({ ...base, camera: true }),
        reconGuide(base),
      ])
        expect(g.next!.label.length, g.next!.label).toBeLessThanOrEqual(38);
  });

  it('marking the truck from the guide is the same as the MARK button', () => {
    const m = newMission();
    scanReturn(m, 'C', 5, 720, 360);
    inspectReturn(m, 'C', 10, true, 'optical');
    expect(identify(m, 'C').result).toBe('correct');
  });
});
