import * as THREE from 'three';
import { AudioSystem } from '../core/audio';
import { Input } from '../core/input';
import { clamp, damp, wrapAngle } from '../core/math';
import { Radio, type Speaker } from '../core/radio';
import { loadPrefs, savePrefs, type Prefs, type SteerSide, type VerticalMode } from '../core/settings';
import { initialAircraft, stepAircraft, type AircraftState } from '../flight/aircraft';
import { ChaseCamera } from '../flight/camera';
import { HelicopterMesh } from '../flight/helicopterMesh';
import { debrief, type Debrief } from '../rescue/debrief';
import { newBasket, RING_PAD, stepHoist, type Basket, type HoistEvent } from '../rescue/hoist';
import { headingAxes, hoverTilt, stepHover, type HoverVel } from '../rescue/hover';
import { canLaunch, defaultLoadout, planOf, toggleEquipment, withCrew, withVehicle, type Loadout, type Plan } from '../rescue/loadout';
import { MISSION_BY_ID, type MissionDef, type MissionId } from '../rescue/missions';
import { loadProgress, nextMission, recordRescue, saveProgress, type Progress } from '../rescue/progress';
import { aboard, cabinFull, canHoist, canLand, delivered, distToSite, landAtPad, newRun, objective, tickRun, waiting, type RunEvent, type RunState } from '../rescue/run';
import { HOVER_DRIFT, windAt, type Wind } from '../rescue/wind';
import { Hud, type ActionState, type MapFrame } from '../ui/hud';
import { PreflightView } from '../ui/preflight';
import { renderTitle } from '../ui/title';
import { buildCountryside } from '../world/countryside';
import { buildProps, buildTrees, updateProps, type WorldProps } from '../world/props';
import { BasketMesh, buildCamp, buildRescueProps, Burst, Marker, reachRing, searchArea, Signals, SurvivorMesh, type RescueProps } from '../world/rescueScene';
import { createScene, type SceneBundle } from '../world/scene';
import { PADS } from '../world/worldData';
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
  private basketMesh = new BasketMesh();
  private marker = new Marker();
  private tube = searchArea();
  private ring = reachRing();
  private signals = new Signals();
  private burst = new Burst();
  private camp: THREE.Group | null = null;
  private people: SurvivorMesh[] = [];
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
    for (const id of ['gl', 'loading', 'title', 'preflight', 'hud', 'pause', 'debrief', 'card', 'card-kicker', 'card-title', 'card-line', 'flash', 'stick-zone', 'stick-knob', 'throttle', 'btn-action', 'btn-pause', 'btn-resume', 'btn-restart', 'btn-abort', 'btn-sound', 'btn-voice', 'pause-objective', 'btn-db-next', 'btn-db-again', 'btn-db-menu', 'db-headline', 'db-mission', 'db-stars', 'db-lines', 'db-unlocks', 'btn-title-settings']) this.el[id] = q(id);

    this.bundle = createScene(this.el['gl'] as HTMLCanvasElement);
    const hf = this.bundle.heightField;
    const scene = this.bundle.scene;
    this.props = buildProps(hf);
    scene.add(this.props.group, buildTrees(hf), buildCountryside(hf).group);
    this.rescueProps = buildRescueProps(hf);
    scene.add(this.rescueProps.group, this.heli.group, this.basketMesh.group, this.basketMesh.cable, this.basketMesh.shadow, this.marker.group, this.tube, this.ring, this.signals.group, this.burst.group);

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
    this.input.onAction('pause', () => this.togglePause());
    this.input.onAction('action', () => this.contextAction());
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
    this.el['btn-db-next'].addEventListener('click', () => this.openPreflight(nextMission(this.progress).id));
    this.el['btn-db-again'].addEventListener('click', () => (this.run.stage === 'failed' ? this.launch() : this.openPreflight(this.def.id)));
    this.el['btn-db-menu'].addEventListener('click', () => this.showTitle());
    for (const b of root.querySelectorAll<HTMLElement>('[data-vert]')) b.addEventListener('click', () => this.setVertical(b.dataset.vert as VerticalMode));
    for (const b of root.querySelectorAll<HTMLElement>('[data-steer]')) b.addEventListener('click', () => this.setSteer(b.dataset.steer as SteerSide));
    try {
      this.radio.voice = localStorage.getItem('skytrace.voice') !== 'off';
    } catch {
      /* default on */
    }
    this.renderPrefs();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
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
    this.el['pause-objective'].textContent = 'Drag on one side to steer and climb. Slide the lever on the other side for speed. In a hover the lever lowers the basket.';
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
    a.throttle = 0;
    a.agl = PAD_TOP + SKID;
    return a;
  }

  private clearMissionScene(): void {
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
    this.heli.setStyle(this.plan.style);
    this.a = this.onPad(def.startPad);
    this.hv = { vx: 0, vz: 0 };
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
    this.heli.winchWorld(this.winchPos);
    this.winchPrev.copy(this.winchPos);
    this.basket = newBasket({ x: this.winchPos.x, y: this.winchPos.y, z: this.winchPos.z, vx: 0, vz: 0 });
    // the people, their camp, the search area
    this.run.survivors.forEach((s, i) => {
      const m = new SurvivorMesh(def.look, i);
      m.update('waiting', s.x, hf.sample(s.x, s.z), s.z, 0, 0);
      this.people.push(m);
      this.bundle.scene.add(m.group);
    });
    this.camp = buildCamp(hf, def.site.x, def.site.z, def.look);
    this.bundle.scene.add(this.camp);
    const gy = hf.sample(def.search.x, def.search.z);
    this.tube.position.set(def.search.x, gy + 120, def.search.z);
    this.tube.scale.set(def.search.r, 420, def.search.r);
    this.tube.visible = true;
    const sy = hf.sample(def.site.x, def.site.z);
    this.ring.position.set(def.site.x, sy + 0.35, def.site.z);
    this.ring.scale.setScalar(this.plan.hoist.reach + RING_PAD);
    this.ring.visible = false;
    this.basketMesh.group.visible = true;
    this.bundle.setVisibility(VISIBILITY[def.visibility]);
    this.chase.reset();
    this.hud.clearBanners();
    this.radio.clear();
    this.radio.say('DISPATCH', def.radio.launch);
    this.showCard('RESCUE ONE', 'LIFTING OFF', `${def.icon} ${def.title}`, '', 2.4);
    this.show('flight');
  }

  // ------------------------------------------------------------------ actions
  private togglePause(): void {
    const next = pauseTransition(this.mode);
    if (!next) return;
    if (next === 'paused') {
      const o = objective(this.run, this.hoisting, this.plan.beacon);
      this.el['pause-objective'].textContent = `${o.icon} ${o.title}${o.detail ? ` · ${o.detail}` : ''}`;
      this.audio.winch(0);
    }
    this.show(next);
  }

  /** The one context button: HOVER & HOIST over the people, FLY to leave the hover. */
  private contextAction(): void {
    if (this.mode !== 'flight') return;
    if (this.hoisting) {
      this.leaveHover();
      return;
    }
    const where = { x: this.a.x, z: this.a.z, agl: this.a.agl, speed: this.a.speed };
    if (!canHoist(this.run, where).ok) return;
    this.enterHover();
  }

  private enterHover(): void {
    const ax = headingAxes(this.a.yaw);
    this.hv = { vx: ax.fx * this.a.speed, vz: ax.fz * this.a.speed };
    this.hoisting = true;
    this.reeling = false;
    this.winchCmd = this.basket.len;
    this.holdY = this.bundle.heightField.sample(this.def.site.x, this.def.site.z) + HOVER_HEIGHT;
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
    const ax = headingAxes(this.a.yaw);
    this.a.speed = Math.max(0, this.hv.vx * ax.fx + this.hv.vz * ax.fz);
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
    this.t += dt;
    this.bundle.update(dt, this.t);
    updateProps(this.props, this.t);
    this.radio.update(this.mode === 'paused' ? 0 : dt);
    this.updateCard(dt);
    if (this.mode === 'flight') this.updateFlight(dt);
    else if (this.mode === 'landing') this.updateLanding(dt);
    else if (this.mode === 'title') this.updateTitle(dt);
    else if (this.mode === 'preflight') this.preflight.tick(this.t);
    if (this.mode === 'preflight' || this.mode === 'debrief' || this.mode === 'paused') this.audio.updateHeli(0, 0, 0, 0);
    if (this.mode !== 'preflight') this.bundle.renderer.render(this.bundle.scene, this.bundle.camera);
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
    const drift = { x: this.wind.x * HOVER_DRIFT * plan.windFactor, z: this.wind.z * HOVER_DRIFT * plan.windFactor };

    // ---- fly
    if (run.stage === 'takeoff') {
      // spin up on the pad, then lift straight up to a safe height
      this.takeoffT += dt;
      this.power = Math.min(1, this.takeoffT / 1.6);
      if (this.takeoffT > 1.6) this.a.y += Math.min(9, 2 + (this.takeoffT - 1.6) * 5) * dt;
      this.a.agl = this.a.y - ground(this.a.x, this.a.z);
      this.a.speed = 0;
      this.input.syncThrottle(0);
      this.input.touchThrottle = null;
    } else if (this.hoisting) {
      const stick = this.input.readStick();
      this.a = stepHover(this.a, this.hv, stick, { maxSpeed: HOVER_SPEED, response: 1.5, drift, holdY: this.holdY, clearance: 9 }, ground, dt);
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
      this.a = stepAircraft(this.a, inp, dt, ground, plan.perf);
      // the wind leans on a slow helicopter
      const k = 1 - Math.min(1, this.a.speed / 30) * 0.6;
      this.a.x += drift.x * k * dt;
      this.a.z += drift.z * k * dt;
      this.input.syncThrottle(this.a.throttle);
      this.winchCmd = 0;
    }

    // ---- the helicopter, its winch, the basket
    const targetTilt = this.hoisting ? hoverTilt(this.a.yaw, this.hv, HOVER_SPEED) : (this.a.speed / plan.perf.maxSpeed) * 0.2;
    this.tilt = damp(this.tilt, targetTilt, 3, dt);
    this.heli.sync(this.a, this.t, dt, this.tilt, this.power);
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

    // ---- the rescue
    const where = { x: this.a.x, z: this.a.z, agl: this.a.agl, speed: this.a.speed };
    const ev = tickRun(run, where, dt, plan, this.hoisting);
    this.runEvents(ev);
    if (this.mode !== 'flight') return;
    if (this.autoExit > 0) {
      this.autoExit -= dt;
      if (this.autoExit <= 0 && this.hoisting) this.leaveHover();
    }
    if (!this.hoisting && run.stage !== 'takeoff' && canLand(run, where)) {
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
    this.audio.updateHeli(this.power, load, this.a.speed, this.wind.gust);
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
        this.audio.secured();
        this.burst.fire(this.winchPos.clone());
        const n = aboard(run) + delivered(run);
        const word = this.def.look === 'climber' ? 'CLIMBER' : this.def.look === 'skier' ? 'SKIER' : 'HIKER';
        this.hud.banner(`${word} SECURED!`, `${n} of ${run.survivors.length} safe aboard`, 'good', 2.4);
        if (waiting(run) > 0 && !cabinFull(run)) this.crew(pick(CREW_LINES.secured));
        if (waiting(run) === 0 || cabinFull(run)) this.autoExit = 1.4;
        this.shake = 0.15;
      } else if (e.type === 'stepped-back') {
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
      } else if (e === 'spotted') {
        this.audio.spotted();
        this.hud.banner('SPOTTED!', def.survivors === 1 ? 'Fly over and come into a hover' : `${def.survivors} people · fly over and hover`, 'spot', 2.6);
        this.say('CREW', def.radio.spotted);
      } else if (e === 'cabin-full') {
        this.hud.banner('CABIN FULL', 'Take them to the hospital', 'spot', 2.4);
        this.crew(pick(CREW_LINES.cabinFull));
      } else if (e === 'all-aboard') {
        this.hud.banner('ALL ABOARD!', 'Now get them to the hospital', 'good', 2.6);
        this.say('CREW', def.radio.allAboard);
      } else if (e === 'low-fuel') {
        this.crew(pick(CREW_LINES.lowFuel));
      } else if (e === 'out-of-fuel') {
        this.fail('OUT OF FUEL', this.run.failReason ?? '');
      }
    }
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
    this.hud.tick(dt);
    if (this.ending) {
      // a failure (or the end of the rescue): hold, then the debrief
      this.power = Math.max(0.25, this.power - dt * 0.4);
      this.heli.sync(this.a, this.t, dt, this.tilt * 0.9, this.power);
      this.audio.updateHeli(this.power, 0.2, 0, 0);
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
    this.hideCard();
    this.audio.winch(0);
    if (d.success) {
      this.unlocked = recordRescue(this.progress, this.def.id, { stars: d.stars, time: d.time, rescued: d.rescued }, this.loadout);
      saveProgress(this.progress, localStorage);
    } else this.unlocked = [];
    const h = this.el['db-headline'];
    h.textContent = d.headline;
    h.classList.toggle('fail', !d.success);
    this.el['db-mission'].textContent = `${this.def.icon} ${this.def.title.toUpperCase()} · ${this.def.place.toUpperCase()}`;
    this.el['db-stars'].innerHTML = [0, 1, 2].map((i) => `<i class="${i < d.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.25}s">★</i>`).join('');
    this.el['db-lines'].innerHTML = d.lines.map((l, i) => `<li style="animation-delay:${0.1 + i * 0.15}s"><i>${l.icon}</i>${l.text}</li>`).join('');
    this.el['db-unlocks'].innerHTML = this.unlocked.length ? `<div class="u-head">UNLOCKED</div>${this.unlocked.map((u, i) => `<div class="u" style="animation-delay:${0.8 + i * 0.15}s">${u}</div>`).join('')}` : '';
    const next = nextMission(this.progress);
    const nextBtn = this.el['btn-db-next'];
    nextBtn.classList.toggle('hidden', !d.success || next.id === this.def.id);
    nextBtn.textContent = `NEXT: ${next.title.toUpperCase()}`;
    this.el['btn-db-again'].textContent = d.success ? 'FLY IT AGAIN' : 'TRY AGAIN';
    if (d.success && this.unlocked.length) setTimeout(() => this.audio.unlockSound(), 900);
    this.show('debrief');
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
      if (s.state === 'basket') {
        m.update('basket', this.basket.x, this.basket.y + 0.15, this.basket.z, this.a.yaw, this.t);
        return;
      }
      const face = Math.atan2(-(this.a.x - s.x), -(this.a.z - s.z));
      m.update(s.state, s.x, hf.sample(s.x, s.z), s.z, s.state === 'walking' ? Math.atan2(-(this.basket.x - s.x), -(this.basket.z - s.z)) : face, this.t);
    });
    // the basket and its cable
    const g = hf.sample(this.basket.x, this.basket.z);
    this.basketMesh.group.visible = true;
    this.basketMesh.update(this.basket.x, this.basket.y, this.basket.z, this.a.yaw, this.winchPos, g, this.basket.len);
    // markers: the search area, then the people, then the hospital
    const onMountain = waiting(run) > 0;
    this.tube.visible = !run.spotted;
    const dSite = distToSite(run, this.a);
    this.ring.visible = run.spotted && onMountain && dSite < 160;
    const pulse = 0.65 + 0.35 * Math.sin(this.t * 5);
    const ringMat = this.ring.material as THREE.MeshBasicMaterial;
    ringMat.opacity = pulse;
    const over = this.hoisting && Math.hypot(this.basket.x - def.site.x, this.basket.z - def.site.z) <= this.plan.hoist.reach + RING_PAD;
    ringMat.color.setHex(over ? 0x22e070 : 0xffffff);
    const pad = PADS[def.deliverTo];
    const toHospital = aboard(run) > 0 && (run.stage === 'return' || cabinFull(run) || waiting(run) === 0);
    this.rescueProps.padBeacon[def.deliverTo].visible = toHospital;
    if (this.mode === 'landing' || run.stage === 'complete' || run.stage === 'failed') this.marker.group.visible = false;
    else if (toHospital) {
      this.marker.set('h');
      this.marker.group.visible = true;
      this.marker.update(pad.x, hf.sample(pad.x, pad.z), pad.z, cam, this.t, 26);
    } else if (run.spotted && onMountain) {
      this.marker.set('person');
      this.marker.group.visible = !(this.hoisting && dSite < 50);
      this.marker.update(def.site.x, hf.sample(def.site.x, def.site.z), def.site.z, cam, this.t, 16);
    } else if (!run.spotted) {
      this.marker.set('search');
      this.marker.group.visible = run.stage !== 'takeoff' && Math.hypot(this.a.x - def.search.x, this.a.z - def.search.z) > def.search.r * 0.9;
      this.marker.update(def.search.x, hf.sample(def.search.x, def.search.z), def.search.z, cam, this.t, 60);
    } else this.marker.group.visible = false;
    // ambulance lights at the hospital
    for (const [i, l] of this.rescueProps.ambulanceLights.entries()) (l.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(this.t * 4 + i) % 2 ? 0x3aa0ff : 0x0d2a55);
    const smoke = def.signal === 'smoke' ? new THREE.Vector3(def.site.x + 3, hf.sample(def.site.x + 3, def.site.z + 2), def.site.z + 2) : null;
    this.signals.update(dt, this.wind, smoke);
    this.burst.update(dt);
  }

  private updateHud(dt: number): void {
    const run = this.run;
    const def = this.def;
    const plan = this.plan;
    const hud = this.hud;
    hud.tick(dt);
    const o = objective(run, this.hoisting, plan.beacon && dist2(this.a, def.site) < 1100);
    hud.objective(o.icon, o.title, o.detail);
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
    const touch = this.input.isTouch;
    // the context button
    const where = { x: this.a.x, z: this.a.z, agl: this.a.agl, speed: this.a.speed };
    let action: ActionState = { kind: 'hidden' };
    if (this.hoisting) action = this.reeling ? { kind: 'wait', label: 'REELING IN…' } : { kind: 'fly', label: 'FLY ▶' };
    else {
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
    } else {
      hud.lever(this.a.throttle);
      hud.stickLabel(this.prefs.verticalMode === 'standard' ? 'STEER · UP CLIMBS' : 'STEER · DOWN CLIMBS');
    }
    hud.readout(this.hoisting ? `WIND ${Math.round(this.wind.speed * 3.6)} km/h` : `${Math.round(this.a.agl)} m · ${Math.round(this.a.speed * 3.6)} km/h`);
    // warnings
    const fuelLow = run.fuel < run.fuelMax * 0.2;
    hud.warn(this.a.terrainWarning && !this.hoisting && this.a.speed > 15 ? 'TERRAIN · CLIMB' : fuelLow ? 'LOW FUEL' : '');
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
      site: run.spotted && waiting(run) > 0 ? def.site : null,
      pads: [
        { x: PADS.base.x, z: PADS.base.z, hospital: false },
        { x: PADS.hospital.x, z: PADS.hospital.z, hospital: true },
      ],
    };
    if (this.hoisting)
      frame.hoist = {
        reach: plan.hoist.reach,
        site: def.site,
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
    if (this.hintT < 6 && run.t < 14) return touch ? `Lever UP to fly · drag on the ${steer} to steer` : 'Shift / Q: speed · arrows: steer and climb';
    if (run.stage === 'search') return run.signalled ? `Look for the ${this.def.signal === 'smoke' ? 'smoke' : 'red flare'}` : 'Head for the blue search area';
    if (run.stage === 'rescue') {
      const d = distToSite(run, where);
      if (d < 140 && where.speed > 22) return 'Slow down: lever DOWN';
      if (d < 140) return 'Fly over them and press HOVER & HOIST';
      return 'Follow the orange pin';
    }
    if (run.stage === 'return') {
      const pad = PADS[this.def.deliverTo];
      const d = Math.hypot(where.x - pad.x, where.z - pad.z);
      if (d < 160) return where.speed > 9 ? 'Slow down over the H' : 'Descend onto the H';
      return 'Follow the green beacon to the hospital';
    }
    return '';
  }

  private updateCamera(dt: number): void {
    const hf = this.bundle.heightField;
    // the hoist view frames the people and the basket coming down to them
    const gy = hf.sample(this.def.site.x, this.def.site.z);
    const sep = Math.hypot(this.basket.x - this.def.site.x, this.basket.z - this.def.site.z);
    const look = this.hoisting ? new THREE.Vector3(this.basket.x * 0.5 + this.def.site.x * 0.5, gy + 4 + Math.min(10, Math.max(0, this.basket.y - gy) * 0.25), this.basket.z * 0.5 + this.def.site.z * 0.5) : undefined;
    this.chase.update(this.bundle.camera, this.a, dt, (x, z) => hf.sample(x, z), { hoist: this.hoisting ? 1 : 0, look, pull: Math.min(40, sep * 0.8) });
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
        this.a.throttle = 0;
        if (headingDeg !== undefined) this.a.yaw = wrapAngle((-headingDeg * Math.PI) / 180);
        this.chase.reset();
      },
      /** Failure test helper: leave this many seconds in the tank. */
      setFuel: (sec: number) => {
        this.run.fuel = sec;
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
        this.a.throttle = 0;
        this.chase.reset();
      },
    };
  }
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
