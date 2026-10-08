/**
 * MISSION CONTROL: the board game between the two flights.
 *
 * On station the crew has a clock, in real seconds, before the weather
 * front arrives. The board shows what the radar already knows (where every
 * vehicle is and whether it moves) and three ways home, each with two
 * unknown stretches. Every look takes seconds off that clock while it plays
 * (so does thinking), some assets are limited, each answers a different
 * question, some only partly, and the tower's forecast is not always right.
 * The clock is the pressure: what is left on it when the plan is locked is
 * scored, and it sets how fast the first ring home closes.
 *
 *   discover (spend seconds and assets) → decide (mark the truck, pick a
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
const GROUND: readonly CellTruth[] = ['radar', 'cache'];

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

export type AssetId = 'optical' | 'thermal' | 'listen' | 'sigint' | 'drone' | 'scouts' | 'shadow';
export type TargetKind = 'return' | 'cell' | 'none';

export interface AssetDef {
  id: AssetId;
  label: string;
  /** Short glyph for the tray. */
  icon: string;
  /** Seconds the action takes: it plays out for this long, and the clock runs. */
  cost: number;
  target: TargetKind;
  /** Only with this sensor fitted. */
  needs?: EquipmentId;
  /** What it tells you, in a few words. */
  note: string;
}

export const ASSETS: Record<AssetId, AssetDef> = {
  optical: { id: 'optical', label: 'OPTICAL', icon: '◉', cost: 6, target: 'return', needs: 'optical', note: 'Size · count · road' },
  thermal: { id: 'thermal', label: 'THERMAL', icon: '◍', cost: 6, target: 'return', needs: 'thermal', note: 'Size · count · engine heat' },
  sigint: { id: 'sigint', label: 'SIGINT', icon: '≋', cost: 5, target: 'none', needs: 'sigint', note: 'Every radio · every radar site' },
  listen: { id: 'listen', label: 'LISTEN', icon: '◌', cost: 4, target: 'return', note: 'One vehicle: is its radio on?' },
  drone: { id: 'drone', label: 'DRONE', icon: '✈', cost: 7, target: 'cell', note: 'A low pass: radar site or supply cache?' },
  scouts: { id: 'scouts', label: 'SCOUTS', icon: '⌂', cost: 5, target: 'cell', note: 'A ground report: storm or low cloud?' },
  shadow: { id: 'shadow', label: 'SHADOW', icon: '➜', cost: 8, target: 'return', note: 'Follow the truck: where is it going?' },
};

/** A wrong mark costs this many seconds. */
export const WRONG_MARK_SECONDS = 8;
/** Tray order. */
export const ASSET_ORDER: readonly AssetId[] = ['optical', 'thermal', 'listen', 'sigint', 'drone', 'scouts', 'shadow'];

/**
 * What each look at a vehicle answers. No two answer the same set of
 * questions: the camera sees the shape and the road, the thermal imager the
 * shape and the engine, and LISTEN only the radio. The drone is for route
 * spots, never vehicles.
 */
export const VEHICLE_LOOKS = { optical: ['size', 'road'], thermal: ['size', 'engine'], listen: ['radio'] } as const satisfies Partial<Record<AssetId, readonly (keyof Omit<ReturnKnowledge, 'look'>)[]>>;

/** The button on a vehicle's card: what the look answers, not what it is. */
export const LOOK_LABEL = { optical: 'LOOK · SIZE + ROAD', thermal: 'HEAT · SIZE + ENGINE', listen: 'LISTEN · RADIO' } as const;

/**
 * What each look at a route spot answers, and again no two answer the same
 * thing: the scouts on the ground see the weather (a storm, low cloud), the
 * drone's low pass sees what is on the ground (a radar site, a supply
 * cache). A yes settles the spot; a no crosses those off. A clear stretch
 * takes both to be sure.
 */
