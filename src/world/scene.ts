import * as THREE from 'three';
import { clamp, fbm, rng } from '../core/math';
import { forestAt, getHeightField, type HeightField } from './terrain';
import { tintFarmland } from './countryside';
import { ROADS, RUNWAY, WATER_LEVEL, WORLD_HALF, WORLD_SIZE, type Pt } from './worldData';

export const PALETTE = {
  skyTop: 0x6d8fbf,
  skyHorizon: 0xe6d4b4,
  fog: 0xd8c8ab,
  sun: 0xffe2b8,
  water: 0x3a6f7c,
  earth: 0x5a4632,
};

export interface SceneBundle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  terrain: THREE.Mesh;
  heightField: HeightField;
  clouds: THREE.Group;
  update(dt: number, t: number): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(PALETTE.fog, 650, 2300);

  const camera = new THREE.PerspectiveCamera(62, 1, 1, 4200);

  // sky dome: simple gradient shader with a warm sun glow
  const skyGeo = new THREE.SphereGeometry(3800, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) },
      horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      sunDir: { value: new THREE.Vector3(-0.55, 0.32, -0.77).normalize() },
      sunColor: { value: new THREE.Color(0xffd9a0) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.05, 1.0); float t = pow(smoothstep(-0.05, 0.7, h), 0.6);
        vec3 c = mix(horizon, top, t); float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += sunColor * (pow(s, 24.0) * 0.5 + pow(s, 4.0) * 0.12); gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // lighting: warm low sun + hemisphere fill, no shadows (mobile)
  const hemi = new THREE.HemisphereLight(0xbcd0ea, 0x6b5a3e, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.65);
  sun.position.set(-550, 330, -770);
  scene.add(sun);

  const heightField = getHeightField();
  const terrain = buildTerrain(heightField);
  scene.add(terrain);
  scene.add(buildSkirt(heightField));
  scene.add(buildWater());
  scene.add(buildRoads(heightField));
  scene.add(buildRunway(heightField));
  const clouds = buildClouds();
  scene.add(clouds);

  const update = (dt: number, _t: number): void => {
    for (const c of clouds.children) {
      c.position.x += dt * 2.2;
      if (c.position.x > WORLD_HALF + 500) c.position.x = -WORLD_HALF - 500;
    }
    sky.position.copy(camera.position);
  };

  return { renderer, scene, camera, terrain, heightField, clouds, update };
}

function buildTerrain(hf: HeightField): THREE.Mesh {
  const seg = 240;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grassLow = new THREE.Color(0x67903f);
  const meadow = new THREE.Color(0x93a94c);
  const upland = new THREE.Color(0xb7a65c);
  const rock = new THREE.Color(0x7e766a);
  const crest = new THREE.Color(0x938b80);
  const sand = new THREE.Color(0xc4b58c);
  const forestFloor = new THREE.Color(0x40602e);
  const scratch = new THREE.Color();
  const marsh = new THREE.Color(0x5b7a44);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = hf.sample(x, z);
    pos.setY(i, h);
    const n = hf.normal(x, z);
    const slope = 1 - n[1];
    const f = forestAt(x, z);
    const v = fbm(x / 90, z / 90, 2) * 0.5 + 0.5;
    if (h < 2.5) c.copy(sand);
    else if (h < 7) c.copy(marsh).lerp(sand, 0.3);
    else {
      const t = clamp((h - 7) / 110, 0, 1);
      c.copy(grassLow).lerp(meadow, clamp(v * 1.4, 0, 1)).lerp(upland, Math.pow(t, 1.3));
      if (h > 150) c.lerp(crest, clamp((h - 150) / 80, 0, 1));
    }
    // the patchwork of fields on the open lowland
    if (h >= 7) tintFarmland(x, z, h, slope, c, scratch);
    c.lerp(rock, clamp((slope - 0.12) * 3.2, 0, 1));
    c.lerp(forestFloor, f * 0.8);
    // gentle valley shading for a diorama feel
    c.multiplyScalar(0.92 + 0.12 * clamp(h / 120, 0, 1));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  return mesh;
}

