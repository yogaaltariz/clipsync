import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

// PWA plugin (manifest, service worker, icons) is wired in as its own
// reviewed task once real product assets and manifest fields are decided —
// see PRODUCT.md and the frontend implementation plan.
// Dev-server proxy makes the browser see one origin (localhost:5173) for
// both the app and the API, so fetch('/api/...') needs no CORS setup here
// or on the server — the same same-origin shape the production build gets
// from being served directly by clipsync-server (see server.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/clipboard': { target: 'ws://127.0.0.1:3000', ws: true },
      '/healthz': 'http://127.0.0.1:3000',
    },
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
