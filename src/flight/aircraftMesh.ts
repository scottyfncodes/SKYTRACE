import * as THREE from 'three';
import { mat } from '../world/props';
import type { AircraftState } from './aircraft';

/** A small twin-boom reconnaissance aircraft, built from primitives. */
export class AircraftMesh {
  readonly group = new THREE.Group();
  private prop: THREE.Mesh;
  constructor() {
    const body = mat(0x6e7052);
    const accent = mat(0xe0622c);
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd2e8, transparent: true, opacity: 0.8 });
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 6.2, 10), body);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.z = 0.4;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.4, 10), accent);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -3.4;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), glass);
    canopy.scale.set(1, 0.7, 1.6);
    canopy.position.set(0, 0.6, -1.4);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.22, 1.9), body);
    wing.position.set(0, 0.25, -0.6);
    const tipL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.26, 1.9), accent);
    tipL.position.set(-5.2, 0.25, -0.6);
    const tipR = tipL.clone();
    tipR.position.x = 5.2;
    const boomL = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 5.5, 6), body);
    boomL.rotation.x = Math.PI / 2;
    boomL.position.set(-2.4, 0.2, 2.3);
    const boomR = boomL.clone();
    boomR.position.x = 2.4;
    const hTail = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.18, 1.1), body);
    hTail.position.set(0, 0.9, 4.9);
    const finL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.6, 1.3), accent);
    finL.position.set(-2.4, 1.2, 4.9);
    const finR = finL.clone();
    finR.position.x = 2.4;
    this.prop = new THREE.Mesh(new THREE.CircleGeometry(1.25, 16), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    this.prop.position.z = -4.15;
    const gear = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 0.2), body);
    gear.position.set(0, -0.9, -2.5);
    this.group.add(fuselage, nose, canopy, wing, tipL, tipR, boomL, boomR, hTail, finL, finR, this.prop, gear);
  }
  sync(a: AircraftState, t: number): void {
    this.group.position.set(a.x, a.y, a.z);
    this.group.rotation.set(0, 0, 0);
    this.group.rotateY(a.yaw);
    this.group.rotateX(a.pitch);
    this.group.rotateZ(-a.roll);
    this.prop.rotation.z = t * 40 * (0.5 + a.throttle);
  }
}
