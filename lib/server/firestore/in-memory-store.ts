import 'server-only';

import type {
  AuditEntry,
  PlatformSettingRecord,
  ReportSnapshot,
  TenantDetail,
} from '@/lib/shared/platform-types';
import {
  buildSnapshotId,
  getReportingPeriod,
  isProvisioningLockStale,
  previousReportingPeriod,
  type AuditPage,
  type AuditQuery,
  type CreateProjectResult,
  type CreateTenantResult,
  type FinishProvisioningInput,
  type NewTenantRecord,
  type PlatformProjectRecord,
  type PlatformStore,
  type ProjectPatch,
  type ProvisioningClaimResult,
  type TenantPatch,
  type TenantRecord,
} from '@/lib/server/firestore/store';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compareAuditEntriesDescending(left: AuditEntry, right: AuditEntry): number {
  if (left.createdAt === right.createdAt) {
    return right.auditId.localeCompare(left.auditId);
  }
  return right.createdAt.localeCompare(left.createdAt);
}

function encodeAuditCursor(entry: AuditEntry): string {
  return `${entry.createdAt}|${entry.auditId}`;
}

function isAfterCursor(entry: AuditEntry, cursor: string): boolean {
  const separatorIndex = cursor.lastIndexOf('|');
  if (separatorIndex === -1) return true;
  const cursorCreatedAt = cursor.slice(0, separatorIndex);
  const cursorAuditId = cursor.slice(separatorIndex + 1);
  if (entry.createdAt < cursorCreatedAt) return true;
  if (entry.createdAt > cursorCreatedAt) return false;
  return entry.auditId < cursorAuditId;
}

/**
 * In-memory implementation of the platform store.
 *
 * Used by Vitest (injected with setPlatformStoreForTesting) and by the local
 * Playwright environment. It is never selected when NODE_ENV=production or on
 * Vercel - see lib/server/env.ts `isE2eMode`.
 */
export class InMemoryPlatformStore implements PlatformStore {
  readonly kind = 'memory' as const;

  private readonly tenants = new Map<string, TenantRecord>();
  private readonly projects = new Map<string, PlatformProjectRecord>();
  private readonly auditEntries: AuditEntry[] = [];
  private readonly snapshots = new Map<string, ReportSnapshot>();
  private readonly settings = new Map<string, PlatformSettingRecord>();

  async getProject(projectId: string): Promise<PlatformProjectRecord | null> {
    const project = this.projects.get(projectId);
    return project ? clone(project) : null;
  }

