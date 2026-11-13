import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as createSession } from '@/app/api/auth/session/route';
import { logError, logInfo, logWarn } from '@/lib/server/logging/logger';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import { setPlatformStoreForTesting } from '@/lib/server/firestore/store-provider';
import { setTokenVerifierForTesting } from '@/lib/server/auth/token-verifier-provider';
import {
  FakeTokenVerifier,
  buildRequest,
  makeIdentity,
} from '@/tests/support/test-helpers';

const PRIVATE_KEY_MARKER = '-----BEGIN PRIVATE KEY-----\nTOP-SECRET\n-----END PRIVATE KEY-----';
const FIREBASE_ID_TOKEN = 'test-id-token-owner-00000001';

function captureConsole(): { lines: string[] } {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(' '));
  };
  vi.spyOn(console, 'info').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  return { lines };
}

describe('log secret scanning', () => {
  beforeEach(() => {
    setPlatformStoreForTesting(new InMemoryPlatformStore());
    const verifier = new FakeTokenVerifier();
    setTokenVerifierForTesting(verifier);
    verifier.registerIdToken(FIREBASE_ID_TOKEN, makeIdentity());
  });

  it('redacts private key markers passed to the logger', () => {
    const { lines } = captureConsole();

    logInfo('test.info', { privateKeyPem: PRIVATE_KEY_MARKER, nested: { key: PRIVATE_KEY_MARKER } });
    logWarn('test.warn', { message: `Reveal returned ${PRIVATE_KEY_MARKER}` });
    logError('test.error', { error: new Error(`failed with ${PRIVATE_KEY_MARKER}`) });

    const combinedLogs = lines.join('\n');
    expect(combinedLogs).toContain('[REDACTED]');
    expect(combinedLogs).not.toContain('TOP-SECRET');
    expect(combinedLogs).not.toContain('BEGIN PRIVATE KEY');
  });

  it('never logs the Firebase ID token during session creation', async () => {
    const { lines } = captureConsole();

    const response = await createSession(
      buildRequest({
        path: '/api/auth/session',
        method: 'POST',
        body: { idToken: FIREBASE_ID_TOKEN },
      }),
    );

    expect(response.status).toBe(200);
    const combinedLogs = lines.join('\n');
    expect(combinedLogs).not.toContain(FIREBASE_ID_TOKEN);
    expect(combinedLogs).not.toContain('test-service-token-do-not-log');
    expect(combinedLogs).toContain('api.request');
  });
});
