import * as THREE from 'three';
import { AudioSystem } from '../core/audio';
import { Input } from '../core/input';
import { clamp } from '../core/math';
import { loadPrefs, savePrefs, type Prefs, type VerticalMode } from '../core/settings';
import { FLIGHT, initialAircraft, stepAircraft, type AircraftState } from '../flight/aircraft';
import { AircraftMesh, type AircraftStyle } from '../flight/aircraftMesh';
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
import { buildCountryside } from '../world/countryside';
import { createScene, type SceneBundle } from '../world/scene';
import { TruckMesh, TruckSim } from '../world/truck';
import { BASE, RUNWAY, gridRef } from '../world/worldData';
import { DEFAULT_RETURNS, DESTINATION, MISSION_01, RETURNS, rollReturns, TARGET_SPEED_TO_DESTINATION, type ReturnId } from '../mission/mission01';
import {
  BARGE,
  CAMERA_RANGE,
  CAMERA_SECONDS,
  canExtract,
  describeReturn,
  destinationRoute,
  evidenceGrade,
  extract as extractMission,
  formatTime,
  identify,
  inspectReturn,
  listenReturn,
  MISSION_RATE,
  newMission,
  operatorWork,
  photograph,
  photoQuality,
  reconObjective,
  RETURN_BY_ID,
  scanReturn,
  SIGINT_RANGE,
  TARGET,
  updateDestination,
  useReturns,
  type MissionEvent,
  type MissionState,
  type StationContext,
} from '../mission/mission';
import { BINGO_FUEL, buildHandover, engageOperator, forcedHandback, handBack, newCrew, operatorAvailability, retaskOrbit, tickCrew, type CrewState, type HandbackReason } from '../mission/crew';
import { inArea } from '../mission/missionDef';
import { orbitInput } from '../flight/autopilot';
import { isCameraTool, OpsConsole, type OpsFrame, type OpsPhoto, type OpsReturn, type OpsTool } from '../ui/opsConsole';
import { blindClues, checkClues, clueVerdict, nextCheck, reconGuide, type GuideAction, type Sensor, type Verdict } from '../mission/reconGuide';
import { Preflight } from '../ui/preflight';
import { MissionScene } from '../mission/missionScene';
import { RouteMover } from '../mission/vehicles';
import { CREW_BY_ID } from '../operation/catalog';
import { capabilities as loadoutCapabilities, checkLoadout, defaultLoadout, seatCrew, toggleEquipment, withAircraft, type Capabilities, type Loadout } from '../operation/loadout';
import { activeLeg, beginReturn, damagedPerf, endOperation, flightObjective, landAtBase, launch, newOperation, reconVisibility, tickOperation, windowLeft, type OperationState } from '../operation/operation';
import { currentGate, inHazard, ringScale, type LegEvent } from '../operation/gates';
import { buildReport, type Report } from '../operation/score';
import { isUnlocked, loadCareer, recordOperation, saveCareer, type Career, type UnlockDef } from '../operation/career';
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
  /** Which crew station the player occupies (mission play). */
  private crew: CrewState = newCrew();
  private ops: OpsConsole;
  private opsTool: OpsTool = 'radar';
  private opsSelected: ReturnId | null = null;
  private camSettle = 0;
  private handbackTimer = -1;
  /** Seconds until Mission Control opens itself after arriving on station (0: off). */
  private autoOps = 0;
  /** The clue the guide wants settled next, and the sensor that can. */
  private guideCheck: { clue: string; sensor: Sensor } | null = null;
  /** RETURN TO BASE is waiting for the hand-back card to clear. */
  private returnCue = false;
  /** Camera shake (0..1, decays) and a roll jolt from the last lightning strike. */
  private shake = 0;
  private jolt = 0;
  private fxKey = '';
  private pulseIn = 0;
  private visibility = 1;
  private sensorCam = new THREE.PerspectiveCamera(20, 1, 1, 4200);
  /** The operation plan and its derived rules. */
  private loadout: Loadout = defaultLoadout();
  private cap: Capabilities = loadoutCapabilities(defaultLoadout());
  private op: OperationState = newOperation(MISSION_01, defaultLoadout());
  private career: Career;
  private preflight: Preflight;
  private report: Report | null = null;
  /** Photographs taken this operation (evidence), and one waiting to be captured from the next frame. */
  private shots: OpsPhoto[] = [];
  private pendingShot: Omit<OpsPhoto, 'url'> | null = null;

  constructor(root: HTMLElement) {
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['gl', 'hud', 'intel', 'title', 'pause', 'hint', 'btn-begin', 'btn-continue', 'btn-newcase-title', 'stick-zone', 'stick-knob', 'throttle', 'btn-scan', 'btn-mark', 'btn-drop', 'btn-map', 'btn-pause', 'btn-rtb', 'btn-resume-pause', 'btn-map-pause', 'btn-end-sortie', 'btn-sound-pause', 'loading', 'btn-mission', 'btn-open-case', 'btn-case-back', 'mission-card', 'case-card', 'mission-brief', 'debrief', 'btn-fly-again', 'btn-debrief-menu', 'db-headline', 'db-rows-more', 'db-stages', 'db-photos', 'db-findings', 'pause-objective', 'btn-ops', 'handoff', 'ops', 'preflight', 'career-line', 'db-grade', 'db-aircraft', 'db-secondaries', 'db-rewards', 'fx']) {
      this.el[id] = q(id);
    }
    this.el['app'] = root;
    const canvas = this.el['gl'] as HTMLCanvasElement;
    this.bundle = createScene(canvas);
    const hf = this.bundle.heightField;
    this.props = buildProps(hf);
    this.bundle.scene.add(this.props.group);
    this.bundle.scene.add(buildTrees(hf));
    this.bundle.scene.add(buildCountryside(hf).group);
    this.bundle.scene.add(this.truckMesh.group);
    this.bundle.scene.add(this.plane.group);
    this.missionScene = new MissionScene(MISSION_01.operations.area, hf);
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
    this.hud = new Hud(root);
    this.ops = new OpsConsole(this.el['ops'], {
      onTool: (t) => this.setOpsTool(t),
      onNext: (a) => this.opsNext(a),
      onSelect: (id) => this.opsSelect(id),
      onMark: () => this.opsMark(),
      onPhoto: () => this.opsPhoto(),
      onExtract: () => this.opsExtract(),
      onRetask: (x, z) => {
        retaskOrbit(this.crew, x, z);
        if (isCameraTool(this.opsTool)) this.opsSelected = null;
        this.audio.click();
      },
      onTakeControls: () => this.takeControls('manual'),
      onPause: () => this.togglePause(),
    });
    this.career = loadCareer(localStorage);
    this.preflight = new Preflight(this.el['preflight'], {
      onAircraft: (id) => this.updateLoadout(withAircraft(this.loadout, id)),
      onCrew: (seat, id) => this.updateLoadout(seatCrew(this.loadout, seat, id)),
      onEquip: (id) => this.updateLoadout(toggleEquipment(this.loadout, id)),
      onLaunch: () => this.launchOperation(),
      onBack: () => this.showTitle(),
    });
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
    this.input.bindButton(this.el['btn-ops'], 'ops', 'click');
    this.input.onAction('ops', () => this.opsAction());
    this.input.onAction('scan', () => this.toggleScan());
    this.input.onAction('mark', () => this.doMark());
    this.input.onAction('drop', () => this.doDrop());
    this.input.onAction('map', () => this.openIntel('inflight'));
    this.input.onAction('pause', () => this.togglePause());
    this.input.onAction('rtb', () => this.tryReturn());

    this.el['btn-mission'].addEventListener('click', () => this.openPreflight());
    this.el['btn-open-case'].addEventListener('click', () => this.showCaseCard(true));
    this.el['btn-case-back'].addEventListener('click', () => this.showCaseCard(false));
    this.el['btn-fly-again'].addEventListener('click', () => this.openPreflight());
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
        // a jump is not a flight path: no ring crossing between the two points
        const leg = activeLeg(this.op);
        if (leg) leg.state.prev = null;
      },
      teleportTo: (x: number, y: number, z: number, headingDeg: number) => {
        this.a.x = x;
        this.a.y = y;
        this.a.z = z;
        this.a.yaw = (-headingDeg * Math.PI) / 180;
        this.a.pitch = 0;
        this.a.roll = 0;
        this.sortieTime = Math.max(this.sortieTime, 5);
        // a jump is not a flight path: no ring crossing between the two points
        const leg = activeLeg(this.op);
        if (leg) leg.state.prev = null;
      },
      getRoute: () => activeLeg(this.op)?.def ?? null,
      getCast: () => RETURNS.map((r) => ({ id: r.id, truth: r.truth, target: r.isTarget, start: r.start })),
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
      getCrew: () => ({ ...this.crew, orbit: this.crew.orbit && { ...this.crew.orbit } }),
      getOps: () => ({ tool: this.opsTool, selected: this.opsSelected }),
      getVisibility: () => this.visibility,
      getOperation: () => this.op,
      getLoadout: () => this.loadout,
      getCareer: () => this.career,
      getReport: () => this.report,
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
    this.plane.setStyle('kestrel');
    this.setFx(0, 0);
    this.leaveMissionStations();
    this.preflight.hide();
    const c = this.career;
    this.el['career-line'].textContent = c.operations ? `${c.operations} OPERATION${c.operations === 1 ? '' : 'S'} · ${c.credits} CR · ${c.xp} XP · BEST ${c.best[MISSION_01.id] ?? '—'}` : 'NEW SQUADRON · NO OPERATIONS FLOWN';
    this.hud.clearBanners();
    const M = MISSION_01;
    this.el['mission-brief'].innerHTML =
      `<p class="mb-code">${M.code}</p>` +
      `<h2 class="mb-head">${M.briefing.headline}</h2>` +
      `<div class="pf-clues">${M.clues.map((c) => `<span>${c}</span>`).join('')}</div>`;
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

  /** Leaving mission play: back to the pilot's seat, clear weather, no console. */
  private leaveMissionStations(): void {
    if (this.crew.station === 'operator') handBack(this.crew);
    this.ops.hide();
    this.hideHandoff();
    this.el['app'].classList.remove('sensor-feed', 'thermal-feed');
    this.setVisibility(1);
    this.missionScene.setWaypoint(null);
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
      const ob = this.currentObjective();
      this.el['pause-objective'].classList.toggle('hidden', !mission);
      this.el['pause-objective'].innerHTML = mission ? `<i class="reticle"></i><b>${ob.title}</b><small>${ob.kicker} · ${ob.detail}</small>` : '';
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
    this.leaveMissionStations();
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
      if (this.crew.station === 'operator') return;
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
    if (this.play === 'mission') {
      if (this.crew.station === 'operator') this.setOpsTool('radar');
      else this.hud.message('RECON SYSTEMS RUN FROM MISSION CONTROL', 'sys');
      return;
    }
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
      if (this.crew.station === 'operator') this.opsMark();
      else this.hud.message('MARK TARGETS FROM MISSION CONTROL', 'sys');
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
  // An operation: PREFLIGHT → OUTBOUND (fly the gates) → RECON (Mission Control:
  // the autopilot or copilot flies, the player runs the sensors) → RETURN (fly
  // home through the new weather) → DEBRIEF (report, rewards, unlocks).

  private openPreflight(): void {
    this.mode = 'preflight';
    this.el['title'].classList.add('hidden');
    this.el['debrief'].classList.add('hidden');
    this.el['hud'].classList.add('hidden');
    const unlocked = (id?: string) => isUnlocked(this.career, id);
    const last = this.career.lastLoadout;
    this.loadout = last && checkLoadout(last, unlocked).ok ? last : this.loadout;
    this.preflight.render(MISSION_01, this.career, this.loadout);
    this.preflight.show();
  }

  private updateLoadout(l: Loadout): void {
    this.loadout = l;
    this.audio.click();
    this.preflight.render(MISSION_01, this.career, l);
  }

  private launchOperation(): void {
    if (!checkLoadout(this.loadout, (id) => isUnlocked(this.career, id)).ok) return;
    this.career.lastLoadout = this.loadout;
    saveCareer(this.career, localStorage);
    this.preflight.hide();
    this.startMission();
  }

  private startMission(): void {
    const hf = this.bundle.heightField;
    const def = MISSION_01;
    this.audio.unlock();
    this.play = 'mission';
    this.cap = loadoutCapabilities(this.loadout);
    this.plane.setStyle(this.loadout.aircraft as AircraftStyle);
    this.op = newOperation(def, this.loadout, (x, z) => this.bundle.heightField.sample(x, z));
    this.autoOps = 0;
    this.returnCue = false;
    this.shake = 0;
    this.jolt = 0;
    this.missionScene.smoke.clear();
    this.setFx(0, 0);
    launch(this.op);
    // a fresh puzzle every operation: which letter is the truck, which look-alikes are out there
    useReturns(new URLSearchParams(location.search).get('roll') === 'fixed' ? DEFAULT_RETURNS : rollReturns(Math.random));
    this.missionScene.setCast(RETURNS);
    this.mission = newMission();
    this.crew = newCrew();
    this.report = null;
    this.shots = [];
    this.pendingShot = null;
    this.ops.setEvidence([]);
    this.opsTool = 'radar';
    this.opsSelected = null;
    this.camSettle = 0;
    this.handbackTimer = -1;
    this.setVisibility(1);
    this.movers.clear();
    for (const r of RETURNS) this.movers.set(r.id, new RouteMover(r.route, r.speed, r.start, true));
    this.a = initialAircraft(RUNWAY.x1 + 16, hf.sample(RUNWAY.x1 + 16, RUNWAY.z) + 2, RUNWAY.z, BASE.heading);
    this.a.speed = 40;
    this.a.throttle = 0.8;
    this.fuelMax = this.cap.fuelSeconds;
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
    this.missionScene.setHazards(def.outbound.hazards);
    this.missionScene.setRoute(this.op.routes.outbound);
    this.missionScene.setWaypoint(null);
    this.missionScene.showDestination(DESTINATION.x, DESTINATION.z, false);
    this.missionScene.sync(this.movers, this.mission, this.t);
    for (const id of ['title', 'debrief', 'pause', 'preflight']) this.el[id].classList.add('hidden');
    this.ops.hide();
    this.hideHandoff();
    this.el['hud'].classList.add('mission');
    this.el['hud'].classList.remove('hidden');
    this.intel.close();
    this.hud.clearBanners();
    const fo = flightObjective(this.op, def, this.cap)!;
    this.hud.banner('WHEELS UP', fo.title, 'obj', 3);
    this.mode = 'flight';
    this.last = performance.now();
  }

  private missionEvents(events: MissionEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        // on station the console lists every return; the flight feed is for the pilot
        case 'detected':
          if (this.crew.station === 'pilot') this.hud.message(e.text, '');
          this.audio.contact();
          break;
        case 'resolved':
          if (this.crew.station === 'pilot') this.hud.message(e.text, 'good');
          this.audio.resolved();
          break;
        case 'photo':
          this.hud.banner(e.title, e.text, '', 1.8);
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
        case 'objective-updated':
          this.hud.banner(e.title, e.text, 'obj', 3.6);
          break;
        case 'recon-complete':
          this.hud.banner(e.title, e.text, e.title === 'RECON COMPLETE' || e.title === 'EXTRACTING' ? 'done' : 'bad', 2.6);
          break;
        default:
          break;
      }
    }
  }

  /** Ring and hazard events from the flying legs: every ring flown through is stamped. */
  private legEvents(events: LegEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'gate-passed': {
          if (e.id === 'land') break;
          this.audio.ring();
          this.hud.banner('GATE CLEARED', `RING ${e.text}`, 'done', 1.4);
          break;
        }
        case 'gate-missed':
          this.audio.ringMissed();
          this.hud.banner('MISSED', `RING ${e.text}`, 'bad', 1.2);
          break;
        case 'detected':
          this.audio.warn();
          this.hud.banner('SPOTTED', 'TOO HIGH OVER THE SECTOR', 'bad', 2);
          break;
        case 'contact':
          this.audio.warn();
          this.hud.banner('RADAR CONTACT', 'THE RINGS ARE CLOSING', 'bad', 2.4);
          break;
        case 'hazard-enter':
          this.audio.warn();
          break;
        case 'leg-complete':
          if (e.id === 'outbound') {
            this.audio.unlockSound();
            this.hud.banner('ON STATION', this.op.outbound.detected ? 'SPOTTED BY RADAR' : 'UNDETECTED', this.op.outbound.detected ? 'bad' : 'done', 2.4);
            // stop flying: Mission Control takes over once the stamp has landed
            if (this.crew.station === 'pilot') this.autoOps = 2.2;
          }
          break;
        default:
          break;
      }
    }
  }

  private inOpsArea(): boolean {
    return inArea(MISSION_01.operations.area, this.a.x, this.a.z);
  }

  private stationContext(): StationContext {
    return { station: this.crew.station, inArea: this.inOpsArea(), truckStopped: !!this.movers.get(TARGET.id)?.arrived };
  }

  /** What the player should be doing right now, whichever seat they are in. */
  private currentObjective(): { kicker: string; title: string; detail: string } {
    const fo = flightObjective(this.op, MISSION_01, this.cap);
    if (fo) return fo;
    const ro = reconObjective(this.mission, this.stationContext());
    return { kicker: `RECON · ${ro.kicker}`, title: ro.title, detail: ro.detail };
  }

  private reconWork(): boolean {
    return this.op.stage === 'recon' && operatorWork(this.mission);
  }

  /** The OPS key / button: switch jobs inside the aircraft. */
  private opsAction(): void {
    if (this.mode !== 'flight' || this.play !== 'mission') return;
    if (this.crew.station === 'operator') {
      this.takeControls('manual');
      return;
    }
    const av = operatorAvailability(this.crew, {
      inArea: this.inOpsArea(),
      operatorWork: this.reconWork(),
      fuelFraction: this.fuel / this.fuelMax,
      areaLabel: MISSION_01.operations.area.label,
    });
    if (!av.ok) {
      this.hud.message(this.op.stage === 'outbound' && this.inOpsArea() === false ? `${av.reason} · FLY THE RINGS FIRST` : av.reason, 'warn');
      return;
    }
    const o = this.cap.orbit;
    engageOperator(this.crew, this.a.x, this.a.z, o.agl);
    this.crew.orbit!.r = o.r;
    this.camSettle = 0;
    this.setOpsTool(this.opsTool);
    this.el['hud'].classList.add('hidden');
    this.ops.show();
    this.audio.radarOn();
    const crewFlies = this.cap.flightControl.mode === 'crew';
    this.showHandoff('enter', crewFlies ? this.cap.flightControl.label : 'AUTOPILOT ENGAGED', 'MISSION CONTROL', [], ['HANDS OFF · RUN THE SENSORS'], 1.6);
  }

  /** Recon is over: the return leg begins, in the weather the front brought. */
  private startReturnLeg(): void {
    if (this.op.stage !== 'recon' && this.op.stage !== 'outbound') return;
    beginReturn(this.op, MISSION_01, { x: this.a.x, y: this.a.y, z: this.a.z, yaw: this.a.yaw }, (x, z) => this.bundle.heightField.sample(x, z));
    this.autoOps = 0;
    this.setVisibility(MISSION_01.return.visibility);
    this.missionScene.setHazards(MISSION_01.return.hazards);
    this.missionScene.setRoute(this.op.routes.return);
    // suddenly flying again: the first ring is already right ahead (the call goes up once the hand-back card clears)
    this.returnCue = true;
  }

  /** Hand the aircraft back to the pilot. The hand-back is a gameplay event. */
  private takeControls(reason: HandbackReason | 'weather'): void {
    if (this.crew.station !== 'operator') return;
    const session = this.crew.sessionTime;
    handBack(this.crew);
    this.handbackTimer = -1;
    this.scanning = false;
    this.radarRing.visible = false;
    this.el['app'].classList.remove('sensor-feed', 'thermal-feed');
    const extracting = this.mission.phase === 'extract';
    const notices: string[] = [];
    if (extracting) {
      this.startReturnLeg();
      const deck = MISSION_01.return.hazards.find((h) => h.kind === 'ceiling');
      if (deck && this.a.y > deck.y) notices.push('IN CLOUD · DESCEND');
      notices.push(...MISSION_01.return.notices);
    }
    const ho = buildHandover({ reason: reason === 'weather' ? 'complete' : reason, x: this.a.x, z: this.a.z, agl: this.a.agl, fuelSeconds: this.fuel, sessionTime: session, baseX: BASE.x, baseZ: BASE.z, terrainWarning: this.a.terrainWarning, notices });
    this.ops.hide();
    this.chase.reset();
    this.el['hud'].classList.remove('hidden');
    this.audio.radarOff();
    this.audio.warn();
    const who = this.cap.flightControl.mode === 'crew' ? 'COPILOT' : 'AUTOPILOT';
    const kicker = reason === 'manual' ? `${who} OFF` : reason === 'fuel' ? 'BINGO FUEL' : reason === 'weather' ? 'WEATHER FRONT' : 'RECON COMPLETE';
    this.showHandoff('exit', kicker, ho.title, ho.warnings, ho.status, 4);
    this.last = performance.now();
  }

  private handoffTimer = 0;
  private showHandoff(kind: 'enter' | 'exit', kicker: string, title: string, warnings: string[], status: string[], seconds: number): void {
    const el = this.el['handoff'];
    el.querySelector('#ho-kicker')!.textContent = kicker;
    el.querySelector('#ho-title')!.textContent = title;
    el.querySelector('#ho-warn')!.innerHTML = warnings.map((w) => `<li>${w}</li>`).join('');
    el.querySelector('#ho-status')!.innerHTML = status.map((w) => `<li>${w}</li>`).join('');
    el.className = `handoff ${kind}`;
    void el.offsetWidth;
    el.classList.add('on');
    this.handoffTimer = seconds;
  }

  private hideHandoff(): void {
    this.handoffTimer = 0;
    this.el['handoff'].className = 'handoff hidden';
  }

  private opsTools(): OpsTool[] {
    const order: OpsTool[] = ['radar', 'optical', 'thermal', 'sigint'];
    return order.filter((t) => this.cap.sensors.has(t));
  }

  private setOpsTool(t: OpsTool): void {
    if (!this.cap.sensors.has(t)) return;
    this.opsTool = t;
    this.camSettle = 0;
    this.scanning = t === 'radar';
    const operator = this.crew.station === 'operator';
    this.el['app'].classList.toggle('sensor-feed', t === 'optical' && operator);
    this.el['app'].classList.toggle('thermal-feed', t === 'thermal' && operator);
    if (operator) this.audio.click();
  }

  private opsSelect(id: ReturnId): void {
    if (!this.mission.returns[id].detected) return;
    this.opsSelected = id;
    this.camSettle = 0;
    this.audio.click();
    // picking a return is asking to see it: the camera comes up on it
    const m = this.mission;
    if (!isCameraTool(this.opsTool) && (m.phase === 'locate' || m.phase === 'photograph' || m.phase === 'landing') && m.returns[id].verdict !== 'wrong') this.lookAt();
  }

  /** Bring up the best camera for the conditions. */
  private lookAt(): void {
    const cams = this.opsTools().filter(isCameraTool);
    if (!cams.length) return;
    const haze = this.visibility < 0.75 && cams.includes('thermal');
    this.setOpsTool(haze ? 'thermal' : cams[0]);
  }

  /** The guide's one button: whatever the recon loop needs next. */
  private opsNext(a: GuideAction): void {
    const m = this.mission;
    if (a === 'radar') this.setOpsTool('radar');
    else if (a === 'look') {
      if (!this.opsSelected && (m.phase === 'photograph' || m.phase === 'landing')) this.opsSelected = m.phase === 'landing' ? BARGE.id : TARGET.id;
      this.lookAt();
    } else if (a === 'check') {
      if (this.guideCheck) this.setOpsTool(this.guideCheck.sensor);
    } else if (a === 'mark') this.opsMark();
    else if (a === 'photo') this.opsPhoto();
    else if (a === 'next') {
      // the next return still to check, else back to the radar to find more
      const ids = RETURNS.map((r) => r.id).filter((id) => m.returns[id].detected && !m.returns[id].hidden);
      const from = this.opsSelected ? ids.indexOf(this.opsSelected) : -1;
      const order = [...ids.slice(from + 1), ...ids.slice(0, from + 1)];
      const nxt = order.find((id) => id !== this.opsSelected && m.returns[id].verdict === 'none' && !m.returns[id].resolved);
      if (nxt) this.opsSelect(nxt);
      else {
        this.opsSelected = null;
        this.setOpsTool('radar');
      }
    }
  }

  private opsMark(): void {
    const id = this.opsSelected;
    if (!id) {
      this.hud.banner('NO TARGET', 'SELECT A RETURN FIRST', 'bad', 1.8);
      return;
    }
    const { result, events } = identify(this.mission, id);
    if (result === 'already') this.hud.banner('ALREADY MARKED', `RETURN ${id}`, 'bad', 1.6);
    if (result === 'correct') {
      this.audio.mark();
      // keep an imaging sensor on the truck: the next objective is to photograph it
      const cam = this.opsTools().find(isCameraTool);
      if (cam && !isCameraTool(this.opsTool)) this.setOpsTool(cam);
    }
    this.missionEvents(events);
  }

  /** Is the selected return in the camera's view right now? */
  private cameraOn(): { id: ReturnId; slant: number } | null {
    const sel = this.opsSelected;
    if (!sel || !isCameraTool(this.opsTool) || !this.mission.returns[sel].detected || this.camSettle < 0.6) return null;
    const mv = this.movers.get(sel)!;
    const slant = this.slant(mv.x, mv.z);
    return slant < CAMERA_RANGE ? { id: sel, slant } : null;
  }

  private opsPhoto(): void {
    const on = this.cameraOn();
    if (!on) {
      this.hud.banner('NO PHOTO', isCameraTool(this.opsTool) ? 'SELECT A RETURN IN CAMERA RANGE' : 'SWITCH TO A CAMERA FIRST', 'bad', 1.8);
      return;
    }
    const q = photoQuality({ sensor: this.opsTool === 'thermal' ? 'thermal' : 'optical', slant: on.slant, visibility: this.visibility, bonus: this.cap.photoBonus });
    const { result, events } = photograph(this.mission, on.id, q);
    this.ops.flash();
    this.audio.click();
    if (result !== 'unidentified') this.pendingShot = { id: on.id, grade: evidenceGrade(q), sensor: this.opsTool === 'thermal' ? 'thermal' : 'optical' };
    if (result === 'primary') {
      const mv = this.movers.get(TARGET.id)!;
      mv.setRoute(destinationRoute(mv.x, mv.z, mv.segment), false);
      mv.speed = TARGET_SPEED_TO_DESTINATION;
    }
    if (result === 'transfer') this.handbackTimer = -1;
    this.missionEvents(events);
  }

  private opsExtract(): void {
    const ev = extractMission(this.mission, 'manual');
    if (!ev.length) return;
    this.missionEvents(ev);
    this.handbackTimer = 0.6;
  }

  /** Haze / visibility the crew is working in (1 = clear). */
  private setVisibility(v: number): void {
    this.visibility = v;
    const fog = this.bundle.scene.fog as THREE.Fog;
    fog.near = 650 * Math.pow(v, 1.6);
    fog.far = 2300 * v;
  }

  private tryMissionLanding(): void {
    const d = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (this.op.stage !== 'return') {
      this.hud.message(`OBJECTIVE FIRST: ${this.currentObjective().title}`, 'warn');
      return;
    }
    if (d < 480) this.endMission('landed');
    else this.hud.message(`BASE IS ${(d / 1000).toFixed(1)} km AWAY · RETURN WITHIN 480 m TO LAND`, 'warn');
  }

  /** Screen weather: storm darkening and rain (0..1 by proximity), damage vignette (0..1). */
  private setFx(storm: number, hurt: number): void {
    const key = `${storm.toFixed(2)}|${hurt.toFixed(2)}`;
    if (key === this.fxKey) return;
    this.fxKey = key;
    const fx = this.el['fx'];
    fx.style.setProperty('--storm', storm.toFixed(2));
    fx.style.setProperty('--hurt', hurt.toFixed(2));
  }

  private flashScreen(): void {
    const f = this.el['fx'];
    f.classList.remove('flash');
    void f.offsetWidth;
    f.classList.add('flash');
  }

  private endMission(reason: 'landed' | 'fuel' | 'aborted' | 'destroyed'): void {
    if (this.mode !== 'flight' && this.mode !== 'paused') return;
    if (reason === 'landed') this.legEvents(landAtBase(this.op, MISSION_01));
    else endOperation(this.op, reason);
    if (this.crew.station === 'operator') handBack(this.crew);
    this.setFx(0, 0);
    this.missionScene.smoke.clear();
    this.audio.updateWeather(0, 0, 0);
    this.mode = 'debrief';
    this.scanning = false;
    this.radarRing.visible = false;
    this.el['app'].classList.remove('sensor-feed', 'thermal-feed');
    this.ops.hide();
    this.hideHandoff();
    this.audio.updateFlight(0, 0, false, false);
    this.audio.land();
    this.el['pause'].classList.add('hidden');
    this.el['hud'].classList.add('hidden');
    this.hud.clearBanners();
    const r = buildReport(this.mission, this.op, MISSION_01, this.fuel / this.fuelMax, this.crew.timeOnStation);
    const unlocks = recordOperation(this.career, MISSION_01.id, r);
    saveCareer(this.career, localStorage);
    this.report = r;
    this.renderReport(r, unlocks);
    this.el['debrief'].classList.remove('hidden');
  }

  private renderReport(r: Report, unlocks: UnlockDef[]): void {
    const crewNames = Object.values(this.loadout.crew)
      .filter((x): x is string => !!x)
      .map((id) => CREW_BY_ID[id].name);
    this.el['db-headline'].textContent = r.headline;
    this.el['db-headline'].className = r.success ? 'good' : 'bad';
    this.el['db-grade'].textContent = r.grade;
    this.el['db-grade'].className = `db-grade g-${r.grade}`;
    this.el['db-aircraft'].textContent = `${this.cap.aircraftName}${crewNames.length ? ` · ${crewNames.join(', ')}` : ''}`;
    // the operation, stage by stage
    this.el['db-stages'].innerHTML = r.stages
      .map((st, i) => `<div class="st ${st.ok ? 'ok' : 'no'}" style="--i:${i}"><small>${st.label}</small><i>${st.ok ? '✓' : '✕'}</i><b>${st.word}</b></div>`)
      .join('');
    // the evidence the crew brought home
    this.el['db-photos'].innerHTML = this.shots.length
      ? this.shots.map((p) => `<figure><img src="${p.url}" alt="" class="${p.sensor}" /><figcaption>${p.id === TARGET.id ? 'THE TRUCK' : p.id === BARGE.id ? 'THE BARGE' : `RETURN ${p.id}`} · <b class="g-${p.grade}">${p.grade}</b></figcaption></figure>`).join('')
      : '';
    this.el['db-rewards'].innerHTML =
      `<div class="rw"><b data-count="${r.credits}">+0</b><small>CREDITS</small></div><div class="rw"><b data-count="${r.xp}">+0</b><small>XP</small></div>` +
      (unlocks.length ? `<p class="unl">🔓 ${unlocks.map((u) => u.label).join(' · ')}</p>` : '');
    this.countUp(this.el['db-rewards']);
    // the detail, for whoever wants it
    this.el['db-rows-more'].innerHTML = r.rows.map((x) => `<dt>${x.label}</dt><dd class="${x.tone ?? ''}">${x.value}</dd>`).join('');
    this.el['db-secondaries'].innerHTML = `<h3>BONUS OBJECTIVES</h3><ul>${r.secondaries
      .map((s) => `<li class="${s.done ? 'ok' : 'no'}">${s.done ? '✓' : '✕'} ${s.issued ? s.label : 'Not reached'}</li>`)
      .join('')}</ul>`;
    this.el['db-findings'].innerHTML = r.intelligence.length ? `<h3>INTELLIGENCE</h3><ul>${r.intelligence.map((f) => `<li>${f}</li>`).join('')}</ul>` : '';
  }

  /** Rewards tick up rather than appear: a small, satisfying beat. */
  private countUp(root: HTMLElement): void {
    const els = [...root.querySelectorAll<HTMLElement>('[data-count]')];
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0 - 700) / 900);
      for (const e of els) e.textContent = `+${Math.round(Number(e.dataset.count) * Math.max(0, k * (2 - k)))}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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

  /** Slant range from the aircraft to a ground point. */
  private slant(x: number, z: number): number {
    const g = this.bundle.heightField.sample(x, z);
    return Math.hypot(x - this.a.x, z - this.a.z, this.a.y - g);
  }

  private updateMission(dt: number): void {
    const m = this.mission;
    const def = MISSION_01;
    m.time += dt;
    if (this.fuel <= 0) {
      this.endMission('fuel');
      return;
    }
    for (const mv of this.movers.values()) mv.step(dt);
    this.plane.sync(this.a, this.t);
    this.missionScene.animate(this.t, dt);
    if (this.handoffTimer > 0) {
      this.handoffTimer -= dt;
      if (this.handoffTimer <= 0) this.el['handoff'].classList.remove('on');
    }
    if (this.returnCue && this.handoffTimer <= 0.4) {
      this.returnCue = false;
      this.hud.banner('RETURN TO BASE', 'FLY THE RINGS HOME', 'obj', 2.2);
      if (this.op.ret.contact) this.hud.banner('RADAR CONTACT', 'THE RINGS ARE CLOSING', 'bad', 2.4);
    }

    // ---- the operation: gates, weather, the recon window
    const { events, frontArrived, hits } = tickOperation(this.op, def, { x: this.a.x, z: this.a.z, y: this.a.y, agl: this.a.agl }, dt, this.cap);
    if (events.length) this.legEvents(events);
    for (const h of hits) {
      if (h.type === 'destroyed') {
        this.missionScene.strikeAt(this.a.x, this.a.y, this.a.z);
        this.flashScreen();
        this.endMission('destroyed');
        return;
      }
      // lightning: a bolt into the airframe, a white flash, a jolt, a chunk of hull gone
      this.missionScene.strikeAt(this.a.x, this.a.y, this.a.z);
      this.flashScreen();
      this.shake = 1;
      this.jolt = (Math.random() < 0.5 ? -1 : 1) * (0.8 + this.cap.weatherExposure);
      this.audio.strike();
      this.hud.banner('LIGHTNING STRIKE', `HULL ${Math.round((1 - this.op.damage) * 100)}%`, 'bad', 1.4);
    }
    const flying = activeLeg(this.op);
    const legView = flying ?? { def: this.op.routes.outbound, state: this.op.outbound };
    const urgency = legView.state.contact && legView.state.clock !== null ? 1 - Math.max(0, Math.min(1, legView.state.clock / Math.max(0.01, legView.state.clockMax))) : 0;
    this.missionScene.updateRoute(legView.state.index, legView.state.status, ringScale(legView.state), urgency, dt, this.t);
    if (this.op.stage === 'recon') this.setVisibility(reconVisibility(this.op, def));
    if (frontArrived && m.phase !== 'extract') {
      this.missionEvents(extractMission(m, 'weather'));
      if (this.crew.station === 'operator') this.takeControls('weather');
    }
    // bingo fuel ends the recon wherever the player is sitting
    if (this.op.stage === 'recon' && m.phase !== 'extract' && this.fuel / this.fuelMax <= BINGO_FUEL) {
      this.missionEvents(extractMission(m, 'fuel'));
      if (this.crew.station === 'operator') this.takeControls('fuel');
    }
    if (this.crew.station === 'pilot' && m.phase === 'extract' && this.op.stage === 'recon') {
      this.startReturnLeg();
    }

    if (this.crew.station === 'operator') this.updateOperator(dt);
    else this.updatePilot(dt);
    this.missionScene.sync(this.movers, m, this.t);
  }

  // ---- OPERATOR: the autopilot or copilot flies, the player runs the sensors
  private updateOperator(dt: number): void {
    const m = this.mission;
    const crew = this.crew;
    tickCrew(crew, dt);
    const target = this.movers.get(TARGET.id)!;
    const sel = this.opsSelected;
    const selMover = sel ? this.movers.get(sel)! : null;
    const cam = isCameraTool(this.opsTool);

    // the orbit is slaved to the camera's target: the operator directs, never flies
    if (cam && selMover) retaskOrbit(crew, selMover.x, selMover.z);

    // ---- radar: finds and tracks; cannot identify
    const params = radarParams(this.a.agl, 1);
    if (this.opsTool === 'radar') {
      this.updateRadarVisual(dt, params.radius, params.quality);
      const events: MissionEvent[] = [];
      for (const [id, mv] of this.movers) {
        const gain = detectionGain(dt, params, Math.hypot(mv.x - this.a.x, mv.z - this.a.z), RETURN_BY_ID[id], false, MISSION_RATE);
        events.push(...scanReturn(m, id, gain, mv.x, mv.z));
      }
      if (events.length) this.missionEvents(events);
    }

    // ---- SIGINT: bearings to transmitters, radio on/off for known returns
    const bearings: { bearing: number; strength: number }[] = [];
    if (this.opsTool === 'sigint') {
      const events: MissionEvent[] = [];
      for (const [id, mv] of this.movers) {
        const d = Math.hypot(mv.x - this.a.x, mv.z - this.a.z);
        if (d > SIGINT_RANGE) continue;
        if (RETURN_BY_ID[id].radio) bearings.push({ bearing: Math.atan2(mv.x - this.a.x, -(mv.z - this.a.z)), strength: 1 - d / SIGINT_RANGE });
        events.push(...listenReturn(m, id, true));
      }
      if (events.length) this.missionEvents(events);
    }

    // ---- cameras: identify the selected return when it is in range
    this.camSettle += dt;
    const on = this.cameraOn();
    if (on && selMover) {
      m.returns[on.id].lastKnown = { x: selMover.x, z: selMover.z };
      const sensor = this.opsTool === 'thermal' ? 'thermal' : 'optical';
      const seconds = (CAMERA_SECONDS * this.cap.identifyTime) / (sensor === 'optical' ? Math.max(0.35, this.visibility) : 1);
      const ev = inspectReturn(m, on.id, dt, true, sensor, seconds);
      if (ev.length) this.missionEvents(ev);
    }

    // ---- destination: hold a camera on the stopped truck
    if (m.phase === 'track') {
      const ev = updateDestination(m, dt, target.arrived, !!on && on.id === TARGET.id);
      this.missionScene.showDestination(DESTINATION.x, DESTINATION.z, target.arrived);
      if (ev.length) {
        this.missionEvents(ev);
        // the barge is the new task: put the camera on it
        this.opsSelected = BARGE.id;
        this.camSettle = 0;
      }
    }

    // ---- hand back when the work is done (after the console has announced it)
    if (forcedHandback(crew, { fuelFraction: this.fuel / this.fuelMax, operatorWork: operatorWork(m) }) === 'complete') {
      if (this.handbackTimer < 0) this.handbackTimer = 1;
      if (!this.hud.bannerActive) this.handbackTimer -= dt;
      if (this.handbackTimer <= 0) {
        this.takeControls('complete');
        return;
      }
    }

    this.audio.updateFlight(this.a.throttle, this.a.speed, true, this.opsTool === 'radar');
    this.audio.updateWeather(dt, 0, 0);
    this.hud.tickBanners(dt);

    // ---- console frame
    const ro = reconObjective(m, this.stationContext());
    const returns: OpsReturn[] = [];
    for (const r of RETURNS) {
      const st = m.returns[r.id];
      if (!st.detected || !st.lastKnown) continue;
      const mv = this.movers.get(r.id)!;
      returns.push({ id: r.id, x: st.lastKnown.x, z: st.lastKnown.z, traits: describeReturn(m, r.id, st.lastKnown.x, st.lastKnown.z, mv.moving).traits, verdict: st.verdict, resolved: st.resolved });
    }
    const selSt = sel ? m.returns[sel] : null;
    const slant = selMover ? this.slant(selMover.x, selMover.z) : Infinity;
    let camLabel = 'NO TARGET';
    let acquire: number | null = null;
    if (sel && selSt) {
      const rng = `${Math.round(slant)} m`;
      if (slant >= CAMERA_RANGE) camLabel = `${sel} · ${rng} · MOVING IN`;
      else if (!selSt.resolved) camLabel = `${sel} · ${rng} · IDENTIFYING`;
      else camLabel = `${sel} · ${rng} · ${describeReturn(m, sel, 0, 0, true).traits[0]}`;
      if (on && !selSt.resolved) acquire = selSt.look / ((CAMERA_SECONDS * this.cap.identifyTime) / (this.opsTool === 'optical' ? Math.max(0.35, this.visibility) : 1));
      if (m.phase === 'track' && sel === TARGET.id && target.arrived) {
        acquire = m.confirm;
        camLabel = `${sel} · STOPPED · CONFIRMING`;
      }
      if (this.opsTool === 'optical' && this.visibility < 0.8) camLabel += ' · HAZE';
    }
    const anyDetected = returns.length > 0;
    const hasThermal = this.cap.sensors.has('thermal');
    const hasSigint = this.cap.sensors.has('sigint');
    let hint = '';
    if (m.phase === 'locate') {
      if (!anyDetected) hint = this.opsTool === 'radar' ? 'Sweep the roads. Tap the map to move.' : 'Switch to RADAR to search.';
      else if (!sel) hint = 'Pick a return to check.';
      else if (!selSt!.resolved && !cam) hint = `Use a camera on ${sel}.`;
      else if (!selSt!.resolved) hint = 'Hold steady…';
      else if (selSt!.verdict === 'none') hint = `Is ${sel} the truck? Check the clues.`;
      else hint = 'Try another return.';
    } else if (m.phase === 'photograph') hint = cam ? 'Take the photo. Closer is better.' : 'Switch to a camera.';
    else if (m.phase === 'track') hint = target.arrived ? 'It stopped. Hold the camera on it.' : 'Follow it with the camera.';
    else if (m.phase === 'landing') hint = 'Photograph the barge.';
    if (this.visibility < 0.75 && this.opsTool === 'optical' && hasThermal && m.phase !== 'extract') hint = 'Haze! THERMAL sees through it.';
    void hasSigint;
    const displayHint = !cam ? (this.opsTool === 'radar' && !anyDetected ? 'TAP TO MOVE' : this.opsTool === 'sigint' ? `${bearings.length} RADIO${bearings.length === 1 ? '' : 'S'} HEARD` : '') : sel ? '' : 'PICK A RETURN';
    let clues: OpsFrame['clues'] = null;
    let verdict: Verdict = 'unchecked';
    this.guideCheck = null;
    if (sel && selSt && m.phase === 'locate') {
      const r = returns.find((x) => x.id === sel);
      if (r) {
        const fitted = this.opsTools();
        const checks = checkClues(MISSION_01.clues, r.traits);
        verdict = clueVerdict(checks, selSt.resolved, fitted);
        this.guideCheck = verdict === 'check' ? nextCheck(checks, fitted) : null;
        clues = { id: sel, checks, verdict, blind: blindClues(checks, fitted) };
      }
    }
    const guide = reconGuide({ phase: m.phase, anyDetected, selected: sel, camera: cam, resolved: !!selSt?.resolved, marked: selSt?.verdict ?? 'none', verdict, check: this.guideCheck });
    if (m.phase === 'locate' && !(this.visibility < 0.75 && this.opsTool === 'optical' && hasThermal)) hint = '';
    this.ops.update({
      guide,
      clues,
      tool: this.opsTool,
      tools: this.opsTools(),
      control: this.cap.flightControl.label,
      frontSeconds: windowLeft(this.op, MISSION_01),
      objective: { kicker: ro.kicker, title: ro.title, detail: ro.detail, progress: m.phase === 'track' && target.arrived ? m.confirm : null },
      orbit: crew.orbit!,
      aircraft: { x: this.a.x, z: this.a.z, yaw: this.a.yaw, agl: this.a.agl },
      footprint: params.radius,
      sweep: this.sweep,
      fuelSeconds: this.fuel,
      timeOnStation: crew.timeOnStation,
      area: MISSION_01.operations.area,
      returns,
      selected: sel,
      camera: { label: camLabel, acquire },
      canMark: m.phase === 'locate' && !!selSt && selSt.verdict === 'none',
      canPhoto: !!on && m.returns[on.id].resolved,
      canExtract: canExtract(m),
      bearings,
      hint,
      displayHint,
    });
  }

  /** Telephoto sensor view rendered into the console's display. */
  private renderSensorFeed(): void {
    const r = this.ops.displayRect();
    if (r.width < 4 || r.height < 4) return;
    const hf = this.bundle.heightField;
    const cam = this.sensorCam;
    const sel = this.opsSelected ? this.movers.get(this.opsSelected) : null;
    const o = this.crew.orbit;
    const tx = sel ? sel.x : o ? o.x : this.a.x;
    const tz = sel ? sel.z : o ? o.z : this.a.z;
    cam.position.set(this.a.x, this.a.y - 3, this.a.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(tx, hf.sample(tx, tz) + 2, tz);
    const slant = this.slant(tx, tz);
    cam.fov = sel ? clamp((2 * Math.atan(24 / slant) * 180) / Math.PI, 3, 20) : 36;
    cam.aspect = r.width / r.height;
    cam.updateProjectionMatrix();
    const rr = this.bundle.renderer;
    const H = window.innerHeight;
    this.plane.group.visible = false;
    rr.setScissorTest(true);
    rr.setViewport(r.left, H - r.bottom, r.width, r.height);
    rr.setScissor(r.left, H - r.bottom, r.width, r.height);
    this.missionScene.withoutPins(() => rr.render(this.bundle.scene, cam));
    rr.setScissorTest(false);
    rr.setViewport(0, 0, window.innerWidth, H);
    this.plane.group.visible = true;
    // a photograph is the frame just rendered: copy it before the browser clears the buffer
    if (this.pendingShot) {
      const url = this.capture(r);
      if (url) {
        const shot = { ...this.pendingShot, url };
        // one print per return: keep the best
        const old = this.shots.findIndex((p) => p.id === shot.id);
        const rank = (g: string) => ['NONE', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT'].indexOf(g);
        if (old < 0) this.shots.push(shot);
        else if (rank(shot.grade) >= rank(this.shots[old].grade)) this.shots[old] = shot;
        this.ops.showPhoto(shot);
        this.ops.setEvidence(this.shots);
      }
      this.pendingShot = null;
    }
  }

  private capture(r: DOMRect): string | null {
    try {
      const src = this.bundle.renderer.domElement;
      const k = src.width / window.innerWidth;
      const w = 320;
      const h = Math.max(1, Math.round((w * r.height) / r.width));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(src, r.left * k, r.top * k, r.width * k, r.height * k, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  }

  // ---- PILOT: the player flies; the current gate is the objective
  private updatePilot(dt: number): void {
    const m = this.mission;
    const hf = this.bundle.heightField;
    const def = MISSION_01;
    this.hud.tickBanners(0);

    // ---- landing (only the return leg ends at base)
    const dBase = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (this.op.stage === 'return' && dBase < 150 && this.a.agl < 45) {
      this.endMission('landed');
      return;
    }

    const area = this.inOpsArea();
    const opsReady = operatorAvailability(this.crew, { inArea: area, operatorWork: this.reconWork(), fuelFraction: this.fuel / this.fuelMax, areaLabel: def.operations.area.label }).ok;
    this.el['btn-ops'].classList.toggle('ready', opsReady);
    this.el['btn-ops'].classList.toggle('disabled', !opsReady);

    // ---- where to: the current gate, or the sector while recon work remains
    const leg = activeLeg(this.op, def);
    const gate = leg ? currentGate(leg.state, leg.def) : null;
    let waypoint: HudFrame['waypoint'] = null;
    const A = def.operations.area;
    if (gate?.kind === 'ring') waypoint = { x: gate.x, z: gate.z, label: 'RING' };
    else if (this.op.stage === 'recon' && !area) waypoint = { x: (A.x0 + A.x1) / 2, z: (A.z0 + A.z1) / 2, label: A.label };

    // ---- arrived: stop flying, Mission Control takes over
    if (this.autoOps > 0) {
      this.autoOps -= dt;
      if (this.autoOps <= 0) {
        this.autoOps = 0;
        this.opsAction();
        if (this.crew.station === 'operator') return;
      }
    }

    // ---- weather and constraints the pilot has to see
    const chips: { text: string; cls?: string }[] = [];
    const storms: { x: number; z: number; r: number }[] = [];
    let warning = '';
    const hazards = leg ? leg.def.hazards : [];
    for (const h of hazards) {
      if (h.kind === 'storm') {
        const d = Math.hypot(this.a.x - h.x, this.a.z - h.z) - h.r;
        if (this.cap.routeAware || d < 900) storms.push({ x: h.x, z: h.z, r: h.r });
        if (d < 0) warning = 'TURBULENCE';
        else if (d < 400) chips.push({ text: `STORM ${(d / 1000).toFixed(1)} km`, cls: d < 200 ? 'bad' : 'caution' });
      } else {
        const clear = Math.round(h.y - this.a.y);
        if (clear < 0) warning = 'IN CLOUD · DESCEND';
        if (clear < 120) chips.push({ text: clear < 0 ? 'IN CLOUD' : `CLOUDS +${clear} m`, cls: clear < 40 ? 'bad' : 'caution' });
      }
    }
    const R = leg?.def.radar;
    if (R && !leg!.state.detected && this.a.agl > this.cap.stealthCeiling - 40 && this.a.x > R.x0 - 300 && this.a.x < R.x1 + 300 && this.a.z > R.z0 - 300 && this.a.z < R.z1 + 300) chips.push({ text: `TOO HIGH · BELOW ${this.cap.stealthCeiling} m`, cls: 'bad' });
    if (leg?.state.contact && leg.state.clock !== null && gate?.kind === 'ring') chips.push({ text: `⏱ ${Math.max(0, Math.ceil(leg.state.clock))} s`, cls: leg.state.clock < 3 ? 'bad' : 'caution' });
    if (this.op.damage >= 0.02) chips.push({ text: `HULL ${Math.round((1 - this.op.damage) * 100)}%`, cls: this.op.damage > 0.55 ? 'bad' : 'caution' });
    if (this.op.stage === 'recon') chips.push({ text: `FRONT ${formatTime(windowLeft(this.op, def))}`, cls: windowLeft(this.op, def) < 60 ? 'bad' : 'caution' });

    // ---- contextual hint: always says what to do next
    const touch = this.input.isTouch;
    const who = this.cap.flightControl.mode === 'crew' ? 'YOUR COPILOT' : 'THE AUTOPILOT';
    let hint = '';
    if (this.sortieTime < 7) hint = touch ? 'DRAG LEFT SIDE TO STEER · THROTTLE ON THE RIGHT' : 'ARROWS / WASD STEER · SHIFT / CTRL THROTTLE';
    else if (warning.startsWith('IN CLOUD')) hint = touch ? 'PUSH THE STICK DOWN' : 'ARROW DOWN / S TO DESCEND';
    else if (warning.startsWith('TURBULENCE')) hint = 'TURN AWAY FROM THE RED CIRCLE';
    void who;
    this.el['hint'].textContent = hint;

    // ---- camera, audio, HUD
    this.chase.update(this.bundle.camera, this.a, dt, false, (x, z) => hf.sample(x, z));
    // turbulence and strikes shake the camera; damage trails smoke
    if (this.shake > 0) {
      const amp = this.shake * this.shake * 2.6;
      this.bundle.camera.position.x += (Math.random() - 0.5) * amp;
      this.bundle.camera.position.y += (Math.random() - 0.5) * amp;
      this.bundle.camera.position.z += (Math.random() - 0.5) * amp;
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    this.missionScene.smoke.update(dt, this.a.x, this.a.y, this.a.z, -Math.sin(this.a.yaw), -Math.cos(this.a.yaw), this.op.damage);
    let near = 0;
    for (const h of hazards) if (h.kind === 'storm') near = Math.max(near, Math.min(1, Math.max(0, 1 - (Math.hypot(this.a.x - h.x, this.a.z - h.z) - h.r) / 260)));
    this.setFx(near, this.op.damage);
    this.audio.updateWeather(dt, near, this.op.damage);
    // RADAR CONTACT: a heartbeat that quickens as the ring closes
    if (leg?.state.contact && leg.state.clock !== null && gate?.kind === 'ring') {
      const urgency = 1 - Math.max(0, Math.min(1, leg.state.clock / Math.max(0.01, leg.state.clockMax)));
      this.pulseIn -= dt;
      if (this.pulseIn <= 0) {
        this.audio.pulse(urgency);
        this.pulseIn = 0.25 + 0.75 * (1 - urgency);
      }
    }
    this.audio.updateFlight(this.a.throttle, this.a.speed, true, false);
    const contacts: ScopeContact[] = [];
    for (const r of RETURNS) {
      const st = m.returns[r.id];
      if (!st.detected || !st.lastKnown) continue;
      contacts.push({
        x: st.lastKnown.x,
        z: st.lastKnown.z,
        r: 30,
        kind: st.verdict === 'correct' ? 'sensor' : st.resolved || st.verdict === 'wrong' ? 'resolved' : 'detected',
        label: st.verdict === 'correct' ? `${r.id} TRUCK` : st.verdict === 'wrong' ? `${r.id} ✕` : r.id,
        marked: st.verdict === 'wrong',
      });
    }
    const ob = this.currentObjective();
    const params = radarParams(this.a.agl, 1);
    this.hud.update(
      {
        a: this.a,
        scanning: false,
        footprint: params.radius,
        quality: params.quality,
        fuel: this.fuel / this.fuelMax,
        fuelSeconds: this.fuel,
        sensorsLeft: 0,
        sortie: 1,
        sortieLabel: `${this.cap.aircraftName} · ${def.code}`,
        contacts,
        sensors: [],
        waypoint,
        nearBase: dBase < 480 && this.op.stage === 'return',
        signal: null,
        nearContact: null,
        sweepAngle: this.sweep,
        objective: { kicker: ob.kicker, title: ob.title, detail: ob.detail, progress: null, done: false },
        sector: A,
        chips,
        warning,
        storms,
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
    if (this.play === 'mission' && this.crew.station === 'operator' && (this.mode === 'flight' || this.mode === 'paused')) {
      // Mission Control: the radar display is drawn by the console; the camera feed is rendered into it
      if (isCameraTool(this.opsTool)) this.renderSensorFeed();
    } else if (this.mode !== 'intel') this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
    void this.raf;
  }

  private updateFlight(dt: number): void {
    const s = this.state;
    const hf = this.bundle.heightField;
    const cap = capabilities(s);
    this.sortieTime += dt;

    // ---- controls
    // the operator never flies: the autopilot supplies the controls
    const operator = this.play === 'mission' && this.crew.station === 'operator' && this.crew.orbit;
    const perf = this.play === 'mission' ? damagedPerf(this.cap.perf, this.op.damage) : FLIGHT;
    const inp = operator ? orbitInput(this.a, this.crew.orbit!, (x, z) => hf.sample(x, z), perf) : this.input.read();
    // storm cells shake the aircraft (light airframes more) and burn fuel
    let stormBurn = 1;
    if (this.play === 'mission') {
      const leg = activeLeg(this.op, MISSION_01);
      if (leg && leg.def.hazards.some((h) => h.kind === 'storm' && inHazard(h, this.a))) {
        // violent: the stick is fought for, the airframe is thrown about
        const k = 0.6 + 1.4 * this.cap.weatherExposure;
        inp.roll += (Math.random() - 0.5) * 2.2 * k + Math.sin(this.t * 3.1) * 0.5 * k;
        inp.pitch += (Math.random() - 0.5) * 1.8 * k - 0.25 * k * Math.max(0, Math.sin(this.t * 1.7));
        stormBurn = 1.8;
        this.shake = Math.max(this.shake, 0.35);
      }
      // a strike throws the wings over
      if (this.jolt !== 0) {
        inp.roll += this.jolt;
        this.jolt *= Math.max(0, 1 - dt * 3);
        if (Math.abs(this.jolt) < 0.02) this.jolt = 0;
      }
    }
    if (this.input.touchThrottle !== null) {
      if (!operator) this.a.throttle = this.input.touchThrottle;
      this.input.touchThrottle = null;
    }
    if (this.sortieTime < 4.5) {
      inp.pitch = Math.max(inp.pitch, 0.7);
      inp.throttleDelta = 0;
    }
    this.a = stepAircraft(this.a, inp, dt, (x, z) => hf.sample(x, z), perf);
    this.input.syncThrottle(this.a.throttle);
    this.fuel -= dt * stormBurn;
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
