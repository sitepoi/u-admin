import 'server-only';

import { z } from 'zod';

import { DELIVERY_MODES } from '@/lib/shared/constants';
import type { DeliveryMode } from '@/lib/shared/constants';
import type { SecretMetadata, SecretStatus } from '@/lib/shared/platform-types';
import { ApiError } from '@/lib/server/errors';

/** Metadata-only schema. The Secret API never returns key material here. */
const rawSecretMetadataSchema = z
  .object({
    secretId: z.string().min(1),
    tenantId: z.string().min(1),
    appId: z.string().optional(),
    kid: z.string().nullable().optional(),
    algorithm: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    deliveryMode: z.string().nullable().optional(),
    deliveryStatus: z.string().nullable().optional(),
    fingerprint: z.string().nullable().optional(),
    version: z.number().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    rotationDueAt: z.string().nullable().optional(),
    lastDeliveredAt: z.string().nullable().optional(),
    lastDeliveryError: z.string().nullable().optional(),
  })
  .passthrough();

const secretListResponseSchema = z.union([
  z.object({ secrets: z.array(rawSecretMetadataSchema) }).passthrough(),
  z.array(rawSecretMetadataSchema),
  z.object({ data: z.array(rawSecretMetadataSchema) }).passthrough(),
  // A single-secret endpoint may return the object directly.
  rawSecretMetadataSchema,
]);

const revealResponseSchema = z
  .object({
    secretId: z.string().optional(),
    kid: z.string().nullable().optional(),
    algorithm: z.string().nullable().optional(),
    version: z.number().nullable().optional(),
    privateKeyPem: z.string().optional(),
    privateKey: z.string().optional(),
  })
  .passthrough();

const deliveryResponseSchema = z
  .object({
    secretId: z.string().optional(),
    mode: z.string().optional(),
    deliveryStatus: z.string().optional(),
    deliveredAt: z.string().nullable().optional(),
    target: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .passthrough();

const retireResponseSchema = z
  .object({
    secretId: z.string().optional(),
    status: z.string().optional(),
    retiredAt: z.string().nullable().optional(),
  })
  .passthrough();

const STATUS_ALIASES: Readonly<Record<string, SecretStatus>> = {
  active: 'active',
  enabled: 'active',
  healthy: 'active',
  pending: 'pending-delivery',
  'pending-delivery': 'pending-delivery',
  pending_delivery: 'pending-delivery',
  delivering: 'pending-delivery',
  failed: 'failed-delivery',
  'failed-delivery': 'failed-delivery',
  failed_delivery: 'failed-delivery',
  error: 'failed-delivery',
  'rotation-due': 'rotation-due',
  rotation_due: 'rotation-due',
  expiring: 'rotation-due',
  retired: 'retired',
  revoked: 'retired',
  disabled: 'retired',
};

export function normalizeSecretStatus(rawStatus: string | null | undefined): SecretStatus {
  if (!rawStatus) return 'unknown';
  return STATUS_ALIASES[rawStatus.trim().toLowerCase()] ?? 'unknown';
}

function normalizeDeliveryMode(rawMode: string | null | undefined): DeliveryMode | null {
  if (!rawMode) return null;
  const candidate = rawMode.trim().toLowerCase();
  return (DELIVERY_MODES as readonly string[]).includes(candidate)
    ? (candidate as DeliveryMode)
    : null;
}

export function normalizeSecretMetadata(
  raw: z.infer<typeof rawSecretMetadataSchema>,
): SecretMetadata {
  return {
    secretId: raw.secretId,
    tenantId: raw.tenantId,
    appId: raw.appId ?? 'publicwebsite',
    kid: raw.kid ?? null,
    algorithm: raw.algorithm ?? null,
    status: normalizeSecretStatus(raw.status),
    rawStatus: raw.status ?? null,
    deliveryMode: normalizeDeliveryMode(raw.deliveryMode),
    deliveryStatus: raw.deliveryStatus ?? null,
    fingerprint: raw.fingerprint ?? null,
    version: raw.version ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    rotationDueAt: raw.rotationDueAt ?? null,
    lastDeliveredAt: raw.lastDeliveredAt ?? null,
    lastDeliveryError: raw.lastDeliveryError ?? null,
  };
}

export function parseSecretListResponse(payload: unknown): SecretMetadata[] {
  const parsed = secretListResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw ApiError.internal(new Error('Unexpected Secret API metadata payload.'));
  }
  const data = parsed.data as unknown;
  let rawSecrets: z.infer<typeof rawSecretMetadataSchema>[];
  if (Array.isArray(data)) {
    rawSecrets = data as z.infer<typeof rawSecretMetadataSchema>[];
  } else if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { secrets?: unknown }).secrets)
  ) {
    rawSecrets = (data as { secrets: z.infer<typeof rawSecretMetadataSchema>[] }).secrets;
  } else if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    rawSecrets = (data as { data: z.infer<typeof rawSecretMetadataSchema>[] }).data;
  } else {
    rawSecrets = [data as z.infer<typeof rawSecretMetadataSchema>];
  }
  return rawSecrets.map(normalizeSecretMetadata);
}

