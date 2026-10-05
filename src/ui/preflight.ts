import type { MissionDef } from '../mission/missionDef';
import { AIRCRAFT, AIRCRAFT_BY_ID, CREW, EQUIPMENT, SEAT_LABEL, type AircraftDef, type EquipmentId, type SeatRole } from '../operation/catalog';
import { isUnlocked, UNLOCKS, type Career } from '../operation/career';
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

/** 0..1 bars: glanceable differences instead of paragraphs. */
export function aircraftBars(a: AircraftDef): { label: string; v: number }[] {
  const c = (v: number) => Math.max(0.08, Math.min(1, v));
  return [
    { label: 'SPEED', v: c(a.perf.maxSpeed / 92) },
    { label: 'RANGE', v: c(a.fuelSeconds / 720) },
    { label: 'STEALTH', v: c((a.stealthCeiling - 150) / 300) },
    { label: 'WEATHER', v: c(a.weatherTolerance) },
  ];
}

/**
 * PREFLIGHT: one glance at the job, three picks, take off. The full
 * briefing is there for those who want it, folded away.
 */
export class Preflight {
  private el: Record<string, HTMLElement> = {};
  private briefOpen = false;

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
    root.addEventListener('toggle', (e) => {
      if ((e.target as HTMLElement).id === 'pf-more') this.briefOpen = (e.target as HTMLDetailsElement).open;
    }, true);
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
    this.el['pf-career'].textContent = career.operations ? `${career.credits} CR · ${career.xp} XP` : '';

    // ---- the job, at a glance
    this.el['pf-brief'].innerHTML = `
      <p class="pf-code">${def.code}</p>
      <h2>${B.headline}</h2>
      <p class="pf-goal">${B.primary}</p>
      <div class="pf-clues">${def.clues.map((c) => `<span>${c}</span>`).join('')}</div>
      <ul class="pf-risks">${def.risks.map((r) => `<li><i>${r.icon}</i>${r.text}</li>`).join('')}</ul>
      <details id="pf-more"${this.briefOpen ? ' open' : ''}><summary>FULL BRIEFING</summary>
        <p><b>Intel.</b> ${def.intel.join(' ')}</p>
        <p><b>Weather.</b> ${B.weather} ${B.conditions}</p>
        <p><b>Constraints.</b> ${B.constraints.join('. ')}.</p>
        <p><b>Threats.</b> ${B.threats.join('. ')}.</p>
      </details>`;

    // ---- aircraft: bars, not bullet points
    this.el['pf-aircraft'].innerHTML = AIRCRAFT.map((a) => {
      const lock = !unlocked(a.unlock);
      const on = a.id === l.aircraft;
      const seats = a.seats.length + 1;
      return `<button type="button" class="pf-card ac${on ? ' on' : ''}${lock ? ' locked' : ''}" data-pick="aircraft:${a.id}" aria-pressed="${on}">
        <b>${a.name}</b><span class="pf-sub">${seats === 1 ? 'SOLO' : `${seats} CREW`} · ${a.slots} BAYS</span>
        ${lock ? `<em class="lock">${lockLabel(a.unlock)}</em>` : `<span class="bars">${aircraftBars(a).map((b) => `<span class="bar"><label>${b.label}</label><i style="--v:${b.v}"></i></span>`).join('')}</span>`}
      </button>`;
    }).join('');

    // ---- crew: a short tag per person
    const ac = AIRCRAFT_BY_ID[l.aircraft];
    this.el['pf-crew'].parentElement!.classList.toggle('hidden', ac.seats.length === 0);
    this.el['pf-crew'].innerHTML = ac.seats
      .map((seat) => {
        const cur = l.crew[seat] ?? null;
        const options = CREW.filter((c) => c.role === seat);
        return `<div class="pf-seat"><label>${SEAT_LABEL[seat]}</label><div class="pf-seat-opts">
          <button type="button" class="pf-chip${cur === null ? ' on' : ''}" data-pick="crew:${seat}:-">NONE</button>
          ${options
            .map((c) => {
              const lock = !unlocked(c.unlock);
              return `<button type="button" class="pf-chip crew${cur === c.id ? ' on' : ''}${lock ? ' locked' : ''}" data-pick="crew:${seat}:${c.id}"><b>${c.name}</b><small>${lock ? lockLabel(c.unlock) : c.tag}</small></button>`;
            })
            .join('')}
        </div></div>`;
      })
      .join('');

    // ---- equipment
    this.el['pf-slots'].textContent = `${l.equipment.length}/${ac.slots}`;
    this.el['pf-equip'].innerHTML = EQUIPMENT.map((e) => {
      const lock = !unlocked(e.unlock);
      const on = l.equipment.includes(e.id);
      return `<button type="button" class="pf-chip eq${on ? ' on' : ''}${lock ? ' locked' : ''}" data-pick="equip:${e.id}" aria-pressed="${on}"><b>${e.name}</b><small>${lock ? lockLabel(e.unlock) : e.tag}</small></button>`;
    }).join('');

    // ---- one line: ready, or what is missing
    const chk = checkLoadout(l, unlocked);
    // ready, but with a blind spot: one look-alike can only be told apart by the optical camera
    const advice = chk.ok && !l.equipment.includes('optical') ? `<p class="advice">⚠ NO OPTICAL · CAN'T CHECK ROADS</p>` : '';
    this.el['pf-check'].innerHTML = chk.ok ? `<p class="ready">✓ READY</p>${advice}` : `<p class="why">${chk.reason}</p>`;
    this.el['btn-launch'].toggleAttribute('disabled', !chk.ok);
    this.el['btn-launch'].classList.toggle('disabled', !chk.ok);
  }
}
