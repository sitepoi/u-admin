import 'server-only';

/**
 * Email allowlist.
 *
 * Firebase Auth is the identity provider, but a valid Firebase account is not
 * sufficient: the email must also appear in PLATFORM_ADMIN_EMAILS. Matching is
 * exact, case-insensitive and never supports wildcards.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function isEmailAllowlisted(
  email: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  return allowlist.some((allowedEmail) => normalizeEmail(allowedEmail) === normalizedEmail);
}
