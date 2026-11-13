# Test Report - UniconHub Platform Admin

**Date:** 2026-11-11
**Result:** all suites passing

## Environment

| Item | Value |
| --- | --- |
| OS | Windows |
| Node.js | v22.11.0 |
| npm | 10.9.0 |
| Next.js | 16.4.6 (Turbopack) |
| React | 19.3.1 |
| TypeScript | 5.9.3 |
| Vitest | 4.1.12 |
| Playwright | 1.65.0 (Chromium 158 headless) |
| Tailwind CSS | 3.4.19 |

## Summary

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| TypeScript (`tsc --noEmit`) | - | - | Pass |
| Production build (`next build`) | - | - | Pass |
| Unit | 8 | 131 | Pass |
| Integration | 8 | 70 | Pass |
| Security | 3 | 13 | Pass |
| **Vitest total** | **19** | **214** | **Pass** |
| End-to-end (Playwright) | 1 | 6 | Pass |

Commands:

```bash
npm run typecheck   # pass
npm test            # 214 passed
npm run build       # pass
npm run test:e2e    # 6 passed
```

## Unit tests

| File | Tests | Coverage |
| --- | --- | --- |
| `tests/unit/tenant-id.test.ts` | 12 | Trimming, lower-casing, pattern length bounds, reserved ids, host generation, domain normalization |
| `tests/unit/roles.test.ts` | 51 | Every cell of the role matrix, permission listing, `assertRoleCan`, settings matrix completeness |
| `tests/unit/csrf.test.ts` | 14 | Double-submit tokens, constant-time compare, Origin checks, `Sec-Fetch-Site`, cookie parsing |
| `tests/unit/redact.test.ts` | 8 | Sensitive keys, non-sensitive `secretId` preservation, PEM/JWT scrubbing, depth limits, no mutation |
| `tests/unit/audit.test.ts` | 5 | Record shape, metadata redaction, append-only duplicate rejection, newest-first pagination, filters |
| `tests/unit/validation.test.ts` | 12 | Zod strictness, archive enum, session refinement, audit pagination bounds, body size/type/JSON errors |
| `tests/unit/secret-api-client.test.ts` | 13 | Envelope shapes, status normalization, auth header, 404 mapping, timeouts, no token leakage, reveal payload, cache |
| `tests/unit/host-ip.test.ts` | 16 | Host normalization, port handling, tenant/preview host rejection, IPv4 CIDR, IPv6 literals, configured-host scheme/path stripping |

## Integration tests

| File | Tests | Coverage |
| --- | --- | --- |
| `tests/integration/session.test.ts` | 9 | MFA session creation, `__Host-` cookie flags, allowlist rejection, MFA rejection + audit, missing role, E2E helper refusal, Origin enforcement, logout revocation |
| `tests/integration/host-guard.test.ts` | 14 | Tenant/preview host 404, security headers, nonce CSP, unauthenticated redirect, dev-host redirect origin, authenticated pages, CSRF and Origin rejection, IP allowlist, robots |
| `tests/integration/tenants-provision.test.ts` | 15 | Normalized create, case-insensitive conflict, reserved id, list/search, metadata update, archive (owner only), provisioning success/failure/retry, enrollment retry, concurrent lock, archived block, operator denial, CSRF |
| `tests/integration/reveal.test.ts` | 9 | Owner reveal, `no-store`, actor token forwarding, audit actions, non-owner denial, stale `auth_time`, uid mismatch, MFA requirement, CSRF, 503 fail-closed, log scanning |
| `tests/integration/secret-api-failure.test.ts` | 6 | 503 on network failure/timeout, 404 mapping, invalid tenant filter, permission check, metadata never leaks keys |
| `tests/integration/reporting.test.ts` | 9 | Aggregation arithmetic, cached snapshot reads with no fan-out, aggregate-only storage, refresh persistence, GET and POST cron paths, wrong secret, operator denial |
| `tests/integration/secret-actions.test.ts` | 4 | Admin delivery, operator delivery denial, owner retirement, admin retirement denial |
| `tests/integration/settings.test.ts` | 4 | Read defaults, owner-only writes, persistence and audit, empty patch rejection |

## Security tests

| File | Tests | Coverage |
| --- | --- | --- |
| `tests/security/source-scan.test.ts` | 9 | Forbidden encryption env names, `NEXT_PUBLIC_` misuse, `server-only` coverage, client/server import boundary, no Firestore client SDK, no browser storage of secrets, required routes, rules, indexes |
| `tests/security/build-bundle-scan.test.ts` | 2 | `.next/static` contains no service token, CMS key, private key marker or server-only Firebase variable |
| `tests/security/log-scan.test.ts` | 2 | Logger redacts PEM markers; session creation never logs the ID token |

