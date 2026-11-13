# Security Policy - UniconHub Platform Admin

This document describes the security model, invariants and deployment requirements for the
Platform Admin application.

---

## Reporting a vulnerability

Report suspected vulnerabilities privately to the platform owners. Do not open a public
issue, paste key material into a ticket, or test against production tenants.

Include:

- the affected route or component;
- reproduction steps with synthetic data;
- impact assessment;
- whether any secret material may have been exposed.

If a private key may have been exposed, rotate it through the Secret API immediately and
follow the incident response section below.

---

## 1. Assets and trust boundaries

| Asset | Where it lives | Admin app access |
| --- | --- | --- |
| Tenant metadata | Admin Firebase project (`platform_tenants`) | Read/write |
| Audit records | Admin Firebase project (`platform_audit_log`) | Append and read only |
| Reporting snapshots | Admin Firebase project (`platform_report_snapshots`) | Read/write aggregates |
| Platform settings | Admin Firebase project (`platform_settings`) | Read/write |
| Secret metadata | Secret API | Read through service token |
| Private keys | Secret API vault | Never stored; revealed transiently |
| Ciphertext | Secret API vault | Never present |
| Master encryption key | Secret API vault | Never present |

Trust boundaries:

1. **Browser -> Admin app.** Untrusted input. Protected by host guard, session cookie,
   CSRF, Origin checks, MFA, allowlist, role matrix and input validation.
2. **Admin app -> Secret API.** Server-to-server, bearer service token plus a forwarded
   user actor token. The Secret API re-verifies every claim.
3. **Admin app -> CMS system API.** Server-to-server. The API key is part of the URL path
   and is redacted from logs.
4. **Admin app -> tenant Firebase projects.** Read-only aggregates through a dedicated
   service account. Raw tenant documents never enter the platform database.
5. **Access proxy -> Admin app.** Treated as an optimization, never as the only control.

---

## 2. Authentication controls

- **No public sign-up.** The application exposes no registration route or UI. Firebase
  accounts are created by an owner in the console. A self-created Firebase account still
  cannot obtain a session because of the email allowlist and role claim.
- **Email allowlist.** `PLATFORM_ADMIN_EMAILS` is an exact, case-insensitive list. It is
  checked on session creation and on every session verification.
- **MFA mandatory.** `POST /api/auth/session` rejects tokens without
  `firebase.sign_in_second_factor`. Session verification repeats the check, so a token
  minted without MFA cannot become a working session.
- **Role claim required.** `platformRole` must be one of `owner`, `admin`, `operator`,
  `auditor`. A missing or unknown claim is rejected with `403 FORBIDDEN`.
- **Session cookie.**
  - name: `__Host-platform_session`
  - `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`
  - lifetime: `PLATFORM_SESSION_TTL_HOURS` (default 8, clamped to 1-24)
  - created with Firebase Admin `createSessionCookie`, verified with
    `verifySessionCookie(cookie, true)` so revocation is immediate
- **CSRF.** Double-submit token: a random 32-byte token in `__Host-platform_csrf`
  (readable by JS) must equal the `x-csrf-token` header in constant time. Enforced at the
  edge and again in the route wrapper for every cookie-authenticated mutation.
- **Origin.** Every state-changing request must carry an `Origin` equal to
  `https://PLATFORM_HOST` (or a configured development origin). Cross-site
  `Sec-Fetch-Site` is rejected.
- **Logout.** Clears both cookies and calls `revokeRefreshTokens` for the session uid.
- **Reveal re-authentication.** A fresh Firebase ID token is required and its `auth_time`
  must be within `PLATFORM_REVEAL_FRESH_AUTH_SECONDS` (default 300). The token must also
  belong to the session uid, carry MFA and an `owner` role claim.

---

## 3. Authorization matrix

