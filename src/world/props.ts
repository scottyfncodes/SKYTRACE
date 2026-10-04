import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/math';
import { forestAt, type HeightField } from './terrain';
import { BASE, FORESTS, VILLAGE_HOUSES } from './worldData';

const matCache = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number, extra?: Partial<THREE.MeshLambertMaterialParameters>): THREE.MeshLambertMaterial {
  if (extra) return new THREE.MeshLambertMaterial({ color, ...extra });
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

export function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.y = h / 2;
  return m;
}

/** Gable roof: a triangular prism lying along the x axis. */
export function gable(w: number, h: number, d: number, color: number): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(-w / 2, 0, 0);
  const m = new THREE.Mesh(geo, mat(color));
  return m;
}

export function house(w: number, d: number, wallH: number, wall: number, roof: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, wallH, d, wall));
  const r = gable(w + 0.6, wallH * 0.6, d + 0.6, roof);
  r.position.y = wallH;
  g.add(r);
  return g;
}

export function place(obj: THREE.Object3D, hf: HeightField, x: number, z: number, rotY = 0, sink = 0.2): THREE.Object3D {
  obj.position.set(x, hf.sample(x, z) - sink, z);
  obj.rotation.y = rotY;
  return obj;
}

// ---------------- trees ----------------
export function buildTrees(hf: HeightField): THREE.InstancedMesh {
  const canopy = new THREE.ConeGeometry(1, 1, 6);
  canopy.translate(0, 0.5, 0);
  const cCol = new Float32Array(canopy.attributes.position.count * 3).fill(1);
  canopy.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
  const trunk = new THREE.CylinderGeometry(0.1, 0.14, 0.25, 5);
  trunk.translate(0, 0.12, 0);
  const tCol = new Float32Array(trunk.attributes.position.count * 3);
  for (let i = 0; i < trunk.attributes.position.count; i++) {
    tCol[i * 3] = 0.35;
    tCol[i * 3 + 1] = 0.26;
    tCol[i * 3 + 2] = 0.18;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const geo = mergeGeometries([trunk, canopy], false)!;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  // candidate positions on a jittered grid inside forest bounds
  const r = rng(4242);
  const spots: { x: number; z: number; d: number }[] = [];
  const spacing = 12;
  for (const f of FORESTS) {
    const R = f.r * 1.15;
    for (let z = f.z - R; z <= f.z + R; z += spacing) {
      for (let x = f.x - R; x <= f.x + R; x += spacing) {
        const jx = x + (r() - 0.5) * spacing;
        const jz = z + (r() - 0.5) * spacing;
        if (Math.abs(jx) > 1190 || Math.abs(jz) > 1190) continue;
        const d = forestAt(jx, jz);
        if (d > 0.12 && r() < d * 0.95) spots.push({ x: jx, z: jz, d });
      }
    }
  }
  // de-duplicate overlapping forests roughly by capping count
  const MAX = 7200;
  const chosen = spots.length > MAX ? spots.filter((_, i) => i % Math.ceil(spots.length / MAX) === 0) : spots;
  const mesh = new THREE.InstancedMesh(geo, material, chosen.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const dark = new THREE.Color(0x2d5428);
  const light = new THREE.Color(0x5a8a3a);
  const autumn = new THREE.Color(0x8a7a30);
  chosen.forEach((sp, i) => {
    const h = 8 + r() * 9;
    const w = 3 + r() * 2.2 + h * 0.12;
    p.set(sp.x, hf.sample(sp.x, sp.z) - 0.3, sp.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    s.set(w, h, w);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    col.copy(dark).lerp(light, r()).lerp(autumn, r() < 0.12 ? 0.6 : 0);
    col.multiplyScalar(0.85 + 0.3 * sp.d);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------- structures ----------------
export interface WorldProps {
  group: THREE.Group;
  towerLight: THREE.Mesh;
  smokes: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number; rate: number }[];
  windsock: THREE.Mesh;
  shedDoor: THREE.Mesh;
}

export function buildProps(hf: HeightField): WorldProps {
  const g = new THREE.Group();
  const smokes: WorldProps['smokes'] = [];
  const r = rng(77);

  // ---- base airfield ----
  const hangar = new THREE.Group();
  hangar.add(box(26, 7, 18, 0x6f7368));
  const hr = gable(27, 4, 19, 0x4f5450);
  hr.position.y = 7;
  hangar.add(hr);
  g.add(place(hangar, hf, BASE.x - 40, BASE.z - 40));
  const hut = house(9, 7, 3.2, 0xbfb49a, 0x6a5c48);
  g.add(place(hut, hf, BASE.x + 30, BASE.z - 34));
  const towerHut = new THREE.Group();
  towerHut.add(box(4, 9, 4, 0x8c8a80));
  const cab = box(6, 3, 6, 0x3e5d70);
  cab.position.y = 10.5;
  towerHut.add(cab);
  g.add(place(towerHut, hf, BASE.x + 55, BASE.z - 36));
  const pole = box(0.3, 8, 0.3, 0xcfcfcf);
  const windsock = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 6), mat(0xe2622b));
  windsock.rotation.z = Math.PI / 2;
  windsock.position.set(2.2, 7.6, 0);
  const ws = new THREE.Group();
  ws.add(pole, windsock);
  g.add(place(ws, hf, BASE.x - 70, BASE.z + 24));
  for (let i = 0; i < 5; i++) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.3, 8), mat(0x9a3b2f));
    drum.position.y = 0.65;
    g.add(place(drum, hf, BASE.x + 20 + i * 1.8, BASE.z - 24));
  }

  // ---- village ----
  VILLAGE_HOUSES.forEach(([x, z], i) => {
    const h = house(8 + r() * 4, 6 + r() * 3, 3 + r(), [0xcbbfa3, 0xb9a98a, 0xd8cfb4][i % 3], [0x6b4e3a, 0x7a5a44, 0x5c4a3d][i % 3]);
    g.add(place(h, hf, x, z, r() * Math.PI));
    if (i === 1 || i === 4) {
      const chimney = box(0.8, 2, 0.8, 0x6b5a4a);
      chimney.position.set(2, 5, 0);
      h.add(chimney);
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 5), new THREE.MeshLambertMaterial({ color: 0xd9d4c8, transparent: true, opacity: 0.5 }));
      g.add(puff);
      smokes.push({ mesh: puff, base: new THREE.Vector3(x + 2, hf.sample(x, z) + 6, z), phase: r() * 6, rate: 0.35 });
    }
  });
  const chapel = house(7, 12, 5, 0xb5ab95, 0x4e4a46);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 4), mat(0x4e4a46));
  spire.position.set(0, 10.5, -4.5);
  chapel.add(spire);
  const spireBase = box(3, 8, 3, 0xb5ab95);
  spireBase.position.set(0, 0, -4.5);
  chapel.add(spireBase);
  g.add(place(chapel, hf, -250, 600, 0.3));

  // ---- quarry ----
  const qy = 720;
  const qz = 380;
  const gravel = new THREE.Mesh(new THREE.CircleGeometry(120, 24), mat(0xcdbf9f));
  gravel.rotation.x = -Math.PI / 2;
  g.add(place(gravel, hf, qy, qz, 0, -0.6));
  const crusher = new THREE.Group();
  crusher.add(box(8, 22, 8, 0x7a6f5e));
  const conveyor = box(30, 1.2, 2, 0x5a5047);
  conveyor.position.set(16, 14, 0);
  conveyor.rotation.z = 0.35;
  crusher.add(conveyor);
  g.add(place(crusher, hf, qy + 40, qz - 30, 0.4));
  for (let i = 0; i < 2; i++) {
    const shed = new THREE.Group();
    const roof = box(22, 0.6, 12, 0x6f5f4c);
    roof.position.y = 5;
    shed.add(roof);
    for (const [px, pz] of [
      [-10, -5],
      [10, -5],
      [-10, 5],
      [10, 5],
    ]) {
      const post = box(0.5, 5, 0.5, 0x5a4a3a);
      post.position.set(px, 0, pz);
      shed.add(post);
    }
    const back = box(22, 5, 0.4, 0x7d6c57);
    back.position.z = -6;
    shed.add(back);
    // vehicles parked under cover
    const v = box(5.5, 2.2, 2.4, i === 0 ? 0x3c4a52 : 0x4a4a3c);
    v.position.set(-4 + i * 7, 0, 0);
    shed.add(v);
    g.add(place(shed, hf, qy - 50 + i * 36, qz + 40, i * 0.2));
  }
  const spoil = new THREE.Mesh(new THREE.ConeGeometry(30, 16, 10), mat(0xd3c7a8));
  spoil.position.y = 7;
  g.add(place(spoil, hf, qy + 70, qz + 50));

  // ---- Keld Forest shed ----
  const shed = new THREE.Group();
  shed.add(box(40, 6, 12, 0x4c4a44));
  const shedRoof = gable(41, 3, 13, 0x7b7f82);
  shedRoof.position.y = 6;
  shed.add(shedRoof);
  const shedDoor = box(5, 4.5, 0.4, 0x2d2b28);
  shedDoor.position.set(14, 0, 6.2);
  shed.add(shedDoor);
  g.add(place(shed, hf, 240, -170, 0.35));

  // ---- ridge relay tower ----
  const tower = new THREE.Group();
  const legMat = mat(0x8b8f93);
  for (const [lx, lz] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 42, 5), legMat);
    leg.position.set(lx * 0.6, 21, lz * 0.6);
    leg.rotation.z = -lx * 0.03;
    leg.rotation.x = lz * 0.03;
    tower.add(leg);
  }
  for (let y = 6; y < 42; y += 7) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4 - y * 0.03, 0.12, 4, 4), legMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    tower.add(ring);
  }
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 12), mat(0xd6d2c4));
  dish.rotation.x = Math.PI / 2;
  dish.position.set(0, 36, 2.4);
  tower.add(dish);
  const towerLight = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
  towerLight.position.y = 43;
  tower.add(towerLight);
  const towerHutB = box(5, 3, 4, 0x8a8a80);
  towerHutB.position.set(6, 0, 0);
  tower.add(towerHutB);
  g.add(place(tower, hf, -120, -640));

  // ---- Blackwater adit ----
  const mine = new THREE.Group();
  const frameL = box(1.2, 6, 1.2, 0x5b4634);
  frameL.position.x = -3;
  const frameR = box(1.2, 6, 1.2, 0x5b4634);
  frameR.position.x = 3;
  const lintel = box(8, 1.2, 1.4, 0x5b4634);
  lintel.position.y = 6.2;
  mine.add(frameL, frameR, lintel);
  const dark = box(6, 5.6, 10, 0x15110e);
  dark.position.z = -5.5;
  mine.add(dark);
  for (let i = 0; i < 4; i++) {
    const plank = box(5.6, 0.7, 0.2, 0x7a6248);
    plank.position.set(0, 1 + i * 1.3, 0.7);
    plank.rotation.z = (i % 2 ? 1 : -1) * 0.08;
    mine.add(plank);
  }
  const hill = new THREE.Mesh(new THREE.SphereGeometry(16, 10, 8), mat(0x6f6a5e));
  hill.position.set(0, -4, -14);
  mine.add(hill);
  const spoil2 = new THREE.Mesh(new THREE.ConeGeometry(14, 6, 9), mat(0x8c8470));
  spoil2.position.set(14, 2.5, 8);
  mine.add(spoil2);
  const genPuff = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 5), new THREE.MeshLambertMaterial({ color: 0xb8b4ac, transparent: true, opacity: 0.35 }));
  g.add(genPuff);
  smokes.push({ mesh: genPuff, base: new THREE.Vector3(680 + 5, hf.sample(680, -420) + 6, -420 - 2), phase: 2, rate: 0.5 });
  g.add(place(mine, hf, 680, -420, Math.PI));

  // ---- river landing ----
  const dock = new THREE.Group();
  const deck = box(18, 0.6, 8, 0x8a7458);
  deck.position.y = 1.2;
  dock.add(deck);
  for (let i = 0; i < 6; i++) {
    const pile = box(0.5, 2.2, 0.5, 0x5f4c3a);
    pile.position.set(-7 + i * 3, 0, 3.6);
    dock.add(pile);
  }
  for (let i = 0; i < 4; i++) {
    const crate = box(2.2, 1.8, 2.2, 0x6a6a5a);
    crate.position.set(-5 + i * 3, 1.5, -1.5);
    dock.add(crate);
  }
  const tarp = box(12, 0.5, 4, 0x5d6b4a);
  tarp.position.set(-0.5, 3.3, -1.5);
  dock.add(tarp);
  const barge = box(22, 1.6, 5, 0x3a3a38);
  barge.position.set(2, 0.2, 8);
  dock.add(barge);
  g.add(place(dock, hf, 520, 505, -0.5, 1.4));

  // ---- stone ring ----
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const stone = box(1.6 + r() * 0.8, 3.5 + r() * 2, 1 + r() * 0.5, 0x7f7c74);
    stone.rotation.z = (r() - 0.5) * 0.25;
    g.add(place(stone, hf, -600 + Math.cos(a) * 22, 150 + Math.sin(a) * 22, a));
  }

  // ---- scattered barns and ruins to make the land feel lived in ----
  const extras: [number, number, number][] = [
    [-150, 300, 0.4],
    [100, 900, 1.2],
    [-900, 600, 0.1],
    [900, -200, 2.1],
    [-700, -300, 0.9],
    [300, 700, 2.6],
  ];
  for (const [x, z, rot] of extras) {
    const b = house(7 + r() * 4, 5 + r() * 3, 3, 0x9f9480, 0x5b4a3f);
    g.add(place(b, hf, x, z, rot));
  }
  const walls: [number, number, number, number][] = [
    [-500, 500, 120, 0.3],
    [50, 450, 90, 1.1],
    [-850, 850, 100, 0.8],
  ];
  for (const [x, z, len, rot] of walls) {
    const wall = box(len, 1.1, 0.5, 0x8a8577);
    g.add(place(wall, hf, x, z, rot, 0.3));
  }

  return { group: g, towerLight, smokes, windsock, shedDoor };
}

export function updateProps(p: WorldProps, t: number): void {
  // aviation light blink
  (p.towerLight.material as THREE.MeshBasicMaterial).color.setHex(Math.floor(t * 1.2) % 2 === 0 ? 0xff3b2f : 0x5a1a14);
  for (const s of p.smokes) {
    const u = ((t * s.rate + s.phase) % 1 + 1) % 1;
    s.mesh.position.set(s.base.x + Math.sin(t * 0.7 + s.phase) * 1.5 + u * 4, s.base.y + u * 12, s.base.z);
    const sc = 0.8 + u * 2.4;
    s.mesh.scale.set(sc, sc, sc);
    (s.mesh.material as THREE.MeshLambertMaterial).opacity = 0.45 * (1 - u);
  }
  p.windsock.rotation.y = Math.sin(t * 0.8) * 0.25;
}
