import 'server-only';

import type { TenantStatus } from '@/lib/shared/constants';
import type { TenantDetail, TenantListItem } from '@/lib/shared/platform-types';
import { ApiError } from '@/lib/server/errors';
import { getCmsConfig } from '@/lib/server/env';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import type { TenantPatch, TenantRecord } from '@/lib/server/firestore/store';
import type { PlatformSession } from '@/lib/server/auth/session';
import {
  buildTenantHosts,
  normalizeDomain,
  normalizeDomainList,
  normalizeTenantId,
  validateTenantId,
} from '@/lib/server/tenants/tenant-id';
import type { CreateTenantRequest, UpdateTenantRequest } from '@/lib/server/validation/schemas';

export interface TenantSearchFilters {
  search?: string;
  status?: TenantStatus | 'all';
}

export function toTenantListItem(tenant: TenantRecord): TenantListItem {
  return {
    tenantId: tenant.tenantId,
    displayName: tenant.displayName,
    status: tenant.status,
    cmsHost: tenant.cmsHost,
    publicwebsiteHost: tenant.publicwebsiteHost,
    primaryDomain: tenant.primaryDomain,
    deliveryMode: tenant.deliveryMode,
    firstPartyStatus: tenant.firstPartyStatus,
    updatedAt: tenant.updatedAt,
    provisioningStatus: tenant.provisioning.status,
    lastError: tenant.provisioning.lastError ?? tenant.reporting.lastError,
    lastReportingRefreshAt: tenant.reporting.lastRefreshAt,
  };
}

export function filterTenants(
  tenants: readonly TenantRecord[],
  filters: TenantSearchFilters,
): TenantRecord[] {
  const searchTerm = (filters.search ?? '').trim().toLowerCase();
  return tenants.filter((tenant) => {
    if (filters.status && filters.status !== 'all' && tenant.status !== filters.status) {
      return false;
    }
    if (!searchTerm) return true;
    const haystacks = [
      tenant.tenantId,
      tenant.displayName,
      tenant.cmsHost,
      tenant.publicwebsiteHost,
      tenant.primaryDomain,
      ...tenant.customDomains,
    ];
    return haystacks.some((value) => value.toLowerCase().includes(searchTerm));
  });
}

export async function listTenants(
  filters: TenantSearchFilters = {},
): Promise<TenantRecord[]> {
  const tenants = await getPlatformStore().listTenants();
  return filterTenants(tenants, filters);
}

export async function getTenantOrThrow(tenantIdInput: string): Promise<TenantRecord> {
  const tenantId = normalizeTenantId(tenantIdInput);
  const tenant = await getPlatformStore().getTenant(tenantId);
  if (!tenant) {
    throw ApiError.notFound('tenant');
  }
  return tenant;
}

function resolveDomainOrThrow(rawDomain: string, fieldName: string): string {
  const domain = normalizeDomain(rawDomain);
  if (!domain) {
    throw ApiError.invalidRequest(`${fieldName} must be a valid hostname.`);
  }
  return domain;
}

function resolveDomainListOrThrow(rawDomains: readonly string[]): string[] {
  const domains = normalizeDomainList(rawDomains);
  if (!domains) {
    throw ApiError.invalidRequest('customDomains contains an invalid hostname.');
  }
  return domains;
}

