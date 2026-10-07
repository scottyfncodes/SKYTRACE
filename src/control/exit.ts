/**
 * SCORE → EXIT PROFILE: the Mission Control result becomes the flight out.
 *
 * Three things shape the return leg:
 *   - the RANK (ACE / SOLID / ROUGH / SCRAMBLE) picks the tier: weather,
 *     fuel, traffic, and whether opportunities are open at all;
 *   - the CORRIDOR the player picked gives the rings;
 *   - what the player actually DISCOVERED on that corridor decides how each
 *     hazard plays: a storm you knew about is routed around, one you did not
 *     sits on the rings; a radar site you knew about picks you up late, one
 *     you did not was waiting from the start; a cache you found is a bonus
 *     ring, one you never saw is not there for you.
 *
 * Pure: the ring list it returns is placed by `placeRoute` like any other leg.
 */
import { isKnown, type BoardState, type ControlDef, type ControlResult, type CorridorDef, type ExitTier, type Rank } from './board';
import type { HazardDef, LegDef, RingSpec } from '../operation/gates';

export type ReturnLeg = LegDef & { visibility: number; notices: readonly string[] };

export interface ExitLine {
  label: string;
  value: string;
  tone: 'good' | 'bad' | '';
}

export interface Opportunity {
  ringId: string;
  kind: 'barge' | 'cache';
  label: string;
}

export interface ExitProfile {
  tier: ExitTier;
  rank: Rank;
  score: number;
  corridor: CorridorDef;
  leg: ReturnLeg;
  /** RADAR CONTACT from the first ring (the rings close on a clock). */
  contactFromStart: boolean;
  fuelSeconds: number;
  opportunities: Opportunity[];
  shortcut: boolean;
  /** The briefing, one line each. */
  lines: ExitLine[];
}

export const TIER_LABEL: Record<ExitTier, string> = { optimal: 'OPTIMAL', standard: 'STANDARD', degraded: 'DEGRADED', scramble: 'SCRAMBLE' };

/** What each tier does to the flight out. */
export const TIER: Record<ExitTier, { visibility: number; storm: number; fuel: number; openings: boolean }> = {
  optimal: { visibility: 0.92, storm: 170, fuel: 0.25, openings: true },
  standard: { visibility: 0.7, storm: 200, fuel: 0, openings: true },
  degraded: { visibility: 0.5, storm: 220, fuel: -0.08, openings: false },
  scramble: { visibility: 0.38, storm: 240, fuel: -0.12, openings: false },
};

export const DECK_KNOWN = 260;
export const DECK_BLIND = 230;
export const DECK_DEGRADED = 320;
/** Clearance kept between a ring's top and the cloud deck. */
const DECK_MARGIN = 45;
const WORLD = 1100;

export interface ExitInput {
  board: BoardState;
  def: ControlDef;
  result: Pick<ControlResult, 'rank' | 'tier' | 'total'>;
  fuel: number;
  fuelMax: number;
  /** Typical speed home (m/s), to make sure the fuel covers the route. */
  cruise: number;
  ground: (x: number, z: number) => number;
}

type Spec = RingSpec & { at: number };

/** Distance along a polyline to the point nearest (x, z). */
function along(path: readonly { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  let at = 0;
  let run = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (len * len)));
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best) {
      best = d;
      at = run + t * len;
    }
    run += len;
  }
  return at;
}

const clampW = (v: number) => Math.max(-WORLD, Math.min(WORLD, v));

/**
 * A known storm: the plan bends around it. Rings inside its reach are
 * dropped and one ring is laid abeam the cell, on the side away from the
 * other corridors.
 */
