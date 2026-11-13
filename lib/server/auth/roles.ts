import 'server-only';

import type { PlatformRole } from '@/lib/shared/constants';
import { ApiError } from '@/lib/server/errors';

/**
 * The single source of truth for the role matrix. Every permission check in the
 * application resolves through `roleCan`.
 */
export const PERMISSIONS = {
  /** Dashboard and tenant visibility. */
  'platform:read': ['owner', 'admin', 'operator', 'auditor'],
  /** Create / edit tenant metadata. */
  'tenant:write': ['owner', 'admin', 'operator'],
  /** Run the provisioning workflow. */
  'tenant:provision': ['owner', 'admin'],
  /** Archive (never hard-delete) a tenant. */
  'tenant:archive': ['owner'],
  /** View first-party secret metadata. Never includes private keys. */
  'secret:metadata:read': ['owner', 'admin', 'operator'],
  /** Decrypt / reveal a private key (delegated to the Secret API). */
  'secret:reveal': ['owner'],
  /** Deliver a secret to the CMS / Vercel. */
  'secret:deliver': ['owner', 'admin'],
  /** Retire a secret. */
  'secret:retire': ['owner'],
  /** Refresh cross-tenant oversight reporting. */
  'reporting:refresh': ['owner', 'admin'],
  /** Read the platform audit log. */
  'audit:read': ['owner', 'admin', 'auditor'],
  /** Manage platform settings. */
  'settings:manage': ['owner'],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function roleCan(role: PlatformRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly PlatformRole[]).includes(role);
}

export function roleCanAny(role: PlatformRole, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => roleCan(role, permission));
}

export function permissionsForRole(role: PlatformRole): Permission[] {
  return ALL_PERMISSIONS.filter((permission) => roleCan(role, permission));
}

export function assertRoleCan(role: PlatformRole, permission: Permission): void {
  if (!roleCan(role, permission)) {
    throw ApiError.forbidden('Your role does not permit this action.');
  }
}

/**
 * Presentation helper for the UI. Key order is stable so tables render the same
 * way in every environment.
 */
export const ROLE_MATRIX_ROWS: ReadonlyArray<{
  label: string;
  permission: Permission;
}> = [
  { label: 'View dashboard and tenants', permission: 'platform:read' },
  { label: 'Create/edit tenant metadata', permission: 'tenant:write' },
  { label: 'Provision tenant', permission: 'tenant:provision' },
  { label: 'View secret metadata', permission: 'secret:metadata:read' },
  { label: 'Reveal private key', permission: 'secret:reveal' },
  { label: 'Deliver secret', permission: 'secret:deliver' },
  { label: 'Retire secret', permission: 'secret:retire' },
  { label: 'Refresh reporting', permission: 'reporting:refresh' },
  { label: 'View audit', permission: 'audit:read' },
  { label: 'Manage platform settings', permission: 'settings:manage' },
  { label: 'Archive tenant', permission: 'tenant:archive' },
];
