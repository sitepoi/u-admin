/**
 * Local demo runner.
 *
 * Starts:
 * - the mock Secret API + CMS system API (tests/e2e/upstreams.mjs)
 * - `next dev` with PLATFORM_E2E_MODE enabled
 *
 * No Firebase project, Secret API or CMS is required. The login page shows
 * "Sign in as owner/admin/operator/auditor" buttons.
 *
 * E2E mode is refused when NODE_ENV=production or on Vercel, so this script can
 * never weaken a real deployment.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

const MOCK_PORT = process.env.MOCK_UPSTREAM_PORT ?? '4100';

function parsePort(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if ((argument === '--port' || argument === '-p') && argv[index + 1]) {
      return Number.parseInt(argv[index + 1], 10);
    }
    if (argument.startsWith('--port=')) {
      return Number.parseInt(argument.slice('--port='.length), 10);
    }
  }
  return 3000;
}

const APP_PORT = parsePort(process.argv.slice(2));
if (!Number.isInteger(APP_PORT) || APP_PORT < 1 || APP_PORT > 65535) {
  process.stderr.write('Invalid --port value.\n');
  process.exit(1);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

const portAvailable = await isPortAvailable(APP_PORT);
if (!portAvailable) {
  process.stderr.write(
    [
      '',
      `Port ${APP_PORT} is already in use.`,
      'Stop the other dev server (Ctrl+C in its terminal), or run:',
      `  npm run dev:demo -- --port ${APP_PORT + 1}`,
      '',
      'Note: a stale Next.js dev server also holds .next/dev/lock. If in doubt,',
      'stop the process shown by Next.js or remove .next/dev/lock.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const demoEnv = {
  ...process.env,
  // Demo mode: in-memory store + local test identity, no Firebase required.
  PLATFORM_E2E_MODE: 'true',
  NEXT_PUBLIC_PLATFORM_E2E_MODE: 'true',
  PLATFORM_E2E_SESSION_SECRET: 'local-demo-session-secret',
  // Host guard. These also exist in .env.local, but keep the demo self-contained.
  PLATFORM_HOST: process.env.PLATFORM_HOST ?? 'admin.uniconhub.com',
  PLATFORM_ALLOWED_DEV_HOSTS: `localhost:${APP_PORT},127.0.0.1:${APP_PORT}`,
  PLATFORM_SESSION_TTL_HOURS: process.env.PLATFORM_SESSION_TTL_HOURS ?? '8',
  PLATFORM_REVEAL_FRESH_AUTH_SECONDS: process.env.PLATFORM_REVEAL_FRESH_AUTH_SECONDS ?? '300',
  PLATFORM_ADMIN_EMAILS:
    process.env.PLATFORM_ADMIN_EMAILS ??
    'owner@uniconhub.com,admin@uniconhub.com,operator@uniconhub.com,auditor@uniconhub.com',
  PLATFORM_IP_ALLOWLIST: '',
  // Mock upstreams.
  SECRET_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  SECRET_API_ADMIN_SERVICE_TOKEN: 'e2e-secret-api-token',
  SECRET_API_TIMEOUT_MS: '5000',
  CMS_SYSTEM_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  CMS_SYSTEM_API_KEY: 'e2e-cms-key',
  CMS_SYSTEM_API_TIMEOUT_MS: '10000',
  PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON: JSON.stringify({
    type: 'service_account',
    project_id: 'local-demo-reporting',
    client_email: 'reporting@local-demo-reporting.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nLOCAL-DEMO-NOT-A-KEY\\n-----END PRIVATE KEY-----\\n',
  }),
  PLATFORM_REPORTING_MAX_CONCURRENCY: '3',
  PLATFORM_REPORTING_TENANT_TIMEOUT_MS: '3000',
  // Dummy Firebase web config so client modules initialise if touched.
  NEXT_PUBLIC_FIREBASE_API_KEY: 'local-demo-public-key',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'local-demo.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'local-demo',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:local-demo',
  PLATFORM_FIREBASE_PROJECT_ID: 'local-demo',
  PLATFORM_FIREBASE_CLIENT_EMAIL: 'local-demo@local-demo.iam.gserviceaccount.com',
  PLATFORM_FIREBASE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nLOCAL-DEMO-NOT-A-KEY\\n-----END PRIVATE KEY-----\\n',
};

function killChild(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Process already gone.
    }
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Process already gone.
  }
}

const upstreamProcess = spawn(process.execPath, ['tests/e2e/upstreams.mjs'], {
  env: {
    ...demoEnv,
    MOCK_UPSTREAM_PORT: MOCK_PORT,
  },
  stdio: 'inherit',
});

const nextProcess = spawn(
  process.execPath,
  [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(APP_PORT)],
  {
    env: demoEnv,
    stdio: 'inherit',
  },
);

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killChild(upstreamProcess);
  killChild(nextProcess);
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

nextProcess.on('exit', (code) => shutdown(code ?? 0));
upstreamProcess.on('exit', (code) => {
  if (!shuttingDown && code !== 0) {
    process.stderr.write(`\nMock upstreams exited with code ${code}.\n`);
    shutdown(code ?? 1);
  }
});

process.stdout.write(
  [
    '',
    'UniconHub Platform Admin - local demo',
    '------------------------------------',
    `Open:    http://localhost:${APP_PORT}/login`,
    'Sign in: click "Sign in as owner" (no Firebase required)',
    `Mocks:   http://127.0.0.1:${MOCK_PORT} (Secret API + CMS system API)`,
    '',
    'Data is in memory and resets when the server stops.',
    'Press Ctrl+C to stop both processes. If the terminal closes early,',
    'run `npm run dev:stop` to release ports 3000 and 4100.',
    '',
  ].join('\n'),
);
