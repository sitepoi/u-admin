import { describe, expect, it } from 'vitest';

import { PLATFORM_ROLES, type PlatformRole } from '@/lib/shared/constants';
import {
  ALL_PERMISSIONS,
  ROLE_MATRIX_ROWS,
  assertRoleCan,
  permissionsForRole,
  roleCan,
  roleCanAny,
  type Permission,
} from '@/lib/server/auth/roles';
import { ApiError } from '@/lib/server/errors';

/**
 * The acceptance matrix from the specification. Every cell is asserted
 * explicitly; adding a permission without updating this table fails the suite.
 */
const EXPECTED_MATRIX: Record<Permission, readonly PlatformRole[]> = {
  'platform:read': ['owner', 'admin', 'operator', 'auditor'],
  'project:manage': ['owner', 'admin'],
  'tenant:write': ['owner', 'admin', 'operator'],
  'tenant:provision': ['owner', 'admin'],
  'tenant:archive': ['owner'],
  'secret:metadata:read': ['owner', 'admin', 'operator'],
  'secret:reveal': ['owner'],
  'secret:deliver': ['owner', 'admin'],
  'secret:retire': ['owner'],
  'reporting:refresh': ['owner', 'admin'],
  'audit:read': ['owner', 'admin', 'auditor'],
  'settings:manage': ['owner'],
};

describe('platform role matrix', () => {
  it('covers every permission', () => {
    expect(Object.keys(EXPECTED_MATRIX).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  for (const permission of ALL_PERMISSIONS) {
    for (const role of PLATFORM_ROLES) {
      const expected = EXPECTED_MATRIX[permission].includes(role);
      it(`${role} can${expected ? '' : 'not'} ${permission}`, () => {
        expect(roleCan(role, permission)).toBe(expected);
      });
    }
  }

  it('grants every role dashboard access', () => {
    for (const role of PLATFORM_ROLES) {
      expect(roleCan(role, 'platform:read')).toBe(true);
    }
  });

  it('restricts reveal and retire to owners only', () => {
    const nonOwners = PLATFORM_ROLES.filter((role) => role !== 'owner');
    for (const role of nonOwners) {
      expect(roleCan(role, 'secret:reveal')).toBe(false);
      expect(roleCan(role, 'secret:retire')).toBe(false);
    }
  });

  it('lists permissions per role', () => {
    expect(permissionsForRole('auditor')).toEqual(['platform:read', 'audit:read']);
    expect(permissionsForRole('operator')).not.toContain('tenant:provision');
    expect(permissionsForRole('admin')).toContain('tenant:provision');
  });

  it('supports any-of checks', () => {
    expect(roleCanAny('operator', ['tenant:provision', 'tenant:write'])).toBe(true);
    expect(roleCanAny('auditor', ['tenant:provision', 'secret:deliver'])).toBe(false);
  });

  it('throws FORBIDDEN from assertRoleCan', () => {
    expect(() => assertRoleCan('operator', 'secret:reveal')).toThrow(ApiError);
    try {
      assertRoleCan('operator', 'secret:reveal');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('FORBIDDEN');
    }
  });

  it('renders a complete matrix for the settings page', () => {
    expect(ROLE_MATRIX_ROWS).toHaveLength(ALL_PERMISSIONS.length);
    const renderedPermissions = ROLE_MATRIX_ROWS.map((row) => row.permission);
    expect(new Set(renderedPermissions).size).toBe(ALL_PERMISSIONS.length);
  });
});
