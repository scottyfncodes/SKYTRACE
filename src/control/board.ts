/**
 * MISSION CONTROL: the board game between the two flights.
 *
 * On station the crew has a few minutes before the weather front arrives.
 * The board shows what the radar already knows (where every vehicle is and
 * whether it moves) and three ways home, each with two unknown stretches.
 * Assets cost minutes and some are limited; each answers a different
 * question, some only partly, and the tower's forecast is not always right.
 *
 *   discover (spend minutes and assets) → decide (mark the truck, pick a
 *   corridor) → EXECUTE → score → Exit Profile (`exit.ts`) → fly out
 *
 * Pure and deterministic given a random source, so every rule is tested.
 * New assets, cell types and scoring lines slot into the tables below.
 */
import type { ReturnDef, ReturnId } from '../mission/mission01';
import type { EquipmentId } from '../operation/catalog';
import type { RingSpec } from '../operation/gates';

// ------------------------------------------------------------------ cells & corridors

/** What an unknown stretch of a corridor really holds. */
export type CellTruth = 'clear' | 'storm' | 'cloud' | 'radar' | 'cache';
export const CELL_TRUTHS: readonly CellTruth[] = ['clear', 'storm', 'cloud', 'radar', 'cache'];
const WEATHER: readonly CellTruth[] = ['storm', 'cloud'];

export const CELL_LABEL: Record<CellTruth, string> = { clear: 'CLEAR', storm: 'STORM CELL', cloud: 'LOW CLOUD', radar: 'RADAR SITE', cache: 'SUPPLY CACHE' };

export interface CellDef {
  id: string;
  x: number;
  z: number;
}

export interface CorridorDef {
  id: string;
  /** "NORTH RIDGE" */
  label: string;
  /** "N" */
  short: string;
  /** One line for the plan: what kind of flight it is. */
  note: string;
  /** Rings from the sector to the runway approach (the landing gate is added). */
  rings: readonly RingSpec[];
  /** A ring an OPTIMAL exit is cleared to skip. */
  shortcut?: string;
  cells: readonly CellDef[];
}

// ------------------------------------------------------------------ assets

export type AssetId = 'optical' | 'thermal' | 'sigint' | 'drone' | 'scouts' | 'shadow';
export type TargetKind = 'return' | 'cell' | 'none';

export interface AssetDef {
  id: AssetId;
  label: string;
  /** Short glyph for the tray. */
  icon: string;
  /** Minutes off the clock. */
  cost: number;
  target: TargetKind;
  /** Only with this sensor fitted. */
  needs?: EquipmentId;
  /** What it tells you, in a few words. */
  note: string;
  /** How long the action plays on the board (seconds). */
  seconds: number;
}

export const ASSETS: Record<AssetId, AssetDef> = {
  optical: { id: 'optical', label: 'OPTICAL', icon: '◉', cost: 2, target: 'return', needs: 'optical', note: 'Size · count · road', seconds: 1.5 },
  thermal: { id: 'thermal', label: 'THERMAL', icon: '◍', cost: 2, target: 'return', needs: 'thermal', note: 'Size · count · engine heat', seconds: 1.5 },
  sigint: { id: 'sigint', label: 'SIGINT', icon: '≋', cost: 1, target: 'none', needs: 'sigint', note: 'Every radio · every radar site', seconds: 1.1 },
  drone: { id: 'drone', label: 'DRONE', icon: '✈', cost: 1, target: 'cell', note: 'The whole truth about one spot', seconds: 1.2 },
  scouts: { id: 'scouts', label: 'SCOUTS', icon: '⌂', cost: 1, target: 'cell', note: 'Ground report: weather only', seconds: 1.0 },
  shadow: { id: 'shadow', label: 'SHADOW', icon: '➜', cost: 3, target: 'return', note: 'Follow the truck: where is it going?', seconds: 1.8 },
};
/** Tray order. */
export const ASSET_ORDER: readonly AssetId[] = ['optical', 'thermal', 'sigint', 'drone', 'scouts', 'shadow'];

