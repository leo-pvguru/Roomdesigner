import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, host: true, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        // Manual chunk grouping for cacheable, smaller initial loads.
        //
        // The goal: keep the FIRST-load chunk small (just the chrome + the
        // viewport) and let everything else download in parallel as separate
        // chunks. React + Zustand never change between deploys, so giving
        // them their own chunk means a deploy of new app code reuses the
        // user's cached vendor chunk.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React + React-DOM together — they always travel as a pair.
            if (id.includes('/react/') || id.includes('/react-dom/') ||
                id.includes('/scheduler/')) {
              return 'react-vendor';
            }
            // Zustand is tiny and tightly coupled to React, but it can still
            // share the react-vendor chunk for cache-hit benefits.
            if (id.includes('/zustand/')) return 'react-vendor';
            // Lucide ships hundreds of icon files; bundling them out keeps
            // the main app chunk leaner and they're rarely updated.
            if (id.includes('/lucide-react/')) return 'icons-vendor';
            // file-saver is leaf utility — leave with default.
          }
          // Big in-tree modules — pull the equipment-shape recipes and the
          // acoustic-panel pattern renderers into their own chunk. They're
          // ~3,000 lines combined and only the viewport needs them, so a
          // deploy that touches a chrome component won't bust this chunk.
          if (id.includes('/components/viewport/equipment3d') ||
              id.includes('/components/viewport/panelPatterns')) {
            return 'equipment-shapes';
          }
          // The acoustics engine is referenced from BOTH the main thread
          // (App.tsx) and the heatmap worker. Letting Rollup decide is
          // safer than forcing a chunk that may duplicate into the worker.
        },
      },
    },
    // Raise the warning threshold to 700 kB after splitting — the largest
    // remaining chunk should be the main app, and we want a useful warning
    // floor without nagging on every build.
    chunkSizeWarningLimit: 700,
  },
});
