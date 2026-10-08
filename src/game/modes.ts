/** Top-level screen the game is on. */
export type Mode = 'title' | 'preflight' | 'flight' | 'paused' | 'landing' | 'debrief';

/**
 * Pause key / button: flight pauses, paused resumes, every other screen
 * ignores it (returns null) so Esc on the title, Pre-Flight or debrief does nothing.
 */
export function pauseTransition(mode: Mode): 'paused' | 'flight' | null {
  if (mode === 'flight') return 'paused';
  if (mode === 'paused') return 'flight';
  return null;
}