/** What one mission's board is made of. */
export interface ControlDef {
  /** Minutes on the board before the front arrives. */
  minutes: number;
  /** Fraction of a full tank one board minute burns (the autopilot keeps orbiting). */
  fuelPerMinute: number;
  corridors: readonly CorridorDef[];
  /** Limited assets (sensors from the loadout are unlimited, paid in minutes). */
  limited: Partial<Record<AssetId, number>>;
  /** The mix of truths dealt across all cells. */
  cellMix: readonly CellTruth[];
  /** Where the shadowed truck leads (the barge). */
  landing: { x: number; z: number; label: string };
  /** The brief's clues, in order. */
  clues: readonly string[];
}

// ------------------------------------------------------------------ state

export interface ReturnKnowledge {
  size: boolean;
  road: boolean;
  radio: boolean;
  engine: boolean;
  /** Best look at it (sets the quality of the evidence photo). */
  look: 'optical' | 'thermal' | 'drone' | null;
}

export interface CellState {
  truth: CellTruth;
  /** What it could still be, given everything learned. One left = known. */
  possible: CellTruth[];
  /** The tower's forecast (weather only; not always right). */
  forecast: CellTruth;
}

export interface BoardState {
  minutes: number;
  maxMinutes: number;
  /** Remaining uses of limited assets. */
  uses: Partial<Record<AssetId, number>>;
  /** Sensors fitted. */
  sensors: EquipmentId[];
  returns: Partial<Record<ReturnId, ReturnKnowledge>>;
  cells: Record<string, CellState>;
  marked: ReturnId | null;
  wrong: ReturnId[];
  shadowed: boolean;
  corridor: string | null;
  /** The clock ran out before EXECUTE. */
  frontCaught: boolean;
  executed: boolean;
  actions: number;
}

export type Target = { kind: 'return'; id: ReturnId } | { kind: 'cell'; id: string } | { kind: 'none' };

export interface BoardEvent {
  type: 'reveal' | 'contradiction' | 'ruled-out' | 'locked' | 'wrong' | 'barge' | 'opportunity' | 'front' | 'nothing';
  title: string;
  text: string;
  target?: Target;
}

const shuffle = <T>(a: T[], rand: () => number): T[] => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const allCells = (def: ControlDef) => def.corridors.flatMap((c) => c.cells.map((cell) => ({ ...cell, corridor: c.id })));
export const corridorOf = (def: ControlDef, cellId: string) => def.corridors.find((c) => c.cells.some((x) => x.id === cellId))!;

/**
 * A fresh board: the cell truths are dealt at random, and the tower gets
 * one storm wrong (it reports it over a different stretch and calls the
 * real one clear).
 */
export function newBoard(def: ControlDef, cast: readonly ReturnDef[], sensors: readonly EquipmentId[], rand: () => number): BoardState {
  const cells = allCells(def);
  const deal = shuffle([...def.cellMix], rand);
  const state: Record<string, CellState> = {};
  cells.forEach((c, i) => {
    const truth = deal[i % deal.length];
    state[c.id] = { truth, possible: [...CELL_TRUTHS], forecast: WEATHER.includes(truth) ? truth : 'clear' };
  });
  // the stale forecast: one storm misplaced onto a stretch of another corridor
  const storms = cells.filter((c) => state[c.id].truth === 'storm');
  if (storms.length) {
    const s = storms[Math.floor(rand() * storms.length)];
    const away = cells.filter((c) => c.corridor !== s.corridor && state[c.id].forecast === 'clear');
    if (away.length) {
      const o = away[Math.floor(rand() * away.length)];
      state[s.id].forecast = 'clear';
      state[o.id].forecast = 'storm';
    }
  }
  const uses: Partial<Record<AssetId, number>> = { ...def.limited };
  const returns: Partial<Record<ReturnId, ReturnKnowledge>> = {};
  for (const r of cast) returns[r.id] = { size: false, road: false, radio: false, engine: false, look: null };
  return { minutes: def.minutes, maxMinutes: def.minutes, uses, sensors: [...sensors], returns, cells: state, marked: null, wrong: [], shadowed: false, corridor: null, frontCaught: false, executed: false, actions: 0 };
}

// ------------------------------------------------------------------ the brief's clues

export type Check = 'yes' | 'no' | '?';

export interface ClueCheck {
  clue: string;
  check: Check;
}

/** Is a vehicle in the sector? Its whole road is, or none of it. */
export type SectorTest = (r: ReturnDef) => boolean;

