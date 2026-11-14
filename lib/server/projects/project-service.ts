import 'server-only';

import { ApiError } from '@/lib/server/errors';
import type { PlatformSession } from '@/lib/server/auth/session';
import type { AuditRequestContext } from '@/lib/server/audit/audit-service';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import type {
  PlatformProjectRecord,
  ProjectPatch,
} from '@/lib/server/firestore/store';
import {
  PROJECT_ACCESS_MODES,
  PROJECT_STATUSES,
  PROJECT_TENANT_SOURCES,
  type PlatformProject,
  type ProjectAccessMode,
  type ProjectTenantSource,
} from '@/lib/shared/platform-types';

/** GCP project ids: 6-30 chars, start with a letter, no trailing hyphen. */
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COLLECTION_NAME_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export interface CreateProjectInput {
  projectId: string;
  displayName: string;
  tenantSource?: ProjectTenantSource;
  accessMode?: ProjectAccessMode;
  tenantCollection?: string;
  tenantIdField?: string;
  tenantNameField?: string;
  tenantStatusField?: string;
}

export interface UpdateProjectInput {
  displayName?: string;
  status?: PlatformProject['status'];
  tenantSource?: ProjectTenantSource;
  accessMode?: ProjectAccessMode;
  tenantCollection?: string;
  tenantIdField?: string;
  tenantNameField?: string;
  tenantStatusField?: string;
}

function normalizeProjectId(rawProjectId: string): string {
  const projectId = rawProjectId.trim().toLowerCase();
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw ApiError.invalidRequest(
      'Project id must be 6-30 characters, start with a lowercase letter, and contain only lowercase letters, digits and hyphens.',
    );
  }
  return projectId;
}

function normalizeFieldName(rawValue: string, label: string): string {
  const fieldName = rawValue.trim();
  if (!FIELD_NAME_PATTERN.test(fieldName)) {
    throw ApiError.invalidRequest(`${label} must be a valid Firestore field name.`);
  }
  return fieldName;
}

function normalizeCollection(rawValue: string): string {
  const collection = rawValue.trim();
  if (!COLLECTION_NAME_PATTERN.test(collection)) {
    throw ApiError.invalidRequest('Tenant collection must be a valid Firestore collection id.');
  }
  return collection;
}

function normalizeTenantSource(rawValue: string): ProjectTenantSource {
  if (!(PROJECT_TENANT_SOURCES as readonly string[]).includes(rawValue)) {
    throw ApiError.invalidRequest('Tenant source must be firestore or identity-platform.');
  }
  return rawValue as ProjectTenantSource;
}

function normalizeAccessMode(rawValue: string): ProjectAccessMode {
  if (!(PROJECT_ACCESS_MODES as readonly string[]).includes(rawValue)) {
    throw ApiError.invalidRequest('Access mode must be read-only or read-write.');
  }
  return rawValue as ProjectAccessMode;
}

export async function listProjects(): Promise<PlatformProjectRecord[]> {
  return getPlatformStore().listProjects();
}

export async function getProject(projectIdInput: string): Promise<PlatformProjectRecord | null> {
  return getPlatformStore().getProject(projectIdInput.trim().toLowerCase());
}

export async function getProjectOrThrow(projectIdInput: string): Promise<PlatformProjectRecord> {
  const project = await getProject(projectIdInput);
  if (!project) throw ApiError.projectNotFound();
  return project;
}

export async function createProject(
  input: CreateProjectInput,
  actor: PlatformSession,
  auditContext: AuditRequestContext,
): Promise<PlatformProjectRecord> {
  const projectId = normalizeProjectId(input.projectId);
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw ApiError.invalidRequest('Display name must be 2-80 characters.');
  }

  const tenantSource = normalizeTenantSource(input.tenantSource ?? 'firestore');
  const accessMode = normalizeAccessMode(input.accessMode ?? 'read-only');
  const timestamp = new Date().toISOString();

  const record: PlatformProjectRecord = {
    projectId,
    displayName,
    status: 'active',
    tenantSource,
    accessMode,
    tenantCollection:
      tenantSource === 'firestore'
        ? normalizeCollection(input.tenantCollection?.trim() || 'tenants')
        : 'tenants',
    tenantIdField:
      tenantSource === 'firestore'
        ? normalizeFieldName(input.tenantIdField ?? 'tenantId', 'Tenant id field')
        : 'tenantId',
    tenantNameField:
      tenantSource === 'firestore'
        ? normalizeFieldName(input.tenantNameField ?? 'displayName', 'Tenant name field')
        : 'displayName',
    tenantStatusField:
      tenantSource === 'firestore'
        ? normalizeFieldName(input.tenantStatusField ?? 'status', 'Tenant status field')
        : 'status',
    createdAt: timestamp,
    createdBy: actor.email,
    updatedAt: timestamp,
  };

  const result = await getPlatformStore().createProject(record);
  if (result.status === 'conflict' || !result.project) {
    throw ApiError.projectConflict();
  }

  await recordAudit({
    actor: { uid: actor.uid, email: actor.email, role: actor.role },
    action: 'project.created',
    targetType: 'project',
    targetId: projectId,
    result: 'success',
    metadata: {
      projectId,
      tenantSource,
      tenantCollection: record.tenantCollection,
    },
    context: auditContext,
  });

  return result.project;
}

export async function updateProject(
  projectIdInput: string,
  input: UpdateProjectInput,
  actor: PlatformSession,
  auditContext: AuditRequestContext,
): Promise<PlatformProjectRecord> {
  const existing = await getProjectOrThrow(projectIdInput);
  const patch: ProjectPatch = { updatedAt: new Date().toISOString() };

  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim();
    if (displayName.length < 2 || displayName.length > 80) {
      throw ApiError.invalidRequest('Display name must be 2-80 characters.');
    }
    patch.displayName = displayName;
  }

  if (input.status !== undefined) {
    if (!(PROJECT_STATUSES as readonly string[]).includes(input.status)) {
      throw ApiError.invalidRequest('Project status must be active or disabled.');
    }
    patch.status = input.status;
  }

  if (input.tenantSource !== undefined) {
    patch.tenantSource = normalizeTenantSource(input.tenantSource);
  }

  if (input.accessMode !== undefined) {
    patch.accessMode = normalizeAccessMode(input.accessMode);
  }

  if (input.tenantCollection !== undefined) {
    patch.tenantCollection = normalizeCollection(input.tenantCollection);
  }
  if (input.tenantIdField !== undefined) {
    patch.tenantIdField = normalizeFieldName(input.tenantIdField, 'Tenant id field');
  }
  if (input.tenantNameField !== undefined) {
    patch.tenantNameField = normalizeFieldName(input.tenantNameField, 'Tenant name field');
  }
  if (input.tenantStatusField !== undefined) {
    patch.tenantStatusField = normalizeFieldName(input.tenantStatusField, 'Tenant status field');
  }

  const updated = await getPlatformStore().updateProject(existing.projectId, patch);
  if (!updated) throw ApiError.projectNotFound();

  await recordAudit({
    actor: { uid: actor.uid, email: actor.email, role: actor.role },
    action: 'project.updated',
    targetType: 'project',
    targetId: existing.projectId,
    result: 'success',
    metadata: {
      projectId: existing.projectId,
      changedFields: Object.keys(patch).filter((key) => key !== 'updatedAt'),
    },
    context: auditContext,
  });

  return updated;
}
