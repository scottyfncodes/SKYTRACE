/**
 * Pre-Flight: what happened, what you are dealing with, what you send.
 * Readable in a few seconds: the situation and conditions on the left with a
 * map, three rows of big cards on the right, one LAUNCH button.
 */
import { CREW, EQUIPMENT, VEHICLES, VEHICLE_BY_ID, EQUIPMENT_BY_ID, CREW_BY_ID, type CrewId, type EquipmentId, type VehicleId } from '../rescue/catalog';
import { canLaunch, checkLoadout, type Loadout } from '../rescue/loadout';
import { compassWord, MISSION_BY_ID, VISIBILITY_WORD, windWord, type MissionDef } from '../rescue/missions';
import { isAvailable, isOpen, type Progress } from '../rescue/progress';
import { drawBriefingMap } from './valleyMap';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PreflightHandlers {
  onVehicle(id: VehicleId): void;
  onCrew(id: CrewId): void;
  onEquip(id: EquipmentId): void;
  onLaunch(): void;
  onBack(): void;
  onTap(): void;
}

export class PreflightView {
  private def: MissionDef | null = null;
  private q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;

  constructor(
    private root: HTMLElement,
    h: PreflightHandlers,
  ) {
    this.q('btn-pf-back').addEventListener('click', () => h.onBack());
    this.q('btn-launch').addEventListener('click', () => h.onLaunch());
    const pick = (rowId: string, fn: (id: string) => void) =>
      this.q(rowId).addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.opt');
        if (!b || b.classList.contains('locked')) return;
        h.onTap();
        fn(b.dataset.id!);
      });
    pick('pf-vehicles', (id) => h.onVehicle(id as VehicleId));
    pick('pf-crew', (id) => h.onCrew(id as CrewId));
    pick('pf-equip', (id) => h.onEquip(id as EquipmentId));
  }

  /** Show a mission's situation (once per mission). */
  open(def: MissionDef): void {
    this.def = def;
    this.q('pf-icon').textContent = def.icon;
    this.q('pf-title').textContent = def.title;
    this.q('pf-situation').textContent = def.situation;
    this.q('pf-place').textContent = `📍 ${def.place}`;
    const windy = def.wind.speed >= 9 ? 'c-bad' : def.wind.speed >= 5 ? 'c-warn' : '';
    const vis = def.visibility === 'poor' ? 'c-bad' : def.visibility === 'fair' ? 'c-warn' : '';
    const conds = [
      { i: def.type === 'forest' ? '🌲' : '⛰️', t: def.type === 'forest' ? def.terrain : `${def.terrain} · ${def.elevation} m`, c: def.elevation > 250 ? 'c-warn' : '' },
      { i: '💨', t: `${windWord(def.wind.speed)}${def.wind.speed >= 2 ? ` · ${compassWord(def.wind.from)}` : ''}`, c: windy },
      { i: '👥', t: def.survivors === 1 ? '1 person' : `${def.survivors} people`, c: def.survivors > 2 ? 'c-warn' : '' },
      { i: def.visibility === 'poor' ? '☁️' : '👁️', t: VISIBILITY_WORD[def.visibility], c: vis },
    ];
    this.q('pf-conditions').innerHTML = conds.map((c) => `<div class="cond ${c.c}"><i>${c.i}</i>${esc(c.t)}</div>`).join('');
    const r = def.recommended;
    const kit = r.equipment.map((e) => `${EQUIPMENT_BY_ID[e].icon} ${EQUIPMENT_BY_ID[e].name}`).join(' · ');
    this.q('pf-recommended').innerHTML = `<b>RECOMMENDED</b> ${VEHICLE_BY_ID[r.vehicle].icon} ${esc(VEHICLE_BY_ID[r.vehicle].name)} · ${esc(kit)} · ${CREW_BY_ID[r.crew].icon} ${esc(CREW_BY_ID[r.crew].role)}`;
    this.root.querySelector('.pf-left')!.scrollTop = 0;
    this.root.querySelector('.pf-right')!.scrollTop = 0;
  }

  /** Redraw the choices for the current plan. */
  render(l: Loadout, p: Progress): void {
    const def = this.def;
    if (!def) return;
    const r = def.recommended;
    const lockLine = (by?: string) => (by ? `🔒 Complete ${esc(MISSION_BY_ID[by as keyof typeof MISSION_BY_ID].title)}` : '🔒 Coming soon');
    this.q('pf-vehicles').innerHTML = VEHICLES.map((v) => {
      const open = isAvailable(p, v);
      const tags = v.capacity > 0 ? [`Seats ${v.capacity}`, ...v.strengths.slice(0, 2)] : v.strengths.slice(0, 3);
      return `<button type="button" class="opt${l.vehicle === v.id ? ' on' : ''}${open ? '' : ' locked'}" data-id="${v.id}">${open && r.vehicle === v.id ? '<span class="o-rec">★ BEST FIT</span>' : ''}<span class="o-top"><span class="o-icon">${v.icon}</span><span class="o-name">${esc(v.name)}</span></span><span class="o-line">${open ? esc(v.tagline) : lockLine(v.ready ? v.unlockedBy : undefined)}</span>${open ? `<span class="o-tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span>` : ''}</button>`;
    }).join('');
    this.q('pf-crew').innerHTML = CREW.map((c) => {
      const open = isOpen(p, c);
      return `<button type="button" class="opt${l.crew === c.id ? ' on' : ''}${open ? '' : ' locked'}" data-id="${c.id}">${open && r.crew === c.id ? '<span class="o-rec">★ BEST FIT</span>' : ''}<span class="o-top"><span class="o-icon">${c.icon}</span><span class="o-name">${esc(c.role)}<br><small>${esc(c.name)}</small></span></span><span class="o-line">${open ? esc(c.perk) : lockLine(c.unlockedBy)}</span></button>`;
    }).join('');
    const slots = VEHICLE_BY_ID[l.vehicle].slots;
    this.q('pf-slots').textContent = `· ${l.equipment.length} of ${slots} slots`;
    const shown = EQUIPMENT.filter((e) => e.ready || e.id === 'swimmer' || e.id === 'bucket');
    this.q('pf-equip').innerHTML = shown
      .map((e) => {
        const open = isAvailable(p, e);
        return `<button type="button" class="opt${l.equipment.includes(e.id) ? ' on' : ''}${open ? '' : ' locked'}" data-id="${e.id}">${open && r.equipment.includes(e.id) ? '<span class="o-rec">★ BEST FIT</span>' : ''}<span class="o-top"><span class="o-icon">${e.icon}</span><span class="o-name">${esc(e.name)}</span></span><span class="o-line">${open ? esc(e.does) : lockLine(e.ready ? e.unlockedBy : undefined)}</span></button>`;
      })
      .join('');
    const notes = checkLoadout(def, l);
    const ok = canLaunch(def, l);
    this.q('pf-notes').innerHTML = notes.length ? notes.map((n) => `<span class="n${n.blocking ? ' block' : ''}">${n.blocking ? '⛔' : '⚠️'} ${esc(n.text)}</span>`).join('') : '<span class="n ok">✅ Ready for the job</span>';
    (this.q('btn-launch') as HTMLButtonElement).disabled = !ok;
  }

  /** Keep the map's search area breathing while Pre-Flight is up. */
  tick(t: number): void {
    if (this.def) drawBriefingMap(this.q('pf-map') as HTMLCanvasElement, this.def, t);
  }
}
