import { describe, expect, it } from 'vitest';

import {
  RESERVED_TENANT_IDS,
  buildTenantHosts,
  normalizeDomain,
  normalizeDomainList,
  normalizeTenantId,
  validateTenantId,
} from '@/lib/server/tenants/tenant-id';

describe('tenant id policy', () => {
  it('trims and lowercases ids', () => {
    expect(normalizeTenantId('  Acme-Travel  ')).toBe('acme-travel');
  });

  it('accepts the documented pattern', () => {
    expect(validateTenantId('acme-travel').ok).toBe(true);
    expect(validateTenantId('a1').ok).toBe(true);
    expect(validateTenantId('A'.repeat(63)).ok).toBe(true);
  });

  it('normalises before matching so case variants are the same id', () => {
    const result = validateTenantId('ACME-Travel');
    expect(result).toEqual({ ok: true, tenantId: 'acme-travel' });
  });

  it('rejects ids shorter than 2 characters', () => {
    const result = validateTenantId('a');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_REQUEST');
  });

  it('rejects ids longer than 63 characters', () => {
    expect(validateTenantId('a'.repeat(64)).ok).toBe(false);
  });

  it('rejects leading hyphens, spaces and underscores', () => {
    expect(validateTenantId('-acme').ok).toBe(false);
    expect(validateTenantId('acme travel').ok).toBe(false);
    expect(validateTenantId('acme_travel').ok).toBe(false);
  });

  it('rejects every reserved id with TENANT_RESERVED', () => {
    for (const reservedId of RESERVED_TENANT_IDS) {
      const result = validateTenantId(reservedId);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('TENANT_RESERVED');
    }
    expect(RESERVED_TENANT_IDS.size).toBe(9);
  });

  it('builds lower-case default hosts from the tenant id', () => {
    const hosts = buildTenantHosts('Acme-Travel', {
      cmsHostSuffix: 'CMS.uniconhub.com',
      publicwebsiteHostSuffix: 'PublicWebsite.uniconhub.com',
    });
    expect(hosts.cmsHost).toBe('acme-travel.cms.uniconhub.com');
    expect(hosts.publicwebsiteHost).toBe('acme-travel.publicwebsite.uniconhub.com');
  });
});

describe('domain normalization', () => {
  it('normalizes schemes, ports, paths and trailing dots', () => {
    expect(normalizeDomain('https://WWW.Acme-Travel.com/path?x=1')).toBe('www.acme-travel.com');
    expect(normalizeDomain('acme-travel.com:443')).toBe('acme-travel.com');
    expect(normalizeDomain('acme-travel.com.')).toBe('acme-travel.com');
  });

  it('rejects invalid hostnames', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('bad host.com')).toBeNull();
    expect(normalizeDomain('-bad.com')).toBeNull();
  });

  it('deduplicates a normalized domain list', () => {
    expect(normalizeDomainList(['acme.com', 'ACME.com', 'https://www.acme.com'])).toEqual([
      'acme.com',
      'www.acme.com',
    ]);
  });

  it('returns null when any domain is invalid', () => {
    expect(normalizeDomainList(['acme.com', 'not a domain'])).toBeNull();
  });
});
