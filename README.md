# UniconHub Platform Admin

A standalone Next.js 16 application for platform-level administration of UniconHub:
tenant lifecycle, oversight reporting, platform audit and first-party secret metadata.

Primary domain: `admin.uniconhub.com`

This application is **not** the tenant CMS and **not** the Secret API. It has no tenant
boundary, but it also has no ability to decrypt secrets.

---

## Contents

1. [What this application is](#1-what-this-application-is)
2. [Hard security boundary](#2-hard-security-boundary)
3. [Architecture](#3-architecture)
4. [Requirements](#4-requirements)
5. [Local setup](#5-local-setup)
6. [Firebase setup](#6-firebase-setup)
7. [Environment reference](#7-environment-reference)
8. [Secret API contract](#8-secret-api-contract)
9. [CMS system API contract](#9-cms-system-api-contract)
10. [Oversight reporting](#10-oversight-reporting)
11. [Deployment](#11-deployment)
12. [Commands](#12-commands)
13. [Tests](#13-tests)
14. [Operations](#14-operations)
15. [Known constraints and decisions](#15-known-constraints-and-decisions)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. What this application is

A human-facing control plane used by a small number of trusted platform operators:

- create and maintain tenant metadata;
- provision tenants through the existing CMS system API;
- inspect first-party secret metadata across every tenant;
- reveal, deliver and retire secrets by delegating to the Secret API;
- collect and display cross-tenant aggregate reporting;
- read an append-only audit trail of sensitive actions.

It deliberately does not include:

- public sign-up or tenant self-service;
- tenant CMS object editing;
- any CMS theme, `AuthContext` or `BaseDataContext` integration;
- any private-key storage, decryption or encryption capability.

## 2. Hard security boundary

| The Admin app CAN | The Admin app CANNOT |
| --- | --- |
| Store tenant metadata, audit records, snapshots and settings | Store `SECRETS_ENC_KEY`, `SECRETS_FINGERPRINT_KEY` or any master key |
| Read secret metadata through the Secret API | Read secret ciphertext or decrypt a private key |
| Forward a fresh Firebase ID token as `actorIdToken` | Mint a token for another user |
| Ask the Secret API to reveal / deliver / retire | Perform reveal / delivery / retirement itself |
| Show a revealed key once, in memory, with `no-store` | Persist, cache, log or index a private key |

The Admin app never holds:

```text
SECRETS_ENC_KEY
SECRETS_FINGERPRINT_KEY
SECRET_API_CMS_ENROLL_TOKEN
SECRET_API_RUNTIME_FETCH_TOKEN
```

A source scan test fails the build if any of these names appear in application code.

## 3. Architecture

```mermaid
flowchart LR
  Operator[Platform operator] -->|HTTPS + MFA| Proxy[Access proxy / VPN]
  Proxy --> Admin[Platform Admin<br/>admin.uniconhub.com]
  Admin -->|Firebase Admin SDK| AdminProject[(Admin Firebase project<br/>platform_* collections)]
  Admin -->|Bearer service token| SecretApi[Secret API]
  Admin -->|Bearer actorIdToken| SecretApi
  SecretApi --> Vault[(Secret vault<br/>ciphertext)]
  Admin -->|CMS system API| Cms[CMS]
  Admin -->|Registry + server-side tenant access| ManagedProjects[(Managed Firebase projects<br/>their own tenants)]
  Admin -->|Read-only aggregates| ManagedProjects
  Browser[Browser] -->|Firebase Auth only| Firebase[Firebase Auth]
  Browser -.->|never| SecretApi
```

Request lifecycle:

1. **Edge middleware** - host guard, optional IP allowlist, security headers, nonce CSP,
   noindex, unauthenticated page redirects, Origin + CSRF checks for cookie mutations.
2. **Route wrapper** (`lib/server/http/route-handler.ts`) - rate limit, Origin/CSRF,
   Firebase session verification, role matrix, structured logging, error envelope.
3. **Domain services** - tenant validation, provisioning, Secret API client, reporting.
4. **Persistence** - Firebase Admin only. Firestore rules deny every client read and write.

Directory map:

```text
app/                     routes and pages
  (auth)/login           email/password + MFA sign-in
  (auth)/mfa-enroll      first-time TOTP enrollment
  (platform)/            authenticated shell, dashboard, tenants, secrets, audit, settings
  api/                   session, logout, tenants, secrets, reporting, audit, settings
components/              Tailwind UI primitives and client workflows
lib/edge/                host guard, IP allowlist, CSP, edge cookies
lib/server/              server-only modules (every file imports server-only)
  auth/                  tokens, session, CSRF, roles, re-authentication
  firestore/             store contract, Firestore + in-memory implementations
  audit/                 append-only audit records
  tenants/               id policy, cms client, provisioning
  secret-api-client/     typed Secret API client
  reporting/             aggregate collector and cached summary
  http/                  route wrapper, responses, request context
  validation/            Zod schemas and safe body parsing
  rate-limit/            in-process fixed-window limiter
scripts/                 set-platform-role.ts
tests/                   unit, integration, security, e2e
middleware.ts            host guard and edge security controls
firestore.rules          deny all client access
firestore.indexes.json   audit and snapshot indexes
```

## 4. Requirements

- Node.js 20.9 or newer. Tested on Node 22.11 with npm 10.
- A Firebase project used only by this application.
- Identity Platform enabled on that project (required for TOTP MFA).
- Firebase CLI for deploying rules and indexes.
- A separate Vercel project (or any Node host that can run `next start`).
- An access proxy or VPN in front of the host: Cloudflare Access, Google IAP,
  Tailscale or an allowlisted corporate network.

The application is buildable without credentials, but every data route requires a
complete environment.

## 5. Local setup

### 5.1 Instant local demo (no Firebase, no upstream services)

```bash
npm install
npm run dev:demo
```

Open `http://localhost:3000/login` and click one of the **Sign in as ...** buttons.
The demo runner starts Next.js with `PLATFORM_E2E_MODE=true` plus the local mock Secret API
and CMS system API, uses an in-memory store, and needs no credentials. All platform
features work: tenant creation, provisioning, secret metadata, owner reveal, audit and
settings. Data resets when the process stops. E2E mode is refused in production and on
Vercel.

### 5.2 Normal development

```bash
npm install
cp .env.example .env.local        # Windows: copy .env.example .env.local
npm run dev
```

A `.env.local` with the host guard values is enough to open `/login`, but real sign-in
requires the Firebase setup in section 6 and the upstream services. Without
`PLATFORM_HOST` and `PLATFORM_ALLOWED_DEV_HOSTS`, every request returns 404 by design.

Open `http://localhost:3000/login`. `localhost:3000` is accepted because it is listed in
`PLATFORM_ALLOWED_DEV_HOSTS`. Any other host returns 404, including `127.0.0.1` unless it
is also listed. Environment changes require a dev server restart.

## 6. Firebase setup

### 6.1 Create a separate project

Create a new Firebase project, for example `uniconhub-platform-admin`. It must be
separate from:

- every tenant CMS project;
- the Secret API vault project.

Register a Web app and copy the four public values into `NEXT_PUBLIC_FIREBASE_*`.

### 6.2 Enable Email/Password and MFA

1. Authentication -> Sign-in method -> enable **Email/Password**. Leave every other
   provider disabled.
2. Upgrade the project to **Identity Platform** (required for TOTP).
3. Identity Platform -> Multi-factor authentication -> enable **TOTP** and allow
   enrollment. If the console does not expose a TOTP toggle, enable it with
   `npm run enable-totp-mfa` (reads `PLATFORM_FIREBASE_*`, or set
   `GOOGLE_APPLICATION_CREDENTIALS`). The script merges TOTP into the existing MFA
   configuration and never disables other providers.
4. Optionally configure an SMS factor. The app supports TOTP and SMS; TOTP is
   recommended because it needs no reCAPTCHA.

The app enforces MFA itself: `POST /api/auth/session` rejects any ID token without
`firebase.sign_in_second_factor`. There is no way to disable this with an environment
variable.

### 6.3 Create the first operator

Firebase console -> Authentication -> Users -> **Add user**. Use a strong password and
an email that will appear in `PLATFORM_ADMIN_EMAILS`. There is no sign-up page in the app.

### 6.4 Service account

Project settings -> Service accounts -> **Generate new private key**.

Set:

```env
PLATFORM_FIREBASE_PROJECT_ID=...
PLATFORM_FIREBASE_CLIENT_EMAIL=...
PLATFORM_FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Escaped `\n` sequences are converted to real newlines at runtime. Never commit the key.

### 6.5 Deploy rules and indexes

```bash
firebase login
firebase use uniconhub-platform-admin
firebase deploy --only firestore:rules,firestore:indexes
```

The rules contain a single catch-all deny:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

All access is through Firebase Admin on the server.

### 6.6 Set the `platformRole` claim

```bash
npm run set-platform-role -- --email owner@uniconhub.com --role owner --yes
```

Valid roles: `owner`, `admin`, `operator`, `auditor`. The script:

- preserves existing custom claims;
- revokes the user's refresh tokens so the new claim takes effect immediately (existing
  session cookies are rejected because `verifySessionCookie` checks revocation);
- never prints a token or key.

If a role is changed manually in the console instead, revoke the user's refresh tokens
before relying on the new role.

Without a role claim the user cannot create a session, even with a valid password and MFA.

### 6.7 Enrol MFA

The first sign-in happens in two steps because a session requires MFA:

1. Open `/mfa-enroll` and sign in with the password. If Firebase refuses the enrolment
   because the address is unverified, the page shows a verification step with a
   **Send verification email** button. Open the link in that email, then press
   **I have verified, continue**. If the page was reloaded, sign in again.
2. When the shared secret appears, add it to an authenticator app and enter the 6-digit
   code.
3. Open `/login` and sign in normally. Enter the authenticator code when prompted.

The page sends the verification email itself; no Admin SDK script is needed for that.

The enrollment page should only be reachable through the access proxy. Anyone with the
password could otherwise enrol their own factor, which is why the proxy is a required
control.

### 6.8 Verify

- Session cookie is named `__Host-platform_session`, is `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, and expires after `PLATFORM_SESSION_TTL_HOURS` (default 8).
- CSRF cookie is `__Host-platform_csrf` and is readable by the browser.
- A non-allowlisted email receives `401 UNAUTHORIZED`.
- A session without a second factor receives `403 MFA_REQUIRED`.

### 6.9 One-off admin commands

These are operational commands, not part of the app runtime:

```bash
# Enable TOTP MFA on the platform project (one time per project).
npm run enable-totp-mfa

# Mark a user's email verified when the UI verification email is unavailable.
npm run enable-totp-mfa -- --verify-email name@uniconhub.com

# Set or change the platform role claim.
npm run set-platform-role -- --email name@uniconhub.com --role owner --yes
```

`enable-totp-mfa` reads `PLATFORM_FIREBASE_*`, or set `GOOGLE_APPLICATION_CREDENTIALS`
to a service account JSON. It merges TOTP into the existing MFA configuration and
never disables other providers. Run it with `--help` for the full usage.

### 6.10 Managed projects and their tenants

The Admin app never stores tenant records. It stores a project registry in
`platform_projects` in the admin project, and reads or writes tenants inside each
managed project on demand.

1. Open `/projects` and choose **Add project**.
2. Set the Firebase/GCP project id, a display name, and the tenant source:
   - **Firestore collection**: set the collection id (`tenants` by default) and the
     field names for id, name and status.
   - **Identity Platform tenants**: tenants are read with the Admin SDK
     `tenantManager()`. Tenant ids are assigned by Identity Platform.
3. Open the project to see its tenants. The project selector switches between
   projects; selecting a project never selects a tenant.
4. Tenant create and edit actions are written directly to the managed project.

Access mode:

- **Read-only** is the default. Tenant list and detail work; create and edit are
  blocked before any write is attempted.
- **Read and write** enables tenant create and edit against the project.

Credentials:

- Set `PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON` to a service account with access to
  every managed project.
  - Firestore read-only: grant `roles/datastore.viewer` on each project.
  - Firestore read/write: grant `roles/datastore.user` on each project.
  - Identity Platform read-only: grant `roles/firebaseauth.viewer`.
  - Identity Platform read/write: grant `roles/firebaseauth.admin`.
- If the variable is absent, the app falls back to
  `PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON`, which is normally read-only. Listing
  works; create and edit return `PROJECT_ACCESS_FAILED` until write access is
  granted.
- The admin project keeps its own write access through `PLATFORM_FIREBASE_*`.
  Never grant the cross-project account write access to the admin project unless
  it is also the admin account.
- The admin project's own tenant collection (`platform_tenants`) is legacy and is
  no longer linked from the UI.

## 7. Environment reference

A detailed HTML reference with per-variable sourcing, common mistakes and the exact
same/different rules across the Admin app, Secret API, CMS and Vercel is at
`docs/environment-variables.html`.

### Public (safe in the browser)

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | yes | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | yes | Firebase Auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | yes | Admin project id |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | yes | Firebase Web app id |
| `NEXT_PUBLIC_PLATFORM_E2E_MODE` | dev only | Shows the local Playwright sign-in helper |

### Platform

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLATFORM_HOST` | - | The only host served. Everything else returns 404 |
| `PLATFORM_ALLOWED_DEV_HOSTS` | - | Comma separated `host:port`, ignored in production |
| `PLATFORM_SESSION_TTL_HOURS` | `8` | Session cookie lifetime, clamped to 1-24 |
| `PLATFORM_REVEAL_FRESH_AUTH_SECONDS` | `300` | Reveal freshness window, clamped to 30-900 |
| `PLATFORM_ADMIN_EMAILS` | - | Exact, case-insensitive email allowlist |
| `PLATFORM_IP_ALLOWLIST` | empty | Optional IPv4/CIDR or exact IPv6 allowlist |

### Server secrets

| Variable | Purpose |
| --- | --- |
| `PLATFORM_FIREBASE_PROJECT_ID` | Admin Firebase project |
| `PLATFORM_FIREBASE_CLIENT_EMAIL` | Admin service account email |
| `PLATFORM_FIREBASE_PRIVATE_KEY` | Admin service account key |
| `SECRET_API_BASE_URL` | Secret API base URL |
| `SECRET_API_ADMIN_SERVICE_TOKEN` | Server-to-server bearer token |
| `SECRET_API_TIMEOUT_MS` | Default `5000`, clamped to 500-30000 |
| `CMS_SYSTEM_API_BASE_URL` | CMS system API base URL |
| `CMS_SYSTEM_API_KEY` | CMS system API key (part of the URL path) |
| `CMS_SYSTEM_API_TIMEOUT_MS` | Default `10000` |
| `PLATFORM_CMS_HOST_SUFFIX` | Default host suffix for generated CMS hosts |
| `PLATFORM_PUBLICWEBSITE_HOST_SUFFIX` | Default host suffix for generated website hosts |
| `PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON` | Cross-project account for reading and managing tenants in managed projects |
| `PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON` | Dedicated read-only reporting account |
| `PLATFORM_REPORTING_MAX_CONCURRENCY` | Default `3`, clamped to 1-10 |
| `PLATFORM_REPORTING_TENANT_TIMEOUT_MS` | Default `10000` |
| `PLATFORM_REPORTING_CRON_SECRET` | Optional shared secret for Vercel Cron |

## 8. Secret API contract

All calls are server-to-server. The browser never calls the Secret API.

Common headers:

```http
Authorization: Bearer <SECRET_API_ADMIN_SERVICE_TOKEN>
Accept: application/json
X-Request-Id: <request id>
```

### Metadata

```http
GET /api/v1/first-party/secrets?tenantId=<tenantId>
GET /api/v1/first-party/secrets/<secretId>
```

Metadata only. The client accepts `{ "secrets": [...] }`, `{ "data": [...] }`, a bare
array, or a single object, and normalizes the following fields:

```json
{
  "secretId": "sec_...",
  "tenantId": "acme-travel",
  "appId": "publicwebsite",
  "kid": "kid_...",
  "algorithm": "RS256",
  "status": "active",
  "deliveryMode": "runtime-fetch",
  "deliveryStatus": "delivered",
  "fingerprint": "SHA256:...",
  "version": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "rotationDueAt": "...",
  "lastDeliveredAt": "...",
  "lastDeliveryError": null
}
```

Statuses are normalized to `active`, `pending-delivery`, `failed-delivery`,
`rotation-due`, `retired` or `unknown`. Unknown fields are ignored, and a metadata
response can never reach the browser with key material.

### Reveal

```http
POST /api/v1/first-party/secrets/<secretId>/reveal
Content-Type: application/json

{ "reason": "...", "actorIdToken": "<fresh Firebase ID token>", "requestId": "..." }
```

Expected response:

```json
{
  "secretId": "sec_...",
  "kid": "kid_...",
  "algorithm": "RS256",
  "version": 1,
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
}
```

`privateKey` is also accepted as an alias for `privateKeyPem`.

The Secret API must independently verify the actor token: Firebase signature, owner role,
MFA and `auth_time` freshness.

### Deliver and retire

```http
POST /api/v1/first-party/secrets/<secretId>/deliver
{ "mode": "manual|runtime-fetch|vercel-env", "actorIdToken": "...", "reason": "..." }

POST /api/v1/first-party/secrets/<secretId>/retire
{ "actorIdToken": "...", "reason": "..." }
```

The Secret API owns delivery and retirement status. The Admin app only displays the result.

### Failure semantics

| Condition | Admin app response |
| --- | --- |
| Network failure or timeout | `503 SECRET_API_UNAVAILABLE` |
| Secret API 5xx or malformed payload | `503 SECRET_API_UNAVAILABLE` |
| Secret API 404 | `404 SECRET_NOT_FOUND` |
| Secret API 401/403 | `503 SECRET_API_UNAVAILABLE` (service credential problem) |

There is **no fallback**. The Admin app cannot decrypt, so it fails closed.

## 9. CMS system API contract

Provisioning calls the existing CMS endpoints; the Admin app does not duplicate tenant
creation logic.

```http
POST {CMS_SYSTEM_API_BASE_URL}/api/system/{CMS_SYSTEM_API_KEY}/ctgc/{tenantId}/{cmsProjectId}
POST {CMS_SYSTEM_API_BASE_URL}/api/system/{CMS_SYSTEM_API_KEY}/rfti/{tenantId}/{cmsProjectId}
```

`CMS_SYSTEM_API_BASE_URL` and `CMS_SYSTEM_API_KEY` are platform-level values, not tenant
values. The CMS base URL is the host that serves `/api/system/...` (for example
`https://cms.uniconhub.com`), and the key is the single system key configured in the CMS.
The tenant id and `cmsProjectId` are path parameters supplied at runtime from the tenant
record, never environment variables.

- `ctgc` creates the CMS tenant.
- `rfti` retries first-party enrollment and is called when `ctgc` returns `409` or `422`.
- 2xx means success. Anything else becomes `tenant.provision_failed` with a sanitized
  `lastError`.
- The API key is part of the URL path. URLs are never logged; log lines replace the key
  with `[cms-api-key]`.

The tenant record is created **before** provisioning, because CMS auto-enrollment calls
the Secret API with that `tenantId` during creation.

## 10. Oversight reporting

A dedicated read-only service account (`PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON`) reads
aggregates from each tenant project. The account needs read access to the collections
below in every tenant project, for example `roles/datastore.viewer`.

Collection mapping (all configurable):

| Purpose | Default collection | Default field |
| --- | --- | --- |
| Object count / top types | `objects` | `objectTypeId` |
| API requests | `api_requests` | `apiVersion` (`v1` / `v2`) |
| First-party requests | `first_party_requests` | `isError` |
| Active users | `users` | `lastActiveAt` |
| Storage bytes | `platform_usage/current` | `storageBytes` |

Behavior:

- `count()` aggregation queries wherever possible; top types come from a bounded sample
  of the type field only.
- Each tenant is collected with a 10 second timeout (`PLATFORM_REPORTING_TENANT_TIMEOUT_MS`).
- Concurrency defaults to 3 (`PLATFORM_REPORTING_MAX_CONCURRENCY`).
- Partial failures are recorded per tenant and in the platform snapshot; the rest of the
  refresh continues.
- Raw tenant documents are never copied into the platform database. Only numbers and
  bounded type/count maps are stored.
- Page loads read cached snapshots only. A page render never fans out across tenant
  projects.
- Snapshots are idempotent per period: the document id is `<tenantId>__<YYYY-MM>` or
  `platform__<YYYY-MM>`.

Count queries with two equality/range filters need composite indexes in the tenant
project. If an index is missing, that metric is recorded as a partial failure instead of
failing the whole refresh. Create the index per tenant project, for example:

```bash
gcloud firestore indexes composite create \
  --project=<tenant-project> \
  --collection-group=api_requests \
  --field-config=field-path=createdAt,order=ascending \
  --field-config=field-path=apiVersion,order=ascending
```

Scheduling:

- Manual: owner or admin clicks **Refresh reporting**, or
  `POST /api/platform/reporting/refresh`.
- Vercel Cron: `vercel.json` schedules a daily `GET` to the same route. Vercel sends
  `Authorization: Bearer $CRON_SECRET`; set `CRON_SECRET` to the same value as
  `PLATFORM_REPORTING_CRON_SECRET`. The secret is compared in constant time. Without it
  the cron request is rejected.

## 11. Deployment

### 11.1 Vercel project

1. Create a **separate** Vercel project pointing at this repository.
2. Framework preset: Next.js. Build command: `npm run build`.
3. Add every server secret as a Production environment variable (and Preview only if
   required). Use Vercel's sensitive/encrypted variables.
4. Set `PLATFORM_HOST` to the **exact host you will open**, with no scheme and no path.
   - First smoke test: use the production Vercel domain, for example
     `u-admin.vercel.app`.
   - Real deployment: add `admin.uniconhub.com` under Settings -> Domains, set
     `PLATFORM_HOST=admin.uniconhub.com`, and redeploy.
   A mismatch produces `Not Found` on every URL. Preview deployment URLs are different
   hosts and are rejected by design.
5. Redeploy after changing environment variables. `NEXT_PUBLIC_*` values are baked into
   the build, so they only apply after a new deployment. Server variables are read at
   runtime, but a redeploy is the reliable way to pick up every change.
6. Deploy. Vercel builds on push. There is no local build requirement.

Vercel smoke test:

```text
https://<your-host>/api/platform/health   -> 200 {"ok":true,...}
https://<your-host>/login                 -> 200 login form
```

If `/api/platform/health` returns `Not Found`, `PLATFORM_HOST` does not match the Host
header. Check the runtime logs for the `PLATFORM_HOST is not set` warning.

### 11.2 Access proxy

Put the whole host behind one of:

- **Cloudflare Access** - self-hosted application for `admin.uniconhub.com`, allow policy
  for named operators or an email domain.
- **Google IAP** - enable IAP on the load balancer in front of the app.
- **Tailscale** - serve the app on the tailnet only.
- **Corporate VPN / IP allowlist** - combine with `PLATFORM_IP_ALLOWLIST`.

Do not rely on a secret hostname. Certificate transparency logs reveal hostnames.

The app is secure even if the proxy is bypassed: host guard, Firebase session
verification, MFA claim, allowlist and the role matrix are all enforced in the
application.

### 11.3 Security headers

Middleware sets on every response:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`
- `Referrer-Policy: no-referrer`
- a restrictive `Permissions-Policy`
- `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`
- a nonce-based `Content-Security-Policy` with `strict-dynamic`

`robots.txt` disallows everything.

## 12. Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:demo` | Self-contained local demo (mock upstreams, no Firebase) |
| `npm run dev` | Local development against your own configured services |
| `npm run dev:stop` | Stop leftover dev servers on ports 3000 and 4100 |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit, integration and security suites |
| `npm run test:e2e` | Playwright E2E against the local mock upstreams |
| `npm run set-platform-role -- --email <email> --role <role>` | Set the platform role claim |

## 13. Tests

```bash
npm run typecheck
npm test              # 214 tests: unit, integration, security
npm run test:e2e      # 6 Playwright flows with mocked CMS + Secret API
```

E2E uses `PLATFORM_E2E_MODE=true`, which:

- requires `NODE_ENV !== 'production'`;
- is refused when `VERCEL=1`;
- swaps Firebase Auth for a deterministic local verifier;
- swaps Firestore for an in-memory store shared across the dev server.

It is not reachable in a production deployment. `tests/e2e/upstreams.mjs` implements the
Secret API and CMS contracts locally and verifies the service token and the forwarded
actor token.

See `TEST-REPORT.md` for the latest results and `SECURITY.md` for the control matrix.

## 14. Operations

### Provisioning

- Create the tenant record first (status `draft`).
- Provisioning claims the record in a Firestore transaction. A second attempt receives
  `409 PROVISIONING_IN_PROGRESS`.
- A lock older than 15 minutes is treated as stale so a crashed attempt can be retried.
- Failures set status `failed` and persist a sanitized `lastError`; retry is allowed.
- Archived tenants cannot be provisioned.

### Archiving

Tenants are archived, never hard-deleted. Archiving is owner-only and recorded as
`tenant.archived`.

### Secret actions

| Action | Role | Requirements |
| --- | --- | --- |
| View metadata | owner, admin, operator | Active session |
| Reveal | owner | MFA in session, fresh actor token within 300s |
| Deliver | owner, admin | Actor token with MFA |
| Retire | owner | Actor token with MFA |

Every action is written to `platform_audit_log` before or immediately after the upstream
call. Reveal responses are never logged and never cached.

### Incident response

1. Rotate `SECRET_API_ADMIN_SERVICE_TOKEN` and `CMS_SYSTEM_API_KEY`.
2. Remove the operator from `PLATFORM_ADMIN_EMAILS` and redeploy, or disable the Firebase
   user.
3. Revoke refresh tokens for the affected uid (`auth.revokeRefreshTokens`) - logout does
   this automatically, but do it directly if the account is compromised.
4. Review `platform_audit_log` for `auth.denied`, `secret.reveal_requested` and
   `tenant.*` entries.
5. If a private key may have leaked, rotate it through the Secret API. The Admin app
   cannot rotate keys itself.

## 15. Known constraints and decisions

- **Next 16 middleware naming.** The specification requires `middleware.ts`; Next 16
  prints a deprecation notice recommending `proxy.ts`. Behavior is unchanged. Migration
  is a rename plus import updates when the convention is removed.
- **Rate limiting is per instance.** `lib/server/rate-limit/limiter.ts` is an in-process
  fixed-window limiter. Use the access proxy/WAF for distributed limits.
- **Reporting index requirements.** Multi-filter count queries can require composite
  indexes in tenant projects. Missing indexes are recorded as partial failures.
- **E2E mode is dev-only.** It is hard-refused in production and on Vercel, and the UI
  helper is gated by `NEXT_PUBLIC_PLATFORM_E2E_MODE`.
- **Tailwind CSS 3.4.** Tailwind 4 requires Node 22.12+; the app targets Node 20.9+ and is
  verified on Node 22.11, so Tailwind 3.4 is used.
- **No tenant-facing routes.** There is no CMS UI import and no tenant object editing.

## 16. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| 404 on every page (local) | No `.env.local`, or `Host` does not match `PLATFORM_HOST` / `PLATFORM_ALLOWED_DEV_HOSTS`. In development the 404 body lists the variables to set. Restart the dev server after editing env |
| 404 on every page (Vercel) | `PLATFORM_HOST` is unset, has a scheme/path, or is not the host you opened. Set it to the exact bare host, redeploy, then test `/api/platform/health`. Visiting the `*.vercel.app` URL while `PLATFORM_HOST=admin.uniconhub.com` returns 404 by design |
| `NEXT_PUBLIC_*` changes have no effect | They are inlined at build time; redeploy after changing them |
| Sign-in says `Component auth has not been registered yet` | Duplicate `@firebase/app` installs. Keep the `overrides` entry in `package.json` (`@firebase/app`), run `npm install`, and confirm `npm ls @firebase/app --all` shows a single version. Redeploy after the fix |
| Sign-in says `auth/api-key-not-valid` | `NEXT_PUBLIC_FIREBASE_API_KEY` is wrong, or the deployment predates the value |
| Sign-in says `auth/unauthorized-domain` | Add the exact host to Firebase Authentication -> Settings -> Authorized domains |
| Redirect loop to `/login` | Session cookie rejected: check `PLATFORM_FIREBASE_*` and the allowlist |
| `401 UNAUTHORIZED` after MFA | Email not in `PLATFORM_ADMIN_EMAILS`, or the user has no `platformRole` claim |
| `403 MFA_REQUIRED` | The Firebase user has no enrolled second factor |
| `auth/operation-not-allowed` on `/mfa-enroll` | TOTP MFA is not enabled for the project. Enable Identity Platform, then run `npm run enable-totp-mfa` or the REST equivalent |
| `auth/unverified-email` | The Firebase user's email is not verified. Use **Send verification email** on `/mfa-enroll` and open the link |
| `auth/unauthorized-continue-uri` | The verification return URL host is not authorized in Firebase. The app falls back to the default handler; add the host to Authentication -> Settings -> Authorized domains |
| `403 REAUTH_REQUIRED` on reveal | The actor token's `auth_time` is older than 300 seconds |
| `503 SECRET_API_UNAVAILABLE` | Secret API unreachable, wrong service token, or malformed payload |
| Reporting shows partial failures | Missing read permission or composite index in a tenant project |
| `PROVISIONING_IN_PROGRESS` | Another attempt holds the lock (or is younger than 15 minutes) |
| All cookies missing locally | `__Host-` cookies require HTTPS or `http://localhost`; use `localhost`, not a LAN IP |

---

Proprietary. Internal platform tooling for UniconHub.
