import * as THREE from 'three';
import { rng } from '../core/math';

/**
 * Weather as the antagonist: storm cells that look like they will hurt you,
 * and the smoke an airframe trails once they have.
 *
 * A storm cell is a towering stack of faceted cloud (dark, flat-shaded, the
 * same low-poly language as the terrain) with an anvil top, a curtain of
 * falling rain, and lightning that lights the cloud from inside.
 */
const CLOUD = new THREE.Color(0x6a7080);
const CLOUD_LIT = new THREE.Color(0xc9d8ff);

function boltGeometry(seed: number): THREE.BufferGeometry {
  // a jagged path from y = 0 (the strike point) up to y = 1 (the cloud), drawn as a thin ribbon tube
  const r = rng(seed);
  const pts: THREE.Vector3[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const j = i === 0 || i === n ? 0 : 0.3;
    pts.push(new THREE.Vector3((r() - 0.5) * j, k, (r() - 0.5) * j));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 24, 0.022, 4, false);
}

export class StormCell {
  readonly group = new THREE.Group();
  private cloudMat: THREE.MeshLambertMaterial;
  private rainMat: THREE.ShaderMaterial;
  private bolt: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private bolts: THREE.BufferGeometry[];
  private flash = 0;
  private nextFlash: number;
  private rand: () => number;
  private puffs = new THREE.Group();

  constructor(
    readonly r: number,
    seed: number,
  ) {
    this.rand = rng(seed);
    const R = this.rand;
    this.cloudMat = new THREE.MeshLambertMaterial({ color: CLOUD, flatShading: true, emissive: new THREE.Color(0x000000) });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    // the column: puffs climbing and widening into an anvil
    const add = (x: number, y: number, z: number, s: number) => {
      const m = new THREE.Mesh(geo, this.cloudMat);
      m.position.set(x, y, z);
      m.scale.set(s * (1 + R() * 0.3), s * (0.7 + R() * 0.3), s * (1 + R() * 0.3));
      m.rotation.set(R() * 3, R() * 3, R() * 3);
      this.puffs.add(m);
    };
    for (let i = 0; i < 22; i++) {
      const a = R() * Math.PI * 2;
      const d = r * (0.2 + R() * 0.5);
      add(Math.cos(a) * d, 250 + R() * 330, Math.sin(a) * d, r * (0.32 + R() * 0.22));
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + R() * 0.3;
      const d = r * (0.75 + R() * 0.45);
      add(Math.cos(a) * d, 600 + R() * 60, Math.sin(a) * d, r * (0.28 + R() * 0.18));
    }
    // the base: low, heavy, ragged
    for (let i = 0; i < 10; i++) {
      const a = R() * Math.PI * 2;
      const d = r * (0.5 + R() * 0.45);
      add(Math.cos(a) * d, 230 + R() * 40, Math.sin(a) * d, r * (0.22 + R() * 0.14));
    }
    this.group.add(this.puffs);

    // a dark shaft under the cloud so the cell reads from across the basin
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.9, r * 0.95, 260, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x22262e, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }),
    );
    shaft.position.y = 125;
    this.group.add(shaft);

    // rain: streaks falling down a curtain inside the shaft
    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(float n){ return fract(sin(n) * 43758.5453); }
        void main(){
          float col = floor(vUv.x * 900.0);
          float thin = step(fract(vUv.x * 900.0), 0.18);
          float on = step(0.4, h(col)) * thin;
          float f = fract(vUv.y * 9.0 + uTime * (1.6 + h(col + 7.0)) + h(col + 3.0));
          float streak = smoothstep(0.88, 1.0, f) * on;
          float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          gl_FragColor = vec4(vec3(0.78, 0.83, 0.9), streak * fade * 0.55);
        }`,
    });
    const rain = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.85, 250, 32, 1, true), this.rainMat);
    rain.position.y = 120;
    this.group.add(rain);

    // lightning
    this.bolts = [1, 2, 3].map((k) => boltGeometry(seed * 7 + k));
    this.bolt = new THREE.Mesh(this.bolts[0], new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.bolt.visible = false;
    this.group.add(this.bolt);
    this.nextFlash = 0.5 + R() * 2.5;
  }

  /** Lightning inside the cell; `at` (local x, y, z) sends the bolt there, otherwise to the ground. */
  strike(at?: { x: number; y: number; z: number }): void {
    const R = this.rand;
    this.bolt.geometry = this.bolts[Math.floor(R() * this.bolts.length)];
    if (at) {
      // from the cloud base down to the aircraft
      this.bolt.position.set(at.x, at.y, at.z);
      this.bolt.scale.set(70, Math.max(40, 300 - at.y), 70);
    } else {
      const a = R() * Math.PI * 2;
      const d = this.r * R() * 0.7;
      this.bolt.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      this.bolt.scale.set(90, 290, 90);
    }
    this.bolt.rotation.y = R() * Math.PI * 2;
    this.flash = 1;
  }

  animate(t: number, dt: number): void {
    this.puffs.rotation.y = t * 0.04;
    this.rainMat.uniforms.uTime.value = t;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.strike();
      this.nextFlash = 1.2 + this.rand() * 3.5;
    }
    this.flash = Math.max(0, this.flash - dt * 5);
    // the cloud lights up from inside, the bolt flickers out
    this.cloudMat.emissive.copy(CLOUD_LIT).multiplyScalar(this.flash * 0.55);
    this.bolt.visible = this.flash > 0.25;
    this.bolt.material.opacity = Math.min(1, this.flash * 1.5) * (0.6 + 0.4 * Math.sin(t * 90));
  }
}

/** Smoke puffs trailing a damaged airframe: thicker and darker the worse it is. */
export class SmokeTrail {
  readonly group = new THREE.Group();
  private puffs: { m: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshLambertMaterial>; age: number; life: number }[] = [];
  private acc = 0;
  private next = 0;

  constructor(count = 48) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a4744, transparent: true, opacity: 0, depthWrite: false, flatShading: true }));
      m.visible = false;
      this.group.add(m);
      this.puffs.push({ m, age: 1, life: 1 });
    }
  }

  /** Emit behind the aircraft at (x, y, z) heading (fx, fz); damage 0..1. */
  update(dt: number, x: number, y: number, z: number, fx: number, fz: number, damage: number): void {
    const rate = damage < 0.2 ? 0 : 5 + 22 * damage;
    this.acc += dt * rate;
    while (this.acc >= 1) {
      this.acc -= 1;
      const p = this.puffs[this.next];
      this.next = (this.next + 1) % this.puffs.length;
      p.age = 0;
      p.life = 1.6 + damage * 1.6;
      p.m.position.set(x - fx * 6 + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, z - fz * 6 + (Math.random() - 0.5) * 2);
      p.m.material.color.setHex(damage > 0.6 ? 0x2a2826 : 0x5a5753);
      p.m.visible = true;
    }
    for (const p of this.puffs) {
      if (!p.m.visible) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) {
        p.m.visible = false;
        continue;
      }
      p.m.scale.setScalar(1.5 + k * 7);
      p.m.position.y += dt * 2;
      p.m.material.opacity = 0.55 * (1 - k);
    }
  }

  clear(): void {
    for (const p of this.puffs) p.m.visible = false;
    this.acc = 0;
  }
}
