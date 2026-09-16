import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

// PWA plugin (manifest, service worker, icons) is wired in as its own
// reviewed task once real product assets and manifest fields are decided —
// see PRODUCT.md and the frontend implementation plan.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