/** The brief's clues against what is known about one return. */
export function clueChecks(r: ReturnDef, k: ReturnKnowledge, inSector: boolean, clues: readonly string[]): ClueCheck[] {
  const yn = (known: boolean, ok: boolean): Check => (known ? (ok ? 'yes' : 'no') : '?');
  const large = r.kind !== 'vessel' && r.size === 'large' && r.count === 1;
  return clues.map((clue) => {
    switch (clue) {
      case 'LARGE':
        return { clue, check: yn(k.size, large) };
      case 'MOVING':
        return { clue, check: yn(true, r.moving) };
      case 'ON A ROAD':
        return { clue, check: yn(k.road, r.onRoad && r.kind !== 'vessel') };
      case 'RADIO DEAD':
        return { clue, check: yn(k.radio, !r.radio) };
      case 'IN SECTOR 7':
        return { clue, check: yn(true, inSector) };
      default:
        return { clue, check: '?' };
    }
  });
}

export function ruledOut(checks: readonly ClueCheck[]): boolean {
  return checks.some((c) => c.check === 'no');
}

/** The facts a return shows on the board. */
export function traits(r: ReturnDef, k: ReturnKnowledge, inSector: boolean): string[] {
  const out: string[] = [];
  out.push(k.size ? (r.kind === 'vessel' ? 'BOAT' : r.count > 1 ? `${r.count} SMALL` : r.size === 'large' ? 'LARGE' : 'SMALL') : 'SIZE ?');
  out.push(r.moving ? 'MOVING' : 'PARKED');
  if (k.road) out.push(r.kind === 'vessel' ? 'RIVER' : r.onRoad ? 'ON ROAD' : 'OFF ROAD');
  if (k.engine) out.push(r.engine === 'running' ? 'ENGINE ON' : 'ENGINE COLD');
  if (k.radio) out.push(r.radio ? 'RADIO ON' : 'RADIO DEAD');
  out.push(inSector ? 'SECTOR 7' : 'OUT OF SECTOR');
  return out;
}

// ------------------------------------------------------------------ actions

export function isKnown(c: CellState): boolean {
  return c.possible.length === 1;
}

/** What the player believes a cell is: the truth once known, else null. */
export function belief(c: CellState): CellTruth | null {
  return isKnown(c) ? c.possible[0] : null;
}

/** Is this asset part of this operation (fitted sensor, or a crew asset the mission provides)? */
export function assetFitted(b: BoardState, id: AssetId): boolean {
  const a = ASSETS[id];
  if (a.needs) return b.sensors.includes(a.needs);
  return id === 'shadow' || id in b.uses;
}

/** Can this asset be used on this target now? `reason` explains a refusal in a few words. */
export function canUse(b: BoardState, cast: readonly ReturnDef[], id: AssetId, t: Target): { ok: boolean; reason: string } {
  const a = ASSETS[id];
  if (b.executed) return { ok: false, reason: 'PLAN EXECUTED' };
  if (!assetFitted(b, id)) return { ok: false, reason: 'NOT FITTED' };
  if (id in b.uses && (b.uses[id] ?? 0) <= 0) return { ok: false, reason: 'NONE LEFT' };
  if (a.cost > b.minutes) return { ok: false, reason: 'NO TIME' };
  if (a.target !== t.kind && !(id === 'drone' && t.kind === 'return')) return { ok: false, reason: a.target === 'cell' ? 'PICK A ROUTE SPOT' : a.target === 'return' ? 'PICK A VEHICLE' : '' };
  if (t.kind === 'return') {
    const k = b.returns[t.id];
    const def = cast.find((r) => r.id === t.id);
    if (!k || !def || (def.hidden && !b.shadowed)) return { ok: false, reason: 'NOT ON THE BOARD' };
    if (id === 'shadow') {
      if (b.shadowed) return { ok: false, reason: 'ALREADY SHADOWED' };
      if (b.marked !== t.id) return { ok: false, reason: 'MARK THE TRUCK FIRST' };
      return { ok: true, reason: '' };
    }
    const learns = id === 'optical' ? !k.size || !k.road : id === 'thermal' ? !k.size || !k.engine : !k.size || !k.road || !k.radio || !k.engine;
    if (!learns) return { ok: false, reason: 'NOTHING NEW' };
  }
  if (t.kind === 'cell') {
    const c = b.cells[t.id];
    if (!c) return { ok: false, reason: '' };
    if (isKnown(c)) return { ok: false, reason: 'ALREADY KNOWN' };
    if (id === 'scouts' && !c.possible.some((p) => WEATHER.includes(p))) return { ok: false, reason: 'NO WEATHER THERE' };
  }
  if (id === 'sigint' && !Object.values(b.returns).some((k) => k && !k.radio) && !Object.values(b.cells).some((c) => c.possible.length > 1 && c.possible.includes('radar'))) return { ok: false, reason: 'NOTHING NEW' };
  return { ok: true, reason: '' };
}