export interface RevealedSecret {
  secretId: string;
  kid: string | null;
  algorithm: string | null;
  version: number | null;
  privateKeyPem: string;
}

export function parseRevealResponse(secretId: string, payload: unknown): RevealedSecret {
  const parsed = revealResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw ApiError.internal(new Error('Unexpected Secret API reveal payload.'));
  }
  const privateKeyPem = parsed.data.privateKeyPem ?? parsed.data.privateKey ?? '';
  if (!privateKeyPem) {
    throw ApiError.internal(new Error('Secret API reveal payload contained no key material.'));
  }
  return {
    secretId: parsed.data.secretId ?? secretId,
    kid: parsed.data.kid ?? null,
    algorithm: parsed.data.algorithm ?? null,
    version: parsed.data.version ?? null,
    privateKeyPem,
  };
}

export interface DeliveryResult {
  secretId: string;
  mode: DeliveryMode | null;
  deliveryStatus: string;
  deliveredAt: string | null;
  target: string | null;
  message: string | null;
}

export function parseDeliveryResponse(secretId: string, payload: unknown): DeliveryResult {
  const parsed = deliveryResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw ApiError.internal(new Error('Unexpected Secret API delivery payload.'));
  }
  return {
    secretId: parsed.data.secretId ?? secretId,
    mode: normalizeDeliveryMode(parsed.data.mode),
    deliveryStatus: parsed.data.deliveryStatus ?? 'unknown',
    deliveredAt: parsed.data.deliveredAt ?? null,
    target: parsed.data.target ?? null,
    message: parsed.data.message ?? null,
  };
}

export interface RetireResult {
  secretId: string;
  status: string;
  retiredAt: string | null;
}

export function parseRetireResponse(secretId: string, payload: unknown): RetireResult {
  const parsed = retireResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw ApiError.internal(new Error('Unexpected Secret API retire payload.'));
  }
  return {
    secretId: parsed.data.secretId ?? secretId,
    status: parsed.data.status ?? 'retired',
    retiredAt: parsed.data.retiredAt ?? null,
  };
}

export function countSecretHealth(
  secrets: readonly SecretMetadata[],
): {
  active: number;
  pendingDelivery: number;
  failedDelivery: number;
  rotationDue: number;
  retired: number;
  total: number;
} {
  const counts = {
    active: 0,
    pendingDelivery: 0,
    failedDelivery: 0,
    rotationDue: 0,
    retired: 0,
    total: secrets.length,
  };
  for (const secret of secrets) {
    switch (secret.status) {
      case 'active':
        counts.active += 1;
        break;
      case 'pending-delivery':
        counts.pendingDelivery += 1;
        break;
      case 'failed-delivery':
        counts.failedDelivery += 1;
        break;
      case 'rotation-due':
        counts.rotationDue += 1;
        break;
      case 'retired':
        counts.retired += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}
