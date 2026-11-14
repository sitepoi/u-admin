import 'server-only';

import type { DocumentData, Firestore, Query } from 'firebase-admin/firestore';

import {
  DELIVERY_MODES,
  FIRST_PARTY_STATUSES,
  TENANT_STATUSES,
  type DeliveryMode,
  type FirstPartyStatus,
  type PlatformRole,
  type TenantStatus,
} from '@/lib/shared/constants';
import type {
  AuditEntry,
  AuditResult,
  AuditTargetType,
  PlatformProject,
  PlatformSettingRecord,
  ProvisioningState,
  ReportSnapshot,
  SnapshotStatus,
  TenantDetail,
} from '@/lib/shared/platform-types';
import { PROJECT_ACCESS_MODES, PROJECT_STATUSES, PROJECT_TENANT_SOURCES } from '@/lib/shared/platform-types';
import { getPlatformFirestore } from '@/lib/server/firebase/admin';
import {
  AUDIT_COLLECTION,
  PROJECT_COLLECTION,
  SETTINGS_COLLECTION,
  SNAPSHOT_COLLECTION,
  TENANT_COLLECTION,
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

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function toProvisioningState(value: unknown): ProvisioningState {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    status: isOneOf(record.status, ['idle', 'running', 'succeeded', 'failed'])
      ? record.status
      : 'idle',
    attemptId: asNullableString(record.attemptId),
    startedAt: asNullableString(record.startedAt),
    finishedAt: asNullableString(record.finishedAt),
    lastError: asNullableString(record.lastError),
  };
}

export function toTenantRecord(tenantId: string, data: DocumentData): TenantRecord {
  const provisioning = toProvisioningState(data.provisioning);
  const reporting = (data.reporting ?? {}) as Record<string, unknown>;

  return {
    tenantId,
    displayName: asString(data.displayName, tenantId),
    status: isOneOf<TenantStatus>(data.status, TENANT_STATUSES) ? data.status : 'draft',
    cmsProjectId: asString(data.cmsProjectId),
    cmsHost: asString(data.cmsHost),
    publicwebsiteHost: asString(data.publicwebsiteHost),
    publicwebsiteVercelProjectId: asString(data.publicwebsiteVercelProjectId),
    customDomains: asStringArray(data.customDomains),
    primaryDomain: asString(data.primaryDomain),
    deliveryMode: isOneOf<DeliveryMode>(data.deliveryMode, DELIVERY_MODES)
      ? data.deliveryMode
      : 'manual',
    firstPartyAppId: 'publicwebsite',
    firstPartyStatus: isOneOf<FirstPartyStatus>(data.firstPartyStatus, FIRST_PARTY_STATUSES)
      ? data.firstPartyStatus
      : 'not-enrolled',
    provisioning,
    reporting: {
      lastRefreshAt: asNullableString(reporting.lastRefreshAt),
      lastError: asNullableString(reporting.lastError),
    },
    createdAt: asString(data.createdAt, new Date(0).toISOString()),
    createdBy: asString(data.createdBy, 'system'),
    updatedAt: asString(data.updatedAt, new Date(0).toISOString()),
  };
}

function serializeTenant(record: TenantRecord): Record<string, unknown> {
  return {
    tenantId: record.tenantId,
    displayName: record.displayName,
    status: record.status,
    cmsProjectId: record.cmsProjectId,
    cmsHost: record.cmsHost,
    publicwebsiteHost: record.publicwebsiteHost,
    publicwebsiteVercelProjectId: record.publicwebsiteVercelProjectId,
    customDomains: record.customDomains,
    primaryDomain: record.primaryDomain,
    deliveryMode: record.deliveryMode,
    firstPartyAppId: 'publicwebsite',
    firstPartyStatus: record.firstPartyStatus,
    provisioning: record.provisioning,
    reporting: record.reporting,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    updatedAt: record.updatedAt,
  };
}

