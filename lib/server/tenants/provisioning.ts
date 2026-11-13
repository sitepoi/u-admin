import 'server-only';

import { randomUUID } from 'node:crypto';

import { ApiError } from '@/lib/server/errors';
import type { PlatformSession } from '@/lib/server/auth/session';
import type { AuditRequestContext } from '@/lib/server/audit/audit-service';
import { recordAudit } from '@/lib/server/audit/audit-service';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import type { TenantRecord } from '@/lib/server/firestore/store';
import { redactText } from '@/lib/server/logging/redact';
import {
  createCmsTenant,
  retryCmsFirstPartyEnrollment,
} from '@/lib/server/tenants/cms-client';
import { normalizeTenantId } from '@/lib/server/tenants/tenant-id';

export interface ProvisionTenantResult {
  tenant: TenantRecord;
  attemptId: string;
  outcome: 'succeeded' | 'failed';
  lastError: string | null;
}

function sanitizeErrorMessage(message: string | null): string {
  if (!message) return 'Provisioning failed.';
  return redactText(message).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function buildFailureMessage(status: number, cmsMessage: string | null): string {
  const statusLabel = status === 0 ? 'network error' : `HTTP ${status}`;
  return sanitizeErrorMessage(
    cmsMessage ? `CMS provisioning failed (${statusLabel}): ${cmsMessage}` : `CMS provisioning failed (${statusLabel}).`,
  );
}

/**
 * Idempotent tenant provisioning.
 *
 * - the tenant record must already exist (CMS auto-enrollment calls the Secret
 *   API with this tenantId during creation),
 * - a Firestore transaction claims the attempt so two operators cannot run it
 *   concurrently,
 * - the CMS system API owns tenant creation; this module only orchestrates.
 */
export async function provisionTenant(input: {
  tenantId: string;
  actor: PlatformSession;
  auditContext: AuditRequestContext;
}): Promise<ProvisionTenantResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  const store = getPlatformStore();

  const attemptId = randomUUID();
  const startedAt = new Date().toISOString();

  const claim = await store.beginProvisioning(tenantId, attemptId, startedAt);
  if (claim.status === 'not_found') {
    throw ApiError.notFound('tenant');
  }
  if (claim.status === 'archived') {
    throw ApiError.invalidRequest('Archived tenants cannot be provisioned.');
  }
  if (claim.status === 'in_progress') {
    throw new ApiError(
      'PROVISIONING_IN_PROGRESS',
      'A provisioning attempt is already running for this tenant.',
    );
  }
  if (!claim.tenant) {
    throw ApiError.notFound('tenant');
  }

  const claimedTenant = claim.tenant;
  const cmsProjectId = claimedTenant.cmsProjectId || `tenant-${tenantId}`;

  await recordAudit({
    actor: { uid: input.actor.uid, email: input.actor.email, role: input.actor.role },
    action: 'tenant.provision_started',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    result: 'success',
    metadata: { attemptId, cmsProjectId },
    context: input.auditContext,
  });

  const createResult = await createCmsTenant(tenantId, cmsProjectId);

  let succeeded = createResult.ok;
  let cmsStatus = createResult.status;
  let cmsMessage = createResult.errorMessage;

  if (!succeeded && (createResult.status === 409 || createResult.status === 422)) {
    // The CMS tenant exists but first-party enrollment may not have completed.
    // Use the dedicated retry-enrollment endpoint instead of creating twice.
    const retryResult = await retryCmsFirstPartyEnrollment(tenantId, cmsProjectId);
    succeeded = retryResult.ok;
    cmsStatus = retryResult.status;
    cmsMessage = retryResult.errorMessage;
  }

  const finishedAt = new Date().toISOString();
  const lastError = succeeded ? null : buildFailureMessage(cmsStatus, cmsMessage);

  const updatedTenant = await store.finishProvisioning({
    tenantId,
    attemptId,
    outcome: succeeded ? 'succeeded' : 'failed',
    finishedAt,
    lastError,
    successStatus: 'active',
  });

  const tenant = updatedTenant ?? claimedTenant;

  await recordAudit({
    actor: { uid: input.actor.uid, email: input.actor.email, role: input.actor.role },
    action: succeeded ? 'tenant.provision_succeeded' : 'tenant.provision_failed',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    result: succeeded ? 'success' : 'error',
    metadata: {
      attemptId,
      cmsProjectId,
      cmsStatus,
      lastError,
    },
    context: input.auditContext,
  });

  return {
    tenant,
    attemptId,
    outcome: succeeded ? 'succeeded' : 'failed',
    lastError,
  };
}
