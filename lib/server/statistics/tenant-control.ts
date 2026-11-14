import 'server-only';

import { FirestoreCostMeter } from '@/lib/server/firestore/cost-meter';
import { getPlatformFirestore } from '@/lib/server/firebase/admin';
import { getRelayTenant } from '@/lib/server/relay/relay-client';
import type {
  RelayTenantSummary,
  TenantControlRecord,
  TenantLifecycleStatus,
  TenantStats,
} from '@/lib/shared/platform-types';

export const TENANT_CONTROL_COLLECTION = 'platform_tenant_registry';

function controlDocumentId(projectId: string, tenantId: string): string {
  return `${projectId}__${tenantId}`.replace(/\//g, '_');
}

function latestTimestamp(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  present.sort();
  return present[present.length - 1] ?? null;
}

export async function getTenantControl(
  projectId: string,
  tenantId: string,
  meter?: FirestoreCostMeter,
): Promise<TenantControlRecord | null> {
  const snapshot = await getPlatformFirestore()
    .collection(TENANT_CONTROL_COLLECTION)
    .doc(controlDocumentId(projectId, tenantId))
    .get();
  meter?.recordDocumentReads(1);
  if (!snapshot.exists) return null;
  return snapshot.data() as TenantControlRecord;
}

export interface UpdateTenantControlInput {
  displayName?: string;
  status?: TenantLifecycleStatus;
  region?: string;
  plan?: string;
  ownerEmail?: string;
  adminEmail?: string;
  notes?: string;
}

function applyUpdates(
  record: TenantControlRecord,
  updates: UpdateTenantControlInput,
): TenantControlRecord {
  return {
    ...record,
    ...(updates.displayName === undefined ? {} : { displayName: updates.displayName.trim() }),
    ...(updates.status === undefined ? {} : { status: updates.status }),
    ...(updates.region === undefined ? {} : { region: updates.region.trim() }),
    ...(updates.plan === undefined ? {} : { plan: updates.plan.trim() }),
    ...(updates.ownerEmail === undefined ? {} : { ownerEmail: updates.ownerEmail.trim() }),
    ...(updates.adminEmail === undefined ? {} : { adminEmail: updates.adminEmail.trim() }),
    ...(updates.notes === undefined ? {} : { notes: updates.notes.trim() }),
  };
}

/**
 * Creates or updates the control-plane record. Identity fields always come
 * from the relay; lifecycle fields come from the operator.
 */
export async function upsertTenantControl(input: {
  tenant: RelayTenantSummary;
  actorEmail: string;
  updates: UpdateTenantControlInput;
}): Promise<TenantControlRecord> {
  const now = new Date().toISOString();
  const existing = await getTenantControl(input.tenant.projectId, input.tenant.tenantId);

  const base: TenantControlRecord = existing ?? {
    projectId: input.tenant.projectId,
    tenantId: input.tenant.tenantId,
    applicationId: input.tenant.applicationId,
    displayName: input.tenant.tenantId,
    primaryHost: input.tenant.hostNames[0] ?? '',
    hostNames: input.tenant.hostNames,
    tableExtension: input.tenant.tableExtension,
    region: '',
    status: 'active',
    plan: '',
    ownerEmail: '',
    adminEmail: '',
    notes: '',
    createdAt: now,
    createdBy: input.actorEmail,
    updatedAt: now,
    updatedBy: input.actorEmail,
    lastActivityAt: null,
    counts: null,
    scores: null,
  };

  const record = applyUpdates(
    {
      ...base,
      applicationId: input.tenant.applicationId,
      hostNames: input.tenant.hostNames,
      primaryHost: input.tenant.hostNames[0] ?? base.primaryHost,
      tableExtension: input.tenant.tableExtension,
      updatedAt: now,
      updatedBy: input.actorEmail,
    },
    input.updates,
  );

  await getPlatformFirestore()
    .collection(TENANT_CONTROL_COLLECTION)
    .doc(controlDocumentId(record.projectId, record.tenantId))
    .set(record);

  return record;
}

/** Denormalizes the latest counts and scores onto the control record. */
export async function syncTenantControlFromStats(
  stats: TenantStats,
  meter?: FirestoreCostMeter,
): Promise<void> {
  const existing = await getTenantControl(stats.projectId, stats.tenantId, meter);
  const lastActivityAt = latestTimestamp([
    stats.newestObjectUpdatedAt,
    stats.newestContentUpdatedAt,
    stats.newestUserCreatedAt,
  ]);
  const counts: TenantControlRecord['counts'] = {
    applicationCount: stats.applicationCount,
    totalObjectCount: stats.totalObjectCount,
    userCount: stats.userCount,
    websiteBuilderPageCount: stats.websiteBuilderPageCount,
    contentManagerItemCount: stats.contentManagerItemCount,
  };

  if (!existing) {
    const tenant = await getRelayTenant(stats.applicationId, meter);
    if (!tenant) return;
    const now = new Date().toISOString();
    const record: TenantControlRecord = {
      projectId: tenant.projectId,
      tenantId: tenant.tenantId,
      applicationId: tenant.applicationId,
      displayName: tenant.tenantId,
      primaryHost: tenant.hostNames[0] ?? '',
      hostNames: tenant.hostNames,
      tableExtension: tenant.tableExtension,
      region: '',
      status: 'active',
      plan: '',
      ownerEmail: '',
      adminEmail: '',
      notes: '',
      createdAt: now,
      createdBy: 'statistics',
      updatedAt: now,
      updatedBy: 'statistics',
      lastActivityAt,
      counts,
      scores: stats.scores,
    };
    await getPlatformFirestore()
      .collection(TENANT_CONTROL_COLLECTION)
      .doc(controlDocumentId(record.projectId, record.tenantId))
      .set(record);
    meter?.recordWrites(1);
    return;
  }

  await getPlatformFirestore()
    .collection(TENANT_CONTROL_COLLECTION)
    .doc(controlDocumentId(existing.projectId, existing.tenantId))
    .set(
      {
        counts,
        scores: stats.scores,
        lastActivityAt,
        updatedAt: new Date().toISOString(),
        updatedBy: 'statistics',
      },
      { merge: true },
    );
  meter?.recordWrites(1);
}
