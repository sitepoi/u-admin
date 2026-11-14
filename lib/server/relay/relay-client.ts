import 'server-only';

import { Buffer } from 'node:buffer';

import {
  FieldPath,
  getFirestore,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { ApiError } from '@/lib/server/errors';
import { getProjectAccessConfig } from '@/lib/server/env';
import { FirestoreCostMeter } from '@/lib/server/firestore/cost-meter';
import { getProjectFirebaseApp } from '@/lib/server/firebase/project-app';
import type {
  RelayProjectSummary,
  RelayTenantDetail,
  RelayTenantSummary,
} from '@/lib/shared/platform-types';

/** The relay's only registry collection. One document is one tenant. */
const APPLICATIONS_COLLECTION = 'applications';
const PAGE_SIZE = 300;
const CACHE_TTL_MS = 30_000;

interface DecodedRelaySettings {
  projectId?: unknown;
  tenantId?: unknown;
  authTenant?: unknown;
  tableExtension?: unknown;
}

function getRelayProjectId(): string {
  return (process.env.SITEPOI_RELAY_PROJECT_ID ?? '').trim() || 'sitepoi-relay';
}

/**
 * Relay documents sometimes store the full hostname as the tenant id, for
 * example uniconbaseapps.uniconhub.com. CMS document ids use the short name
 * (uniconbaseapps), so always normalize to the first label.
 */
export function toShortTenantId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.includes('.') ? trimmed.slice(0, trimmed.indexOf('.')) : trimmed;
}

/** Safe diagnostic: the service account email, never the private key. */
function getServiceAccountEmailForDiagnostics(): string | null {
  try {
    const parsed = JSON.parse(getProjectAccessConfig().serviceAccountJson) as {
      client_email?: unknown;
    };
    return typeof parsed.client_email === 'string' ? parsed.client_email : null;
  } catch {
    return null;
  }
}

function decodeApplication(
  documentId: string,
  data: DocumentData,
): RelayTenantSummary | null {
  const fbSettings = data.fbSettings as { base64?: unknown } | undefined;
  const encodedSettings =
    typeof fbSettings?.base64 === 'string' ? fbSettings.base64 : '';
  if (!encodedSettings) return null;

  let settings: DecodedRelaySettings;
  try {
    settings = JSON.parse(
      Buffer.from(encodedSettings, 'base64').toString('utf8'),
    ) as DecodedRelaySettings;
  } catch {
    return null;
  }

  const projectId = typeof settings.projectId === 'string' ? settings.projectId : '';
  if (!projectId) return null;

  const rawTenantId =
    typeof settings.tenantId === 'string' && settings.tenantId.length > 0
      ? settings.tenantId
      : typeof data.id === 'string' && data.id.length > 0
        ? data.id
        : documentId;
  const tenantId = toShortTenantId(rawTenantId) || toShortTenantId(documentId);

  const hostNames = Array.isArray(data.hostNames)
    ? data.hostNames.filter((host): host is string => typeof host === 'string')
    : [];

  return {
    applicationId: documentId,
    tenantId,
    authTenant: typeof settings.authTenant === 'string' ? settings.authTenant : '',
    projectId,
    hostNames,
    tableExtension:
      typeof settings.tableExtension === 'string' ? settings.tableExtension : '',
  };
}

let cachedApplications: {
  expiresAt: number;
  value: RelayTenantSummary[];
} | null = null;

/**
 * Reads the relay registry. Every document contains fbSettings.base64, which is
 * the only place the Firebase project id exists. The decoded config contains an
 * apiKey, so it is never logged or returned to the browser.
 */
export async function listRelayApplications(
  meter?: FirestoreCostMeter,
): Promise<RelayTenantSummary[]> {
  if (cachedApplications && cachedApplications.expiresAt > Date.now()) {
    return cachedApplications.value;
  }

  const relayProjectId = getRelayProjectId();

  try {
    const database = getFirestore(getProjectFirebaseApp(relayProjectId));
    const applications: RelayTenantSummary[] = [];
    let lastDocument: QueryDocumentSnapshot | null = null;

    while (true) {
      let query: Query = database
        .collection(APPLICATIONS_COLLECTION)
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE);
      if (lastDocument) query = query.startAfter(lastDocument);

      const snapshot = await query.get();
      meter?.recordDocumentReads(snapshot.size);
      for (const document of snapshot.docs) {
        const application = decodeApplication(document.id, document.data());
        if (application) applications.push(application);
      }

      if (snapshot.size < PAGE_SIZE) break;
      lastDocument = snapshot.docs[snapshot.docs.length - 1];
    }

    cachedApplications = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: applications,
    };
    return applications;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const serviceAccountEmail = getServiceAccountEmailForDiagnostics();
    throw ApiError.projectAccessFailed(
      `Could not read sitepoi-relay project "${relayProjectId}" (${APPLICATIONS_COLLECTION}): ${message
        .replace(/\s+/g, ' ')
        .slice(0, 300)} Using service account: ${serviceAccountEmail ?? 'unknown'}.`,
      error,
    );
  }
}

