'use client';

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

let cachedApp: FirebaseApp | null = null;

export function isClientE2eMode(): boolean {
  return process.env.NEXT_PUBLIC_PLATFORM_E2E_MODE === 'true';
}

interface PublicFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function readPublicFirebaseConfig(): PublicFirebaseConfig {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Firebase web configuration is incomplete: ${missing.join(', ')}`);
  }

  return config as PublicFirebaseConfig;
}

/**
 * Firebase JS SDK is used for Authentication in the browser only.
 * Firestore is never initialised in the client: all reads/writes go through
 * Firebase Admin on the server.
 */
export function getFirebaseAuthClient(): Auth {
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(readPublicFirebaseConfig());
  }
  return getAuth(cachedApp);
}
