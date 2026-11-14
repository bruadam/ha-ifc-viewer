import { defineConfig } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Home Assistant's static file server sends `<file>.gz` instead of `<file>` when the browser accepts gzip:
// the 10 MB WASM engine goes over the wire as 3.6 MB.
function precompress() {
  return {
    name: 'precompress',
    apply: 'build',
    writeBundle({ dir }) {
      const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
      for (const f of walk(dir)) {
        if (!/\.(js|wasm|css)$/.test(f) || statSync(f).size < 4096) continue;
        writeFileSync(f + '.gz', gzipSync(readFileSync(f), { level: 9 }));
      }
    },
  };
}

// Built into the integration: custom_components/ifc_viewer/frontend/, served by HA at /ifc_viewer_static/.
// The entry keeps a fixed name (HA's panel config points at it); chunks and the WASM are content-hashed.
export default defineConfig({
  base: './',
  plugins: [precompress()],
  build: {
    outDir: '../custom_components/ifc_viewer/frontend',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    modulePreload: false,
    rollupOptions: {
      input: 'src/panel.js',
      preserveEntrySignatures: 'strict',
      output: {
        entryFileNames: 'ifc-viewer-panel.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: { format: 'es' },
});
