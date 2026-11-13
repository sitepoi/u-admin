/**
 * Sets the `platformRole` custom claim on an existing Firebase Auth user in the
 * Admin app's own Firebase project.
 *
 * Usage:
 *   npm run set-platform-role -- --email owner@uniconhub.com --role owner
 *   npm run set-platform-role -- --email ops@uniconhub.com --role operator --yes
 *
 * The user must already exist (create it in the Firebase console) and must have
 * enrolled a second factor. The claim only grants the platform role: the app
 * still requires the email allowlist and MFA on every session.
 *
 * This script never prints or writes a token, password or private key.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/**
 * Minimal .env loader so the script works with the same .env.local as the app
 * (tsx does not load Next.js env files automatically).
 */
function loadEnvFile(fileName: string): void {
  if (!existsSync(fileName)) return;
  const contents = readFileSync(fileName, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const PLATFORM_ROLES = ['owner', 'admin', 'operator', 'auditor'] as const;
type PlatformRole = (typeof PLATFORM_ROLES)[number];

interface ScriptOptions {
  email: string;
  role: PlatformRole;
  skipConfirmation: boolean;
}

function readFlag(argv: readonly string[], flagName: string): string | null {
  const flagIndex = argv.indexOf(flagName);
  if (flagIndex === -1) return null;
  const value = argv[flagIndex + 1];
  if (!value || value.startsWith('--')) return null;
  return value.trim();
}

function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

function requireEnv(name: string): string {
  const value = (process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function resolveOptions(argv: readonly string[]): Promise<ScriptOptions> {
  let email = readFlag(argv, '--email') ?? '';
  let role = readFlag(argv, '--role') ?? '';
  const skipConfirmation = argv.includes('--yes');

  if (!email || !role) {
    const readline = createInterface({ input: stdin, output: stdout });
    try {
      if (!email) {
        email = (await readline.question('Firebase Auth email: ')).trim();
      }
      if (!role) {
        role = (await readline.question(`Platform role (${PLATFORM_ROLES.join(', ')}): `)).trim();
      }
    } finally {
      readline.close();
    }
  }

  if (!email.includes('@')) {
    throw new Error('A valid email address is required.');
  }
  if (!isPlatformRole(role)) {
    throw new Error(`Role must be one of: ${PLATFORM_ROLES.join(', ')}`);
  }

  return { email: email.toLowerCase(), role, skipConfirmation };
}

async function confirm(options: ScriptOptions): Promise<boolean> {
  if (options.skipConfirmation) return true;

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question(
      `Set platformRole="${options.role}" for ${options.email}? Type "yes" to continue: `,
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    readline.close();
  }
}

async function main(): Promise<void> {
  const options = await resolveOptions(process.argv.slice(2));

  const projectId = requireEnv('PLATFORM_FIREBASE_PROJECT_ID');
  const clientEmail = requireEnv('PLATFORM_FIREBASE_CLIENT_EMAIL');
  const privateKey = requireEnv('PLATFORM_FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n');

  if (!(await confirm(options))) {
    process.stdout.write('Aborted. No claim was changed.\n');
    return;
  }

  const app =
    getApps().find((candidateApp) => candidateApp.name === 'platform-admin-role-script') ??
    initializeApp(
      {
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
      },
      'platform-admin-role-script',
    );

  const auth = getAuth(app);

  let user;
  try {
    user = await auth.getUserByEmail(options.email);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'auth/user-not-found') {
      throw new Error(
        `No Firebase Auth user exists for ${options.email}. Create the user in the Firebase console first, then re-run this script.`,
      );
    }
    throw error;
  }

  const existingClaims = user.customClaims ?? {};
  await auth.setCustomUserClaims(user.uid, {
    ...existingClaims,
    platformRole: options.role,
  });

  // Custom claims are carried in the ID token, so the user must obtain a new
  // token before the role takes effect.
  await auth.revokeRefreshTokens(user.uid);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        uid: user.uid,
        email: options.email,
        platformRole: options.role,
        note: 'Existing refresh tokens were revoked. The user must sign in again, and must be listed in PLATFORM_ADMIN_EMAILS and have MFA enrolled.',
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `set-platform-role failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
});