export const CELL_LOOKS = { scouts: WEATHER, drone: GROUND } as const satisfies Partial<Record<AssetId, readonly CellTruth[]>>;
export const CELL_LOOK_LABEL = { scouts: 'SCOUTS · WEATHER', drone: 'DRONE · RADAR + CACHE' } as const;

/** What one mission's board is made of. */
export interface ControlDef {
  /** Seconds on the board before the front arrives. */
  seconds: number;
  corridors: readonly CorridorDef[];
  /** Limited assets (sensors from the loadout are unlimited, paid in seconds). */
  limited: Partial<Record<AssetId, number>>;
  /** The mix of truths dealt across all cells. */
  cellMix: readonly CellTruth[];
  /** Where the shadowed truck leads (the barge). */
  landing: { x: number; z: number; label: string };
  /** The brief's clues, in order. */
  clues: readonly string[];
  /** How many storms the tower misplaces (default 1). Later pages: the tower lies more. */
  wrongForecasts?: number;
}

// ------------------------------------------------------------------ state

export interface ReturnKnowledge {
  size: boolean;
  road: boolean;
  radio: boolean;
  engine: boolean;
  /** Best look at it (sets the quality of the evidence photo). */
  look: 'optical' | 'thermal' | null;
}

export interface CellState {
  truth: CellTruth;
  /** What it could still be, given everything learned. One left = known. */
  possible: CellTruth[];
  /** The tower's forecast (weather only; not always right). */
  forecast: CellTruth;
}

export interface BoardState {
  /** Seconds left before the front (the clock runs in real time). */
  seconds: number;
  maxSeconds: number;
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
  // the stale forecast: a storm misplaced onto a stretch of another corridor (later pages: more than one)
  const storms = shuffle(cells.filter((c) => state[c.id].truth === 'storm'), rand);
  for (const s of storms.slice(0, def.wrongForecasts ?? 1)) {
    const away = cells.filter((c) => c.corridor !== s.corridor && state[c.id].forecast === 'clear' && state[c.id].truth !== 'storm');
    if (!away.length) break;
    const o = away[Math.floor(rand() * away.length)];
    state[s.id].forecast = 'clear';
    state[o.id].forecast = 'storm';
  }
  const uses: Partial<Record<AssetId, number>> = { ...def.limited };
  const returns: Partial<Record<ReturnId, ReturnKnowledge>> = {};
  for (const r of cast) returns[r.id] = { size: false, road: false, radio: false, engine: false, look: null };
  return { seconds: def.seconds, maxSeconds: def.seconds, uses, sensors: [...sensors], returns, cells: state, marked: null, wrong: [], shadowed: false, corridor: null, frontCaught: false, executed: false, actions: 0 };
}

/** The clock runs: one frame of real time off it. At zero the front is here. */
export function tickBoard(b: BoardState, dt: number): BoardEvent[] {
  if (b.executed || b.frontCaught) return [];
  b.seconds = Math.max(0, b.seconds - dt);
  return frontCheck(b);
}

/** How much of the clock is left, 0..1. */
export function clockLeft(b: Pick<BoardState, 'seconds' | 'maxSeconds'>): number {
  return b.maxSeconds > 0 ? Math.max(0, Math.min(1, b.seconds / b.maxSeconds)) : 0;
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
  return id === 'shadow' || id === 'listen' || id in b.uses;
}

