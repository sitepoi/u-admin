import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const CODE_DIRECTORIES = ['app', 'components', 'lib', 'scripts', 'tests/e2e'];
const CODE_FILES = ['middleware.ts', 'next.config.ts', 'firestore.rules'];

async function collectFiles(
  relativeDirectory: string,
  extensions: readonly string[],
): Promise<string[]> {
  const absoluteDirectory = path.join(PROJECT_ROOT, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relativePath, extensions)));
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(relativePath);
    }
  }
  return files;
}

async function collectSourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const directory of CODE_DIRECTORIES) {
    files.push(...(await collectFiles(directory, ['.ts', '.tsx', '.mjs', '.js'])));
  }
  for (const file of CODE_FILES) {
    files.push(file);
  }
  return files;
}

const FORBIDDEN_ENV_NAMES = [
  'SECRETS_ENC_KEY',
  'SECRETS_FINGERPRINT_KEY',
  'SECRET_API_CMS_ENROLL_TOKEN',
  'SECRET_API_RUNTIME_FETCH_TOKEN',
];

describe('source security scan', () => {
  it('never references an encryption or decryption key we are forbidden to hold', async () => {
    const files = await collectSourceFiles();
    const violations: string[] = [];

    for (const file of files) {
      const contents = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
      for (const forbiddenName of FORBIDDEN_ENV_NAMES) {
        if (contents.includes(forbiddenName)) {
          violations.push(`${file} references ${forbiddenName}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('never exposes a secret through NEXT_PUBLIC_', async () => {
    const files = await collectSourceFiles();
    const violations: string[] = [];
    const publicSecretPattern =
      /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|PASSWORD|CIPHER|SERVICE_TOKEN)/g;

    for (const file of files) {
      const contents = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
      for (const match of contents.matchAll(publicSecretPattern)) {
        violations.push(`${file}: ${match[0]}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('marks every lib/server module with import server-only', async () => {
    const serverFiles = await collectFiles('lib/server', ['.ts']);
    expect(serverFiles.length).toBeGreaterThan(15);

    const violations: string[] = [];
    for (const file of serverFiles) {
      const contents = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
      const header = contents.split('\n').slice(0, 3).join('\n');
      if (!header.includes("import 'server-only';")) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never imports a server module from a client component', async () => {
    const clientFiles = await collectFiles('components', ['.ts', '.tsx']);
    const violations: string[] = [];

    for (const file of clientFiles) {
      const contents = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
      if (!contents.startsWith("'use client';")) continue;
      if (/from ['"]@\/lib\/server\//.test(contents)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never imports the Firestore client SDK', async () => {
    const files = await collectSourceFiles();
    const violations: string[] = [];

    for (const file of files) {
      const contents = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
      if (/from ['"]firebase\/firestore['"]/.test(contents)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never stores secret material in browser storage or the URL', async () => {
    const files = [
      ...(await collectFiles('components/secrets', ['.ts', '.tsx'])),
      ...(await collectFiles('lib/firebase', ['.ts'])),
    ];
    const violations: string[] = [];

    for (const file of files) {
      const contents = await readFile(path.join(PROJECT_ROOT, file), 'utf8');
      for (const pattern of [/localStorage/, /sessionStorage/, /history\.pushState/]) {
        if (pattern.test(contents)) violations.push(`${file}: ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('declares the required API route files', async () => {
    const requiredRoutes = [
      'app/api/auth/session/route.ts',
      'app/api/auth/logout/route.ts',
      'app/api/platform/health/route.ts',
      'app/api/platform/tenants/route.ts',
      'app/api/platform/tenants/[tenantId]/route.ts',
      'app/api/platform/tenants/[tenantId]/provision/route.ts',
      'app/api/platform/secret-metadata/route.ts',
      'app/api/platform/secret-metadata/[secretId]/route.ts',
      'app/api/platform/secrets/[secretId]/reveal/route.ts',
      'app/api/platform/secrets/[secretId]/deliver/route.ts',
      'app/api/platform/secrets/[secretId]/retire/route.ts',
      'app/api/platform/reporting/summary/route.ts',
      'app/api/platform/reporting/refresh/route.ts',
      'app/api/platform/audit/route.ts',
    ];

    for (const routeFile of requiredRoutes) {
      const contents = await readFile(path.join(PROJECT_ROOT, routeFile), 'utf8');
      expect(contents.length).toBeGreaterThan(0);
    }
  });

  it('denies every client read and write in firestore.rules', async () => {
    const rules = await readFile(path.join(PROJECT_ROOT, 'firestore.rules'), 'utf8');
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('match /{document=**}');
    expect(rules).toMatch(/allow read, write: if false;/);
  });

  it('declares the required Firestore indexes', async () => {
    const rawIndexes = await readFile(
      path.join(PROJECT_ROOT, 'firestore.indexes.json'),
      'utf8',
    );
    const parsed = JSON.parse(rawIndexes) as {
      indexes: Array<{
        collectionGroup: string;
        fields: Array<{ fieldPath: string; order: string }>;
      }>;
    };

    const hasIndex = (collectionGroup: string, fields: string[]): boolean =>
      parsed.indexes.some(
        (index) =>
          index.collectionGroup === collectionGroup &&
          fields.every((field) => index.fields.some((entry) => entry.fieldPath === field)) &&
          index.fields.some((entry) => entry.order === 'DESCENDING'),
      );

    expect(hasIndex('platform_audit_log', ['tenantId', 'createdAt'])).toBe(true);
    expect(hasIndex('platform_audit_log', ['action', 'createdAt'])).toBe(true);
    expect(hasIndex('platform_report_snapshots', ['tenantId', 'period'])).toBe(true);
  });
});
