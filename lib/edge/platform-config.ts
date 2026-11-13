/**
 * Edge-safe platform host configuration.
 *
 * Middleware runs on the edge runtime, so this module must not import
 * `server-only`, `firebase-admin` or any Node built-in.
 */

export interface EdgePlatformConfig {
  /** Canonical platform host, lower-case, no scheme, no trailing slash. */
  platformHost: string;
  /** Additional hosts accepted in development (host or host:port). */
  allowedDevHosts: string[];
  /** `true` when NODE_ENV is not production. */
  isDevelopment: boolean;
  /** Raw comma separated IP allowlist entries. Empty string disables the check. */
  ipAllowlist: string[];
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Accepts both `admin.example.com` and common paste mistakes such as
 * `https://admin.example.com/` or `Admin.Example.com.`. The host guard only
 * ever compares bare hosts.
 */
export function normalizeConfiguredHost(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

let warnedAboutMissingPlatformHost = false;

export function getEdgePlatformConfig(): EdgePlatformConfig {
  const platformHost = normalizeConfiguredHost(process.env.PLATFORM_HOST);

  if (!platformHost && !warnedAboutMissingPlatformHost) {
    warnedAboutMissingPlatformHost = true;
    console.warn(
      '[platform-admin] PLATFORM_HOST is not set. The host guard returns 404 for every request. Set PLATFORM_HOST to the exact host you open (for example admin.example.com), then redeploy.',
    );
  }

  return {
    platformHost,
    allowedDevHosts: splitList(process.env.PLATFORM_ALLOWED_DEV_HOSTS).map((host) =>
      normalizeConfiguredHost(host),
    ),
    isDevelopment: process.env.NODE_ENV !== 'production',
    ipAllowlist: splitList(process.env.PLATFORM_IP_ALLOWLIST),
  };
}

/**
 * The complete set of origins accepted for state-changing requests.
 * Mirrors the host guard: only the platform host (and dev hosts in dev) may
 * submit a mutation with a session cookie.
 */
/**
 * Origin used for redirects. Never relies on the internal connection URL, so
 * a reverse proxy on a different internal address cannot redirect users to
 * the wrong host. Development hosts keep http://; everything else is https://.
 */
export function resolvePublicOrigin(
  hostHeader: string | null | undefined,
  config: EdgePlatformConfig,
): string {
  const normalizedHost = (hostHeader ?? '').trim().toLowerCase().replace(/\.$/, '');

  if (config.isDevelopment && normalizedHost) {
    const isDevelopmentHost = config.allowedDevHosts.some(
      (devHost) => devHost.trim().toLowerCase().replace(/\.$/, '') === normalizedHost,
    );
    if (isDevelopmentHost) {
      return `http://${normalizedHost}`;
    }
  }

  return `https://${config.platformHost}`;
}

export function getAcceptedOrigins(config: EdgePlatformConfig): string[] {
  const origins: string[] = [];
  if (config.platformHost) {
    origins.push(`https://${config.platformHost}`);
  }
  if (config.isDevelopment) {
    for (const devHost of config.allowedDevHosts) {
      origins.push(`http://${devHost}`);
      origins.push(`https://${devHost}`);
    }
  }
  return origins;
}
