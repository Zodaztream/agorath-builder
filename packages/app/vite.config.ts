import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so every asset URL needs
  // that prefix. Getting this wrong is a blank page with four 404s (ADR-0001).
  base: '/agorath-builder/',
  plugins: [preact()],
  resolve: {
    // Straight at source: no build step between packages, and no reliance on
    // how npm happens to symlink a workspace.
    alias: {
      '@agorath/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@agorath/content': fileURLToPath(new URL('../content/src/index.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // Offline at the table matters more than a byte count (ADR-0001).
    sourcemap: false,
  },
  server: {
    fs: { allow: ['..'] },
  },
});