function detour(specs: Spec[], corridor: CorridorDef, cell: { id: string; x: number; z: number }, r: number, away: { x: number; z: number }, at: number): Spec[] {
  const kept = specs.filter((s) => s.bonus || s === specs[specs.length - 1] || Math.hypot(s.x - cell.x, s.z - cell.z) >= r + 50);
  const path = corridor.rings;
  const i = Math.max(0, path.findIndex((p) => along(path, p.x, p.z) > at) - 1);
  const a = path[i];
  const b = path[Math.min(path.length - 1, i + 1)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  let nx = -(b.z - a.z) / len;
  let nz = (b.x - a.x) / len;
  if (nx * (cell.x - away.x) + nz * (cell.z - away.z) < 0) {
    nx = -nx;
    nz = -nz;
  }
  const off = r + 110;
  kept.push({ kind: 'ring', id: `dt-${cell.id}`, x: clampW(cell.x + nx * off), z: clampW(cell.z + nz * off), agl: 90, r: 36, cue: 'AROUND THE STORM', at });
  return kept.sort((p, q) => p.at - q.at);
}

export function buildExit(inp: ExitInput): ExitProfile {
  const { board: b, def, result } = inp;
  const tier = result.tier;
  const T = TIER[tier];
  const corridor = def.corridors.find((c) => c.id === b.corridor) ?? def.corridors.find((c) => c.id === 'centre') ?? def.corridors[0];
  const path = corridor.rings;
  const at = (x: number, z: number) => along(path, x, z);
  const shortcut = tier === 'optimal' && !!corridor.shortcut;
  let specs: Spec[] = path.filter((r) => !(shortcut && r.id === corridor.shortcut)).map((r) => ({ ...r, at: at(r.x, r.z) }));

  const others = def.corridors.filter((c) => c !== corridor).flatMap((c) => c.cells);
  const away = others.length ? { x: others.reduce((t, c) => t + c.x, 0) / others.length, z: others.reduce((t, c) => t + c.z, 0) / others.length } : { x: 0, z: 0 };

  const hazards: HazardDef[] = [];
  const opportunities: Opportunity[] = [];
  let contactFromStart = false;
  let alertAt: number | null = null;
  let deck: number | null = null;
  let stormKnown = 0;
  let stormBlind = 0;
  let radar: 'known' | 'blind' | null = null;

  for (const cell of corridor.cells) {
    const st = b.cells[cell.id];
    const known = isKnown(st);
    const cAt = at(cell.x, cell.z);
    switch (st.truth) {
      case 'storm':
        hazards.push({ kind: 'storm', id: `storm-${cell.id}`, label: 'STORM CELL', x: cell.x, z: cell.z, r: T.storm });
        if (known) {
          specs = detour(specs, corridor, cell, T.storm, away, cAt);
          stormKnown++;
        } else stormBlind++;
        break;
      case 'cloud':
        deck = Math.min(deck ?? Infinity, known ? DECK_KNOWN : DECK_BLIND);
        break;
      case 'radar':
        if (known) {
          alertAt = alertAt === null ? cAt : Math.min(alertAt, cAt);
          radar = 'known';
        } else {
          contactFromStart = true;
          radar = 'blind';
        }
        break;
      case 'cache':
        if (known && T.openings) {
          specs.push({ kind: 'ring', id: `bonus-${cell.id}`, x: cell.x, z: cell.z, agl: 45, r: 34, cue: 'SUPPLY CACHE · PHOTO PASS', bonus: true, at: cAt });
          opportunities.push({ ringId: `bonus-${cell.id}`, kind: 'cache', label: 'SUPPLY CACHE' });
        }
        break;
      case 'clear':
        break;
    }
  }
  if (b.shadowed && T.openings) {
    specs.push({ kind: 'ring', id: 'bonus-barge', x: def.landing.x, z: def.landing.z, agl: 40, r: 36, cue: 'BARGE · PHOTO PASS', bonus: true, at: -1 });
    opportunities.unshift({ ringId: 'bonus-barge', kind: 'barge', label: 'BARGE PASS' });
  }
  specs.sort((p, q) => p.at - q.at);

  // ---- the tier
  if (tier === 'degraded') {
    deck = deck ?? DECK_DEGRADED;
    if (!contactFromStart && alertAt === null) alertAt = specs[Math.floor(specs.length / 2)].at - 1;
  }
  if (tier === 'scramble') {
    contactFromStart = true;
    deck = Math.min(deck ?? 300, 300);
    // break low: the first two rings are taken at treetop height
    specs.filter((s) => !s.bonus).slice(0, 2).forEach((s) => Object.assign(s, { agl: 40, cue: 'BREAK LOW' }));
    // the front, on your tail at the sector edge
    const f = specs.find((s) => !s.bonus)!;
    const dx = f.x - away.x;
    const dz = f.z - away.z;
    const l = Math.hypot(dx, dz) || 1;
    hazards.push({ kind: 'storm', id: 'front', label: 'THE FRONT', x: clampW(f.x + (dx / l) * 330), z: clampW(f.z + (dz / l) * 330), r: 210 });
  }
  if (alertAt !== null && !contactFromStart) {
    const ring = specs.find((s) => !s.bonus && s.at >= alertAt!) ?? specs[specs.length - 1];
    ring.alert = true;
  }

  // ---- other storms on the board, where they do not touch this route
  for (const c of def.corridors.filter((x) => x !== corridor)) {
    for (const cell of c.cells) {
      if (b.cells[cell.id].truth !== 'storm') continue;
      if (specs.every((s) => Math.hypot(s.x - cell.x, s.z - cell.z) > T.storm + 90)) hazards.push({ kind: 'storm', id: `storm-${cell.id}`, label: 'STORM CELL', x: cell.x, z: cell.z, r: T.storm });
    }
  }

  // ---- the cloud deck: every ring stays flyable underneath it
  if (deck !== null) {
    const highest = Math.max(...specs.map((s) => inp.ground(s.x, s.z)));
    deck = Math.max(deck, Math.ceil(highest + 30 + DECK_MARGIN));
    for (const s of specs) s.agl = Math.max(30, Math.min(s.agl, deck - inp.ground(s.x, s.z) - DECK_MARGIN));
    hazards.push({ kind: 'ceiling', id: 'deck', label: 'CLOUD DECK', y: deck });
  }

  // ---- fuel: the tier moves it, but never below what the route needs
  let len = 0;
  for (let i = 1; i < specs.length; i++) len += Math.hypot(specs[i].x - specs[i - 1].x, specs[i].z - specs[i - 1].z);
  const need = ((len + 600) / inp.cruise) * 1.5 + 25;
  const fuelSeconds = Math.round(Math.min(inp.fuelMax, Math.max(need, inp.fuel + T.fuel * inp.fuelMax)));

  const notices: string[] = [];
  if (deck !== null) notices.push(`CLOUDS AT ${deck} m · STAY BELOW`);
  if (stormBlind) notices.push('STORM ON THE ROUTE');
  if (stormKnown) notices.push('ROUTED AROUND THE STORM');
  if (contactFromStart) notices.push('RADAR CONTACT · RINGS CLOSING');
  if (tier === 'scramble') notices.push('BREAK LOW');
  if (opportunities.length) notices.push(`OPPORTUNITY: ${opportunities.map((o) => o.label).join(' · ')}`);

  const ringSpecs: RingSpec[] = specs.map(({ at: _at, ...s }) => s);
  const leg: ReturnLeg = {
    id: 'return',
    title: 'GET OUT',
    gates: [...ringSpecs, { kind: 'land', id: 'land', label: 'LANDING', objective: 'LAND AT BASE', detail: 'LOW OVER THE RUNWAY' }],
    hazards,
    visibility: T.visibility,
    notices,
  };

  const routeKnown = corridor.cells.filter((c) => isKnown(b.cells[c.id])).length;
  const frac = fuelSeconds / inp.fuelMax;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
  const lines: ExitLine[] = [
    {
      label: 'DEPARTURE',
      value: { optimal: shortcut ? 'DIRECT · SHORTCUT CLEARED' : 'DIRECT', standard: 'AS PLANNED', degraded: 'RESTRICTED · UNDER THE DECK', scramble: 'EMERGENCY · BREAK LOW' }[tier],
      tone: tier === 'optimal' ? 'good' : tier === 'standard' ? '' : 'bad',
    },
    { label: 'ROUTE', value: corridor.label, tone: '' },
    {
      label: 'WEATHER',
      value: stormBlind ? 'STORM ON ROUTE · UNPLANNED' : stormKnown ? 'STORM · ROUTED AROUND' : deck !== null ? `LOW CLOUD · ${deck} m` : T.visibility >= 0.9 ? 'CLEAR' : T.visibility >= 0.65 ? 'FAIR' : 'DETERIORATING',
      tone: stormBlind || (deck !== null && tier !== 'standard') || T.visibility < 0.65 ? 'bad' : T.visibility >= 0.9 && !stormKnown && deck === null ? 'good' : '',
    },
    { label: 'FUEL', value: `${frac >= 0.6 ? 'EXCELLENT' : frac >= 0.4 ? 'GOOD' : frac >= 0.25 ? 'LIMITED' : 'CRITICAL'} · ${mmss(fuelSeconds)}`, tone: frac >= 0.6 ? 'good' : frac < 0.4 ? 'bad' : '' },
    { label: 'TRAFFIC', value: contactFromStart ? (radar === 'blind' ? 'HEAVY · THEY WERE WAITING' : 'HEAVY · RADAR LOCK') : alertAt !== null ? (radar === 'known' ? 'RADAR SITE · CONTACT LATE' : 'PATROLS · CONTACT MID-ROUTE') : 'LIGHT', tone: contactFromStart ? 'bad' : alertAt === null ? 'good' : '' },
    { label: 'INTEL', value: routeKnown === corridor.cells.length ? 'HIGH' : routeKnown ? 'PARTIAL' : 'BLIND', tone: routeKnown === corridor.cells.length ? 'good' : routeKnown ? '' : 'bad' },
    {
      label: 'OPPORTUNITY',
      value: [...opportunities.map((o) => o.label), shortcut ? 'SHORTCUT' : ''].filter(Boolean).join(' · ') || (T.openings ? 'NONE DETECTED' : 'NONE · NO TIME'),
      tone: opportunities.length || shortcut ? 'good' : '',
    },
  ];
  if (tier === 'scramble') lines.push({ label: 'THREAT', value: 'THE FRONT IS ON YOUR TAIL', tone: 'bad' });
  return { tier, rank: result.rank, score: result.total, corridor, leg, contactFromStart, fuelSeconds, opportunities, shortcut, lines };
}
