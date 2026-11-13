/**
 * Values shared by the browser, the edge middleware and the Node.js server.
 * This module must stay free of Node-only or server-only imports.
 */

export const PLATFORM_SESSION_COOKIE = '__Host-platform_session';
export const PLATFORM_CSRF_COOKIE = '__Host-platform_csrf';
export const PLATFORM_CSRF_HEADER = 'x-csrf-token';

export const PLATFORM_ROLES = ['owner', 'admin', 'operator', 'auditor'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const TENANT_STATUSES = [
  'draft',
  'provisioning',
  'active',
  'suspended',
  'archived',
  'failed',
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const DELIVERY_MODES = ['manual', 'runtime-fetch', 'vercel-env'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const FIRST_PARTY_STATUSES = ['not-enrolled', 'enrolled', 'rotation-due', 'failed'] as const;
export type FirstPartyStatus = (typeof FIRST_PARTY_STATUSES)[number];

export const PROVISIONING_STATUSES = ['idle', 'running', 'succeeded', 'failed'] as const;
export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];

export const SECRET_API_DELIVERY_MODES = DELIVERY_MODES;

export const FIRST_PARTY_APP_ID = 'publicwebsite' as const;

/** Maximum accepted request body size for JSON admin actions (bytes). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Upper bound for any tenant list the UI renders at once. */
export const TENANT_LIST_PAGE_SIZE = 100;

/** Upper bound for audit rows returned by the audit API. */
export const AUDIT_PAGE_SIZE = 100;

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);
}
