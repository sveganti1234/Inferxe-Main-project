# Inferxe security review — 2026-11-26

This is for the Inferxe engineering team and whoever approves production changes. It covers `development` at `9b789ca` plus the working-tree fixes listed in `OPTIMIZATION_REPORT.md`. Finding ids match `OPTIMIZATION_AUDIT.md`. No secret values appear in this document.

The architecture is unchanged:
- customers sign in with AWS Cognito;
- admins use the custom Argon2id login with database-backed sessions;
- data lives in Supabase/Postgres, reached through the service role, with RLS on.

## Fixed in this pass

| ID | Issue | Fix |
|---|---|---|
| S2 | The account-status check failed **open** when the Supabase lookup errored or wasn't configured, so a suspended customer could keep using wallet, deployment and chat endpoints. | Now fails closed with 503. Tested. |
| S4 | Synchronous Argon2 let about 50 parallel bad admin logins freeze the gateway for every user (a denial of service through the login form). | Async verification: a 10-attempt burst now stalls the event loop for about 11 ms instead of about 1.8 s (measured). |
| S7 | Forged tokens with random `kid` values could force an outbound key fetch to AWS on every request. | Refetch at most once a minute. Tested. |
| S6 | A client-chosen `session_id` let one customer grow server memory without limit. | Cap of 20 sessions per customer, plus hourly cleanup. Tested. |
| F1 | Deleting a compromised SSH key could fail silently: the page said "Removed" while the key stayed authorised on the server. | The page follows the backend result. Tested. |
| F2 / F5 | Fake credentials were copied to the clipboard (an API token, a bearer token with a real-looking personal email), and a personal email was used as the fallback identity for password changes. | No invented API token, and no personal fallback identity. The JWT inspector's demo token remains (see R9). |

## Remaining risks, by priority

| # | ID | Risk | Severity | What is needed |
|---|---|---|---|---|
| R1 | S1 | `POST /api/chat` creates an **active customer profile** for any verified Cognito token with no profile, bypassing the email-verified and conflict checks of the Node sync. That profile then works across the whole workspace API. | High | Chatbot owner: remove the auto-insert and return 403 until the profile is synced through the normal sign-in. |
| R2 | S3 | The admin login rate limit is keyed on the proxy's IP, so one attacker can lock out every admin. | Medium | Decide which header to trust (Vercel sets `X-Forwarded-For`; Render appends), then key on client IP plus email. |
| R3 | S18 | **Partly addressed (2026-11-26):** nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy and a report-only CSP were added to both `vercel.json` files; HSTS is already sent by Vercel. Originally: there are no security headers (CSP, X-Frame-Options, HSTS, nosniff). The admin session token is returned in the login JSON as well as the HttpOnly cookie, and the customer ID token is stored in localStorage. One XSS would therefore steal sessions, and the admin console can be framed. | Medium | Approval for a `headers` block in `vercel.json`; stop returning `token` in the admin login body once the frontend stops reading it. |
| R4 | S11 | Credentialed CORS for every `*.vercel.app` origin (and localhost) in production. Harmless today because of Bearer tokens and the SameSite=Lax cookie, but any future cookie flow would be exposed. | Medium | Approval to set `ALLOW_VERCEL_PREVIEW_ORIGINS=false` in `render.yaml`, and to allow localhost only outside production. |
| R5 | S19 | Guest chat has no rate limit and spends paid LLM calls. | Medium | Chatbot owner: a per-IP token bucket. |
| R6 | S20 | ~~Signed upload URLs have no content-type or size limit.~~ **Resolved:** production check on 2026-11-26 found every bucket private, with size and type limits. | — | None. |
| R7 | D2 | Customers set their own order cost and status, and can link another customer's deployment id to their order. | Medium | Check deployment ownership and set the cost on the server. Tied to the simulated checkout (see `PRODUCTION_READINESS.md`). |
| R8 | S8 | No size limit on inference prompts, so any API-key holder can send multi-MB prompts (memory use, and provider cost). | Medium | Agree a limit, then add `max_length`. |
| R9 | F5 | The Profile page's "JWT Session Token Inspector" copies a hard-coded mock token. | Low | Product decision: remove it, or show real claims without copying. |
| R10 | S5 | Admin login reveals whether an admin account is deactivated before checking the password. | Low | Check the password first. |
| R11 | S14, S16, S22 | Internal error text reaches clients, the DB-status endpoint shows the Postgres host, and Swagger is public. | Low | Generic error messages, drop `host`, gate `/docs` in production. |
| R12 | D5 | `ssh_keys` and `notebook_instances` are outside the RLS lockdown (empty at last check). | Low | Approval to apply 006 after re-checking. |
| R13 | I4 | The container runs as root. | Low | `USER node` in the Dockerfile. |
| R14 | — | Customer access to GPU health: any signed-in customer can trigger host GPU checks and read fleet-wide history (`backend/inference/main.py:157`, uncommitted teammate change). | Medium | GPU health owner: add an operator or admin check. |

