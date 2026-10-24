import { defineConfig } from 'vite';

// Single entry point (index.html). Serve on localhost: Cognito's callback and
// sign-out URLs are registered for http://localhost:5173 (see package.json).
export default defineConfig({
  server: { host: 'localhost' },
  preview: { host: 'localhost' },
});