function spend(b: BoardState, id: AssetId): BoardEvent[] {
  const a = ASSETS[id];
  b.minutes = Math.max(0, b.minutes - a.cost);
  if (id in b.uses) b.uses[id] = (b.uses[id] ?? 0) - 1;
  b.actions += 1;
  return frontCheck(b);
}

function frontCheck(b: BoardState): BoardEvent[] {
  if (b.minutes > 0 || b.frontCaught) return [];
  b.frontCaught = true;
  return [{ type: 'front', title: 'THE FRONT IS HERE', text: 'NO TIME LEFT · EXECUTING NOW' }];
}

function narrow(c: CellState, keep: (t: CellTruth) => boolean): void {
  c.possible = c.possible.filter(keep);
}

function revealCell(b: BoardState, cellId: string, events: BoardEvent[], before: boolean): void {
  const c = b.cells[cellId];
  if (!isKnown(c) || before) return;
  const t = c.possible[0];
  const target: Target = { kind: 'cell', id: cellId };
  events.push({ type: t === 'cache' ? 'opportunity' : 'reveal', title: CELL_LABEL[t], text: t === 'cache' ? 'AN OPPORTUNITY ON THIS ROUTE' : t === 'clear' ? 'NOTHING IN THE WAY' : 'ON THIS ROUTE', target });
  if (WEATHER.includes(c.forecast) !== WEATHER.includes(t) || (WEATHER.includes(t) && c.forecast !== t)) events.push({ type: 'contradiction', title: 'TOWER WAS WRONG', text: `FORECAST SAID ${CELL_LABEL[c.forecast]}`, target });
}

/** Spend an asset on a target. Returns what was learned. */
export function useAsset(b: BoardState, cast: readonly ReturnDef[], sector: SectorTest, clues: readonly string[], id: AssetId, t: Target): BoardEvent[] {
  if (!canUse(b, cast, id, t).ok) return [];
  const events: BoardEvent[] = [];
  if (t.kind === 'return') {
    const k = b.returns[t.id]!;
    const def = cast.find((r) => r.id === t.id)!;
    const wasOut = ruledOut(clueChecks(def, k, sector(def), clues));
    if (id === 'shadow') {
      b.shadowed = true;
      events.push({ type: 'barge', title: 'A BARGE!', text: 'THE TRUCK IS HEADING FOR THE RIVER LANDING', target: t });
    } else {
      if (id === 'optical' || id === 'drone') k.road = true;
      if (id === 'thermal' || id === 'drone') k.engine = true;
      if (id === 'drone') k.radio = true;
      k.size = true;
      const rank = { drone: 2, thermal: 1, optical: 3 } as const;
      if (!k.look || rank[id as keyof typeof rank] > rank[k.look]) k.look = id as ReturnKnowledge['look'];
      events.push({ type: 'reveal', title: `RETURN ${t.id}`, text: traits(def, k, sector(def)).slice(0, 3).join(' · '), target: t });
      const out = ruledOut(clueChecks(def, k, sector(def), clues));
      if (out && !wasOut) events.push({ type: 'ruled-out', title: `NOT ${t.id}`, text: 'IT BREAKS THE BRIEF', target: t });
    }
  } else if (t.kind === 'cell') {
    const c = b.cells[t.id];
    const before = isKnown(c);
    if (id === 'drone') narrow(c, (p) => p === c.truth);
    else if (id === 'scouts') {
      if (WEATHER.includes(c.truth)) narrow(c, (p) => p === c.truth);
      else {
        narrow(c, (p) => !WEATHER.includes(p));
        if (!isKnown(c)) events.push({ type: 'nothing', title: 'SCOUTS', text: 'NO WEATHER · CAN\'T SEE MORE FROM THE GROUND', target: t });
      }
    }
    revealCell(b, t.id, events, before);
  } else if (id === 'sigint') {
    for (const [rid, k] of Object.entries(b.returns)) {
      const def = cast.find((r) => r.id === rid)!;
      if (!k || (def.hidden && !b.shadowed) || k.radio) continue;
      const wasOut = ruledOut(clueChecks(def, k, sector(def), clues));
      k.radio = true;
      if (!wasOut && ruledOut(clueChecks(def, k, sector(def), clues))) events.push({ type: 'ruled-out', title: `NOT ${rid}`, text: 'IT IS TRANSMITTING', target: { kind: 'return', id: rid as ReturnId } });
    }
    let sites = 0;
    for (const [cid, c] of Object.entries(b.cells)) {
      const before = isKnown(c);
      if (c.truth === 'radar') {
        narrow(c, (p) => p === 'radar');
        sites++;
      } else narrow(c, (p) => p !== 'radar');
      revealCell(b, cid, events, before);
    }
    events.unshift({ type: 'reveal', title: 'SIGINT', text: `RADIOS LOGGED · ${sites} RADAR SITE${sites === 1 ? '' : 'S'}` });
  }
  events.push(...spend(b, id));
  return events;
}

