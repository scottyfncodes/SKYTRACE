import * as THREE from 'three';
import { AudioSystem } from '../core/audio';
import { Input } from '../core/input';
import { clamp, damp, wrapAngle } from '../core/math';
import { Radio, type Speaker } from '../core/radio';
import { loadPrefs, savePrefs, type Prefs, type SteerSide, type VerticalMode } from '../core/settings';
import { initialAircraft, stepAircraft, type AircraftState } from '../flight/aircraft';
import { ChaseCamera } from '../flight/camera';
import { assistedDrift, newWindEstimate } from '../flight/assist';
import { HelicopterMesh } from '../flight/helicopterMesh';
import { PlaneMesh } from '../flight/planeMesh';
import { BoatMesh } from '../flight/boatMesh';
import { BikeMesh } from '../flight/bikeMesh';
import { HARD_LANDING, newBike, stepBike, type BikeEnv } from '../land/bike';
import { trailAt } from '../land/trail';
import { TrailView } from '../world/trailScene';
import { boatSpeed, newBoat, stepBoat, type BoatEnv, type BoatState } from '../water/boat';
import { currentAt } from '../water/river';
import { canArrive, canDropItem, dropItem, PICKUP, DROP_MAX_AGL, dropLanding, rampAt, rapidAt, peopleAt, type Mover } from '../rescue/handoff';
import { WaterView } from '../world/waterScene';
import { CALL_LEN, canFireAction, canFill, CONTROL, fireAction, LINE_LEN, nearestSkim, RELOAD, skimming, THREAT_WORDS, nearestThreat, waterUnder, type FireEvent } from '../fire/fireRun';
import { inArea, stepFire } from '../fire/fireSim';
import { FireView } from '../world/fireScene';
import { paintFire } from '../ui/fireMap';
import { MAP_PX, valleyImage } from '../ui/valleyMap';
import { debrief, type Debrief } from '../rescue/debrief';
import { newBasket, RING_PAD, stepHoist, type Basket, type HoistEvent } from '../rescue/hoist';
import { headingAxes, hoverTilt, stepHover, type HoverVel } from '../rescue/hover';
import { canLaunch, defaultLoadout, planOf, toggleEquipment, withCrew, withVehicle, type Loadout, type Plan } from '../rescue/loadout';
import { MISSION_BY_ID, MISSIONS, type MissionDef, type MissionId } from '../rescue/missions';
import { loadProgress, nextMission, recordRescue, saveProgress, type Progress } from '../rescue/progress';
import { aboard, cabinFull, canHoist, canLand, delivered, distToSite, distToSpot, escaping, fireHead, hoistSpot, landAtPad, newRun, objective, tickRun, waiting, type RunEvent, type RunState } from '../rescue/run';
import { HOVER_DRIFT, windAt, type Wind } from '../rescue/wind';
import { Hud, type ActionState, type DropState, type MapFrame } from '../ui/hud';
import { PreflightView } from '../ui/preflight';
import { renderTitle } from '../ui/title';
import { buildCountryside } from '../world/countryside';
import { forestAt } from '../world/terrain';
import { buildProps, buildTrees, TreeClearance, updateProps, type WorldProps } from '../world/props';
import { BasketMesh, buildCamp, buildRescueProps, Burst, Marker, reachRing, searchArea, Signals, SurvivorMesh, type RescueProps } from '../world/rescueScene';
import { createScene, type SceneBundle } from '../world/scene';
import { ContactView, GateView, GroundShadow, RouteRibbon } from '../world/routeScene';
import { escapeDone } from '../rescue/route';
import { PADS, RUNWAY, WATER_LEVEL, WORLD_HALF } from '../world/worldData';
import { pauseTransition, type Mode } from './modes';

/** The hover holds this high over the people (m). */
const HOVER_HEIGHT = 22;
/** The hover answers the stick up to this speed (m/s). */
const HOVER_SPEED = 6.5;
/** Skid height above the pad surface, and the pad surface above the ground (m). */
const SKID = 1.55;
const PAD_TOP = 0.82;
const VISIBILITY = { good: 1, fair: 0.55, poor: 0.22 } as const;

