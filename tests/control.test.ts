/**
 * MISSION CONTROL as a game: discover → decide → EXECUTE → score → Exit
 * Profile → a different flight out. The critical property under test:
 * different decisions give different scores, and different scores give
 * meaningfully different exits.
 */
import { describe, expect, it } from 'vitest';
import { allCells, belief, canUse, chooseCorridor, clueChecks, isKnown, mark, newBoard, ruledOut, scoreBoard, useAsset, type AssetId, type BoardState, type CellTruth, type Target } from '../src/control/board';
import { buildExit, DECK_BLIND, DECK_KNOWN, TIER } from '../src/control/exit';
import { CONTROL_01 } from '../src/mission/mission01Control';
import { DECOYS, DEFAULT_RETURNS, rollReturns, SECTOR_7, type ReturnDef, type ReturnId } from '../src/mission/mission01';
import { getHeightField } from '../src/world/terrain';
import { bonusTaken, placeRoute, rings, type Ring } from '../src/operation/gates';
import { beginReturn, landAtBase, launch, newOperation } from '../src/operation/operation';
import { buildReport } from '../src/operation/score';
import { capabilities, defaultLoadout } from '../src/operation/loadout';
import { MISSION_01 } from '../src/mission/mission01';
import { newMission } from '../src/mission/mission';
import { threadRings } from './helpers';

const hf = getHeightField();
const ground = (x: number, z: number) => hf.sample(x, z);
const def = CONTROL_01;
const inSector = (r: ReturnDef) => r.route.every(([x, z]) => x >= SECTOR_7.x0 && x <= SECTOR_7.x1 && z >= SECTOR_7.z0 && z <= SECTOR_7.z1);

/** A small deterministic random source. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const KIT: ('radar' | 'optical' | 'thermal' | 'sigint')[] = ['radar', 'optical'];
const fresh = (seed = 1, cast: readonly ReturnDef[] = DEFAULT_RETURNS, kit = KIT) => newBoard(def, cast, kit, seeded(seed));
const use = (b: BoardState, a: AssetId, t: Target, cast: readonly ReturnDef[] = DEFAULT_RETURNS) => useAsset(b, cast, inSector, def.clues, a, t);
const ret = (id: ReturnId): Target => ({ kind: 'return', id });
const cell = (id: string): Target => ({ kind: 'cell', id });
const score = (b: BoardState, cast: readonly ReturnDef[] = DEFAULT_RETURNS) => scoreBoard(b, def, cast, inSector);
const exitOf = (b: BoardState, cast: readonly ReturnDef[] = DEFAULT_RETURNS, fuel = 220) => buildExit({ board: b, def, result: score(b, cast), fuel, fuelMax: 380, cruise: 60, ground });
/** The corridor with the fewest storms (by truth), for a player who has scouted well. */
const safest = (b: BoardState) => [...def.corridors].sort((p, q) => p.cells.filter((c) => b.cells[c.id].truth === 'storm').length - q.cells.filter((c) => b.cells[c.id].truth === 'storm').length)[0];

// ---------------------------------------------------------------- strategies
/** Careful and clever: confirm the truck with a camera, scout the chosen route, follow the truck. */
function sharp(b: BoardState) {
  use(b, 'optical', ret('C'));
  mark(b, DEFAULT_RETURNS, 'C');
  const route = safest(b);
  for (const c of route.cells) use(b, 'drone', cell(c.id));
  use(b, 'shadow', ret('C'));
  chooseCorridor(b, def, route.id);
  return route;
}
/** Sensible but thin: camera on the truck, one look at the route. */
function steady(b: BoardState) {
  use(b, 'optical', ret('C'));
  mark(b, DEFAULT_RETURNS, 'C');
  const route = safest(b);
  use(b, 'drone', cell(route.cells[0].id));
  chooseCorridor(b, def, route.id);
}
/** Rushed: guesses the truck, trusts the tower, flies the shortest way. */
function rushed(b: BoardState) {
  mark(b, DEFAULT_RETURNS, 'B');
  mark(b, DEFAULT_RETURNS, 'C');
  chooseCorridor(b, def, 'centre');
}

