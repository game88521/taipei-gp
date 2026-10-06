// 由 main.ts 拆出來（行為不變）：畫面：環境反射、光暈＋調色後處理、陰影旗標
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { World } from './world';

// 環境反射：用天空漸層＋夕陽做一張反射貼圖，車漆、玻璃帷幕會映出晚霞（換時段天氣時重做）
export function buildEnvMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene, world: World, sunColor = new THREE.Color(6, 4.2, 2.6)) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(world.sky.geometry, world.sky.material));
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(160, 16, 8), new THREE.MeshBasicMaterial({ color: sunColor }));
  sunBall.position.copy(world.sunDir).multiplyScalar(2000);
  env.add(sunBall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshBasicMaterial({ color: '#2e2b29' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -20;
  env.add(floor);
  const old = scene.environment;
  scene.environment = pmrem.fromScene(env, 0.03, 0.1, 6000).texture;
  old?.dispose();
  pmrem.dispose();
}

// 光暈（Bloom）：霓虹招牌、亮燈的窗戶、路燈、車燈、紅綠燈會暈開；最後加一點暗角與暖色調
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.42 }, saturation: { value: 1.1 }, tint: { value: new THREE.Vector3(1.03, 1, 0.96) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float saturation; uniform vec3 tint; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation) * tint;
      float d = length((vUv - 0.5) * vec2(1.0, 0.8));
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, d), vignette);
      gl_FragColor = c;
    }`,
};

export function makeComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, bloomScale: number) {
  // 自己給後製畫布：要有 stencil（預先算好的影子靠它避免重疊處更黑）
  const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * bloomScale, innerHeight * bloomScale), 0.55, 0.45, 0.82);
  composer.addPass(bloom);
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());
  return { composer, bloom, gradePass };
}

/** 平面（路面、綠地、地面）只接受陰影；有厚度的東西（建築、樹、車、人）才投射 */
export function applyShadowFlags(scene: THREE.Scene, enabled: boolean) {
  if (!enabled) return;
  const box = new THREE.Box3(), size = new THREE.Vector3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.shadowDone) return;
    o.userData.shadowDone = true;
    const mat0 = Array.isArray(m.material) ? m.material[0] : m.material;
    const lambert = mat0 instanceof THREE.MeshLambertMaterial || mat0 instanceof THREE.MeshStandardMaterial; // 有打光的材質
    if (!lambert) return;
    m.receiveShadow = true;
    let dyn = false;
    for (let o2: THREE.Object3D | null = m; o2; o2 = o2.parent) if (o2.userData.dynamic) { dyn = true; break; }
    m.castShadow = dyn;
    void box; void size;
  });
}
