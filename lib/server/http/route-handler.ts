import 'server-only';

import type { NextRequest } from 'next/server';

import { getPlatformConfig } from '@/lib/server/env';
import { toApiError, ApiError, type ApiErrorCode } from '@/lib/server/errors';
import { logError, logInfo, logWarn } from '@/lib/server/logging/logger';
import { consumeRateLimit, type RateLimitRule } from '@/lib/server/rate-limit/limiter';
import { jsonError, jsonOk } from '@/lib/server/http/respond';
import { getClientIp, getRequestId, getSafePath, getUserAgent } from '@/lib/server/http/request-context';
import { assertCsrfToken, assertOriginAllowed, hasSessionCookie } from '@/lib/server/auth/csrf';
import { readPlatformSession, type PlatformSession } from '@/lib/server/auth/session';
import { assertRoleCan, type Permission } from '@/lib/server/auth/roles';
import { recordAudit, type AuditRequestContext } from '@/lib/server/audit/audit-service';
import type { AuditAction } from '@/lib/shared/platform-types';

export interface ApiRouteDefinition {
  /** Stable route label used in logs and audit records. */
  route: string;
  auth?: 'public' | 'session';
  permission?: Permission;
  /** State-changing request: Origin + (when a session cookie exists) CSRF. */
  mutation?: boolean;
  rateLimit?: RateLimitRule;
  /** Action recorded in the audit log when the permission check fails. */
  deniedAction?: AuditAction;
}

export interface ApiRouteContext {
  request: NextRequest;
  requestId: string;
  ip: string;
  userAgent: string;
  session: PlatformSession | null;
  auditContext: AuditRequestContext;
}

type ApiHandler = (context: ApiRouteContext) => Promise<Response>;

const DEFAULT_MUTATION_RATE_LIMIT: RateLimitRule = { limit: 30, windowMs: 60_000 };
const DEFAULT_READ_RATE_LIMIT: RateLimitRule = { limit: 120, windowMs: 60_000 };

const FORBIDDEN_CODES: ApiErrorCode[] = ['FORBIDDEN', 'UNAUTHORIZED', 'MFA_REQUIRED', 'REAUTH_REQUIRED'];

/**
 * The single entry point for every platform API route.
 *
 * Order of enforcement:
 * 1. rate limit,
 * 2. Origin (all mutations) and CSRF (mutations carrying a session cookie),
 * 3. session verification (Firebase Admin),
 * 4. role/permission check,
 * 5. handler.
 *
 * The wrapper never reads or logs request bodies.
 */
export async function runApiRoute(
  request: NextRequest,
  definition: ApiRouteDefinition,
  handler: ApiHandler,
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const route = definition.route;
  const mutation = definition.mutation === true;

  let session: PlatformSession | null = null;
  let result: 'success' | 'denied' | 'error' = 'error';
  let statusCode = 200;

  const auditContext: AuditRequestContext = { ip, userAgent, requestId };

  try {
    const rateLimitRule =
      definition.rateLimit ?? (mutation ? DEFAULT_MUTATION_RATE_LIMIT : DEFAULT_READ_RATE_LIMIT);
    const rateLimit = consumeRateLimit(`${route}:${ip}`, rateLimitRule);
    if (!rateLimit.allowed) {
      throw new ApiError('RATE_LIMITED', 'Too many requests. Please slow down.', {
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      });
    }

    if (mutation) {
      const config = getPlatformConfig();
      assertOriginAllowed(request, config.acceptedOrigins);
      if (hasSessionCookie(request) || definition.auth === 'session') {
        assertCsrfToken(request);
      }
    }

    if (definition.auth === 'session') {
      session = await readPlatformSession(request);
      if (definition.permission) {
        assertRoleCan(session.role, definition.permission);
      }
    }

    const response = await handler({
      request,
      requestId,
      ip,
      userAgent,
      session,
      auditContext,
    });

    statusCode = response.status;
    result = 'success';

    // Re-apply the no-store contract in case a handler built its own response.
    if (!response.headers.has('Cache-Control')) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  } catch (error) {
    const apiError = toApiError(error);
    statusCode = apiError.status;
    result = FORBIDDEN_CODES.includes(apiError.code) ? 'denied' : 'error';

    if (result === 'denied' && session) {
      await recordAudit({
        actor: { uid: session.uid, email: session.email, role: session.role },
        action: 'auth.denied',
        targetType: 'platform',
        targetId: route,
        result: 'denied',
        metadata: { route, code: apiError.code, permission: definition.permission ?? null },
        context: auditContext,
      });
      if (definition.deniedAction) {
        await recordAudit({
          actor: { uid: session.uid, email: session.email, role: session.role },
          action: definition.deniedAction,
          targetType: 'secret',
          targetId: getSafePath(request),
          result: 'denied',
          metadata: { route, code: apiError.code },
          context: auditContext,
        });
      }
    }

    if (apiError.code === 'INTERNAL_ERROR') {
      logError('api.request_failed', {
        route,
        requestId,
        actorUid: session?.uid ?? null,
        code: apiError.code,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    } else {
      logWarn('api.request_rejected', {
        route,
        requestId,
        actorUid: session?.uid ?? null,
        code: apiError.code,
        status: apiError.status,
        durationMs: Date.now() - startedAt,
      });
    }

    return jsonError(apiError, requestId);
  } finally {
    logInfo('api.request', {
      route,
      requestId,
      actorUid: session?.uid ?? null,
      actorRole: session?.role ?? null,
      result,
      status: statusCode,
      durationMs: Date.now() - startedAt,
    });
  }
}

/** Convenience wrapper for handlers that only need the request context. */
export function ok(data: unknown, options?: { status?: number; requestId?: string }): Response {
  return jsonOk(data, options);
}
