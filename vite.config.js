import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const rootDir = import.meta.dirname;

// Two independent entry points so the administrator console ships as a
// separate app from the clinical charge-nurse prototype. Keeping them apart
// means an administrator feature surface is never rendered inside a non-admin
// (charge nurse) session (FR-3, NFR-8). There is still no authentication in
// this prototype; the separation is structural, not an access-control claim.
export default defineConfig({
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        admin: resolve(rootDir, 'admin.html'),
      },
    },
  },
});
