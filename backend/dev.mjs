// Backend local-dev entry point.
//
// The backend runs as AWS Lambda behind API Gateway; locally it is served with
// `sam local start-api`, which requires the AWS SAM CLI and Docker. If SAM is
// not installed we exit cleanly with guidance instead of crashing, so a
// frontend-only workflow (or a fan-out `npm run dev`) is never broken.

import { spawnSync } from 'node:child_process';

function has(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
}

if (!has('sam')) {
  console.log(
    [
      '',
      '[backend] The AWS SAM CLI is not installed, so the local backend API cannot start.',
      '',
      '  The frontend runs fully on in-memory synthetic demo data and needs NO backend:',
      '      npm run dev            (from the repo root -> http://localhost:5173)',
      '',
      '  To run the real backend locally you need the SAM CLI + Docker, then:',
      '      sam local start-api -t infra/template.yaml',
      '  Install SAM: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html',
      '',
    ].join('\n'),
  );
  process.exit(0); // not an error — nothing to run here
}

const res = spawnSync('sam', ['local', 'start-api', '-t', '../infra/template.yaml'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(res.status ?? 0);
