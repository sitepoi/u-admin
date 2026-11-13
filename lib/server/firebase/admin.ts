import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { getAdminFirebaseConfig } from '@/lib/server/env';

const ADMIN_APP_NAME = 'platform-admin';

let cachedAdminApp: App | null = null;

/**
 * The Admin app's own Firebase project. It is deliberately separate from every
 * tenant project and from the Secret API vault project.
 */
export function getPlatformAdminApp(): App {
  if (cachedAdminApp) return cachedAdminApp;

  const existingApp = getApps().find((candidateApp) => candidateApp.name === ADMIN_APP_NAME);
  if (existingApp) {
    cachedAdminApp = existingApp;
    return existingApp;
  }

  const config = getAdminFirebaseConfig();
  cachedAdminApp = initializeApp(
    {
      credential: cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
      projectId: config.projectId,
    },
    ADMIN_APP_NAME,
  );
  return cachedAdminApp;
}

export function getPlatformAuth(): Auth {
  return getAuth(getPlatformAdminApp());
}

export function getPlatformFirestore(): Firestore {
  return getFirestore(getPlatformAdminApp());
}

/** Test-only: drops the memoised app so a fresh environment can initialise. */
export function resetPlatformAdminAppForTesting(): void {
  cachedAdminApp = null;
}
