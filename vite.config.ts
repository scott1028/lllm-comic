import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Popup + service worker. Content script is built separately (needs IIFE).
export default defineConfig({
  root: 'src',
  publicDir: resolve(import.meta.dirname, 'public'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/popup/index.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
});