function toAuditEntry(auditId: string, data: DocumentData): AuditEntry {
  return {
    auditId,
    actorUid: asString(data.actorUid),
    actorEmail: asString(data.actorEmail),
    actorRole: (asString(data.actorRole, 'system') as PlatformRole | 'system') ?? 'system',
    action: asString(data.action) as AuditEntry['action'],
    targetType: (asString(data.targetType, 'platform') as AuditTargetType) ?? 'platform',
    targetId: asString(data.targetId),
    tenantId: asNullableString(data.tenantId),
    appId: asNullableString(data.appId),
    kid: asNullableString(data.kid),
    result: (asString(data.result, 'error') as AuditResult) ?? 'error',
    ip: asString(data.ip),
    userAgent: asString(data.userAgent),
    requestId: asString(data.requestId),
    metadata:
      typeof data.metadata === 'object' && data.metadata !== null
        ? (data.metadata as Record<string, unknown>)
        : {},
    createdAt: asString(data.createdAt, new Date(0).toISOString()),
  };
}

function toSnapshot(snapshotId: string, data: DocumentData): ReportSnapshot {
  return {
    snapshotId,
    tenantId: asNullableString(data.tenantId),
    period: asString(data.period, getReportingPeriod()),
    metrics:
      typeof data.metrics === 'object' && data.metrics !== null
        ? (data.metrics as ReportSnapshot['metrics'])
        : ({} as ReportSnapshot['metrics']),
    status: (asString(data.status, 'failed') as SnapshotStatus) ?? 'failed',
    errors: asStringArray(data.errors),
    collectedAt: asString(data.collectedAt, new Date(0).toISOString()),
  };
}

/**
 * Firestore-backed platform store.
 *
 * The Admin app's Firebase project is separate from every tenant project. Only
 * platform metadata is stored here: never private keys, ciphertext, ID tokens
 * or service tokens.
 */
export function toProjectRecord(
  projectId: string,
  data: DocumentData,
): PlatformProjectRecord {
  const tenantSource = isOneOf(data.tenantSource, PROJECT_TENANT_SOURCES)
    ? data.tenantSource
    : 'firestore';
  const status = isOneOf(data.status, PROJECT_STATUSES) ? data.status : 'active';
  const accessMode = isOneOf(data.accessMode, PROJECT_ACCESS_MODES)
    ? data.accessMode
    : 'read-only';

  return {
    projectId,
    displayName: asString(data.displayName, projectId),
    status,
    tenantSource,
    accessMode,
    tenantCollection: asString(data.tenantCollection, 'tenants'),
    tenantIdField: asString(data.tenantIdField, 'tenantId'),
    tenantNameField: asString(data.tenantNameField, 'displayName'),
    tenantStatusField: asString(data.tenantStatusField, 'status'),
    createdAt: asString(data.createdAt, new Date(0).toISOString()),
    createdBy: asString(data.createdBy),
    updatedAt: asString(data.updatedAt, new Date(0).toISOString()),
  };
}

export class FirestorePlatformStore implements PlatformStore {
  readonly kind = 'firestore' as const;

  private readonly db: Firestore;

  constructor(db: Firestore = getPlatformFirestore()) {
    this.db = db;
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    const snapshot = await this.db.collection(TENANT_COLLECTION).doc(tenantId).get();
    if (!snapshot.exists) return null;
    return toTenantRecord(snapshot.id, snapshot.data() ?? {});
  }

