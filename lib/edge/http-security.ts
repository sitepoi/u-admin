/**
 * HTTP security headers and Content-Security-Policy construction.
 * Edge-safe: imported by middleware.
 */

export interface CspOptions {
  nonce: string;
  isDevelopment: boolean;
  /** Firebase Auth domain used for the reCAPTCHA / MFA iframe. */
  firebaseAuthDomain?: string;
}

export function buildContentSecurityPolicy(options: CspOptions): string {
  const { nonce, isDevelopment, firebaseAuthDomain } = options;

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    isDevelopment ? "'unsafe-eval'" : '',
  ].filter((source) => source.length > 0);

  const connectSources = [
    "'self'",
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://www.googleapis.com',
  ];
  if (firebaseAuthDomain) {
    connectSources.push(`https://${firebaseAuthDomain}`);
  }

  const frameSources = [
    "'self'",
    'https://www.google.com',
    'https://recaptcha.google.com',
  ];
  if (firebaseAuthDomain) {
    frameSources.push(`https://${firebaseAuthDomain}`);
  }

  const directives = [
    `default-src 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `script-src ${scriptSources.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self' data:`,
    `connect-src ${connectSources.join(' ')}`,
    `frame-src ${frameSources.join(' ')}`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    // Do not upgrade in development: a LAN dev host is served over plain HTTP.
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ];

  return directives.join('; ');
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

export function applySecurityHeaders(headers: Headers, contentSecurityPolicy?: string): void {
  for (const [headerName, headerValue] of Object.entries(SECURITY_HEADERS)) {
    headers.set(headerName, headerValue);
  }
  if (contentSecurityPolicy) {
    headers.set('Content-Security-Policy', contentSecurityPolicy);
  }
}