export async function createTenant(
  request: CreateTenantRequest,
  actor: PlatformSession,
): Promise<TenantRecord> {
  const validation = validateTenantId(request.tenantId);
  if (!validation.ok) {
    throw new ApiError(validation.code, validation.message);
  }
  const tenantId = validation.tenantId;

  const cmsConfig = getCmsConfig();
  const defaultHosts = buildTenantHosts(tenantId, {
    cmsHostSuffix: cmsConfig.cmsHostSuffix,
    publicwebsiteHostSuffix: cmsConfig.publicwebsiteHostSuffix,
  });

  const customDomains = request.customDomains
    ? resolveDomainListOrThrow(request.customDomains)
    : [];
  const primaryDomain = request.primaryDomain
    ? resolveDomainOrThrow(request.primaryDomain, 'primaryDomain')
    : '';
  const cmsHost = request.cmsHost
    ? resolveDomainOrThrow(request.cmsHost, 'cmsHost')
    : defaultHosts.cmsHost;
  const publicwebsiteHost = request.publicwebsiteHost
    ? resolveDomainOrThrow(request.publicwebsiteHost, 'publicwebsiteHost')
    : defaultHosts.publicwebsiteHost;

  const timestamp = new Date().toISOString();
  const record: TenantRecord = {
    tenantId,
    displayName: request.displayName.trim(),
    status: 'draft',
    cmsProjectId: request.cmsProjectId?.trim() || `tenant-${tenantId}`,
    cmsHost,
    publicwebsiteHost,
    publicwebsiteVercelProjectId: request.publicwebsiteVercelProjectId?.trim() ?? '',
    customDomains,
    primaryDomain,
    deliveryMode: request.deliveryMode ?? 'manual',
    firstPartyAppId: 'publicwebsite',
    firstPartyStatus: 'not-enrolled',
    provisioning: {
      status: 'idle',
      attemptId: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
    },
    reporting: {
      lastRefreshAt: null,
      lastError: null,
    },
    createdAt: timestamp,
    createdBy: actor.uid,
    updatedAt: timestamp,
  };

  const result = await getPlatformStore().createTenant(record);
  if (result.status === 'conflict') {
    throw new ApiError('TENANT_CONFLICT', 'A tenant with this id already exists.');
  }
  return result.tenant ?? record;
}

export async function updateTenantMetadata(
  tenantIdInput: string,
  request: UpdateTenantRequest,
  options: { archive: boolean },
): Promise<TenantRecord> {
  const tenantId = normalizeTenantId(tenantIdInput);
  const existing = await getPlatformStore().getTenant(tenantId);
  if (!existing) {
    throw ApiError.notFound('tenant');
  }

  if (request.status === 'archived' && !options.archive) {
    throw ApiError.forbidden('Only an owner can archive a tenant.');
  }

  const timestamp = new Date().toISOString();
  const patch: TenantPatch = {
    updatedAt: timestamp,
  };

  if (request.displayName !== undefined) patch.displayName = request.displayName.trim();
  if (request.cmsProjectId !== undefined) patch.cmsProjectId = request.cmsProjectId.trim();
  if (request.cmsHost !== undefined) {
    patch.cmsHost = resolveDomainOrThrow(request.cmsHost, 'cmsHost');
  }
  if (request.publicwebsiteHost !== undefined) {
    patch.publicwebsiteHost = resolveDomainOrThrow(
      request.publicwebsiteHost,
      'publicwebsiteHost',
    );
  }
  if (request.publicwebsiteVercelProjectId !== undefined) {
    patch.publicwebsiteVercelProjectId = request.publicwebsiteVercelProjectId.trim();
  }
  if (request.primaryDomain !== undefined) {
    patch.primaryDomain = request.primaryDomain
      ? resolveDomainOrThrow(request.primaryDomain, 'primaryDomain')
      : '';
  }
  if (request.customDomains !== undefined) {
    patch.customDomains = resolveDomainListOrThrow(request.customDomains);
  }
  if (request.deliveryMode !== undefined) {
    patch.deliveryMode = request.deliveryMode;
  }
  if (request.status !== undefined) {
    patch.status = request.status;
  }

  const updated = await getPlatformStore().updateTenant(tenantId, patch);
  if (!updated) {
    throw ApiError.notFound('tenant');
  }
  return updated;
}

/** Aggregated counts used by the dashboard tiles. */
export function countTenantsByStatus(
  tenants: readonly TenantDetail[],
): Record<string, number> {
  const counts: Record<string, number> = {
    draft: 0,
    provisioning: 0,
    active: 0,
    suspended: 0,
    archived: 0,
    failed: 0,
  };
  for (const tenant of tenants) {
    counts[tenant.status] = (counts[tenant.status] ?? 0) + 1;
  }
  return counts;
}
