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
import { DEFAULT_RETURNS, DESTINATION, MISSION_01, RETURNS, rollReturns, SECTOR_7, TARGET_SPEED_TO_DESTINATION, type ReturnDef, type ReturnId } from '../mission/mission01';
import { OPERATIONS, operationFor } from '../mission/operations';
import type { MissionDef } from '../mission/missionDef';
import { cleanOperation, escapePressure, planExecute, type ExecutePlan } from '../operation/consequence';
import { BARGE, destinationRoute, evidenceGrade, newMission, TARGET, useReturns, type MissionState } from '../mission/mission';
import { engageOperator, handBack, newCrew, operatorAvailability, tickCrew, type CrewState } from '../mission/crew';
import { inArea } from '../mission/missionDef';
import { orbitInput } from '../flight/autopilot';
import { allCells, ASSET_ORDER, ASSETS, assetFitted, belief, canUse, chooseCorridor, clueChecks, isKnown as cellKnown, mark, newBoard, ruledOut, scoreBoard, traits, useAsset, type AssetId, type BoardEvent, type BoardState, type ControlResult, type Target } from '../control/board';
import { buildExit, TIER_LABEL, type ExitProfile } from '../control/exit';
import { CONTROL_01 } from '../mission/mission01Control';
import { MissionBoard, type BoardAction, type BoardFrame } from '../ui/missionBoard';
import { phaseLine, Preflight } from '../ui/preflight';
import { MissionScene } from '../mission/missionScene';
import { RouteMover } from '../mission/vehicles';
import { CREW_BY_ID } from '../operation/catalog';
import { capabilities as loadoutCapabilities, checkLoadout, defaultLoadout, seatCrew, toggleEquipment, withAircraft, type Capabilities, type Loadout } from '../operation/loadout';
import { activeLeg, beginExecute, beginReturn, damagedPerf, endOperation, flightObjective, landAtBase, launch, newOperation, tickOperation, type OperationState } from '../operation/operation';
import { bonusTaken, currentGate, inHazard, onClock, planDropRun, retargetRing, rings, ringScale, type LegEvent } from '../operation/gates';
import { phaseInfo, phaseMarks, phaseOf, type Phase } from '../operation/phases';
import { advanceCaseFile, casePage, currentLead, pagesOpen } from '../operation/story';
import { buildReport, type Report } from '../operation/score';
import { isUnlocked, loadCareer, recordOperation, saveCareer, squadronLine, type Career, type UnlockDef } from '../operation/career';
import { pauseTransition, type Mode } from './modes';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const SORTIE_FUEL = 330; // seconds of flight on the standard fit

/** A photograph in the evidence strip. */
interface Shot {
  id: ReturnId;
  url: string;
  grade: string;
  sensor: 'optical' | 'thermal';
}

