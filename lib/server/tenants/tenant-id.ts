import 'server-only';

import type { ApiErrorCode } from '@/lib/server/errors';

/**
 * Tenant identifier policy.
 *
 * - trimmed
 * - lower-cased for lookup and host generation
 * - `^[a-z0-9][a-z0-9-]{1,62}$`
 * - reserved ids rejected
 * - duplicates are rejected case-insensitively because the normalized id is the
 *   Firestore document id
 */
export const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export const RESERVED_TENANT_IDS: ReadonlySet<string> = new Set([
  'admin',
  'console',
  'platform',
  'secrets',
  'issuer',
  'app-issuer',
  'publicwebsite-service',
  'publicwebsite-app-issuer-service',
  'publicwebsite-issuer',
]);

export type TenantIdValidationResult =
  | { ok: true; tenantId: string }
  | { ok: false; code: ApiErrorCode; message: string };

export function normalizeTenantId(rawTenantId: string): string {
  return rawTenantId.trim().toLowerCase();
}

export function validateTenantId(rawTenantId: string): TenantIdValidationResult {
  const tenantId = normalizeTenantId(rawTenantId);

  if (!tenantId) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Tenant id is required.' };
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return {
      ok: false,
      code: 'INVALID_REQUEST',
      message:
        'Tenant id must be 2-63 characters of lowercase letters, digits or hyphens and start with a letter or digit.',
    };
  }
  if (RESERVED_TENANT_IDS.has(tenantId)) {
    return {
      ok: false,
      code: 'TENANT_RESERVED',
      message: 'This tenant id is reserved by the platform.',
    };
  }

  return { ok: true, tenantId };
}

export function buildTenantHosts(
  tenantId: string,
  suffixes: { cmsHostSuffix: string; publicwebsiteHostSuffix: string },
): { cmsHost: string; publicwebsiteHost: string; primaryDomain: string } {
  const normalizedTenantId = normalizeTenantId(tenantId);
  return {
    cmsHost: `${normalizedTenantId}.${suffixes.cmsHostSuffix.toLowerCase()}`,
    publicwebsiteHost: `${normalizedTenantId}.${suffixes.publicwebsiteHostSuffix.toLowerCase()}`,
    primaryDomain: '',
  };
}

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Normalises a hostname/domain entered by an operator. Rejects schemes, paths
 * and anything that is not a plain DNS name.
 */
export function normalizeDomain(rawDomain: string): string | null {
  let domain = rawDomain.trim().toLowerCase();
  if (!domain) return null;

  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.split('/')[0] ?? '';
  domain = domain.replace(/:\d+$/, '');
  domain = domain.replace(/\.$/, '');

  if (!HOSTNAME_PATTERN.test(domain)) return null;
  return domain;
}

export function normalizeDomainList(rawDomains: readonly string[]): string[] | null {
  const normalized: string[] = [];
  for (const rawDomain of rawDomains) {
    const domain = normalizeDomain(rawDomain);
    if (!domain) return null;
    if (!normalized.includes(domain)) normalized.push(domain);
  }
  return normalized;
}