  async listTenants(): Promise<TenantRecord[]> {
    const snapshot = await this.db
      .collection(TENANT_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(1000)
      .get();
    return snapshot.docs.map((document) => toTenantRecord(document.id, document.data()));
  }

  async createTenant(record: NewTenantRecord): Promise<CreateTenantResult> {
    const documentReference = this.db.collection(TENANT_COLLECTION).doc(record.tenantId);

    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(documentReference);
      if (existingSnapshot.exists) {
        return {
          status: 'conflict' as const,
          tenant: toTenantRecord(documentReference.id, existingSnapshot.data() ?? {}),
        };
      }
      transaction.create(documentReference, serializeTenant(record));
      return { status: 'created' as const, tenant: record };
    });
  }

  async updateTenant(tenantId: string, patch: TenantPatch): Promise<TenantRecord | null> {
    const documentReference = this.db.collection(TENANT_COLLECTION).doc(tenantId);

    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(documentReference);
      if (!existingSnapshot.exists) return null;
      const existing = toTenantRecord(tenantId, existingSnapshot.data() ?? {});
      const updated: TenantRecord = { ...existing, ...patch };
      transaction.set(documentReference, serializeTenant(updated));
      return updated;
    });
  }

  async beginProvisioning(
    tenantId: string,
    attemptId: string,
    startedAt: string,
  ): Promise<ProvisioningClaimResult> {
    const documentReference = this.db.collection(TENANT_COLLECTION).doc(tenantId);

    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(documentReference);
      if (!existingSnapshot.exists) {
        return { status: 'not_found' as const, tenant: null };
      }

      const existing = toTenantRecord(tenantId, existingSnapshot.data() ?? {});
      if (existing.status === 'archived') {
        return { status: 'archived' as const, tenant: existing };
      }
      if (
        existing.provisioning.status === 'running' &&
        !isProvisioningLockStale(existing.provisioning.startedAt)
      ) {
        return { status: 'in_progress' as const, tenant: existing };
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
      transaction.set(documentReference, serializeTenant(updated));
      return { status: 'started' as const, tenant: updated };
    });
  }

  async finishProvisioning(input: FinishProvisioningInput): Promise<TenantRecord | null> {
    const documentReference = this.db.collection(TENANT_COLLECTION).doc(input.tenantId);

    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(documentReference);
      if (!existingSnapshot.exists) return null;

      const existing = toTenantRecord(input.tenantId, existingSnapshot.data() ?? {});
      if (existing.provisioning.attemptId !== input.attemptId) {
        // Another attempt took over; never overwrite it.
        return existing;
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
      transaction.set(documentReference, serializeTenant(updated));
      return updated;
    });
  }

  async getProject(projectId: string): Promise<PlatformProjectRecord | null> {
    const snapshot = await this.db.collection(PROJECT_COLLECTION).doc(projectId).get();
    if (!snapshot.exists) return null;
    return toProjectRecord(snapshot.id, snapshot.data() ?? {});
  }

  async listProjects(): Promise<PlatformProjectRecord[]> {
    const snapshot = await this.db
      .collection(PROJECT_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(1000)
      .get();
    return snapshot.docs.map((document) => toProjectRecord(document.id, document.data()));
  }

  async createProject(record: PlatformProjectRecord): Promise<CreateProjectResult> {
    const documentReference = this.db.collection(PROJECT_COLLECTION).doc(record.projectId);

    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(documentReference);
      if (existingSnapshot.exists) {
        return {
          status: 'conflict' as const,
          project: toProjectRecord(record.projectId, existingSnapshot.data() ?? {}),
        };
      }
      transaction.set(documentReference, { ...record });
      return { status: 'created' as const, project: record };
    });
  }

  async updateProject(
    projectId: string,
    patch: ProjectPatch,
  ): Promise<PlatformProjectRecord | null> {
    const documentReference = this.db.collection(PROJECT_COLLECTION).doc(projectId);

    return this.db.runTransaction(async (transaction) => {
      const existingSnapshot = await transaction.get(documentReference);
      if (!existingSnapshot.exists) return null;

      const updated: PlatformProjectRecord = {
        ...toProjectRecord(projectId, existingSnapshot.data() ?? {}),
        ...patch,
      };
      transaction.set(documentReference, { ...updated });
      return updated;
    });
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    // `create` fails if the id already exists: the audit log can only grow.
    await this.db.collection(AUDIT_COLLECTION).doc(entry.auditId).create({
      ...entry,
    });
  }

  async listAudit(query: AuditQuery): Promise<AuditPage> {
    const collectionReference = this.db.collection(AUDIT_COLLECTION);
    let firestoreQuery: Query = collectionReference
      .orderBy('createdAt', 'desc')
      .orderBy('auditId', 'desc');

    // Only one equality filter is pushed to Firestore so the required composite
    // indexes stay limited to tenantId+createdAt and action+createdAt.
    if (query.tenantId) {
      firestoreQuery = firestoreQuery.where('tenantId', '==', query.tenantId);
    } else if (query.action) {
      firestoreQuery = firestoreQuery.where('action', '==', query.action);
    }

    if (query.cursor) {
      const separatorIndex = query.cursor.lastIndexOf('|');
      if (separatorIndex > 0) {
        firestoreQuery = firestoreQuery.startAfter(
          query.cursor.slice(0, separatorIndex),
          query.cursor.slice(separatorIndex + 1),
        );
      }
    }

    const fetchLimit = Math.min(300, Math.max(query.limit, query.limit * 3));
    const snapshot = await firestoreQuery.limit(fetchLimit).get();

    let entries = snapshot.docs.map((document) => toAuditEntry(document.id, document.data()));

    entries = entries.filter((entry) => {
      if (query.action && entry.action !== query.action) return false;
      if (query.result && entry.result !== query.result) return false;
      if (query.actorUid && entry.actorUid !== query.actorUid) return false;
      if (query.from && entry.createdAt < query.from) return false;
      if (query.to && entry.createdAt > query.to) return false;
      return true;
    });

    const page = entries.slice(0, query.limit);
    const hasMore =
      entries.length > query.limit || snapshot.docs.length === fetchLimit;
    const lastEntry = page[page.length - 1];
    return {
      entries: page,
      nextCursor: hasMore && lastEntry ? `${lastEntry.createdAt}|${lastEntry.auditId}` : null,
    };
  }

  async saveSnapshot(snapshot: ReportSnapshot): Promise<void> {
    await this.db.collection(SNAPSHOT_COLLECTION).doc(snapshot.snapshotId).set({
      ...snapshot,
    });
  }

  async getLatestSnapshot(tenantId: string | null): Promise<ReportSnapshot | null> {
    let period = getReportingPeriod();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const documentReference = this.db
        .collection(SNAPSHOT_COLLECTION)
        .doc(buildSnapshotId(tenantId, period));
      const snapshot = await documentReference.get();
      if (snapshot.exists) {
        return toSnapshot(snapshot.id, snapshot.data() ?? {});
      }
      period = previousReportingPeriod(period);
    }
    return null;
  }

  async listSnapshots(tenantId: string | null, limit: number): Promise<ReportSnapshot[]> {
    const collectionReference = this.db.collection(SNAPSHOT_COLLECTION);
    const equalFiltered =
      tenantId === null
        ? collectionReference.where('tenantId', '==', null)
        : collectionReference.where('tenantId', '==', tenantId);
    const snapshot = await equalFiltered.orderBy('period', 'desc').limit(limit).get();
    return snapshot.docs.map((document) => toSnapshot(document.id, document.data()));
  }

  async getSetting(settingId: string): Promise<PlatformSettingRecord | null> {
    const snapshot = await this.db.collection(SETTINGS_COLLECTION).doc(settingId).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    return {
      settingId,
      value: data.value,
      updatedAt: asString(data.updatedAt),
      updatedBy: asString(data.updatedBy),
    };
  }

  async listSettings(): Promise<PlatformSettingRecord[]> {
    const snapshot = await this.db.collection(SETTINGS_COLLECTION).get();
    return snapshot.docs.map((document) => {
      const data = document.data();
      return {
        settingId: document.id,
        value: data.value,
        updatedAt: asString(data.updatedAt),
        updatedBy: asString(data.updatedBy),
      };
    });
  }

  async putSetting(setting: PlatformSettingRecord): Promise<void> {
    await this.db.collection(SETTINGS_COLLECTION).doc(setting.settingId).set({
      settingId: setting.settingId,
      value: setting.value,
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
    });
  }
}
