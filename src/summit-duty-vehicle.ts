import * as THREE from 'three';
import type { DutyKind } from './summit-city-duty';

/** Independent 11.5m bus / 8m flatbed. Geometry matches each duty FreeCar envelope. */
export function buildDutyVehicle(kind: DutyKind) {
  const root = new THREE.Group(); root.name = `summit-${kind}-vehicle`;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const mat = (color: string) => { let m = materials.get(color); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: .2 }); materials.set(color, m); } return m; };
  function box(w: number, h: number, l: number, x: number, y: number, z: number, color: string, parent: THREE.Group = root) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat(color)); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; }
  const wheels: THREE.Mesh[] = [], frontWheels: THREE.Mesh[] = [], doors: THREE.Mesh[] = [];
  const axle = (z: number, width: number, steer = false) => { for (const x of [-width, width]) { const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.47, .47, .25, 14).rotateZ(Math.PI / 2), mat('#141a23')); wheel.position.set(x, .47, z); root.add(wheel); wheels.push(wheel); if (steer) frontWheels.push(wheel); } };
  const load = new THREE.Group(); load.name = 'loaded-disabled-car'; root.add(load);
  const ramp = box(1.45, .08, 1.25, -1.9, .34, -.9, '#f0ce70'); ramp.name = 'voyager-wheelchair-ramp'; ramp.rotation.z = .22; ramp.visible = false;
  if (kind === 'bus') {
    box(2.48, .65, 11.5, 0, .85, 0, '#dce9ec'); box(2.45, 1.55, 11.3, 0, 1.95, 0, '#227a8d'); box(2.35, .35, 11.1, 0, 2.95, 0, '#e5f1f0');
    box(2.28, 1.12, .08, 0, 2.08, 5.69, '#203947'); box(2.28, 1, .08, 0, 2.08, -5.69, '#203947');
    for (const z of [-4.25, -2.65, -1.05, .55, 2.15, 3.75]) for (const x of [-1.242, 1.242]) box(.025, .95, 1.35, x, 2.15, z, '#203947');
    for (const z of [3.9, -.9]) { const door = box(.055, 2.15, 1.35, -1.27, 1.68, z, '#193a49'); doors.push(door); }
    box(1.8, .25, .08, 0, 2.82, 5.71, '#eecb71');
    axle(3.05, 1.17, true); axle(-3.05, 1.17);
  } else {
    box(2.35, .45, 7.8, 0, .72, 0, '#434e65'); box(2.3, 1.75, 2.4, 0, 1.77, 2.55, '#e4ac4c'); box(2.14, .82, .07, 0, 2.12, 3.78, '#203947');
    box(2.42, .23, 4.85, 0, 1.02, -1.25, '#8b9cad'); for (const x of [-1.13, 1.13]) box(.13, .22, 4.8, x, 1.24, -1.3, '#e1b45e');
    box(1.75, .63, 3.75, 0, 1.55, -1.4, '#a76066', load); box(1.45, .55, 1.75, 0, 2.11, -1.35, '#263947', load);
    // Visible crossed securing straps, attached to the platform; no pretend towing rope.
    for (const z of [-2.6, -.2]) { const strap = box(2.3, .06, .1, 0, 1.95, z, '#f6ce67', load); strap.rotation.z = .12; }
    axle(2.25, 1.08, true); axle(-2.25, 1.08); load.visible = false;
  }
  const markerGeometry = new THREE.ConeGeometry(.75, 2, 3).rotateX(Math.PI / 2);
  const marker = new THREE.Mesh(markerGeometry, mat('#8aefbc')); marker.name = 'duty-stop-direction';
  let door = 0, spin = 0;
  return { root, load, marker, frame(dt: number, speed: number, steer: number, open: boolean, rampOpen = false) { ramp.visible = kind === 'bus' && open && rampOpen; door += ((open ? 1 : 0) - door) * Math.min(1, dt * 6); doors.forEach(d => { d.position.x = -1.27 - door * .2; d.position.z = (d === doors[0] ? 3.9 : -.9) - door * 1.05; }); spin += speed * dt / .47; wheels.forEach(w => { w.rotation.x = spin; }); frontWheels.forEach(w => { w.rotation.y = -steer * .4; }); }, dispose() { const geometries = new Set<THREE.BufferGeometry>(); root.traverse(o => { if (o instanceof THREE.Mesh) geometries.add(o.geometry); }); geometries.add(markerGeometry); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); root.removeFromParent(); marker.removeFromParent(); } };
}
