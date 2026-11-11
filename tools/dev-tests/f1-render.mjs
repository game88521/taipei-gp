// 獨立 WebGL 車模 A/B：同車陣、同光線、同鏡頭；驗證浮點材質貼圖、LOD、換胎與烤漆。
// 先 build-f1-test.mjs before／after；再 node external-browser.mjs 9333 f1-render.mjs before
import { readFileSync, writeFileSync } from 'node:fs';
const [port, label] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/i.test(label ?? '')) throw new Error('需要 before／after 輸出名稱');
writeFileSync(`dist/shots-f1-${label}.js`, readFileSync(new URL(`shots-f1-model-${label}.mjs`, import.meta.url)));
writeFileSync(`dist/shots-f1-${label}.html`, `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}canvas{display:block}</style></head><body><script type="module">import * as m from "/shots-f1-${label}.js"; window.__f1=m;</script></body></html>`);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
let seq = 0; const pending = new Map(), errors = [];
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description));
  const job = pending.get(m.id);
  if (!job) return;
  pending.delete(m.id); clearTimeout(job.timer);
  if (m.error) job.reject(new Error(JSON.stringify(m.error))); else job.resolve(m.result);
};
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 逾時`)); }, 120000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};
try {
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:4317/shots-f1-${label}.html` });
  const deadline = Date.now() + 60000;
  while (!await ev('!!window.__f1')) {
    if (Date.now() > deadline) throw new Error('車模模組載入逾時');
    await new Promise((r) => setTimeout(r, 100));
  }
  await ev(`(() => {
    const { THREE: T, makeF1, TEAMS, RoomEnvironment } = __f1;
    const r = new T.WebGLRenderer({ antialias: true, stencil: true, preserveDrawingBuffer: true });
    r.setSize(960, 540); r.setPixelRatio(1); r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.debug.onShaderError = (gl, program) => { throw new Error(gl.getProgramInfoLog(program)); };
    document.body.append(r.domElement);
    const scene = new T.Scene(); scene.background = new T.Color('#4c6077');
    const pmrem = new T.PMREMGenerator(r), room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04); scene.environment = env.texture;
    room.dispose(); pmrem.dispose();
    scene.add(new T.HemisphereLight('#d4e5ff', '#534434', 1.2));
    const sun = new T.DirectionalLight('#fff0d4', 3); sun.position.set(25, 50, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 100, bottom: -70, near: 1, far: 200 });
    sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias = 0.02; scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(140, 160).rotateX(-Math.PI / 2), new T.MeshStandardMaterial({ color: '#55545d', roughness: 0.8 }));
    floor.position.set(0, -0.02, 40); floor.receiveShadow = true; scene.add(floor);
    const models = Array.from({ length: 22 }, (_, i) => {
      const m = makeF1(TEAMS[i % TEAMS.length].livery);
      m.root.position.set(i % 2 ? 2.6 : -2.6, 0, Math.floor(i / 2) * 8);
      m.root.traverse((o) => { if (!o.isMesh) return; o.castShadow = !!o.material.isMeshStandardMaterial; o.receiveShadow = true; if (o.userData.rainOnly) o.visible = false; });
      scene.add(m.root); return m;
    });
    const camera = new T.PerspectiveCamera(62, 960 / 540, 0.1, 300);
    camera.position.set(0, 3.2, -12); camera.lookAt(0, 1.1, 24);
    window.__shot = { r, scene, camera, models };
    return true;
  })()`);
  const result = {};
  for (const mode of ['full', 'far', 'restored', 'paint-tyre-rain']) {
    const out = await ev(`(() => {
      const { r, scene, camera, models } = __shot, { setLod, setTyre } = __f1;
      const mode = ${JSON.stringify(mode)};
      models.forEach((m) => setLod(m, mode === 'far'));
      if (mode === 'paint-tyre-rain') {
        models.forEach((m, i) => m.root.visible = i === 0);
        const m = models[0]; m.root.userData.paint.color.set('#4b7fbe'); setTyre(m, '#2fbf6c');
        m.steer.forEach((o) => o.rotation.y = 0.35); m.spin.forEach((o) => o.rotation.x = 0.7);
        m.root.traverse((o) => { if (o.userData.rainOnly) o.visible = true; });
        camera.position.set(-6, 2.3, 6); camera.fov = 35; camera.lookAt(-2.6, 0.5, 0); camera.updateProjectionMatrix();
      }
      r.info.autoReset = false;
      r.render(scene, camera); r.info.reset(); r.render(scene, camera);
      const gl = r.getContext(), pixels = new Uint8Array(960 * 540 * 4);
      gl.readPixels(0, 0, 960, 540, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError(); if (error) throw new Error('WebGL error ' + error);
      let raw = ''; for (let i = 0; i < pixels.length; i += 32768) raw += String.fromCharCode(...pixels.subarray(i, i + 32768));
      return { calls: r.info.render.calls, triangles: r.info.render.triangles, glError: error, png: r.domElement.toDataURL('image/png').split(',')[1], rgba: btoa(raw) };
    })()`);
    writeFileSync(new URL(`shots-f1-${label}-${mode}.png`, import.meta.url), Buffer.from(out.png, 'base64'));
    writeFileSync(new URL(`shots-f1-${label}-${mode}.rgba`, import.meta.url), Buffer.from(out.rgba, 'base64'));
    result[mode] = { calls: out.calls, triangles: out.triangles, glError: out.glError };
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  writeFileSync(new URL(`shots-f1-render-${label}.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ label, result }, null, 2));
} finally { ws.close(); }
