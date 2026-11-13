import 'server-only';

import { randomUUID } from 'node:crypto';

import type { PlatformRole } from '@/lib/shared/constants';
import type {
  AuditAction,
  AuditEntry,
  AuditResult,
  AuditTargetType,
} from '@/lib/shared/platform-types';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import { logError } from '@/lib/server/logging/logger';
import { sanitizeForLog } from '@/lib/server/logging/redact';

export interface AuditActor {
  uid: string;
  email: string;
  role: PlatformRole | 'system';
}

export interface AuditRequestContext {
  ip: string;
  userAgent: string;
  requestId: string;
}

export interface CreateAuditEntryInput {
  actor: AuditActor;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  tenantId?: string | null;
  appId?: string | null;
  kid?: string | null;
  result: AuditResult;
  metadata?: Record<string, unknown>;
  context: AuditRequestContext;
  auditId?: string;
  createdAt?: string;
}

const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_TARGET_ID_LENGTH = 200;

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  return value.slice(0, maximumLength);
}

/**
 * Builds an append-only audit entry. Metadata is redacted before it is written
 * so a careless caller cannot persist a token in the audit collection.
 */
export function createAuditEntry(input: CreateAuditEntryInput): AuditEntry {
  const redactedMetadata = sanitizeForLog(input.metadata ?? {});
  return {
    auditId: input.auditId ?? randomUUID(),
    actorUid: truncate(input.actor.uid, MAX_TARGET_ID_LENGTH),
    actorEmail: truncate(input.actor.email, 320),
    actorRole: input.actor.role,
    action: input.action,
    targetType: input.targetType,
    targetId: truncate(input.targetId, MAX_TARGET_ID_LENGTH),
    tenantId: input.tenantId ?? null,
    appId: input.appId ?? null,
    kid: input.kid ?? null,
    result: input.result,
    ip: truncate(input.context.ip, MAX_IP_LENGTH),
    userAgent: truncate(input.context.userAgent, MAX_USER_AGENT_LENGTH),
    requestId: truncate(input.context.requestId, MAX_TARGET_ID_LENGTH),
    metadata:
      typeof redactedMetadata === 'object' && redactedMetadata !== null
        ? (redactedMetadata as Record<string, unknown>)
        : {},
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Persists an audit entry. A failure to write audit data must never mask the
 * original result of the request, so it is logged and swallowed.
 */
export async function recordAudit(input: CreateAuditEntryInput): Promise<void> {
  const entry = createAuditEntry(input);
  try {
    await getPlatformStore().appendAudit(entry);
  } catch (error) {
    logError('audit.write_failed', {
      action: entry.action,
      auditId: entry.auditId,
      tenantId: entry.tenantId,
      requestId: entry.requestId,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}
