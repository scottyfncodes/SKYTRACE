import * as THREE from 'three';
import { AudioSystem } from '../core/audio';
import { Input } from '../core/input';
import { clamp } from '../core/math';
import { loadPrefs, savePrefs, type Prefs, type VerticalMode } from '../core/settings';
import { FLIGHT, initialAircraft, stepAircraft, type AircraftState } from '../flight/aircraft';
import { AircraftMesh } from '../flight/aircraftMesh';
import { ChaseCamera } from '../flight/camera';
import { BRIEFING, CONTACTS, CONTACT_BY_ID } from '../intel/scenario';
import {
  addCoverage,
  capabilities,
  clear as clearSave,
  isKnown,
  load,
  markContact,
  markDetected,
  markObserved,
  markResolved,
  newState,
  noteFor,
  save,
  stageOf,
  type IntelEvent,
  type SaveState,
} from '../intel/state';
import { passNight, preliminaryDownload, registerSensor, SENSOR_LINK_RANGE, SENSOR_PRELIM_DELAY } from '../sensors/equipment';
import { SensorPackage } from '../sensors/packageMesh';
import { canObserve, canResolve, detectionGain, DETECT_THRESHOLD, radarParams, RESOLVE_THRESHOLD, uncertaintyFor } from '../sensors/radar';
import { Hud, type HudFrame, type ScopeContact } from '../ui/hud';
import { IntelMap } from '../ui/intelMap';
import { buildProps, buildTrees, updateProps, type WorldProps } from '../world/props';
import { createScene, type SceneBundle } from '../world/scene';
import { TruckMesh, TruckSim } from '../world/truck';
import { BASE, RUNWAY, gridRef } from '../world/worldData';
import { DESTINATION, MISSION_01, RETURNS, SECTOR_7, TARGET_SPEED_TO_DESTINATION, type ReturnId } from '../mission/mission01';
import {
  buildDebrief,
  describeReturn,
  destinationRoute,
  fail as failMission,
  identify,
  inSector,
  isActive,
  land as landMission,
  MARK_RANGE,
  MISSION_RATE,
  newMission,
  objectiveFor,
  RETURN_BY_ID,
  scanReturn,
  TARGET,
  updateDestination,
  type MissionEvent,
  type MissionState,
} from '../mission/mission';
import { MissionScene } from '../mission/missionScene';
import { RouteMover } from '../mission/vehicles';
import { pauseTransition, type Mode } from './modes';

const SORTIE_FUEL = 330; // seconds of flight on the standard fit

export class Game {
  private bundle: SceneBundle;
  private props: WorldProps;
  private truck = new TruckSim(3);
  private truckMesh = new TruckMesh();
  private plane = new AircraftMesh();
  private chase = new ChaseCamera();
  private input: Input;
  private audio = new AudioSystem();
  private hud: Hud;
  private intel: IntelMap;
  private state: SaveState;
  private mode: Mode = 'title';
  private a: AircraftState;
  private scanning = false;
  private sweep = 0;
  private sweepTicks = 0;
  private fuel = SORTIE_FUEL;
  private fuelMax = SORTIE_FUEL;
  private sensorsLeft = 1;
  private packages: SensorPackage[] = [];
  private groundTime = new Map<string, number>();
  private path: number[] = [];
  private pathTimer = 0;
  private sortieTime = 0;
  private noteStart = 0;
  private observeTimer = new Map<string, number>();
  private blipTimer = 0;
  private mobileUpdateTimer = 0;
  private saveTimer = 0;
  private pins = new Map<string, THREE.Group>();
  private waypointBeam: THREE.Mesh;
  private radarRing: THREE.Group;
  private radarDisc: THREE.Mesh;
  private radarWedge: THREE.Mesh;
  private t = 0;
  private last = 0;
  private hintTimer = 0;
  private hintIdx = 0;
  private el: Record<string, HTMLElement> = {};
  private raf = 0;
  private intelMode: 'debrief' | 'planning' | 'inflight' = 'planning';
  private prefs: Prefs;
  /** Which game is being played: the short, objective-led Mission 01, or the open Varrow Basin case. */
  private play: 'mission' | 'case' = 'mission';
  private mission: MissionState = newMission();
  private movers = new Map<ReturnId, RouteMover>();
  private missionScene: MissionScene;

  constructor(root: HTMLElement) {
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['gl', 'hud', 'intel', 'title', 'pause', 'hint', 'btn-begin', 'btn-continue', 'btn-newcase-title', 'stick-zone', 'stick-knob', 'throttle', 'btn-scan', 'btn-mark', 'btn-drop', 'btn-map', 'btn-pause', 'btn-rtb', 'btn-resume-pause', 'btn-map-pause', 'btn-end-sortie', 'btn-sound-pause', 'loading', 'btn-mission', 'btn-open-case', 'btn-case-back', 'mission-card', 'case-card', 'mission-brief', 'debrief', 'btn-fly-again', 'btn-debrief-menu', 'db-headline', 'db-rows', 'db-findings', 'pause-objective']) {
      this.el[id] = q(id);
    }
    const canvas = this.el['gl'] as HTMLCanvasElement;
    this.bundle = createScene(canvas);
    const hf = this.bundle.heightField;
    this.props = buildProps(hf);
    this.bundle.scene.add(this.props.group);
    this.bundle.scene.add(buildTrees(hf));
    this.bundle.scene.add(this.truckMesh.group);
    this.bundle.scene.add(this.plane.group);
    this.missionScene = new MissionScene(SECTOR_7, hf);
    this.bundle.scene.add(this.missionScene.group);

