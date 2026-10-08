import * as THREE from 'three';
import { BURNING, BURNT, cloneFire, OUT, stepFire, UNBURNT, type FireState, type FireWind } from '../fire/fireSim';
import { along, CALL_LEN, CALL_SPEED, LINE_LEN, LINE_WIDTH, WATER_R, type FireOps } from '../fire/fireRun';
import { PlaneMesh } from '../flight/planeMesh';
import type { HeightField } from './terrain';
import { gable, house, mat, place } from './props';

/**
 * The fire, made visible. Everything here only draws what the pure fire
 * simulation says; nothing in it changes the fire.
 *
 *  - a burn map draped over the terrain: glowing front, ash behind it, the
 *    red of retardant lines, the blue of wet ground, and the dull orange of
 *    ground heating up just ahead of the flames (where it is going next)
 *  - flames over every burning cell, a warm light over the fire
 *  - smoke columns leaning with the wind, embers
 *  - the forest reacting: trees scorch, burn and stand black
 *  - the places in danger (cabins, a hut, a school) and where to get water
 *  - the drops: red retardant falling from the tanker, water from the bucket
 *  - where your drop will land before you press it
 *  - Tanker 42, flying the lines a spotter marks
 */

// ---------------------------------------------------------------- particles
interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  gravity: number;
  drag: number;
  /** Fade in over the first part of the life (0..1). */
  fadeIn: number;
  /** Stop at the ground (y): and call back. */
  floor: number;
}

export type SpawnOpts = Partial<P> & { x: number; y: number; z: number };

/**
 * A soft-particle system on one draw call: round, fading points that grow
 * as they age. Smoke, embers and spray are each one of these.
 */
export class Particles {
  readonly points: THREE.Points;
  private ps: P[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private mat: THREE.ShaderMaterial;
  /** Called when a particle reaches the ground. */
  onLand: ((p: P) => void) | null = null;

  constructor(
    private max: number,
    additive: boolean,
    soft = 0.5,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uFogColor: { value: new THREE.Color(0xcfe3ee) }, uFogNear: { value: 700 }, uFogFar: { value: 2600 }, uSoft: { value: soft } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; varying float vFog;
        uniform float uScale; uniform float uFogNear; uniform float uFogFar;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(512.0, size * uScale / max(1.0, -mv.z));
          // thin out right in front of the camera, so flying through smoke never blinds you
          vColor = color; vAlpha = alpha * smoothstep(size * 0.4, size * 1.6 + 8.0, -mv.z);
          vFog = smoothstep(uFogNear, uFogFar, -mv.z);
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; varying float vFog;
        uniform vec3 uFogColor; uniform float uSoft;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = vAlpha * (1.0 - smoothstep(1.0 - uSoft, 1.0, d));
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(vColor, uFogColor, vFog * 0.85), a * (1.0 - vFog * 0.6));
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 9 : 8;
  }

  get count(): number {
    return this.ps.length;
  }

  spawn(o: SpawnOpts): void {
    if (this.ps.length >= this.max) return;
    this.ps.push({ vx: 0, vy: 0, vz: 0, age: 0, life: 4, size: 4, grow: 0, r: 1, g: 1, b: 1, alpha: 1, gravity: 0, drag: 0, fadeIn: 0.1, floor: -Infinity, ...o });
  }

  update(dt: number, cam: THREE.PerspectiveCamera, viewH: number, wind: { x: number; z: number }, windPush: number): void {
    this.mat.uniforms.uScale.value = viewH / 2 / Math.tan((cam.fov * Math.PI) / 360);
    let n = 0;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.ps[i] = this.ps[this.ps.length - 1];
        this.ps.pop();
        continue;
      }
      p.vy -= p.gravity * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx = p.vx * k + wind.x * windPush * (1 - k);
      p.vz = p.vz * k + wind.z * windPush * (1 - k);
      p.vy *= p.drag > 0 && p.gravity === 0 ? k : 1;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y <= p.floor) {
        if (this.onLand) this.onLand(p);
        p.age = p.life;
      }
    }
    for (const p of this.ps) {
      const u = p.age / p.life;
      const fin = p.fadeIn > 0 ? Math.min(1, u / p.fadeIn) : 1;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.col[n * 3] = p.r;
      this.col[n * 3 + 1] = p.g;
      this.col[n * 3 + 2] = p.b;
      this.size[n] = p.size + p.grow * u;
      this.alpha[n] = p.alpha * fin * (1 - u * u);
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'size', 'alpha']) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }

  setFog(f: THREE.Fog): void {
    this.mat.uniforms.uFogColor.value.copy(f.color);
    this.mat.uniforms.uFogNear.value = f.near;
    this.mat.uniforms.uFogFar.value = f.far;
  }

  clear(): void {
    this.ps = [];
    this.geo.setDrawRange(0, 0);
  }
}