/** A vehicle is in the sector if its whole road is (decoys never cross the line). */
const inSector = (r: ReturnDef) => r.route.every(([x, z]) => x >= SECTOR_7.x0 && x <= SECTOR_7.x1 && z >= SECTOR_7.z0 && z <= SECTOR_7.z1);

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
  /** Mission Control: the board, its state, and what EXECUTE produced. */
  private board: MissionBoard;
  private control: BoardState = newBoard(CONTROL_01, DEFAULT_RETURNS, ['radar', 'optical'], Math.random);
  private controlResult: ControlResult | null = null;
  private exit: ExitProfile | null = null;
  /** The board action playing out (a drone in the air, a camera closing in). */
  private pending: { asset: AssetId; target: Target; t: number; dur: number } | null = null;
  /** Seconds until the front forces EXECUTE (0: off). */
  private forceExec = 0;
  private rankSounded = false;
  private forecastCache: { key: string; value: BoardFrame['forecast'] } = { key: '', value: null };
  private lastTier = '';
  /** Prints from the board's camera and drone looks. */
  private photos = new Map<ReturnId, { url: string; thermal: boolean; quality: number }>();
  /** Seconds until Mission Control opens itself after arriving on station (0: off). */
  private autoOps = 0;
  /** RETURN TO BASE is waiting for the hand-back card to clear. */
  private returnCue = false;
  /** Camera shake (0..1, decays) and a roll jolt from the last lightning strike. */
  private shake = 0;
  private jolt = 0;
  private fxKey = '';
  private pulseIn = 0;
  private visibility = 1;
  private sensorCam = new THREE.PerspectiveCamera(20, 1, 1, 4200);
  /** The page of the case file being flown, and the operation it is. */
  private page = 0;
  private def: MissionDef = MISSION_01;
  /** EXECUTE as Mission Control shaped it (ring size, a halted or rolling target, a window). */
  private plan: ExecutePlan | null = null;
  /** Wheels down: the HOME stamp lands before the debrief does (seconds left). */
  private homeBeat = 0;
  /** A kick of field of view when the pass is made (0..1, decays). */
  private fovKick = 0;
  /** The operation plan and its derived rules. */
  private loadout: Loadout = defaultLoadout();
  private cap: Capabilities = loadoutCapabilities(defaultLoadout());
  private op: OperationState = newOperation(MISSION_01, defaultLoadout());
  private career: Career;
  private preflight: Preflight;
  private report: Report | null = null;
  /** Photographs taken this operation (evidence). */
  private shots: Shot[] = [];
  /** EXECUTE: seconds into the drop run, the payload in the air, and the world's reaction to the drop. */
  private execT = 0;
  private payload: SensorPackage | null = null;
  private reaction: { t: number; result: 'tagged' | 'missed'; reacted: boolean } | null = null;
  /** The phase card on screen (seconds left) and the phase the HUD is themed for. */
  private phaseTimer = 0;
  /** Visibility easing toward the escape's weather (the front closes in where you can see it). */
  private visEase: { from: number; to: number; t: number } | null = null;
  /** A page of the case file this operation turned (debrief). */
  private newLead: string | null = null;

  constructor(root: HTMLElement) {
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['gl', 'hud', 'intel', 'title', 'pause', 'hint', 'btn-begin', 'btn-continue', 'btn-newcase-title', 'stick-zone', 'stick-knob', 'throttle', 'btn-scan', 'btn-mark', 'btn-drop', 'btn-map', 'btn-pause', 'btn-rtb', 'btn-resume-pause', 'btn-map-pause', 'btn-end-sortie', 'btn-sound-pause', 'loading', 'btn-mission', 'btn-open-case', 'btn-case-back', 'mission-card', 'case-card', 'mission-brief', 'debrief', 'btn-fly-again', 'btn-debrief-menu', 'db-headline', 'db-rows-more', 'db-stages', 'db-photos', 'db-findings', 'pause-objective', 'btn-ops', 'handoff', 'board', 'db-control', 'preflight', 'career-line', 'db-grade', 'db-aircraft', 'db-secondaries', 'db-rewards', 'fx', 'phase-card', 'db-story', 'case-pages', 'db-code']) {
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
    this.board = new MissionBoard(this.el['board'], {
      onUse: (a, t) => this.boardUse(a, t),
      onMark: (id) => this.boardMark(id),
      onCorridor: (id) => {
        if (this.control.executed) return;
        chooseCorridor(this.control, this.def.control, id);
        this.audio.click();
      },
      onExecute: () => this.executeBoard(),
      onFlyOut: () => this.flyOut(),
      onPause: () => this.togglePause(),
      onTap: () => this.audio.click(),
    });
    this.career = loadCareer(localStorage);
    this.setPage(casePage(this.career));
    // the case file's pages: tap one that is open to fly it again
    this.el['case-pages'].addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (!b || b.classList.contains('locked')) return;
      this.setPage(Number(b.dataset.page));
      this.audio.click();
      this.showTitle();
    });
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
      // Mission Control: read the board, and play it through the same handlers as the UI
      getBoard: () => this.control,
      getControlResult: () => this.controlResult,
      getExit: () => this.exit,
      boardUse: (a: AssetId, t: Target) => this.boardUse(a, t),
      boardMark: (id: ReturnId) => this.boardMark(id),
      boardRoute: (id: string) => chooseCorridor(this.control, this.def.control, id),
      boardExecute: () => this.executeBoard(),
      boardFlyOut: () => this.flyOut(),
      boardPending: () => !!this.pending,
      getVisibility: () => this.visibility,
      getOperation: () => this.op,
      getLoadout: () => this.loadout,
      getCareer: () => this.career,
      getReport: () => this.report,
      getPhase: () => phaseOf(this.op.stage),
      getDef: () => this.def,
      getPage: () => this.page,
      setPage: (n: number) => {
        this.setPage(n);
        this.showTitle();
      },
      getPlan: () => this.plan,
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
    const M = this.def;
    // the squadron's record, or nothing at all: a new squadron sees the basin and the hook
    const record = squadronLine(c, M.id);
    this.el['career-line'].textContent = record ?? '';
    this.el['career-line'].classList.toggle('hidden', !record);
    this.hud.clearBanners();
    const lead = currentLead(this.career, this.page);
    this.el['mission-brief'].innerHTML =
      `<p class="mb-code">${M.code} · CASE FILE ${lead.page}/${lead.total}${lead.closed ? ' · CLOSED' : ''}</p>` +
      `<h2 class="mb-head">${esc(lead.text)}</h2>` +
      phaseLine(M.story.verbs);
    // the pages: the ones turned are open to fly again
    const open = pagesOpen(this.career);
    this.el['case-pages'].classList.toggle('hidden', open < 2);
    this.el['case-pages'].innerHTML = OPERATIONS.map((_o, i) => `<button type="button" data-page="${i}" class="${i === this.page ? 'on' : i < open ? 'open' : 'locked'}" aria-pressed="${i === this.page}"${i >= open ? ' disabled' : ''}>${i + 1}</button>`).join('');
    this.setPhaseTheme(null);
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

  private leaveMissionStations(): void {
    if (this.crew.station === 'operator') handBack(this.crew);
    this.board.hide();
    this.pending = null;
    this.hideHandoff();
    this.setVisibility(1);
    this.visEase = null;
    this.missionScene.setWaypoint(null);
    this.missionScene.setDropZone(null);
    this.missionScene.setAlarm(0);
    this.hidePhaseCard();
    if (this.payload) this.bundle.scene.remove(this.payload.group);
    this.payload = null;
    this.reaction = null;
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
      if (this.crew.station !== 'operator') this.hud.message('RECON SYSTEMS RUN FROM MISSION CONTROL', 'sys');
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
      if (this.crew.station !== 'operator') this.hud.message('MARK TARGETS FROM MISSION CONTROL', 'sys');
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
    this.preflight.render(this.def, this.career, this.loadout);
    this.preflight.show();
  }

  private updateLoadout(l: Loadout): void {
    this.loadout = l;
    this.audio.click();
    this.preflight.render(this.def, this.career, l);
  }

  private launchOperation(): void {
    if (!checkLoadout(this.loadout, (id) => isUnlocked(this.career, id)).ok) return;
    this.career.lastLoadout = this.loadout;
    saveCareer(this.career, localStorage);
    this.preflight.hide();
    this.startMission();
  }

  /** Fly a page of the case file: its operation becomes the mission. */
  private setPage(n: number): void {
    this.page = Math.max(0, Math.min(OPERATIONS.length - 1, pagesOpen(this.career) - 1, n));
    this.def = operationFor(this.page);
  }

  private startMission(): void {
    const hf = this.bundle.heightField;
    const def = this.def;
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
    // a fresh board: the ways home and what is on them are dealt again
    this.control = newBoard(def.control, RETURNS, this.loadout.equipment, Math.random);
    this.controlResult = null;
    this.exit = null;
    this.pending = null;
    this.forceExec = 0;
    this.rankSounded = false;
    this.lastTier = '';
    this.forecastCache = { key: '', value: null };
    this.photos.clear();
    this.report = null;
    this.shots = [];
    this.execT = 0;
    this.reaction = null;
    this.plan = null;
    this.homeBeat = 0;
    this.fovKick = 0;
    this.el['app'].classList.remove('beat');
    this.newLead = null;
    if (this.payload) this.bundle.scene.remove(this.payload.group);
    this.payload = null;
    this.visEase = null;
    this.missionScene.setAlarm(0, true);
    this.missionScene.setDropZone(null);
    this.setVisibility(1);
    this.movers.clear();
    for (const r of RETURNS) this.movers.set(r.id, new RouteMover(r.route, r.speed, r.start, true));
    this.missionScene.setLights(TARGET.id, false);
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
    this.board.hide();
    this.hideHandoff();
    this.el['hud'].classList.add('mission');
    this.el['hud'].classList.remove('hidden');
    this.intel.close();
    this.hud.clearBanners();
    this.showPhase('recon');
    this.mode = 'flight';
    this.last = performance.now();
  }


  /** Ring and hazard events from the flying legs: every ring flown through is stamped. */
  private legEvents(events: LegEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'gate-passed': {
          if (e.id === 'land' || e.id === 'drop') break;
          const op = this.exit?.opportunities.find((o) => o.ringId === e.id);
          if (op) {
            // an opportunity Mission Control earned: the photo pass
            this.audio.unlockSound();
            this.hud.banner('OPPORTUNITY', `${op.label} · PHOTOGRAPHED`, 'done', 2.2);
            if (op.kind === 'barge') this.mission.transferPhotographed = true;
            break;
          }
          // the last ring home is the runway: it sounds like arriving
          if (this.op.stage === 'return' && rings(this.op.routes.return).slice(-1)[0]?.id === e.id) this.audio.finalRing();
          else this.audio.ring();
          this.hud.banner('GATE CLEARED', `RING ${e.text}`, 'done', 1.4);
          break;
        }
        case 'gate-missed':
          if (e.id === 'drop') break;
          if (this.exit?.opportunities.some((o) => o.ringId === e.id)) {
            this.hud.message('OPPORTUNITY PASSED BY', 'warn');
            break;
          }
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
    return inArea(this.def.operations.area, this.a.x, this.a.z);
  }


  /** What the player should be doing right now, whichever seat they are in. */
  private currentObjective(): { kicker: string; title: string; detail: string } {
    const fo = flightObjective(this.op, this.def, this.cap);
    if (fo) return fo;
    if (this.op.stage === 'execute') return { kicker: 'PASS', title: this.op.execResult === 'tagged' ? this.def.execute.done.kicker : this.def.execute.missed.kicker, detail: 'STAND BY' };
    if (this.crew.station === 'operator') return { kicker: 'MISSION CONTROL', title: this.control.marked ? 'PLAN THE WAY HOME' : 'FIND THE SUPPLY TRUCK', detail: `FRONT IN ${this.control.minutes} MIN` };
    return { kicker: 'ON STATION', title: 'MISSION CONTROL', detail: this.inOpsArea() ? 'OPEN MISSION CONTROL' : `FLY BACK TO ${this.def.operations.area.label}` };
  }

  private reconWork(): boolean {
    return this.op.stage === 'recon' && !this.control.executed;
  }

  /** The OPS key / button: sit down at Mission Control (the autopilot or copilot flies). */
  private opsAction(): void {
    if (this.mode !== 'flight' || this.play !== 'mission' || this.crew.station === 'operator') return;
    const av = operatorAvailability(this.crew, {
      inArea: this.inOpsArea(),
      operatorWork: this.reconWork(),
      fuelFraction: this.fuel / this.fuelMax,
      areaLabel: this.def.operations.area.label,
    });
    if (!av.ok) {
      this.hud.message(this.op.stage === 'outbound' && this.inOpsArea() === false ? `${av.reason} · FLY THE RINGS FIRST` : av.reason, 'warn');
      return;
    }
    const o = this.cap.orbit;
    engageOperator(this.crew, this.a.x, this.a.z, o.agl);
    this.crew.orbit!.r = o.r;
    this.el['hud'].classList.add('hidden');
    // the flight's calls stay with the flight: the board starts clean
    this.hud.clearBanners();
    this.board.show();
    this.audio.radarOn();
    const crewFlies = this.cap.flightControl.mode === 'crew';
    this.showHandoff('enter', crewFlies ? this.cap.flightControl.label : 'AUTOPILOT ENGAGED', 'MISSION CONTROL', [], [`THE FRONT ARRIVES IN ${this.control.minutes} MIN`], 1.6);
  }

  /** The flight out: the leg Mission Control's Exit Profile generated. */
  private startReturnLeg(): { line: string | null } {
    if ((this.op.stage !== 'recon' && this.op.stage !== 'execute') || !this.exit) return { line: null };
    const ex = this.exit;
    // EXECUTE answers ESCAPE: a pass made is the plan as built; a pass missed, or never flown, was seen
    const exec = this.op.execResult ?? (this.op.stage === 'execute' ? 'missed' : 'skipped');
    const press = escapePressure(this.def.escape, exec, { contactFromStart: ex.contactFromStart, visibility: ex.leg.visibility });
    beginReturn(this.op, { return: ex.leg }, { x: this.a.x, y: this.a.y, z: this.a.z, yaw: this.a.yaw }, (x, z) => this.bundle.heightField.sample(x, z), press.contact, press.pace);
    // the first ring is laid wherever the aircraft happens to be: never start in a storm, never fly into one at once
    const join = this.op.routes.return.gates[0];
    const clear = (h: { x: number; z: number; r: number }) => Math.hypot(h.x - this.a.x, h.z - this.a.z) > h.r + 80 && (join?.kind !== 'ring' || Math.hypot(h.x - join.x, h.z - join.z) > h.r + 50);
    this.op.routes.return.hazards = this.op.routes.return.hazards.filter((h) => h.kind !== 'storm' || clear(h));
    this.fuel = Math.min(this.fuelMax, ex.fuelSeconds);
    this.autoOps = 0;
    // the weather closes in where the pilot can watch it happen
    this.visEase = { from: this.visibility, to: press.visibility, t: 0 };
    this.missionScene.setHazards(this.op.routes.return.hazards);
    this.missionScene.setRoute(this.op.routes.return);
    // suddenly flying again: the first ring irises in right ahead (the call goes up once the hand-back card clears)
    this.missionScene.spawnNext(0);
    this.audio.spawn();
    this.returnCue = true;
    return { line: press.line };
  }

  /**
   * Off the board and back in the seat. With the target marked, EXECUTE: the
   * drop run. Without one there is nothing to tag: straight to ESCAPE.
   */
  private flyOut(): void {
    if (this.crew.station !== 'operator' || !this.control.executed || !this.exit) return;
    handBack(this.crew);
    // wings level, nose on the horizon
    this.a.roll = 0;
    this.a.pitch = 0;
    this.scanning = false;
    this.radarRing.visible = false;
    this.board.hide();
    this.hud.clearBanners();
    this.el['hud'].classList.remove('hidden');
    this.audio.radarOff();
    if (this.control.marked) this.startExecute();
    else this.startEscape();
    this.chase.reset();
    this.last = performance.now();
  }

  /**
   * EXECUTE: the aircraft is lined up on the target; one ring stands over it.
   * RECON shaped it: the board's rank sizes the ring, and a target identified
   * on evidence pulls over for the run while one marked on a hunch rolls on.
   */
  private startExecute(): void {
    const ground = (x: number, z: number) => this.bundle.heightField.sample(x, z);
    const mv = this.movers.get(TARGET.id)!;
    const cr = this.controlResult;
    const plan = planExecute(this.def.execute, cr ? { rank: cr.rank, confirmed: cr.confirmed } : null);
    this.plan = plan;
    if (plan.halts) mv.speed = 0;
    const run = planDropRun({ x: mv.x, z: mv.z }, { x: this.a.x, z: this.a.z }, ground, { title: this.def.story.execute.title, run: plan.run, agl: plan.agl, r: plan.r, cue: this.def.execute.cue });
    Object.assign(this.a, { x: run.start.x, y: run.start.y, z: run.start.z, yaw: run.start.yaw, roll: 0, pitch: 0, throttle: 0.75 });
    this.a.speed = Math.max(this.a.speed, this.cap.perf.maxSpeed * 0.65);
    this.a.agl = this.a.y - ground(this.a.x, this.a.z);
    this.input.syncThrottle(this.a.throttle);
    beginExecute(this.op, run.route, plan.window);
    this.execT = 0;
    this.reaction = null;
    this.missionScene.setHazards([]);
    this.missionScene.setRoute(run.route);
    this.missionScene.spawnNext(0);
    this.missionScene.setWaypoint({ x: mv.x, z: mv.z });
    this.missionScene.setDropZone({ x: mv.x, z: mv.z });
    this.showPhase('execute', plan.line ?? undefined, plan.window ? [{ t: `${plan.window} s`, bad: true }] : []);
  }

  /** A rolling target: its ring, beam and ground reticle stay over it. */
  private followTarget(): void {
    const mv = this.movers.get(TARGET.id)!;
    const ground = (x: number, z: number) => this.bundle.heightField.sample(x, z);
    const g = this.op.routes.execute ? retargetRing(this.op.routes.execute, 'drop', { x: mv.x, z: mv.z }, ground) : null;
    if (g) this.missionScene.moveRing('drop', g.x, g.y, g.z);
    this.missionScene.setWaypoint({ x: mv.x, z: mv.z });
    this.missionScene.setDropZone({ x: mv.x, z: mv.z });
  }

  /**
   * The pass, in three beats. This is the moment the game is built around.
   *
   *   0.0  the ring is behind you: the stamp, the payload falls, the sound
   *        dips, the HUD steps back, the view widens a touch. A held breath.
   *   1.0  the world answers: the truck's lamps come on and it bolts, the
   *        sector boundary turns from amber to red in a wave, a low alarm
   *        under everything, the camera shudders. Nobody is hiding now.
   *   2.4  ESCAPE: the first ring irises in dead ahead, the HUD goes red,
   *        the clock starts. You are not completing a mission any more.
   *        You are getting out.
   */
  private onDrop(result: 'tagged' | 'missed', lost = false): void {
    this.reaction = { t: 0, result, reacted: false };
    this.hidePhaseCard();
    this.missionScene.setDropZone(null);
    this.missionScene.setWaypoint(null);
    const X = this.def.execute;
    this.el['app'].classList.add('beat');
    this.audio.duck(0.4, 1.1);
    this.fovKick = 1;
    if (result === 'tagged') {
      if (X.drops) {
        const sy = Math.sin(this.a.yaw);
        const cy = Math.cos(this.a.yaw);
        const p = new SensorPackage(this.a.x, this.a.y - 2, this.a.z, -sy * this.a.speed * 0.5, -6, -cy * this.a.speed * 0.5);
        this.payload = p;
        this.bundle.scene.add(p.group);
        this.audio.drop();
      } else this.audio.sensorLink();
      this.hud.banner(X.done.kicker, X.done.text, 'done', 1.3);
    } else {
      this.audio.ringMissed();
      this.hud.banner(lost ? (this.plan?.window ? 'OUT OF TIME' : 'TARGET LOST') : X.missed.kicker, X.missed.text, 'bad', 1.3);
    }
  }

  /** The world answers the pass: the truck bolts, the sector lights up red. Then: get out. */
  private tickReaction(dt: number): void {
    const re = this.reaction;
    if (!re) return;
    re.t += dt;
    if (!re.reacted && re.t >= 1.0) {
      re.reacted = true;
      const mv = this.movers.get(TARGET.id)!;
      if (!this.control.shadowed) mv.setRoute(destinationRoute(mv.x, mv.z, mv.segment), false);
      mv.speed = TARGET_SPEED_TO_DESTINATION * 1.5;
      this.missionScene.setLights(TARGET.id, true);
      this.missionScene.showDestination(DESTINATION.x, DESTINATION.z, true);
      this.missionScene.setAlarm(1);
      this.audio.alarm();
      if (re.result === 'tagged') this.audio.payload();
      this.shake = Math.max(this.shake, 0.45);
      const R = this.def.escape.reaction;
      this.hud.banner(re.result === 'tagged' ? `${this.def.story.payload} LIVE` : 'THEY SAW YOU', re.result === 'tagged' ? R.tagged : R.missed, 'bad', 1.3);
    }
    if (re.t >= 2.4) {
      this.reaction = null;
      this.el['app'].classList.remove('beat');
      this.startEscape();
    }
  }

  /** ESCAPE: the Exit Profile becomes the flight home, starting with a ring dead ahead. */
  private startEscape(): void {
    if (!this.exit) return;
    this.missionScene.setAlarm(1);
    const { line } = this.startReturnLeg();
    const notices = this.exit.leg.notices.filter((n) => !n.startsWith('OPPORTUNITY'));
    if (this.op.ret.contact && !notices.some((n) => n.startsWith('RADAR CONTACT'))) notices.unshift('RADAR CONTACT · RINGS CLOSING');
    const deck = this.op.routes.return.hazards.find((h) => h.kind === 'ceiling');
    if (deck && deck.kind === 'ceiling' && this.a.y > deck.y) notices.unshift('IN CLOUD · DESCEND');
    const good = this.exit.opportunities.length ? [`BONUS: ${this.exit.opportunities.map((o) => o.label).join(' · ')}`] : [];
    this.showPhase('escape', line ?? undefined, [...notices.slice(0, 2).map((t) => ({ t, bad: true })), ...good.map((t) => ({ t, bad: false }))]);
  }

  // ---- phases: the card when one begins, and the HUD theme while it lasts
  private showPhase(p: Phase, line?: string, notes: { t: string; bad: boolean }[] = []): void {
    const S = this.def.story;
    const copy = S[p];
    const info = phaseInfo(p);
    const el = this.el['phase-card'];
    el.querySelector('#pc-n')!.textContent = info.n;
    el.querySelector('#pc-label')!.textContent = info.label;
    el.querySelector('#pc-title')!.textContent = copy.title;
    el.querySelector('#pc-line')!.innerHTML = esc(line ?? copy.line) + (notes.length ? `<span class="pc-notes">${notes.map((n) => `<i class="${n.bad ? 'bad' : 'good'}">${esc(n.t)}</i>`).join('')}</span>` : '');
    const stage = p === 'recon' ? 'outbound' : p === 'execute' ? 'execute' : 'return';
    el.querySelector('#pc-dots')!.innerHTML = phaseMarks(stage, this.op.execResult).map((m) => `<i class="${m}"></i>`).join('');
    el.className = `phase-card ph-${p}`;
    void el.offsetWidth;
    el.classList.add('on');
    this.el['app'].classList.add('carding');
    // in flight the card must not hide the ring for long: short, and see-through
    this.phaseTimer = p === 'recon' ? 2.4 : p === 'escape' && notes.length ? 2.2 : 1.8;
    this.setPhaseTheme(p);
    this.audio.phase(p);
  }

  private hidePhaseCard(): void {
    this.phaseTimer = 0;
    this.el['phase-card'].className = 'phase-card hidden';
    this.el['app'].classList.remove('carding');
  }

  private setPhaseTheme(p: Phase | null): void {
    if (p) this.el['app'].dataset.phase = p;
    else delete this.el['app'].dataset.phase;
  }

  private handoffTimer = 0;
  private showHandoff(kind: 'enter' | 'exit' | 'calm', kicker: string, title: string, warnings: string[], status: string[], seconds: number): void {
    const el = this.el['handoff'];
    el.querySelector('#ho-kicker')!.textContent = kicker;
    el.querySelector('#ho-title')!.textContent = title;
    el.querySelector('#ho-warn')!.innerHTML = warnings.map((w) => `<li>${w}</li>`).join('');
    el.querySelector('#ho-status')!.innerHTML = status.map((w) => `<li>${w}</li>`).join('');
    el.className = `handoff ${kind}`;
    void el.offsetWidth;
    el.classList.add('on');
    this.el['hud'].classList.add('handing');
    this.handoffTimer = seconds;
  }

  private hideHandoff(): void {
    this.handoffTimer = 0;
    this.el['handoff'].className = 'handoff hidden';
    this.el['hud'].classList.remove('handing');
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
    if (d < 480) this.touchDown();
    else this.hud.message(`BASE IS ${(d / 1000).toFixed(1)} km AWAY · RETURN WITHIN 480 m TO LAND`, 'warn');
  }

  /** Wheels down: the stamp lands, the sound settles, and a breath later the debrief. */
  private touchDown(): void {
    if (this.homeBeat > 0 || this.op.stage !== 'return') return;
    this.homeBeat = 1.4;
    this.missionScene.setAlarm(0);
    this.setPhaseTheme(null);
    this.hud.clearBanners();
    this.hud.banner('HOME', 'WHEELS DOWN', 'done', 1.4);
    this.audio.home();
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
    if (reason === 'landed') this.legEvents(landAtBase(this.op, this.def));
    else endOperation(this.op, reason);
    if (this.crew.station === 'operator') handBack(this.crew);
    this.setFx(0, 0);
    this.missionScene.smoke.clear();
    this.audio.updateWeather(0, 0, 0);
    this.mode = 'debrief';
    this.scanning = false;
    this.radarRing.visible = false;
    this.board.hide();
    this.pending = null;
    this.hideHandoff();
    this.audio.updateFlight(0, 0, false, false);
    if (reason === 'destroyed' || reason === 'fuel') this.audio.lost();
    else if (reason === 'aborted') this.audio.land();
    this.homeBeat = 0;
    this.el['app'].classList.remove('beat');
    this.el['pause'].classList.add('hidden');
    this.el['hud'].classList.add('hidden');
    this.hud.clearBanners();
    this.shots = this.evidence();
    const cr = this.controlResult;
    const r = buildReport(this.mission, this.op, this.def, this.fuel / this.fuelMax, (this.control.maxMinutes - this.control.minutes) * 60, cr ? { total: cr.total, rank: cr.rank } : undefined);
    const unlocks = recordOperation(this.career, this.def.id, r);
    this.newLead = advanceCaseFile(this.career, cleanOperation(r.success, this.op.execResult), this.page);
    saveCareer(this.career, localStorage);
    this.setPhaseTheme(null);
    this.hidePhaseCard();
    this.reaction = null;
    this.report = r;
    this.renderReport(r, unlocks);
    // a page turned: the next operation is the new page
    if (this.newLead && !this.career.caseClosed) this.setPage(casePage(this.career));
    this.el['debrief'].classList.remove('hidden');
  }

  private renderReport(r: Report, unlocks: UnlockDef[]): void {
    const crewNames = Object.values(this.loadout.crew)
      .filter((x): x is string => !!x)
      .map((id) => CREW_BY_ID[id].name);
    this.el['db-code'].textContent = `${this.def.code} · DEBRIEF`;
    this.el['db-headline'].textContent = r.headline;
    this.el['db-headline'].className = r.success ? 'good' : 'bad';
    this.el['db-grade'].textContent = r.grade;
    this.el['db-grade'].className = `db-grade g-${r.grade}`;
    this.el['db-aircraft'].textContent = `${this.cap.aircraftName}${crewNames.length ? ` · ${crewNames.join(', ')}` : ''}`;
    // the operation, stage by stage
    this.el['db-stages'].innerHTML = r.stages
      .map((st, i) => `<div class="st ${st.ok ? 'ok' : 'no'}" style="--i:${i}"><small>${st.label}</small><i>${st.ok ? '✓' : '✕'}</i><b>${st.word}</b></div>`)
      .join('');
    // the case file: one line of the bigger story
    const lead = currentLead(this.career, this.page);
    const closed = this.newLead !== null && this.career.caseClosed && this.page === OPERATIONS.length - 1;
    const replay = this.page < casePage(this.career);
    this.el['db-story'].innerHTML = this.newLead
      ? `<small>${closed ? 'CASE CLOSED · THE LOG' : `CASE FILE ${lead.page + 1}/${lead.total} · NEW LEAD`}</small><b>${esc(this.newLead)}</b>`
      : `<small>CASE FILE ${lead.page}/${lead.total}${replay ? ' · REPLAY' : lead.closed ? ' · CLOSED' : ''}</small><b>${esc(lead.text)}</b><span>${replay || lead.closed ? 'EVERY PAGE STAYS OPEN · BEAT YOUR BEST' : 'NEXT LEAD: FIND IT · TAG IT · GET HOME'}</span>`;
    this.el['db-story'].classList.toggle('new', !!this.newLead);
    this.el['db-story'].classList.toggle('closed', closed);
    // the evidence the crew brought home
    this.el['db-photos'].innerHTML = this.shots.length
      ? this.shots.map((p) => `<figure><img src="${p.url}" alt="" class="${p.sensor}" /><figcaption>${p.id === TARGET.id ? 'THE TRUCK' : p.id === BARGE.id ? 'THE BARGE' : `RETURN ${p.id}`} · <b class="g-${p.grade}">${p.grade}</b></figcaption></figure>`).join('')
      : '';
    // Mission Control: the score, the rank, the best, and the hook to play it again
    const cr = this.controlResult;
    const best = this.career.controlBest[this.def.id];
    const taken = bonusTaken(this.op.ret, this.op.routes.return).length;
    const offered = this.exit?.opportunities.length ?? 0;
    this.el['db-control'].innerHTML = cr && this.exit
      ? `<small>MISSION CONTROL</small><b>${cr.total.toLocaleString('en-US')}</b><span class="mr-rank r-${cr.rank}">${cr.rank}</span><small>EXIT ${TIER_LABEL[this.exit.tier]}${offered ? ` · ${taken}/${offered} OPPORTUNIT${offered > 1 ? 'IES' : 'Y'}` : ''}</small><span class="best">PERSONAL BEST ${(best ?? cr.total).toLocaleString('en-US')}</span><p>${this.replayHook()}</p>`
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


  private updateMission(dt: number): void {
    const m = this.mission;
    const def = this.def;
    m.time += dt;
    if (this.homeBeat > 0) {
      this.homeBeat -= dt;
      if (this.homeBeat <= 0) {
        this.endMission('landed');
        return;
      }
    }
    if (this.fuel <= 0) {
      this.endMission('fuel');
      return;
    }
    for (const mv of this.movers.values()) mv.step(dt);
    this.plane.sync(this.a, this.t);
    this.missionScene.animate(this.t, dt);
    if (this.handoffTimer > 0) {
      this.handoffTimer -= dt;
      if (this.handoffTimer <= 0) {
        this.el['handoff'].classList.remove('on');
        this.el['hud'].classList.remove('handing');
      }
    }
    if (this.phaseTimer > 0) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.el['phase-card'].classList.remove('on');
        this.el['app'].classList.remove('carding');
      }
    }
    if (this.returnCue && this.phaseTimer <= 0.4) {
      this.returnCue = false;
      if (this.op.ret.contact) this.hud.banner('RADAR CONTACT', 'THE RINGS ARE CLOSING', 'bad', 2.4);
    }
    if (this.visEase) {
      const v = this.visEase;
      v.t = Math.min(1, v.t + dt / 3);
      this.setVisibility(v.from + (v.to - v.from) * v.t * (2 - v.t));
      if (v.t >= 1) this.visEase = null;
    }
    if (this.payload && !this.payload.landed) this.payload.step(dt, this.bundle.heightField, this.t);

    // ---- the operation: gates and weather (on station, Mission Control keeps its own clock)
    const windowBefore = this.op.stage === 'execute' && this.op.exec ? this.op.exec.clock : null;
    const { events, hits } = tickOperation(this.op, def, { x: this.a.x, z: this.a.z, y: this.a.y, agl: this.a.agl }, dt, this.cap);
    if (events.length) this.legEvents(events);
    // EXECUTE: one pass at the ring (on a window, the ring closes; otherwise wander off for too long and the target is lost)
    if (this.op.stage === 'execute' && !this.reaction) {
      this.execT += dt;
      if (this.plan && !this.plan.halts) this.followTarget();
      if (this.op.execResult === 'tagged' || this.op.execResult === 'missed') this.onDrop(this.op.execResult, this.op.execResult === 'missed' && windowBefore !== null && windowBefore - dt <= 0);
      else if (this.execT > 45 && !this.plan?.window) {
        this.op.execResult = 'missed';
        this.onDrop('missed', true);
      }
    }
    this.tickReaction(dt);
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
    const urgency = onClock(legView.state) && legView.state.clock !== null ? 1 - Math.max(0, Math.min(1, legView.state.clock / Math.max(0.01, legView.state.clockMax))) : 0;
    this.missionScene.updateRoute(legView.state.index, legView.state.status, ringScale(legView.state), urgency, dt, this.t);

    if (this.crew.station === 'operator') this.updateBoard(dt);
    else this.updatePilot(dt);
    this.missionScene.sync(this.movers, m, this.t);
  }

  // ---- MISSION CONTROL: the autopilot or copilot orbits; the player plays the board
  private boardUse(asset: AssetId, target: Target): void {
    if (this.pending || this.control.executed || this.crew.station !== 'operator') return;
    const ok = canUse(this.control, RETURNS, asset, target);
    if (!ok.ok) {
      this.board.events([{ type: 'nothing', title: ASSETS[asset].label, text: ok.reason }]);
      this.audio.warn();
      return;
    }
    if (target.kind !== 'none') this.board.select(target);
    this.pending = { asset, target, t: 0, dur: ASSETS[asset].seconds };
    if (asset === 'drone' || asset === 'scouts') this.audio.drop();
    else if (asset === 'sigint') this.audio.link();
    else if (asset === 'shadow') this.audio.contact();
    else this.audio.radarOn();
  }

  private boardMark(id: ReturnId): void {
    if (this.pending || this.control.executed || this.crew.station !== 'operator') return;
    const before = this.control.minutes;
    const ev = mark(this.control, RETURNS, id);
    this.burnBoardFuel(before - this.control.minutes);
    this.boardEvents(ev);
  }

  /** Board minutes are flying time: the autopilot keeps orbiting on the tank. */
  private burnBoardFuel(minutes: number): void {
    if (minutes > 0) this.fuel = Math.max(1, this.fuel - minutes * this.def.control.fuelPerMinute * this.fuelMax);
  }

  private boardEvents(ev: BoardEvent[]): void {
    if (!ev.length) return;
    const types = new Set(ev.map((e) => e.type));
    if (types.has('locked')) this.audio.mark();
    else if (types.has('barge') || types.has('opportunity')) this.audio.unlockSound();
    else if (types.has('wrong') || types.has('contradiction') || types.has('front')) this.audio.warn();
    else if (types.has('reveal') || types.has('ruled-out')) this.audio.resolved();
    this.board.events(ev);
    if (this.control.frontCaught && !this.control.executed && !this.forceExec) this.forceExec = 1.2;
  }

  /** The action has played out: apply it. */
  private resolvePending(): void {
    const p = this.pending!;
    this.pending = null;
    const before = this.control.minutes;
    const ev = useAsset(this.control, RETURNS, inSector, this.def.control.clues, p.asset, p.target);
    this.burnBoardFuel(before - this.control.minutes);
    if (p.target.kind === 'return' && (p.asset === 'optical' || p.asset === 'thermal' || p.asset === 'drone')) {
      // the look leaves a print: the last frame of the telephoto feed
      const q = { optical: 0.92, drone: 0.8, thermal: 0.72 }[p.asset] + this.cap.photoBonus;
      const old = this.photos.get(p.target.id);
      if (!old || q >= old.quality) {
        try {
          this.photos.set(p.target.id, { url: this.board.feed.toDataURL('image/jpeg', 0.8), thermal: p.asset === 'thermal', quality: q });
        } catch {
          /* a tainted or empty canvas: no print, the facts still count */
        }
      }
    }
    if (p.asset === 'shadow') {
      // the truck sets off for the river landing, where the barge is waiting
      const mv = this.movers.get(TARGET.id)!;
      mv.setRoute(destinationRoute(mv.x, mv.z, mv.segment), false);
      mv.speed = TARGET_SPEED_TO_DESTINATION;
      this.missionScene.showDestination(DESTINATION.x, DESTINATION.z, true);
    }
    this.boardEvents(ev);
  }

  /** EXECUTE: score the board, generate the Exit Profile, show the result. */
  private executeBoard(): void {
    const b = this.control;
    if (b.executed || this.pending || this.crew.station !== 'operator') return;
    const C = this.def.control;
    if (!b.corridor) {
      if (!b.frontCaught) return;
      chooseCorridor(b, C, 'centre'); // caught by the front: the straight way home
    }
    b.executed = true;
    this.forceExec = 0;
    const res = scoreBoard(b, C, RETURNS, inSector);
    this.controlResult = res;
    this.exit = buildExit({ board: b, def: C, result: res, fuel: this.fuel, fuelMax: this.fuelMax, cruise: this.cap.perf.maxSpeed * 0.7, ground: (x, z) => this.bundle.heightField.sample(x, z) });
    this.applyBoardToMission();
    const prev = this.career.controlBest[this.def.id] ?? null;
    const isBest = prev === null || res.total > prev;
    if (isBest) {
      this.career.controlBest[this.def.id] = res.total;
      saveCareer(this.career, localStorage);
    }
    this.rankSounded = false;
    this.board.showResult(res, this.exit, prev, isBest && prev !== null, this.replayHook(), b.marked ? { n: '02', label: 'EXECUTE', title: this.def.story.execute.title } : { n: '03', label: 'ESCAPE', title: this.def.story.escape.title });
    this.audio.click();
  }

  /** "I can do that better": what a better board would have found. */
  private replayHook(): string {
    const b = this.control;
    const res = this.controlResult!;
    if (res.rank !== 'ACE') return 'Can you create a cleaner exit?';
    const cache = allCells(this.def.control).find((c) => b.cells[c.id].truth === 'cache');
    if (cache && belief(b.cells[cache.id]) !== 'cache') return 'Something else was out there. Did you see it?';
    if (!b.shadowed) return 'Where was the truck going?';
    return `A clean board. Can you do it with more than ${b.minutes} min to spare?`;
  }

  /** The board's findings become the recon the report reads. */
  private applyBoardToMission(): void {
    const m = this.mission;
    const b = this.control;
    for (const r of RETURNS) {
      const k = b.returns[r.id]!;
      const st = m.returns[r.id];
      const mv = this.movers.get(r.id)!;
      const visible = !r.hidden || b.shadowed;
      st.hidden = !visible;
      st.detected = visible;
      st.resolved = k.size;
      st.roadKnown = k.road;
      st.heatKnown = k.engine;
      st.radioKnown = k.radio;
      st.verdict = b.marked === r.id ? 'correct' : b.wrong.includes(r.id) ? 'wrong' : 'none';
      st.lastKnown = { x: mv.x, z: mv.z };
    }
    m.falsePositives = b.wrong.length;
    m.wrongIds = [...b.wrong];
    m.targetIdentified = m.primaryComplete = !!b.marked;
    m.destinationConfirmed = b.shadowed;
    // the evidence: the best look at the truck, or a frame grabbed on the pass
    m.photos.truck = b.marked ? (this.photos.get(TARGET.id)?.quality ?? 0.5) : 0;
    m.photosTaken = this.photos.size;
    m.phase = 'extract';
    m.extractReason = b.frontCaught ? 'weather' : 'complete';
  }

  /** Prints for the debrief, best first. */
  private evidence(): Shot[] {
    return [...this.photos].map(([id, p]) => ({ id, url: p.url, grade: evidenceGrade(Math.min(1, p.quality)), sensor: p.thermal ? 'thermal' : 'optical' }));
  }

  private updateBoard(dt: number): void {
    tickCrew(this.crew, dt);
    if (this.pending) {
      this.pending.t += dt;
      if (this.pending.t >= this.pending.dur) this.resolvePending();
    }
    if (this.forceExec > 0) {
      this.forceExec -= dt;
      if (this.forceExec <= 0 && !this.pending) {
        this.forceExec = 0;
        this.executeBoard();
      }
    }
    if (!this.rankSounded && this.board.resultStage === 'ranked') {
      this.rankSounded = true;
      if (this.controlResult?.rank === 'ACE' || this.controlResult?.rank === 'SOLID') this.audio.unlockSound();
      else this.audio.warn();
    }
    this.audio.updateFlight(this.a.throttle, this.a.speed, true, false);
    this.audio.updateWeather(dt, 0, 0);
    this.hud.tickBanners(dt);
    this.board.update(this.boardFrame(), dt);
  }

  private boardFrame(): BoardFrame {
    const b = this.control;
    const def = this.def.control;
    const busy = !!this.pending || b.executed;
    const act = (asset: AssetId, t: Target, label = ASSETS[asset].label): BoardAction => {
      const u = canUse(b, RETURNS, asset, t);
      return { kind: 'asset', asset, label: `${ASSETS[asset].icon} ${label}`, cost: ASSETS[asset].cost, ok: u.ok && !busy, reason: u.reason, front: ASSETS[asset].cost >= b.minutes };
    };
    const fitted = ASSET_ORDER.filter((a) => assetFitted(b, a));
    const returns = RETURNS.filter((r) => !r.hidden || b.shadowed).map((r) => {
      const k = b.returns[r.id]!;
      const mv = this.movers.get(r.id)!;
      const sec = inSector(r);
      const checks = clueChecks(r, k, sec, def.clues);
      const status = r.hidden ? 'barge' : b.marked === r.id ? 'truck' : b.wrong.includes(r.id) ? 'wrong' : ruledOut(checks) ? 'out' : k.size || k.road || k.radio ? 'fits' : 'unknown';
      const actions: BoardAction[] = [];
      if (!r.hidden) {
        // the decision first, then the ways to learn more
        if (!b.marked && !b.wrong.includes(r.id)) actions.push({ kind: 'mark', label: 'MARK AS THE TRUCK', ok: !busy, reason: '' });
        if (b.marked === r.id && !b.shadowed) actions.push(act('shadow', { kind: 'return', id: r.id }, 'SHADOW · WHERE IS IT GOING?'));
        for (const a of fitted) if (a === 'optical' || a === 'thermal' || a === 'drone') actions.push(act(a, { kind: 'return', id: r.id }));
      }
      return { id: r.id, x: mv.x, z: mv.z, moving: mv.moving, status: status as BoardFrame['returns'][number]['status'], traits: traits(r, k, sec), checks, photo: this.photos.get(r.id) ?? null, actions };
    });
    const cells = allCells(def).map((c) => {
      const st = b.cells[c.id];
      const known = belief(st);
      const weather = known === 'storm' || known === 'cloud' ? known : 'clear';
      return {
        id: c.id,
        corridor: c.corridor,
        corridorLabel: def.corridors.find((x) => x.id === c.corridor)!.label,
        x: c.x,
        z: c.z,
        belief: known,
        possible: st.possible,
        forecast: st.forecast,
        contradicted: !!known && st.forecast !== weather,
        actions: fitted.filter((a) => a === 'drone' || a === 'scouts').map((a) => act(a, { kind: 'cell', id: c.id })),
      };
    });
    const allTargets: Target[] = [...returns.map((r) => ({ kind: 'return', id: r.id }) as Target), ...cells.map((c) => ({ kind: 'cell', id: c.id }) as Target)];
    const assets = fitted.map((id) => {
      const a = ASSETS[id];
      const left = id in b.uses ? (b.uses[id] ?? 0) : null;
      const targets = busy ? [] : allTargets.filter((t) => canUse(b, RETURNS, id, t).ok).map((t) => (t.kind === 'return' ? `r:${t.id}` : `c:${(t as { id: string }).id}`));
      const global = a.target === 'none' ? canUse(b, RETURNS, id, { kind: 'none' }) : null;
      const ok = !busy && (global ? global.ok : targets.length > 0);
      const reason = busy ? 'BUSY' : global ? global.reason : left === 0 ? 'NONE LEFT' : a.cost > b.minutes ? 'NO TIME' : id === 'shadow' && !b.marked ? 'MARK THE TRUCK FIRST' : 'NOTHING TO DO';
      return { id, label: a.label, icon: a.icon, cost: a.cost, left, ok, reason, note: a.note, target: a.target, targets };
    });
    const route = def.corridors.find((c) => c.id === b.corridor);
    const corridors = def.corridors.map((c) => ({ id: c.id, label: c.label, short: c.short, note: c.note, path: c.rings.map((r) => ({ x: r.x, z: r.z })), selected: c.id === b.corridor, known: c.cells.filter((x) => cellKnown(b.cells[x.id])).length, total: c.cells.length }));
    // the live forecast: what EXECUTE would make of the board right now
    const fkey = `${b.actions}|${b.corridor}|${b.marked}|${b.wrong.length}|${b.shadowed}|${b.minutes}`;
    if (this.forecastCache.key !== fkey) {
      let value: BoardFrame['forecast'] = null;
      if (route) {
        const res = scoreBoard(b, def, RETURNS, inSector);
        const ex = buildExit({ board: b, def, result: res, fuel: this.fuel, fuelMax: this.fuelMax, cruise: this.cap.perf.maxSpeed * 0.7, ground: (x, z) => this.bundle.heightField.sample(x, z) });
        value = { rank: res.rank, tier: res.tier, total: res.total, lines: ex.lines.filter((l) => l.label !== 'ROUTE') };
        if (this.lastTier && this.lastTier !== res.tier && !b.executed) {
          const order = ['scramble', 'degraded', 'standard', 'optimal'];
          const up = order.indexOf(res.tier) > order.indexOf(this.lastTier);
          this.board.events([{ type: up ? 'opportunity' : 'wrong', title: `EXIT ${up ? '▲' : '▼'} ${TIER_LABEL[res.tier]}`, text: up ? 'YOUR PLAN JUST GOT BETTER' : 'YOUR PLAN JUST GOT WORSE' }]);
        }
        this.lastTier = res.tier;
      }
      this.forecastCache = { key: fkey, value };
    }
    const scouts = RETURNS.find((r) => r.count === 3 && r.radio && !r.isTarget);
    const from = this.pending?.asset === 'scouts' && scouts ? this.movers.get(scouts.id)! : { x: this.a.x, z: this.a.z };
    return {
      minutes: b.minutes,
      maxMinutes: b.maxMinutes,
      fuelSeconds: this.fuel,
      control: this.cap.flightControl.mode === 'crew' ? this.cap.flightControl.label : 'AUTOPILOT ORBITING',
      goals: [
        { label: 'FIND THE TRUCK', state: b.marked ? 'done' : 'todo', bonus: false },
        { label: 'WHERE IS IT GOING?', state: b.shadowed ? 'done' : 'todo', bonus: true },
        { label: 'SCOUT YOUR WAY HOME', state: route && route.cells.every((c) => cellKnown(b.cells[c.id])) ? 'done' : 'todo', bonus: true },
      ],
      returns,
      cells,
      corridors,
      aircraft: { x: this.a.x, z: this.a.z, yaw: this.a.yaw },
      orbit: this.crew.orbit,
      base: { x: BASE.x, z: BASE.z },
      area: this.def.operations.area,
      landing: b.shadowed ? def.landing : null,
      assets,
      pending: this.pending ? { asset: this.pending.asset, target: this.pending.target, k: this.pending.t / this.pending.dur, from: { x: from.x, z: from.z } } : null,
      forecast: this.forecastCache.value,
      canExecute: !!b.corridor && !busy,
      executeHint: b.executed ? '' : !b.corridor ? 'PICK A WAY OUT FIRST' : !b.marked ? 'NO TARGET MARKED · NOTHING TO TAG' : '',
      executed: b.executed,
    };
  }

  /**
   * The telephoto view of a look in progress, rendered into the card's
   * viewfinder: a sensor camera closing in on the vehicle.
   */
  private renderBoardFeed(): void {
    const p = this.pending;
    if (!p || p.target.kind !== 'return' || !(p.asset === 'optical' || p.asset === 'thermal' || p.asset === 'drone')) return;
    const canvas = this.board.feed;
    const w = Math.round(canvas.clientWidth);
    const h = Math.round(canvas.clientHeight);
    if (w < 8 || h < 8) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const hf = this.bundle.heightField;
    const mv = this.movers.get(p.target.id)!;
    const gy = hf.sample(mv.x, mv.z);
    // look from the aircraft's side of the vehicle, high and oblique (straight down for the drone)
    const dx = this.a.x - mv.x;
    const dz = this.a.z - mv.z;
    const l = Math.hypot(dx, dz) || 1;
    const back = p.asset === 'drone' ? 40 : 230;
    const up = p.asset === 'drone' ? 140 : 170;
    const cam = this.sensorCam;
    cam.position.set(mv.x + (dx / l) * back, gy + up, mv.z + (dz / l) * back);
    cam.up.set(0, 1, 0);
    cam.lookAt(mv.x, gy + 2, mv.z);
    const k = Math.min(1, p.t / p.dur);
    cam.fov = 34 - 24 * k * k * (3 - 2 * k);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const rr = this.bundle.renderer;
    const src = rr.domElement;
    const ratio = src.width / window.innerWidth;
    this.plane.group.visible = false;
    rr.setScissorTest(true);
    rr.setViewport(0, 0, w, h);
    rr.setScissor(0, 0, w, h);
    this.missionScene.withoutPins(() => rr.render(this.bundle.scene, cam));
    rr.setScissorTest(false);
    rr.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.plane.group.visible = true;
    // copy the frame out before the browser clears the buffer
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(src, 0, src.height - h * ratio, w * ratio, h * ratio, 0, 0, w, h);
  }



  // ---- PILOT: the player flies; the current gate is the objective
  private updatePilot(dt: number): void {
    const m = this.mission;
    const hf = this.bundle.heightField;
    const def = this.def;
    this.hud.tickBanners(0);

    // ---- landing (only the return leg ends at base)
    const dBase = Math.hypot(this.a.x - BASE.x, this.a.z - BASE.z);
    if (this.op.stage === 'return' && dBase < 150 && this.a.agl < 45) this.touchDown();

    const area = this.inOpsArea();
    const opsReady = operatorAvailability(this.crew, { inArea: area, operatorWork: this.reconWork(), fuelFraction: this.fuel / this.fuelMax, areaLabel: def.operations.area.label }).ok;
    this.el['btn-ops'].classList.toggle('ready', opsReady);
    this.el['btn-ops'].classList.toggle('disabled', !opsReady);

    // ---- where to: the current gate, or the sector while recon work remains
    const leg = activeLeg(this.op, def);
    const gate = leg ? currentGate(leg.state, leg.def) : null;
    let waypoint: HudFrame['waypoint'] = null;
    const A = def.operations.area;
    if (gate?.kind === 'ring') waypoint = { x: gate.x, z: gate.z, label: this.op.stage === 'execute' ? 'TARGET' : 'RING' };
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
    if (leg && onClock(leg.state) && leg.state.clock !== null && gate?.kind === 'ring') chips.push({ text: `⏱ ${Math.max(0, Math.ceil(leg.state.clock))} s`, cls: leg.state.clock < 3 ? 'bad' : 'caution' });
    if (this.op.damage >= 0.02) chips.push({ text: `HULL ${Math.round((1 - this.op.damage) * 100)}%`, cls: this.op.damage > 0.55 ? 'bad' : 'caution' });
    if (this.op.stage === 'recon' && !this.control.executed) chips.push({ text: `FRONT IN ${this.control.minutes} MIN`, cls: 'caution' });

    // ---- contextual hint: always says what to do next
    const touch = this.input.isTouch;
    const who = this.cap.flightControl.mode === 'crew' ? 'YOUR COPILOT' : 'THE AUTOPILOT';
    let hint = '';
    if (this.sortieTime < 7) hint = touch ? 'DRAG LEFT SIDE TO STEER · THROTTLE ON THE RIGHT' : 'ARROWS / WASD STEER · SHIFT / CTRL THROTTLE';
    else if (warning.startsWith('IN CLOUD')) hint = touch ? 'PUSH THE STICK DOWN' : 'ARROW DOWN / S TO DESCEND';
    else if (warning.startsWith('TURBULENCE')) hint = 'TURN AWAY FROM THE RED CIRCLE';
    else if (this.op.stage === 'execute' && gate) hint = this.plan && !this.plan.halts ? 'IT IS MOVING · LEAD THE RING' : 'FLY THROUGH THE RING';
    void who;
    this.el['hint'].textContent = hint;

    // ---- camera, audio, HUD
    this.chase.update(this.bundle.camera, this.a, dt, false, (x, z) => hf.sample(x, z));
    // the pass: a short widening of the view, back on its own
    if (this.fovKick > 0) {
      this.bundle.camera.fov += this.fovKick * this.fovKick * 6;
      this.bundle.camera.updateProjectionMatrix();
      this.fovKick = Math.max(0, this.fovKick - dt * 2.2);
    }
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
    // RADAR CONTACT (or a pass on a window): a heartbeat that quickens as the ring closes
    if (leg && (leg.state.contact || (this.op.stage === 'execute' && leg.state.timed)) && leg.state.clock !== null && gate?.kind === 'ring') {
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
        phase: this.hudPhase(),
        sector: A,
        chips,
        warning,
        storms,
      },
      dt,
    );
  }

  /** "02 EXECUTE ●●○" on the objective. */
  private hudPhase(): HudFrame['phase'] {
    const p = phaseOf(this.op.stage);
    if (!p) return null;
    return { ...phaseInfo(p), marks: phaseMarks(this.op.stage, this.op.execResult) };
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
      // Mission Control covers the screen: only a look in progress is rendered, into its viewfinder
      this.renderBoardFeed();
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
      const leg = activeLeg(this.op, this.def);
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
    // on the board, fuel is paid in board minutes (see burnBoardFuel)
    if (!(this.play === 'mission' && this.crew.station === 'operator')) this.fuel -= dt * stormBurn;
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
