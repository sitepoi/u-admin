import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';

import { ApiError } from '@/lib/server/errors';
import { getProjectAccessConfig } from '@/lib/server/env';
import type { PlatformProjectRecord } from '@/lib/server/firestore/store';
import type { ProjectTenantSummary } from '@/lib/shared/platform-types';

const TENANT_LIST_LIMIT = 500;

interface ServiceAccountShape {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

function getProjectApp(project: PlatformProjectRecord): App {
  const appName = `platform-project-${project.projectId}`;
  const existingApp = getApps().find((candidateApp) => candidateApp.name === appName);
  if (existingApp) return existingApp;

  const config = getProjectAccessConfig();
  let parsedServiceAccount: ServiceAccountShape;
  try {
    parsedServiceAccount = JSON.parse(config.serviceAccountJson) as ServiceAccountShape;
  } catch {
    throw ApiError.projectAccessFailed('The project access credentials are not valid JSON.');
  }

  if (!parsedServiceAccount.client_email || !parsedServiceAccount.private_key) {
    throw ApiError.projectAccessFailed('The project access credentials are incomplete.');
  }

  return initializeApp(
    {
      credential: cert({
        projectId: parsedServiceAccount.project_id ?? project.projectId,
        clientEmail: parsedServiceAccount.client_email,
        privateKey: parsedServiceAccount.private_key.replace(/\\n/g, '\n'),
      }),
      projectId: project.projectId,
    },
    appName,
  );
}

function describeAccessError(
  project: PlatformProjectRecord,
  action: string,
  error: unknown,
): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  return ApiError.projectAccessFailed(
    `Could not ${action} in project ${project.projectId}: ${message.replace(/\s+/g, ' ').slice(0, 300)}`,
    error,
  );
}

function readStringField(data: DocumentData, fieldName: string): string {
  const value = data[fieldName];
  return typeof value === 'string' ? value : '';
}

function assertProjectActive(project: PlatformProjectRecord): void {
  if (project.status === 'disabled') {
    throw ApiError.invalidRequest('This project is disabled. Enable it before managing its tenants.');
  }
}

function assertProjectWritable(project: PlatformProjectRecord): void {
  if (project.accessMode === 'read-only') {
    throw ApiError.forbidden(
      'This project is registered as read-only. Grant write IAM and change its access mode to read-write before editing tenants.',
    );
  }
}

function normalizeTenantKey(rawTenantId: string): string {
  const tenantId = rawTenantId.trim();
  if (!tenantId || tenantId.length > 128 || tenantId.includes('/')) {
    throw ApiError.invalidRequest('Tenant id is invalid.');
  }
  return tenantId;
}

function toFirestoreTenant(
  project: PlatformProjectRecord,
  documentId: string,
  data: DocumentData,
): ProjectTenantSummary {
  const tenantId = readStringField(data, project.tenantIdField) || documentId;
  return {
    tenantId,
    recordId: documentId,
    displayName: readStringField(data, project.tenantNameField) || tenantId,
    status: readStringField(data, project.tenantStatusField) || 'unknown',
    source: 'firestore',
  };
}

