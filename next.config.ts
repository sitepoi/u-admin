import type { NextConfig } from 'next';

/**
 * The Platform Admin app intentionally keeps the default Node.js runtime for
 * every route: Firebase Admin, the Secret API client and the reporting
 * collector all require Node APIs.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Never advertise the framework version.
  poweredByHeader: false,
  // firebase-admin must not be bundled by the server compiler.
  serverExternalPackages: ['firebase-admin'],
  // Do not ship source maps of server code to the browser.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
