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

/** Projects managed by this control plane. Tenants live inside them. */
export const PROJECT_STATUSES = ['active', 'disabled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** How tenants are stored in a managed project. */
export const PROJECT_TENANT_SOURCES = ['firestore', 'identity-platform'] as const;
export type ProjectTenantSource = (typeof PROJECT_TENANT_SOURCES)[number];

/** Whether the cross-project account may write to the managed project. */
export const PROJECT_ACCESS_MODES = ['read-only', 'read-write'] as const;
export type ProjectAccessMode = (typeof PROJECT_ACCESS_MODES)[number];

export interface PlatformProject {
  /** Firebase/GCP project id. Never a tenant id. */
  projectId: string;
  displayName: string;
  status: ProjectStatus;
  tenantSource: ProjectTenantSource;
  /** Read-only is the safe default; writes are blocked before any IAM call. */
  accessMode: ProjectAccessMode;
  /** Firestore collection that holds tenants. Unused for Identity Platform. */
  tenantCollection: string;
  tenantIdField: string;
  tenantNameField: string;
  tenantStatusField: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

/** A tenant as it exists inside a managed project. */
export interface ProjectTenantSummary {
  tenantId: string;
  /** Firestore document id or Identity Platform tenant id used for lookups. */
  recordId?: string;
  displayName: string;
  status: string;
  source: ProjectTenantSource;
}

/**
 * Relay-derived project. The relay has no projects collection: a project is
 * the projectId inside each application's decoded fbSettings.
 */
export interface RelayProjectSummary {
  projectId: string;
  tenantCount: number;
  hostCount: number;
}

/** A relay application document, decoded. One document is one tenant. */
export interface RelayTenantSummary {
  /** Firestore document id in the relay applications collection. */
  applicationId: string;
  tenantId: string;
  authTenant: string;
  projectId: string;
  hostNames: string[];
  tableExtension: string;
}

/** Tenant detail enriched from settings/website-settings-{tenantId}. */
export interface RelayTenantDetail extends RelayTenantSummary {
  companyName: string | null;
  language: string | null;
  subdomain: string | null;
  databaseProjectName: string | null;
}

export interface TenantAppStats {
  appId: string;
  name: string;
  version: string;
  scope: 'local' | 'remote';
  disabled: boolean;
  saveState: string;
  objectTable: 'om_objects' | 'om_private_objects' | 'pm_products';
  objectCount: number | null;
  folderCount: number | null;
}

export interface TenantLegacySignals {
  contentItemCount: number | null;
  contentTypeCount: number | null;
  productCount: number | null;
  productTypeCount: number | null;
  productCategoryCount: number | null;
  legacyApiCallCount: number | null;
  oldVersionHistoryCount: number | null;
  snapshotCount: number | null;
  formTypeCount: number | null;
  formSubmissionCount: number | null;
  aggregatedListCount: number | null;
  publicToPrivateLeftoverCount: number | null;
}

export interface TenantHealthScores {
  /** 0-100: installed apps, objects and users. */
  adoption: number;
  /** 0-100: recency of the newest object/content/user activity. */
  engagement: number;
  /** 0-100: weighted legacy signals. Higher means more migration work. */
  legacyRisk: number;
  /** 0-100: registry pressure and collection errors. */
  operationalRisk: number;
}

/** Cached per-tenant statistics. Never written to tenant projects. */
export interface TenantStats {
  projectId: string;
  tenantId: string;
  applicationId: string;
  computedAt: string;
  durationMs: number;
  status: 'ok' | 'partial' | 'failed';
  applicationCount: number;
  enabledApplicationCount: number;
  disabledApplicationCount: number;
  remoteApplicationCount: number;
  localApplicationCount: number;
  duplicateAppIds: string[];
  /** Approximate size of the objectTypes JSON, against the 1 MiB document limit. */
  appRegistryBytes: number | null;
  totalObjectCount: number | null;
  objectCounts: {
    omObjects: number | null;
    omPrivateObjects: number | null;
    pmProducts: number | null;
  };
  objectStatusCounts: {
    publicEnabled: number | null;
    publicDisabled: number | null;
    privateEnabled: number | null;
    privateDisabled: number | null;
  };
  newestObjectCreatedAt: string | null;
  newestObjectUpdatedAt: string | null;
  userCount: number | null;
  newestUserCreatedAt: string | null;
  applications: TenantAppStats[];
  websiteBuilderAppId: string | null;
  websiteBuilderPageCount: number | null;
  /** Legacy Content Manager: sp_contents, excluding settings-items. */
  contentManagerItemCount: number | null;
  newestContentUpdatedAt: string | null;
  legacy: TenantLegacySignals;
  migrationTag: 'legacy-only' | 'mixed' | 'website-builder-only' | 'none' | 'unknown';
  scores: TenantHealthScores;
  errors: string[];
}

export const TENANT_LIFECYCLE_STATUSES = ['active', 'trial', 'suspended', 'archived'] as const;
export type TenantLifecycleStatus = (typeof TENANT_LIFECYCLE_STATUSES)[number];

/** Control-plane record, stored in the admin project and editable by operators. */
export interface TenantControlRecord {
  projectId: string;
  tenantId: string;
  applicationId: string;
  displayName: string;
  primaryHost: string;
  hostNames: string[];
  tableExtension: string;
  region: string;
  status: TenantLifecycleStatus;
  plan: string;
  ownerEmail: string;
  adminEmail: string;
  notes: string;
  /** First time the control plane saw this tenant. Not the real creation date. */
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  lastActivityAt: string | null;
  counts: {
    applicationCount: number;
    totalObjectCount: number | null;
    userCount: number | null;
    websiteBuilderPageCount: number | null;
    contentManagerItemCount: number | null;
  } | null;
  scores: TenantHealthScores | null;
}

export interface TenantStatsRollup {
  tenantCount: number;
  applicationCount: number;
  totalObjectCount: number;
  websiteBuilderPageCount: number;
  contentManagerItemCount: number;
  latestComputedAt: string | null;
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
  'project.created',
  'project.updated',
  'project.tenant_created',
  'project.tenant_updated',
  'statistics.refreshed',
  'tenant.control_updated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RESULTS = ['success', 'denied', 'error'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_TARGET_TYPES = ['tenant', 'secret', 'platform', 'session', 'project'] as const;
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