/** Can this asset be used on this target now? `reason` explains a refusal in a few words. */
export function canUse(b: BoardState, cast: readonly ReturnDef[], id: AssetId, t: Target): { ok: boolean; reason: string } {
  const a = ASSETS[id];
  if (b.executed) return { ok: false, reason: 'PLAN EXECUTED' };
  if (!assetFitted(b, id)) return { ok: false, reason: 'NOT FITTED' };
  if (id in b.uses && (b.uses[id] ?? 0) <= 0) return { ok: false, reason: 'NONE LEFT' };
  if (a.cost > b.seconds) return { ok: false, reason: 'NO TIME' };
  if (a.target !== t.kind) return { ok: false, reason: a.target === 'cell' ? 'PICK A ROUTE SPOT' : a.target === 'return' ? 'PICK A VEHICLE' : '' };
  if (t.kind === 'return') {
    const k = b.returns[t.id];
    const def = cast.find((r) => r.id === t.id);
    if (!k || !def || (def.hidden && !b.shadowed)) return { ok: false, reason: 'NOT ON THE BOARD' };
    if (id === 'shadow') {
      if (b.shadowed) return { ok: false, reason: 'ALREADY SHADOWED' };
      if (b.marked !== t.id) return { ok: false, reason: 'MARK THE TRUCK FIRST' };
      return { ok: true, reason: '' };
    }
    const looks = VEHICLE_LOOKS[id as keyof typeof VEHICLE_LOOKS] as readonly (keyof Omit<ReturnKnowledge, 'look'>)[] | undefined;
    if (!looks || looks.every((q) => k[q])) return { ok: false, reason: 'NOTHING NEW' };
  }
  if (t.kind === 'cell') {
    const c = b.cells[t.id];
    if (!c) return { ok: false, reason: '' };
    if (isKnown(c)) return { ok: false, reason: 'ALREADY KNOWN' };
    const asks = CELL_LOOKS[id as keyof typeof CELL_LOOKS] as readonly CellTruth[] | undefined;
    if (!asks || !c.possible.some((p) => asks.includes(p))) return { ok: false, reason: 'NOTHING NEW' };
  }
  if (id === 'sigint' && !Object.values(b.returns).some((k) => k && !k.radio) && !Object.values(b.cells).some((c) => c.possible.length > 1 && c.possible.includes('radar'))) return { ok: false, reason: 'NOTHING NEW' };
  return { ok: true, reason: '' };
}

/** An action is spent: a limited one is used up; its seconds come off the clock as it plays (`tickBoard`). */
function spend(b: BoardState, id: AssetId): BoardEvent[] {
  if (id in b.uses) b.uses[id] = (b.uses[id] ?? 0) - 1;
  b.actions += 1;
  return frontCheck(b);
}

function frontCheck(b: BoardState): BoardEvent[] {
  if (b.seconds > 0 || b.frontCaught) return [];
  b.frontCaught = true;
  return [{ type: 'front', title: 'THE FRONT IS HERE', text: 'NO TIME LEFT · EXECUTING NOW' }];
}

function narrow(c: CellState, keep: (t: CellTruth) => boolean): void {
  c.possible = c.possible.filter(keep);
}

/** Is the tower's forecast for this spot provably wrong, from what is known so far? */
export function towerWrong(c: Pick<CellState, 'possible' | 'forecast'>, possible: readonly CellTruth[] = c.possible): boolean {
  // a storm or cloud forecast is wrong once that weather is ruled out; a clear one once only weather is left
  return WEATHER.includes(c.forecast) ? !possible.includes(c.forecast) : possible.every((p) => WEATHER.includes(p));
}

