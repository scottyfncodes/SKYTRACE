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

/** A fire on the briefing map: the burn map, what it threatens (with when), the water, the wind. */
export interface BriefingFire {
  canvas: HTMLCanvasElement;
  /** Where it will have burned in a couple of minutes if nobody goes. */
  forecast: HTMLCanvasElement;
  /** The fires, as points to mark (the middle of each). */
  spots: { x: number; z: number }[];
  x0: number;
  z0: number;
  size: number;
  threats: readonly { name: string; icon: string; x: number; z: number; r: number; eta: string }[];
  water: readonly { name: string; x: number; z: number; r: number }[];
  /** Where the air is going (m/s). */
  wind: { x: number; z: number };
  /** People are trapped: no hospital run unless so. */
  people: boolean;
}

/** The Pre-Flight map: where you are, where they are (roughly), where they go; or where the fire is and where it is going. */
export function drawBriefingMap(cv: HTMLCanvasElement, m: { search: { x: number; z: number; r: number }; deliverTo: keyof typeof PADS; startPad: keyof typeof PADS }, t: number, fire?: BriefingFire): void {
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
  const showD = !fire || fire.people;
  // a fire: frame the fire and its water (the base sits off the edge, the route pointing to it)
  const xs = fire ? [fire.x0, fire.x0 + fire.size, ...fire.water.map((w) => w.x)] : [S.x, D.x, m.search.x - m.search.r, m.search.x + m.search.r];
  const zs = fire ? [fire.z0, fire.z0 + fire.size, ...fire.water.map((w) => w.z)] : [S.z, D.z, m.search.z - m.search.r, m.search.z + m.search.r];
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
  const label = (s: string, x: number, y: number) => {
    ctx.strokeText(s, x, y);
    ctx.fillText(s, x, y);
  };
  const font = (size: number) => {
    ctx.font = `900 ${Math.round(size * dpr)}px system-ui, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(18,38,63,0.8)';
    ctx.lineWidth = 4 * dpr;
  };
  // route: base → search → hospital (or base → the fire)
  const via = fire ? { x: fire.x0 + fire.size / 2, z: fire.z0 + fire.size / 2 } : m.search;
  ctx.setLineDash([8 * dpr, 7 * dpr]);
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(px(S.x), pz(S.z));
  ctx.lineTo(px(via.x), pz(via.z));
  if (showD) ctx.lineTo(px(D.x), pz(D.z));
  ctx.stroke();
  ctx.setLineDash([]);
  if (fire) drawFireLayer(ctx, fire, px, pz, span, dpr, t, label, font);
  else {
    // search area, breathing
    const r = m.search.r / span;
    ctx.fillStyle = 'rgba(255,138,31,0.22)';
    ctx.strokeStyle = '#ff8a1f';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(px(m.search.x), pz(m.search.z), r * (1 + 0.04 * Math.sin(t * 3)), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    font(12);
    ctx.textAlign = 'center';
    label('SEARCH AREA', px(m.search.x), pz(m.search.z) + 4 * dpr);
  }
  // pads off the edge of the map are pinned to it
  const pin = (x: number, z: number) => {
    const m = 16 * dpr;
    return { x: Math.min(W - m, Math.max(m, px(x))), y: Math.min(H - m, Math.max(m, pz(z))), off: px(x) < m || px(x) > W - m || pz(z) < m || pz(z) > H - m };
  };
  const sp = pin(S.x, S.z);
  const dp = pin(D.x, D.z);
  font(12);
  drawPad(ctx, sp.x, sp.y, (sp.off ? 8 : 10) * dpr, '#ffb400');
  if (showD) drawPad(ctx, dp.x, dp.y, (dp.off ? 8 : 10) * dpr, '#e23d28');
  font(12);
  const side = (p: { x: number }) => (p.x > W / 2 ? 'right' : 'left');
  // (a pad pinned to the edge is just a marker: the labels belong to the job)
  ctx.textAlign = side(sp);
  if (!sp.off) label(fire ? (fire.people ? 'BASE' : 'AIRFIELD') : 'BASE', sp.x + (side(sp) === 'right' ? -14 : 14) * dpr, sp.y + 4 * dpr);
  ctx.textAlign = side(dp) === 'right' ? 'right' : 'left';
  if (showD && !dp.off) label('HOSPITAL', dp.x + (side(dp) === 'right' ? -14 : 14) * dpr, dp.y + 4 * dpr);
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

/** The fire on a flat map: burn map, wind chevrons sweeping the way it spreads, the places in danger, the water. */
function drawFireLayer(
  ctx: CanvasRenderingContext2D,
  fire: BriefingFire,
  px: (x: number) => number,
  pz: (z: number) => number,
  span: number,
  dpr: number,
  t: number,
  label: (s: string, x: number, y: number) => void,
  font: (size: number) => void,
): void {
  // the fire's ground, faintly, then the fire
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(px(fire.x0), pz(fire.z0), fire.size / span, fire.size / span);
  ctx.imageSmoothingEnabled = true;
  // a glow under the flames
  ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 2.5);
  ctx.drawImage(fire.forecast, px(fire.x0), pz(fire.z0), fire.size / span, fire.size / span);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.shadowColor = 'rgba(255,90,20,0.9)';
  ctx.shadowBlur = 12 * dpr;
  ctx.drawImage(fire.canvas, px(fire.x0), pz(fire.z0), fire.size / span, fire.size / span);
  ctx.restore();
  // each fire, marked so it reads at any size
  for (const sp of fire.spots) {
    const r = (9 + Math.sin(t * 6) * 1.5) * dpr;
    const g = ctx.createRadialGradient(px(sp.x), pz(sp.z), 0, px(sp.x), pz(sp.z), r * 2.2);
    g.addColorStop(0, 'rgba(255,200,60,0.95)');
    g.addColorStop(0.45, 'rgba(255,90,20,0.7)');
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px(sp.x), pz(sp.z), r * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${Math.round(15 * dpr)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔥', px(sp.x), pz(sp.z));
    ctx.textBaseline = 'alphabetic';
  }
  // which way it is going: chevrons drifting downwind across the fire's ground
  const ws = Math.hypot(fire.wind.x, fire.wind.z);
  if (ws > 0.5) {
    const ux = fire.wind.x / ws;
    const uz = fire.wind.z / ws;
    const cx = fire.x0 + fire.size / 2;
    const cz = fire.z0 + fire.size / 2;
    const step = fire.size / 4;
    const drift = ((t * 30) % step) - step / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2.5 * dpr;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const x = cx + (-uz * i + ux * j) * step + ux * drift;
        const z = cz + (ux * i + uz * j) * step + uz * drift;
        const s = (9 + ws) * dpr;
        const X = px(x);
        const Z = pz(z);
        ctx.beginPath();
        ctx.moveTo(X - ux * s - uz * s * 0.8, Z - uz * s + ux * s * 0.8);
        ctx.lineTo(X, Z);
        ctx.lineTo(X - ux * s + uz * s * 0.8, Z - uz * s - ux * s * 0.8);
        ctx.stroke();
      }
    ctx.lineCap = 'butt';
  }
  for (const w of fire.water) {
    ctx.fillStyle = 'rgba(95,208,255,0.75)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(px(w.x), pz(w.z), Math.max(6 * dpr, w.r / span), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    font(10);
    ctx.textAlign = 'center';
    label(`💧 ${w.name.toUpperCase()}`, px(w.x), pz(w.z) + Math.max(6 * dpr, w.r / span) + 13 * dpr);
  }
  for (const th of fire.threats) {
    const r = Math.max(8 * dpr, th.r / span) * (1 + 0.08 * Math.sin(t * 4));
    ctx.fillStyle = 'rgba(226,61,40,0.25)';
    ctx.strokeStyle = '#e23d28';
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(px(th.x), pz(th.z), r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    font(11);
    ctx.textAlign = 'center';
    label(`${th.icon} ${th.name.toUpperCase()}`, px(th.x), pz(th.z) + r + 13 * dpr);
    if (th.eta) {
      ctx.fillStyle = '#ffd23f';
      label(th.eta, px(th.x), pz(th.z) + r + 26 * dpr);
    }
  }
}
