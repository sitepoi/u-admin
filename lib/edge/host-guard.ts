/**
 * Host header normalisation and matching.
 *
 * The admin application is only ever served on PLATFORM_HOST. Everything else
 * receives a 404, including any tenant host, preview deployment host or a bare
 * Vercel URL.
 */

export interface HostGuardOptions {
  platformHost: string;
  allowedDevHosts: string[];
  isDevelopment: boolean;
}

/** Lower-case a Host header and remove a trailing root dot. */
export function normalizeHostHeader(hostHeader: string | null | undefined): string {
  if (!hostHeader) return '';
  return hostHeader.trim().toLowerCase().replace(/\.$/, '');
}

/** Split `host:port` into its parts, handling bracketed IPv6 literals. */
export function splitHostAndPort(host: string): { hostname: string; port: string | null } {
  if (host.startsWith('[')) {
    const closingBracketIndex = host.indexOf(']');
    if (closingBracketIndex === -1) return { hostname: host, port: null };
    const hostname = host.slice(0, closingBracketIndex + 1);
    const remainder = host.slice(closingBracketIndex + 1);
    const port = remainder.startsWith(':') ? remainder.slice(1) : null;
    return { hostname, port };
  }
  const lastColonIndex = host.lastIndexOf(':');
  if (lastColonIndex === -1) return { hostname: host, port: null };
  // A second colon before the last one means an unbracketed IPv6 address.
  if (host.indexOf(':') !== lastColonIndex) return { hostname: host, port: null };
  return { hostname: host.slice(0, lastColonIndex), port: host.slice(lastColonIndex + 1) };
}

export function isHostAllowed(
  hostHeader: string | null | undefined,
  options: HostGuardOptions,
): boolean {
  const normalizedHost = normalizeHostHeader(hostHeader);
  if (!normalizedHost) return false;

  const platformHost = options.platformHost.trim().toLowerCase().replace(/\.$/, '');
  if (!platformHost) return false;

  const { hostname, port } = splitHostAndPort(normalizedHost);
  const platformTarget = splitHostAndPort(platformHost);

  if (platformTarget.port) {
    // An explicit port is part of the configured platform host.
    if (normalizedHost === platformHost) return true;
  } else if (hostname === platformTarget.hostname) {
    // Accept the canonical host with or without the default HTTPS port.
    if (port === null || port === '443') return true;
  }

  if (!options.isDevelopment) return false;

  for (const allowedDevHost of options.allowedDevHosts) {
    const devHost = allowedDevHost.trim().toLowerCase().replace(/\.$/, '');
    if (!devHost) continue;
    if (normalizedHost === devHost) return true;
    const devTarget = splitHostAndPort(devHost);
    if (!devTarget.port && devTarget.hostname === hostname && (port === null || port === '80')) {
      return true;
    }
  }

  return false;
}
