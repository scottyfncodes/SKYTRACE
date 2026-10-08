/**
 * A painted map of the valley (elevation, water, forest, snow), drawn once
 * from the height field and reused by Pre-Flight and the minimap.
 */
import { clamp } from '../core/math';
import { forestAt, getHeightField } from '../world/terrain';
import { PADS, WORLD_HALF } from '../world/worldData';

let cached: HTMLCanvasElement | null = null;
export const MAP_PX = 256;

export function valleyImage(): HTMLCanvasElement {
  if (cached) return cached;
  const hf = getHeightField();
  const cv = document.createElement('canvas');
  cv.width = cv.height = MAP_PX;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(MAP_PX, MAP_PX);
  const step = (WORLD_HALF * 2) / MAP_PX;
  for (let j = 0; j < MAP_PX; j++)
    for (let i = 0; i < MAP_PX; i++) {
      const x = -WORLD_HALF + (i + 0.5) * step;
      const z = -WORLD_HALF + (j + 0.5) * step;
      const h = hf.sample(x, z);
      // light from the north-west
      const shade = clamp(1 + (hf.sample(x - step, z - step) - h) * 0.03, 0.7, 1.25);
      let r: number, g: number, b: number;
      if (h < 0.5) [r, g, b] = [74, 168, 222];
      else if (h > 330) [r, g, b] = [245, 248, 252];
      else {
        const t = clamp(h / 300, 0, 1);
        r = 120 + t * 90;
        g = 190 - t * 20;
        b = 95 + t * 60;
        const f = forestAt(x, z);
        r -= f * 55;
        g -= f * 40;
        b -= f * 40;
      }
      const k = (j * MAP_PX + i) * 4;
      img.data[k] = clamp(r * shade, 0, 255);
      img.data[k + 1] = clamp(g * shade, 0, 255);
      img.data[k + 2] = clamp(b * shade, 0, 255);
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  cached = cv;
  return cv;
}

/** World metres → map pixels on a canvas of `size` covering the whole world. */
export const toMap = (v: number, size: number): number => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * size;

export function drawPad(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(2, r * 0.18);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(r * 1.2)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', x, y + r * 0.06);
}

/** The Pre-Flight map: where you are, where they are (roughly), where they go. */
export function drawBriefingMap(cv: HTMLCanvasElement, m: { search: { x: number; z: number; r: number }; deliverTo: keyof typeof PADS; startPad: keyof typeof PADS }, t: number): void {
  const rect = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(rect.width * dpr));
  const H = Math.max(1, Math.round(rect.height * dpr));
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const ctx = cv.getContext('2d')!;
  // frame the part of the valley that matters: base, hospital, search area
  const S = PADS[m.startPad];
  const D = PADS[m.deliverTo];
  const xs = [S.x, D.x, m.search.x - m.search.r, m.search.x + m.search.r];
  const zs = [S.z, D.z, m.search.z - m.search.r, m.search.z + m.search.r];
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max((Math.max(...xs) - Math.min(...xs)) / (W - 70 * dpr), (Math.max(...zs) - Math.min(...zs)) / (H - 56 * dpr));
  const px = (x: number) => W / 2 + (x - cx) / span;
  const pz = (z: number) => H / 2 + (z - cz) / span;
  const img = valleyImage();
  const k = (WORLD_HALF * 2) / MAP_PX / span;
  ctx.fillStyle = '#b9d3e3';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(18,38,63,0.35)';
  ctx.shadowBlur = 14 * dpr;
  ctx.fillStyle = '#7fae55';
  ctx.fillRect(px(-WORLD_HALF), pz(-WORLD_HALF), MAP_PX * k, MAP_PX * k);
  ctx.restore();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, px(-WORLD_HALF), pz(-WORLD_HALF), MAP_PX * k, MAP_PX * k);
  // route: base → search → hospital
  ctx.setLineDash([8 * dpr, 7 * dpr]);
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(px(S.x), pz(S.z));
  ctx.lineTo(px(m.search.x), pz(m.search.z));
  ctx.lineTo(px(D.x), pz(D.z));
  ctx.stroke();
  ctx.setLineDash([]);
  // search area, breathing
  const r = m.search.r / span;
  ctx.fillStyle = 'rgba(255,138,31,0.22)';
  ctx.strokeStyle = '#ff8a1f';
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  ctx.arc(px(m.search.x), pz(m.search.z), r * (1 + 0.04 * Math.sin(t * 3)), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = `900 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(18,38,63,0.8)';
  ctx.lineWidth = 4 * dpr;
  const label = (s: string, x: number, y: number) => {
    ctx.strokeText(s, x, y);
    ctx.fillText(s, x, y);
  };
  label('SEARCH AREA', px(m.search.x), pz(m.search.z) + 4 * dpr);
  drawPad(ctx, px(S.x), pz(S.z), 10 * dpr, '#ffb400');
  drawPad(ctx, px(D.x), pz(D.z), 10 * dpr, '#e23d28');
  ctx.textAlign = 'right';
  label('BASE', px(S.x) - 14 * dpr, pz(S.z) + 4 * dpr);
  ctx.textAlign = 'left';
  label('HOSPITAL', px(D.x) + 14 * dpr, pz(D.z) + 4 * dpr);
  ctx.textAlign = 'center';
  // north
  ctx.fillStyle = 'rgba(18,38,63,0.75)';
  ctx.beginPath();
  ctx.arc(W - 20 * dpr, 20 * dpr, 13 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', W - 20 * dpr, 21 * dpr);
  ctx.textBaseline = 'alphabetic';
}
