/**
 * Recon: on some calls you are not told exactly where they are, you are told
 * what to look for. Several contacts lie along the way (vehicles on a road,
 * camps in a forest); point the nose at one, close enough and low enough,
 * and the crew identifies it in about a second. Most are not the one: CLEAR,
 * move on. One is: FOUND.
 *
 * The verb is "identify": you fly the road and look, rather than flying
 * into a circle and waiting for a flare. Pure, deterministic, tested.
 */

export interface Contact {
  x: number;
  z: number;
  /** What it is, before it has been identified ("TRUCK"). */
  label: string;
  /** What the crew says once it is identified ("Logging truck, parked up. Not them."). */
  clear: string;
  /** Which model stands there. */
  kind: 'logtruck' | 'van' | 'wreck';
  /** This is the one. */
  target?: boolean;
  /** The way the vehicle faces (rad, yaw). */
  heading?: number;
}

/** Identifying needs the contact within this far (m), this close to the nose (rad), from no higher than this (m above it). */
export const SCAN_RANGE = 170;
export const SCAN_CONE = 0.42;
export const SCAN_CEILING = 200;
/** Seconds of looking to identify one. */
export const SCAN_TIME = 1.3;

export interface ScanState {
  /** 0..1 per contact. */
  progress: number[];
  identified: boolean[];
  /** Which contact is being looked at (-1: none). */
  looking: number;
}

export type ScanEvent = { type: 'cleared'; index: number } | { type: 'found'; index: number };

export const newScan = (contacts: readonly Contact[]): ScanState => ({ progress: contacts.map(() => 0), identified: contacts.map(() => false), looking: -1 });

/** The contact the nose is on, if any: unidentified, in range, inside the cone, the nearest of those. */
export function inView(contacts: readonly Contact[], s: ScanState, p: { x: number; z: number; yaw: number; agl: number }, scanMult = 1): number {
  let best = -1;
  let bd = Infinity;
  if (p.agl > SCAN_CEILING) return -1;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  for (let i = 0; i < contacts.length; i++) {
    if (s.identified[i]) continue;
    const c = contacts[i];
    const dx = c.x - p.x;
    const dz = c.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > SCAN_RANGE * scanMult) continue;
    // right underneath counts too (a hover over it)
    const ang = d < 25 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
    if (ang > SCAN_CONE) continue;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Look for a step. `scanMult`: better eyes (the Spotter, a thermal camera) see further. */
export function tickScan(contacts: readonly Contact[], s: ScanState, p: { x: number; z: number; yaw: number; agl: number }, dt: number, scanMult = 1): ScanEvent[] {
  const ev: ScanEvent[] = [];
  const i = inView(contacts, s, p, scanMult);
  s.looking = i;
  for (let k = 0; k < contacts.length; k++) {
    if (s.identified[k]) continue;
    if (k === i) {
      s.progress[k] = Math.min(1, s.progress[k] + dt / SCAN_TIME);
      if (s.progress[k] >= 1) {
        s.identified[k] = true;
        s.looking = -1;
        ev.push({ type: contacts[k].target ? 'found' : 'cleared', index: k });
      }
    } else s.progress[k] = Math.max(0, s.progress[k] - dt * 0.4);
  }
  return ev;
}

/** The nearest contact still to check, for the nav arrow. */
export function nextContact(contacts: readonly Contact[], s: ScanState, p: { x: number; z: number }): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < contacts.length; i++) {
    if (s.identified[i]) continue;
    const d = Math.hypot(contacts[i].x - p.x, contacts[i].z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export const decoysCleared = (contacts: readonly Contact[], s: ScanState): number => contacts.filter((c, i) => !c.target && s.identified[i]).length;
