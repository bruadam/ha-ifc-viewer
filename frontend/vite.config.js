import { defineConfig } from 'vite';

// Built into the integration: custom_components/ifc_viewer/frontend/, served by HA at /ifc_viewer_static/.
// The entry keeps a fixed name (HA's panel config points at it); chunks and the WASM are content-hashed.
export default defineConfig({
  base: './',
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