function revealCell(b: BoardState, cellId: string, events: BoardEvent[], before: readonly CellTruth[]): void {
  const c = b.cells[cellId];
  const target: Target = { kind: 'cell', id: cellId };
  if (isKnown(c) && before.length > 1) {
    const t = c.possible[0];
    events.push({ type: t === 'cache' ? 'opportunity' : 'reveal', title: CELL_LABEL[t], text: t === 'cache' ? 'AN OPPORTUNITY ON THIS ROUTE' : t === 'clear' ? 'NOTHING IN THE WAY' : 'ON THIS ROUTE', target });
  }
  // the moment the tower's forecast can no longer be true, say so (once)
  if (towerWrong(c) && !towerWrong(c, before)) events.push({ type: 'contradiction', title: 'TOWER WAS WRONG', text: `FORECAST SAID ${CELL_LABEL[c.forecast]}`, target });
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
      for (const q of VEHICLE_LOOKS[id as keyof typeof VEHICLE_LOOKS]) k[q] = true;
      if (id === 'optical' || id === 'thermal') {
        const rank = { thermal: 1, optical: 2 } as const;
        if (!k.look || rank[id] > rank[k.look]) k.look = id;
      }
      const said = id === 'listen' ? (def.radio ? 'RADIO ON · TRANSMITTING' : 'RADIO DEAD · SILENT') : traits(def, k, sector(def)).slice(0, 3).join(' · ');
      events.push({ type: 'reveal', title: `RETURN ${t.id}`, text: said, target: t });
      const out = ruledOut(clueChecks(def, k, sector(def), clues));
      if (out && !wasOut) events.push({ type: 'ruled-out', title: `NOT ${t.id}`, text: 'IT BREAKS THE BRIEF', target: t });
    }
  } else if (t.kind === 'cell') {
    const c = b.cells[t.id];
    const before = [...c.possible];
    const asks = CELL_LOOKS[id as keyof typeof CELL_LOOKS] as readonly CellTruth[];
    if (asks.includes(c.truth)) narrow(c, (p) => p === c.truth);
    else {
      // a no: those are crossed off; what is left stays open for the other look
      narrow(c, (p) => !asks.includes(p));
      if (!isKnown(c)) events.push({ type: 'nothing', title: ASSETS[id].label, text: id === 'scouts' ? 'NO WEATHER HERE' : 'NOTHING ON THE GROUND', target: t });
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
      const before = [...c.possible];
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

/** MARK a return as the truck. A wrong call costs seconds and points. */
export function mark(b: BoardState, cast: readonly ReturnDef[], id: ReturnId): BoardEvent[] {
  if (b.executed || b.marked || b.wrong.includes(id)) return [];
  const def = cast.find((r) => r.id === id);
  if (!def || (def.hidden && !b.shadowed)) return [];
  if (def.isTarget) {
    b.marked = id;
    return [{ type: 'locked', title: 'TARGET LOCKED', text: `RETURN ${id} · THE SUPPLY TRUCK`, target: { kind: 'return', id } }];
  }
  b.wrong.push(id);
  b.seconds = Math.max(0, b.seconds - WRONG_MARK_SECONDS);
  return [{ type: 'wrong', title: 'NEGATIVE', text: `RETURN ${id} IS NOT THE TRUCK · −${WRONG_MARK_SECONDS} s`, target: { kind: 'return', id } }, ...frontCheck(b)];
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
  second: 15,
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

  const efficiency = b.frontCaught ? 0 : Math.round(b.seconds) * POINTS.second;
  const risk = route ? route.cells.reduce((t, c) => t + cellRisk(b.cells[c.id]), 0) : -1200;
  const cache = route ? route.cells.some((c) => belief(b.cells[c.id]) === 'cache') : false;
  const bonus = (b.shadowed ? POINTS.shadow : 0) + (cache ? POINTS.cacheOnRoute : 0);
  const losses = -(b.wrong.length * POINTS.wrong + (b.frontCaught ? POINTS.front : 0));

  const lines: ScoreLine[] = [
    { id: 'objective', label: 'OBJECTIVE', points: objective, detail: !b.marked ? 'TRUCK NOT FOUND' : confirmed ? 'TRUCK · CONFIRMED' : 'TRUCK · ON A HUNCH' },
    { id: 'intel', label: 'INTELLIGENCE', points: intel, detail: `${explained}/${visible.length} VEHICLES · ${known.length}/${Object.keys(b.cells).length} ROUTE SPOTS` },
    { id: 'efficiency', label: 'EFFICIENCY', points: efficiency, detail: b.frontCaught ? 'CAUGHT BY THE FRONT' : `${Math.round(b.seconds)} s TO SPARE` },
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