describe('the board: what it starts with', () => {
  it('deals the cell mix across six spots, three ways home', () => {
    const b = fresh(3);
    expect(def.corridors).toHaveLength(3);
    expect(allCells(def)).toHaveLength(6);
    const dealt = Object.values(b.cells).map((c) => c.truth).sort();
    expect(dealt).toEqual([...def.cellMix].sort());
    // nothing is known yet: every spot could be anything
    expect(Object.values(b.cells).every((c) => !isKnown(c))).toBe(true);
    expect(b.minutes).toBe(12);
  });

  it('the tower forecasts the weather, and gets exactly one storm in the wrong place', () => {
    for (let seed = 1; seed < 40; seed++) {
      const b = fresh(seed);
      const wrong = Object.values(b.cells).filter((c) => c.forecast !== (c.truth === 'storm' || c.truth === 'cloud' ? c.truth : 'clear'));
      expect(wrong).toHaveLength(2);
      expect(wrong.map((c) => c.forecast).sort()).toEqual(['clear', 'storm']);
      // never a radar site or a cache in the forecast: the tower only sees weather
      expect(Object.values(b.cells).every((c) => ['clear', 'storm', 'cloud'].includes(c.forecast))).toBe(true);
    }
  });

  it('the radar picture alone rules out the parked lorry and the one outside the sector', () => {
    const b = fresh();
    const check = (id: ReturnId) => {
      const r = DEFAULT_RETURNS.find((x) => x.id === id)!;
      return ruledOut(clueChecks(r, b.returns[id]!, inSector(r), def.clues));
    };
    expect(check('A')).toBe(true); // parked
    expect(check('D')).toBe(true); // west of the sector
    expect(check('B')).toBe(false); // needs a closer look
    expect(check('C')).toBe(false);
  });
});

