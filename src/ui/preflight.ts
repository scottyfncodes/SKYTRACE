import type { MissionDef } from '../mission/missionDef';
import { AIRCRAFT, AIRCRAFT_BY_ID, CREW, EQUIPMENT, SEAT_LABEL, type EquipmentId, type SeatRole } from '../operation/catalog';
import { isUnlocked, nextUnlock, UNLOCKS, type Career } from '../operation/career';
import { checkLoadout, type Loadout } from '../operation/loadout';

export interface PreflightHandlers {
  onAircraft(id: string): void;
  onCrew(seat: SeatRole, id: string | null): void;
  onEquip(id: EquipmentId): void;
  onLaunch(): void;
  onBack(): void;
}

const lockLabel = (id?: string) => {
  const u = UNLOCKS.find((x) => x.id === id);
  return u ? `LOCKED · ${u.xp} XP` : 'LOCKED';
};

/**
 * PREFLIGHT: understand the operation, then choose aircraft, crew and
 * equipment. The capability checklist ties the choice back to the objective.
 */
export class Preflight {
  private el: Record<string, HTMLElement> = {};

  constructor(private root: HTMLElement, h: PreflightHandlers) {
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['pf-career', 'pf-brief', 'pf-aircraft', 'pf-crew', 'pf-equip', 'pf-slots', 'pf-check', 'btn-launch', 'btn-pf-back']) this.el[id] = q(id);
    this.el['btn-launch'].addEventListener('click', () => h.onLaunch());
    this.el['btn-pf-back'].addEventListener('click', () => h.onBack());
    root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
      if (!t || t.classList.contains('locked')) return;
      const [kind, a, b] = t.dataset.pick!.split(':');
      if (kind === 'aircraft') h.onAircraft(a);
      else if (kind === 'equip') h.onEquip(a as EquipmentId);
      else if (kind === 'crew') h.onCrew(a as SeatRole, b === '-' ? null : b);
    });
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.root.querySelector('.pf-body')?.scrollTo(0, 0);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  render(def: MissionDef, career: Career, l: Loadout): void {
    const B = def.briefing;
    const unlocked = (id?: string) => isUnlocked(career, id);
    const nu = nextUnlock(career);
    this.el['pf-career'].textContent = `${career.credits} CR · ${career.xp} XP · ${career.operations} OPS${nu ? ` · NEXT: ${nu.label.split(' ·')[0]} AT ${nu.xp} XP` : ''}`;

    // ---- the operation (objective first, everything else in support)
    this.el['pf-brief'].innerHTML = `
      <p class="pf-code">${def.code} · ${def.title}</p>
      <h2>${B.headline}</h2>
      <div class="pf-primary"><label>PRIMARY</label><p>${B.primary}</p></div>
      <div class="pf-row"><label>SECONDARY</label><ul>${B.secondaries.map((x) => `<li>${x}</li>`).join('')}</ul></div>
      <div class="pf-row"><label>INTEL</label><ul>${def.intel.map((x) => `<li>${x}</li>`).join('')}</ul></div>
      <div class="pf-row"><label>TARGET AREA</label><p>${B.targetArea}</p></div>
      <div class="pf-row"><label>WEATHER</label><p>${B.weather}</p></div>
      <div class="pf-row"><label>EXPECTED</label><p>${B.conditions}</p></div>
      <div class="pf-row"><label>WINDOW</label><p>${B.window}</p></div>
      <div class="pf-row"><label>CONSTRAINTS</label><ul>${B.constraints.map((x) => `<li>${x}</li>`).join('')}</ul></div>
      <div class="pf-row"><label>THREATS</label><ul>${B.threats.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;

    // ---- aircraft
    this.el['pf-aircraft'].innerHTML = AIRCRAFT.map((a) => {
      const lock = !unlocked(a.unlock);
      const on = a.id === l.aircraft;
      const crewTxt = a.seats.length ? `${a.seats.length + 1} CREW` : 'SINGLE SEAT';
      return `<button type="button" class="pf-card${on ? ' on' : ''}${lock ? ' locked' : ''}" data-pick="aircraft:${a.id}" aria-pressed="${on}">
        <b>${a.name}</b><span class="pf-sub">${a.role}</span>
        <span class="pf-stats"><i>${crewTxt}</i><i>${a.slots} BAYS</i><i>FUEL ${Math.floor(a.fuelSeconds / 60)}:${String(a.fuelSeconds % 60).padStart(2, '0')}</i><i>STEALTH ${a.stealthCeiling} m</i></span>
        ${lock ? `<em class="lock">${lockLabel(a.unlock)}</em>` : `<ul>${a.notes.map((n) => `<li>${n}</li>`).join('')}</ul>`}
      </button>`;
    }).join('');

    // ---- crew: one row per seat of the chosen aircraft
    const ac = AIRCRAFT_BY_ID[l.aircraft];
    this.el['pf-crew'].innerHTML = ac.seats.length
      ? ac.seats
          .map((seat) => {
            const options = CREW.filter((c) => c.role === seat);
            const cur = l.crew[seat] ?? null;
            return `<div class="pf-seat"><label>${SEAT_LABEL[seat]}</label><div class="pf-seat-opts">
              <button type="button" class="pf-chip${cur === null ? ' on' : ''}" data-pick="crew:${seat}:-">EMPTY</button>
              ${options
                .map((c) => {
                  const lock = !unlocked(c.unlock);
                  const sk = Object.entries(c.skills).map(([k, v]) => `${k.slice(0, 3).toUpperCase()} ${'●'.repeat(v ?? 0)}`).join(' · ');
                  return `<button type="button" class="pf-chip crew${cur === c.id ? ' on' : ''}${lock ? ' locked' : ''}" data-pick="crew:${seat}:${c.id}"><b>${c.name}</b><small>${lock ? lockLabel(c.unlock) : sk}</small>${lock ? '' : `<em>${c.note}</em>`}</button>`;
                })
                .join('')}
            </div></div>`;
          })
          .join('')
      : '<p class="pf-note">Single seat: you fly and operate the sensors yourself. On station the autopilot flies a wide orbit.</p>';

    // ---- equipment
    this.el['pf-slots'].textContent = `${l.equipment.length}/${ac.slots} BAYS`;
    this.el['pf-equip'].innerHTML = EQUIPMENT.map((e) => {
      const lock = !unlocked(e.unlock);
      const on = l.equipment.includes(e.id);
      return `<button type="button" class="pf-card eq${on ? ' on' : ''}${lock ? ' locked' : ''}" data-pick="equip:${e.id}" aria-pressed="${on}">
        <b>${e.name}</b><span class="pf-sub">${e.answers}</span>${lock ? `<em class="lock">${lockLabel(e.unlock)}</em>` : `<span class="pf-limit">${e.limits}</span>`}
      </button>`;
    }).join('');

    // ---- can this plan do the job?
    const chk = checkLoadout(l, unlocked);
    this.el['pf-check'].innerHTML =
      `<ul>${chk.items.map((i) => `<li class="${i.ok ? 'ok' : i.required ? 'no' : 'opt'}">${i.ok ? '✓' : i.required ? '✕' : '·'} ${i.label}</li>`).join('')}</ul>` + (chk.ok ? '' : `<p class="why">${chk.reason}</p>`);
    this.el['btn-launch'].toggleAttribute('disabled', !chk.ok);
    this.el['btn-launch'].classList.toggle('disabled', !chk.ok);
  }
}