  async listProjects(): Promise<PlatformProjectRecord[]> {
    return [...this.projects.values()]
      .map((project) => clone(project))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createProject(record: PlatformProjectRecord): Promise<CreateProjectResult> {
    const existing = this.projects.get(record.projectId);
    if (existing) {
      return { status: 'conflict', project: clone(existing) };
    }
    this.projects.set(record.projectId, clone(record));
    return { status: 'created', project: clone(record) };
  }

  async updateProject(
    projectId: string,
    patch: ProjectPatch,
  ): Promise<PlatformProjectRecord | null> {
    const existing = this.projects.get(projectId);
    if (!existing) return null;
    const updated: PlatformProjectRecord = { ...existing, ...patch };
    this.projects.set(projectId, updated);
    return clone(updated);
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    const tenant = this.tenants.get(tenantId);
    return tenant ? clone(tenant) : null;
  }

  async listTenants(): Promise<TenantRecord[]> {
    return [...this.tenants.values()]
      .map((tenant) => clone(tenant))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createTenant(record: NewTenantRecord): Promise<CreateTenantResult> {
    const existing = this.tenants.get(record.tenantId);
    if (existing) {
      return { status: 'conflict', tenant: clone(existing) };
    }
    this.tenants.set(record.tenantId, clone(record));
    return { status: 'created', tenant: clone(record) };
  }

  async updateTenant(tenantId: string, patch: TenantPatch): Promise<TenantRecord | null> {
    const existing = this.tenants.get(tenantId);
    if (!existing) return null;
    const updated: TenantRecord = { ...existing, ...patch };
    this.tenants.set(tenantId, updated);
    return clone(updated);
  }

  async beginProvisioning(
    tenantId: string,
    attemptId: string,
    startedAt: string,
  ): Promise<ProvisioningClaimResult> {
    const existing = this.tenants.get(tenantId);
    if (!existing) return { status: 'not_found', tenant: null };
    if (existing.status === 'archived') {
      return { status: 'archived', tenant: clone(existing) };
    }
    if (
      existing.provisioning.status === 'running' &&
      !isProvisioningLockStale(existing.provisioning.startedAt)
    ) {
      return { status: 'in_progress', tenant: clone(existing) };
    }

    const updated: TenantRecord = {
      ...existing,
      status: 'provisioning',
      provisioning: {
        status: 'running',
        attemptId,
        startedAt,
        finishedAt: null,
        lastError: null,
      },
      updatedAt: startedAt,
    };
    this.tenants.set(tenantId, updated);
    return { status: 'started', tenant: clone(updated) };
  }

  async finishProvisioning(input: FinishProvisioningInput): Promise<TenantRecord | null> {
    const existing = this.tenants.get(input.tenantId);
    if (!existing) return null;
    if (existing.provisioning.attemptId !== input.attemptId) {
      // A newer attempt owns the record; never overwrite it.
      return clone(existing);
    }

    const succeeded = input.outcome === 'succeeded';
    const updated: TenantRecord = {
      ...existing,
      status: succeeded ? (input.successStatus ?? 'active') : 'failed',
      provisioning: {
        ...existing.provisioning,
        status: succeeded ? 'succeeded' : 'failed',
        finishedAt: input.finishedAt,
        lastError: input.lastError,
      },
      updatedAt: input.finishedAt,
    };
    this.tenants.set(input.tenantId, updated);
    return clone(updated);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    if (this.auditEntries.some((existing) => existing.auditId === entry.auditId)) {
      throw new Error('Audit record already exists.');
    }
    this.auditEntries.push(clone(entry));
  }

  async listAudit(query: AuditQuery): Promise<AuditPage> {
    let entries = this.auditEntries.filter((entry) => {
      if (query.tenantId && entry.tenantId !== query.tenantId) return false;
      if (query.action && entry.action !== query.action) return false;
      if (query.result && entry.result !== query.result) return false;
      if (query.actorUid && entry.actorUid !== query.actorUid) return false;
      if (query.from && entry.createdAt < query.from) return false;
      if (query.to && entry.createdAt > query.to) return false;
      return true;
    });

    entries = entries.sort(compareAuditEntriesDescending);
    if (query.cursor) {
      entries = entries.filter((entry) => isAfterCursor(entry, query.cursor as string));
    }

    const page = entries.slice(0, query.limit);
    const hasMore = entries.length > query.limit;
    return {
      entries: page.map((entry) => clone(entry)),
      nextCursor: hasMore && page.length > 0 ? encodeAuditCursor(page[page.length - 1]!) : null,
    };
  }

  async saveSnapshot(snapshot: ReportSnapshot): Promise<void> {
    this.snapshots.set(snapshot.snapshotId, clone(snapshot));
  }

  async getLatestSnapshot(tenantId: string | null): Promise<ReportSnapshot | null> {
    let period = getReportingPeriod();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const snapshot = this.snapshots.get(buildSnapshotId(tenantId, period));
      if (snapshot) return clone(snapshot);
      period = previousReportingPeriod(period);
    }
    return null;
  }

  async listSnapshots(tenantId: string | null, limit: number): Promise<ReportSnapshot[]> {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.tenantId === tenantId)
      .sort((left, right) => right.period.localeCompare(left.period))
      .slice(0, limit)
      .map((snapshot) => clone(snapshot));
  }

  async getSetting(settingId: string): Promise<PlatformSettingRecord | null> {
    const setting = this.settings.get(settingId);
    return setting ? clone(setting) : null;
  }

  async listSettings(): Promise<PlatformSettingRecord[]> {
    return [...this.settings.values()]
      .map((setting) => clone(setting))
      .sort((left, right) => left.settingId.localeCompare(right.settingId));
  }

  async putSetting(setting: PlatformSettingRecord): Promise<void> {
    this.settings.set(setting.settingId, clone(setting));
  }

  /** Test-only helpers. */
  reset(): void {
    this.tenants.clear();
    this.auditEntries.length = 0;
    this.snapshots.clear();
    this.settings.clear();
  }

  seedTenant(tenant: TenantDetail): void {
    this.tenants.set(tenant.tenantId, clone(tenant));
  }
}
