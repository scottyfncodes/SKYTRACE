/**
 * Player preferences. Stored separately from the case save so that starting a
 * New Case (which erases the investigation) keeps the player's control setup.
 */
export const PREFS_KEY = 'skytrace.prefs.v1';

export type VerticalMode = 'standard' | 'inverted';
/** Which thumb steers. The throttle and the radar scope sit on the other side. */
export type SteerSide = 'left' | 'right';

export interface Prefs {
  verticalMode: VerticalMode;
  steer: SteerSide;
}

export const DEFAULT_PREFS: Readonly<Prefs> = { verticalMode: 'standard', steer: 'left' };

/** The other side of the screen: where the throttle and the scope go. */
export const otherSide = (s: SteerSide): SteerSide => (s === 'left' ? 'right' : 'left');

interface PrefStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadPrefs(storage: PrefStorage): Prefs {
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { verticalMode: p.verticalMode === 'inverted' ? 'inverted' : 'standard', steer: p.steer === 'right' ? 'right' : 'left' };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs, storage: PrefStorage): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

/**
 * Apply the vertical preference to a flight input. Only the sign of `pitch`
 * changes; roll, throttle and every other field pass through untouched.
 * Standard returns the input unchanged.
 */
export function applyVerticalMode<T extends { pitch: number }>(inp: T, mode: VerticalMode): T {
  if (mode !== 'inverted' || inp.pitch === 0) return inp;
  return { ...inp, pitch: -inp.pitch };
}
