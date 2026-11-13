/**
 * IP allowlist matching for the edge middleware.
 *
 * Supports exact IPv4/IPv6 literals and IPv4 CIDR ranges. IPv6 CIDR matching is
 * intentionally not implemented: use an exact literal or rely on the access
 * proxy for IPv6 networks.
 */

function parseIpv4ToInt(ipAddress: string): number | null {
  const parts = ipAddress.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  // Convert to unsigned 32-bit.
  return result >>> 0;
}

function parseIpv4Cidr(entry: string): { network: number; mask: number } | null {
  const [addressPart, prefixPart] = entry.split('/');
  if (addressPart === undefined || prefixPart === undefined) return null;
  if (!/^\d{1,2}$/.test(prefixPart)) return null;
  const prefixLength = Number(prefixPart);
  if (prefixLength < 0 || prefixLength > 32) return null;
  const network = parseIpv4ToInt(addressPart);
  if (network === null) return null;
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return { network: (network & mask) >>> 0, mask };
}

function normalizeRemoteAddress(remoteAddress: string): string {
  let address = remoteAddress.trim().toLowerCase();
  if (address.startsWith('::ffff:') && address.includes('.')) {
    address = address.slice('::ffff:'.length);
  }
  return address;
}

export function isIpAllowed(remoteAddress: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!remoteAddress) return false;
  const address = normalizeRemoteAddress(remoteAddress);

  for (const rawEntry of allowlist) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === address) return true;

    if (entry.includes('/') && !entry.includes(':')) {
      const cidr = parseIpv4Cidr(entry);
      const candidate = parseIpv4ToInt(address);
      if (cidr && candidate !== null && (candidate & cidr.mask) >>> 0 === cidr.network) {
        return true;
      }
    }
  }
  return false;
}
