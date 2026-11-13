import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Direct invocation and Render's build task both refresh the complete map catalog.
await import('./build-multiplayer-catalog.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  configFile: false,
  root,
  build: {
    target: 'es2022',
    outDir: path.join(root, 'server'),
    emptyOutDir: false,
    copyPublicDir: false,
    minify: true,
    lib: { entry: path.join(root, 'server/physics-entry.ts'), formats: ['es'], fileName: () => 'physics.mjs' },
  },
});
