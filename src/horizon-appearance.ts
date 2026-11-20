import * as THREE from 'three';
import type { CarModel } from './carModel';
import { defaultAppearance, type CarAppearance } from './horizon-city-models';
interface Layer { key: string; objects: THREE.Object3D[]; geometries: THREE.BufferGeometry[]; materials: THREE.Material[]; textures: THREE.Texture[] }
/** Decorative owned meshes only: original paint/wheels/materials are never recolored or disposed. */
export function applyAppearance(model: CarModel, id: string, value?: CarAppearance) {
  const a = value ?? defaultAppearance(), key = JSON.stringify(a), old = model.root.userData.horizonAppearance as Layer | undefined;
  if (old?.key === key) return;
  disposeAppearance(model);
  const layer: Layer = { key, objects: [], geometries: [], materials: [], textures: [] }; model.root.userData.horizonAppearance = layer;
  const own = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'horizon-cosmetic'; parent.add(mesh); layer.objects.push(mesh); layer.geometries.push(geometry); layer.materials.push(material); return mesh;
  };
  if (a.number || a.decal !== 'none') {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const g = canvas.getContext('2d')!; g.clearRect(0, 0, 256, 128);
    if (a.decal === 'stripes') { g.fillStyle = '#ffffff'; g.fillRect(0, 18, 256, 17); g.fillRect(0, 94, 256, 17); }
    if (a.decal === 'wave') { g.strokeStyle = '#55eeff'; g.lineWidth = 14; g.beginPath(); for(let x=0;x<=256;x+=4){const y=64+Math.sin(x/35)*33;if(x)g.lineTo(x,y);else g.moveTo(x,y);}g.stroke(); }
    if (a.decal === 'chevron') { g.fillStyle = '#ffe879'; for(const x of [0,85,170]){g.beginPath();g.moveTo(x,0);g.lineTo(x+70,64);g.lineTo(x,128);g.lineTo(x+23,128);g.lineTo(x+93,64);g.lineTo(x+23,0);g.fill();} }
    if (a.number) { g.fillStyle='#111c';g.fillRect(87,17,82,94);g.font='bold 72px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#fff';g.fillText(a.number,128,67); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; layer.textures.push(texture);
    const width = id === 'f1' ? .91 : id === 'pickup' ? .96 : 1.02, height = id === 'pickup' ? 1.22 : id === 'f1' ? .45 : .76;
    for (const side of [-1, 1]) {
      const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false });
      const mesh = own(model.body, new THREE.PlaneGeometry(id === 'f1' ? 1.25 : 1.5, id === 'f1' ? .4 : .64), mat);
      mesh.position.set(side * width, height, id === 'pickup' ? 1.35 : -.1); mesh.rotation.y = side * Math.PI / 2;
    }
  }
  if (a.rim !== 'original') {
    const colors = { silver: '#dbe6f4', gold: '#e7bc43', cyan: '#50e4ee', violet: '#b78aff' };
    model.root.updateMatrixWorld(true);
    for (const wheel of model.spin) {
      wheel.geometry.computeBoundingBox(); const box = wheel.geometry.boundingBox!, size = box.getSize(new THREE.Vector3());
      const sign = Math.sign(model.root.worldToLocal(wheel.getWorldPosition(new THREE.Vector3())).x) || 1;
      const mat = new THREE.MeshStandardMaterial({ color: colors[a.rim], metalness: .7, roughness: .25 });
      const mesh = own(wheel, new THREE.CylinderGeometry(Math.min(.28, size.y * .29), Math.min(.28, size.y * .29), .018, 12).rotateZ(Math.PI/2), mat);
      mesh.position.x = sign * (size.x/2 + .014);
    }
  }
}
export function disposeAppearance(model: CarModel) {
  const layer = model.root.userData.horizonAppearance as Layer | undefined; if (!layer) return;
  for (const object of layer.objects) object.removeFromParent();
  for (const geometry of layer.geometries) geometry.dispose();
  for (const material of layer.materials) material.dispose();
  for (const texture of layer.textures) texture.dispose();
  delete model.root.userData.horizonAppearance;
}
