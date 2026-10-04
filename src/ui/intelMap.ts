import { CONTACTS, CONTACT_BY_ID, HYPOTHESES, UNLOCKS } from '../intel/scenario';
import { COVERAGE_N, deriveLeads, evidenceFor, fileAssessment, isKnown, stageOf, type SaveState, type Stage } from '../intel/state';
import { forestAt, getHeightField } from '../world/terrain';
import { BASE, GRID_CELL, RIVER, ROADS, WORLD_HALF, gridRef } from '../world/worldData';
import { SENSOR_RANGE } from '../sensors/equipment';

export type IntelTab = 'contacts' | 'notes' | 'leads' | 'assess';

export interface IntelCallbacks {
  onClose(): void;
  onWaypoint(id: string | null): void;
  onFiled(result: 'accepted' | 'rejected' | 'weak', text: string): void;
  onNewCase(): void;
  onToggleSound(): boolean;
  isMuted(): boolean;
}

const STAGE_LABEL: Record<Stage, string> = { unknown: 'UNKNOWN', detected: 'DETECTED', observed: 'OBSERVED', resolved: 'RESOLVED', sensor: 'SENSOR DATA' };
const STAGE_CLASS: Record<Stage, string> = { unknown: 'st-unknown', detected: 'st-detected', observed: 'st-observed', resolved: 'st-resolved', sensor: 'st-sensor' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class IntelMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private panel: HTMLElement;
  private tabs: HTMLElement;
  private title: HTMLElement;
  private selected: string | null = null;
  private tab: IntelTab = 'leads';
  private state: SaveState | null = null;
  private resumeLabel = 'TAKE OFF';
  private lastFiled: { result: string; text: string } | null = null;
  private openedAt = 0;

  constructor(private root: HTMLElement, private cb: IntelCallbacks) {
    this.canvas = root.querySelector<HTMLCanvasElement>('#map')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.panel = root.querySelector<HTMLElement>('#panel')!;
    this.tabs = root.querySelector<HTMLElement>('#tabs')!;
    this.title = root.querySelector<HTMLElement>('#intel-title')!;
    this.canvas.addEventListener('pointerdown', (e) => this.onTap(e));
    this.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (!t) return;
      this.tab = t.dataset.tab as IntelTab;
      this.selected = null;
      this.renderPanel();
    });
    root.querySelector('#btn-resume')!.addEventListener('click', () => {
      // guard against the ghost click that follows the touch which opened this screen
      if (performance.now() - this.openedAt < 400) return;
      this.cb.onClose();
    });
    root.querySelector('#btn-newcase')!.addEventListener('click', () => {
      if (confirm('Start a new case? The current investigation will be erased.')) this.cb.onNewCase();
    });
    root.querySelector('#btn-sound')!.addEventListener('click', (e) => {
      const muted = this.cb.onToggleSound();
      (e.currentTarget as HTMLElement).textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    });
    this.panel.addEventListener('click', (e) => this.onPanelClick(e));
  }

  open(state: SaveState, mode: 'debrief' | 'planning' | 'inflight', fresh: string[] = []): void {
    this.state = state;
    this.openedAt = performance.now();
    this.resumeLabel = mode === 'inflight' ? 'RESUME FLIGHT' : `TAKE OFF · SORTIE ${state.sortie + 1}`;
    this.root.querySelector('#btn-resume')!.textContent = this.resumeLabel;
    (this.root.querySelector('#btn-sound') as HTMLElement).textContent = this.cb.isMuted() ? 'SOUND OFF' : 'SOUND ON';
    this.root.classList.remove('hidden');
    this.title.textContent = `INTELLIGENCE MAP · VARROW BASIN · ${state.sortie} SORTIE${state.sortie === 1 ? '' : 'S'} FLOWN`;
    if (mode === 'debrief') {
      this.tab = 'notes';
      this.renderPanel(fresh);
    } else {
      if (this.tab === 'notes' && mode === 'planning') this.tab = 'leads';
      this.renderPanel();
    }
    this.resize();
    this.draw();
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  resize(): void {
    const wrap = this.canvas.parentElement!;
    const size = Math.min(wrap.clientWidth, wrap.clientHeight) || 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    if (this.canvas.width !== size * dpr) {
      this.canvas.width = size * dpr;
      this.canvas.height = size * dpr;
    }
    this.draw();
  }

  // ------------------------------------------------------------ base map
  private buildBase(): HTMLCanvasElement {
    const N = 480;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const ctx = c.getContext('2d')!;
    const hf = getHeightField();
    const img = ctx.createImageData(N, N);
    const d = img.data;
    const toWorld = (p: number) => -WORLD_HALF + (p / N) * WORLD_HALF * 2;
    // coarse forest raster
    const FN = 96;
    const forest = new Float32Array(FN * FN);
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) forest[j * FN + i] = forestAt(-WORLD_HALF + ((i + 0.5) / FN) * WORLD_HALF * 2, -WORLD_HALF + ((j + 0.5) / FN) * WORLD_HALF * 2);
    const heights = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = hf.sample(toWorld(i), toWorld(j));
    const paper = [226, 216, 190];
    const low = [214, 206, 176];
    const high = [186, 172, 138];
    const crest = [164, 150, 124];
    const water = [150, 178, 190];
    const forestC = [150, 164, 118];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const h = heights[j * N + i];
        const k = (j * N + i) * 4;
        let r: number, g: number, b: number;
        if (h < 1) [r, g, b] = water;
        else {
          const t = Math.min(1, Math.max(0, (h - 5) / 150));
          const mixA = t < 0.5 ? low : high;
          const mixB = t < 0.5 ? high : crest;
          const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
          r = mixA[0] + (mixB[0] - mixA[0]) * u;
          g = mixA[1] + (mixB[1] - mixA[1]) * u;
          b = mixA[2] + (mixB[2] - mixA[2]) * u;
          // hillshade from the north-west
          const hl = heights[j * N + Math.max(0, i - 1)];
          const hu = heights[Math.max(0, j - 1) * N + i];
          const shade = Math.max(-1, Math.min(1, ((hl - h) + (hu - h)) * 0.12));
          r += shade * 40;
          g += shade * 40;
          b += shade * 40;
          // forest stipple
          const fi = Math.floor((i / N) * FN);
          const fj = Math.floor((j / N) * FN);
          const f = forest[fj * FN + fi];
          if (f > 0.25 && (i * 7 + j * 13) % 5 === 0) {
            r = r * 0.5 + forestC[0] * 0.5;
            g = g * 0.5 + forestC[1] * 0.5;
            b = b * 0.5 + forestC[2] * 0.5;
          } else if (f > 0.25) {
            r = r * 0.85 + forestC[0] * 0.15;
            g = g * 0.85 + forestC[1] * 0.15;
            b = b * 0.85 + forestC[2] * 0.15;
          }
          // contour lines every 20 m
          const band = Math.floor(h / 20);
          if (band !== Math.floor(hl / 20) || band !== Math.floor(hu / 20)) {
            const major = band % 5 === 0;
            r *= major ? 0.62 : 0.8;
            g *= major ? 0.62 : 0.8;
            b *= major ? 0.62 : 0.8;
          }
        }
        // paper grain
        const grain = ((i * 31 + j * 17) % 7) - 3;
        d[k] = Math.max(0, Math.min(255, r + grain));
        d[k + 1] = Math.max(0, Math.min(255, g + grain));
        d[k + 2] = Math.max(0, Math.min(255, b + grain));
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    void paper;
    const toPx = (x: number, z: number): [number, number] => [((x + WORLD_HALF) / (WORLD_HALF * 2)) * N, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * N];
    // river centreline
    ctx.strokeStyle = 'rgba(90,130,150,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    RIVER.forEach(([x, z], i) => {
      const [px, pz] = toPx(x, z);
      if (i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    });
    ctx.stroke();
    // roads
    for (const r of ROADS) {
      ctx.strokeStyle = r.kind === 'road' ? 'rgba(70,55,40,0.85)' : 'rgba(90,75,60,0.6)';
      ctx.lineWidth = r.kind === 'road' ? 1.8 : 1.2;
      ctx.setLineDash(r.kind === 'road' ? [] : r.kind === 'haul' ? [5, 4] : [2, 3]);
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => {
        const [px, pz] = toPx(x, z);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // grid
    ctx.strokeStyle = 'rgba(60,50,40,0.22)';
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(60,50,40,0.6)';
    const cols = 'ABCDEFGHIJKL';
    for (let i = 0; i <= 12; i++) {
      const p = (i / 12) * N;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, N);
      ctx.moveTo(0, p);
      ctx.lineTo(N, p);
      ctx.stroke();
      if (i < 12) {
        ctx.fillText(cols[i], p + (N / 24) - 4, 11);
        ctx.fillText(String(i + 1), 3, p + N / 24 + 4);
      }
    }
    // printed labels for mapped sites
    ctx.font = 'italic 10px Georgia, serif';
    ctx.fillStyle = 'rgba(50,40,30,0.85)';
    for (const c2 of CONTACTS) {
      if (!c2.onMap || !c2.mapLabel) continue;
      const [px, pz] = toPx(c2.x, c2.z);
      ctx.fillText(c2.mapLabel, px + 8, pz + 14);
    }
    const [bx, bz] = toPx(BASE.x, BASE.z);
    ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
    ctx.fillText('BASE', bx - 12, bz + 16);
    void GRID_CELL;
    return c;
  }

  // ------------------------------------------------------------ overlay
  draw(): void {
    if (!this.state) return;
    if (!this.base) this.base = this.buildBase();
    const s = this.state;
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = this.canvas.width / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.base, 0, 0, size, size);
    const k = size / (WORLD_HALF * 2);
    const toPx = (x: number, z: number): [number, number] => [(x + WORLD_HALF) * k, (z + WORLD_HALF) * k];

    // scan coverage
    const cell = size / COVERAGE_N;
    for (let j = 0; j < COVERAGE_N; j++) {
      for (let i = 0; i < COVERAGE_N; i++) {
        const v = s.coverage[j * COVERAGE_N + i];
        if (v <= 0.02) continue;
        ctx.fillStyle = `rgba(70,150,90,${0.08 + v * 0.22})`;
        ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
      }
    }
    // flight paths (latest strongest)
    s.paths.forEach((p, idx) => {
      const alpha = idx === s.paths.length - 1 ? 0.75 : 0.25;
      ctx.strokeStyle = `rgba(190,100,40,${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let i = 0; i + 1 < p.length; i += 2) {
        const [px, pz] = toPx(p[i], p[i + 1]);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    // links
    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (const key of s.links) {
      const [from, to] = key.split('>');
      const a = s.contacts[from].lastKnown ?? CONTACT_BY_ID[from];
      const b = s.contacts[to].lastKnown ?? CONTACT_BY_ID[to];
      const [ax, az] = toPx(a.x, a.z);
      const [bx, bz] = toPx(b.x, b.z);
      ctx.strokeStyle = 'rgba(170,40,30,0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, az);
      ctx.lineTo(bx, bz);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // sensors
    for (const sn of s.sensors) {
      const [px, pz] = toPx(sn.x, sn.z);
      ctx.strokeStyle = sn.nightsLeft > 0 ? 'rgba(180,110,20,0.9)' : 'rgba(120,110,90,0.6)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.arc(px, pz, SENSOR_RANGE * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = sn.nightsLeft > 0 ? 'rgba(220,140,30,0.95)' : 'rgba(120,110,90,0.8)';
      ctx.beginPath();
      ctx.moveTo(px, pz - 6);
      ctx.lineTo(px + 6, pz);
      ctx.lineTo(px, pz + 6);
      ctx.lineTo(px - 6, pz);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(60,40,20,0.9)';
      ctx.fillText(sn.id, px + 8, pz + 4);
    }
    // contacts
    for (const def of CONTACTS) {
      const c = s.contacts[def.id];
      if (!isKnown(c)) continue;
      const pos = c.lastKnown ?? { x: def.x, z: def.z, r: 100 };
      const [px, pz] = toPx(pos.x, pos.z);
      const st = stageOf(c);
      ctx.lineWidth = 1.4;
      if (st === 'detected') {
        ctx.strokeStyle = 'rgba(40,90,60,0.9)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(px, pz, Math.max(6, pos.r * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(40,90,60,0.9)';
        ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
        ctx.fillText('?', px - 3, pz + 4);
      } else if (st === 'observed') {
        ctx.fillStyle = 'rgba(40,70,120,0.95)';
        ctx.beginPath();
        ctx.moveTo(px, pz - 6);
        ctx.lineTo(px + 6, pz + 5);
        ctx.lineTo(px - 6, pz + 5);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = st === 'sensor' ? 'rgba(150,60,20,0.95)' : 'rgba(30,30,30,0.95)';
        ctx.beginPath();
        ctx.arc(px, pz, 5, 0, Math.PI * 2);
        ctx.fill();
        if (st === 'sensor') {
          ctx.strokeStyle = 'rgba(150,60,20,0.9)';
          ctx.beginPath();
          ctx.arc(px, pz, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (c.marked) {
        // grease-pencil circle, slightly wobbly
        ctx.strokeStyle = 'rgba(200,40,30,0.85)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const rr = 13 + Math.sin(a * 3 + px) * 1.2;
          const x = px + Math.cos(a) * rr;
          const y = pz + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (this.selected === def.id) {
        ctx.strokeStyle = 'rgba(230,140,20,0.95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 16, pz - 16, 32, 32);
      }
      ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(120,30,20,0.95)';
      ctx.fillText(c.codename, px + 9, pz - 8);
      if (s.waypoint === def.id) {
        ctx.fillStyle = 'rgba(230,140,20,0.95)';
        ctx.beginPath();
        ctx.moveTo(px, pz - 24);
        ctx.lineTo(px + 10, pz - 20);
        ctx.lineTo(px, pz - 16);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(px - 1, pz - 24, 1.5, 12);
      }
    }
    // base marker
    const [bx, bz] = toPx(BASE.x, BASE.z);
    ctx.strokeStyle = 'rgba(30,30,30,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx - 5, bz - 5, 10, 10);
  }

  private onTap(e: PointerEvent): void {
    if (!this.state) return;
    const r = this.canvas.getBoundingClientRect();
    const size = r.width;
    const k = size / (WORLD_HALF * 2);
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: string | null = null;
    let bestD = 22;
    for (const def of CONTACTS) {
      const c = this.state.contacts[def.id];
      if (!isKnown(c)) continue;
      const pos = c.lastKnown ?? def;
      const px = (pos.x + WORLD_HALF) * k;
      const pz = (pos.z + WORLD_HALF) * k;
      const d = Math.hypot(px - mx, pz - my);
      if (d < bestD) {
        bestD = d;
        best = def.id;
      }
    }
    this.selected = best;
    if (best) this.tab = 'contacts';
    this.renderPanel();
    this.draw();
  }

  private onPanelClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !this.state) return;
    const act = t.dataset.act!;
    const id = t.dataset.id ?? null;
    if (act === 'select') {
      this.selected = id;
      this.renderPanel();
      this.draw();
    } else if (act === 'waypoint') {
      this.state.waypoint = this.state.waypoint === id ? null : id;
      this.cb.onWaypoint(this.state.waypoint);
      this.renderPanel();
      this.draw();
    } else if (act === 'file') {
      const res = fileAssessment(this.state, id!);
      this.lastFiled = res;
      this.cb.onFiled(res.result, res.text);
      this.renderPanel();
    } else if (act === 'back') {
      this.selected = null;
      this.renderPanel();
      this.draw();
    }
  }

  // ------------------------------------------------------------ panel
  private renderPanel(fresh: string[] = []): void {
    const s = this.state;
    if (!s) return;
    const tabs: [IntelTab, string][] = [
      ['leads', 'LEADS'],
      ['contacts', 'CONTACTS'],
      ['notes', 'NOTES'],
      ['assess', 'ASSESSMENT'],
    ];
    this.tabs.innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="${this.tab === id ? 'on' : ''}">${label}</button>`).join('');
    let html = '';
    if (this.tab === 'contacts') html = this.selected ? this.renderDossier(this.selected) : this.renderContactList();
    else if (this.tab === 'notes') html = this.renderNotes(fresh);
    else if (this.tab === 'leads') html = this.renderLeads();
    else html = this.renderAssessment();
    this.panel.innerHTML = html;
    this.panel.scrollTop = 0;
  }

  private renderContactList(): string {
    const s = this.state!;
    const known = CONTACTS.filter((d) => isKnown(s.contacts[d.id]));
    if (known.length === 0) return `<p class="muted">No contacts logged. Fly the basin with the radar active and mark what you find.</p>`;
    const rows = known
      .map((def) => {
        const c = s.contacts[def.id];
        const st = stageOf(c);
        const pos = c.lastKnown ?? def;
        const name = c.observed || c.resolved ? def.name : 'Unidentified return';
        return `<button class="row" data-act="select" data-id="${def.id}"><b>${c.codename}</b><span>${esc(name)}</span><em>${gridRef(pos.x, pos.z)}</em><i class="stamp ${STAGE_CLASS[st]}">${STAGE_LABEL[st]}</i>${c.marked ? '<i class="stamp st-marked">MARKED</i>' : ''}</button>`;
      })
      .join('');
    const legend = `<div class="legend"><span><i class="lg lg-det">?</i> detected by sensor</span><span><i class="lg lg-obs"></i> observed directly</span><span><i class="lg lg-res"></i> confirmed by investigation</span><span><i class="lg lg-sen"></i> inferred from sensor record</span><span><i class="lg lg-mark"></i> marked</span><span><i class="lg lg-link"></i> connection</span></div>`;
    return `<div class="list">${rows}</div>${legend}`;
  }

  private renderDossier(id: string): string {
    const s = this.state!;
    const def = CONTACT_BY_ID[id];
    const c = s.contacts[id];
    const st = stageOf(c);
    const pos = c.lastKnown ?? def;
    const known = c.observed || c.resolved;
    const facts: string[] = [];
    if (c.observed && def.facts.observed) facts.push(...def.facts.observed);
    if (c.resolved && def.facts.resolved) facts.push(...def.facts.resolved);
    if (c.sensor && def.facts.sensor) facts.push(...def.facts.sensor);
    const interp: string[] = [];
    if (c.detected && !c.resolved) interp.push(def.texts.detected);
    if (c.observed) interp.push(def.texts.observed);
    if (c.resolved) interp.push(def.texts.resolved);
    if (c.sensor && def.texts.sensor) interp.push(def.texts.sensor);
    const links = s.links
      .filter((l) => l.startsWith(`${id}>`) || l.endsWith(`>${id}`))
      .map((l) => {
        const [a, b] = l.split('>');
        const other = a === id ? b : a;
        const ldef = CONTACT_BY_ID[a].links.find((x) => x.to === b)!;
        return `<li><b>${s.contacts[a].codename}</b> ${esc(ldef.label)} <b>${s.contacts[b].codename}</b> <button class="mini" data-act="select" data-id="${other}">open</button></li>`;
      })
      .join('');
    const mapNote = !def.onMap && known ? `<p class="flag">NOT ON SUPPLIED MAP</p>` : def.onMap && def.mapLabel ? `<p class="muted">Printed on the map as "${esc(def.mapLabel)}".</p>` : '';
    return `
      <button class="mini back" data-act="back">← contacts</button>
      <h3>${c.codename} <small>${known ? esc(def.name) : 'UNIDENTIFIED'}</small></h3>
      <p class="meta">${gridRef(pos.x, pos.z)} · ${def.kind.toUpperCase()} · ±${Math.round('r' in pos ? pos.r : 100)} m <i class="stamp ${STAGE_CLASS[st]}">${STAGE_LABEL[st]}</i> ${c.marked ? '<i class="stamp st-marked">MARKED</i>' : '<i class="stamp st-unknown">NOT MARKED</i>'}</p>
      ${mapNote}
      <h4>Confirmed</h4>
      ${facts.length ? `<ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">Nothing confirmed yet.</p>'}
      <h4>Interpretation <small>${c.resolved ? 'supported' : 'tentative'}</small></h4>
      ${interp.map((t) => `<p class="interp">${esc(t)}</p>`).join('')}
      ${def.questions.length ? `<h4>Open questions</h4><ul class="q">${def.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
      <h4>Connections</h4>
      ${links ? `<ul class="links">${links}</ul>` : '<p class="muted">None established.</p>'}
      <div class="actions"><button class="btn" data-act="waypoint" data-id="${id}">${s.waypoint === id ? 'CLEAR WAYPOINT' : 'SET AS WAYPOINT'}</button></div>`;
  }

  private renderNotes(fresh: string[]): string {
    const s = this.state!;
    if (s.notes.length === 0) return `<p class="muted">The field log is empty.</p>`;
    const freshBlock = fresh.length ? `<div class="debrief"><h4>Debrief · new this sortie</h4>${fresh.map((f) => `<p>${esc(f)}</p>`).join('')}</div>` : '';
    const rows = [...s.notes]
      .reverse()
      .slice(0, 80)
      .map((n) => `<div class="note k-${n.kind}"><span class="when">S${n.sortie}</span><span class="kind">${n.kind.toUpperCase()}</span><p>${esc(n.text)}</p></div>`)
      .join('');
    return `${freshBlock}<div class="notes">${rows}</div>`;
  }

  private renderLeads(): string {
    const s = this.state!;
    const leads = deriveLeads(s);
    const unlocks = s.unlocks.map((u) => UNLOCKS.find((x) => x.id === u)!).map((u) => `<li><b>${esc(u.name)}</b> ${esc(u.text)}</li>`).join('');
    const closed = s.assessment.closed ? `<div class="closed">CASE CLOSED · Assessment accepted. Keep flying if you want to see the whole picture.</div>` : '';
    const body = leads.length
      ? leads.map((l) => `<div class="lead"><p>${esc(l.text)}</p>${l.contact && isKnown(s.contacts[l.contact]) ? `<button class="mini" data-act="waypoint" data-id="${l.contact}">${s.waypoint === l.contact ? 'waypoint set' : 'set waypoint'}</button>` : ''}</div>`).join('')
      : `<p class="muted">No open leads. File an assessment.</p>`;
    return `${closed}<h4>Open leads</h4>${body}<h4>Capabilities</h4>${unlocks ? `<ul class="facts">${unlocks}</ul>` : '<p class="muted">Standard fit. New capabilities unlock as the picture builds.</p>'}`;
  }

  private renderAssessment(): string {
    const s = this.state!;
    const cards = HYPOTHESES.map((h) => {
      const ev = evidenceFor(s, h.id);
      const items = ev.items.map((i) => `<li class="${i.met && i.marked ? 'met' : i.met ? 'unmarked' : ''}">${esc(i.text)}${i.met && !i.marked ? ' <small>(not marked)</small>' : ''}</li>`).join('');
      const filed = s.assessment.filed === h.id;
      return `<div class="hypo ${filed ? 'filed' : ''}">
        <h4>${esc(h.title)}</h4>
        <p>${esc(h.text)}</p>
        <div class="bar"><i style="width:${(ev.have / ev.total) * 100}%"></i></div>
        <p class="meta">${ev.have} of ${ev.total} marked evidence items</p>
        <ul class="evidence">${items}</ul>
        ${s.assessment.closed ? (filed ? '<p class="flag ok">ACCEPTED</p>' : '') : `<button class="btn" data-act="file" data-id="${h.id}">FILE THIS ASSESSMENT</button>`}
      </div>`;
    }).join('');
    const result = this.lastFiled ? `<div class="result ${this.lastFiled.result}">${esc(this.lastFiled.text)}</div>` : '';
    return `<p class="muted">An assessment needs marked evidence. Unmarked discoveries do not count, and tentative interpretations are not facts.</p>${result}${cards}`;
  }
}