| Action | owner | admin | operator | auditor |
| --- | --- | --- | --- | --- |
| View dashboard and tenants | yes | yes | yes | yes |
| Create/edit tenant metadata | yes | yes | yes | no |
| Provision tenant | yes | yes | no | no |
| Archive tenant | yes | no | no | no |
| View secret metadata | yes | yes | yes | no |
| Reveal private key | yes | no | no | no |
| Deliver secret | yes | yes | no | no |
| Retire secret | yes | no | no | no |
| Refresh reporting | yes | yes | no | no |
| View audit | yes | yes | no | yes |
| Manage platform settings | yes | no | no | no |

The matrix lives in `lib/server/auth/roles.ts`. The UI hides controls, but every API route
enforces the same permission server-side. A test asserts every cell.

---

## 4. Secret handling invariants

These invariants are enforced by code review, tests and source scans:

1. The Admin app never reads `SECRETS_ENC_KEY`, `SECRETS_FINGERPRINT_KEY`,
   `SECRET_API_CMS_ENROLL_TOKEN` or `SECRET_API_RUNTIME_FETCH_TOKEN`.
2. No private key, ciphertext or ID token is written to Firestore.
3. `platform_settings` and `platform_tenants` contain no secret material.
4. Audit metadata passes through redaction before it is persisted.
5. Structured logs pass through redaction: keys ending in `token`, `privateKey*`,
   `password`, `apiKey`, `serviceAccount`, `ciphertext`, `authorization`, `cookie` and
   PEM/JWT-shaped strings are replaced with `[REDACTED]`.
6. Request bodies are never logged on any route.
7. Reveal responses are returned with `Cache-Control: no-store, no-cache, must-revalidate`
   and `Pragma: no-cache`, and are never logged or cached server-side.
8. The browser holds a revealed key only in React state. It is not written to
   `localStorage`, `sessionStorage`, cookies, the URL or analytics, and it is cleared when
   the dialog closes.
9. The browser never calls the Secret API directly; there is no Secret API URL in client
   code.
10. `NEXT_PUBLIC_` is never applied to a secret.

Automated checks:

- `tests/security/source-scan.test.ts` - forbidden env names, `NEXT_PUBLIC_` misuse,
  `server-only` coverage, client imports of server modules, Firestore client SDK usage,
  browser storage usage, required routes, Firestore rules and indexes.
- `tests/security/build-bundle-scan.test.ts` - scans `.next/static` for service tokens,
  key markers and private Firebase variables.
- `tests/security/log-scan.test.ts` - captures console output and asserts no key material
  or ID token is emitted.
- `tests/integration/reveal.test.ts` - asserts the key is returned with `no-store`,
  forwarded correctly and never logged.

---

## 5. Host and transport controls

- Only `PLATFORM_HOST` is served. Every other `Host` returns a bare 404, including tenant
  hosts, preview hosts and the bare Vercel URL.
- In production, `PLATFORM_ALLOWED_DEV_HOSTS` is ignored.
- Optional `PLATFORM_IP_ALLOWLIST` supports exact IPs and IPv4 CIDR ranges. IPv6 CIDR is
  intentionally not supported; use exact IPv6 addresses or the access proxy.
- HSTS, `nosniff`, `DENY` framing, `no-referrer`, restrictive Permissions-Policy,
  COOP/CORP and a nonce CSP with `strict-dynamic` are set on every response.
- `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` is set on every response and
  `robots.txt` disallows everything.
- API responses are `Cache-Control: no-store`.

Deployment requirement: the entire host must sit behind Cloudflare Access, Google IAP,
Tailscale, a corporate VPN or an allowlisted network. A secret hostname is not a control;
certificate transparency logs expose it.

---

## 6. Data handling

- Firestore is server-only. `firestore.rules` denies every client read and write.
- Audit records are append-only: the store exposes no update or delete method, and the
  Firestore implementation uses `document.create()` so a duplicate id fails.
