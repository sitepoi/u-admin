import 'server-only';

import type { TenantStatus } from '@/lib/shared/constants';
import type {
  AuditEntry,
  PlatformSettingRecord,
  ReportSnapshot,
  TenantDetail,
} from '@/lib/shared/platform-types';

export const TENANT_COLLECTION = 'platform_tenants';
export const AUDIT_COLLECTION = 'platform_audit_log';
export const SNAPSHOT_COLLECTION = 'platform_report_snapshots';
export const SETTINGS_COLLECTION = 'platform_settings';

/** A provisioning attempt that has held the lock longer than this is stale. */
export const PROVISIONING_LOCK_STALE_MS = 15 * 60 * 1000;

export interface TenantRecord extends TenantDetail {}

export interface NewTenantRecord extends TenantDetail {}

export interface TenantPatch {
  displayName?: string;
  cmsProjectId?: string;
  cmsHost?: string;
  publicwebsiteHost?: string;
  publicwebsiteVercelProjectId?: string;
  customDomains?: string[];
  primaryDomain?: string;
  deliveryMode?: TenantDetail['deliveryMode'];
  firstPartyStatus?: TenantDetail['firstPartyStatus'];
  status?: TenantStatus;
  provisioning?: TenantDetail['provisioning'];
  reporting?: TenantDetail['reporting'];
  updatedAt: string;
}

export interface CreateTenantResult {
  status: 'created' | 'conflict';
  tenant: TenantRecord | null;
}

export interface ProvisioningClaimResult {
  status: 'started' | 'not_found' | 'in_progress' | 'archived';
  tenant: TenantRecord | null;
}

export interface FinishProvisioningInput {
  tenantId: string;
  attemptId: string;
  outcome: 'succeeded' | 'failed';
  finishedAt: string;
  lastError: string | null;
  /** Status to apply on success. Defaults to `active`. */
  successStatus?: TenantStatus;
}

export interface AuditQuery {
  tenantId?: string | null;
  action?: string | null;
  result?: string | null;
  actorUid?: string | null;
  from?: string | null;
  to?: string | null;
  limit: number;
  cursor?: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

/**
 * Storage contract for the platform database.
 *
 * There is intentionally no update/delete method for audit entries: the audit
 * log is append-only by construction. Tenant records are never hard-deleted;
 * archiving is a status transition.
 */
export interface PlatformStore {
  readonly kind: 'firestore' | 'memory';

  getTenant(tenantId: string): Promise<TenantRecord | null>;
  listTenants(): Promise<TenantRecord[]>;
  createTenant(record: NewTenantRecord): Promise<CreateTenantResult>;
  updateTenant(tenantId: string, patch: TenantPatch): Promise<TenantRecord | null>;
  beginProvisioning(
    tenantId: string,
    attemptId: string,
    startedAt: string,
  ): Promise<ProvisioningClaimResult>;
  finishProvisioning(input: FinishProvisioningInput): Promise<TenantRecord | null>;

  appendAudit(entry: AuditEntry): Promise<void>;
  listAudit(query: AuditQuery): Promise<AuditPage>;

  saveSnapshot(snapshot: ReportSnapshot): Promise<void>;
  getLatestSnapshot(tenantId: string | null): Promise<ReportSnapshot | null>;
  listSnapshots(tenantId: string | null, limit: number): Promise<ReportSnapshot[]>;

  getSetting(settingId: string): Promise<PlatformSettingRecord | null>;
  listSettings(): Promise<PlatformSettingRecord[]>;
  putSetting(setting: PlatformSettingRecord): Promise<void>;
}

/** `YYYY-MM` period used for reporting snapshots. */
export function getReportingPeriod(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Snapshot document id is deterministic so a refresh is idempotent. */
export function buildSnapshotId(tenantId: string | null, period: string): string {
  return `${tenantId ?? 'platform'}__${period}`;
}

export function previousReportingPeriod(period: string): string {
  const [yearPart, monthPart] = period.split('-');
  const year = Number.parseInt(yearPart ?? '', 10);
  const month = Number.parseInt(monthPart ?? '', 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return period;
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, '0')}`;
}

export function isProvisioningLockStale(startedAt: string | null, nowMs: number = Date.now()): boolean {
  if (!startedAt) return true;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return true;
  return nowMs - startedAtMs > PROVISIONING_LOCK_STALE_MS;
}
