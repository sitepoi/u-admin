/**
 * Cookie parsing helpers usable from the edge runtime.
 */

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(';')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = segment.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    const rawValue = segment.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

/** Constant-time string comparison that is safe on the edge runtime. */
export function timingSafeEqualString(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function isCsrfTokenValid(
  headerToken: string | null,
  cookieToken: string | null,
): boolean {
  if (!headerToken || !cookieToken) return false;
  if (headerToken.length < 32 || cookieToken.length < 32) return false;
  return timingSafeEqualString(headerToken, cookieToken);
}