## End-to-end tests

`tests/e2e/platform-admin.spec.ts` runs against the local dev server with
`PLATFORM_E2E_MODE=true` and `tests/e2e/upstreams.mjs`, which implements the Secret API
and CMS system API contracts and verifies the service token and forwarded actor token.

| # | Test | Result |
| --- | --- | --- |
| 1 | Private login, no sign-up, MFA session (`__Host-` cookies) | Pass |
| 2 | Create tenant, provision against mocked CMS, status becomes active | Pass |
| 3 | Secret metadata, owner reveal through the Secret API, key cleared on close and after reload | Pass |
| 4 | Non-owner is denied in the UI and by direct API call (`403 FORBIDDEN`) | Pass |
| 5 | Audit shows `tenant.created`, `tenant.provision_succeeded`, `secret.reveal_requested` | Pass |
| 6 | Non-platform Host returns 404 | Pass |

## Manual production checks

Performed with `next start` and `curl`, using `Host: admin.uniconhub.test`:

| Check | Result |
| --- | --- |
| CSP header contains `script-src 'self' 'nonce-...' 'strict-dynamic'` | Pass |
| Every Next.js `<script>` carries the same nonce | Pass |
| HSTS, `nosniff`, `DENY`, `no-referrer`, Permissions-Policy, `X-Robots-Tag` present | Pass |
| Tenant host `acme.cms.uniconhub.test` returns 404 | Pass |
| Unauthenticated `/tenants` redirects to `/login?next=%2Ftenants` | Pass |
| `/robots.txt` returns `User-Agent: *` / `Disallow: /` | Pass |
| `/api/platform/health` returns 200 with `Cache-Control: no-store` | Pass |

## Acceptance criteria mapping

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | App runs only on the configured platform host | `host-guard.test.ts` (host cases), E2E #6, manual check |
| 2 | No public signup | E2E #1, login page has no signup link, session API requires Firebase token |
| 3 | MFA required for every session | `session.test.ts` MFA case, `sessionFromIdentity` check |
| 4 | Non-allowlisted email cannot create a session | `session.test.ts` allowlist case |
| 5 | No master key; cannot decrypt locally | `source-scan.test.ts`, `secret-api-failure.test.ts`, `reveal.test.ts` |
| 6 | Reveal requires owner, fresh MFA and forwards `actorIdToken` | `reveal.test.ts` (owner, stale, mismatch, non-owner) |
| 7 | Reveal response is no-store and never logged | `reveal.test.ts` header and log assertions |
| 8 | Tenant create/provision idempotent and recorded | `tenants-provision.test.ts` (conflict, concurrency, retry) |
| 9 | Reporting shows aggregates only | `reporting.test.ts`, `buildBundle` of snapshot contains no tenant fields |
| 10 | Audit is append-only and covers sensitive actions | `audit.test.ts`, `reveal.test.ts`, `tenants-provision.test.ts`, E2E #5 |
| 11 | Firestore rules deny all client access | `source-scan.test.ts` rules assertion |
| 12 | All tests pass | 214 Vitest + 6 E2E, typecheck and build pass |

## Defects found and fixed during testing

| Defect | Impact | Fix |
| --- | --- | --- |
| IPv4 CIDR comparison used a signed 32-bit network value | Allowlist could reject legitimate IPv4 ranges | Convert the masked network to unsigned in `ip-allowlist.ts` |
| Redirects used the internal connection URL as the origin | Behind a reverse proxy, users could be redirected to an internal host | `resolvePublicOrigin` derives the origin from `PLATFORM_HOST` / dev hosts |
| In-memory E2E store was duplicated across Next.js module graphs | E2E tenant lookups returned 404 | Pin the E2E store to `globalThis` |
| Firebase v12 TOTP enrolment typing (`secretKey`, `multiFactor(user)`) | Typecheck failure in the enrolment page | Adjusted to the v12 API |

## Notes and limitations

- The in-process rate limiter is not exercised by E2E; the access proxy/WAF is the
  distributed control.
- The reporting collector's per-tenant Firestore queries are unit-tested at the
  aggregation layer; live tenant projects require the collection mapping and indexes
  documented in `README.md`.
- `middleware.ts` emits a Next 16 deprecation notice recommending `proxy.ts`. Behaviour is
  unchanged and the file name is retained per the specification.
- The bundle scan is skipped only when `.next/static` is absent. It ran against the
  production build in this report.
