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
  return {
    name: 'taipei-gp-sw',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
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
      const hash = createHash('sha256');
      for (const f of files) hash.update(readFileSync(f));
      const version = hash.digest('hex').slice(0, 12);
      // 城市區塊檔（/data/tiles/）不預先快取：地圖很大時一次全抓太浪費，開到附近才抓、抓過的存進快取（離線也能開去過的地方）。
      // 版本號仍然算進它們的內容，地圖一改就換新快取
      const urls = files.map((f) => '/' + relative(outDir, f).split('\\').join('/')).filter((u) => !u.startsWith('/data/tiles/')).map((u) => (u === '/index.html' ? '/' : u));
      const sw = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(urls));
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`sw.js：版本 ${version}，預先快取 ${urls.length} 個檔案`);
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
});
