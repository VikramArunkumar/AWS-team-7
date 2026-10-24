// esbuild bundler for CareBridge Lambda functions (Node 20, ESM).
//
// Each handler under src/handlers/*.ts is bundled to dist/handlers/<name>/index.mjs
// so SAM can point a function at a single file. No handlers exist yet (tasks
// 1.1–1.3 only); this script is a no-op until they are added in Phase 2+.

import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const handlersDir = path.resolve('src/handlers');

async function run() {
  if (!existsSync(handlersDir)) {
    console.log('[build] no src/handlers directory yet — nothing to bundle.');
    return;
  }

  const entries = (await readdir(handlersDir))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(handlersDir, f));

  if (entries.length === 0) {
    console.log('[build] no handlers found — nothing to bundle.');
    return;
  }

  await build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outdir: 'dist/handlers',
    outExtension: { '.js': '.mjs' },
    sourcemap: true,
    // The AWS SDK v3 is provided by the Lambda runtime; keep it external.
    external: ['@aws-sdk/*'],
  });

  console.log(`[build] bundled ${entries.length} handler(s).`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
