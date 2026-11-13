import { createServer } from 'node:http';

/**
 * Local mock for the two upstream services used by the Platform Admin:
 * - Secret API (/api/v1/first-party/secrets...)
 * - CMS system API (/api/system/...)
 *
 * It verifies the platform service credentials and the forwarded actor token,
 * so the E2E suite proves the Admin app actually delegates secret operations.
 */

const PORT = Number(process.env.MOCK_UPSTREAM_PORT ?? 4100);
const SECRET_API_TOKEN = process.env.SECRET_API_ADMIN_SERVICE_TOKEN ?? 'e2e-secret-api-token';
const CMS_API_KEY = process.env.CMS_SYSTEM_API_KEY ?? 'e2e-cms-key';

const PRIVATE_KEY_PEM =
  '-----BEGIN PRIVATE KEY-----\nE2E-TEST-KEY-NOT-REAL\n-----END PRIVATE KEY-----';

const secrets = new Map();

function seedSecret(secretId, tenantId) {
  if (secrets.has(secretId)) return secrets.get(secretId);
  const secret = {
    secretId,
    tenantId,
    appId: 'publicwebsite',
    kid: `kid_${tenantId}`,
    algorithm: 'RS256',
    status: 'active',
    deliveryMode: 'manual',
    deliveryStatus: 'delivered',
    fingerprint: `SHA256:${tenantId}`,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    rotationDueAt: null,
    lastDeliveredAt: '2026-01-02T00:00:00.000Z',
    lastDeliveryError: null,
  };
  secrets.set(secretId, secret);
  return secret;
}

seedSecret('sec_e2e_global', 'acme-travel');

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function actorRole(body) {
  const actorToken = typeof body.actorIdToken === 'string' ? body.actorIdToken : '';
  const match = /^e2e:([a-z]+):/.exec(actorToken);
  return match ? match[1] : null;
}

function requireRole(body, allowedRoles) {
  const role = actorRole(body);
  return role !== null && allowedRoles.includes(role);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  const { pathname } = url;

  if (pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  if (pathname.startsWith('/api/v1/first-party/')) {
    if (request.headers.authorization !== `Bearer ${SECRET_API_TOKEN}`) {
      sendJson(response, 401, { error: 'invalid service token' });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/v1/first-party/secrets') {
      const tenantId = url.searchParams.get('tenantId');
      if (tenantId) {
        seedSecret(`sec_${tenantId.replace(/[^a-z0-9]/gi, '_')}`, tenantId);
      }
      const list = [...secrets.values()].filter(
        (secret) => !tenantId || secret.tenantId === tenantId,
      );
      sendJson(response, 200, { secrets: list });
      return;
    }

    const singleMatch = /^\/api\/v1\/first-party\/secrets\/([^/]+)$/.exec(pathname);
    if (request.method === 'GET' && singleMatch) {
      const secret = secrets.get(decodeURIComponent(singleMatch[1]));
      if (!secret) {
        sendJson(response, 404, { error: 'not found' });
        return;
      }
      sendJson(response, 200, secret);
      return;
    }

    const actionMatch = /^\/api\/v1\/first-party\/secrets\/([^/]+)\/(reveal|deliver|retire)$/.exec(
      pathname,
    );
    if (request.method === 'POST' && actionMatch) {
      const secretId = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const secret = secrets.get(secretId) ?? seedSecret(secretId, 'unknown-tenant');
      const body = await readBody(request);

      if (action === 'reveal') {
        if (!requireRole(body, ['owner'])) {
          sendJson(response, 403, { error: 'owner and fresh MFA required' });
          return;
        }
        sendJson(response, 200, {
          secretId,
          kid: secret.kid,
          algorithm: secret.algorithm,
          version: secret.version,
          privateKeyPem: PRIVATE_KEY_PEM,
        });
        return;
      }

      if (action === 'deliver') {
        if (!requireRole(body, ['owner', 'admin'])) {
          sendJson(response, 403, { error: 'owner or admin required' });
          return;
        }
        secret.deliveryMode = body.mode ?? secret.deliveryMode;
        secret.deliveryStatus = 'delivered';
        secret.lastDeliveredAt = new Date().toISOString();
        sendJson(response, 200, {
          secretId,
          mode: secret.deliveryMode,
          deliveryStatus: 'delivered',
          deliveredAt: secret.lastDeliveredAt,
          target: 'e2e-target',
          message: null,
        });
        return;
      }

      if (!requireRole(body, ['owner'])) {
        sendJson(response, 403, { error: 'owner required' });
        return;
      }
      secret.status = 'retired';
      sendJson(response, 200, {
        secretId,
        status: 'retired',
        retiredAt: new Date().toISOString(),
      });
      return;
    }

    sendJson(response, 404, { error: 'not found' });
    return;
  }

  const cmsMatch = /^\/api\/system\/([^/]+)\/(ctgc|rfti)\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (request.method === 'POST' && cmsMatch) {
    const [, key, operation, tenantId] = cmsMatch;
    if (key !== CMS_API_KEY) {
      sendJson(response, 401, { error: 'invalid cms key' });
      return;
    }
    if (operation === 'ctgc' && tenantId.startsWith('fail')) {
      sendJson(response, 500, { error: 'simulated CMS failure' });
      return;
    }
    sendJson(response, operation === 'ctgc' ? 201 : 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`mock upstreams listening on http://127.0.0.1:${PORT}\n`);
});