// ---------------------------------------------------------------- labels
function labelTexture(text: string, bg: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  ctx.font = '900 44px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  cv.width = w;
  cv.height = 76;
  ctx.font = '900 44px system-ui, sans-serif';
  ctx.fillStyle = bg;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, 68, 34);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 40);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Label {
  readonly sprite: THREE.Sprite;
  private aspect: number;
  constructor(
    text: string,
    bg: string,
    private x: number,
    private y: number,
    private z: number,
  ) {
    const tex = labelTexture(text, bg);
    this.aspect = (tex.image as HTMLCanvasElement).width / (tex.image as HTMLCanvasElement).height;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 21;
  }
  update(cam: THREE.Camera, lift: number): void {
    const d = cam.position.distanceTo(new THREE.Vector3(this.x, this.y, this.z));
    const s = Math.max(4, d * 0.032);
    this.sprite.position.set(this.x, this.y + lift + Math.max(0, (d - 150) * 0.03), this.z);
    this.sprite.scale.set(s * this.aspect, s, 1);
  }
  dispose(): void {
    const m = this.sprite.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

// ---------------------------------------------------------------- the view
interface TreeRef {
  i: number;
  k: number;
  m: THREE.Matrix4;
  c: THREE.Color;
  hidden: boolean;
}

const FLAMES = 900;

export class FireView {
  readonly group = new THREE.Group();
  /** The burn map (one pixel a cell): drawn on the ground and on the minimap. */
  readonly canvas = document.createElement('canvas');
  /** Where the fire will be in a minute (one pixel a cell), when someone aboard can read it. */
  readonly forecastCanvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData | null = null;
  private tex: THREE.CanvasTexture;
  private ground: THREE.Mesh | null = null;
  private flames: THREE.InstancedMesh;
  private light = new THREE.PointLight(0xff7a2a, 0, 520, 1.2);
  readonly smoke = new Particles(700, false, 0.6);
  readonly glow = new Particles(500, true, 0.9);
  readonly spray = new Particles(1400, false, 0.5);
  private site = new THREE.Group();
  private labels: Label[] = [];
  private rings: { mesh: THREE.Mesh; r: number }[] = [];
  private trees: TreeRef[] = [];
  private treeMesh: THREE.InstancedMesh | null = null;
  private preview: THREE.Mesh;
  private previewPos: Float32Array;
  private target: THREE.Mesh;
  private marks: THREE.Mesh[] = [];
  readonly tanker42 = new PlaneMesh('tanker');
  private fire: FireState | null = null;
  private texT = 0;
  private treeT = 0;
  private forecastT = 0;
  private forecast: Uint8Array | null = null;
  private showForecast = false;
  private emitT = 0;
  /** A retardant cloud lands: tint where it hits (for the splash). */
  private splashes: { x: number; y: number; z: number }[] = [];

  constructor(
    scene: THREE.Scene,
    private hf: HeightField,
  ) {
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    // flames: a cone, deep orange at the base to yellow at the tip
    // a tongue of flame: a cone, hot yellow low down, deep orange higher up, fading out at the tip
    // (normal blending: additive washes out to white over bright ground; the glow particles do the glowing)
    const cone = new THREE.ConeGeometry(1, 1, 7, 4, true);
    cone.translate(0, 0.5, 0);
    const cols = new Float32Array(cone.attributes.position.count * 4);
    const fc = new THREE.Color();
    for (let i = 0; i < cone.attributes.position.count; i++) {
      const y = cone.attributes.position.getY(i);
      // (picked as screen colours: converted to the renderer's linear space)
      fc.setRGB(1, 0.82 - 0.52 * y, 0.25 - 0.22 * y, THREE.SRGBColorSpace);
      cols[i * 4] = fc.r;
      cols[i * 4 + 1] = fc.g;
      cols[i * 4 + 2] = fc.b;
      cols[i * 4 + 3] = 0.95 * (1 - 0.85 * y * y);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    this.flames = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, toneMapped: false }), FLAMES);
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 10;
    // where your drop will land
    this.previewPos = new Float32Array(2 * 25 * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.previewPos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < 24; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    pg.setIndex(idx);
    this.preview = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 6;
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    this.target.rotation.x = -Math.PI / 2;
    this.target.renderOrder = 15;
    this.group.add(this.flames, this.light, this.smoke.points, this.glow.points, this.spray.points, this.site, this.preview, this.target, this.tanker42.group);
    this.group.visible = false;
    scene.add(this.group);
    this.spray.onLand = (p) => {
      // the drop hits the ground: a burst of mist
      if (this.splashes.length < 60 && Math.random() < 0.25) this.splashes.push({ x: p.x, y: p.y, z: p.z });
    };
  }

  // -------------------------------------------------------------- set-up
  setup(ops: FireOps, trees: THREE.InstancedMesh | null): void {
    this.clear();
    const f = ops.fire;
    this.fire = f;
    this.group.visible = true;
    this.canvas.width = this.canvas.height = f.n;
    this.forecastCanvas.width = this.forecastCanvas.height = f.n;
    this.img = this.ctx.createImageData(f.n, f.n);
    this.tex.dispose();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter;
    // the burn map, draped over the ground
    const size = f.n * f.cell;
    const seg = f.n;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const cx = f.x0 + size / 2;
    const cz = f.z0 + size / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      pos.setX(i, x);
      pos.setZ(i, z);
      pos.setY(i, Math.max(0.3, this.hf.sample(x, z)) + 1.4);
    }
    geo.computeBoundingSphere();
    this.ground = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    this.ground.renderOrder = 4;
    this.group.add(this.ground);
    // the places in danger
    for (const th of ops.spec.threats) {
      const g = this.hf.sample(th.x, th.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 56), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(th.x, g + 1.8, th.z);
      ring.scale.setScalar(th.r + 4);
      ring.renderOrder = 5;
      this.site.add(ring);
      this.rings.push({ mesh: ring, r: th.r });
      if (th.icon !== '🆘') this.buildPlace(th.icon, th.x, th.z, th.r);
      const lab = new Label(`${th.icon} ${th.name.toUpperCase()}`, '#e23d28', th.x, g, th.z);
      this.labels.push(lab);
      this.site.add(lab.sprite);
    }
    // where to fill the bucket
    if (ops.attack === 'water')
      for (const w of ops.spec.water) {
        const g = Math.max(0, this.hf.sample(w.x, w.z));
        if (/tank/i.test(w.name)) {
          const pool = new THREE.Mesh(new THREE.CylinderGeometry(w.r * 0.45, w.r * 0.45, 1.6, 28), mat(0xff8a1f));
          pool.position.set(w.x, g + 0.6, w.z);
          const water = new THREE.Mesh(new THREE.CircleGeometry(w.r * 0.42, 28), new THREE.MeshLambertMaterial({ color: 0x2f9ed0, emissive: 0x135a7a }));
          water.rotation.x = -Math.PI / 2;
          water.position.set(w.x, g + 1.45, w.z);
          this.site.add(pool, water);
        }
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(w.x, g + 1.2, w.z);
        ring.scale.setScalar(w.r);
        this.site.add(ring);
        const lab = new Label(`💧 ${w.name.toUpperCase()}`, '#2e7dd1', w.x, g, w.z);
        this.labels.push(lab);
        this.site.add(lab.sprite);
      }
    // the forest in the fire's path
    this.treeMesh = trees;
    if (trees) {
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const c = new THREE.Color();
      for (let i = 0; i < trees.count; i++) {
        trees.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const k = cellOf(f, p.x, p.z);
        if (k < 0) continue;
        trees.getColorAt(i, c);
        const hidden = ops.spec.threats.some((th) => th.icon !== '🆘' && Math.hypot(p.x - th.x, p.z - th.z) < th.r + 8);
        this.trees.push({ i, k, m: m.clone(), c: c.clone(), hidden });
      }
    }
    this.showForecast = false;
    this.texT = 0;
    this.treeT = 0;
    this.forecastT = 0;
    this.forecast = null;
    this.drawMap(0);
    this.updateTrees(0, true);
  }

  /** A little settlement: cabins round the ring's centre (a hut or a school is one bigger building). */
  private buildPlace(icon: string, x: number, z: number, r: number): void {
    const n = icon === '🏘️' ? 7 : icon === '⛺' ? 0 : 1;
    if (icon === '⛺') {
      const colors = [0xff8a1f, 0x2e7dd1, 0x22b35e, 0xffd23f, 0x8a5cff];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const tent = gable(3.4, 2, 3, colors[i]);
        this.site.add(place(tent, this.hf, x + Math.cos(a) * r * 0.45, z + Math.sin(a) * r * 0.45, a, 0.1));
      }
      return;
    }
    if (n === 1) {
      const big = icon === '🏫' ? house(16, 9, 5, 0xf3e3c3, 0x2e7dd1) : icon === '🛖' ? house(8, 6, 3.4, 0x8a6a4a, 0x5a3a2a) : house(10, 7, 4, 0xf3f1ea, 0xe23d28);
      this.site.add(place(big, this.hf, x, z, 0.3, 0.3));
      return;
    }
    const roofs = [0xe23d28, 0x8a5c3a, 0x2e7dd1, 0x6b6b6b, 0xb5462a];
    for (let i = 0; i < n; i++) {
      const a = i * 2.4;
      const d = i === 0 ? 0 : r * (0.35 + 0.18 * (i % 3));
      const h = house(7 + (i % 3), 6, 3.6, 0xf3f1ea, roofs[i % roofs.length]);
      this.site.add(place(h, this.hf, x + Math.cos(a) * d, z + Math.sin(a) * d, a, 0.3));
    }
  }

  clear(): void {
    this.restoreTrees();
    this.trees = [];
    if (this.ground) {
      this.group.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
      this.ground = null;
    }
    for (const l of this.labels) l.dispose();
    this.labels = [];
    this.rings = [];
    for (const c of [...this.site.children]) this.site.remove(c);
    for (const m of this.marks) this.group.remove(m);
    this.marks = [];
    this.smoke.clear();
    this.glow.clear();
    this.spray.clear();
    this.flames.count = 0;
    this.light.intensity = 0;
    this.preview.visible = false;
    this.target.visible = false;
    this.tanker42.group.visible = false;
    this.group.visible = false;
    this.fire = null;
    this.splashes = [];
  }

  // -------------------------------------------------------------- every frame
  update(dt: number, t: number, ops: FireOps, wind: FireWind, cam: THREE.PerspectiveCamera, viewH: number, forecast: boolean, fog: THREE.Fog): void {
    const f = ops.fire;
    if (f !== this.fire) return;
    this.showForecast = forecast;
    // the burn map: a few times a second (it flickers along the front)
    this.texT -= dt;
    if (this.texT <= 0) {
      this.texT = 0.12;
      this.drawMap(t);
    }
    if (forecast) {
      this.forecastT -= dt;
      if (this.forecastT <= 0) {
        this.forecastT = 2.5;
        this.updateForecast(wind);
      }
    }
    this.treeT -= dt;
    if (this.treeT <= 0) {
      this.treeT = 0.3;
      this.updateTrees(t, false);
    }
    // flames, the light over the fire, smoke and embers
    let burning = 0;
    let sx = 0;
    let sz = 0;
    let sy = 0;
    for (let k = 0; k < f.state.length; k++)
      if (f.state[k] === BURNING) {
        burning++;
        sx += cx(f, k);
        sz += cz(f, k);
        sy += f.height[k];
      }
    const stride = Math.max(1, Math.ceil(burning / FLAMES));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let c = 0;
    let seen = 0;
    const lean = Math.min(0.5, Math.hypot(wind.x, wind.z) * 0.04);
    const la = Math.atan2(wind.x, wind.z);
    const leanQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean * Math.cos(la), 0, -lean * Math.sin(la)));
    for (let k = 0; k < f.state.length && c < FLAMES; k++) {
      if (f.state[k] !== BURNING) continue;
      if (seen++ % stride) continue;
      const h1 = hash(k);
      const h2 = hash(k * 7 + 3);
      const I = f.heat[k];
      const fl = 0.75 + 0.25 * Math.sin(t * (8 + h1 * 6) + h2 * 6.28);
      const H = (5 + 14 * I * f.fuel[k] + 4 * h2) * fl * Math.min(1.6, Math.sqrt(stride));
      const R = (1.6 + 1.8 * h1) * Math.min(1.8, Math.sqrt(stride)) * (0.6 + 0.4 * I);
      p.set(cx(f, k) + (h1 - 0.5) * f.cell * 0.7, Math.max(0.3, f.height[k]) - 0.3, cz(f, k) + (h2 - 0.5) * f.cell * 0.7);
      q.copy(leanQ);
      s.set(R, H, R);
      m.compose(p, q, s);
      this.flames.setMatrixAt(c++, m);
    }
    this.flames.count = c;
    this.flames.instanceMatrix.needsUpdate = true;
    this.burning = burning;
    if (burning > 0) {
      this.center.set(sx / burning, sy / burning, sz / burning);
      this.light.position.set(sx / burning, sy / burning + 40, sz / burning);
      this.light.intensity = Math.min(3.2, 0.6 + burning / 120) * (0.85 + 0.15 * Math.sin(t * 11));
    } else this.light.intensity = Math.max(0, this.light.intensity - dt);
    // smoke rises from the fire; columns over the hottest parts
    this.emitT += dt;
    const rate = Math.min(60, 6 + burning * 0.18);
    while (this.emitT > 1 / rate && burning > 0) {
      this.emitT -= 1 / rate;
      const k = pickBurning(f, burning);
      if (k < 0) break;
      const x = cx(f, k) + (Math.random() - 0.5) * f.cell;
      const z = cz(f, k) + (Math.random() - 0.5) * f.cell;
      const y = Math.max(0, f.height[k]) + 6;
      const shade = 0.22 + Math.random() * 0.35;
      this.smoke.spawn({ x, y, z, vx: (Math.random() - 0.5) * 2, vy: 7 + Math.random() * 6, vz: (Math.random() - 0.5) * 2, life: 9 + Math.random() * 7, size: 9, grow: 46 + Math.random() * 30, r: shade + 0.08, g: shade + 0.05, b: shade, alpha: 0.75, drag: 0.35, fadeIn: 0.08 });
      if (Math.random() < 0.6) this.glow.spawn({ x, y: y - 3, z, vx: (Math.random() - 0.5) * 4, vy: 6 + Math.random() * 10, vz: (Math.random() - 0.5) * 4, life: 1.5 + Math.random() * 2.5, size: 1.1, grow: -0.6, r: 1, g: 0.55 + Math.random() * 0.3, b: 0.15, alpha: 1, drag: 0.4, fadeIn: 0 });
      if (Math.random() < 0.25) this.glow.spawn({ x, y: y - 4, z, life: 0.6 + Math.random() * 0.5, size: 14 + Math.random() * 10, grow: 6, r: 1, g: 0.45, b: 0.1, alpha: 0.45, fadeIn: 0.2, vy: 3 });
    }
    // a soaking splash where a drop lands
    for (const sp of this.splashes.splice(0)) this.spray.spawn({ x: sp.x, y: sp.y + 1, z: sp.z, vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 6, life: 1.6, size: 5, grow: 10, r: 0.92, g: 0.92, b: 0.95, alpha: 0.5, drag: 1.2, fadeIn: 0 });
    this.smoke.setFog(fog);
    this.glow.setFog(fog);
    this.spray.setFog(fog);
    this.smoke.update(dt, cam, viewH, wind, 0.9);
    this.glow.update(dt, cam, viewH, wind, 0.7);
    this.spray.update(dt, cam, viewH, wind, 0.25);
    // the places in danger: rings pulse redder as the fire closes in
    const danger = ops.threat;
    for (const r of this.rings) {
      const mm = r.mesh.material as THREE.MeshBasicMaterial;
      mm.color.setHex(danger > 0.6 ? 0xff3b30 : danger > 0.35 ? 0xff8a1f : 0xffd23f);
      mm.opacity = 0.65 + 0.35 * Math.sin(t * (3 + danger * 6));
    }
    for (const l of this.labels) l.update(cam, 26);
    // the spotter's marked lines, waiting for Tanker 42
    this.updateMarks(ops);
    this.updateTanker42(ops, t, dt);
  }

  /** The burn map: one pixel a cell. */
  private drawMap(t: number): void {
    const f = this.fire;
    const img = this.img;
    if (!f || !img) return;
    const d = img.data;
    for (let k = 0; k < f.state.length; k++) {
      const st = f.state[k];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (st === BURNING) {
        const fl = 0.8 + 0.2 * Math.sin(t * 13 + k * 1.7);
        r = 255;
        g = (90 + 130 * f.heat[k]) * fl;
        b = 20;
        a = 245;
      } else if (st === BURNT) {
        r = 34;
        g = 29;
        b = 27;
        a = 225;
      } else if (st === OUT) {
        r = 66;
        g = 66;
        b = 70;
        a = 215;
      } else if (f.heat[k] > 0.15) {
        // heating up: where it goes next
        r = 210;
        g = 110;
        b = 30;
        a = Math.min(160, 200 * f.heat[k]);
      }
      if (f.retardant[k] > 0.15) {
        const k2 = Math.min(1, f.retardant[k]);
        const base = st === UNBURNT ? 0 : 0.45;
        r = r * base + 214 * (1 - base);
        g = g * base + 48 * (1 - base);
        b = b * base + 58 * (1 - base);
        a = Math.max(a, 215 * k2);
      }
      if (f.wet[k] > 0.1 && st !== BURNING) {
        const w = f.wet[k];
        r = r * (1 - w * 0.6) + 60 * w * 0.6;
        g = g * (1 - w * 0.6) + 130 * w * 0.6;
        b = b * (1 - w * 0.6) + 210 * w * 0.6;
        a = Math.max(a, 110 * w);
      }
      if (this.showForecast && this.forecast && this.forecast[k] && st === UNBURNT) {
        // the forecast: hatched orange where it will have burned in a minute
        const i = k % f.n;
        const j = (k - i) / f.n;
        if ((i + j) % 3 === 0) {
          r = 255;
          g = 150;
          b = 40;
          a = Math.max(a, 150);
        }
      }
      d[k * 4] = r;
      d[k * 4 + 1] = g;
      d[k * 4 + 2] = b;
      d[k * 4 + 3] = a;
    }
    this.ctx.putImageData(img, 0, 0);
    this.tex.needsUpdate = true;
  }

  private updateForecast(wind: FireWind): void {
    const f = this.fire;
    if (!f) return;
    const g = cloneFire(f);
    g.acc = 0;
    for (let s = 0; s < 60; s += 1) stepFire(g, wind, 1);
    const out = new Uint8Array(f.state.length);
    for (let k = 0; k < out.length; k++) out[k] = f.state[k] === UNBURNT && g.state[k] !== UNBURNT ? 1 : 0;
    this.forecast = out;
    const ctx = this.forecastCanvas.getContext('2d')!;
    const img = ctx.createImageData(f.n, f.n);
    for (let k = 0; k < out.length; k++)
      if (out[k]) {
        img.data[k * 4] = 255;
        img.data[k * 4 + 1] = 150;
        img.data[k * 4 + 2] = 40;
        img.data[k * 4 + 3] = 150;
      }
    ctx.putImageData(img, 0, 0);
  }

  /** Has a forecast been drawn yet. */
  get hasForecast(): boolean {
    return this.showForecast && !!this.forecast;
  }

  private updateTrees(t: number, force: boolean): void {
    const f = this.fire;
    const tm = this.treeMesh;
    if (!f || !tm) return;
    const c = new THREE.Color();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let colors = false;
    let mats = false;
    const ember = new THREE.Color(0x7a2a0c);
    const flame = new THREE.Color(0xff6a1a);
    const char = new THREE.Color(0x1e1a18);
    const ash = new THREE.Color(0x3a3634);
    const pink = new THREE.Color(0xc2443a);
    for (const tr of this.trees) {
      if (tr.hidden) {
        if (force) {
          tr.m.decompose(p, q, s);
          m.compose(p, q, s.set(0, 0, 0));
          tm.setMatrixAt(tr.i, m);
          mats = true;
        }
        continue;
      }
      const st = f.state[tr.k];
      if (st === BURNING) {
        c.copy(ember).lerp(flame, 0.35 + 0.35 * Math.sin(t * 9 + tr.i));
        colors = true;
      } else if (st === BURNT || st === OUT) {
        c.copy(st === BURNT ? char : ash);
        colors = true;
        // burned through: a bare, black spike
        tr.m.decompose(p, q, s);
        m.compose(p, q, s.set(s.x * 0.38, s.y * 0.85, s.z * 0.38));
        tm.setMatrixAt(tr.i, m);
        mats = true;
      } else if (f.retardant[tr.k] > 0.5) {
        c.copy(tr.c).lerp(pink, 0.6);
        colors = true;
      } else if (f.heat[tr.k] > 0.4) {
        c.copy(tr.c).lerp(ember, f.heat[tr.k] * 0.6);
        colors = true;
      } else if (force) {
        c.copy(tr.c);
        colors = true;
      } else continue;
      tm.setColorAt(tr.i, c);
    }
    if (colors && tm.instanceColor) tm.instanceColor.needsUpdate = true;
    if (mats) tm.instanceMatrix.needsUpdate = true;
  }

  private restoreTrees(): void {
    const tm = this.treeMesh;
    if (!tm || !this.trees.length) return;
    for (const tr of this.trees) {
      tm.setMatrixAt(tr.i, tr.m);
      tm.setColorAt(tr.i, tr.c);
    }
    tm.instanceMatrix.needsUpdate = true;
    if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
  }

  // -------------------------------------------------------------- the drops
  /** Retardant pouring from a tank (call every frame while it drops). */
  pourRetardant(at: THREE.Vector3, vel: { x: number; z: number }, dt: number): void {
    const g = Math.max(0, this.hf.sample(at.x, at.z));
    const n = Math.ceil(dt * 260);
    for (let i = 0; i < n; i++) {
      const sp = 1 + Math.random() * 1.5;
      this.spray.spawn({
        x: at.x + (Math.random() - 0.5) * 3,
        y: at.y - Math.random() * 2,
        z: at.z + (Math.random() - 0.5) * 3,
        vx: vel.x * 0.75 + (Math.random() - 0.5) * 10 * sp,
        vy: -4 - Math.random() * 6,
        vz: vel.z * 0.75 + (Math.random() - 0.5) * 10 * sp,
        life: 6,
        size: 4 + Math.random() * 4,
        grow: 16,
        r: 0.86,
        g: 0.2 + Math.random() * 0.12,
        b: 0.18 + Math.random() * 0.1,
        alpha: 0.85,
        gravity: 9,
        drag: 0.9,
        fadeIn: 0,
        floor: g + 1,
      });
    }
  }

  /** A bucket's worth of water let go at once. */
  dumpWater(at: THREE.Vector3, vel: { x: number; z: number }): void {
    const g = Math.max(0, this.hf.sample(at.x, at.z));
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * 5;
      this.spray.spawn({ x: at.x, y: at.y - 1, z: at.z, vx: vel.x + Math.cos(a) * sp, vy: -2 - Math.random() * 5, vz: vel.z + Math.sin(a) * sp, life: 4, size: 2.5 + Math.random() * 3, grow: 9, r: 0.82, g: 0.92, b: 1, alpha: 0.8, gravity: 11, drag: 0.6, fadeIn: 0, floor: g + 1 });
    }
  }

  /** Steam off the fire when water hits it. */
  steam(x: number, z: number, r: number): void {
    const g = Math.max(0, this.hf.sample(x, z));
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r;
      this.smoke.spawn({ x: x + Math.cos(a) * d, y: g + 3, z: z + Math.sin(a) * d, vy: 5 + Math.random() * 6, life: 4 + Math.random() * 3, size: 8, grow: 26, r: 0.95, g: 0.95, b: 0.97, alpha: 0.7, drag: 0.5, fadeIn: 0.1 });
    }
  }

  /** The bucket dips: spray at the surface. */
  scoopSpray(at: THREE.Vector3): void {
    for (let i = 0; i < 3; i++) this.spray.spawn({ x: at.x + (Math.random() - 0.5) * 3, y: at.y, z: at.z + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, life: 1.2, size: 2, grow: 4, r: 0.85, g: 0.93, b: 1, alpha: 0.7, gravity: 9, drag: 0.5, fadeIn: 0 });
  }

  /** The spotter's marking smoke. */
  markSmoke(at: THREE.Vector3): void {
    this.smoke.spawn({ x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5), vy: -1, vz: (Math.random() - 0.5), life: 6, size: 3, grow: 12, r: 1, g: 1, b: 1, alpha: 0.85, drag: 0.6, fadeIn: 0 });
  }

  /**
   * Where the drop will land, shown before you press: a red strip along
   * your heading for a line, a blue ring for a bucket. `armed`: in range.
   */
  showPreview(kind: 'line' | 'call' | 'water' | null, x: number, z: number, dirx: number, dirz: number, armed: boolean): void {
    this.preview.visible = kind === 'line' || kind === 'call';
    this.target.visible = kind === 'water';
    if (kind === 'water') {
      this.target.position.set(x, Math.max(0, this.hf.sample(x, z)) + 2, z);
      this.target.scale.setScalar(WATER_R);
      (this.target.material as THREE.MeshBasicMaterial).color.setHex(armed ? 0x5fd0ff : 0xb8c4cc);
      return;
    }
    if (!this.preview.visible) return;
    const len = kind === 'call' ? CALL_LEN : LINE_LEN;
    const half = LINE_WIDTH / 2;
    const px = -dirz;
    const pz = dirx;
    for (let i = 0; i <= 24; i++) {
      const d = 12 + (i / 24) * len;
      const sx = x + dirx * d;
      const sz = z + dirz * d;
      for (const [k, sgn] of [
        [0, 1],
        [1, -1],
      ] as const) {
        const vx = sx + px * half * sgn;
        const vz = sz + pz * half * sgn;
        this.previewPos.set([vx, Math.max(0.3, this.hf.sample(vx, vz)) + 2.2, vz], (i * 2 + k) * 3);
      }
    }
    (this.preview.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.preview.geometry.computeBoundingSphere();
    const mm = this.preview.material as THREE.MeshBasicMaterial;
    mm.color.setHex(!armed ? 0xb8c4cc : kind === 'call' ? 0xffd23f : 0xff3b30);
    mm.opacity = armed ? 0.42 : 0.22;
  }

  private updateMarks(ops: FireOps): void {
    const want = ops.calls.filter((c) => c.painted < c.len);
    const marking = ops.marking ? [ops.marking.pts] : [];
    const all = [...want.map((c) => c.pts), ...marking];
    while (this.marks.length > all.length) this.group.remove(this.marks.pop()!);
    all.forEach((pts, i) => {
      let m = this.marks[i];
      if (!m || (m.userData.n as number) !== pts.length) {
        if (m) this.group.remove(m);
        m = this.ribbon(pts);
        this.marks[i] = m;
        this.group.add(m);
      }
      (m.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.25 * Math.sin(performance.now() / 150);
    });
  }

  private ribbon(pts: [number, number][]): THREE.Mesh {
    const verts: number[] = [];
    const idx: number[] = [];
    const half = LINE_WIDTH / 2;
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i];
      const [ax, az] = pts[Math.max(0, i - 1)];
      const [bx, bz] = pts[Math.min(pts.length - 1, i + 1)];
      let dx = bx - ax;
      let dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      for (const sgn of [1, -1]) {
        const vx = x - dz * half * sgn;
        const vz = z + dx * half * sgn;
        verts.push(vx, Math.max(0.3, this.hf.sample(vx, vz)) + 2.4, vz);
      }
      if (i < pts.length - 1) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.n = pts.length;
    m.renderOrder = 6;
    return m;
  }

  /** Tanker 42: in on the line from behind, down it pouring, then away and up. */
  private updateTanker42(ops: FireOps, t: number, dt: number): void {
    const runT = this.runTime;
    const call = ops.calls.find((c) => runT > c.at - 14 && runT < c.at + c.len / CALL_SPEED + 10);
    const pl = this.tanker42;
    if (!call) {
      pl.group.visible = false;
      return;
    }
    pl.group.visible = true;
    const s = (runT - call.at) * CALL_SPEED;
    const a = along(call.pts, Math.max(0, Math.min(call.len, s)));
    let x = a.x + a.dx * Math.min(0, s);
    let z = a.z + a.dz * Math.min(0, s);
    const over = Math.max(0, s - call.len);
    x += a.dx * over;
    z += a.dz * over;
    const g = Math.max(this.hf.sample(x, z), this.hf.sample(x + a.dx * 60, z + a.dz * 60));
    const y = g + 55 + (s < 0 ? -s * 0.15 : 0) + over * 0.35;
    const yaw = Math.atan2(-a.dx, -a.dz);
    pl.sync({ x, y, z, yaw, pitch: over > 0 ? 0.2 : s < 0 ? -0.06 : 0, roll: 0, speed: 55, throttle: 1, agl: 55, terrainWarning: false, boundaryWarning: false }, t, dt);
    if (s >= 0 && s <= call.len) {
      const b = pl.bellyWorld(new THREE.Vector3());
      this.pourRetardant(b, { x: a.dx * CALL_SPEED, z: a.dz * CALL_SPEED }, dt);
    }
  }

  /** Mission time (the game sets it each frame, for Tanker 42's timing). */
  runTime = 0;
  /** Burning cells, and the middle of them, as of the last frame. */
  burning = 0;
  readonly center = new THREE.Vector3();
}

const cx = (f: FireState, k: number) => f.x0 + ((k % f.n) + 0.5) * f.cell;
const cz = (f: FireState, k: number) => f.z0 + (Math.floor(k / f.n) + 0.5) * f.cell;
const cellOf = (f: FireState, x: number, z: number) => {
  const i = Math.floor((x - f.x0) / f.cell);
  const j = Math.floor((z - f.z0) / f.cell);
  return i < 0 || j < 0 || i >= f.n || j >= f.n ? -1 : j * f.n + i;
};
const hash = (k: number) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function pickBurning(f: FireState, burning: number): number {
  // a random burning cell, without a list: walk from a random start
  let k = Math.floor(Math.random() * f.state.length);
  for (let i = 0; i < f.state.length && burning > 0; i++) {
    if (f.state[k] === BURNING) return k;
    k = (k + 97) % f.state.length;
  }
  return -1;
}