/** Projects are derived by grouping decoded applications on projectId. */
export async function listRelayProjects(): Promise<RelayProjectSummary[]> {
  const applications = await listRelayApplications();
  const projects = new Map<string, { tenantCount: number; hosts: Set<string> }>();

  for (const application of applications) {
    const project = projects.get(application.projectId) ?? {
      tenantCount: 0,
      hosts: new Set<string>(),
    };
    project.tenantCount += 1;
    for (const host of application.hostNames) project.hosts.add(host);
    projects.set(application.projectId, project);
  }

  return [...projects.entries()]
    .map(([projectId, summary]) => ({
      projectId,
      tenantCount: summary.tenantCount,
      hostCount: summary.hosts.size,
    }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
}

export async function listRelayTenants(projectId: string): Promise<RelayTenantSummary[]> {
  const applications = await listRelayApplications();
  return applications
    .filter((application) => application.projectId === projectId)
    .sort((left, right) => left.tenantId.localeCompare(right.tenantId));
}

export async function getRelayTenant(
  applicationIdInput: string,
  meter?: FirestoreCostMeter,
): Promise<RelayTenantSummary | null> {
  const relayProjectId = getRelayProjectId();
  const applicationId = applicationIdInput.trim();
  if (!applicationId) return null;

  // Accept the relay document id or the short tenant id.
  const candidateIds = applicationId.includes('.')
    ? [applicationId]
    : [applicationId, `${applicationId}.uniconhub.com`];

  try {
    const database = getFirestore(getProjectFirebaseApp(relayProjectId));
    for (const candidateId of candidateIds) {
      const snapshot = await database
        .collection(APPLICATIONS_COLLECTION)
        .doc(candidateId)
        .get();
      meter?.recordDocumentReads(1);
      if (snapshot.exists) {
        const application = decodeApplication(snapshot.id, snapshot.data() ?? {});
        if (application) return application;
      }
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw ApiError.projectAccessFailed(
      `Could not read the tenant from sitepoi-relay: ${message.replace(/\s+/g, ' ').slice(0, 300)}`,
      error,
    );
  }
}

function readNestedString(
  source: Record<string, unknown> | undefined,
  ...path: string[]
): string | null {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
}

/**
 * Enriches a relay tenant with settings/website-settings-{tenantId} from the
 * tenant's own project. Missing read access or a missing document leaves the
 * fields null; the relay data is still returned.
 */
export async function getRelayTenantDetail(
  applicationIdInput: string,
  meter?: FirestoreCostMeter,
): Promise<RelayTenantDetail | null> {
  const tenant = await getRelayTenant(applicationIdInput, meter);
  if (!tenant) return null;

  let companyName: string | null = null;
  let language: string | null = null;
  let subdomain: string | null = null;
  let databaseProjectName: string | null = null;

  try {
    const database = getFirestore(getProjectFirebaseApp(tenant.projectId));
    const snapshot = await database
      .collection('settings')
      .doc(`website-settings-${tenant.tenantId}`)
      .get();
    meter?.recordDocumentReads(1);
    if (snapshot.exists) {
      const data = snapshot.data() ?? {};
      companyName = readNestedString(data, 'texts', 'companyName');
      language = readNestedString(data, 'defaults', 'language');
      subdomain = readNestedString(data, 'cmsParams', 'subdomain');
      databaseProjectName = readNestedString(data, 'dbSettings', 'projectName');
    }
  } catch {
    // The tenant project may not be reachable with the current read role.
  }

  return {
    ...tenant,
    companyName,
    language,
    subdomain,
    databaseProjectName,
  };
}

/** Test-only: drops the relay cache. */
export function clearRelayCacheForTesting(): void {
  cachedApplications = null;
}
