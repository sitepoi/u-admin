import 'server-only';

export interface CookieOptions {
  httpOnly: boolean;
  secure: true;
  sameSite: 'lax' | 'strict' | 'none';
  path: '/';
  maxAge: number;
}

/**
 * `__Host-` cookies require Secure, Path=/ and no Domain attribute.
 * Browsers treat http://localhost as a trustworthy origin, so the flag also
 * works during local development.
 */
export function sessionCookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * The CSRF cookie must be readable by the browser so it can echo the token in
 * the `x-csrf-token` header (double-submit pattern).
 */
export function csrfCookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
