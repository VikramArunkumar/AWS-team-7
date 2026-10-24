import { defineConfig } from 'vite';

// Single entry point (index.html). The administrator console is reached
// through the in-app login/role routing, not a separate page.
export default defineConfig({
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
