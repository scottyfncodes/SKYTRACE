import { CONTACTS, CONTACT_BY_ID } from '../intel/scenario';
import { markSensorData, noteFor, type IntelEvent, type SaveState, type SensorState } from '../intel/state';
import { gridRef } from '../world/worldData';

export const SENSOR_RANGE = 150; // metres
export const SENSOR_NIGHTS = 3;
export const SENSOR_LINK_RANGE = 380; // aircraft must be this close to download
export const SENSOR_PRELIM_DELAY = 40; // seconds on the ground before a preliminary download is possible

export function targetsInRange(x: number, z: number): string[] {
  return CONTACTS.filter((c) => !c.mobile && Math.hypot(c.x - x, c.z - z) <= SENSOR_RANGE).map((c) => c.id);
}

/** Register a landed sensor package in the investigation state. */
export function registerSensor(s: SaveState, x: number, z: number): SensorState {
  const sensor: SensorState = {
    id: `S-${s.nextSensor++}`,
    x,
    z,
    deployedSortie: s.sortie + 1,
    nightsLeft: SENSOR_NIGHTS,
    targets: targetsInRange(x, z),
    prelim: false,
    reported: false,
    logs: [],
  };
  s.sensors.push(sensor);
  const what = sensor.targets.length ? `within range of ${sensor.targets.map((t) => s.contacts[t].codename || 'an unlogged site').join(', ')}` : 'with no known contact in range';
  noteFor(s, 'sensor', `${sensor.id} deployed at ${gridRef(x, z)}, ${what}. It will listen through the night.`);
  return sensor;
}

/** In-flight preliminary download when the aircraft comes back within link range. */
export function preliminaryDownload(s: SaveState, sensor: SensorState): IntelEvent[] {
  if (sensor.prelim) return [];
  sensor.prelim = true;
  const ev: IntelEvent[] = [];
  const lines: string[] = [];
  for (const t of sensor.targets) {
    const def = CONTACT_BY_ID[t];
    if (def.texts.sensorPrelim) lines.push(def.texts.sensorPrelim);
  }
  if (lines.length === 0) lines.push('Preliminary: no activity within range. Wind, birds, nothing mechanical.');
  for (const l of lines) {
    sensor.logs.push(l);
    noteFor(s, 'sensor', `${sensor.id} link: ${l}`);
  }
  ev.push({ type: 'sensor', text: `${sensor.id} LINK  PRELIMINARY DATA` });
  return ev;
}

/** Called when a sortie ends: a night passes, every live sensor records and reports. */
export function passNight(s: SaveState): IntelEvent[] {
  const ev: IntelEvent[] = [];
  for (const sensor of s.sensors) {
    if (sensor.nightsLeft <= 0) continue;
    sensor.nightsLeft -= 1;
    let any = false;
    for (const t of sensor.targets) {
      const def = CONTACT_BY_ID[t];
      if (def.texts.sensor) {
        any = true;
        const c = s.contacts[t];
        if (!c.sensor) {
          sensor.logs.push(def.texts.sensor);
          ev.push(...markSensorData(s, t));
          ev.push({ type: 'note', text: `${sensor.id}: night report on ${c.codename}` });
        } else {
          sensor.logs.push(`Night ${SENSOR_NIGHTS - sensor.nightsLeft}: activity pattern at ${c.codename} repeats.`);
        }
      }
    }
    if (!any) {
      const line = sensor.targets.length
        ? `Night report: nothing beyond daytime activity near ${sensor.targets.map((t) => s.contacts[t].codename).join(', ')}.`
        : 'Night report: no activity within range. The site is quiet.';
      sensor.logs.push(line);
      noteFor(s, 'sensor', `${sensor.id} ${line}`);
      ev.push({ type: 'note', text: `${sensor.id}: ${line}` });
    }
    sensor.reported = true;
    if (sensor.nightsLeft === 0) noteFor(s, 'system', `${sensor.id} battery exhausted. Its last report is on file.`);
  }
  return ev;
}
