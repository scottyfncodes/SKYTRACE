/** The opening screen: the rescue calls waiting, newest first, with what each one opens. */
import { MISSIONS, MISSION_BY_ID, type MissionDef, type MissionId } from '../rescue/missions';
import { isAvailable, nextMission, type Progress } from '../rescue/progress';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderTitle(root: HTMLElement, p: Progress, onPick: (id: MissionId) => void): void {
  const list = root.querySelector<HTMLElement>('#call-list')!;
  const next = nextMission(p);
  const rows: string[] = [];
  for (const m of MISSIONS.filter((x) => x.ready)) {
    const open = isAvailable(p, m);
    const rec = p.done[m.id];
    const lockedBy = m.unlockedBy ? MISSION_BY_ID[m.unlockedBy] : null;
    const badge = rec ? `<span class="c-stars">${'★'.repeat(rec.stars)}${'☆'.repeat(3 - rec.stars)}</span>` : open ? '<span class="c-badge">NEW</span>' : '';
    const sit = open ? esc(m.situation) : `🔒 Complete ${esc(lockedBy?.title ?? '')} to unlock`;
    rows.push(
      `<button type="button" class="call${open ? '' : ' locked'}${open && m.id === next.id && !rec ? ' next' : ''}" data-id="${m.id}"${open ? '' : ' aria-disabled="true"'}>` +
        `<span class="c-icon">${m.icon}</span><span class="c-main"><span class="c-title">${esc(m.title)} ${badge}</span><span class="c-sit">${sit}</span></span>` +
        `${open ? '<span class="c-go">›</span>' : ''}</button>`,
    );
  }
  list.innerHTML = rows.join('');
  for (const b of list.querySelectorAll<HTMLElement>('.call:not(.locked)')) b.addEventListener('click', () => onPick(b.dataset.id as MissionId));
  const coming = MISSIONS.filter((m: MissionDef) => !m.ready);
  root.querySelector<HTMLElement>('#t-coming')!.innerHTML = `More calls on the way: ${coming.map((m) => `<span title="${esc(m.title)}">${m.icon}</span>`).join('')}`;
  root.querySelector<HTMLElement>('#t-saved')!.textContent = p.saved > 0 ? `${p.saved} brought home` : '';
}
