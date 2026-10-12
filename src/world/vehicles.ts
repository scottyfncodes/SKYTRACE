/**
 * Vehicles on the Gorge Road: the contacts recon has to tell apart. Built
 * chunky and bright (a little over life size) so they read from the air.
 */
import * as THREE from 'three';
import { box, mat } from './props';
import type { Contact } from '../rescue/recon';
import type { HeightField } from './terrain';

export interface VehicleView {
  group: THREE.Group;
  /** Hazard lights that blink (the van). */
  blinkers: THREE.Mesh[];
}

function wheels(g: THREE.Group, len: number, width: number, n: number): void {
  const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 10);
  geo.rotateZ(Math.PI / 2);
  const m = mat(0x222428);
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + 1 + (i * (len - 2)) / Math.max(1, n - 1);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(geo, m);
      w.position.set((s * width) / 2, 0.55, z);
      g.add(w);
    }
  }
}

/** A cab at the front (-z) and a load behind it. */
function truck(cab: number, load: THREE.Object3D, len: number): THREE.Group {
  const g = new THREE.Group();
  const c = box(2.6, 2.4, 2.4, cab);
  c.position.set(0, 0.6, -len / 2 + 1.2);
  const glass = box(2.4, 0.9, 0.1, 0x2d4a63);
  glass.position.set(0, 2.2, -len / 2 - 0.02);
  const chassis = box(2.2, 0.4, len, 0x33363b);
  chassis.position.y = 0.6;
  g.add(c, glass, chassis, load);
  wheels(g, len, 2.5, 3);
  return g;
}

export function buildVehicle(kind: Contact['kind']): VehicleView {
  const blinkers: THREE.Mesh[] = [];
  let g: THREE.Group;
  if (kind === 'logtruck') {
    const load = new THREE.Group();
    const logGeo = new THREE.CylinderGeometry(0.42, 0.42, 6.4, 8);
    logGeo.rotateX(Math.PI / 2);
    const bark = mat(0x8a6038);
    for (let i = 0; i < 6; i++) {
      const l = new THREE.Mesh(logGeo, bark);
      l.position.set(-0.85 + (i % 3) * 0.85, 1.4 + Math.floor(i / 3) * 0.75, 1.4);
      load.add(l);
    }
    g = truck(0x2e7d4f, load, 9);
  } else if (kind === 'van') {
    g = new THREE.Group();
    const body = box(2.4, 2.6, 5.6, 0xf2f2ee);
    body.position.y = 0.6;
    const stripe = box(2.45, 0.4, 5.62, 0x2e7dd1);
    stripe.position.y = 1.6;
    const glass = box(2.2, 0.9, 0.1, 0x2d4a63);
    glass.position.set(0, 2.4, -2.82);
    g.add(body, stripe, glass);
    wheels(g, 5.6, 2.45, 2);
    const lightMat = () => new THREE.MeshBasicMaterial({ color: 0xffa21a });
    for (const [x, z] of [
      [-1.05, -2.85],
      [1.05, -2.85],
      [-1.05, 2.85],
      [1.05, 2.85],
    ]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.12), lightMat());
      l.position.set(x, 1.1, z);
      g.add(l);
      blinkers.push(l);
    }
  } else {
    // the wreck: a box truck on its side off the edge of the road, its load spilled
    const load = box(2.6, 2.8, 6, 0xd94b2b);
    load.position.set(0, 0.9, 1.2);
    const t = truck(0xf0c419, load, 8.4);
    t.rotation.z = Math.PI / 2;
    t.position.y = 1.3;
    g = new THREE.Group();
    g.add(t);
    const crateMat = mat(0xb08a52);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), crateMat);
      c.position.set(3 + (i % 3) * 1.4, 0.5, -2 + i * 1.3);
      c.rotation.y = i * 0.7;
      g.add(c);
    }
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffa21a });
    for (const z of [-4.2, 4.2]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.12), lightMat.clone());
      l.position.set(-1.2, 2.6, z);
      g.add(l);
      blinkers.push(l);
    }
  }
  g.scale.setScalar(1.25);
  return { group: g, blinkers };
}

/** Stand a vehicle on the ground at a contact, facing its heading. */
export function placeVehicle(v: VehicleView, c: Contact, hf: HeightField): void {
  v.group.position.set(c.x, hf.sample(c.x, c.z), c.z);
  v.group.rotation.y = c.heading ?? 0;
}

export function blink(v: VehicleView, t: number): void {
  const on = Math.floor(t * 2.4) % 2 === 0;
  for (const b of v.blinkers) (b.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xffb02a : 0x3a2a10);
}
