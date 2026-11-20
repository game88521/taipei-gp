import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 打包完成後產生 dist/sw.js：把 dist 裡所有檔案列進預先快取清單，版本號 = 全部檔案內容的雜湊。
 * 只要任何檔案變了，sw.js 就跟著變，手機下次開啟會自動換新版。
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  const optionalAssets = new Set<string>();
  const packGraphs = new Map<string, Set<string>>();
  const sharedPackAssets = new Set<string>();
  return {
    name: 'taipei-gp-sw',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    // Vite removes CSS-only JavaScript facades during generateBundle. Inspect
    // the final written bundle so offline packs cannot retain deleted facades.
    writeBundle(_options, bundle) {
      for(const output of Object.values(bundle))if(output.type==='asset'&&!output.fileName.endsWith('.css'))sharedPackAssets.add(output.fileName);
      const collect = (root: string, dynamic: boolean) => {
        const files = new Set<string>();
        const walk = (name: string) => { if (files.has(name)) return; const out = bundle[name]; if(dynamic&&root.includes('main-')&&out?.type==='chunk'&&['nexus-workshop-ui','nexus-coop-ui'].includes(out.name))return; files.add(name); if(out?.type!=='chunk')return;
          for(const dep of [...out.imports,...(dynamic?out.dynamicImports:[])])walk(dep);
          for(const css of (out as typeof out & {viteMetadata?:{importedCss?:Set<string>}}).viteMetadata?.importedCss??[])files.add(css);
        };walk(root);return files;
      };
      for(const output of Object.values(bundle))if(output.type==='chunk'){
        if(output.isEntry&&output.name==='main')packGraphs.set('free',collect(output.fileName,true));
        if(output.name==='nexus-workshop-ui')packGraphs.set('workshop',collect(output.fileName,true));
      }
      const required = new Set<string>();
      const visit = (name: string) => {
        if (required.has(name)) return; required.add(name);
        const output = bundle[name];
        if (output?.type !== 'chunk') return;
        for (const dependency of output.imports) visit(dependency);
        const metadata = (output as typeof output & { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata;
        for (const css of metadata?.importedCss ?? []) required.add(css);
      };
      // Cache the main and online entry graphs. Optional UIs and the separate
      // split-screen entry are cached when opened, rather than on every update.
      for (const output of Object.values(bundle)) if (output.type === 'chunk' && output.isEntry && ['main','multiplayer'].includes(output.name)) visit(output.fileName);
      for (const name of Object.keys(bundle)) if (/\.(?:js|css)$/.test(name) && !required.has(name)) optionalAssets.add('/' + name);
    },
    closeBundle() {
      const tileDir = join(outDir, 'data/tiles');
      const tileFiles: Record<string, { bytes: number; sha256: string }> = {};
      for (const name of readdirSync(tileDir).sort()) {
        if (!name.endsWith('.json')) continue;
        const body = readFileSync(join(tileDir, name));
        tileFiles[`/data/tiles/${name}`] = { bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex') };
      }
      writeFileSync(join(outDir, 'data/offline-tiles.json'), JSON.stringify({ files: tileFiles }));
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (f !== 'sw.js') files.push(p);
        }
      };
      walk(outDir);
      files.sort();
      const common=files.filter(f=>(!relative(outDir,f).replaceAll('\\','/').startsWith('assets/')||sharedPackAssets.has(relative(outDir,f).replaceAll('\\','/')))&&!/\.(?:html)$/.test(f)&&!f.endsWith('offline-packs.json'));
      const descriptor=(path:string)=>{const bytes=readFileSync(path),url='/'+relative(outDir,path).split('\\').join('/');return {url:url==='/index.html'?'/':url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.json')?'application/json':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.png')?'image/png':path.endsWith('.webmanifest')?'application/manifest+json':'application/octet-stream'};};
      const packs=['free','workshop'].map(id=>{const graph=new Set([...(packGraphs.get('free')??[]),...(id==='workshop'?packGraphs.get('workshop')??[]:[])]);if(!graph.size||id==='workshop'&&!packGraphs.has('workshop'))throw Error('離線玩法模組圖不完整');return {id,name:id==='free'?'自由駕駛完整城市':'單人工坊與完整城市',files:[...new Set([...common,join(outDir,'index.html'),...Array.from(graph,n=>join(outDir,n))])].sort().map(descriptor)};});
      const packPath=join(outDir,'data/offline-packs.json');writeFileSync(packPath,JSON.stringify({v:1,packs}));files.push(packPath);files.sort();
      const hash = createHash('sha256');
      const template = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8');
      hash.update(template);
      for (const f of files) hash.update(readFileSync(f));
      const version = hash.digest('hex').slice(0, 12);
      // 城市區塊與車庫預覽按需下載；首次開過後由 fetch handler 快取，後續可離線使用。
      // 版本號仍然算進它們的內容，地圖一改就換新快取
      const urls = files.map((f) => '/' + relative(outDir, f).split('\\').join('/')).filter((u) => !u.startsWith('/data/tiles/') && !optionalAssets.has(u) && u !== '/splitscreen.html').map((u) => (u === '/index.html' ? '/' : u));
      const sw = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(urls));
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`sw.js：版本 ${version}，預先快取 ${urls.length} 個檔案`);
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), multiplayer: resolve(__dirname, 'multiplayer.html'), splitscreen: resolve(__dirname, 'splitscreen.html') } },
  }, // main.ts 用 top-level await 先讀各國賽道的中心線
});