## Area-by-area result

- **Customer authentication (Cognito):**
  - Verified in Node (`aws-jwt-verify` and `cognitoIdToken.js`) and Python: RS256, issuer, audience, `token_use=id`, expiry, issue time.
  - Test mode is refused in production.
  - The forged-`kid` fetch storm is fixed (S7).
- **Admin authentication (Argon2id):**
  - Hash parameters are bounded against malformed hashes, and comparison is constant-time.
  - Sessions are HS256-pinned and checked against the database on every request (version, revocation, active, role).
  - The login is no longer an event-loop denial of service (S4).
  - Rate limiting (R2) is still weak.
- **Role-based access and API authorization:**
  - Superadmin routes require the superadmin role.
  - Admin data and customer routes check permissions.
  - Session-store errors fail closed.
- **Customer data isolation:**
  - Every customer query is filtered by the verified `sub`.
  - Python repositories validate UUIDs and ownership.
  - SSH-key ownership is checked when a deployment is created.
  - The gap is R7.
- **RLS and grants:**
  - Migrations 009–012 are applied (2026-11-26).
  - 21 backend tables are service-role only.
  - SECURITY DEFINER functions set `search_path` and revoke EXECUTE.
  - The gap is R12.
- **API keys:**
  - Stored hashed and looked up by a UNIQUE hash index.
  - The secret is shown once.
  - The UI no longer fabricates a copyable secret (F2).
- **SSH keys:**
  - The private-key paste is rejected client-side.
  - The backend validates and fingerprints.
  - The UI now follows backend results (F1).
- **Files and signed URLs:**
  - Paths are confined to `<sub>/`, with `..` rejected.
  - Downloads expire after 60 s.
  - `profile-avatars` is private.
  - The gap is R6.
- **Environment variables:**
  - `.env` files are excluded from Git and from the Docker build context.
  - No secrets are baked into the image or logged.
  - `render.yaml` declares the required variables except `DATABASE_URL` (see audit I1).
- **CORS and CSRF:**
  - The admin cookie is HttpOnly, SameSite=Lax, `Path=/api`, and Secure in production.
  - No state-changing GET routes were found.
  - The gap is R4.
- **Input validation, SQL injection and XSS:**
  - Bodies are capped (16 KB customer, 1 MB admin).
  - In the files reviewed, queries use the PostgREST and Supabase builders, or parameterized psycopg2. Hand-built PostgREST filter strings (for example `supabaseCustomerService.js:901`) URL-encode their values. This was not an exhaustive grep of every query.
  - No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in the frontend.
- **Rate limiting:**
  - Exists only for admin login (weak, R2) and inference concurrency.
  - Missing for guest chat (R5).
- **Sensitive logging:** no tokens, passwords or hashes in logs. Admin login logs the account id and email on failure, which is intended for the audit trail.
- **Dependency vulnerabilities:**
  - **Not checked.** `npm audit` needs the registry, and offline it reports nothing meaningful.
  - Python requirements are unpinned (`>=`), and `httpx2` is unpinned (audit S21, I2).
  - Run `npm audit` and `pip-audit` online in CI.

## Recommended actions

1. **Now, code only:** R1 (chatbot owner), R14 (GPU health owner), R10, R11.
2. **With approval, configuration:** R3 (headers), R4 (CORS flag), R6 (bucket limits), R12 (006).
3. **Before taking payments:** R7, together with a real payment flow.
4. **In CI:** `npm audit --omit=dev` for the root, `frontend/` and `backend/`; `pip-audit -r backend/requirements.txt`; pin the Python requirements.
