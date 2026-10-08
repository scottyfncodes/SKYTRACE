/**
 * Wind: a steady push from one direction with gusts on top. Pure and
 * deterministic in time, so the same moment always blows the same way.
 */
import type { MissionDef } from './missions';

export interface Wind {
  /** Where the air is going (m/s, world x and z). */
  x: number;
  z: number;
  /** Strength now (m/s). */
  speed: number;
  /** 0..1: how much of that is gust. */
  gust: number;
}

/** "From 315°" blows toward 135°. Compass degrees: 0 north (-z), 90 east (+x). */
export function windAt(w: MissionDef['wind'], t: number): Wind {
  const g = Math.max(0, Math.sin(t * 0.61) * Math.sin(t * 1.73 + 1.1) + 0.35 * Math.sin(t * 0.23));
  const speed = w.speed * (1 + w.gust * g);
  const wobble = 0.25 * w.gust * Math.sin(t * 0.37 + 0.6);
  const to = ((w.from + 180) * Math.PI) / 180 + wobble;
  return { x: Math.sin(to) * speed, z: -Math.cos(to) * speed, speed, gust: Math.min(1, w.gust * g) };
}

/** How fast a hovering helicopter is pushed along by the wind (m/s per m/s). */
export const HOVER_DRIFT = 0.22;