    // radar footprint visual
    this.radarRing = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 72), ringMat);
    ring.rotation.x = -Math.PI / 2;
    this.radarDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.07, depthTest: false }));
    this.radarDisc.rotation.x = -Math.PI / 2;
    this.radarWedge = new THREE.Mesh(new THREE.CircleGeometry(1, 24, 0, 0.45), new THREE.MeshBasicMaterial({ color: 0xa8ffbe, transparent: true, opacity: 0.22, depthTest: false, side: THREE.DoubleSide }));
    this.radarWedge.rotation.x = -Math.PI / 2;
    this.radarRing.add(ring, this.radarDisc, this.radarWedge);
    this.radarRing.renderOrder = 10;
    this.radarRing.visible = false;
    this.bundle.scene.add(this.radarRing);

    this.waypointBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 420, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    this.waypointBeam.visible = false;
    this.bundle.scene.add(this.waypointBeam);

    this.input = new Input(this.el['stick-zone'], this.el['stick-knob'], this.el['throttle']);
    this.prefs = loadPrefs(localStorage);
    this.input.verticalMode = this.prefs.verticalMode;
    this.hud = new Hud(this.el['hud']);
    this.intel = new IntelMap(this.el['intel'], {
      onClose: () => this.closeIntel(),
      onWaypoint: (id) => {
        this.state.waypoint = id;
        this.updateWaypointBeam();
        this.persist();
      },
      onFiled: (result) => {
        if (result === 'accepted') this.audio.unlockSound();
        else this.audio.warn();
        this.persist();
      },
      onNewCase: () => this.newCase(),
      onToggleSound: () => {
        this.audio.setMuted(!this.audio.muted);
        return this.audio.muted;
      },
      isMuted: () => this.audio.muted,
    });

    this.state = load(localStorage) ?? newState();
    this.a = initialAircraft(RUNWAY.x1 + 16, hf.sample(RUNWAY.x1 + 16, RUNWAY.z) + 2, RUNWAY.z, BASE.heading);

    // actions
    this.input.bindButton(this.el['btn-scan'], 'scan');
    this.input.bindButton(this.el['btn-mark'], 'mark');
    this.input.bindButton(this.el['btn-drop'], 'drop');
    this.input.bindButton(this.el['btn-map'], 'map', 'click');
    this.input.bindButton(this.el['btn-pause'], 'pause', 'click');
    this.input.bindButton(this.el['btn-rtb'], 'rtb', 'click');
    this.input.onAction('scan', () => this.toggleScan());
    this.input.onAction('mark', () => this.doMark());
    this.input.onAction('drop', () => this.doDrop());
    this.input.onAction('map', () => this.openIntel('inflight'));
    this.input.onAction('pause', () => this.togglePause());
    this.input.onAction('rtb', () => this.tryReturn());

    this.el['btn-mission'].addEventListener('click', () => this.startMission());
    this.el['btn-open-case'].addEventListener('click', () => this.showCaseCard(true));
    this.el['btn-case-back'].addEventListener('click', () => this.showCaseCard(false));
    this.el['btn-fly-again'].addEventListener('click', () => this.startMission());
    this.el['btn-debrief-menu'].addEventListener('click', () => this.showTitle());
    this.el['btn-begin'].addEventListener('click', () => this.begin(false));
    this.el['btn-continue'].addEventListener('click', () => this.begin(true));
    this.el['btn-newcase-title'].addEventListener('click', () => {
      if (confirm('Erase the saved investigation and start again?')) {
        this.newCase(false);
        this.begin(false);
      }
    });
    this.el['btn-resume-pause'].addEventListener('click', () => this.togglePause());
    this.el['btn-map-pause'].addEventListener('click', () => {
      this.el['pause'].classList.add('hidden');
      this.openIntel('inflight');
    });
    this.el['btn-end-sortie'].addEventListener('click', () => (this.play === 'mission' ? this.endMission('aborted') : this.endSortie('recalled')));
    this.el['btn-sound-pause'].addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.el['btn-sound-pause'].textContent = this.audio.muted ? 'SOUND OFF' : 'SOUND ON';
    });

    // flight-control preference (lives in the pause card)
    for (const b of root.querySelectorAll<HTMLElement>('[data-vert]')) {
      b.addEventListener('click', () => this.setVerticalMode(b.dataset.vert as VerticalMode));
    }
    this.renderPrefs();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.persist();
        if (this.mode === 'flight') this.togglePause();
      }
    });
    window.addEventListener('pagehide', () => this.persist());

    this.showTitle();
    this.resize();
    this.el['loading'].classList.add('hidden');
    // QA hook: lets automated play-tests position the aircraft without faking any game logic.
    (window as unknown as { __skytrace: unknown }).__skytrace = {
      teleport: (x: number, z: number, agl: number, headingDeg?: number) => {
        this.a.x = x;
        this.a.z = z;
        this.a.y = this.bundle.heightField.sample(x, z) + agl;
        if (headingDeg !== undefined) this.a.yaw = (-headingDeg * Math.PI) / 180;
        this.sortieTime = Math.max(this.sortieTime, 5);
      },
      getState: () => this.state,
      getAircraft: () => this.a,
      getMode: () => this.mode,
      getTime: () => this.sortieTime,
      getPrefs: () => ({ ...this.prefs }),
      getTruck: () => ({ x: this.truck.x, z: this.truck.z, hidden: this.truck.hidden, moving: this.truck.moving }),
      getPlay: () => this.play,
      getMission: () => this.mission,
      getReturns: () => [...this.movers].map(([id, m]) => ({ id, x: m.x, z: m.z, moving: m.moving, arrived: m.arrived })),
      getFuel: () => this.fuel,
    };
    this.last = performance.now();
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  // ------------------------------------------------------------------ screens
  private showTitle(): void {
    this.mode = 'title';
    this.el['debrief'].classList.add('hidden');
    this.el['pause'].classList.add('hidden');
    this.missionScene.group.visible = false;
    this.hud.clearBanners();
    const M = MISSION_01;
    this.el['mission-brief'].innerHTML =
      `<h2>${M.code}: ${M.title}</h2>` +
      `<div class="mb-block"><label>OBJECTIVE</label><p class="mb-objective">${M.objective}</p></div>` +
      `<div class="mb-block"><label>SUCCESS</label><p>${M.success}</p></div>` +
      `<div class="mb-block"><label>KNOWN INTEL</label><ul>${M.intel.map((l) => `<li>${l}</li>`).join('')}</ul></div>` +
      `<p class="mb-controls">${this.input.isTouch ? 'Drag left side to fly · throttle on the right · SCAN searches · MARK identifies' : 'Arrows / WASD fly · Shift / Ctrl throttle · Space scans · M marks · Esc pauses'}</p>`;
    this.showCaseCard(false);
    const hasSave = this.state.sortie > 0 || this.state.notes.length > 0;
    this.el['btn-continue'].classList.toggle('hidden', !hasSave);
    this.el['btn-newcase-title'].classList.toggle('hidden', !hasSave);
    this.el['btn-begin'].classList.toggle('hidden', hasSave);
    this.el['title'].classList.remove('hidden');
    this.el['hud'].classList.add('hidden');
    this.intel.close();
    const brief = this.el['title'].querySelector<HTMLElement>('#brief')!;
    brief.innerHTML = `<h2>${BRIEFING.title}</h2>${BRIEFING.lines.map((l) => `<p>${l}</p>`).join('')}`;
    if (hasSave) brief.innerHTML += `<p class="status">${this.state.sortie} sortie${this.state.sortie === 1 ? '' : 's'} flown · ${Object.values(this.state.contacts).filter(isKnown).length} contacts logged${this.state.assessment.closed ? ' · CASE CLOSED' : ''}</p>`;
    // idle camera over the basin
    this.bundle.camera.position.set(-300, 420, 900);
    this.bundle.camera.up.set(0, 1, 0);
    this.bundle.camera.lookAt(200, 40, -100);
  }

  private showCaseCard(on: boolean): void {
    this.el['mission-card'].classList.toggle('hidden', on);
    this.el['case-card'].classList.toggle('hidden', !on);
  }

  private begin(continuing: boolean): void {
    this.audio.unlock();
    this.el['title'].classList.add('hidden');
    if (!continuing || this.state.sortie === 0) {
      if (!this.state.seenIntro) {
        this.state.seenIntro = true;
        noteFor(this.state, 'system', `Assignment received. ${BRIEFING.firstLead}`);
      }
      this.startSortie();
    } else {
      this.openIntel('planning');
    }
  }

  private newCase(restart = true): void {
    clearSave(localStorage);
    this.state = newState();
    for (const p of this.pins.values()) this.bundle.scene.remove(p);
    this.pins.clear();
    this.intel.close();
    this.el['pause'].classList.add('hidden');
    if (restart) this.showTitle();
  }

  private openIntel(mode: 'debrief' | 'planning' | 'inflight', fresh: string[] = []): void {
    if (mode === 'inflight' && (this.mode !== 'flight' || this.play === 'mission')) return;
    this.mode = 'intel';
    this.el['hud'].classList.add('hidden');
    this.intel.open(this.state, mode, fresh);
    this.audio.updateFlight(0, 0, false, false);
    this.intelMode = mode;
  }

  private closeIntel(): void {
    const lastMode = this.intelMode;
    this.intel.close();
    this.audio.unlock();
    if (lastMode === 'inflight') {
      this.mode = 'flight';
      this.el['hud'].classList.remove('hidden');
      this.last = performance.now();
    } else {
      this.startSortie();
    }
    this.updateWaypointBeam();
  }

  private setVerticalMode(mode: VerticalMode): void {
    if (mode !== 'standard' && mode !== 'inverted') return;
    this.prefs.verticalMode = mode;
    this.input.verticalMode = mode; // takes effect on the very next frame
    savePrefs(this.prefs, localStorage);
    this.audio.click();
    this.renderPrefs();
  }

  private renderPrefs(): void {
    const mode = this.prefs.verticalMode;
    for (const b of this.el['pause'].querySelectorAll<HTMLElement>('[data-vert]')) {
      const on = b.dataset.vert === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    const note = this.el['pause'].querySelector<HTMLElement>('#vert-note');
    if (note) note.textContent = mode === 'inverted' ? 'Stick up / \u2191 dives \u00b7 stick down climbs' : 'Stick up / \u2191 climbs';
  }

  private togglePause(): void {
    const next = pauseTransition(this.mode);
    if (next === 'paused') {
      this.mode = 'paused';
      const mission = this.play === 'mission';
      const ob = objectiveFor(this.mission, this.movers.get(TARGET.id)?.arrived);
      this.el['pause-objective'].classList.toggle('hidden', !mission);
      this.el['pause-objective'].innerHTML = mission ? `<i class="reticle"></i><b>${ob.title}</b><small>${ob.detail}</small>` : '';
      this.el['btn-map-pause'].classList.toggle('hidden', mission);
      this.el['btn-end-sortie'].textContent = mission ? 'ABORT MISSION' : 'END SORTIE · RETURN TO BASE';
      this.el['pause'].classList.remove('hidden');
      this.el['btn-sound-pause'].textContent = this.audio.muted ? 'SOUND OFF' : 'SOUND ON';
      this.audio.updateFlight(0, 0, false, false);
    } else if (next === 'flight') {
      this.mode = 'flight';
      this.el['pause'].classList.add('hidden');
      this.last = performance.now();
      this.audio.unlock();
    }
  }

  // ------------------------------------------------------------------ sorties
  private startSortie(): void {
    const hf = this.bundle.heightField;
    const cap = capabilities(this.state);
    this.play = 'case';
    this.missionScene.group.visible = false;
    this.el['hud'].classList.remove('mission');
    this.hud.clearBanners();
    this.a = initialAircraft(RUNWAY.x1 + 16, hf.sample(RUNWAY.x1 + 16, RUNWAY.z) + 2, RUNWAY.z, BASE.heading);
    this.a.speed = 40;
    this.a.throttle = 0.8;
    this.fuelMax = SORTIE_FUEL * cap.fuelMult;
    this.fuel = this.fuelMax;
    this.sensorsLeft = cap.sensorsPerSortie;
    this.scanning = false;
    this.radarRing.visible = false;
    this.path = [];
    this.pathTimer = 0;
    this.sortieTime = 0;
    this.noteStart = this.state.notes.length;
    this.observeTimer.clear();
    this.hintTimer = 0;
    this.hintIdx = 0;
    this.chase.reset();
    this.truck = new TruckSim(3 + (this.state.sortie * 5) % 18);
    // sensors already on the ground
    for (const p of this.packages) this.bundle.scene.remove(p.group);
    this.packages = [];
    this.groundTime.clear();
    for (const sn of this.state.sensors) {
      const p = SensorPackage.landedAt(sn.x, sn.z, hf, sn.id);
      this.packages.push(p);
      this.bundle.scene.add(p.group);
      this.groundTime.set(sn.id, 999);
    }
    this.refreshPins();
    this.updateWaypointBeam();
    this.mode = 'flight';
    this.el['hud'].classList.remove('hidden');
    this.el['pause'].classList.add('hidden');
    this.intel.close();
    this.hud.message(`SORTIE ${this.state.sortie + 1} · WHEELS UP`, 'sys');
    if (this.state.sortie === 0) this.hud.message(BRIEFING.firstLead, 'sys');
    this.last = performance.now();
  }

  private endSortie(reason: 'landed' | 'fuel' | 'recalled'): void {
    if (this.mode !== 'flight' && this.mode !== 'paused') return;
    this.el['pause'].classList.add('hidden');
    this.scanning = false;
    this.radarRing.visible = false;
    const s = this.state;
    s.sortie += 1;
    if (this.path.length > 4) {
      s.paths.push(this.path);
      if (s.paths.length > 3) s.paths.shift();
    }
    const why = reason === 'landed' ? 'landed at base' : reason === 'fuel' ? 'fuel exhausted, recovered on reserves' : 'recalled to base';
    noteFor(s, 'system', `Sortie ${s.sortie} complete: ${why}. Night falls over the basin.`);
    // unflown packages still in the air land where they are
    for (const p of this.packages) {
      if (!p.landed) {
        p.landed = true;
        p.y = this.bundle.heightField.sample(p.x, p.z);
      }
      if (!p.id) p.id = registerSensor(s, p.x, p.z).id;
    }
    const events = passNight(s);
    for (const e of events) if (e.type === 'unlock') this.audio.unlockSound();
    const fresh = s.notes.slice(this.noteStart).map((n) => n.text);
    this.audio.land();
    this.persist();
    this.openIntel('debrief', fresh);
  }

  private tryReturn(): void {
    if (this.mode !== 'flight') return;
    if (this.play === 'mission') {
      this.tryMissionLanding();
      return;
    }
    const d = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (d < 480) this.endSortie('landed');
    else this.hud.message(`BASE IS ${(d / 1000).toFixed(1)} km AWAY · RETURN WITHIN 480 m TO LAND`, 'warn');
  }

  // ------------------------------------------------------------------ actions
  private toggleScan(): void {
    if (this.mode !== 'flight') return;
    this.scanning = !this.scanning;
    this.radarRing.visible = this.scanning;
    if (this.scanning) this.audio.radarOn();
    else this.audio.radarOff();
  }

  private nearContact(): { id: string; x: number; z: number; dist: number } | null {
    let best: { id: string; x: number; z: number; dist: number } | null = null;
    for (const def of CONTACTS) {
      const c = this.state.contacts[def.id];
      if (!isKnown(c)) continue;
      const pos = def.mobile && !this.truck.hidden ? { x: this.truck.x, z: this.truck.z } : (c.lastKnown ?? def);
      const d = Math.hypot(pos.x - this.a.x, pos.z - this.a.z);
      if (d < 340 && (!best || d < best.dist)) best = { id: def.id, x: pos.x, z: pos.z, dist: d };
    }
    return best;
  }

  private doMark(): void {
    if (this.mode !== 'flight') return;
    if (this.play === 'mission') {
      this.missionMark();
      return;
    }
    const n = this.nearContact();
    if (!n) {
      this.hud.message('NO CONTACT IN RANGE TO MARK', 'warn');
      return;
    }
    const ev = markContact(this.state, n.id);
    if (ev.length === 0) {
      this.hud.message(`${this.state.contacts[n.id].codename} ALREADY MARKED`, 'sys');
      return;
    }
    this.audio.mark();
    this.handleEvents(ev);
  }

  private doDrop(): void {
    if (this.mode !== 'flight' || this.play === 'mission') return;
    if (this.sensorsLeft <= 0) {
      this.hud.message('NO SENSOR PACKAGES REMAINING', 'warn');
      return;
    }
    if (this.a.agl > 420) {
      this.hud.message('TOO HIGH FOR A CONTROLLED DROP · DESCEND BELOW 420 m', 'warn');
      return;
    }
    this.sensorsLeft -= 1;
    const sy = Math.sin(this.a.yaw);
    const cy = Math.cos(this.a.yaw);
    const sp = this.a.speed * 0.9;
    const p = new SensorPackage(this.a.x, this.a.y - 2, this.a.z, -sy * sp, -2, -cy * sp);
    this.packages.push(p);
    this.bundle.scene.add(p.group);
    this.audio.drop();
    this.hud.message('SENSOR PACKAGE AWAY', 'sys');
  }

  private handleEvents(events: IntelEvent[]): void {
    for (const e of events) {
      const cls = e.type === 'unlock' ? 'unlock' : e.type === 'link' ? 'link' : e.type === 'marked' ? 'mark' : e.type === 'resolved' || e.type === 'sensor' ? 'good' : '';
      this.hud.message(e.text, cls);
      switch (e.type) {
        case 'detected':
          this.audio.contact();
          break;
        case 'observed':
          this.audio.observed();
          break;
        case 'resolved':
          this.audio.resolved();
          break;
        case 'link':
          this.audio.link();
          break;
        case 'unlock':
          this.audio.unlockSound();
          break;
        case 'sensor':
          this.audio.sensorLink();
          break;
        default:
          break;
      }
      if (e.contact) this.refreshPin(e.contact);
    }
    if (events.length) this.persist();
  }

  private persist(): void {
    save(this.state, localStorage);
  }

  // ------------------------------------------------------------------ world markers
  private refreshPins(): void {
    for (const def of CONTACTS) this.refreshPin(def.id);
  }

  private refreshPin(id: string): void {
    const c = this.state.contacts[id];
    const def = CONTACT_BY_ID[id];
    let g = this.pins.get(id);
    if (!isKnown(c)) {
      if (g) g.visible = false;
      return;
    }
    if (!g) {
      g = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 70, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 35;
      beam.name = 'beam';
      const ring = new THREE.Mesh(new THREE.RingGeometry(8, 10, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1.5;
      ring.name = 'ring';
      const markRing = new THREE.Mesh(new THREE.RingGeometry(13, 15, 32), new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      markRing.rotation.x = -Math.PI / 2;
      markRing.position.y = 1.6;
      markRing.name = 'mark';
      g.add(beam, ring, markRing);
      this.pins.set(id, g);
      this.bundle.scene.add(g);
    }
    g.visible = true;
    const pos = c.lastKnown ?? def;
    g.position.set(pos.x, this.bundle.heightField.sample(pos.x, pos.z), pos.z);
    const st = stageOf(c);
    const color = st === 'detected' ? 0x7cff9a : st === 'observed' ? 0x8fd0ff : st === 'sensor' ? 0xffb347 : 0xf4f1e8;
    (g.getObjectByName('beam') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(color);
    (g.getObjectByName('ring') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(color);
    g.getObjectByName('mark')!.visible = c.marked;
  }

  private updateWaypointBeam(): void {
    const id = this.state.waypoint;
    if (!id || !isKnown(this.state.contacts[id])) {
      this.waypointBeam.visible = false;
      return;
    }
    const c = this.state.contacts[id];
    const pos = c.lastKnown ?? CONTACT_BY_ID[id];
    this.waypointBeam.position.set(pos.x, this.bundle.heightField.sample(pos.x, pos.z) + 210, pos.z);
    this.waypointBeam.visible = true;
  }

  // ------------------------------------------------------------------ mission 01
  private startMission(): void {
    const hf = this.bundle.heightField;
    this.audio.unlock();
    this.play = 'mission';
    this.mission = newMission();
    this.movers.clear();
    for (const r of RETURNS) this.movers.set(r.id, new RouteMover(r.route, r.speed, r.start, true));
    this.a = initialAircraft(RUNWAY.x1 + 16, hf.sample(RUNWAY.x1 + 16, RUNWAY.z) + 2, RUNWAY.z, BASE.heading);
    this.a.speed = 40;
    this.a.throttle = 0.8;
    this.fuelMax = MISSION_01.fuelSeconds;
    this.fuel = this.fuelMax;
    this.scanning = false;
    this.radarRing.visible = false;
    this.sortieTime = 0;
    this.chase.reset();
    // the open case's world markers and vehicle stay out of the mission
    for (const p of this.pins.values()) p.visible = false;
    for (const p of this.packages) this.bundle.scene.remove(p.group);
    this.packages = [];
    this.waypointBeam.visible = false;
    this.truckMesh.group.visible = false;
    this.missionScene.group.visible = true;
    this.missionScene.showDestination(DESTINATION.x, DESTINATION.z, false);
    this.missionScene.sync(this.movers, this.mission, this.t);
    this.el['title'].classList.add('hidden');
    this.el['debrief'].classList.add('hidden');
    this.el['pause'].classList.add('hidden');
    this.el['hud'].classList.add('mission');
    this.el['hud'].classList.remove('hidden');
    this.intel.close();
    this.hud.clearBanners();
    this.hud.banner(`${MISSION_01.code} · OBJECTIVE`, 'LOCATE THE SUPPLY TRUCK', 'obj', 3.4);
    this.mode = 'flight';
    this.last = performance.now();
  }

  private missionEvents(events: MissionEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'detected':
          this.hud.message(e.text, '');
          this.audio.contact();
          break;
        case 'resolved':
          this.hud.message(e.text, 'good');
          this.audio.resolved();
          break;
        case 'wrong':
          this.hud.banner(e.title, e.text, 'bad', 2.6);
          this.audio.warn();
          break;
        case 'objective-complete':
          this.hud.banner(e.title, e.text, 'done', 2.6);
          this.audio.unlockSound();
          break;
        case 'new-objective':
        case 'final-objective':
          this.hud.banner(e.title, e.text, 'obj', 3.4);
          break;
        default:
          break;
      }
    }
  }

  private nearestReturn(): { id: ReturnId; dist: number } | null {
    let best: { id: ReturnId; dist: number } | null = null;
    for (const [id, mv] of this.movers) {
      if (!this.mission.returns[id].detected) continue;
      const d = Math.hypot(mv.x - this.a.x, mv.z - this.a.z);
      if (d < MARK_RANGE && (!best || d < best.dist)) best = { id, dist: d };
    }
    return best;
  }

  private missionMark(): void {
    const n = this.nearestReturn();
    if (!n) {
      this.hud.message(this.mission.phase === 'locate' ? 'NO RETURN IN RANGE · SCAN AND FLY CLOSER' : 'NOTHING TO MARK', 'warn');
      return;
    }
    const { result, events } = identify(this.mission, n.id);
    if (result === 'already') this.hud.message(`RETURN ${n.id} ALREADY MARKED`, 'sys');
    else if (result === 'inactive') this.hud.message('TRUCK ALREADY IDENTIFIED', 'sys');
    if (result === 'correct') {
      this.audio.mark();
      const mv = this.movers.get(n.id)!;
      mv.setRoute(destinationRoute(mv.x, mv.z, mv.segment), false);
      mv.speed = TARGET_SPEED_TO_DESTINATION;
    }
    this.missionEvents(events);
  }

  private tryMissionLanding(): void {
    const d = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (this.mission.phase !== 'rtb') {
      this.hud.message(`OBJECTIVE FIRST: ${objectiveFor(this.mission).title}`, 'warn');
      return;
    }
    if (d < 480) this.endMission('landed');
    else this.hud.message(`BASE IS ${(d / 1000).toFixed(1)} km AWAY · RETURN WITHIN 480 m TO LAND`, 'warn');
  }

  private endMission(reason: 'landed' | 'fuel' | 'aborted'): void {
    if (this.mode !== 'flight' && this.mode !== 'paused') return;
    if (reason === 'landed') this.missionEvents(landMission(this.mission).events);
    else failMission(this.mission, reason);
    this.mode = 'debrief';
    this.scanning = false;
    this.radarRing.visible = false;
    this.audio.updateFlight(0, 0, false, false);
    this.audio.land();
    this.el['pause'].classList.add('hidden');
    this.el['hud'].classList.add('hidden');
    this.hud.clearBanners();
    const d = buildDebrief(this.mission, this.fuel / this.fuelMax);
    this.el['db-headline'].textContent = d.headline;
    this.el['db-headline'].className = d.success ? 'good' : 'bad';
    this.el['db-rows'].innerHTML = d.rows.map((r) => `<dt>${r.label}</dt><dd class="${r.tone ?? ''}">${r.value}</dd>`).join('');
    this.el['db-findings'].innerHTML = d.findings.length ? `<h3>RECON FINDINGS</h3><ul>${d.findings.map((f) => `<li>${f}</li>`).join('')}</ul>` : '';
    this.el['debrief'].classList.remove('hidden');
  }

  private updateRadarVisual(dt: number, radius: number, quality: number): void {
    const hf = this.bundle.heightField;
    this.sweep += dt * 2.3;
    if (this.sweep > Math.PI * 2) {
      this.sweep -= Math.PI * 2;
      this.sweepTicks++;
      this.audio.sweepTick();
    }
    this.radarRing.position.set(this.a.x, hf.sample(this.a.x, this.a.z) + 2.5, this.a.z);
    this.radarRing.scale.set(radius, 1, radius);
    this.radarWedge.rotation.z = -this.sweep + Math.PI / 2;
    (this.radarDisc.material as THREE.MeshBasicMaterial).opacity = 0.04 + quality * 0.06;
  }

  private updateMission(dt: number): void {
    const m = this.mission;
    const hf = this.bundle.heightField;
    m.time += dt;
    if (this.fuel <= 0) {
      this.endMission('fuel');
      return;
    }
    // ---- world
    for (const mv of this.movers.values()) mv.step(dt);
    this.plane.sync(this.a, this.t);
    const target = this.movers.get(TARGET.id)!;

    // ---- radar
    const params = radarParams(this.a.agl, 1);
    if (this.scanning) {
      this.updateRadarVisual(dt, params.radius, params.quality);
      this.blipTimer -= dt;
      const events: MissionEvent[] = [];
      for (const [id, mv] of this.movers) {
        const def = RETURN_BY_ID[id];
        const dist = Math.hypot(mv.x - this.a.x, mv.z - this.a.z);
        const gain = detectionGain(dt, params, dist, def, false, MISSION_RATE);
        if (gain <= 0) continue;
        if (this.blipTimer <= 0) {
          const unc = uncertaintyFor(params, def.concealment);
          this.hud.blip(mv.x + (Math.random() - 0.5) * unc * 0.5, mv.z + (Math.random() - 0.5) * unc * 0.5);
        }
        events.push(...scanReturn(m, id, gain, canResolve(params, def), mv.x, mv.z));
      }
      if (this.blipTimer <= 0) this.blipTimer = 0.35;
      if (events.length) this.missionEvents(events);
    }
    // a detected return is tracked while it is in the footprint or in plain sight
    for (const [id, mv] of this.movers) {
      const st = m.returns[id];
      if (!st.detected) continue;
      const dist = Math.hypot(mv.x - this.a.x, mv.z - this.a.z);
      if ((this.scanning && dist <= params.radius) || (dist < 260 && this.a.agl < 320)) st.lastKnown = { x: mv.x, z: mv.z };
    }

    // ---- destination
    if (m.phase === 'destination') {
      const ev = updateDestination(m, dt, target.arrived, Math.hypot(target.x - this.a.x, target.z - this.a.z));
      this.missionScene.showDestination(DESTINATION.x, DESTINATION.z, target.arrived);
      if (ev.length) this.missionEvents(ev);
    }
    this.missionScene.sync(this.movers, m, this.t);

    // ---- landing
    const dBase = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (m.phase === 'rtb' && dBase < 150 && this.a.agl < 45) {
      this.endMission('landed');
      return;
    }

    // ---- contact card
    const near = this.nearestReturn();
    let nearCard: HudFrame['nearContact'] = null;
    if (near) {
      const mv = this.movers.get(near.id)!;
      const st = m.returns[near.id];
      const d = describeReturn(m, near.id, mv.x, mv.z, mv.moving);
      const markKey = this.input.isTouch ? 'TAP MARK' : 'PRESS M';
      nearCard = {
        codename: d.head,
        label: st.verdict === 'correct' ? 'SUPPLY TRUCK' : st.verdict === 'wrong' ? 'NOT THE TRUCK' : 'VEHICLE RETURN',
        grid: gridRef(mv.x, mv.z),
        confidence: st.resolved ? 1 : clamp(st.detection / RESOLVE_THRESHOLD, 0.2, 0.95),
        canMark: m.phase === 'locate' && st.verdict === 'none',
        status: st.verdict === 'correct' ? 'TARGET' : st.verdict === 'wrong' ? 'REJECTED' : st.resolved ? 'RESOLVED' : 'DETECTED',
        traits: d.traits,
        action: m.phase === 'locate' && st.verdict === 'none' ? `${markKey} IF THIS IS THE TRUCK` : '',
      };
    }

    // ---- navigation target
    let waypoint: HudFrame['waypoint'] = null;
    if (m.phase === 'locate' && !inSector(this.a.x, this.a.z)) waypoint = { x: (SECTOR_7.x0 + SECTOR_7.x1) / 2, z: (SECTOR_7.z0 + SECTOR_7.z1) / 2, label: 'SECTOR 7' };
    else if (m.phase === 'destination') {
      const p = m.returns[TARGET.id].lastKnown ?? target;
      waypoint = { x: p.x, z: p.z, label: target.arrived ? 'TRUCK STOPPED' : 'TRUCK' };
    }

    // ---- contextual hint: always says what to do next
    const touch = this.input.isTouch;
    let hint = '';
    if (this.sortieTime < 7) hint = touch ? 'DRAG LEFT SIDE TO STEER · SLIDE THROTTLE ON THE RIGHT' : 'ARROWS / WASD STEER · SHIFT / CTRL THROTTLE';
    else if (m.phase === 'locate') {
      const anyUnresolved = RETURNS.some((r) => m.returns[r.id].detected && !m.returns[r.id].resolved);
      if (near && nearCard?.canMark) hint = `DOES RETURN ${near.id} MATCH EVERY POINT OF THE INTEL?`;
      else if (!this.scanning) hint = touch ? 'TAP SCAN TO SEARCH FOR VEHICLE RETURNS' : 'PRESS SPACE TO SCAN FOR VEHICLE RETURNS';
      else if (!inSector(this.a.x, this.a.z)) hint = 'HEAD FOR SECTOR 7 · OUTLINED IN AMBER';
      else if (anyUnresolved) hint = 'FLY UNDER 300 m OVER A RETURN TO RESOLVE ITS SIZE';
      else hint = 'SWEEP THE ROADS IN SECTOR 7 WITH THE RADAR';
    } else if (m.phase === 'destination') hint = target.arrived ? 'FLY OVER THE STOPPED TRUCK TO CONFIRM' : 'STAY WITH THE TRUCK UNTIL IT STOPS';
    else if (m.phase === 'rtb') hint = touch ? 'FOLLOW BASE · FLY LOW OVER THE RUNWAY OR TAP LAND' : 'FOLLOW BASE · FLY LOW OVER THE RUNWAY OR PRESS R';
    this.el['hint'].textContent = hint;

    // ---- camera, audio, HUD
    this.chase.update(this.bundle.camera, this.a, dt, this.scanning, (x, z) => hf.sample(x, z));
    this.audio.updateFlight(this.a.throttle, this.a.speed, true, this.scanning);
    const contacts: ScopeContact[] = [];
    for (const r of RETURNS) {
      const st = m.returns[r.id];
      if (!st.detected || !st.lastKnown) continue;
      contacts.push({
        x: st.lastKnown.x,
        z: st.lastKnown.z,
        r: 30,
        kind: st.verdict === 'correct' ? 'sensor' : st.resolved || st.verdict === 'wrong' ? 'resolved' : 'detected',
        label: st.verdict === 'correct' ? `${r.id} TRUCK` : st.verdict === 'wrong' ? `${r.id} \u2715` : r.id,
        marked: st.verdict === 'wrong',
      });
    }
    const ob = objectiveFor(m, target.arrived);
    this.hud.update(
      {
        a: this.a,
        scanning: this.scanning,
        footprint: params.radius,
        quality: params.quality,
        fuel: this.fuel / this.fuelMax,
        fuelSeconds: this.fuel,
        sensorsLeft: 0,
        sortie: 1,
        sortieLabel: MISSION_01.code,
        contacts,
        sensors: [],
        waypoint,
        nearBase: dBase < 480 && m.phase === 'rtb',
        signal: null,
        nearContact: nearCard,
        sweepAngle: this.sweep,
        objective: isActive(m) ? { title: ob.title, detail: ob.detail, progress: m.phase === 'destination' && target.arrived ? m.confirm : null, done: ob.done } : null,
        sector: SECTOR_7,
      },
      dt,
    );
  }

  // ------------------------------------------------------------------ loop
  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.bundle.renderer.setSize(w, h, false);
    this.bundle.camera.aspect = w / h;
    this.bundle.camera.updateProjectionMatrix();
    this.intel.resize();
  }

  private frame(now: number): void {
    this.raf = requestAnimationFrame((n) => this.frame(n));
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.t += dt;
    this.bundle.update(dt, this.t);
    updateProps(this.props, this.t);
    if (this.mode === 'flight') this.updateFlight(dt);
    else if (this.mode === 'title') {
      // slow orbit over the basin
      const ang = this.t * 0.03;
      this.bundle.camera.position.set(Math.sin(ang) * 900, 380, Math.cos(ang) * 900);
      this.bundle.camera.up.set(0, 1, 0);
      this.bundle.camera.lookAt(0, 30, 0);
      this.truck.step(dt);
      this.truckMesh.sync(this.truck, this.bundle.heightField);
    }
    if (this.mode !== 'intel') this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    void this.raf;
  }

  private updateFlight(dt: number): void {
    const s = this.state;
    const hf = this.bundle.heightField;
    const cap = capabilities(s);
    this.sortieTime += dt;

    // ---- controls
    const inp = this.input.read();
    if (this.input.touchThrottle !== null) {
      this.a.throttle = this.input.touchThrottle;
      this.input.touchThrottle = null;
    }
    if (this.sortieTime < 4.5) {
      inp.pitch = Math.max(inp.pitch, 0.7);
      inp.throttleDelta = 0;
    }
    this.a = stepAircraft(this.a, inp, dt, (x, z) => hf.sample(x, z));
    this.input.syncThrottle(this.a.throttle);
    this.fuel -= dt;
    if (this.play === 'mission') {
      this.updateMission(dt);
      return;
    }
    if (this.fuel <= 0) {
      this.endSortie('fuel');
      return;
    }

    // ---- world
    this.truck.step(dt);
    this.truckMesh.sync(this.truck, hf);
    this.plane.sync(this.a, this.t);

    // ---- radar
    const params = radarParams(this.a.agl, cap.radarMult);
    const fresh: ScopeContact[] = [];
    if (this.scanning) {
      this.updateRadarVisual(dt, params.radius, params.quality);
      addCoverage(s, this.a.x, this.a.z, params.radius, dt * params.quality * 0.35);
      this.blipTimer -= dt;
      this.mobileUpdateTimer -= dt;
      const events: IntelEvent[] = [];
      for (const def of CONTACTS) {
        const c = s.contacts[def.id];
        const pos = def.mobile ? { x: this.truck.x, z: this.truck.z } : def;
        const hidden = def.mobile ? this.truck.hidden : false;
        const dist = Math.hypot(pos.x - this.a.x, pos.z - this.a.z);
        const gain = detectionGain(dt, params, dist, def, hidden, cap.rateMult);
        if (gain <= 0) continue;
        c.detection += gain;
        const unc = uncertaintyFor(params, def.concealment);
        if (this.blipTimer <= 0) {
          this.hud.blip(pos.x + (Math.random() - 0.5) * unc * 0.6, pos.z + (Math.random() - 0.5) * unc * 0.6);
        }
        if (!c.detected && !c.observed && c.detection >= DETECT_THRESHOLD) {
          const jx = pos.x + (Math.random() - 0.5) * unc * 0.7;
          const jz = pos.z + (Math.random() - 0.5) * unc * 0.7;
          events.push(...markDetected(s, def.id, jx, jz, unc));
        } else if (!c.detected && c.observed && c.detection >= DETECT_THRESHOLD * 0.6) {
          events.push(...markDetected(s, def.id, pos.x, pos.z, Math.min(unc, 30)));
        } else if (def.mobile && c.detected && this.mobileUpdateTimer <= 0) {
          markDetected(s, def.id, pos.x + (Math.random() - 0.5) * unc * 0.4, pos.z + (Math.random() - 0.5) * unc * 0.4, unc);
          this.refreshPin(def.id);
        }
        if (!c.resolved && c.detection >= RESOLVE_THRESHOLD && canResolve(params, def)) {
          events.push(...markResolved(s, def.id));
        }
        if (c.detected || c.observed) fresh.push({ x: pos.x, z: pos.z, r: unc, kind: 'fresh', label: '', marked: false });
      }
      if (this.blipTimer <= 0) this.blipTimer = 0.35;
      if (this.mobileUpdateTimer <= 0) this.mobileUpdateTimer = 2.5;
      if (events.length) this.handleEvents(events);
    }

    // ---- visual observation
    {
      const events: IntelEvent[] = [];
      for (const def of CONTACTS) {
        if (def.visible === 'none') continue;
        const c = s.contacts[def.id];
        if (c.observed) continue;
        const pos = def.mobile ? { x: this.truck.x, z: this.truck.z } : def;
        if (def.mobile && this.truck.hidden) continue;
        const dist = Math.hypot(pos.x - this.a.x, pos.z - this.a.z);
        if (canObserve(def, dist, this.a.agl)) {
          const tm = (this.observeTimer.get(def.id) ?? 0) + dt;
          this.observeTimer.set(def.id, tm);
          if (tm > 0.9) events.push(...markObserved(s, def.id));
        } else this.observeTimer.set(def.id, 0);
      }
      if (events.length) this.handleEvents(events);
    }

    // ---- sensor packages
    {
      const events: IntelEvent[] = [];
      for (const p of this.packages) {
        const justLanded = p.step(dt, hf, this.t);
        if (justLanded) {
          const sn = registerSensor(s, p.x, p.z);
          p.id = sn.id;
          this.groundTime.set(sn.id, 0);
          const what = sn.targets.length ? `LISTENING: ${sn.targets.map((t) => s.contacts[t].codename || 'UNLOGGED SITE').join(', ')}` : 'NO KNOWN CONTACT IN RANGE';
          this.hud.message(`${sn.id} DOWN AT ${gridRef(p.x, p.z)} · ${what}`, 'good');
          this.audio.sensorLink();
          this.persist();
        }
        if (p.landed && p.id) {
          const gt = (this.groundTime.get(p.id) ?? 0) + dt;
          this.groundTime.set(p.id, gt);
          const sn = s.sensors.find((x) => x.id === p.id);
          if (sn && !sn.prelim && gt > SENSOR_PRELIM_DELAY && Math.hypot(p.x - this.a.x, p.z - this.a.z) < SENSOR_LINK_RANGE) {
            events.push(...preliminaryDownload(s, sn));
            for (const l of sn.logs) this.hud.message(`${sn.id}: ${l}`, 'good');
          }
        }
      }
      if (events.length) this.handleEvents(events);
    }

    // ---- path + autosave
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = 1.5;
      this.path.push(Math.round(this.a.x), Math.round(this.a.z));
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 12;
      this.persist();
    }

    // ---- landing
    const dBase = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (this.sortieTime > 20 && dBase < 150 && this.a.agl < 45) {
      this.endSortie('landed');
      return;
    }

    // ---- hints (first sortie only)
    if (s.sortie === 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        const hints = this.input.isTouch
          ? ['DRAG LEFT SIDE TO STEER · SLIDE THE THROTTLE ON THE RIGHT', 'TAP SCAN OVER TERRAIN · LOW AND SLOW SEES MORE', 'TAP MARK WHEN A CONTACT CARD APPEARS', 'DROP A SENSOR WHERE THE NIGHT MATTERS · FLY OVER BASE LOW TO LAND']
          : ['ARROWS / WASD STEER · SHIFT / CTRL THROTTLE', 'SPACE TOGGLES THE GROUND RADAR · LOW AND SLOW SEES MORE', 'M MARKS A CONTACT · E DROPS A SENSOR', 'TAB OPENS THE INTEL MAP · FLY OVER BASE LOW TO LAND'];
        this.el['hint'].textContent = this.hintIdx < hints.length ? hints[this.hintIdx] : '';
        this.hintIdx++;
        this.hintTimer = 9;
      }
    } else this.el['hint'].textContent = '';

    // ---- camera, audio
    this.chase.update(this.bundle.camera, this.a, dt, this.scanning, (x, z) => hf.sample(x, z));
    this.audio.updateFlight(this.a.throttle, this.a.speed, true, this.scanning);

    // ---- HUD frame
    const contacts: ScopeContact[] = [];
    for (const def of CONTACTS) {
      const c = s.contacts[def.id];
      if (!isKnown(c)) continue;
      const pos = c.lastKnown ?? def;
      const st = stageOf(c);
      contacts.push({ x: pos.x, z: pos.z, r: c.lastKnown?.r ?? 60, kind: st === 'unknown' ? 'detected' : st, label: c.codename, marked: c.marked });
    }
    for (const f of fresh) if (Math.hypot(f.x - this.a.x, f.z - this.a.z) < 650) contacts.push(f);
    const near = this.nearContact();
    let nearCard: HudFrame['nearContact'] = null;
    if (near) {
      const c = s.contacts[near.id];
      const def = CONTACT_BY_ID[near.id];
      const st = stageOf(c);
      nearCard = {
        codename: c.codename,
        label: c.observed || c.resolved ? def.name.toUpperCase() : 'UNIDENTIFIED RETURN',
        grid: gridRef(near.x, near.z),
        confidence: c.resolved ? 1 : clamp(c.detection / RESOLVE_THRESHOLD, c.observed ? 0.5 : 0.2, 0.95),
        canMark: !c.marked,
        status: c.marked ? 'MARKED' : st.toUpperCase(),
      };
    }
    let signal: HudFrame['signal'] = null;
    if (cap.signalAnalyser && this.truck.moving && !this.truck.hidden) {
      const d = Math.hypot(this.truck.x - this.a.x, this.truck.z - this.a.z);
      const bearing = ((Math.atan2(this.truck.x - this.a.x, -(this.truck.z - this.a.z)) * 180) / Math.PI + 360) % 360;
      signal = { bearing, strength: clamp(1 - d / 1600, 0.1, 1) };
    }
    const wp = s.waypoint && isKnown(s.contacts[s.waypoint]) ? s.contacts[s.waypoint].lastKnown ?? CONTACT_BY_ID[s.waypoint] : null;
    this.hud.update(
      {
        a: this.a,
        scanning: this.scanning,
        footprint: params.radius,
        quality: params.quality,
        fuel: this.fuel / this.fuelMax,
        fuelSeconds: this.fuel,
        sensorsLeft: this.sensorsLeft,
        sortie: s.sortie + 1,
        contacts,
        sensors: this.packages.filter((p) => p.landed && p.id).map((p) => ({ x: p.x, z: p.z, id: p.id!, linked: Math.hypot(p.x - this.a.x, p.z - this.a.z) < SENSOR_LINK_RANGE })),
        waypoint: wp && s.waypoint ? { x: wp.x, z: wp.z, label: s.contacts[s.waypoint].codename } : null,
        nearBase: dBase < 480,
        signal,
        nearContact: nearCard,
        sweepAngle: this.sweep,
        objective: null,
        sector: null,
      },
      dt,
    );
    void FLIGHT;
  }
}
