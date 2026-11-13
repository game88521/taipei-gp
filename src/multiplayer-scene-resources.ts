import * as THREE from 'three';
import { disposeEnvMap } from './graphics';

/** 每張地圖擁有自己的場景；同一棵樹內共用的 GPU 資源只釋放一次。 */
export function disposeMultiplayerObjects(root: THREE.Object3D, textures = true) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const maps = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const list = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : [];
    for (const material of list) materials.add(material);
    if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose();
    const light = object as THREE.DirectionalLight;
    light.shadow?.dispose();
  });
  for (const material of materials) {
    if (textures) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) maps.add(value);
      const uniforms = (material as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const uniform of Object.values(uniforms)) {
        if (uniform.value instanceof THREE.Texture) maps.add(uniform.value);
        if (Array.isArray(uniform.value)) for (const value of uniform.value) if (value instanceof THREE.Texture) maps.add(value);
      }
    }
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of maps) texture.dispose();
}

export function disposeMultiplayerScene(scene: THREE.Scene) {
  disposeEnvMap(scene);
  disposeMultiplayerObjects(scene);
  scene.clear();
  scene.background = null;
  scene.environment = null;
}