describe('assets: each answers a different question, for a price', () => {
  it('OPTICAL shows size and road (catches the scouts and the lorry in the field); THERMAL shows size and heat, not road', () => {
    const cast = rollReturns(seeded(9)).filter(Boolean);
    const field = { ...DECOYS.field, id: 'B' as ReturnId };
    const c2 = [...DEFAULT_RETURNS.filter((r) => r.id !== 'B'), field];
    const b = newBoard(def, c2, ['radar', 'optical', 'thermal'], seeded(1));
    use(b, 'thermal', ret('B'), c2);
    expect(ruledOut(clueChecks(field, b.returns.B!, inSector(field), def.clues))).toBe(false); // off road: thermal can't tell
    use(b, 'optical', ret('B'), c2);
    expect(ruledOut(clueChecks(field, b.returns.B!, inSector(field), def.clues))).toBe(true);
    expect(b.minutes).toBe(8);
    void cast;
  });

  it('cameras need the sensor fitted; drones and scouts are limited; nothing runs without time', () => {
    const b = fresh();
    expect(canUse(b, DEFAULT_RETURNS, 'thermal', ret('C')).reason).toBe('NOT FITTED');
    expect(canUse(b, DEFAULT_RETURNS, 'sigint', { kind: 'none' }).reason).toBe('NOT FITTED');
    use(b, 'drone', cell('N1'));
    use(b, 'drone', cell('N2'));
    expect(canUse(b, DEFAULT_RETURNS, 'drone', cell('C1')).reason).toBe('NONE LEFT');
    b.minutes = 1;
    expect(canUse(b, DEFAULT_RETURNS, 'optical', ret('C')).reason).toBe('NO TIME');
  });

  it('a DRONE learns the whole truth about a spot; the SCOUTS only see weather', () => {
    for (let seed = 1; seed < 30; seed++) {
      const b = fresh(seed);
      const id = 'C1';
      const truth = b.cells[id].truth;
      const ev = use(b, 'scouts', cell(id));
      if (truth === 'storm' || truth === 'cloud') {
        expect(belief(b.cells[id])).toBe(truth);
        expect(ev[0].type).toBe('reveal');
      } else {
        expect(isKnown(b.cells[id])).toBe(false); // clear, radar or cache: can't tell from the ground
        expect(b.cells[id].possible).not.toContain('storm');
        expect(b.cells[id].possible).toContain(truth);
      }
      const b2 = fresh(seed);
      use(b2, 'drone', cell(id));
      expect(belief(b2.cells[id])).toBe(truth);
    }
  });

  it('SIGINT hears every radio and finds every radar site at once', () => {
    const b = fresh(5, DEFAULT_RETURNS, ['radar', 'optical', 'sigint']);
    use(b, 'sigint', { kind: 'none' });
    expect(['A', 'B', 'C', 'D'].every((id) => b.returns[id as ReturnId]!.radio)).toBe(true);
    for (const c of Object.values(b.cells)) {
      if (c.truth === 'radar') expect(belief(c)).toBe('radar');
      else expect(c.possible).not.toContain('radar');
    }
    // the scouts transmit: SIGINT rules them out without a camera
    expect(ruledOut(clueChecks(DEFAULT_RETURNS[1], b.returns.B!, true, def.clues))).toBe(true);
    expect(b.minutes).toBe(11);
  });

  it('when the tower was wrong, finding out says so', () => {
    let seen = false;
    for (let seed = 1; seed < 20 && !seen; seed++) {
      const b = fresh(seed);
      const liar = Object.entries(b.cells).find(([, c]) => c.truth === 'storm' && c.forecast === 'clear');
      if (!liar) continue;
      const ev = use(b, 'drone', cell(liar[0]));
      expect(ev.map((e) => e.type)).toContain('contradiction');
      seen = true;
    }
    expect(seen).toBe(true);
  });
});

describe('decisions', () => {
  it('a wrong mark costs a minute; the right one locks the truck; SHADOW needs the lock and finds the barge', () => {
    const b = fresh();
    expect(canUse(b, DEFAULT_RETURNS, 'shadow', ret('C')).reason).toBe('MARK THE TRUCK FIRST');
    expect(mark(b, DEFAULT_RETURNS, 'B')[0].type).toBe('wrong');
    expect(b.minutes).toBe(11);
    expect(mark(b, DEFAULT_RETURNS, 'C')[0].type).toBe('locked');
    expect(mark(b, DEFAULT_RETURNS, 'A')).toEqual([]); // locked in
    expect(use(b, 'shadow', ret('C'))[0].type).toBe('barge');
    expect(b.shadowed).toBe(true);
    expect(b.minutes).toBe(8);
  });

  it('the corridor can be changed until EXECUTE', () => {
    const b = fresh();
    chooseCorridor(b, def, 'north');
    chooseCorridor(b, def, 'river');
    expect(b.corridor).toBe('river');
    chooseCorridor(b, def, 'nowhere');
    expect(b.corridor).toBe('river');
  });

  it('the front: spending the last minute ends the board', () => {
    const b = fresh();
    b.minutes = 2;
    const ev = use(b, 'optical', ret('C'));
    expect(ev.at(-1)!.type).toBe('front');
    expect(b.frontCaught).toBe(true);
    expect(canUse(b, DEFAULT_RETURNS, 'drone', cell('N1')).ok).toBe(false);
  });
});

