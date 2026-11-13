/**
 * Domain types shared by server code and client components.
 * Plain data only: safe to import from the browser.
 */
import type {
  DeliveryMode,
  FirstPartyStatus,
  PlatformRole,
  ProvisioningStatus,
  TenantStatus,
} from '@/lib/shared/constants';

export interface ProvisioningState {
  status: ProvisioningStatus;
  attemptId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
}

export interface TenantReportingState {
  lastRefreshAt: string | null;
  lastError: string | null;
}

export interface TenantSummary {
  tenantId: string;
  displayName: string;
  status: TenantStatus;
  cmsHost: string;
  publicwebsiteHost: string;
  primaryDomain: string;
  deliveryMode: DeliveryMode;
  firstPartyStatus: FirstPartyStatus;
  updatedAt: string;
}

export interface TenantDetail extends TenantSummary {
  cmsProjectId: string;
  publicwebsiteVercelProjectId: string;
  customDomains: string[];
  firstPartyAppId: 'publicwebsite';
  provisioning: ProvisioningState;
  reporting: TenantReportingState;
  createdAt: string;
  createdBy: string;
}

export const AUDIT_ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.archived',
  'tenant.provision_started',
  'tenant.provision_succeeded',
  'tenant.provision_failed',
  'secret.reveal_requested',
  'secret.reveal_denied',
  'secret.deliver_requested',
  'secret.retire_requested',
  'reporting.refreshed',
  'settings.updated',
  'auth.session_created',
  'auth.logout',
  'auth.denied',
  'auth.mfa_missing',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESULTS = ['success', 'denied', 'error'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_TARGET_TYPES = ['tenant', 'secret', 'platform', 'session'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditEntry {
  auditId: string;
  actorUid: string;
  actorEmail: string;
  actorRole: PlatformRole | 'system';
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  tenantId: string | null;
  appId: string | null;
  kid: string | null;
  result: AuditResult;
  ip: string;
  userAgent: string;
  requestId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const SNAPSHOT_STATUSES = ['ok', 'partial', 'failed'] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export interface TenantReportMetrics {
  tenantId: string;
  displayName: string;
  objectCountTotal: number | null;
  objectCountByType: Record<string, number>;
  apiRequestsThisMonth: { v1: number; v2: number; total: number } | null;
  firstParty: { requests: number; errors: number } | null;
  activeUsers30d: number | null;
  storageBytes: number | null;
  lastError: string | null;
  collectedAt: string;
  durationMs: number;
}

export interface PlatformReportMetrics {
  tenantCount: number;
  tenantsByStatus: Record<string, number>;
  totals: {
    objectCount: number;
    apiRequestsThisMonth: number;
    firstPartyRequests: number;
    firstPartyErrors: number;
    activeUsers30d: number;
    storageBytes: number;
  };
  secretHealth: SecretHealthCounts;
  collectionFailures: number;
}

export interface SecretHealthCounts {
  active: number;
  pendingDelivery: number;
  failedDelivery: number;
  rotationDue: number;
  retired: number;
  total: number;
}

export interface ReportSnapshot {
  snapshotId: string;
  tenantId: string | null;
  period: string;
  metrics: TenantReportMetrics | PlatformReportMetrics;
  status: SnapshotStatus;
  errors: string[];
  collectedAt: string;
}

export const SECRET_STATUSES = [
  'active',
  'pending-delivery',
  'failed-delivery',
  'rotation-due',
  'retired',
  'unknown',
] as const;
export type SecretStatus = (typeof SECRET_STATUSES)[number];

export interface SecretMetadata {
  secretId: string;
  tenantId: string;
  appId: string;
  kid: string | null;
  algorithm: string | null;
  status: SecretStatus;
  rawStatus: string | null;
  deliveryMode: DeliveryMode | null;
  deliveryStatus: string | null;
  fingerprint: string | null;
  version: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  rotationDueAt: string | null;
  lastDeliveredAt: string | null;
  lastDeliveryError: string | null;
}

export interface PlatformSettingRecord {
  settingId: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string;
}

/** Safe projection returned by the API and rendered in lists. */
export interface TenantListItem extends TenantSummary {
  provisioningStatus: ProvisioningStatus;
  lastError: string | null;
  lastReportingRefreshAt: string | null;
}