export async function listProjectTenants(
  project: PlatformProjectRecord,
): Promise<ProjectTenantSummary[]> {
  assertProjectActive(project);

  try {
    if (project.tenantSource === 'identity-platform') {
      const tenantManager = getAuth(getProjectApp(project)).tenantManager();
      const result = await tenantManager.listTenants(TENANT_LIST_LIMIT);
      return result.tenants.map((tenant) => ({
        tenantId: tenant.tenantId,
        displayName: tenant.displayName || tenant.tenantId,
        status: 'active',
        source: 'identity-platform',
      }));
    }

    const database = getFirestore(getProjectApp(project));
    const snapshot = await database
      .collection(project.tenantCollection)
      .limit(TENANT_LIST_LIMIT)
      .get();
    return snapshot.docs.map((document) =>
      toFirestoreTenant(project, document.id, document.data()),
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw describeAccessError(project, 'list tenants', error);
  }
}

export async function getProjectTenant(
  project: PlatformProjectRecord,
  tenantIdInput: string,
): Promise<ProjectTenantSummary | null> {
  assertProjectActive(project);
  const tenantId = normalizeTenantKey(tenantIdInput);

  try {
    if (project.tenantSource === 'identity-platform') {
      const tenantManager = getAuth(getProjectApp(project)).tenantManager();
      try {
        const tenant = await tenantManager.getTenant(tenantId);
        return {
          tenantId: tenant.tenantId,
          displayName: tenant.displayName || tenant.tenantId,
          status: 'active',
          source: 'identity-platform',
        };
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/tenant-not-found') return null;
        throw error;
      }
    }

    const database = getFirestore(getProjectApp(project));
    const snapshot = await database.collection(project.tenantCollection).doc(tenantId).get();
    if (!snapshot.exists) return null;
    return toFirestoreTenant(project, snapshot.id, snapshot.data() ?? {});
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw describeAccessError(project, 'read the tenant', error);
  }
}

export interface UpdateProjectTenantInput {
  displayName?: string;
  status?: string;
}

export async function updateProjectTenant(
  project: PlatformProjectRecord,
  tenantIdInput: string,
  input: UpdateProjectTenantInput,
): Promise<ProjectTenantSummary> {
  assertProjectActive(project);
  assertProjectWritable(project);
  const tenantId = normalizeTenantKey(tenantIdInput);
  const timestamp = new Date().toISOString();

  try {
    if (project.tenantSource === 'identity-platform') {
      if (input.status !== undefined) {
        throw ApiError.invalidRequest(
          'Identity Platform tenants do not have a status field. Edit the display name instead.',
        );
      }
      const tenantManager = getAuth(getProjectApp(project)).tenantManager();
      const tenant = await tenantManager.updateTenant(tenantId, {
        displayName: input.displayName?.trim() || undefined,
      });
      return {
        tenantId: tenant.tenantId,
        displayName: tenant.displayName || tenant.tenantId,
        status: 'active',
        source: 'identity-platform',
      };
    }

    const database = getFirestore(getProjectApp(project));
    const documentReference = database.collection(project.tenantCollection).doc(tenantId);
    const existingSnapshot = await documentReference.get();
    if (!existingSnapshot.exists) throw ApiError.notFound('tenant');

    const patch: Record<string, unknown> = { updatedAt: timestamp };
    if (input.displayName !== undefined) {
      patch[project.tenantNameField] = input.displayName.trim();
    }
    if (input.status !== undefined) {
      patch[project.tenantStatusField] = input.status.trim();
    }

    await documentReference.set(patch, { merge: true });
    const updatedSnapshot = await documentReference.get();
    return toFirestoreTenant(project, updatedSnapshot.id, updatedSnapshot.data() ?? {});
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw describeAccessError(project, 'update the tenant', error);
  }
}

export interface CreateProjectTenantInput {
  tenantId?: string;
  displayName: string;
  status?: string;
}

export async function createProjectTenant(
  project: PlatformProjectRecord,
  input: CreateProjectTenantInput,
): Promise<ProjectTenantSummary> {
  assertProjectActive(project);
  assertProjectWritable(project);
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw ApiError.invalidRequest('Display name is required.');
  }
  const timestamp = new Date().toISOString();

  try {
    if (project.tenantSource === 'identity-platform') {
      // The Admin SDK assigns the tenant id; it cannot be chosen by the caller.
      const tenantManager = getAuth(getProjectApp(project)).tenantManager();
      const tenant = await tenantManager.createTenant({
        displayName,
      });
      return {
        tenantId: tenant.tenantId,
        displayName: tenant.displayName || tenant.tenantId,
        status: 'active',
        source: 'identity-platform',
      };
    }

    const tenantId = normalizeTenantKey(input.tenantId ?? '');
    const database = getFirestore(getProjectApp(project));
    const documentReference = database.collection(project.tenantCollection).doc(tenantId);
    const existingSnapshot = await documentReference.get();
    if (existingSnapshot.exists) {
      throw new ApiError('TENANT_CONFLICT', 'A tenant with that id already exists in the project.');
    }

    await documentReference.set({
      [project.tenantIdField]: tenantId,
      [project.tenantNameField]: displayName,
      [project.tenantStatusField]: (input.status ?? 'active').trim() || 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      tenantId,
      recordId: tenantId,
      displayName,
      status: (input.status ?? 'active').trim() || 'active',
      source: 'firestore',
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw describeAccessError(project, 'create the tenant', error);
  }
}
