import * as THREE from 'three';
import { Traffic } from './traffic';
import type { CityData, Collider } from './citydata';
import type { FreeCar } from './freecar';

/** Separate low-density simulation: never consumes the free-drive Traffic PRNG or agents. */
export class RoadDutyTraffic {
  readonly root = new THREE.Scene();
  readonly traffic: Traffic;
  disposed = false;
  constructor(scene: THREE.Scene, data: CityData, collider: Collider | null) {
    this.root.name = 'odyssey-road-duty-traffic';
    this.traffic = new Traffic(this.root, data, 8);
    this.traffic.collider = collider;
    scene.add(this.root);
  }
  step(dt: number, car: FreeCar) {
    if (this.disposed) return 0;
    this.traffic.update(dt, car);
    return this.traffic.collidePlayer(car, { radius: car.geometry?.radius ?? 1.27, range: 13 });
  }
  signal(car: FreeCar) {
    return this.traffic.signalAt(car.x, car.z, Math.sin(car.h), Math.cos(car.h), car.y);
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.root.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); if (object instanceof THREE.InstancedMesh) object.dispose(); } });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.root.removeFromParent(); this.root.clear(); this.traffic.agents.length = 0;
  }
}