/** MARK a return as the truck. A wrong call costs a minute and points. */
export function mark(b: BoardState, cast: readonly ReturnDef[], id: ReturnId): BoardEvent[] {
  if (b.executed || b.marked || b.wrong.includes(id)) return [];
  const def = cast.find((r) => r.id === id);
  if (!def || (def.hidden && !b.shadowed)) return [];
  if (def.isTarget) {
    b.marked = id;
    return [{ type: 'locked', title: 'TARGET LOCKED', text: `RETURN ${id} · THE SUPPLY TRUCK`, target: { kind: 'return', id } }];
  }
  b.wrong.push(id);
  b.minutes = Math.max(0, b.minutes - 1);
  return [{ type: 'wrong', title: 'NEGATIVE', text: `RETURN ${id} IS NOT THE TRUCK · −1 MIN`, target: { kind: 'return', id } }, ...frontCheck(b)];
}

export function chooseCorridor(b: BoardState, def: ControlDef, id: string): void {
  if (b.executed || !def.corridors.some((c) => c.id === id)) return;
  b.corridor = id;
}

// ------------------------------------------------------------------ score

export type Rank = 'ACE' | 'SOLID' | 'ROUGH' | 'SCRAMBLE';
export type ExitTier = 'optimal' | 'standard' | 'degraded' | 'scramble';
export const TIER_OF: Record<Rank, ExitTier> = { ACE: 'optimal', SOLID: 'standard', ROUGH: 'degraded', SCRAMBLE: 'scramble' };
export const RANK_FLOOR: Record<Rank, number> = { ACE: 5600, SOLID: 4000, ROUGH: 2200, SCRAMBLE: 0 };

export interface ScoreLine {
  id: 'objective' | 'intel' | 'efficiency' | 'risk' | 'bonus' | 'losses';
  label: string;
  points: number;
  detail: string;
}

export interface ControlResult {
  lines: ScoreLine[];
  total: number;
  rank: Rank;
  tier: ExitTier;
  /** The truck was identified on evidence, not a hunch. */
  confirmed: boolean;
}

export const POINTS = {
  truck: 3000,
  confirmed: 500,
  explained: 150,
  cellKnown: 100,
  routeKnown: 200,
  minute: 120,
  shadow: 700,
  cacheOnRoute: 500,
  wrong: 700,
  front: 800,
} as const;

/** How a corridor stretch weighs on the plan: known good news, known trouble, or a blind spot. */
export function cellRisk(c: CellState): number {
  const k = belief(c);
  if (k) return { clear: 350, cache: 350, cloud: 100, radar: -100, storm: -250 }[k];
  if (c.possible.includes('storm')) return -600;
  if (c.possible.includes('radar')) return -300;
  return -150;
}

