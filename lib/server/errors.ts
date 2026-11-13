import 'server-only';

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'TENANT_NOT_FOUND',
  'TENANT_RESERVED',
  'TENANT_CONFLICT',
  'PROVISIONING_IN_PROGRESS',
  'SECRET_API_UNAVAILABLE',
  'SECRET_NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  UNAUTHORIZED: 401,
  MFA_REQUIRED: 403,
  REAUTH_REQUIRED: 403,
  FORBIDDEN: 403,
  INVALID_REQUEST: 400,
  TENANT_NOT_FOUND: 404,
  TENANT_RESERVED: 409,
  TENANT_CONFLICT: 409,
  PROVISIONING_IN_PROGRESS: 409,
  SECRET_API_UNAVAILABLE: 503,
  SECRET_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ApiErrorOptions {
  details?: unknown;
  cause?: unknown;
  /** Headers to add to the error response, e.g. Retry-After. */
  headers?: Record<string, string>;
}

/**
 * The single error type understood by the route wrapper. Messages are safe to
 * return to the browser: they must never contain tokens, keys or ciphertext.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly headers: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = API_ERROR_STATUS[code];
    this.details = options.details;
    this.headers = options.headers ?? {};
  }

  static unauthorized(message = 'Authentication required.'): ApiError {
    return new ApiError('UNAUTHORIZED', message);
  }

  static mfaRequired(message = 'Multi-factor authentication is required.'): ApiError {
    return new ApiError('MFA_REQUIRED', message);
  }

  static reauthRequired(message = 'Recent authentication is required.'): ApiError {
    return new ApiError('REAUTH_REQUIRED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action.'): ApiError {
    return new ApiError('FORBIDDEN', message);
  }

  static invalidRequest(message = 'The request is invalid.', details?: unknown): ApiError {
    return new ApiError('INVALID_REQUEST', message, { details });
  }

  static notFound(entity: 'tenant' | 'secret'): ApiError {
    return entity === 'tenant'
      ? new ApiError('TENANT_NOT_FOUND', 'Tenant not found.')
      : new ApiError('SECRET_NOT_FOUND', 'Secret not found.');
  }

  static internal(cause?: unknown): ApiError {
    return new ApiError('INTERNAL_ERROR', 'An unexpected error occurred.', { cause });
  }
}

export class ConfigurationError extends Error {
  readonly variableNames: string[];
  readonly scope: string;

  constructor(variableNames: string[], scope: string) {
    super(`Missing or invalid configuration for ${scope}: ${variableNames.join(', ')}`);
    this.name = 'ConfigurationError';
    this.variableNames = variableNames;
    this.scope = scope;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ConfigurationError) {
    return new ApiError('INTERNAL_ERROR', 'Server configuration is incomplete.', {
      cause: error,
      details: { scope: error.scope, variables: error.variableNames },
    });
  }
  return ApiError.internal(error);
}
