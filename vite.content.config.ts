import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Content scripts cannot be ES modules, so bundle into a single IIFE.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      name: 'largeImageSpotter',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
