import { describe, expect, it } from 'vitest';

import { isHostAllowed, normalizeHostHeader, splitHostAndPort } from '@/lib/edge/host-guard';
import { isIpAllowed } from '@/lib/edge/ip-allowlist';

const PRODUCTION_GUARD = {
  platformHost: 'admin.uniconhub.com',
  allowedDevHosts: ['localhost:3000'],
  isDevelopment: false,
};

const DEVELOPMENT_GUARD = {
  ...PRODUCTION_GUARD,
  isDevelopment: true,
};

describe('host guard', () => {
  it('normalizes case and trailing dots', () => {
    expect(normalizeHostHeader('  Admin.UniconHub.com.  ')).toBe('admin.uniconhub.com');
    expect(normalizeHostHeader(null)).toBe('');
  });

  it('splits host and port, including IPv6 literals', () => {
    expect(splitHostAndPort('admin.uniconhub.com:443')).toEqual({
      hostname: 'admin.uniconhub.com',
      port: '443',
    });
    expect(splitHostAndPort('[::1]:3000')).toEqual({ hostname: '[::1]', port: '3000' });
    expect(splitHostAndPort('::1')).toEqual({ hostname: '::1', port: null });
  });

  it('accepts the platform host with or without the default TLS port', () => {
    expect(isHostAllowed('admin.uniconhub.com', PRODUCTION_GUARD)).toBe(true);
    expect(isHostAllowed('admin.uniconhub.com:443', PRODUCTION_GUARD)).toBe(true);
  });

  it('rejects every tenant or preview host', () => {
    expect(isHostAllowed('acme-travel.cms.uniconhub.com', PRODUCTION_GUARD)).toBe(false);
    expect(isHostAllowed('u-admin-preview.vercel.app', PRODUCTION_GUARD)).toBe(false);
    expect(isHostAllowed('admin.uniconhub.com.evil.test', PRODUCTION_GUARD)).toBe(false);
  });

  it('rejects an empty host', () => {
    expect(isHostAllowed('', PRODUCTION_GUARD)).toBe(false);
    expect(isHostAllowed(null, PRODUCTION_GUARD)).toBe(false);
  });

  it('ignores development hosts in production', () => {
    expect(isHostAllowed('localhost:3000', PRODUCTION_GUARD)).toBe(false);
    expect(isHostAllowed('localhost:3000', DEVELOPMENT_GUARD)).toBe(true);
  });

  it('does not accept a different port on a development hostname', () => {
    expect(isHostAllowed('localhost:4000', DEVELOPMENT_GUARD)).toBe(false);
  });

  it('refuses to run without a configured platform host', () => {
    expect(isHostAllowed('admin.uniconhub.com', { ...PRODUCTION_GUARD, platformHost: '' })).toBe(
      false,
    );
  });
});

describe('IP allowlist', () => {
  it('allows everything when the allowlist is empty', () => {
    expect(isIpAllowed('198.51.100.9', [])).toBe(true);
    expect(isIpAllowed(null, [])).toBe(true);
  });

  it('matches exact IPv4 addresses', () => {
    expect(isIpAllowed('203.0.113.7', ['203.0.113.7'])).toBe(true);
    expect(isIpAllowed('203.0.113.8', ['203.0.113.7'])).toBe(false);
  });

  it('matches IPv4 CIDR ranges', () => {
    expect(isIpAllowed('203.0.113.200', ['203.0.113.0/24'])).toBe(true);
    expect(isIpAllowed('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(isIpAllowed('::ffff:203.0.113.7', ['203.0.113.7'])).toBe(true);
  });

  it('matches exact IPv6 literals', () => {
    expect(isIpAllowed('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(isIpAllowed('2001:db8::2', ['2001:db8::1'])).toBe(false);
  });

  it('fails closed for unknown addresses', () => {
    expect(isIpAllowed('unknown', ['203.0.113.0/24'])).toBe(false);
    expect(isIpAllowed(null, ['203.0.113.0/24'])).toBe(false);
  });

  it('ignores malformed CIDR entries', () => {
    expect(isIpAllowed('203.0.113.7', ['203.0.113.0/99'])).toBe(false);
  });
});