/** The cut edge of the terrain model, like a diorama table. */
function buildSkirt(hf: HeightField): THREE.Mesh {
  const n = 96;
  const verts: number[] = [];
  const idx: number[] = [];
  const edge = (fx: (t: number) => number, fz: (t: number) => number) => {
    const base = verts.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = fx(t);
      const z = fz(t);
      verts.push(x, hf.sample(x, z) + 0.2, z, x, -90, z);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const H = WORLD_HALF;
  edge((t) => -H + t * 2 * H, () => -H);
  edge(() => H, (t) => -H + t * 2 * H);
  edge((t) => H - t * 2 * H, () => H);
  edge(() => -H, (t) => H - t * 2 * H);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.earth, side: THREE.DoubleSide });
  return new THREE.Mesh(geo, mat);
}

function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.9, emissive: 0x1d3a44, emissiveIntensity: 0.5 });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = WATER_LEVEL;
  return m;
}

function ribbon(pts: readonly Pt[], width: number, hf: HeightField, lift: number, color: number, opacity = 1): THREE.Mesh {
  // subdivide the polyline so the ribbon drapes over terrain
  const samples: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 8));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      samples.push([ax + (bx - ax) * t, az + (bz - az) * t]);
    }
  }
  samples.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const [x, z] = samples[i];
    const [px, pz] = samples[Math.max(0, i - 1)];
    const [nx, nz] = samples[Math.min(samples.length - 1, i + 1)];
    let dx = nx - px;
    let dz = nz - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const ox = -dz * width * 0.5;
    const oz = dx * width * 0.5;
    verts.push(x + ox, hf.sample(x + ox, z + oz) + lift, z + oz, x - ox, hf.sample(x - ox, z - oz) + lift, z - oz);
    if (i < samples.length - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  return new THREE.Mesh(geo, mat);
}

function buildRoads(hf: HeightField): THREE.Group {
  const g = new THREE.Group();
  for (const r of ROADS) {
    const color = r.kind === 'road' ? 0xa28c66 : r.kind === 'haul' ? 0x8f9a66 : 0x857c5a;
    const opacity = r.kind === 'road' ? 1 : r.kind === 'haul' ? 0.85 : 0.7;
    g.add(ribbon(r.pts, r.width, hf, 0.45, color, opacity));
  }
  return g;
}

function buildRunway(hf: HeightField): THREE.Group {
  const g = new THREE.Group();
  const strip = ribbon(
    [
      [RUNWAY.x1, RUNWAY.z],
      [RUNWAY.x2, RUNWAY.z],
    ],
    RUNWAY.width,
    hf,
    0.5,
    0x5c5a55,
  );
  g.add(strip);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8e2cf });
  for (let x = RUNWAY.x1 + 12; x < RUNWAY.x2 - 8; x += 18) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 0.9), dashMat);
    d.position.set(x, hf.sample(x, RUNWAY.z) + 0.75, RUNWAY.z);
    g.add(d);
  }
  return g;
}

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const r = rng(99);
  for (let i = 0; i < 14; i++) {
    const x = 30 + r() * 68;
    const y = 40 + r() * 48;
    const rad = 18 + r() * 24;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,250,240,0.55)');
    grd.addColorStop(1, 'rgba(255,250,240,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildClouds(): THREE.Group {
  const g = new THREE.Group();
  const tex = cloudTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85, fog: true });
  const r = rng(7);
  for (let i = 0; i < 16; i++) {
    const w = 220 + r() * 260;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.6), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set((r() - 0.5) * 3400, 430 + r() * 140, (r() - 0.5) * 3000);
    m.rotation.z = r() * Math.PI;
    g.add(m);
  }
  return g;
}