describe('score: different decisions, different results', () => {
  it('clever play ranks ACE, thin play SOLID, a rushed guess ROUGH, doing nothing SCRAMBLE', () => {
    for (let seed = 1; seed < 25; seed++) {
      const a = fresh(seed);
      sharp(a);
      const s = fresh(seed);
      steady(s);
      const r = fresh(seed);
      rushed(r);
      const n = fresh(seed);
      const [A, S, R, N] = [score(a), score(s), score(r), score(n)];
      expect(A.total).toBeGreaterThan(S.total);
      expect(S.total).toBeGreaterThan(R.total);
      expect(R.total).toBeGreaterThan(N.total);
      expect(A.rank).toBe('ACE');
      expect(['SOLID', 'ACE']).toContain(S.rank);
      expect(['ROUGH', 'SCRAMBLE']).toContain(R.rank);
      expect(N.rank).toBe('SCRAMBLE');
    }
  });

  it('every line is reported, and the total is their sum', () => {
    const b = fresh(4);
    sharp(b);
    const r = score(b);
    expect(r.lines.map((l) => l.id)).toEqual(['objective', 'intel', 'efficiency', 'risk', 'bonus', 'losses']);
    expect(r.total).toBe(r.lines.reduce((t, l) => t + l.points, 0));
    expect(r.confirmed).toBe(true);
  });

  it('confirming by elimination counts as much as a look at the truck', () => {
    const b = fresh();
    use(b, 'optical', ret('B')); // the scouts: three small vehicles
    mark(b, DEFAULT_RETURNS, 'C');
    expect(score(b).confirmed).toBe(true);
    const h = fresh();
    mark(h, DEFAULT_RETURNS, 'C');
    expect(score(h).confirmed).toBe(false);
  });

  it('flying blind is the risk: scouting the chosen route raises the score more than its minutes cost', () => {
    const b = fresh(7);
    mark(b, DEFAULT_RETURNS, 'C');
    chooseCorridor(b, def, 'river');
    const blind = score(b).total;
    use(b, 'drone', cell('R1'));
    use(b, 'drone', cell('R2'));
    expect(score(b).total).toBeGreaterThan(blind);
  });

  it('no truck, or caught by the front: never better than ROUGH', () => {
    const b = fresh();
    sharp(b);
    b.marked = null;
    expect(['ROUGH', 'SCRAMBLE']).toContain(score(b).rank);
    const f = fresh();
    sharp(f);
    f.frontCaught = true;
    expect(['ROUGH', 'SCRAMBLE']).toContain(score(f).rank);
  });
});

