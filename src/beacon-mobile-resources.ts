import type * as THREE from 'three';

/** Rex <game88521@gmail.com>. A streamed tile owns its unshared geometry and ownMats materials. */
const releasedTiles = new WeakSet<THREE.Object3D>();
export interface ReleasedCityTile { objects: number; geometries: number; materials: number; instances: number }

/** Includes lines/points, while preserving the city's shared geometry, materials and textures. */
export function releaseCityTile(root: THREE.Object3D): ReleasedCityTile {
  const result: ReleasedCityTile = { objects: 0, geometries: 0, materials: 0, instances: 0 };
  if (releasedTiles.has(root)) return result;
  releasedTiles.add(root);
  const objects: THREE.Object3D[] = [], geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(object => {
    objects.push(object);
    const drawable = object as THREE.Mesh;
    if (drawable.geometry && !drawable.geometry.userData.shared) geometries.add(drawable.geometry);
    let ownsMaterials = false;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (parent.userData.ownMats) { ownsMaterials = true; break; }
      if (parent === root) break;
    }
    if (ownsMaterials && drawable.material) {
      for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
    }
    if ((object as THREE.InstancedMesh).isInstancedMesh) { (object as THREE.InstancedMesh).dispose(); result.instances++; }
  });
  for (const geometry of geometries) geometry.dispose();
  // Material.dispose does not dispose maps. Tile materials do not own the city texture atlases.
  for (const material of materials) material.dispose();
  result.objects = objects.length; result.geometries = geometries.size; result.materials = materials.size;
  // A renderer may still retain an individual render item. Do not keep its old tile subtree alive.
  root.removeFromParent();
  for (const object of objects) { object.parent = null; object.children.length = 0; }
  return result;
}
