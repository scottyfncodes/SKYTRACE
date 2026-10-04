import { defineConfig } from 'vite';

// Relative base so the build works at any GitHub Pages path
// (https://<user>.github.io/SKYTRACE/ or a custom domain).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
