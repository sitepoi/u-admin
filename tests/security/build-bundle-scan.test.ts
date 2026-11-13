import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const STATIC_DIRECTORY = path.join(PROJECT_ROOT, '.next', 'static');

async function collectBuildFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectBuildFiles(absolutePath)));
      continue;
    }
    if (/\.(js|css|json|map|txt|html)$/.test(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

/**
 * The client bundle must never contain server secrets.
 *
 * Run `npm run build` before this suite in CI. When no build output exists the
 * scan is skipped rather than silently passing.
 */
describe.skipIf(!existsSync(STATIC_DIRECTORY))('client bundle secret scan', () => {
  it('does not contain the Secret API service token or key material', async () => {
    const files = await collectBuildFiles(STATIC_DIRECTORY);
    expect(files.length).toBeGreaterThan(0);

    const forbiddenMarkers = [
      process.env.SECRET_API_ADMIN_SERVICE_TOKEN ?? 'test-service-token-do-not-log',
      process.env.CMS_SYSTEM_API_KEY ?? 'test-cms-key-do-not-log',
      'TEST-ADMIN-KEY',
      'TEST-REPORTING-KEY',
      'BEGIN PRIVATE KEY',
      'SECRETS_ENC_KEY',
      'SECRET_API_CMS_ENROLL_TOKEN',
      'SECRET_API_RUNTIME_FETCH_TOKEN',
    ];

    const violations: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const marker of forbiddenMarkers) {
        if (contents.includes(marker)) {
          violations.push(`${path.relative(PROJECT_ROOT, file)} contains ${marker}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not embed the server-only Firebase credentials', async () => {
    const files = await collectBuildFiles(STATIC_DIRECTORY);
    const violations: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      if (contents.includes('PLATFORM_FIREBASE_PRIVATE_KEY')) violations.push(file);
      if (contents.includes('PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON')) violations.push(file);
    }

    expect(violations).toEqual([]);
  });
});