const CREW_LINES = {
  hover: ['Hover set. Basket going down on your call.', "Nice and steady. Lower when you're ready."],
  walking: ["They've seen the basket. Hold it there!", 'Coming over now. Hold it!'],
  boarded: ["They're in! Bring them up!", 'In the basket. Reel them in!'],
  secured: ['Got them! Safe aboard.', "Aboard and strapped in. Nice work!"],
  steppedBack: ['Basket moved! Hold it steady.', 'Too far, they had to step back.'],
  bump: ['Easy! Easy! Watch the ground.'],
  cabinFull: ["Cabin's full. Hospital first, then we come back."],
  lowFuel: ["Fuel's getting low. Let's not hang about."],
  outOfReach: ['Basket is down but too far from them. Move it closer.'],
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

export class RescueGame {
  private bundle: SceneBundle;
  private props: WorldProps;
  private rescueProps: RescueProps;
  private heli = new HelicopterMesh('rescue');
  /** The fixed-wing fire fleet (shown instead of the helicopter when one is flown). */
  private plane = new PlaneMesh('tanker');
  /** The Rescue Boat: waits at its station, and is yours once the raft is down. */
  private boat = new BoatMesh();
  private waterView = new WaterView();
  /** The Trail Bike, and the trail it rides. */
  private bike = new BikeMesh();
  private trailView: TrailView;
  /** Driving the boat or the bike (the second half of a two-vehicle rescue). */
  private driving = false;
  private waterEnv: BoatEnv | null = null;
  private bikeEnv: BikeEnv | null = null;
  /** The Search Aircraft circling overhead once the boat has taken over. */
  private orbitA = 0;
  /** Tying up at the station: the boat eases in, they walk up to the ambulance. */
  private docking: { t: number; from: THREE.Vector3; to: THREE.Vector3; yaw0: number; walkers: { mesh: SurvivorMesh; from: THREE.Vector3; to: THREE.Vector3 }[]; done: boolean } | null = null;
  private trees: THREE.InstancedMesh;
  /** Clears the trees around the camera while the bike is down in the forest. */
  private clearance: TreeClearance;
  private fireView: FireView;
  /** The mission is over and the camera circles the fire (or the place it reached). */
  private overview: { x: number; y: number; z: number; r: number; t: number; a0: number } | null = null;
  private basketMesh = new BasketMesh();
  private marker = new Marker();
  private tube = searchArea();
  private ring = reachRing();
  private signals = new Signals();
  private burst = new Burst();
  private camp: THREE.Group | null = null;
  private people: SurvivorMesh[] = [];
  private gates = new GateView();
  private ribbon = new RouteRibbon();
  private shadow = new GroundShadow();
  private contacts = new ContactView();
  /** Seconds before another scrape can count (one bump is one scrape). */
  private scrapeCool = 0;
  private chase = new ChaseCamera();
  private input: Input;
  private audio = new AudioSystem();
  private radio: Radio;
  private hud: Hud;
  private preflight: PreflightView;
  private prefs: Prefs;
  private progress: Progress;
  private el: Record<string, HTMLElement> = {};
  private root: HTMLElement;

  private mode: Mode = 'title';
  private t = 0;
  private last = 0;
  private def: MissionDef;
  private loadout: Loadout;
  private plan: Plan;
  private run: RunState;
  private a: AircraftState;
  private hv: HoverVel = { vx: 0, vz: 0 };
  private basket: Basket;
  private wind: Wind = { x: 0, z: 0, speed: 0, gust: 0 };
  /** The hover assist's running estimate of the wind's push. */
  private windEst = newWindEstimate();
  private hoisting = false;
  /** Leaving the hover: reel the basket in first. */
  private reeling = false;
  /** Where the winch is told to go (m of cable). */
  private winchCmd = 0;
  private winchPrev = new THREE.Vector3();
  private winchPos = new THREE.Vector3();
  private winchVel = { x: 0, z: 0 };
  private holdY = 0;
  private power = 0;
  private tilt = 0;
  private takeoffT = 0;
  private flareIn = 0;
  private autoExit = 0;
  /** Seconds the basket has sat on the ground out of everyone's reach. */
  private reachNag = 0;
  private landing: { t: number; from: THREE.Vector3; to: THREE.Vector3; walkers: { mesh: SurvivorMesh; from: THREE.Vector3; to: THREE.Vector3 }[]; done: boolean } | null = null;
  private ending: { t: number; result: Debrief } | null = null;
  private unlocked: string[] = [];
  private said = new Set<string>();
  private hintT = 0;
  private shake = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    const q = (id: string) => {
      const e = root.querySelector<HTMLElement>(`#${id}`);
      if (!e) throw new Error(`missing #${id}`);
      return e;
    };
    for (const id of ['gl', 'loading', 'title', 'preflight', 'hud', 'pause', 'debrief', 'card', 'card-kicker', 'card-title', 'card-line', 'flash', 'stick-zone', 'stick-knob', 'throttle', 'btn-action', 'btn-drop', 'db-compare', 'btn-pause', 'btn-resume', 'btn-restart', 'btn-abort', 'btn-sound', 'btn-voice', 'pause-objective', 'btn-db-next', 'btn-db-again', 'btn-db-menu', 'db-headline', 'db-mission', 'db-stars', 'db-lines', 'db-unlocks', 'btn-title-settings', 'db-score']) this.el[id] = q(id);

    this.bundle = createScene(this.el['gl'] as HTMLCanvasElement);
    const hf = this.bundle.heightField;
    const scene = this.bundle.scene;
    this.props = buildProps(hf);
    // no trees where a hiker sits by her fire
    this.trees = buildTrees(hf, MISSIONS.flatMap((m) => (m.handoff?.at ? [{ ...m.handoff.at, r: 9 }] : [])));
    this.clearance = new TreeClearance(this.trees);
    scene.add(this.props.group, this.trees, buildCountryside(hf).group);
    this.fireView = new FireView(scene, hf);
    this.rescueProps = buildRescueProps(hf);
    this.plane.group.visible = false;
    this.boat.group.visible = false;
    this.bike.group.visible = false;
    this.trailView = new TrailView(hf);
    scene.add(this.waterView.group, this.boat.group, this.trailView.group, this.bike.group);
    scene.add(this.rescueProps.group, this.heli.group, this.plane.group, this.basketMesh.group, this.basketMesh.cable, this.basketMesh.shadow, this.marker.group, this.tube, this.ring, this.signals.group, this.burst.group, this.gates.group, this.ribbon.mesh, this.shadow.mesh, this.contacts.group);

    this.input = new Input(this.el['stick-zone'], this.el['stick-knob'], this.el['throttle']);
    this.prefs = loadPrefs(localStorage);
    this.input.verticalMode = this.prefs.verticalMode;
    this.progress = loadProgress(localStorage);
    this.hud = new Hud(root);
    this.radio = new Radio(
      (l) => this.hud.radio(l),
      () => this.audio.squelch(),
    );
    this.preflight = new PreflightView(this.el['preflight'], {
      onVehicle: (id) => this.setLoadout(withVehicle(this.loadout, id)),
      onCrew: (id) => this.setLoadout(withCrew(this.loadout, id)),
      onEquip: (id) => this.setLoadout(toggleEquipment(this.loadout, id)),
      onLaunch: () => this.launch(),
      onBack: () => this.showTitle(),
      onTap: () => this.audio.click(),
    });

    this.def = nextMission(this.progress);
    this.loadout = defaultLoadout(this.def, this.progress);
    this.plan = planOf(this.def, this.loadout);
    this.run = newRun(this.def, this.plan);
    this.a = this.onPad('base');
    this.basket = newBasket({ ...this.a, vx: 0, vz: 0 });

    this.input.bindButton(this.el['btn-pause'], 'pause', 'click');
    this.input.bindButton(this.el['btn-action'], 'action');
    this.input.bindButton(this.el['btn-drop'], 'drop');
    this.input.onAction('pause', () => this.togglePause());
    this.input.onAction('action', () => this.contextAction());
    this.input.onAction('drop', () => this.fireDrop());
    this.el['btn-resume'].addEventListener('click', () => this.togglePause());
    this.el['btn-restart'].addEventListener('click', () => this.launch());
    this.el['btn-abort'].addEventListener('click', () => this.showTitle());
    this.el['btn-sound'].addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.renderPrefs();
    });
    this.el['btn-voice'].addEventListener('click', () => {
      this.radio.voice = !this.radio.voice;
      this.prefsExtra({ voice: this.radio.voice });
      this.renderPrefs();
    });
    this.el['btn-title-settings'].addEventListener('click', () => this.openSettingsFromTitle());
    this.el['btn-db-next'].addEventListener('click', () => this.openPreflight(nextMission(this.progress, this.def).id));
    this.el['btn-db-again'].addEventListener('click', () => (this.run.stage === 'failed' ? this.launch() : this.openPreflight(this.def.id)));
    this.el['btn-db-menu'].addEventListener('click', () => this.showTitle());
    for (const b of root.querySelectorAll<HTMLElement>('[data-vert]')) b.addEventListener('click', () => this.setVertical(b.dataset.vert as VerticalMode));
    for (const b of root.querySelectorAll<HTMLElement>('[data-steer]')) b.addEventListener('click', () => this.setSteer(b.dataset.steer as SteerSide));
    for (const b of root.querySelectorAll<HTMLElement>('[data-assist]')) b.addEventListener('click', () => this.setAssist(b.dataset.assist === 'on'));
    try {
      this.radio.voice = localStorage.getItem('skytrace.voice') !== 'off';
    } catch {
      /* default on */
    }
    this.renderPrefs();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.input.reset();
      if (document.hidden && this.mode === 'flight') this.togglePause();
    });

    this.showTitle();
    this.resize();
    this.el['loading'].classList.add('hidden');
    this.exposeQa();
    this.last = performance.now();
    requestAnimationFrame((n) => this.frame(n));
  }

  // ------------------------------------------------------------------ screens
  private show(mode: Mode): void {
    this.mode = mode;
    if (mode !== 'paused') this.el['hud'].classList.remove('cinematic');
    this.el['title'].classList.toggle('hidden', mode !== 'title');
    this.el['preflight'].classList.toggle('hidden', mode !== 'preflight');
    this.el['hud'].classList.toggle('hidden', !(mode === 'flight' || mode === 'paused' || mode === 'landing'));
    this.el['pause'].classList.toggle('hidden', mode !== 'paused');
    this.el['debrief'].classList.toggle('hidden', mode !== 'debrief');
  }

  private showTitle(): void {
    this.input.reset();
    this.radio.clear();
    this.hud.clearBanners();
    this.hideCard();
    this.audio.winch(0);
    this.clearMissionScene();
    renderTitle(this.el['title'], this.progress, (id) => {
      this.audio.unlock();
      this.audio.click();
      this.openPreflight(id);
    });
    // the helicopter idles over the base while you choose
    this.heli.setStyle('rescue');
    this.heli.setBucket(false);
    this.heli.group.visible = true;
    this.plane.group.visible = false;
    this.boat.group.visible = false;
    this.bike.group.visible = false;
    this.a = this.onPad('base');
    this.a.y += 26;
    this.bundle.setVisibility(1);
    this.chase.reset();
    this.show('title');
  }

  private openPreflight(id: MissionId): void {
    this.def = MISSION_BY_ID[id];
    this.loadout = defaultLoadout(this.def, this.progress);
    this.preflight.open(this.def);
    this.preflight.render(this.loadout, this.progress);
    this.radio.clear();
    this.show('preflight');
    this.audio.unlock();
    this.audio.squelch();
    // the call, read out (subtitles are on the screen as the situation)
    if (this.radio.voice && typeof speechSynthesis !== 'undefined') {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(this.def.radio.call.join(' '));
        u.rate = 1.08;
        u.volume = 0.85;
        speechSynthesis.speak(u);
      } catch {
        /* no voice */
      }
    }
  }

  private setLoadout(l: Loadout): void {
    this.loadout = l;
    this.preflight.render(l, this.progress);
  }

  private openSettingsFromTitle(): void {
    this.el['pause'].classList.remove('hidden');
    this.el['btn-restart'].classList.add('hidden');
    this.el['btn-abort'].classList.add('hidden');
    this.root.querySelector('#pause-title')!.textContent = 'CONTROLS & SOUND';
    this.el['pause-objective'].textContent = 'Drag on one side to steer and climb. The lever on the other side is speed; in a hover it lowers the basket. Hover assist leans into the wind for you.';
    const close = () => {
      this.el['pause'].classList.add('hidden');
      this.el['btn-restart'].classList.remove('hidden');
      this.el['btn-abort'].classList.remove('hidden');
      this.root.querySelector('#pause-title')!.textContent = 'PAUSED';
      this.el['btn-resume'].removeEventListener('click', close);
    };
    this.el['btn-resume'].addEventListener('click', close);
  }

  // ------------------------------------------------------------------ prefs
  private setVertical(m: VerticalMode): void {
    this.prefs.verticalMode = m;
    this.input.verticalMode = m;
    savePrefs(this.prefs, localStorage);
    this.renderPrefs();
  }

  private setSteer(s: SteerSide): void {
    this.prefs.steer = s;
    savePrefs(this.prefs, localStorage);
    this.renderPrefs();
  }

  private setAssist(on: boolean): void {
    this.prefs.assist = on;
    savePrefs(this.prefs, localStorage);
    this.renderPrefs();
  }

  private prefsExtra(p: { voice: boolean }): void {
    try {
      localStorage.setItem('skytrace.voice', p.voice ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }

  private renderPrefs(): void {
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-vert]')) {
      const on = b.dataset.vert === this.prefs.verticalMode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-steer]')) {
      const on = b.dataset.steer === this.prefs.steer;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-assist]')) {
      const on = (b.dataset.assist === 'on') === this.prefs.assist;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    this.root.classList.toggle('steer-right', this.prefs.steer === 'right');
    this.el['btn-sound'].classList.toggle('on', !this.audio.muted);
    this.el['btn-sound'].textContent = this.audio.muted ? 'OFF' : 'ON';
    this.el['btn-voice'].classList.toggle('on', this.radio.voice);
  }

  // ------------------------------------------------------------------ mission set-up
  private onPad(id: keyof typeof PADS): AircraftState {
    const p = PADS[id];
    const g = this.bundle.heightField.sample(p.x, p.z);
    // face the way out: toward the mountain from the base, toward the base from the hospital
    const a = initialAircraft(p.x, g + PAD_TOP + SKID, p.z, id === 'base' ? -0.62 : 0.5);
    a.speed = 0;
    a.vx = 0;
    a.vz = 0;
    a.throttle = 0;
    a.agl = PAD_TOP + SKID;
    return a;
  }

  /** Fixed-wing missions start just off the end of the airfield's runway, climbing out toward the job. */
  private onRunway(): AircraftState {
    const x = RUNWAY.x2 + 60;
    const z = RUNWAY.z;
    const to = this.def.fire ? { x: this.def.fire.area.x, z: this.def.fire.area.z } : this.def.search;
    const a = initialAircraft(x, this.bundle.heightField.sample(x, z) + 45, z, Math.atan2(-(to.x - x), -(to.z - z)));
    a.speed = this.plan.perf.minSpeed + 12;
    a.throttle = 0.45;
    a.agl = 45;
    return a;
  }

  private clearMissionScene(): void {
    this.fireView.clear();
    this.waterView.clear();
    this.trailView.clear();
    this.boat.group.visible = false;
    this.bike.group.visible = false;
    this.bike.setPillion(false);
    this.driving = false;
    this.docking = null;
    this.gates.clear();
    this.contacts.clear();
    this.ribbon.mesh.visible = false;
    this.overview = null;
    this.audio.updateFire(0, 0);
    for (const p of this.people) this.bundle.scene.remove(p.group);
    this.people = [];
    if (this.camp) this.bundle.scene.remove(this.camp);
    this.camp = null;
    this.signals.clear();
    this.marker.group.visible = false;
    this.tube.visible = false;
    this.ring.visible = false;
    this.basketMesh.group.visible = false;
    this.basketMesh.cable.visible = false;
    this.basketMesh.shadow.visible = false;
    for (const b of Object.values(this.rescueProps.padBeacon)) b.visible = false;
  }

  private launch(): void {
    if (!canLaunch(this.def, this.loadout)) return;
    this.audio.unlock();
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    this.flash();
    this.clearMissionScene();
    const def = this.def;
    const hf = this.bundle.heightField;
    this.plan = planOf(def, this.loadout);
    this.run = newRun(def, this.plan);
    const plane = this.plan.kind === 'plane';
    this.heli.group.visible = !plane;
    this.plane.group.visible = plane;
    if (plane) this.plane.setStyle(this.plan.style === 'spotter' ? 'spotter' : this.plan.style === 'search' ? 'search' : 'tanker');
    else this.heli.setStyle(this.plan.style === 'heavy' ? 'heavy' : this.plan.style === 'fire' ? 'fire' : 'rescue');
    this.heli.setBucket(this.plan.bucket && !!this.run.ops, true);
    this.a = plane ? this.onRunway() : this.onPad(def.startPad);
    this.hv = { vx: 0, vz: 0 };
    this.windEst = newWindEstimate();
    this.input.reset();
    this.hoisting = false;
    this.reeling = false;
    this.winchCmd = 0;
    this.power = 0;
    this.tilt = 0;
    this.takeoffT = 0;
    this.flareIn = 0;
    this.autoExit = 0;
    this.reachNag = 0;
    this.landing = null;
    this.ending = null;
    this.unlocked = [];
    this.said.clear();
    this.hintT = 0;
    this.shake = 0;
    this.heli.sync(this.a, this.t, 0, 0, 0);
    if (plane) {
      this.power = 1;
      this.plane.sync(this.a, this.t, 0);
    }
    this.heli.winchWorld(this.winchPos);
    this.winchPrev.copy(this.winchPos);
    this.basket = newBasket({ x: this.winchPos.x, y: this.winchPos.y, z: this.winchPos.z, vx: 0, vz: 0 });
    if (this.run.ops) this.fireView.setup(this.run.ops, this.trees);
    const hand = this.run.handoff;
    if (hand?.spec.vehicle === 'boat') {
      // the river course, and the boat waiting at its jetty for its turn
      this.waterView.setup(hand, hf);
      this.waterEnv = { height: (x, z) => hf.sample(x, z), current: currentAt, rapid: (x, z) => rapidAt(hand.spec, x, z) };
      const st = hand.spec.home;
      this.boat.sync(newBoat(st.x, st.z, st.yaw), this.t);
      this.boat.setAboard(0);
      this.boat.group.visible = true;
    } else if (hand?.spec.vehicle === 'bike') {
      // the ramps, the ambulance at the end, and the bike waiting at the trailhead
      this.trailView.setup(hand.spec);
      this.bikeEnv = { height: (x, z) => hf.sample(x, z), brush: forestAt, trail: trailAt, ramp: (x, z) => rampAt(hand.spec, x, z), water: (x, z) => hf.sample(x, z) < -0.5 };
      const st = hand.spec.start;
      this.bike.sync(newBike(st.x, st.z, st.yaw, hf.sample(st.x, st.z)), 0, 0);
      this.bike.setPillion(false);
      this.bike.group.visible = true;
    }
    // the people, their camp, the search area
    this.run.survivors.forEach((s, i) => {
      const m = new SurvivorMesh(def.look, i);
      m.update('waiting', s.x, hf.sample(s.x, s.z), s.z, 0, 0);
      this.people.push(m);
      this.bundle.scene.add(m.group);
    });
    const rescue = def.survivors > 0;
    if (rescue && def.look !== 'driver' && !def.handoff?.river) {
      this.camp = buildCamp(hf, def.site.x, def.site.z, def.look);
      this.bundle.scene.add(this.camp);
    }
    if (this.run.escape) this.gates.setup(this.run.escape.gates, hf);
    if (def.contacts) this.contacts.setup(def.contacts, hf);
    this.scrapeCool = 0;
    const gy = hf.sample(def.search.x, def.search.z);
    this.tube.position.set(def.search.x, gy + 120, def.search.z);
    this.tube.scale.set(def.search.r, 420, def.search.r);
    this.tube.visible = rescue && !def.fire && !def.contacts;
    const sy = hf.sample(def.site.x, def.site.z);
    this.ring.position.set(def.site.x, sy + 0.35, def.site.z);
    this.ring.scale.setScalar(this.plan.hoist.reach + RING_PAD);
    this.ring.visible = false;
    this.basketMesh.group.visible = rescue && !def.handoff;
    this.el['hud'].classList.toggle('has-fire', !!this.run.ops);
    this.bundle.setVisibility(VISIBILITY[def.visibility]);
    this.chase.reset();
    this.hud.clearBanners();
    this.radio.clear();
    this.radio.say('DISPATCH', def.radio.launch);
    const callsign = plane ? (def.handoff ? 'SEARCH ONE' : this.plan.attack === 'lead' ? 'LEAD ONE' : 'TANKER ONE') : def.fire && !rescue ? 'FIRE ONE' : 'RESCUE ONE';
    this.showCard(callsign, plane ? 'AIRBORNE' : 'LIFTING OFF', def.title, '', 2.4);
    this.show('flight');
  }

  // ------------------------------------------------------------------ actions
  private togglePause(): void {
    const next = pauseTransition(this.mode);
    if (!next) return;
    if (next === 'paused') {
      this.input.reset();
      const o = objective(this.run, this.hoisting, this.plan.beacon);
      this.el['pause-objective'].textContent = `${o.title}${o.detail ? ` · ${o.detail}` : ''}`;
      this.audio.winch(0);
    }
    this.show(next);
  }

  /** The one context button: HOVER & HOIST over the people, FLY to leave the hover; on a fire with nobody trapped, the drop. */
  private contextAction(): void {
    if (this.mode !== 'flight') return;
    if (this.run.handoff) {
      if (!this.driving) this.raftDrop();
      return;
    }
    if (this.run.ops && this.def.survivors === 0) {
      this.fireDrop();
      return;
    }
    if (this.hoisting) {
      this.leaveHover();
      return;
    }
    const where = { x: this.a.x, z: this.a.z, agl: this.a.agl, speed: this.a.speed };
    if (!canHoist(this.run, where).ok) return;
    this.enterHover();
  }

  /** Where the aircraft is and how it is moving over the ground. */
  private where(): { x: number; y: number; z: number; yaw: number; agl: number; speed: number; vx: number; vz: number } {
    const base = { x: this.a.x, y: this.a.y, z: this.a.z, yaw: this.a.yaw, agl: this.a.agl, speed: this.driving ? boatSpeed(this.a as BoatState) : this.a.speed };
    if (this.hoisting) return { ...base, vx: this.hv.vx, vz: this.hv.vz };
    const ax = headingAxes(this.a.yaw);
    return { ...base, vx: this.a.vx ?? ax.fx * this.a.speed, vz: this.a.vz ?? ax.fz * this.a.speed };
  }

  /** The fire button: drop retardant, let the bucket go, or start marking a line for Tanker 42. */
  private fireDrop(): void {
    if (this.run.handoff) {
      if (!this.driving) this.raftDrop();
      return;
    }
    const ops = this.run.ops;
    if (this.mode !== 'flight' || !ops || this.run.stage === 'takeoff') return;
    const ev = fireAction(ops, this.where(), this.run.t, this.hoisting);
    if (ev.length) this.fireEvents(ev);
  }

  /** The aircraft as something that lets a raft go. */
  private mover(): Mover {
    const w = this.where();
    return { x: w.x, y: w.y, z: w.z, vx: w.vx, vz: w.vz, agl: w.agl };
  }

  /** The DROP RAFT button. */
  private raftDrop(): void {
    const w = this.run.handoff;
    if (this.mode !== 'flight' || !w || this.run.stage === 'takeoff') return;
    if (dropItem(w, this.mover(), this.run.spotted).length) {
      this.audio.drop();
      this.shake = 0.12;
      this.crew(w.drops > 0 ? 'Raft away!' : 'Last raft away!');
    }
  }

  /** The aircraft's part is done: the Rescue Boat (or the Trail Bike) is yours. */
  private toGround(): void {
    const w = this.run.handoff!;
    const st = w.spec.start;
    this.driving = true;
    if (w.spec.vehicle === 'boat') {
      const b = newBoat(st.x, st.z, st.yaw);
      b.throttle = 0.35;
      this.a = b;
      this.boat.group.visible = true;
      this.showCard('RESCUE BOAT', 'YOUR TURN ON THE WATER', w.spec.home.name.toUpperCase(), '', 2.6);
      this.say('BOAT STATION', w.caught >= 0 ? 'Boat away. They are in the raft upstream. Go get them.' : 'No raft on them. Boat away, flat out!');
    } else {
      const b = newBike(st.x, st.z, st.yaw, this.bundle.heightField.sample(st.x, st.z));
      b.throttle = 0.35;
      this.a = b;
      this.bike.group.visible = true;
      this.showCard('TRAIL BIKE', 'YOUR TURN ON THE TRAIL', this.def.place.toUpperCase(), '', 2.6);
      this.say('SEARCH ONE', 'She is by the forest track. Follow the pin and I will keep circling.');
    }
    this.orbitA = 0;
    this.input.reset();
    this.input.syncThrottle(0.35);
    this.chase.reset();
    this.flash();
    this.audio.phase('execute');
    this.hintT = 0;
  }

  private enterHover(): void {
    const ax = headingAxes(this.a.yaw);
    this.hv = { vx: this.a.vx ?? ax.fx * this.a.speed, vz: this.a.vz ?? ax.fz * this.a.speed };
    this.hoisting = true;
    this.reeling = false;
    this.winchCmd = this.basket.len;
    const spot = hoistSpot(this.run, this.a);
    this.holdY = this.bundle.heightField.sample(spot.x, spot.z) + HOVER_HEIGHT;
    this.audio.hoverIn();
    if (!this.said.has('hover')) {
      this.said.add('hover');
      this.crew(pick(CREW_LINES.hover));
    }
  }

  private leaveHover(): void {
    if (this.basket.len > 0.4) {
      this.reeling = true;
      return;
    }
    // the helicopter flies on with the momentum it had in the hover
    this.a.vx = this.hv.vx;
    this.a.vz = this.hv.vz;
    this.a.speed = Math.hypot(this.hv.vx, this.hv.vz);
    this.a.throttle = 0;
    this.a.pitch = 0;
    this.hoisting = false;
    this.reeling = false;
    this.winchCmd = 0;
    this.input.syncThrottle(0);
    this.audio.winch(0);
  }

  private crew(text: string, urgent = false): void {
    this.radio.say('CREW', text, urgent);
  }

  private say(who: Speaker, text: string): void {
    this.radio.say(who, text);
  }

  // ------------------------------------------------------------------ the loop
  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.bundle.renderer.setSize(w, h, false);
    this.bundle.camera.aspect = w / h;
    this.bundle.camera.updateProjectionMatrix();
  }

  private frame(now: number): void {
    requestAnimationFrame((n) => this.frame(n));
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.tick(dt);
    if (this.mode !== 'preflight') this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
  }

  /** Everything but drawing, one step. */
  private tick(dt: number): void {
    this.t += dt;
    this.bundle.update(dt, this.t);
    updateProps(this.props, this.t);
    this.radio.update(this.mode === 'paused' ? 0 : dt);
    this.updateCard(dt);
    if (this.mode === 'flight') this.updateFlight(dt);
    else if (this.mode === 'landing') this.updateLanding(dt);
    else if (this.mode === 'title') this.updateTitle(dt);
    else if (this.mode === 'preflight') this.preflight.tick(this.t);
    if (this.mode === 'preflight' || this.mode === 'debrief' || this.mode === 'paused') {
      this.audio.updateHeli(0, 0, 0, 0);
      this.audio.updateFire(dt, 0);
      if (this.mode !== 'paused') this.audio.updateFlight(0, 0, false, false);
    }
  }

  private updateTitle(dt: number): void {
    const a = this.a;
    a.y = this.bundle.heightField.sample(a.x, a.z) + 26 + Math.sin(this.t * 0.9) * 0.8;
    a.roll = Math.sin(this.t * 0.6) * 0.04;
    this.heli.sync(a, this.t, dt, 0.03, 1);
    // the camera drifts around the helicopter, Mount Kell behind it
    const toPeak = Math.atan2(260 - a.x, -800 - a.z);
    const ang = toPeak + Math.PI - 0.5 + Math.sin(this.t * 0.07) * 0.3;
    const cam = this.bundle.camera;
    const portrait = window.innerHeight > window.innerWidth;
    const r = portrait ? 34 : 27;
    cam.position.set(a.x + Math.sin(ang) * r, a.y + 4 + Math.sin(this.t * 0.11) * 2, a.z + Math.cos(ang) * r);
    cam.up.set(0, 1, 0);
    // look past the helicopter, a little to the side so the title card has room
    const side = portrait ? 0 : 10;
    cam.lookAt(a.x + Math.cos(ang) * side, a.y + (portrait ? -7 : 5), a.z - Math.sin(ang) * side);
    this.audio.updateHeli(0, 0, 0, 0);
  }

  private updateFlight(dt: number): void {
    const hf = this.bundle.heightField;
    const ground = (x: number, z: number) => hf.sample(x, z);
    const run = this.run;
    const def = this.def;
    const plan = this.plan;
    this.wind = windAt(def.wind, run.t);
    const raw = { x: this.wind.x * HOVER_DRIFT * plan.windFactor, z: this.wind.z * HOVER_DRIFT * plan.windFactor };
    // the hover assist learns the steady push and leans into it; gusts still get through for a moment
    const drift = assistedDrift(this.windEst, raw, dt, this.prefs.assist && plan.kind !== 'plane');
    // off the escape route, the weather you are escaping catches you: rough air the assist cannot cancel
    if (run.escape?.off) {
      drift.x += Math.sin(this.t * 2.3) * Math.sin(this.t * 0.9) * 6;
      drift.z += Math.cos(this.t * 1.7) * Math.sin(this.t * 1.1) * 6;
      this.shake = Math.max(this.shake, 0.18 + 0.12 * Math.abs(Math.sin(this.t * 3.1)));
    }

    // ---- fly
    const plane = plan.kind === 'plane';
    if (run.stage === 'takeoff' && !plane) {
      // spin up on the pad, then lift straight up to a safe height
      this.takeoffT += dt;
      this.power = Math.min(1, this.takeoffT / 1.6);
      if (this.takeoffT > 1.6) this.a.y += Math.min(9, 2 + (this.takeoffT - 1.6) * 5) * dt;
      this.a.agl = this.a.y - ground(this.a.x, this.a.z);
      this.a.speed = 0;
      this.a.vx = 0;
      this.a.vz = 0;
      this.input.syncThrottle(0);
      this.input.touchThrottle = null;
    } else if (this.driving) {
      // the boat: the stick steers, and pushed forward it opens the throttle; the lever is the throttle
      const stick = this.input.readStick();
      const b = this.a as BoatState;
      if (this.input.touchThrottle !== null) {
        b.throttle = this.input.touchThrottle;
        this.input.touchThrottle = null;
      }
      const inp = { steer: stick.x, throttleDelta: this.input.throttleKeys() * 1.2 + stick.y * 1.4 };
      const onBike = run.handoff?.spec.vehicle === 'bike';
      const nb = onBike ? stepBike(b, inp, dt, this.bikeEnv!) : stepBoat(b, inp, dt, this.waterEnv!);
      this.a = nb;
      this.scrapeCool = Math.max(0, this.scrapeCool - dt);
      if (nb.contact && this.scrapeCool <= 0) {
        run.scrapes++;
        this.scrapeCool = 1.5;
        this.shake = 0.4;
        this.audio.clunk(true);
        if (run.scrapes === 1 || run.scrapes % 3 === 0) this.crew(onBike ? pick(nb.landed > HARD_LANDING ? ['Oof! Easy on the landings!', 'Hard landing! Hold on back there!'] : ['Watch the rocks!', 'Easy! Too steep!']) : pick(['Easy! That was the bank!', 'Watch the rocks!']), true);
      }
      if (nb.launched) {
        this.audio.whoosh();
        if (!this.said.has('jump')) {
          this.said.add('jump');
          this.crew('Hang on!');
        }
      }
      if (nb.landed > 2) {
        this.shake = Math.min(0.5, 0.15 + nb.landed * 0.04);
        if (onBike) {
          this.audio.land();
          this.trailView.dust.splash(new THREE.Vector3(nb.x, nb.y + 0.2, nb.z), 18, Math.min(1.2, 0.4 + nb.landed * 0.08));
        } else {
          this.audio.splash();
          this.waterView.spray.splash(new THREE.Vector3(nb.x, WATER_LEVEL + 0.3, nb.z), 22, Math.min(1.4, 0.5 + nb.landed * 0.12));
        }
      }
      this.input.syncThrottle(nb.throttle);
    } else if (this.hoisting) {
      const stick = this.input.readStick();
      this.a = stepHover(this.a, this.hv, stick, { maxSpeed: HOVER_SPEED, response: 1.8, drift, holdY: this.holdY, clearance: 9, hold: this.prefs.assist ? 0.8 : 0 }, ground, dt);
      const max = plan.hoist.maxLen;
      if (this.input.touchThrottle !== null) {
        // the lever is the basket: top stowed, bottom all the way down
        this.winchCmd = (1 - this.input.touchThrottle) * max;
        this.input.touchThrottle = null;
      }
      const keys = this.input.throttleKeys();
      if (keys !== 0) this.winchCmd = clamp(this.winchCmd - keys * plan.hoist.winchSpeed * dt, 0, max);
      if (this.reeling) {
        this.winchCmd = 0;
        if (this.basket.len < 0.4) this.leaveHover();
      }
      this.input.syncThrottle(1 - this.winchCmd / max);
    } else {
      const inp = this.input.read();
      if (this.input.touchThrottle !== null) {
        this.a.throttle = this.input.touchThrottle;
        this.input.touchThrottle = null;
      }
      // the wind leans on a slow helicopter (inside the rotor model); an aeroplane flies through it
      this.a = stepAircraft(this.a, inp, dt, ground, plan.perf, plane ? {} : { drift });
      this.scrapeCool = Math.max(0, this.scrapeCool - dt);
      if (this.a.contact && this.scrapeCool <= 0 && run.stage !== 'takeoff') {
        run.scrapes++;
        this.scrapeCool = 1.5;
        this.shake = 0.45;
        this.audio.clunk(true);
        if (run.scrapes === 1 || run.scrapes % 3 === 0) this.crew(pick(['Whoa! Watch the ground!', 'Too low! Pull up!']), true);
      }
      this.input.syncThrottle(this.a.throttle);
      this.winchCmd = 0;
    }

    // ---- the aircraft; the helicopter's winch and basket
    const targetTilt = this.hoisting ? hoverTilt(this.a.yaw, this.hv, HOVER_SPEED) : (this.a.speed / plan.perf.maxSpeed) * 0.2;
    this.tilt = damp(this.tilt, targetTilt, 3, dt);
    if (this.driving) {
      this.syncGround(dt);
      this.orbitPlane(dt);
    } else if (plane) this.plane.sync(this.a, this.t, dt);
    this.heli.sync(this.a, this.t, dt, this.tilt, this.power);
    if (run.ops && plan.bucket) this.heli.setBucket(true, run.ops.load > 0 || run.ops.fill > 0.5);
    if (def.survivors > 0 && !run.handoff) {
      this.heli.winchWorld(this.winchPos);
      if (dt > 0) {
        this.winchVel = { x: (this.winchPos.x - this.winchPrev.x) / dt, z: (this.winchPos.z - this.winchPrev.z) / dt };
      }
      this.winchPrev.copy(this.winchPos);
      const prevLen = this.basket.len;
      const hev = stepHoist(this.basket, run.survivors, { x: this.winchPos.x, y: this.winchPos.y + 1.6, z: this.winchPos.z, vx: this.winchVel.x, vz: this.winchVel.z }, this.wind, ground, this.winchCmd, plan.hoist, dt, cabinFull(run));
      const winchDir = Math.abs(this.basket.len - prevLen) < 1e-4 ? 0 : this.basket.len > prevLen ? 1 : -1;
      this.audio.winch(winchDir);
      this.hoistEvents(hev);
    }

    // ---- the rescue, the fire
    const where = this.where();
    const ev = tickRun(run, where, dt, plan, this.hoisting);
    this.runEvents(ev);
    if (run.ops) this.fireEvents(ev.filter((e): e is FireEvent => FIRE_EVENTS.has(e)));
    if (run.handoff) this.handoffEvents(ev);
    if (this.mode !== 'flight') return;
    if (run.ops) this.fireEffects(dt);
    if (run.handoff) {
      this.handoffEffects(dt);
      if (this.driving && canArrive(run.handoff, where)) {
        this.startDocking();
        return;
      }
    }
    if (this.autoExit > 0) {
      this.autoExit -= dt;
      if (this.autoExit <= 0 && this.hoisting) this.leaveHover();
    }
    if (!run.handoff && !this.hoisting && run.stage !== 'takeoff' && canLand(run, where)) {
      this.startLanding();
      return;
    }
    // a flare every so often until they are found
    if (def.signal === 'flare' && run.signalled && !run.spotted) {
      this.flareIn -= dt;
      if (this.flareIn <= 0) {
        this.flareIn = 13;
        this.signals.flare(def.site.x, hf.sample(def.site.x, def.site.z), def.site.z);
        this.audio.flare();
      }
    }
    // basket down, nobody can reach it
    const nearest = Math.min(...run.survivors.filter((s) => s.state === 'waiting').map((s) => Math.hypot(this.basket.x - s.homeX, this.basket.z - s.homeZ)), Infinity);
    if (this.hoisting && this.basket.grounded && this.basket.carrying === null && nearest > plan.hoist.reach && waiting(run) > 0) {
      this.reachNag += dt;
      if (this.reachNag > 3.5) {
        this.reachNag = -8;
        this.crew(pick(CREW_LINES.outOfReach));
      }
    } else if (this.reachNag > 0) this.reachNag = 0;

    this.updateWorld(dt);
    this.updateHud(dt);
    this.updateCamera(dt);
    const load = this.hoisting ? 0.35 + Math.min(1, this.a.speed / HOVER_SPEED) * 0.2 : 0.3 + (this.a.speed / plan.perf.maxSpeed) * 0.5 + Math.max(0, this.a.pitch) * 0.6;
    if (this.driving) this.audio.updateBoat(this.a.throttle, where.speed, run.handoff?.spec.vehicle === 'bike');
    else if (plane) this.audio.updateFlight(this.a.throttle, this.a.speed, true, false);
    else this.audio.updateHeli(this.power, load, this.a.speed, this.wind.gust);
  }

  private hoistEvents(ev: HoistEvent[]): void {
    const run = this.run;
    for (const e of ev) {
      if (e.type === 'touchdown') {
        this.audio.clunk(e.hard);
      } else if (e.type === 'walking') {
        if (!this.said.has('walking')) {
          this.said.add('walking');
          this.crew(pick(CREW_LINES.walking));
        }
      } else if (e.type === 'boarded') {
        this.audio.boarded();
        this.hud.banner('IN THE BASKET', 'Slide the lever up to reel them in ▲', 'spot', 2.2);
        this.crew(pick(CREW_LINES.boarded), true);
      } else if (e.type === 'secured') {
        run.lifts++;
        this.audio.secured();
        this.burst.fire(this.winchPos.clone());
        const n = aboard(run) + delivered(run);
        const word = { climber: 'CLIMBER', skier: 'SKIER', hiker: 'HIKER', driver: 'CREWMAN', paddler: 'PADDLER' }[this.def.look];
        this.hud.banner(`${word} SECURED!`, `${n} of ${run.survivors.length} safe aboard`, 'good', 2.4);
        if (waiting(run) > 0 && !cabinFull(run)) this.crew(pick(CREW_LINES.secured));
        if (waiting(run) === 0 || cabinFull(run)) this.autoExit = 1.4;
        this.shake = 0.15;
      } else if (e.type === 'stepped-back') {
        run.stepBacks++;
        this.crew(pick(CREW_LINES.steppedBack), true);
      } else if (e.type === 'bump') {
        run.bumps++;
        this.shake = 0.5;
        this.audio.warn();
        this.crew(pick(CREW_LINES.bump), true);
      }
    }
  }

  private runEvents(ev: RunEvent[]): void {
    const def = this.def;
    for (const e of ev) {
      if (e === 'airborne') {
        this.hintT = 0;
        if (this.run.trips > 0 && !this.run.spotted) this.say('DISPATCH', def.radio.launch);
      } else if (e === 'signal') {
        if (def.signal === 'flare') {
          this.flareIn = 0;
        }
        this.say('CREW', def.radio.signal);
      } else if (e === 'cleared') {
        const c = def.contacts?.[this.run.lastIdentified];
        this.audio.resolved();
        // said on the banner, not queued on the radio: it has to land now, while you are looking at it
        this.hud.banner('CLEAR', c ? c.clear : '', '', 1.8);
      } else if (e === 'gate') {
        const esc = this.run.escape!;
        const i = esc.result.lastIndexOf('passed');
        this.gates.flash(i, true);
        this.audio.ring();
        if (!escapeDone(esc)) this.hud.toast(`${def.handoff ? 'ARCH' : 'GATE'} ${i + 1}/${esc.gates.length}`, 'good');
      } else if (e === 'gate-missed') {
        const esc = this.run.escape!;
        const i = esc.result.lastIndexOf('missed');
        this.gates.flash(i, false);
        this.audio.ringMissed();
        this.hud.toast(`MISSED ${i + 1}`, 'bad');
      } else if (e === 'escape-done') {
        const esc = this.run.escape!;
        const n = esc.result.filter((r) => r === 'passed').length;
        this.audio.phase('escape');
        const home = def.handoff ? (def.handoff.river ? 'station' : 'ambulance') : 'hospital';
        this.hud.banner(n === esc.gates.length ? 'CLEAN ESCAPE!' : 'WE\'RE OUT!', `${n} of ${esc.gates.length} ${def.handoff ? 'arches' : 'gates'} · now the ${home}`, 'good', 2.6);
        this.say('CREW', n === esc.gates.length ? `Beautiful line. ${home[0].toUpperCase() + home.slice(1)} next.` : `We're clear. ${home[0].toUpperCase() + home.slice(1)} next.`);
      } else if (e === 'off-route') {
        this.audio.warn();
        this.crew(def.handoff ? (def.handoff.river ? 'Out of the channel! Back to the arches!' : 'Off the trail! Back to the arches!') : pick(['Rough air out here! Back on the route!', "We're off the line! Get back to the gates!"]), true);
      } else if (e === 'spotted') {
        this.audio.spotted();
        this.audio.phase('execute');
        this.hud.banner(def.contacts ? 'FOUND THEM!' : 'SPOTTED!', def.handoff?.river ? `${def.survivors} in the water · low pass, drop the raft ahead of them` : def.handoff ? 'Too thick to land · the Trail Bike is going in' : def.survivors === 1 ? 'Fly over and come into a hover' : `${def.survivors} people · fly over and hover`, 'spot', 2.6);
        this.say('CREW', def.radio.spotted);
      } else if (e === 'cabin-full') {
        this.hud.banner('CABIN FULL', 'Take them to the hospital', 'spot', 2.4);
        this.crew(pick(CREW_LINES.cabinFull));
      } else if (e === 'all-aboard') {
        if (this.run.escape) {
          this.audio.phase('escape');
          this.hud.banner(def.handoff ? (def.handoff.river ? 'BOTH ABOARD!' : "SHE'S ON!") : 'ESCAPE!', `${this.run.escape.def.name} · ${def.handoff ? 'through the arches' : 'fly the gates'}`, 'spot', 2.8);
          this.say('CREW', def.radio.allAboard);
          this.say('CREW', this.run.escape.def.reason);
        } else {
          this.hud.banner('ALL ABOARD!', 'Now get them to the hospital', 'good', 2.6);
          this.say('CREW', def.radio.allAboard);
        }
      } else if (e === 'low-fuel') {
        this.crew(pick(CREW_LINES.lowFuel));
      } else if (e === 'out-of-fuel') {
        this.fail('OUT OF FUEL', this.run.failReason ?? '');
      }
    }
  }

  // ------------------------------------------------------------------ the fire
  /** Where the last bucket will land (for the steam when it hits). */
  private waterAt: { x: number; z: number } | null = null;

  private fireEvents(ev: FireEvent[]): void {
    const ops = this.run.ops;
    if (!ops) return;
    const def = this.def;
    const solo = def.survivors === 0;
    for (const e of ev) {
      if (e === 'over-fire') {
        if (solo) this.say('CREW', def.radio.spotted);
        this.hud.banner('OVER THE FIRE', ops.attack === 'water' ? 'Put water on the hottest part' : ops.attack === 'retardant' ? 'Line up ahead of it · the red strip shows your drop' : ops.attack === 'lead' ? 'Fly a line ahead of it · press MARK' : 'Watch it', 'spot', 2.8);
      } else if (e === 'drop') {
        this.shake = 0.12;
        if (ops.attack === 'retardant') {
          this.audio.pour();
          this.crew('Retardant away!');
        } else if (ops.attack === 'water') {
          this.audio.drop();
          const at = this.heli.bucketWorld(new THREE.Vector3());
          const w = this.where();
          this.fireView.dumpWater(at, { x: w.vx, z: w.vz });
          this.waterAt = { x: this.a.x + w.vx * 0.9, z: this.a.z + w.vz * 0.9 };
          this.crew('Bucket away!');
        }
      } else if (e === 'line-laid') {
        this.audio.secured();
        if (ops.attack === 'lead') this.hud.banner('LINE DOWN!', 'Tanker 42 dropped your line', 'good', 2.4);
        else this.hud.banner('LINE LAID!', ops.load > 0 ? `${ops.load} more ${ops.load === 1 ? 'drop' : 'drops'} in the tank` : 'Tanks empty · reload at the airfield', 'good', 2.6);
      } else if (e === 'water-hit') {
        this.audio.splash();
        if (this.waterAt) this.fireView.steam(this.waterAt.x, this.waterAt.z, 22);
        this.hud.banner('DIRECT HIT!', 'Knocked it down', 'good', 2);
      } else if (e === 'water-missed') {
        this.audio.splash();
        this.crew('Missed the flames. Get right over them.');
      } else if (e === 'empty') {
        if (ops.attack === 'water') this.crew(pick(["Bucket's empty. Back to the water.", 'Empty. Go fill up and come straight back.']));
        else if (ops.attack === 'retardant') this.crew(pick(['Tanks are dry. Skim the river to scoop!', 'Empty. Get down on the water and scoop.']));
      } else if (e === 'filling') {
        this.audio.click();
      } else if (e === 'full') {
        this.audio.payload();
        this.hud.banner('BUCKET FULL', 'Back to the fire', 'good', 1.8);
      } else if (e === 'reloaded') {
        this.audio.payload();
        const scooped = skimming(ops, this.where());
        this.hud.banner(scooped ? 'SCOOPED!' : 'RELOADED', `${ops.loadMax} lines ready`, 'good', 2);
        this.say('GROUND', 'Tanker One, loaded. Go get it.');
      } else if (e === 'mark-start') {
        this.audio.mark();
        this.crew('Smoke on. Fly the line you want dropped.');
      } else if (e === 'marked') {
        this.audio.link();
        this.hud.banner('LINE MARKED', 'Tanker 42 inbound · 14 s', 'spot', 2.4);
        this.say('TANKER 42', 'Got your line, Lead. Inbound, fourteen seconds.');
      } else if (e === 'tanker-drop') {
        this.audio.pour();
        this.say('TANKER 42', 'On your smoke. Drop, drop, drop!');
      } else if (e === 'spot-fire') {
        this.audio.warn();
        this.hud.banner('SPOT FIRE!', 'Embers jumped ahead of the front', 'bad', 2.4);
        this.crew(pick(['Spot fire! Embers have jumped ahead.', 'New fire ahead of the front!']), true);
      } else if (e === 'line-holding') {
        this.audio.spotted();
        this.hud.banner('THE LINE IS HOLDING!', 'The fire has stopped at it', 'good', 2.8);
        if (solo) this.say('CREW', def.radio.allAboard);
      } else if (e === 'threat-up') {
        this.audio.warn();
        const th = nearestThreat(ops);
        this.hud.banner(`${th.name.toUpperCase()}: ${THREAT_WORDS[ops.threatLevel]}`, 'The fire is closing in', 'bad', 2.4);
        this.say('GROUND', ops.threatLevel >= 3 ? `It's almost at ${th.name}!` : `Fire is getting close to ${th.name}.`);
      } else if (e === 'contained' || e === 'held') {
        if (solo) this.fireSuccess();
      } else if (e === 'breached') {
        const th = ops.lost!;
        this.overview = { x: th.x, y: this.bundle.heightField.sample(th.x, th.z) + 10, z: th.z, r: 120, t: 0, a0: this.a.yaw + Math.PI };
        this.fail(`FIRE REACHED ${th.name.toUpperCase()}`, this.run.failReason ?? '');
      }
    }
  }

  /** The fire is beaten: a slow look over what you did, then the debrief. */
  private fireSuccess(): void {
    const ops = this.run.ops!;
    const f = ops.fire;
    const c = { x: f.x0 + (f.n * f.cell) / 2, z: f.z0 + (f.n * f.cell) / 2 };
    this.radio.clear();
    this.audio.fanfare();
    this.say('FIRE CREWS', this.def.radio.landed);
    const names = ops.spec.threats.map((t) => t.name).join(' · ');
    this.showCard(names.toUpperCase() + (ops.spec.threats.length > 1 ? ' ARE SAFE' : ' IS SAFE'), ops.outcome === 'contained' ? 'FIRE CONTAINED' : 'FIRE HELD', ops.outcome === 'contained' ? 'It has nowhere left to go' : 'Ground crews have it now', 'good', 5);
    this.el['hud'].classList.add('cinematic');
    this.hud.objective('✅', ops.outcome === 'contained' ? 'FIRE CONTAINED' : 'FIRE HELD', names);
    this.overview = { x: c.x, y: this.bundle.heightField.sample(c.x, c.z) + 20, z: c.z, r: f.n * f.cell * 0.75, t: 0, a0: this.a.yaw + Math.PI };
    this.ending = { t: 6.5, result: debrief(this.run) };
    this.mode = 'landing';
    this.landing = null;
    this.hud.drop({ kind: 'hidden' });
  }

  /** The fire's visuals each frame: the burn map and flames, the drops in the air, filling up, the preview. */
  private fireEffects(dt: number): void {
    const ops = this.run.ops!;
    const fv = this.fireView;
    fv.runTime = this.run.t;
    const w = this.where();
    if (ops.dropping && this.plan.kind === 'plane') fv.pourRetardant(this.plane.bellyWorld(new THREE.Vector3()), { x: w.vx, z: w.vz }, dt);
    if (ops.marking && Math.random() < dt * 30) fv.markSmoke(this.plane.bellyWorld(new THREE.Vector3()));
    if (ops.fill > 0 && ops.attack === 'water' && Math.random() < dt * 30) {
      const b = this.heli.bucketWorld(new THREE.Vector3());
      b.y = Math.max(b.y - 1.4, 0);
      fv.scoopSpray(b);
    }
    // the tanker skimming: a sheet of spray off the hull
    if (ops.fill > 0 && skimming(ops, w) && Math.random() < dt * 40) {
      const b = this.plane.bellyWorld(new THREE.Vector3());
      b.y = WATER_LEVEL + 0.5;
      fv.scoopSpray(b);
    }
    // where the drop will land, before you press it
    const act = canFireAction(ops, w, this.hoisting);
    const near = inArea(ops.fire, w.x, w.z, 260) && ops.load > 0 && !ops.dropping && !ops.marking;
    const tooHigh = act.why === 'TOO HIGH';
    if (near && (act.ok || tooHigh) && ops.attack) {
      const sp = Math.max(1, Math.hypot(w.vx, w.vz));
      const dx = this.hoisting ? -Math.sin(this.a.yaw) : w.vx / sp;
      const dz = this.hoisting ? -Math.cos(this.a.yaw) : w.vz / sp;
      if (ops.attack === 'water') fv.showPreview('water', w.x + w.vx * 0.9, w.z + w.vz * 0.9, dx, dz, act.ok);
      else fv.showPreview(ops.attack === 'lead' ? 'call' : 'line', w.x, w.z, dx, dz, act.ok);
    } else fv.showPreview(null, 0, 0, 0, 1, false);
  }

  // ------------------------------------------------------------------ the second vehicle: the boat or the bike
  private get onBike(): boolean {
    return this.run.handoff?.spec.vehicle === 'bike';
  }

  /** The boat or the bike, drawn where it is. */
  private syncGround(dt: number): void {
    if (this.onBike) this.bike.sync(this.a, dt, boatSpeed(this.a as BoatState));
    else this.boat.sync(this.a, this.t);
  }

  private handoffEvents(ev: RunEvent[]): void {
    const w = this.run.handoff!;
    const raft = w.dropped[w.dropped.length - 1];
    for (const e of ev) {
      if (e === 'drop-landed') {
        const d = w.landings[w.landings.length - 1];
        this.audio.secured();
        this.waterView.spray.splash(new THREE.Vector3(raft.x, WATER_LEVEL + 0.3, raft.z), 16, 0.8);
        this.burst.fire(new THREE.Vector3(raft.x, WATER_LEVEL + 2, raft.z));
        this.hud.banner(d < w.spec.reach * 0.35 ? 'RIGHT ON THEM!' : 'RAFT DOWN!', `${Math.round(d)} m away · they're swimming for it`, 'good', 2.6);
      } else if (e === 'drop-missed') {
        const d = w.landings[w.landings.length - 1];
        this.audio.splash();
        this.waterView.spray.splash(new THREE.Vector3(raft.x, WATER_LEVEL + 0.3, raft.z), 12, 0.7);
        this.hud.banner('MISSED', w.drops > 0 ? `${Math.round(d)} m off · ${w.drops} raft left` : `${Math.round(d)} m off · the boat is coming`, 'bad', 2.4);
        this.crew(w.drops > 0 ? 'Too far, they cannot reach it. Come round again, lead them more.' : "That's the last raft. Boat's on its way.", true);
      } else if (e === 'caught') {
        this.say('CREW', "They're in the raft! Out of the water.");
      } else if (e === 'clock-warn') {
        this.audio.warn();
        this.hud.banner('GETTING COLD', 'They cannot hold on much longer', 'bad', 2.4);
        this.crew("They're getting weak in that water. Hurry!", true);
      } else if (e === 'clock-out') {
        this.fail('TOO COLD', this.run.failReason ?? '');
      } else if (e === 'handoff') {
        this.toGround();
      } else if (e === 'pulling') {
        this.crew(this.onBike ? pick(["She's climbing on. Hold it there!", 'Easy, let her get on.']) : pick(['Got a hand on them! Hold it there!', 'Alongside! Pulling them in!']), true);
      } else if (e === 'picked-up') {
        this.audio.secured();
        if (this.onBike) this.bike.setPillion(true);
        else this.boat.setAboard(this.run.survivors.length);
        this.burst.fire(new THREE.Vector3(this.a.x, this.a.y + 2, this.a.z));
        this.shake = 0.15;
      }
    }
  }

  /** Each frame: the raft preview and rings on the river, the pickup ring on the trail, the spray or the dust. */
  private handoffEffects(dt: number): void {
    const w = this.run.handoff!;
    const g = peopleAt(w);
    const m = this.mover();
    const b = this.a as BoatState;
    const sp = boatSpeed(b);
    if (this.onBike) {
      // dust off the back wheel, thicker off the trail
      if (this.driving && b.agl < 0.2 && sp > 4) {
        const n = Math.min(3, sp * dt * (1.2 + 1.8 * (1 - trailAt(b.x, b.z))));
        const rw = this.bike.rearWorld(new THREE.Vector3());
        const fx = -Math.sin(b.yaw);
        const fz = -Math.cos(b.yaw);
        for (let i = 0; i < n; i++) {
          if (Math.random() > n - i) break;
          this.trailView.dust.emit(rw, -fx * sp * 0.15 + (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, -fz * sp * 0.15 + (Math.random() - 0.5) * 2, 0.4 + sp * 0.02, 0.9, 1.2);
        }
      }
      return;
    }
    const v = this.waterView;
    // where a raft let go now would land, and how close it has to be
    const act = canDropItem(w, m, this.run.spotted);
    const near = !this.driving && this.run.spotted && w.phase === 'air' && w.caught < 0 && w.drops > 0 && Math.hypot(m.x - g.x, m.z - g.z) < 420;
    v.reach.visible = near || (this.driving && w.pull < 1 && Math.hypot(m.x - g.x, m.z - g.z) < 200);
    v.reach.position.set(g.x, WATER_LEVEL + 0.15, g.z);
    if (this.driving) {
      v.reach.scale.setScalar(PICKUP.boat.range / w.spec.reach);
      (v.reach.material as THREE.MeshBasicMaterial).color.setHex(w.pull > 0 ? 0x6dff9a : 0xffffff);
    } else {
      v.reach.scale.setScalar(1);
      (v.reach.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
    }
    if (near && (act.ok || act.why === 'TOO HIGH')) {
      const at = dropLanding(m);
      const hit = Math.hypot(at.x - g.x, at.z - g.z) <= w.spec.reach;
      v.aim.visible = true;
      v.aim.position.set(at.x, WATER_LEVEL + 0.2, at.z);
      const c = !act.ok ? 0x9aa3ab : hit ? 0x6dff9a : 0xff8a1a;
      (v.aim.material as THREE.MeshBasicMaterial).color.setHex(c);
      (v.aim.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(c);
    } else v.aim.visible = false;
    // spray: a rooster tail off the jet and a curl off the bow, more the faster it goes
    if (this.driving && b.agl < 0.2 && sp > 2) {
      const n = Math.min(4, sp * dt * 3.2);
      const st = this.boat.sternWorld(new THREE.Vector3());
      const bw = this.boat.bowWorld(new THREE.Vector3());
      const fx = -Math.sin(b.yaw);
      const fz = -Math.cos(b.yaw);
      for (let i = 0; i < n; i++) {
        if (Math.random() > n - i) break;
        st.y = WATER_LEVEL + 0.3;
        v.spray.emit(st, -fx * sp * 0.25 + (Math.random() - 0.5) * 2, 1 + sp * 0.18 * Math.random(), -fz * sp * 0.25 + (Math.random() - 0.5) * 2, 0.35 + sp * 0.02, 0.7, 1.1);
        if (sp > 9) {
          for (const side of [-1, 1]) {
            bw.y = WATER_LEVEL + 0.25;
            v.spray.emit(bw, fz * side * 3 + fx * 2, 1.5 + Math.random(), -fx * side * 3 + fz * 2, 0.35, 0.6, 1.8);
          }
        }
      }
    }
  }

  /** Once the boat or the bike has taken over, the Search Aircraft circles overhead, watching. */
  private orbitPlane(dt: number): void {
    const w = this.run.handoff!;
    const c = w.pull < 1 ? peopleAt(w) : { x: this.a.x, z: this.a.z };
    this.orbitA += dt * 0.28;
    const r = 170;
    const p = this.plane;
    const x = c.x + Math.cos(this.orbitA) * r;
    const z = c.z + Math.sin(this.orbitA) * r;
    const g = this.bundle.heightField.sample(x, z);
    // tangent to the circle: the way it is flying
    const yaw = Math.atan2(Math.sin(this.orbitA), -Math.cos(this.orbitA));
    p.sync({ x, y: Math.max(g, 0) + 120, z, yaw, pitch: 0, roll: -0.45, speed: 48, throttle: 0.5, agl: 120, terrainWarning: false, boundaryWarning: false }, this.t, dt);
  }

  /** Home: the boat eases in to the jetty (the bike rolls up to the ambulance), they get off and walk to the ambulance. */
  private startDocking(): void {
    const hf = this.bundle.heightField;
    const bike = this.onBike;
    const to = bike ? new THREE.Vector3(this.a.x + (this.a.vx ?? 0) * 0.5, 0, this.a.z + (this.a.vz ?? 0) * 0.5) : this.waterView.station.jettyEnd.clone();
    const amb = bike ? this.trailView.ambulance : this.waterView.station.ambulance;
    const off = bike ? new THREE.Vector3(to.x + 1.2, hf.sample(to.x + 1.2, to.z), to.z) : this.waterView.station.jettyEnd;
    this.docking = {
      t: 0,
      from: new THREE.Vector3(this.a.x, this.a.y, this.a.z),
      to: new THREE.Vector3(to.x, this.a.y, to.z),
      yaw0: this.a.yaw,
      walkers: this.run.survivors.map((_s, k) => ({
        mesh: this.people[k],
        from: new THREE.Vector3(off.x + k * 1.2, off.y, off.z),
        to: new THREE.Vector3(amb.x + k * 1.3, hf.sample(amb.x, amb.z), amb.z),
      })),
      done: false,
    };
    this.mode = 'landing';
    this.el['hud'].classList.add('cinematic');
    this.hud.objective('', bike ? 'PULLING UP' : 'TYING UP', 'Bringing them in');
    this.hud.action({ kind: 'hidden' });
    this.hud.drop({ kind: 'hidden' });
  }

  private updateDocking(dt: number): void {
    const D = this.docking!;
    const hf = this.bundle.heightField;
    const bike = this.onBike;
    this.hud.tick(dt);
    D.t += dt;
    const k = Math.min(1, D.t / 2.2);
    const e = k * k * (3 - 2 * k);
    const b = this.a as BoatState;
    b.x = D.from.x + (D.to.x - D.from.x) * e;
    b.z = D.from.z + (D.to.z - D.from.z) * e;
    if (bike) {
      b.y = hf.sample(b.x, b.z);
      b.agl = 0;
    }
    b.speed = damp(b.speed, 0, 3, dt);
    b.vx = 0;
    b.vz = 0;
    b.pitch = damp(b.pitch, 0, 3, dt);
    b.roll = damp(b.roll, 0, 3, dt);
    b.throttle = 0;
    this.syncGround(dt);
    this.orbitPlane(dt);
    if (D.t > 2.4) {
      if (bike) this.bike.setPillion(false);
      else this.boat.setAboard(0);
      const w = Math.min(1, (D.t - 2.4) / 3);
      for (const wk of D.walkers) {
        if (!wk.mesh) continue;
        const x = wk.from.x + (wk.to.x - wk.from.x) * w;
        const z = wk.from.z + (wk.to.z - wk.from.z) * w;
        const y = Math.max(wk.from.y, hf.sample(x, z));
        wk.mesh.group.visible = true;
        wk.mesh.update(w < 1 ? 'walking' : 'waiting', x, y, z, Math.atan2(-(wk.to.x - wk.from.x), -(wk.to.z - wk.from.z)), this.t);
      }
    }
    if (D.t > 2.4 && !D.done) {
      D.done = true;
      this.audio.land();
      const ev = landAtPad(this.run);
      if (ev.includes('complete')) {
        this.audio.fanfare();
        this.radio.clear();
        this.say(bike ? 'GROUND' : 'BOAT STATION', this.def.radio.landed);
        const n = this.run.survivors.length;
        this.showCard(`${n === 1 ? 'SURVIVOR' : `${n} SURVIVORS`} HOME SAFE`, 'RESCUE COMPLETE', '', 'good', 4.4);
      }
    }
    if (D.t > 7.6) {
      this.showDebrief(debrief(this.run));
      return;
    }
    if (bike) this.trailView.update(this.t, dt, false);
    else {
      this.waterView.spray.update(dt);
      this.waterView.station.update(this.t, false);
    }
    this.updateCamera(dt);
    this.audio.updateBoat(0, 0, bike);
  }

  private fail(title: string, line: string): void {
    this.radio.clear();
    this.audio.failed();
    this.audio.winch(0);
    this.showCard('MISSION FAILED', title, line, 'bad', 3);
    this.el['hud'].classList.add('cinematic');
    this.ending = { t: 3, result: debrief(this.run) };
    this.mode = 'landing';
    this.landing = null;
  }

  // ------------------------------------------------------------------ landing at the hospital
  private startLanding(): void {
    const pad = PADS[this.def.deliverTo];
    const g = this.bundle.heightField.sample(pad.x, pad.z);
    const amb = this.rescueProps.ambulance;
    this.landing = {
      t: 0,
      from: new THREE.Vector3(this.a.x, this.a.y, this.a.z),
      to: new THREE.Vector3(pad.x, g + PAD_TOP + SKID, pad.z),
      walkers: this.run.survivors
        .map((s, i) => ({ s, mesh: this.people[i] }))
        .filter((w) => w.s.state === 'aboard')
        .map((w, k) => ({ mesh: w.mesh, from: new THREE.Vector3(pad.x + 2 + k * 1.2, g + PAD_TOP, pad.z + 1), to: new THREE.Vector3(amb.x - 3 + k * 1.3, amb.y, amb.z - 2) })),
      done: false,
    };
    this.audio.winch(0);
    this.mode = 'landing';
    this.el['hud'].classList.add('cinematic');
    this.hud.objective('🏥', 'LANDING', 'Bringing them in');
    this.hud.action({ kind: 'hidden' });
  }

  private updateLanding(dt: number): void {
    if (this.docking) {
      this.updateDocking(dt);
      return;
    }
    this.hud.tick(dt);
    if (this.ending) {
      // a failure (or the end of the rescue, or the fire beaten): hold, then the debrief
      if (this.driving) {
        // the boat drifts to a stop
        const b = this.a as BoatState;
        b.vx = damp(b.vx ?? 0, 0, 1.5, dt);
        b.vz = damp(b.vz ?? 0, 0, 1.5, dt);
        b.x += (b.vx ?? 0) * dt;
        b.z += (b.vz ?? 0) * dt;
        b.speed = damp(b.speed, 0, 1.5, dt);
        if (this.onBike) b.y = this.bundle.heightField.sample(b.x, b.z);
        this.syncGround(dt);
        this.orbitPlane(dt);
        this.audio.updateBoat(0, b.speed, this.onBike);
      } else if (this.plan.kind === 'plane') {
        // a plane cannot stop: it flies on, climbing gently away
        const ax = headingAxes(this.a.yaw);
        this.a.x += ax.fx * this.a.speed * dt;
        this.a.z += ax.fz * this.a.speed * dt;
        this.a.y += 4 * dt;
        this.a.roll = damp(this.a.roll, 0, 2, dt);
        this.plane.sync(this.a, this.t, dt);
        this.audio.updateFlight(this.a.throttle, this.a.speed, true, false);
      } else {
        this.power = Math.max(0.25, this.power - dt * 0.4);
        this.heli.sync(this.a, this.t, dt, this.tilt * 0.9, this.power);
        this.audio.updateHeli(this.power, 0.2, 0, 0);
      }
      if (this.overview) this.overview.t += dt;
      // the fire carries on burning (against the line, or into the town) while you watch
      const ops = this.run.ops;
      if (ops) stepFire(ops.fire, windAt(this.def.wind, this.run.t + this.t), dt);
      if (!this.landing) this.updateCamera(dt);
      this.updateWorld(dt);
      this.ending.t -= dt;
      if (this.ending.t <= 0) this.showDebrief(this.ending.result);
      if (!this.landing) return;
    }
    const L = this.landing;
    if (!L) return;
    L.t += dt;
    const k = Math.min(1, L.t / 2.4);
    const e = k * k * (3 - 2 * k);
    this.a.x = L.from.x + (L.to.x - L.from.x) * e;
    this.a.z = L.from.z + (L.to.z - L.from.z) * e;
    this.a.y = L.from.y + (L.to.y - L.from.y) * (k < 1 ? Math.pow(k, 1.6) : 1);
    this.a.roll = damp(this.a.roll, 0, 3, dt);
    this.a.speed = 0;
    this.a.vx = 0;
    this.a.vz = 0;
    this.a.agl = this.a.y - this.bundle.heightField.sample(this.a.x, this.a.z);
    this.tilt = damp(this.tilt, 0, 3, dt);
    if (L.t > 2.4) this.power = Math.max(0.35, this.power - dt * 0.5);
    this.heli.sync(this.a, this.t, dt, this.tilt, this.power);
    this.heli.winchWorld(this.winchPos);
    this.basket.len = 0;
    this.basket.x = this.winchPos.x;
    this.basket.y = this.winchPos.y - 1.8;
    this.basket.z = this.winchPos.z;
    // out they come, over to the ambulance
    if (L.t > 2.6) {
      const w = Math.min(1, (L.t - 2.6) / 2.6);
      for (const wk of L.walkers) {
        const x = wk.from.x + (wk.to.x - wk.from.x) * w;
        const z = wk.from.z + (wk.to.z - wk.from.z) * w;
        wk.mesh.group.visible = true;
        wk.mesh.update(w < 1 ? 'walking' : 'waiting', x, this.bundle.heightField.sample(x, z) + (w < 0.05 ? PAD_TOP : 0), z, Math.atan2(-(wk.to.x - wk.from.x), -(wk.to.z - wk.from.z)), this.t);
      }
    }
    if (L.t > 2.6 && !L.done) {
      L.done = true;
      this.audio.land();
      const ev = landAtPad(this.run);
      const n = this.run.survivors.length;
      if (ev.includes('complete')) {
        this.audio.fanfare();
        this.say('HOSPITAL', this.def.radio.landed);
        this.showCard(`${n === 1 ? 'SURVIVOR' : `${n} SURVIVORS`} HOME SAFE`, 'RESCUE COMPLETE', '', 'good', 4.4);
        this.ending = { t: 5.2, result: debrief(this.run) };
      } else {
        this.audio.secured();
        this.hud.banner('DELIVERED!', `${waiting(this.run)} still on the mountain`, 'good', 2.6);
        this.say('DISPATCH', `Good drop. ${waiting(this.run) === 1 ? 'One more' : `${waiting(this.run)} more`} waiting. Head back up.`);
      }
    }
    if (L.done && !this.ending && L.t > 5.4) {
      // back into the air for the others
      for (const wk of L.walkers) wk.mesh.group.visible = false;
      this.landing = null;
      this.el['hud'].classList.remove('cinematic');
      this.takeoffT = 1.6;
      this.power = 1;
      this.mode = 'flight';
    }
    this.updateWorld(dt);
    this.updateCamera(dt);
    this.audio.updateHeli(this.power, 0.25, 0, 0);
  }

  private showDebrief(d: Debrief): void {
    this.ending = null;
    this.landing = null;
    this.docking = null;
    this.hideCard();
    this.audio.winch(0);
    if (d.success) {
      this.unlocked = recordRescue(this.progress, this.def.id, { stars: d.stars, time: d.time, rescued: d.rescued, score: d.score.total }, this.loadout);
      saveProgress(this.progress, localStorage);
    } else this.unlocked = [];
    const h = this.el['db-headline'];
    h.textContent = d.headline;
    h.classList.toggle('fail', !d.success);
    this.el['db-mission'].textContent = `${this.def.title.toUpperCase()} · ${this.def.place.toUpperCase()}`;
    this.el['db-stars'].innerHTML = [0, 1, 2].map((i) => `<i class="${i < d.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.25}s">★</i>`).join('');
    // the breakdown: what each part of the operation earned, and the medal
    const sc = d.score;
    const best = this.progress.done[this.def.id]?.score ?? 0;
    const medal = sc.medal ? `<span class="medal ${sc.medal}">${sc.medal.toUpperCase()}</span>` : '';
    this.el['db-score'].innerHTML = `${medal}<b>${sc.total.toLocaleString('en-US')}</b>${d.success && best > sc.total ? `<small>BEST ${best.toLocaleString('en-US')}</small>` : d.success && best === sc.total ? '<small>BEST YET</small>' : ''}`;
    this.el['db-lines'].innerHTML = sc.rows
      .map((r, i) => `<li class="row${r.points >= r.max ? ' full' : ''}" style="animation-delay:${0.1 + i * 0.12}s"><b>${r.label}</b><span>${r.detail}</span><em>${r.points}<small>/${r.max}</small></em></li>`)
      .join('');
    this.drawCompare();
    this.el['db-unlocks'].innerHTML = this.unlocked.length ? `<div class="u-head">UNLOCKED</div>${this.unlocked.map((u, i) => `<div class="u" style="animation-delay:${0.8 + i * 0.15}s">${u}</div>`).join('')}` : '';
    const next = nextMission(this.progress, this.def);
    const nextBtn = this.el['btn-db-next'];
    nextBtn.classList.toggle('hidden', !d.success || next.id === this.def.id);
    nextBtn.textContent = `NEXT: ${next.title.toUpperCase()}`;
    this.el['btn-db-again'].textContent = d.success ? 'FLY IT AGAIN' : 'TRY AGAIN';
    if (d.success && this.unlocked.length) setTimeout(() => this.audio.unlockSound(), 900);
    this.show('debrief');
  }

  /** The fire's before and after: what it would have done without you, and what it did. */
  private drawCompare(): void {
    const box = this.el['db-compare'];
    const ops = this.run.ops;
    box.innerHTML = '';
    if (!ops || this.def.survivors > 0) return;
    const f = ops.fire;
    const size = f.n * f.cell;
    const draw = (title: string, cls: string, state: typeof f) => {
      const fig = document.createElement('figure');
      fig.className = cls;
      const cv = document.createElement('canvas');
      cv.width = cv.height = 192;
      const ctx = cv.getContext('2d')!;
      // the valley under it
      const img = valleyImage();
      const k = MAP_PX / (WORLD_HALF * 2);
      ctx.drawImage(img, (f.x0 + WORLD_HALF) * k, (f.z0 + WORLD_HALF) * k, size * k, size * k, 0, 0, 192, 192);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, 0, 192, 192);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(paintFire(document.createElement('canvas'), state), 0, 0, 192, 192);
      for (const th of ops.spec.threats) {
        const x = ((th.x - f.x0) / size) * 192;
        const y = ((th.z - f.z0) / size) * 192;
        const lost = state.state.some((st, i) => st !== 0 && Math.hypot(f.x0 + ((i % f.n) + 0.5) * f.cell - th.x, f.z0 + (Math.floor(i / f.n) + 0.5) * f.cell - th.z) < th.r);
        ctx.fillStyle = lost ? 'rgba(226,61,40,0.55)' : 'rgba(34,179,94,0.55)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(9, (th.r / size) * 192), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = '20px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(th.icon, x, y + 1);
      }
      const cap = document.createElement('figcaption');
      cap.textContent = title;
      fig.append(cv, cap);
      box.append(fig);
    };
    draw('WITHOUT YOU', 'without', ops.shadow);
    draw('WITH YOU', 'you', f);
  }

  // ------------------------------------------------------------------ world, HUD, camera
  private updateWorld(dt: number): void {
    const hf = this.bundle.heightField;
    const run = this.run;
    const def = this.def;
    const cam = this.bundle.camera;
    // people
    run.survivors.forEach((s, i) => {
      const m = this.people[i];
      if (!m) return;
      if (this.landing && this.landing.walkers.some((w) => w.mesh === m) && this.landing.t > 2.6) return;
      if (this.docking && this.docking.t > 2.4) return;
      if (run.handoff?.spec.river) {
        // in the river: heads and waving arms above the water; in a raft, sitting in it
        const w = run.handoff;
        const raft = w.caught >= 0 ? w.dropped[w.caught] : null;
        const inRaft = !!raft && raft.state === 'floating' && Math.hypot(raft.x - s.x, raft.z - s.z) < 4;
        const face = Math.atan2(-(this.a.x - s.x), -(this.a.z - s.z));
        if (inRaft && s.state === 'waiting') {
          const a = raft!.yaw + i * Math.PI;
          m.update('basket', raft!.x + Math.sin(a) * 0.7, raft!.y - 0.1 + Math.sin(this.t * 2.2) * 0.12, raft!.z + Math.cos(a) * 0.7, face, this.t);
        } else m.update(s.state, s.x, WATER_LEVEL - 1.25 + Math.sin(this.t * 2 + i) * 0.1, s.z, face, this.t);
        return;
      }
      if (s.state === 'basket') {
        m.update('basket', this.basket.x, this.basket.y + 0.15, this.basket.z, this.a.yaw, this.t);
        return;
      }
      const face = Math.atan2(-(this.a.x - s.x), -(this.a.z - s.z));
      m.update(s.state, s.x, hf.sample(s.x, s.z), s.z, s.state === 'walking' ? Math.atan2(-(this.basket.x - s.x), -(this.basket.z - s.z)) : face, this.t);
    });
    // the basket and its cable
    const g = hf.sample(this.basket.x, this.basket.z);
    const rescue = def.survivors > 0 && !def.handoff;
    this.basketMesh.group.visible = rescue;
    if (rescue) this.basketMesh.update(this.basket.x, this.basket.y, this.basket.z, this.a.yaw, this.winchPos, g, this.basket.len);
    else this.basketMesh.cable.visible = this.basketMesh.shadow.visible = false;
    // the fire
    if (run.ops) {
      const w = windAt(def.wind, run.t);
      this.fireView.update(dt, this.t, run.ops, w, cam, this.el['gl'].clientHeight * this.bundle.renderer.getPixelRatio(), this.plan.forecast, this.bundle.scene.fog as THREE.Fog);
      const c = this.fireView.center;
      const near = Math.max(0, 1 - Math.hypot(this.a.x - c.x, this.a.z - c.z, this.a.y - c.y) / 700);
      this.audio.updateFire(dt, this.mode === 'paused' ? 0 : Math.min(1, this.fireView.burning / 160) * near);
    }
    // the river: rafts, the canoe drifting with them, the rapids, the station's beam home, the spray
    const water = run.handoff?.spec.river ? run.handoff : null;
    const trail = run.handoff?.spec.vehicle === 'bike';
    if (trail) this.trailView.update(this.t, dt, run.stage === 'return' && !escaping(run));
    if (water) {
      const wv = this.waterView;
      wv.drops.update(water.dropped, this.t);
      const c = peopleAt(water);
      const up = currentAt(c.x, c.z);
      const ul = Math.hypot(up.x, up.z) || 1;
      wv.canoe.position.set(c.x - (up.x / ul) * 9 + 3, WATER_LEVEL + 0.1 + Math.sin(this.t * 1.6) * 0.08, c.z - (up.z / ul) * 9 - 2);
      wv.canoe.rotation.y = 0.6 + Math.sin(this.t * 0.3) * 0.3;
      wv.rapids.update(this.t);
      wv.station.update(this.t, run.stage === 'return' && !escaping(run));
      wv.spray.update(dt);
    }
    // markers: the search area, then the people, then the hospital
    const onMountain = waiting(run) > 0;
    this.tube.visible = !run.spotted && def.survivors > 0 && !def.fire && !def.contacts;
    const spot = hoistSpot(run, this.a);
    const dSite = distToSpot(run, this.a);
    this.ring.position.set(spot.x, hf.sample(spot.x, spot.z) + 0.35, spot.z);
    this.ring.visible = run.spotted && onMountain && dSite < 160 && !run.handoff;
    if (trail && this.driving && run.handoff!.pull < 1 && dSite < 140) {
      // on the trail: stop inside this ring and she climbs on
      this.ring.visible = true;
      this.ring.scale.setScalar(PICKUP.bike.range);
    }
    const pulse = 0.65 + 0.35 * Math.sin(this.t * 5);
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    ringMat.opacity = pulse;
    const over = this.hoisting && Math.hypot(this.basket.x - spot.x, this.basket.z - spot.z) <= this.plan.hoist.reach + RING_PAD;
    ringMat.color.setHex(over || (trail && run.handoff!.pull > 0) ? 0x22e070 : 0xffffff);
    const pad = run.handoff ? run.handoff.spec.home : PADS[def.deliverTo];
    const toHospital = aboard(run) > 0 && (run.stage === 'return' || cabinFull(run) || waiting(run) === 0);
    this.rescueProps.padBeacon[def.deliverTo].visible = toHospital && !run.handoff;
    if (this.mode === 'landing' || run.stage === 'complete' || run.stage === 'failed') this.marker.group.visible = false;
    else if (toHospital) {
      this.marker.set('h');
      this.marker.group.visible = true;
      this.marker.update(pad.x, Math.max(WATER_LEVEL, hf.sample(pad.x, pad.z)), pad.z, cam, this.t, 26);
    } else if (run.spotted && onMountain) {
      this.marker.set('person');
      this.marker.group.visible = !(this.hoisting && dSite < 50) && !(run.handoff && this.driving && dSite < 40);
      this.marker.update(spot.x, Math.max(WATER_LEVEL, hf.sample(spot.x, spot.z)), spot.z, cam, this.t, 16);
    } else if (def.survivors === 0) {
      // on a fire: a pin over the airfield when it is time to reload there (scooping is shown by the arrow)
      const reload = run.ops?.attack === 'retardant' && run.ops.load === 0 && objective(run, false, false, this.a).target?.kind === 'base';
      this.marker.set('h');
      this.marker.group.visible = reload;
      if (reload) this.marker.update(RELOAD.x, hf.sample(RELOAD.x, RELOAD.z), RELOAD.z, cam, this.t, 40);
    } else if (!run.spotted && def.contacts) {
      this.marker.group.visible = false;
    } else if (!run.spotted) {
      this.marker.set('search');
      this.marker.group.visible = run.stage !== 'takeoff' && Math.hypot(this.a.x - def.search.x, this.a.z - def.search.z) > def.search.r * 0.9;
      this.marker.update(def.search.x, hf.sample(def.search.x, def.search.z), def.search.z, cam, this.t, 60);
    } else this.marker.group.visible = false;
    // ambulance lights at the hospital
    for (const [i, l] of this.rescueProps.ambulanceLights.entries()) (l.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(this.t * 4 + i) % 2 ? 0x3aa0ff : 0x0d2a55);
    const smoke = def.signal === 'smoke' && waiting(run) > 0 ? new THREE.Vector3(def.site.x + 3, hf.sample(def.site.x + 3, def.site.z + 2), def.site.z + 2) : null;
    this.signals.update(dt, this.wind, smoke);
    this.burst.update(dt);
    // recon contacts, escape gates, the route ribbon and the shadow
    this.contacts.update(run.scan, run.spotted, hf, cam, this.t);
    const esc = run.escape;
    this.gates.update(!!esc && escaping(run) && this.mode === 'flight', esc?.next ?? 0, esc?.result ?? [], this.t, dt);
    const o = objective(run, this.hoisting, false, this.a);
    const tg = this.mode === 'flight' && !this.hoisting && run.stage !== 'takeoff' ? o.target : null;
    const gate = tg?.kind === 'gate' && esc ? esc.gates[esc.next] : null;
    const ty = this.driving && tg ? Math.max(WATER_LEVEL, hf.sample(tg.x, tg.z)) + 2.2 : gate ? gate.y : tg ? Math.max(hf.sample(tg.x, tg.z) + 30, Math.min(this.a.y, hf.sample(tg.x, tg.z) + 120)) : 0;
    const col = tg?.kind === 'pad' ? 0x6dff9a : tg?.kind === 'gate' ? 0xffc35a : tg?.kind === 'fire' ? 0xff8a5a : 0x9fe4ff;
    this.ribbon.update(this.a, this.a.yaw, tg ? { x: tg.x, y: ty, z: tg.z } : null, this.t, col);
    const big = this.plan.kind === 'plane' ? (this.plan.style === 'tanker' ? 26 : 14) : this.plan.style === 'heavy' ? 16 : 12;
    // (over the river the shadow lies on the water, not the bed under it)
    const under = hf.sample(this.a.x, this.a.z);
    this.shadow.update(this.a.x, this.a.z, this.a.agl - Math.max(0, WATER_LEVEL - under), Math.max(WATER_LEVEL, under), this.a.yaw, big);
    if (this.driving) this.shadow.mesh.visible = false;
  }

  private updateHud(dt: number): void {
    const run = this.run;
    const def = this.def;
    const plan = this.plan;
    const hud = this.hud;
    hud.tick(dt);
    const o = objective(run, this.hoisting, plan.beacon && dist2(this.a, def.site) < 1100, this.a);
    hud.objective(o.icon, o.title, o.detail);
    // RECON · EXECUTE · ESCAPE (rescues; a fire tells its own story)
    const solo = !!run.ops && def.survivors === 0;
    hud.phase(solo || run.stage === 'complete' || run.stage === 'failed' ? null : run.stage === 'return' ? 'escape' : run.spotted ? 'execute' : 'recon');
    if (run.scan && def.contacts && !run.spotted && run.scan.looking >= 0) hud.scan(run.scan.progress[run.scan.looking], def.contacts[run.scan.looking].label);
    else hud.scan(null);
    if (o.target && !(this.hoisting && o.target.kind === 'site')) {
      const dx = o.target.x - this.a.x;
      const dz = o.target.z - this.a.z;
      const c = Math.cos(this.a.yaw);
      const s = Math.sin(this.a.yaw);
      const sx = dx * c - dz * s;
      const sy = dx * s + dz * c;
      hud.nav(Math.atan2(sx, -sy), Math.hypot(dx, dz), o.target.label, o.target.kind);
    } else hud.nav(null, 0, '', '');
    hud.people(run.survivors.map((s) => s.state));
    hud.fuel(run.fuel / run.fuelMax);
    const ops = run.ops;
    if (ops) {
      const th = nearestThreat(ops);
      hud.fire({
        name: th.name.toUpperCase(),
        threat: ops.threat,
        word: THREAT_WORDS[ops.threatLevel],
        load: ops.load,
        loadMax: ops.loadMax,
        icon: ops.attack === 'water' ? '💧' : ops.attack === 'lead' ? '📍' : '🟥',
        fill: ops.fill,
        hold: ops.spec.hold > 0 ? `${ops.drops >= 2 ? `${Math.round(Math.min(1, ops.control / CONTROL) * 100)}% UNDER CONTROL · ` : ''}CREWS ${clockOf(ops.holdLeft)}` : '',
      });
      hud.drop(this.dropState());
    } else {
      hud.fire(null);
      hud.drop(run.handoff && !this.driving ? this.raftDropState() : { kind: 'hidden' });
    }
    const touch = this.input.isTouch;
    // the context button
    const where = { x: this.a.x, z: this.a.z, agl: this.a.agl, speed: this.driving ? boatSpeed(this.a as BoatState) : this.a.speed };
    let action: ActionState = { kind: 'hidden' };
    if (this.hoisting) action = this.reeling ? { kind: 'wait', label: 'REELING IN…' } : { kind: 'fly', label: 'FLY ▶' };
    else if (run.handoff) {
      const w = run.handoff;
      if (this.driving && w.pull < 1 && run.stage === 'rescue') {
        const g = peopleAt(w);
        const d = Math.hypot(this.a.x - g.x, this.a.z - g.z);
        const sp = boatSpeed(this.a as BoatState);
        const pk = PICKUP[w.spec.vehicle];
        const bike = w.spec.vehicle === 'bike';
        if (w.pull > 0) action = { kind: 'wait', label: `${bike ? 'CLIMBING ON' : 'PULLING THEM IN'} ${Math.round(w.pull * 100)}%` };
        else if (d < 60 && sp >= pk.speed) action = { kind: 'wait', label: bike ? 'STOP NEXT TO HER' : 'EASE OFF ALONGSIDE' };
      }
    } else if (def.survivors > 0) {
      const ch = canHoist(run, where);
      if (ch.ok) action = { kind: 'hover' };
      else if (ch.why === 'SLOW DOWN') action = { kind: 'wait', label: 'SLOW DOWN TO HOVER' };
    }
    hud.action(action);
    // the lever and the stick
    if (this.hoisting) {
      const max = plan.hoist.maxLen;
      const above = Math.max(0, this.basket.y - this.bundle.heightField.sample(this.basket.x, this.basket.z));
      const label = this.basket.carrying !== null ? 'REEL IN!' : this.basket.grounded ? 'ON THE GROUND' : this.basket.len < 0.4 ? 'STOWED' : `${Math.round(above)} m TO GO`;
      hud.winch(this.winchCmd / max, this.basket.len / max, label);
      hud.stickLabel('MOVE');
    } else if (this.driving) {
      hud.lever(this.a.throttle, true);
      hud.stickLabel('STEER · UP: FASTER');
    } else {
      hud.lever(this.a.throttle, plan.kind === 'plane');
      hud.stickLabel(this.prefs.verticalMode === 'standard' ? 'STEER · UP CLIMBS' : 'STEER · DOWN CLIMBS');
    }
    hud.readout(this.hoisting ? `WIND ${Math.round(this.wind.speed * 3.6)} km/h` : this.driving ? `${Math.round(where.speed * 3.6)} km/h` : `${Math.round(this.a.agl)} m · ${Math.round(this.a.speed * 3.6)} km/h`);
    // warnings
    const fuelLow = run.fuel < run.fuelMax * 0.2;
    const w = run.handoff;
    const cold = w && w.spec.clock > 0 && w.caught < 0 && w.pull < 1 && w.clock < 60 ? `COLD WATER · ${Math.ceil(w.clock)} s` : '';
    hud.warn(cold || (run.escape?.off && escaping(run) ? (w ? 'OFF THE CHANNEL' : 'OFF ROUTE · ROUGH AIR') : this.a.terrainWarning && !this.hoisting && this.a.speed > 15 ? 'TERRAIN · CLIMB' : fuelLow ? 'LOW FUEL' : ''));
    // the hint: always says what to do next, in a few words
    this.hintT += dt;
    hud.hint(this.hint(touch, where));
    // minimap / hoist scope
    const frame: MapFrame = {
      mode: this.hoisting ? 'hoist' : 'flight',
      x: this.a.x,
      z: this.a.z,
      yaw: this.a.yaw,
      target: o.target ? { x: o.target.x, z: o.target.z, kind: o.target.kind } : null,
      search: run.spotted ? null : def.search,
      site: run.spotted && waiting(run) > 0 ? hoistSpot(run, this.a) : null,
      pads: w
        ? [
            { x: PADS.base.x, z: PADS.base.z, hospital: false },
            { x: w.spec.home.x, z: w.spec.home.z, hospital: true },
          ]
        : [
            { x: PADS.base.x, z: PADS.base.z, hospital: false },
            { x: PADS.hospital.x, z: PADS.hospital.z, hospital: true },
          ],
    };
    if (ops) {
      const f = ops.fire;
      const w = this.wind;
      const ax = headingAxes(this.a.yaw);
      const act = canFireAction(ops, where, this.hoisting);
      const lineKind = ops.attack === 'retardant' || ops.attack === 'lead';
      frame.search = null;
      frame.fire = {
        canvas: this.fireView.canvas,
        forecast: this.fireView.hasForecast ? this.fireView.forecastCanvas : null,
        x0: f.x0,
        z0: f.z0,
        size: f.n * f.cell,
        threats: ops.spec.threats,
        water: ops.attack === 'water' ? ops.spec.water : [],
        wind: { x: w.x, z: w.z },
        line: lineKind && (act.ok || act.why === 'TOO HIGH') ? { x: this.a.x + ax.fx * 12, z: this.a.z + ax.fz * 12, dx: ax.fx, dz: ax.fz, len: ops.attack === 'lead' ? CALL_LEN : LINE_LEN, color: act.ok ? (ops.attack === 'lead' ? '#ffd23f' : '#e23d28') : '#9aa3ab' } : null,
      };
    }
    if (this.hoisting)
      frame.hoist = {
        reach: plan.hoist.reach,
        site: hoistSpot(run, this.a),
        people: run.survivors.map((s) => ({ x: s.x, z: s.z, state: s.state })),
        basket: { x: this.basket.x, z: this.basket.z, grounded: this.basket.grounded, len: this.basket.len },
        winch: { x: this.winchPos.x, z: this.winchPos.z },
        wind: { x: this.wind.x, z: this.wind.z },
      };
    hud.drawMap(frame);
  }

  private hint(touch: boolean, where: { x: number; z: number; agl: number; speed: number }): string {
    const run = this.run;
    const steer = this.prefs.steer === 'left' ? 'left' : 'right';
    const lever = this.prefs.steer === 'left' ? 'right' : 'left';
    if (run.stage === 'takeoff') return '';
    if (this.hoisting) {
      if (this.reeling) return '';
      if (this.basket.carrying !== null) return touch ? 'Slide the basket UP ▲ to reel them in' : 'Hold Shift / Q to reel them in';
      const b = this.basket;
      const s = run.survivors.find((x) => x.state === 'walking' || x.state === 'boarding');
      if (s) return 'Hold steady…';
      if (b.grounded) return 'Too far from them: move over the ring';
      if (b.len < 1) return touch ? `Hold over the ring · slide the basket DOWN on the ${lever}` : 'Arrows: hold position · Ctrl / Z: lower the basket';
      return 'Keep the basket over the ring';
    }
    if (run.handoff) return this.handoffHint(touch, where);
    if (this.hintT < 6 && run.t < 14) return touch ? `Lever UP to fly · drag on the ${steer} to steer` : 'Shift / Q: speed · arrows: steer and climb';
    // on a fire; with people trapped, the rescue's hints win once you are near them
    if (run.ops && (this.def.survivors === 0 || (!this.hoisting && run.stage !== 'return' && distToSite(run, where) > 160))) {
      const h = this.fireHint(touch, where);
      if (h !== null) return h;
    }
    if (run.stage === 'search' && this.def.contacts) return run.scan && run.scan.looking >= 0 ? 'Hold the nose on it…' : 'Point the nose at each ? to check it';
    if (run.stage === 'search') return run.signalled ? `Look for the ${this.def.signal === 'smoke' ? 'smoke' : 'red flare'}` : 'Head for the blue search area';
    if (run.stage === 'rescue') {
      const d = distToSpot(run, where);
      if (d < 140 && where.speed > 22) return 'Slow down: lever DOWN';
      if (d < 140) return 'Fly over them and press HOVER & HOIST';
      return 'Follow the orange pin';
    }
    if (escaping(run)) {
      const esc = run.escape!;
      if (esc.off) return 'Back to the gates: the air is rough out here';
      return esc.next === 0 ? 'Fly through the glowing gate' : 'Next gate: follow the chevrons';
    }
    if (run.stage === 'return') {
      const pad = PADS[this.def.deliverTo];
      const d = Math.hypot(where.x - pad.x, where.z - pad.z);
      if (d < 160) return where.speed > 9 ? 'Slow down over the H' : 'Descend onto the H';
      return 'Follow the green beacon to the hospital';
    }
    return '';
  }

  /** The hint on a two-vehicle rescue. */
  private handoffHint(touch: boolean, where: { x: number; z: number; agl: number; speed: number }): string {
    const run = this.run;
    const w = run.handoff!;
    const steer = this.prefs.steer === 'left' ? 'left' : 'right';
    const g = peopleAt(w);
    const d = Math.hypot(where.x - g.x, where.z - g.z);
    if (this.driving && w.spec.vehicle === 'bike') {
      if (this.hintT < 5) return touch ? `Lever UP for speed · drag on the ${steer} to steer` : 'Up / W: throttle · left and right: steer';
      if (run.stage === 'rescue') {
        if (w.pull > 0) return 'Hold still while she climbs on';
        if (d < 50) return where.speed >= PICKUP.bike.speed ? 'Brake: stop inside the ring' : 'Into the ring, right next to her';
        return trailAt(where.x, where.z) > 0.5 ? 'Up the forest track: follow the orange pin' : 'The track is quicker than the brush';
      }
      if (escaping(run)) return run.escape!.off ? 'Back onto the trail' : 'Through the arches · hit the ramps flat out';
      const h = w.spec.home;
      return Math.hypot(where.x - h.x, where.z - h.z) < 80 ? 'Slow down and pull up by the ambulance' : 'Follow the green beam to the ambulance';
    }
    if (this.driving) {
      if (this.hintT < 5) return touch ? `Lever UP for speed · drag on the ${steer} to steer` : 'Up / W: throttle · left and right: steer';
      if (run.stage === 'rescue') {
        if (w.pull > 0) return 'Stay right next to them';
        if (d < 60) return where.speed >= PICKUP.boat.speed ? 'Ease off: come alongside slowly' : 'Right alongside them, inside the ring';
        return 'Up the river: follow the orange pin';
      }
      if (escaping(run)) return run.escape!.off ? 'Back into the channel' : 'Through the glowing arches · fly off the rapids';
      const st = w.spec.home;
      const ds = Math.hypot(where.x - st.x, where.z - st.z);
      return ds < 80 ? 'Ease off and slide in to the jetty' : 'Follow the green beam to the station';
    }
    if (this.hintT < 6 && run.t < 14) return touch ? `Lever UP for speed · drag on the ${steer} to steer` : 'Shift / Q: speed · arrows: steer and climb';
    if (run.stage === 'search') return w.spec.river ? 'Fly low along the river: look for the red canoe' : run.signalled ? 'Look for the smoke over the trees' : 'Head for the search area, low over the forest';
    if (run.stage !== 'rescue' || !w.spec.river) return '';
    if (w.caught >= 0 || w.drops === 0) return '';
    if (w.dropped.some((r) => r.state === 'falling')) return 'Watch it come down';
    if (d > 420) return 'Turn back toward them';
    if (where.agl > DROP_MAX_AGL) return 'Too high to drop: get down low';
    return touch ? 'Line up so the orange ring sits in theirs, then DROP RAFT' : 'Line up the orange ring with theirs · DROP (Space / F)';
  }

  /** What the raft button does right now. */
  private raftDropState(): DropState {
    const w = this.run.handoff!;
    if (this.run.stage !== 'rescue' || w.phase !== 'air' || w.caught >= 0 || w.drops === 0) return { kind: 'hidden' };
    const act = canDropItem(w, this.mover(), this.run.spotted);
    if (act.ok) return { kind: 'ready', label: `DROP RAFT · ${w.drops}` };
    if (act.why === 'TOO HIGH') return { kind: 'wait', label: 'TOO HIGH · DESCEND' };
    if (act.why) return { kind: 'wait', label: act.why };
    return { kind: 'hidden' };
  }

  /** What the fire button does right now. */
  private dropState(): DropState {
    const ops = this.run.ops!;
    if (!ops.attack || this.run.stage === 'takeoff') return { kind: 'hidden' };
    if (ops.dropping) return { kind: 'wait', label: 'DROPPING… HOLD STEADY' };
    if (ops.marking) return { kind: 'wait', label: 'MARKING… FLY THE LINE' };
    if (ops.fill > 0) return { kind: 'wait', label: ops.attack === 'water' ? `FILLING ${Math.round(ops.fill * 100)}%` : `${skimming(ops, this.where()) ? 'SCOOPING' : 'RELOADING'} ${Math.round(ops.fill * 100)}%` };
    const w = this.where();
    const act = canFireAction(ops, w, this.hoisting);
    if (act.ok) return { kind: 'ready', label: ops.attack === 'water' ? 'DROP WATER' : ops.attack === 'lead' ? 'MARK LINE' : 'DROP RETARDANT' };
    const near = inArea(ops.fire, w.x, w.z, 120);
    if (act.why === 'TOO HIGH') return { kind: 'wait', label: 'TOO HIGH · DESCEND' };
    if (act.why && near) return { kind: 'wait', label: act.why };
    return { kind: 'hidden' };
  }

  /** The hint on a fire: one short line on what to do next (null: nothing fire-specific to say). */
  private fireHint(touch: boolean, w: { x: number; z: number; agl: number; speed: number }): string | null {
    const ops = this.run.ops!;
    const drop = touch ? 'DROP' : 'DROP (Space / F)';
    if (ops.dropping) return 'Fly straight: the line goes down where you fly';
    if (ops.marking) return 'Fly straight along the line you want';
    if (ops.attack === 'water' && ops.load === 0) {
      const water = waterUnder(ops, w);
      if (!water) return 'Fly to the blue ring and hover low over the water';
      if (w.agl > 18) return 'Lower: get the bucket into the water';
      if (w.speed > 14) return 'Slow right down to fill the bucket';
      return canFill(ops, w) ? 'Filling… hold it there' : '';
    }
    if (ops.attack === 'retardant' && ops.load === 0) {
      if (Math.hypot(w.x - RELOAD.x, w.z - RELOAD.z) < RELOAD.r) return w.agl > RELOAD.agl ? 'Lower over the runway to reload' : 'Reloading… hold it low';
      if (skimming(ops, w)) return 'Scooping! Hold it low over the water';
      const s = nearestSkim(w);
      return Math.hypot(w.x - s.x, w.z - s.z) < 120 ? 'Down low over the water: skim it to scoop' : `Tanks dry: skim ${s.name} low to scoop`;
    }
    if (!ops.attack) return null;
    if (ops.attack === 'lead' && ops.load === 0) return ops.calls.some((c) => c.painted < c.len) ? 'Tanker 42 is on its way: watch the line go down' : 'All calls made · watch your lines hold';
    if (!inArea(ops.fire, w.x, w.z, 40)) return this.def.survivors > 0 ? null : 'Follow the arrow to the fire';
    if (w.agl > (ops.attack === 'water' ? 80 : ops.attack === 'retardant' ? 160 : 320)) return 'Too high to drop: descend';
    if (ops.attack === 'water') return `Over the flames? ${drop}`;
    if (ops.attack === 'retardant') return `Get ahead of the fire, line up, ${drop}`;
    return `Fly ahead of the fire and press MARK`;
  }

  private updateCamera(dt: number): void {
    const hf = this.bundle.heightField;
    // the hoist view frames the people and the basket coming down to them
    const spot = hoistSpot(this.run, this.a);
    const gy = hf.sample(spot.x, spot.z);
    const sep = Math.hypot(this.basket.x - spot.x, this.basket.z - spot.z);
    const look = this.hoisting ? new THREE.Vector3(this.basket.x * 0.5 + spot.x * 0.5, gy + 4 + Math.min(10, Math.max(0, this.basket.y - gy) * 0.25), this.basket.z * 0.5 + spot.z * 0.5) : undefined;
    const dist = this.driving ? (this.onBike ? 0.55 - 0.25 * forestAt(this.a.x, this.a.z) : 0.8) : this.plan.style === 'tanker' ? 2.1 : this.plan.style === 'spotter' || this.plan.style === 'search' ? 1.35 : 1;
    const lift = this.run.ops && this.def.survivors === 0 ? 5 : 0;
    this.chase.update(this.bundle.camera, this.a, dt, (x, z) => hf.sample(x, z), { hoist: this.hoisting ? 1 : 0, look, pull: Math.min(40, sep * 0.8), dist, lift, orbit: this.overview ?? undefined });
    // on the bike in the forest: no trees between the camera and the rider
    const cam = this.bundle.camera.position;
    if (this.driving && this.onBike) {
      const mx = (cam.x + this.a.x) / 2;
      const mz = (cam.z + this.a.z) / 2;
      this.clearance.update(mx, mz, Math.hypot(cam.x - this.a.x, cam.z - this.a.z) / 2 + 5);
    } else this.clearance.update(0, 0, 0);
    if (this.shake > 0) {
      const amp = this.shake * this.shake * 1.6;
      const c = this.bundle.camera.position;
      c.x += (Math.random() - 0.5) * amp;
      c.y += (Math.random() - 0.5) * amp;
      c.z += (Math.random() - 0.5) * amp;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
  }

  // ------------------------------------------------------------------ cards
  private cardT = 0;
  private showCard(kicker: string, title: string, line: string, cls: string, seconds: number): void {
    this.el['card-kicker'].textContent = kicker;
    this.el['card-title'].textContent = title;
    this.el['card-line'].textContent = line;
    const c = this.el['card'];
    c.className = 'moment';
    void c.offsetWidth;
    c.className = `moment ${cls}`;
    this.cardT = seconds;
  }

  private hideCard(): void {
    this.el['card'].className = 'moment hidden';
    this.cardT = 0;
  }

  private updateCard(dt: number): void {
    if (this.cardT <= 0 || this.mode === 'paused') return;
    this.cardT -= dt;
    if (this.cardT <= 0) this.hideCard();
  }

  private flash(): void {
    const f = this.el['flash'];
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 160);
  }

  // ------------------------------------------------------------------ QA
  private exposeQa(): void {
    // lets automated play-tests read the state and move the helicopter, without faking any game logic
    (window as unknown as { __skytrace: unknown }).__skytrace = {
      getMode: () => this.mode,
      getRun: () => this.run,
      getAircraft: () => this.a,
      getBasket: () => this.basket,
      getPlan: () => this.plan,
      getLoadout: () => this.loadout,
      getProgress: () => this.progress,
      isHoisting: () => this.hoisting,
      getDef: () => this.def,
      teleport: (x: number, z: number, agl: number, headingDeg?: number) => {
        this.a.x = x;
        this.a.z = z;
        this.a.y = this.bundle.heightField.sample(x, z) + agl;
        this.a.speed = 0;
        this.a.vx = 0;
        this.a.vz = 0;
        this.a.throttle = 0;
        if (headingDeg !== undefined) this.a.yaw = wrapAngle((-headingDeg * Math.PI) / 180);
        this.a.vx = 0;
        this.a.vz = 0;
        this.hv = { vx: 0, vz: 0 };
        this.chase.reset();
      },
      getOps: () => this.run.ops,
      getBriefing: () => this.preflight.fire,
      /** Run the game this many seconds without drawing (slow software renderers in automated play-tests). */
      advance: (sec: number) => {
        for (let i = 0; i < sec / 0.05; i++) this.tick(0.05);
      },
      /** Press the fire button (as the DROP button does). */
      fireDrop: () => this.fireDrop(),
      /** Screenshot helper: put the aircraft over the fire's head, `back` metres short of it, heading for the place it threatens. */
      skipToFire: (back = 120, agl = 70) => {
        const ops = this.run.ops;
        if (!ops) return;
        const head = fireHead(ops) ?? { x: ops.spec.area.x, z: ops.spec.area.z };
        const th = nearestThreat(ops);
        const yaw = Math.atan2(-(th.x - head.x), -(th.z - head.z));
        const ax = headingAxes(yaw);
        this.a.x = head.x - ax.fx * back;
        this.a.z = head.z - ax.fz * back;
        this.a.y = this.bundle.heightField.sample(this.a.x, this.a.z) + agl;
        this.a.yaw = yaw;
        if (this.plan.kind !== 'plane') {
          this.a.speed = 0;
          this.a.vx = 0;
          this.a.vz = 0;
          this.a.throttle = 0;
        }
        this.chase.reset();
      },
      /** Run the fire forward this many seconds (screenshots of a fire well under way). */
      ageFire: (sec: number) => {
        const ops = this.run.ops;
        if (!ops) return;
        for (let i = 0; i < sec; i++) {
          stepFire(ops.fire, windAt(this.def.wind, this.run.t + i), 1);
          stepFire(ops.shadow, windAt(this.def.wind, this.run.t + i), 1);
        }
      },
      /** Failure test helper: leave this many seconds in the tank. */
      setFuel: (sec: number) => {
        this.run.fuel = sec;
      },
      getHandoff: () => this.run.handoff,
      isDriving: () => this.driving,
      /** Water rescue helper: the aircraft `back` metres upstream of the people, low, flying down the river at them. */
      skipToSwimmers: (back = 220, agl = 40) => {
        const w = this.run.handoff;
        if (!w) return;
        const g = peopleAt(w);
        const c = currentAt(g.x, g.z);
        const l = Math.hypot(c.x, c.z) || 1;
        const fx = c.x / l;
        const fz = c.z / l;
        this.a.x = g.x - fx * back;
        this.a.z = g.z - fz * back;
        this.a.y = Math.max(0, this.bundle.heightField.sample(this.a.x, this.a.z)) + agl;
        this.a.yaw = Math.atan2(-fx, -fz);
        this.a.vx = fx * this.a.speed;
        this.a.vz = fz * this.a.speed;
        this.chase.reset();
      },
      /** Two-vehicle helper: the aircraft's part is done and the boat (or the bike) takes over now. */
      skipToGround: () => {
        const w = this.run.handoff;
        if (!w) return;
        this.run.spotted = true;
        this.run.stage = 'rescue';
        w.handoffIn = 0.01;
      },
      /** Two-vehicle helper: the boat (or the bike) alongside them, stopped. */
      alongside: () => {
        const w = this.run.handoff;
        if (!w || !this.driving) return;
        const g = peopleAt(w);
        const b = this.a as BoatState;
        b.x = g.x + 6;
        b.z = g.z + 6;
        b.speed = 0;
        b.vx = 0;
        b.vz = 0;
        b.throttle = 0;
        this.chase.reset();
      },
      /** Screenshot helper: put the helicopter just short of the people, already found. */
      skipToSite: () => {
        const d = this.def;
        this.run.stage = 'rescue';
        this.run.spotted = true;
        this.run.signalled = true;
        this.a.x = d.site.x;
        this.a.z = d.site.z + 30;
        this.a.y = this.bundle.heightField.sample(d.site.x, d.site.z) + 24;
        this.a.yaw = 0;
        this.a.speed = 0;
        this.a.vx = 0;
        this.a.vz = 0;
        this.a.vx = 0;
        this.a.vz = 0;
        this.a.throttle = 0;
        this.chase.reset();
      },
    };
  }
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const FIRE_EVENTS = new Set<RunEvent>(['over-fire', 'drop', 'line-laid', 'water-hit', 'water-missed', 'empty', 'filling', 'full', 'reloaded', 'mark-start', 'marked', 'tanker-drop', 'spot-fire', 'line-holding', 'threat-up', 'contained', 'held', 'breached']);