describe('score → Exit Profile: the flight out is the consequence', () => {
  const stormDist = (r: { x: number; z: number }, h: { x: number; z: number }) => Math.hypot(r.x - h.x, r.z - h.z);

  it('the four tiers fly differently: weather, fuel, traffic, departure, opportunities', () => {
    const seed = 2;
    const a = fresh(seed);
    sharp(a);
    const s = fresh(seed);
    steady(s);
    const r = fresh(seed);
    rushed(r);
    const n = fresh(seed);
    const [A, S, R, N] = [exitOf(a), exitOf(s), exitOf(r), exitOf(n)];
    expect([A.tier, S.tier, N.tier]).toEqual(['optimal', 'standard', 'scramble']);
    expect(['degraded', 'scramble']).toContain(R.tier);
    // visibility falls with the tier
    expect(A.leg.visibility).toBeGreaterThan(S.leg.visibility);
    expect(S.leg.visibility).toBeGreaterThan(N.leg.visibility);
    // fuel: an ace exit tops up, a scramble loses some
    expect(A.fuelSeconds).toBeGreaterThan(S.fuelSeconds);
    expect(S.fuelSeconds).toBeGreaterThan(N.fuelSeconds);
    // a scramble is chased from the first ring and breaks low through the first two
    expect(N.contactFromStart).toBe(true);
    expect(N.leg.gates.filter((g) => g.kind === 'ring' && g.cue === 'BREAK LOW')).toHaveLength(2);
    expect(N.leg.hazards.some((h) => h.id === 'front')).toBe(true);
    // the ace exit: the shortcut and the barge pass
    expect(A.shortcut).toBe(true);
    expect(A.opportunities.map((o) => o.kind)).toContain('barge');
    expect(A.lines.find((l) => l.label === 'DEPARTURE')!.value).toMatch(/SHORTCUT/);
    // the briefings read differently
    expect(A.lines.map((l) => l.value)).not.toEqual(N.lines.map((l) => l.value));
  });

  it('a storm you found is routed around; a storm you missed sits on the rings', () => {
    let tested = 0;
    for (let seed = 1; seed < 60; seed++) {
      const b = fresh(seed);
      const stormy = def.corridors.find((c) => c.cells.some((x) => b.cells[x.id].truth === 'storm') && c.cells.filter((x) => b.cells[x.id].truth === 'storm').length === 1);
      if (!stormy) continue;
      const sc = stormy.cells.find((x) => b.cells[x.id].truth === 'storm')!;
      use(b, 'optical', ret('C'));
      mark(b, DEFAULT_RETURNS, 'C');
      chooseCorridor(b, def, stormy.id);
      const blind = exitOf(b);
      const st = blind.leg.hazards.find((h) => h.id === `storm-${sc.id}`)!;
      expect(st.kind).toBe('storm');
      const blindRings = blind.leg.gates.filter((g) => g.kind === 'ring');
      expect(blindRings.some((g) => g.kind === 'ring' && st.kind === 'storm' && stormDist(g, st) < st.r)).toBe(true);
      expect(blind.lines.find((l) => l.label === 'WEATHER')!.value).toMatch(/UNPLANNED/);
      use(b, 'drone', cell(sc.id));
      const seen = exitOf(b);
      const st2 = seen.leg.hazards.find((h) => h.id === `storm-${sc.id}`)!;
      for (const g of seen.leg.gates) if (g.kind === 'ring' && st2.kind === 'storm') expect(stormDist(g, st2)).toBeGreaterThan(st2.r + 30);
      expect(seen.leg.gates.some((g) => g.id === `dt-${sc.id}`)).toBe(true);
      // and the straight lines between rings stay out of it too
      const placed = rings(placeRoute(seen.leg, ground, { x: 700, z: 200 }));
      for (let i = 1; i < placed.length; i++) if (st2.kind === 'storm') expect(segDist(placed[i - 1], placed[i], st2)).toBeGreaterThan(st2.r * 0.9);
      tested++;
    }
    expect(tested).toBeGreaterThan(3);
  });

  it('a radar site you found picks you up late; one you missed was waiting from the start', () => {
    for (let seed = 1; seed < 40; seed++) {
      const b = fresh(seed);
      const site = allCells(def).find((c) => b.cells[c.id].truth === 'radar')!;
      use(b, 'optical', ret('C'));
      mark(b, DEFAULT_RETURNS, 'C');
      chooseCorridor(b, def, site.corridor);
      const res = { rank: 'SOLID' as const, tier: 'standard' as const, total: 5000 };
      const blind = buildExit({ board: b, def, result: res, fuel: 200, fuelMax: 380, cruise: 60, ground });
      expect(blind.contactFromStart).toBe(true);
      expect(blind.lines.find((l) => l.label === 'TRAFFIC')!.value).toMatch(/WAITING/);
      use(b, 'drone', cell(site.id));
      const seen = buildExit({ board: b, def, result: res, fuel: 200, fuelMax: 380, cruise: 60, ground });
      expect(seen.contactFromStart).toBe(false);
      expect(seen.leg.gates.some((g) => g.kind === 'ring' && g.alert)).toBe(true);
      return;
    }
    throw new Error('no deal tested');
  });

  it('a cache becomes a bonus ring only when found, and only on a good exit', () => {
    for (let seed = 1; seed < 40; seed++) {
      const b = fresh(seed);
      const cache = allCells(def).find((c) => b.cells[c.id].truth === 'cache')!;
      use(b, 'optical', ret('C'));
      mark(b, DEFAULT_RETURNS, 'C');
      chooseCorridor(b, def, cache.corridor);
      const other = def.corridors.find((c) => c.id === cache.corridor)!.cells.find((c) => c.id !== cache.id)!;
      expect(exitOf(b).opportunities).toEqual([]);
      use(b, 'drone', cell(cache.id));
      use(b, 'drone', cell(other.id));
      const ex = exitOf(b);
      if (ex.tier === 'optimal' || ex.tier === 'standard') {
        expect(ex.opportunities.map((o) => o.kind)).toEqual(['cache']);
        const ring = ex.leg.gates.find((g) => g.id === `bonus-${cache.id}`)!;
        expect(ring.kind === 'ring' && ring.bonus).toBe(true);
      }
      const low = buildExit({ board: b, def, result: { rank: 'ROUGH', tier: 'degraded', total: 3000 }, fuel: 200, fuelMax: 380, cruise: 60, ground });
      expect(low.opportunities).toEqual([]);
      return;
    }
  });

  it('never an impossible exit: every deal, route and tier is flyable under its deck, in the world, with the fuel to get home', () => {
    let checked = 0;
    for (let seed = 1; seed < 30; seed++) {
      const cast = rollReturns(seeded(seed));
      for (const corridor of def.corridors) {
        for (const tier of ['optimal', 'standard', 'degraded', 'scramble'] as const) {
          for (const scouted of [false, true]) {
            const b = newBoard(def, cast, KIT, seeded(seed * 7));
            if (scouted) for (const c of corridor.cells) b.cells[c.id].possible = [b.cells[c.id].truth];
            b.shadowed = seed % 2 === 0;
            chooseCorridor(b, def, corridor.id);
            const ex = buildExit({ board: b, def, result: { rank: 'SOLID', tier, total: 4000 }, fuel: 40, fuelMax: 380, cruise: 60, ground });
            const deck = ex.leg.hazards.find((h) => h.kind === 'ceiling');
            const rs = ex.leg.gates.filter((g): g is Extract<typeof g, { kind: 'ring' }> => g.kind === 'ring');
            expect(rs.length).toBeGreaterThanOrEqual(3);
            expect(ex.leg.gates.at(-1)!.kind).toBe('land');
            for (const g of rs) {
              if (g.kind !== 'ring') continue;
              expect(Math.abs(g.x)).toBeLessThanOrEqual(1100);
              expect(Math.abs(g.z)).toBeLessThanOrEqual(1100);
              expect(g.agl).toBeGreaterThanOrEqual(30);
              if (deck && deck.kind === 'ceiling') expect(ground(g.x, g.z) + g.agl).toBeLessThan(deck.y - 40);
            }
            // fuel always covers the route, never above a full tank
            let len = 0;
            for (let i = 1; i < rs.length; i++) len += Math.hypot(rs[i].x - rs[i - 1].x, rs[i].z - rs[i - 1].z);
            expect(ex.fuelSeconds).toBeGreaterThan((len + 600) / 60);
            expect(ex.fuelSeconds).toBeLessThanOrEqual(380);
            // the runway approach is always the last ring
            expect(rs.at(-1)!.id).toBe(corridor.rings.at(-1)!.id);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(29 * 3 * 4 * 2);
  });

  it('the deck depends on what you knew: planned under it, or caught by it', () => {
    for (let seed = 1; seed < 40; seed++) {
      const b = fresh(seed);
      const cloud = allCells(def).find((c) => b.cells[c.id].truth === 'cloud')!;
      chooseCorridor(b, def, cloud.corridor);
      const res = { rank: 'SOLID' as const, tier: 'standard' as const, total: 5000 };
      const blind = buildExit({ board: b, def, result: res, fuel: 200, fuelMax: 380, cruise: 60, ground });
      b.cells[cloud.id].possible = ['cloud'];
      const seen = buildExit({ board: b, def, result: res, fuel: 200, fuelMax: 380, cruise: 60, ground });
      const y = (e: typeof blind) => (e.leg.hazards.find((h) => h.kind === 'ceiling') as { y: number }).y;
      expect(y(blind)).toBeGreaterThanOrEqual(DECK_BLIND);
      expect(y(seen)).toBeGreaterThanOrEqual(DECK_KNOWN);
      expect(y(seen)).toBeGreaterThan(y(blind) - 1);
      return;
    }
  });

  it('tiers are ordered from generous to harsh', () => {
    expect(TIER.optimal.visibility).toBeGreaterThan(TIER.standard.visibility);
    expect(TIER.standard.fuel).toBeGreaterThan(TIER.degraded.fuel);
    expect(TIER.degraded.storm).toBeLessThan(TIER.scramble.storm);
  });
});

describe('the whole loop: FLY IN → MISSION CONTROL → SCORE → EXIT PROFILE → FLY OUT → DEBRIEF', () => {
  /** Fly the operation with a given board strategy; the return leg is whatever EXECUTE generated. */
  function operation(play: (b: BoardState) => void, seed = 2) {
    const cap = capabilities(defaultLoadout());
    const op = newOperation(MISSION_01, defaultLoadout(), ground);
    launch(op);
    const end = threadRings(op, cap);
    expect(op.stage).toBe('recon');
    const b = fresh(seed);
    play(b);
    if (!b.corridor) chooseCorridor(b, def, 'centre');
    b.executed = true;
    const res = score(b);
    const ex = buildExit({ board: b, def, result: res, fuel: 250, fuelMax: 380, cruise: 60, ground });
    beginReturn(op, { return: ex.leg }, { x: end.x, y: end.y, z: end.z, yaw: 0 }, ground, ex.contactFromStart);
    expect(op.stage).toBe('return');
    const contactAtStart = op.ret.contact;
    threadRings(op, cap);
    landAtBase(op, MISSION_01);
    const m = newMission();
    m.primaryComplete = m.targetIdentified = !!b.marked;
    m.destinationConfirmed = b.shadowed;
    m.photos.truck = b.marked ? 0.9 : 0;
    const report = buildReport(m, op, MISSION_01, ex.fuelSeconds / 380, 300, { total: res.total, rank: res.rank });
    return { res, ex, op, report, contactAtStart, taken: bonusTaken(op.ret, op.routes.return).length };
  }

  it('a sharp board and an empty one fly different routes home, and the debrief knows', () => {
    const ace = operation(sharp);
    const none = operation(() => {});
    expect(ace.res.rank).toBe('ACE');
    expect(none.res.rank).toBe('SCRAMBLE');
    // the flight out really is different
    const ids = (o: typeof ace) => o.op.routes.return.gates.map((g) => g.id);
    expect(ids(ace)).not.toEqual(ids(none));
    expect(ace.contactAtStart).toBe(false);
    expect(none.contactAtStart).toBe(true);
    // the opportunity Mission Control opened was flown and counted
    expect(ace.taken).toBeGreaterThan(0);
    expect(none.taken).toBe(0);
    expect(ace.report.rows.find((r) => r.label === 'Mission Control')!.value).toMatch(/ACE/);
    expect(ace.report.stages.find((s) => s.id === 'recon')!.word).toBe('ACE');
    expect(ace.report.score).toBeGreaterThan(none.report.score);
    expect(ace.report.secondaries.find((s) => s.label === 'Followed the truck')!.done).toBe(true);
  });

  it('every board ends in a landing: no exit can strand the pilot', () => {
    for (const play of [sharp, steady, rushed, () => {}]) {
      for (let seed = 1; seed < 8; seed++) {
        const o = operation(play, seed);
        expect(o.op.stage).toBe('debrief');
        expect(o.op.outcome).toBe('landed');
      }
    }
  });
});

function segDist(a: Ring, b: Ring, p: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}

export type { CellTruth };
