import 'server-only';

import { z } from 'zod';

import { DELIVERY_MODES, MAX_JSON_BODY_BYTES, PLATFORM_ROLES } from '@/lib/shared/constants';
import {
  AUDIT_RESULTS,
  PROJECT_ACCESS_MODES,
  PROJECT_STATUSES,
  PROJECT_TENANT_SOURCES,
} from '@/lib/shared/platform-types';
import { ApiError } from '@/lib/server/errors';

const domainSchema = z.string().trim().min(3).max(255);

const tenantMetadataFields = {
  displayName: z.string().trim().min(2).max(80),
  cmsProjectId: z.string().trim().min(1).max(120),
  cmsHost: domainSchema,
  publicwebsiteHost: domainSchema,
  publicwebsiteVercelProjectId: z.string().trim().max(120),
  primaryDomain: domainSchema,
  customDomains: z.array(domainSchema).max(20),
  deliveryMode: z.enum(DELIVERY_MODES),
};

export const createTenantRequestSchema = z
  .object({
    tenantId: z.string().trim().min(2).max(64),
    displayName: tenantMetadataFields.displayName,
    cmsProjectId: tenantMetadataFields.cmsProjectId.optional(),
    cmsHost: tenantMetadataFields.cmsHost.optional(),
    publicwebsiteHost: tenantMetadataFields.publicwebsiteHost.optional(),
    publicwebsiteVercelProjectId: tenantMetadataFields.publicwebsiteVercelProjectId.optional(),
    primaryDomain: tenantMetadataFields.primaryDomain.optional(),
    customDomains: tenantMetadataFields.customDomains.optional(),
    deliveryMode: tenantMetadataFields.deliveryMode.optional(),
  })
  .strict();

export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const createProjectRequestSchema = z
  .object({
    projectId: z.string().trim().min(6).max(30),
    displayName: z.string().trim().min(2).max(80),
    tenantSource: z.enum(PROJECT_TENANT_SOURCES).optional(),
    accessMode: z.enum(PROJECT_ACCESS_MODES).optional(),
    tenantCollection: z.string().trim().min(1).max(100).optional(),
    tenantIdField: z.string().trim().min(1).max(80).optional(),
    tenantNameField: z.string().trim().min(1).max(80).optional(),
    tenantStatusField: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    tenantSource: z.enum(PROJECT_TENANT_SOURCES).optional(),
    accessMode: z.enum(PROJECT_ACCESS_MODES).optional(),
    tenantCollection: z.string().trim().min(1).max(100).optional(),
    tenantIdField: z.string().trim().min(1).max(80).optional(),
    tenantNameField: z.string().trim().min(1).max(80).optional(),
    tenantStatusField: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one field is required.',
  });

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const createProjectTenantRequestSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128).optional(),
    displayName: z.string().trim().min(1).max(120),
    status: z.string().trim().max(40).optional(),
  })
  .strict();

export type CreateProjectTenantRequest = z.infer<typeof createProjectTenantRequestSchema>;

export const updateProjectTenantRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.string().trim().max(40).optional(),
  })
  .strict()
  .refine((value) => value.displayName !== undefined || value.status !== undefined, {
    message: 'At least one field is required.',
  });

export type UpdateProjectTenantRequest = z.infer<typeof updateProjectTenantRequestSchema>;

export const updateTenantRequestSchema = z
  .object({
    displayName: tenantMetadataFields.displayName.optional(),
    cmsProjectId: tenantMetadataFields.cmsProjectId.optional(),
    cmsHost: tenantMetadataFields.cmsHost.optional(),
    publicwebsiteHost: tenantMetadataFields.publicwebsiteHost.optional(),
    publicwebsiteVercelProjectId: tenantMetadataFields.publicwebsiteVercelProjectId.optional(),
    primaryDomain: tenantMetadataFields.primaryDomain.optional(),
    customDomains: tenantMetadataFields.customDomains.optional(),
    deliveryMode: tenantMetadataFields.deliveryMode.optional(),
    // Status transitions are owned by workflow actions. PATCH may only archive.
    status: z.literal('archived').optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type UpdateTenantRequest = z.infer<typeof updateTenantRequestSchema>;

const idTokenSchema = z.string().min(20).max(20000);
const reasonSchema = z.string().trim().min(10).max(500);

export const sessionRequestSchema = z
  .object({
    idToken: idTokenSchema.optional(),
    /** Dev/E2E only. Rejected unless the server is in E2E mode. */
    e2eActor: z.enum(PLATFORM_ROLES).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.idToken) || Boolean(value.e2eActor), {
    message: 'An ID token is required.',
    path: ['idToken'],
  });

export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const revealSecretRequestSchema = z
  .object({
    reason: reasonSchema,
    idToken: idTokenSchema,
  })
  .strict();

export type RevealSecretRequest = z.infer<typeof revealSecretRequestSchema>;

export const deliverSecretRequestSchema = z
  .object({
    mode: z.enum(DELIVERY_MODES),
    reason: reasonSchema,
    idToken: idTokenSchema,
  })
  .strict();

export type DeliverSecretRequest = z.infer<typeof deliverSecretRequestSchema>;

export const retireSecretRequestSchema = z
  .object({
    reason: reasonSchema,
    idToken: idTokenSchema,
  })
  .strict();

export type RetireSecretRequest = z.infer<typeof retireSecretRequestSchema>;

export const auditQuerySchema = z
  .object({
    tenantId: z.string().trim().max(64).optional(),
    action: z.string().trim().max(64).optional(),
    result: z.enum(AUDIT_RESULTS).optional(),
    actorUid: z.string().trim().max(128).optional(),
    from: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO date.')
      .optional(),
    to: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO date.')
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().max(400).optional(),
  })
  .strict();

export type AuditQueryRequest = z.infer<typeof auditQuerySchema>;

export const settingsUpdateRequestSchema = z
  .object({
    reportingAutoRefreshEnabled: z.boolean().optional(),
    defaultDeliveryMode: z.enum(DELIVERY_MODES).optional(),
    maintenanceNotice: z.string().max(500).optional(),
  })
  .strict();

export type SettingsUpdateRequest = z.infer<typeof settingsUpdateRequestSchema>;

export const secretMetadataQuerySchema = z
  .object({
    tenantId: z.string().trim().max(64).optional(),
  })
  .strict();

export function formatValidationIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
}

/**
 * Reads a JSON body with an explicit size cap and schema validation.
 * The raw body is never logged.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw ApiError.invalidRequest('Content-Type must be application/json.');
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw ApiError.invalidRequest('Request body is too large.');
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    throw ApiError.invalidRequest('Unable to read the request body.');
  }

  if (new TextEncoder().encode(rawBody).length > MAX_JSON_BODY_BYTES) {
    throw ApiError.invalidRequest('Request body is too large.');
  }

  if (rawBody.trim().length === 0) {
    throw ApiError.invalidRequest('Request body is required.');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw ApiError.invalidRequest('Request body must be valid JSON.');
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    throw ApiError.invalidRequest('Request validation failed.', {
      issues: formatValidationIssues(result.error),
    });
  }
  return result.data;
}

/** Parses request query parameters through a schema. */
export function parseSearchParams<T>(url: string, schema: z.ZodType<T>): T {
  const searchParams = new URL(url).searchParams;
  const rawValues: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (key in rawValues) continue;
    rawValues[key] = value;
  }
  const result = schema.safeParse(rawValues);
  if (!result.success) {
    throw ApiError.invalidRequest('Query validation failed.', {
      issues: formatValidationIssues(result.error),
    });
  }
  return result.data;
}