function rankFor(total: number): Rank {
  return (['ACE', 'SOLID', 'ROUGH'] as const).find((r) => total >= RANK_FLOOR[r]) ?? 'SCRAMBLE';
}

/** Score the board as it stands (the live forecast uses the same numbers as EXECUTE). */
export function scoreBoard(b: BoardState, def: ControlDef, cast: readonly ReturnDef[], sector: SectorTest): ControlResult {
  const visible = cast.filter((r) => !r.hidden);
  const truck = cast.find((r) => r.isTarget)!;
  const decoysOut = visible.filter((r) => !r.isTarget).every((r) => ruledOut(clueChecks(r, b.returns[r.id]!, sector(r), def.clues)) || b.wrong.includes(r.id));
  const tk = b.returns[truck.id]!;
  const confirmed = b.marked === truck.id && (decoysOut || (tk.size && tk.road));
  const objective = b.marked ? POINTS.truck + (confirmed ? POINTS.confirmed : 0) : 0;

  const explained = visible.filter((r) => (r.isTarget ? confirmed : ruledOut(clueChecks(r, b.returns[r.id]!, sector(r), def.clues)))).length;
  const route = def.corridors.find((c) => c.id === b.corridor);
  const known = Object.entries(b.cells).filter(([, c]) => isKnown(c));
  const onRoute = route ? known.filter(([id]) => route.cells.some((c) => c.id === id)).length : 0;
  const intel = explained * POINTS.explained + known.length * POINTS.cellKnown + onRoute * POINTS.routeKnown;

  const efficiency = b.frontCaught ? 0 : b.minutes * POINTS.minute;
  const risk = route ? route.cells.reduce((t, c) => t + cellRisk(b.cells[c.id]), 0) : -1200;
  const cache = route ? route.cells.some((c) => belief(b.cells[c.id]) === 'cache') : false;
  const bonus = (b.shadowed ? POINTS.shadow : 0) + (cache ? POINTS.cacheOnRoute : 0);
  const losses = -(b.wrong.length * POINTS.wrong + (b.frontCaught ? POINTS.front : 0));

  const lines: ScoreLine[] = [
    { id: 'objective', label: 'OBJECTIVE', points: objective, detail: !b.marked ? 'TRUCK NOT FOUND' : confirmed ? 'TRUCK · CONFIRMED' : 'TRUCK · ON A HUNCH' },
    { id: 'intel', label: 'INTELLIGENCE', points: intel, detail: `${explained}/${visible.length} VEHICLES · ${known.length}/${Object.keys(b.cells).length} ROUTE SPOTS` },
    { id: 'efficiency', label: 'EFFICIENCY', points: efficiency, detail: b.frontCaught ? 'CAUGHT BY THE FRONT' : `${b.minutes} MIN TO SPARE` },
    { id: 'risk', label: 'RISK', points: risk, detail: route ? riskWord(route, b) : 'NO ROUTE PLANNED' },
    { id: 'bonus', label: 'BONUS', points: bonus, detail: [b.shadowed && 'BARGE FOUND', cache && 'CACHE ON ROUTE'].filter(Boolean).join(' · ') || 'NONE' },
    { id: 'losses', label: 'LOSSES', points: losses, detail: [b.wrong.length && `${b.wrong.length} WRONG MARK${b.wrong.length > 1 ? 'S' : ''}`, b.frontCaught && 'NO TIME LEFT'].filter(Boolean).join(' · ') || 'NONE' },
  ];
  const total = Math.max(0, lines.reduce((t, l) => t + l.points, 0));
  let rank = rankFor(total);
  // no truck, or caught by the front: the plan cannot be better than ROUGH
  if ((!b.marked || b.frontCaught) && (rank === 'ACE' || rank === 'SOLID')) rank = 'ROUGH';
  return { lines, total, rank, tier: TIER_OF[rank], confirmed };
}

function riskWord(route: CorridorDef, b: BoardState): string {
  const cells = route.cells.map((c) => b.cells[c.id]);
  const blind = cells.filter((c) => !isKnown(c)).length;
  if (blind) return `${blind} BLIND SPOT${blind > 1 ? 'S' : ''} ON ${route.short}`;
  if (cells.some((c) => c.truth === 'storm')) return 'KNOWN STORM · ROUTED AROUND';
  return `${route.label} · FULLY SCOUTED`;
}
