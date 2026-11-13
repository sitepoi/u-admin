#!/usr/bin/env node
/**
 * Enables TOTP (authenticator app) multi-factor authentication on the platform
 * Firebase project, and optionally marks an admin user's email as verified.
 *
 * The Admin app refuses every session without a second factor, so the platform
 * project must accept authenticator-app enrolment before /mfa-enroll can work.
 * Firebase only documents this as an Admin SDK / REST project-config change.
 *
 * Usage:
 *   node --env-file=.env.local scripts/enable-totp-mfa.mjs
 *   node --env-file=.env.local scripts/enable-totp-mfa.mjs --verify-email name@uniconhub.com
 *   node --env-file=.env.local scripts/enable-totp-mfa.mjs --intervals=5
 *
 * Credentials, in order of precedence:
 *   1. PLATFORM_FIREBASE_PROJECT_ID + PLATFORM_FIREBASE_CLIENT_EMAIL +
 *      PLATFORM_FIREBASE_PRIVATE_KEY (the same values the server uses),
 *   2. GOOGLE_APPLICATION_CREDENTIALS pointing at a service account JSON,
 *   3. Application Default Credentials (gcloud auth application-default login).
 *
 * The service account needs permission to update the Identity Platform project
 * configuration (Firebase Authentication Admin, or Editor on the project).
 */

import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const DEFAULT_ADJACENT_INTERVALS = 5;
const MAX_ADJACENT_INTERVALS = 10;

function readArgument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseAdjacentIntervals() {
  const rawValue = readArgument('intervals');
  if (rawValue === null) return DEFAULT_ADJACENT_INTERVALS;

  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > MAX_ADJACENT_INTERVALS) {
    fail(`--intervals must be an integer between 0 and ${MAX_ADJACENT_INTERVALS}.`);
  }
  return parsedValue;
}

function buildCredential() {
  const projectId = process.env.PLATFORM_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.PLATFORM_FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.PLATFORM_FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && rawPrivateKey) {
    return {
      projectId,
      credential: cert({
        projectId,
        clientEmail,
        privateKey: rawPrivateKey.replace(/\\n/g, '\n'),
      }),
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { projectId, credential: applicationDefault() };
  }

  fail(
    'No Firebase credentials found.\n' +
      'Set PLATFORM_FIREBASE_PROJECT_ID, PLATFORM_FIREBASE_CLIENT_EMAIL and ' +
      'PLATFORM_FIREBASE_PRIVATE_KEY (for example in .env.local and run with ' +
      'node --env-file=.env.local), or set GOOGLE_APPLICATION_CREDENTIALS.',
  );
}

function mergeTotpProviderConfig(existingConfig, adjacentIntervals) {
  const existingProviders = existingConfig?.providerConfigs ?? [];
  const otherProviders = existingProviders.filter(
    (providerConfig) => !('totpProviderConfig' in providerConfig),
  );

  return [
    ...otherProviders,
    {
      state: 'ENABLED',
      totpProviderConfig: { adjacentIntervals },
    },
  ];
}

async function main() {
  const adjacentIntervals = parseAdjacentIntervals();
  const emailToVerify = readArgument('verify-email');
  const { projectId, credential } = buildCredential();

  const app = initializeApp({ credential, projectId }, 'enable-totp-mfa');
  const auth = getAuth(app);
  const projectConfigManager = auth.projectConfigManager();

  console.log('Reading current project configuration...');
  const currentConfig = await projectConfigManager.getProjectConfig();
  const currentMfaConfig = currentConfig.multiFactorConfig;
  console.log(
    `Current MFA: ${currentMfaConfig?.state ?? 'DISABLED'} ` +
      `(${currentMfaConfig?.providerConfigs?.length ?? 0} provider config(s)).`,
  );

  const updatedConfig = await projectConfigManager.updateProjectConfig({
    multiFactorConfig: {
      state: 'ENABLED',
      providerConfigs: mergeTotpProviderConfig(currentMfaConfig, adjacentIntervals),
    },
  });

  console.log('Updated MFA configuration:');
  console.log(`  state: ${updatedConfig.multiFactorConfig?.state ?? 'unknown'}`);
  for (const providerConfig of updatedConfig.multiFactorConfig?.providerConfigs ?? []) {
    if ('totpProviderConfig' in providerConfig) {
      console.log(
        `  authenticator app (TOTP): ${providerConfig.state}, ` +
          `adjacent intervals ${providerConfig.totpProviderConfig?.adjacentIntervals ?? 'default'}`,
      );
    } else {
      console.log(`  ${providerConfig.state} provider: ${JSON.stringify(providerConfig)}`);
    }
  }

  if (emailToVerify) {
    console.log(`\nMarking ${emailToVerify} as email-verified...`);
    const user = await auth.getUserByEmail(emailToVerify);
    if (user.emailVerified) {
      console.log('  already verified.');
    } else {
      await auth.updateUser(user.uid, { emailVerified: true });
      console.log('  verified. MFA requires a verified email.');
    }
  }

  console.log('\nDone. Retry /mfa-enroll in the Admin app.');
}

main().catch((error) => {
  const code = typeof error?.code === 'string' ? error.code : 'unknown';
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nFailed (${code}): ${message}`);

  if (code === 'auth/insufficient-permission' || message.includes('PERMISSION_DENIED')) {
    console.error(
      'The service account needs Firebase Authentication Admin (or Editor) on the project.',
    );
  }
  if (message.toLowerCase().includes('identity platform')) {
    console.error(
      'Enable Identity Platform for the project first (Firebase console -> Authentication -> ' +
        'Settings -> Upgrade, or Google Cloud console -> Identity Platform). Billing is required.',
    );
  }

  process.exitCode = 1;
});
