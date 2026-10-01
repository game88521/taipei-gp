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
      const urls = files.map((f) => '/' + relative(outDir, f).split('\\').join('/')).map((u) => (u === '/index.html' ? '/' : u));
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
