/**
 * The fire drawn flat, for the screens: Mission Control's map and the
 * debrief's before-and-after. One pixel a cell, scaled up smoothly.
 */
import { BURNING, BURNT, OUT, type FireState } from '../fire/fireSim';

export function paintFire(cv: HTMLCanvasElement, f: FireState): HTMLCanvasElement {
  if (cv.width !== f.n) cv.width = cv.height = f.n;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(f.n, f.n);
  const d = img.data;
  for (let k = 0; k < f.state.length; k++) {
    const s = f.state[k];
    let c: [number, number, number, number] = [0, 0, 0, 0];
    if (s === BURNING) c = [255, 80 + 70 * f.heat[k], 20, 255];
    else if (s === BURNT) c = [40, 33, 30, 235];
    else if (s === OUT) c = [70, 70, 76, 225];
    if (f.retardant[k] > 0.4) c = s === 0 ? [214, 48, 58, 230] : [140, 45, 45, 235];
    d.set(c, k * 4);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
