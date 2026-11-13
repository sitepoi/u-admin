import { NextResponse, type NextRequest } from 'next/server';

import {
  PLATFORM_CSRF_COOKIE,
  PLATFORM_CSRF_HEADER,
  PLATFORM_SESSION_COOKIE,
} from '@/lib/shared/constants';
import {
  getAcceptedOrigins,
  getEdgePlatformConfig,
  resolvePublicOrigin,
} from '@/lib/edge/platform-config';
import { isHostAllowed } from '@/lib/edge/host-guard';
import { isIpAllowed } from '@/lib/edge/ip-allowlist';
import { isCsrfTokenValid, readCookie } from '@/lib/edge/cookies';
import { applySecurityHeaders, buildContentSecurityPolicy } from '@/lib/edge/http-security';

export const config = {
  matcher: ['/:path*'],
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const STATIC_PREFIXES = [
  '/_next/static/',
  '/_next/image',
  '/favicon.ico',
  '/icon.svg',
  // robots.txt must be publicly readable and always disallow indexing.
  '/robots.txt',
];

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function getClientIp(request: NextRequest): string {
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('true-client-ip'),
    request.headers.get('x-real-ip'),
    request.headers.get('x-forwarded-for')?.split(',')[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return 'unknown';
}

function notFoundResponse(isDevelopment: boolean): NextResponse {
  const body = isDevelopment
    ? [
        'Not Found',
        '',
        'This host is not accepted by the platform host guard.',
        'For local development, set in .env.local:',
        '  PLATFORM_HOST=admin.uniconhub.com',
        '  PLATFORM_ALLOWED_DEV_HOSTS=localhost:3000,127.0.0.1:3000',
        'then restart the dev server and open http://localhost:3000/login',
        '',
        'Or run the self-contained demo: npm run dev:demo',
      ].join('\n')
    : 'Not Found';

  return new NextResponse(body, {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    },
  });
}

function forbiddenApiResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code: 'FORBIDDEN', message: 'The request was rejected by the platform host guard.' },
    },
    {
      status: 403,
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    },
  );
}

/**
 * Platform host guard + edge security controls.
 *
 * 1. Only PLATFORM_HOST (and dev hosts outside production) is served.
 * 2. Optional PLATFORM_IP_ALLOWLIST.
 * 3. Strict security headers, nonce-based CSP and a permanent noindex tag.
 * 4. Unauthenticated page requests are redirected to /login.
 * 5. Cookie-authenticated mutations must come from the platform origin and
 *    carry a matching double-submit CSRF token.
 *
 * The middleware only checks that a session cookie exists. Cryptographic
 * verification happens in the Node.js server (Firebase Admin), so bypassing
 * this middleware still leaves auth, MFA and the role matrix enforced.
 */
export function middleware(request: NextRequest): NextResponse {
  const platformConfig = getEdgePlatformConfig();
  const hostHeader = request.headers.get('host');

  if (
    !isHostAllowed(hostHeader, {
      platformHost: platformConfig.platformHost,
      allowedDevHosts: platformConfig.allowedDevHosts,
      isDevelopment: platformConfig.isDevelopment,
    })
  ) {
    return notFoundResponse(platformConfig.isDevelopment);
  }

  if (!isIpAllowed(getClientIp(request), platformConfig.ipAllowlist)) {
    return notFoundResponse(false);
  }

  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  const isApiRequest = pathname.startsWith('/api/');
  const isStaticAsset = STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const hasSessionCookie = Boolean(
    readCookie(request.headers.get('cookie'), PLATFORM_SESSION_COOKIE),
  );

  // Origin + CSRF for cookie-authenticated mutations. Route handlers repeat
  // this check; it is duplicated at the edge so obviously hostile requests do
  // not reach the application at all.
  if (isApiRequest && MUTATION_METHODS.has(method) && hasSessionCookie) {
    const acceptedOrigins = getAcceptedOrigins(platformConfig);
    const originHeader = request.headers.get('origin');
    let originAllowed = false;
    if (originHeader) {
      try {
        originAllowed = acceptedOrigins.includes(new URL(originHeader).origin);
      } catch {
        originAllowed = false;
      }
    }
    if (!originAllowed) {
      return forbiddenApiResponse();
    }

    const headerToken = request.headers.get(PLATFORM_CSRF_HEADER);
    const cookieToken = readCookie(request.headers.get('cookie'), PLATFORM_CSRF_COOKIE);
    if (!isCsrfTokenValid(headerToken, cookieToken)) {
      return forbiddenApiResponse();
    }
  }

  if (!isApiRequest && !isStaticAsset) {
    const isAuthPage = pathname === '/login' || pathname === '/mfa-enroll';
    const publicOrigin = resolvePublicOrigin(hostHeader, platformConfig);

    if (isAuthPage && hasSessionCookie) {
      return NextResponse.redirect(new URL('/', publicOrigin), { status: 307 });
    }
    if (!isAuthPage && !hasSessionCookie) {
      const loginUrl = new URL('/login', publicOrigin);
      if (pathname !== '/') {
        loginUrl.searchParams.set('next', pathname);
      }
      const redirectResponse = NextResponse.redirect(loginUrl, { status: 307 });
      applySecurityHeaders(redirectResponse.headers);
      return redirectResponse;
    }
  }

  if (isStaticAsset) {
    const staticResponse = NextResponse.next();
    applySecurityHeaders(staticResponse.headers);
    return staticResponse;
  }

  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: platformConfig.isDevelopment,
    firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads the nonce from the request CSP header and applies it to its
  // own script tags.
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response.headers, contentSecurityPolicy);
  return response;
}
