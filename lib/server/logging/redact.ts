import 'server-only';

/**
 * Log redaction.
 *
 * Everything that leaves the process as a log line passes through here. The
 * Admin app never logs request bodies for auth or secret routes, and even when
 * a caller passes an object by mistake the sensitive members are removed.
 */

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 60;
const MAX_STRING_LENGTH = 4000;
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /^authorization$/i,
  /authorizationheader$/i,
  /token$/i,
  /^token/i,
  /privatekey/i,
  /password/i,
  /passphrase/i,
  /apikey/i,
  /serviceaccount/i,
  /ciphertext/i,
  /^secret$/i,
  /secretkey/i,
  /secretvalue/i,
  /clientsecret/i,
  /^cookie$/i,
  /^setcookie$/i,
  /sessioncookie/i,
  /^credential/i,
  /^encryptionkey/i,
  /^decryptionkey/i,
];

const PEM_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const TOKEN_ASSIGNMENT_PATTERN = /\b(token|secret|api[_-]?key|password)=([^&\s]+)/gi;

export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactText(value: string): string {
  return value
    .replace(PEM_BLOCK_PATTERN, REDACTED)
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(TOKEN_ASSIGNMENT_PATTERN, `$1=${REDACTED}`);
}

/**
 * Deep-clones a value for logging, replacing sensitive keys and scrubbing
 * token-shaped strings. Never mutates the input.
 */
export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (depth >= MAX_DEPTH) return '[TRUNCATED]';

  if (typeof value === 'string') {
    const redacted = redactText(value);
    return redacted.length > MAX_STRING_LENGTH
      ? `${redacted.slice(0, MAX_STRING_LENGTH)}[TRUNCATED]`
      : redacted;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return '[UNSERIALIZABLE]';

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      // Stack traces can embed request URLs containing query tokens.
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const keys = Object.keys(source);
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      result[key] = isSensitiveKey(key) ? REDACTED : sanitizeForLog(source[key], depth + 1);
    }
    if (keys.length > MAX_OBJECT_KEYS) {
      result.__truncatedKeys = keys.length - MAX_OBJECT_KEYS;
    }
    return result;
  }

  return '[UNKNOWN]';
}

/** Convenience helper used by tests and log assertions. */
export function serializeForLog(value: unknown): string {
  try {
    return JSON.stringify(sanitizeForLog(value)) ?? '';
  } catch {
    return '[UNSERIALIZABLE]';
  }
}