- Tenant records are never hard-deleted. Archiving is a status change.
- Reporting stores aggregates only. It never copies raw tenant objects.
- Audit metadata is truncated and redacted. IP and user agent are truncated.
- The audit log records actor uid, email, role, action, target, tenant, result, IP, user
  agent and request id for every sensitive action.

---

## 7. Logging policy

Structured JSON only:

```json
{
  "level": "info",
  "time": "2026-01-01T00:00:00.000Z",
  "service": "platform-admin",
  "event": "api.request",
  "route": "POST /api/platform/tenants",
  "requestId": "...",
  "actorUid": "...",
  "result": "success",
  "status": 201,
  "durationMs": 42
}
```

Never logged:

- request bodies;
- private keys, ciphertext or PEM blocks;
- Firebase ID tokens, session cookies, CSRF tokens or service tokens;
- `Authorization` headers;
- service account JSON;
- CMS URLs containing the API key.

Redaction is implemented in `lib/server/logging/redact.ts` and applied by the logger and by
audit record creation.

---

## 8. Deployment checklist

Before exposing the host:

- [ ] A separate Firebase project exists for the Admin app.
- [ ] Firestore rules are deployed and deny all client access.
- [ ] Composite indexes from `firestore.indexes.json` are deployed.
- [ ] `PLATFORM_ADMIN_EMAILS` contains only current operators.
- [ ] Every operator has MFA enrolled and a `platformRole` claim.
- [ ] `PLATFORM_HOST` is the real host and the Vercel preview URL is not advertised.
- [ ] The host is behind the access proxy / VPN.
- [ ] `PLATFORM_IP_ALLOWLIST` is set if the proxy provides a stable egress range.
- [ ] The Secret API service token is unique to this application and rotated on schedule.
- [ ] The CMS system API key is unique to this application.
- [ ] The reporting service account is read-only and scoped to the tenant projects.
- [ ] `PLATFORM_E2E_MODE` is unset.
- [ ] `NEXT_PUBLIC_PLATFORM_E2E_MODE` is `false` or unset.
- [ ] Cron, if enabled, uses a random `PLATFORM_REPORTING_CRON_SECRET` matching
      Vercel's `CRON_SECRET`.
- [ ] Log drains do not include request bodies and retain audit events appropriately.
- [ ] A process exists to remove leavers from the allowlist and disable their Firebase
      account.

---

## 9. Incident response

1. Disable the affected Firebase user and remove the email from `PLATFORM_ADMIN_EMAILS`.
2. Revoke refresh tokens for the uid. `verifySessionCookie(value, true)` then rejects existing
   session cookies issued before the revocation, so this also ends active sessions.
3. Rotate `SECRET_API_ADMIN_SERVICE_TOKEN`, `CMS_SYSTEM_API_KEY` and, if exposed, the
   Firebase service account key.
4. Review `platform_audit_log` for `auth.denied`, `auth.session_created`,
   `secret.reveal_requested`, `secret.deliver_requested` and `tenant.*`.
5. If key material may have leaked, rotate the tenant key through the Secret API. The
   Admin app cannot rotate keys.
6. Preserve logs and audit records. Audit records are append-only; do not attempt to
   delete them.

---

## 10. Explicit non-goals

- The Admin app is not a general tenant CMS and has no tenant-facing authorization.
- The Admin app is not a key management service and cannot encrypt, decrypt, rotate or
  fingerprint keys.
- The Admin app does not implement end-user authentication for tenants.
- The Admin app does not replace the access proxy, WAF or network controls.

---

## 11. Known limitations

- The rate limiter is per Node.js instance. Use the access proxy for distributed limits.
- The `middleware.ts` convention is deprecated in Next.js 16 in favor of `proxy.ts`. The
  behavior is identical; migration is a rename.
- `PLATFORM_IP_ALLOWLIST` trusts proxy-provided client IP headers. Only enable it behind a
  proxy that strips client-supplied forwarding headers.
- Reporting depends on the CMS collection schema. Missing indexes or permissions are
  surfaced as partial failures rather than silently under-reporting.
