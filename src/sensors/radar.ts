import { clamp } from '../core/math';
import type { ContactDef } from '../intel/scenario';

export interface RadarParams {
  /** Ground footprint radius in metres. */
  radius: number;
  /** 0..1 resolution: low altitude = high quality. */
  quality: number;
}

export const RADAR_BEST_AGL = 140; // metres above ground where quality peaks

/** Footprint and resolution as a function of altitude above ground. */
export function radarParams(agl: number, radarMult = 1): RadarParams {
  const a = Math.max(0, agl);
  const radius = clamp(60 + a * 0.75, 60, 300) * radarMult;
  // quality 1.0 below ~140 m, falls off to 0.25 at 600 m
  const quality = a <= RADAR_BEST_AGL ? 1 : clamp(1 - ((a - RADAR_BEST_AGL) / 460) * 0.75, 0.25, 1);
  return { radius, quality };
}

export const DETECT_THRESHOLD = 1.0;
export const RESOLVE_THRESHOLD = 3.2;
/** Resolving (not just detecting) needs this much scan quality: forces a lower pass. */
export const RESOLVE_MIN_QUALITY = 0.72;

/**
 * Confidence gained this frame from a contact inside the footprint.
 * Returns 0 if the contact is outside the footprint or too concealed for this scan quality.
 */
export function detectionGain(dt: number, p: RadarParams, dist: number, def: Pick<ContactDef, 'signature' | 'concealment'>, hidden: boolean, rateMult = 1): number {
  if (hidden || dist > p.radius) return 0;
  const effectiveQuality = p.quality - def.concealment * 0.85;
  if (effectiveQuality <= 0.05) return 0;
  const centreBonus = 0.6 + 0.4 * (1 - dist / p.radius); // better near the footprint centre
  return dt * 0.55 * rateMult * effectiveQuality * (0.5 + def.signature) * centreBonus;
}

/** Positional uncertainty (metres) of a return made at this quality. */
export function uncertaintyFor(p: RadarParams, concealment: number): number {
  return Math.round(25 + 140 * (1 - p.quality) + 60 * concealment);
}

export function canResolve(p: RadarParams, def: Pick<ContactDef, 'concealment'>): boolean {
  return p.quality - def.concealment * 0.85 >= RESOLVE_MIN_QUALITY - def.concealment * 0.85 && p.quality >= RESOLVE_MIN_QUALITY;
}

/** Visual observation rule: clear targets from moderate altitude, "low" targets need a close, low pass. */
export function canObserve(def: Pick<ContactDef, 'visible'>, dist: number, agl: number): boolean {
  if (def.visible === 'none') return false;
  if (def.visible === 'clear') return dist < 260 && agl < 320;
  return dist < 110 && agl < 95;
}
