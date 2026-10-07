import { MISSION_01 } from '../src/mission/mission01';
import type { MissionDef } from '../src/mission/missionDef';
import { rings } from '../src/operation/gates';
import type { Capabilities } from '../src/operation/loadout';
import { activeLeg, tickOperation, type OperationState } from '../src/operation/operation';

/** Thread the active leg's rings, straight through each centre. Returns the last position. */
export function threadRings(op: OperationState, cap: Capabilities, def: MissionDef = MISSION_01) {
  const leg = activeLeg(op)!;
  const rs = rings(leg.def);
  let p = { x: rs[0].x - rs[0].nx * 60, y: rs[0].y, z: rs[0].z - rs[0].nz * 60, agl: rs[0].agl };
  tickOperation(op, def, p, 0.1, cap);
  for (const r of rs) {
    for (const k of [-20, 20]) {
      p = { x: r.x + r.nx * k, y: r.y, z: r.z + r.nz * k, agl: r.agl };
      tickOperation(op, def, p, 0.4, cap);
    }
  }
  return p;
}
