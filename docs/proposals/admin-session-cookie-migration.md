# Admin session: moving from a readable token to the HttpOnly cookie

This is for the Inferxe team (Notifications owner and frontend). Status: **plan only. Nothing is changed, and existing authentication keeps working at every step.**

## Why

Admin login returns the HS256 session token in the JSON body (`backend/auth/adminAuth.js`), and the frontend keeps it in `localStorage` (`frontend/src/lib/authStore.ts`). Any XSS could read it. The server already sets the same token as a cookie, `inferxe_admin_session; HttpOnly; Path=/api; SameSite=Lax; Secure` (production), which scripts cannot read.

## What depends on the readable token today (verified)

| Consumer | How it authenticates | Ready for cookie-only? |
|---|---|---|
| Node admin and superadmin APIs (`/api/admin/*`, `/api/superadmin/*`) | `extractAdminTokenFromRequest` (`adminAuth.js:361-372`): Bearer header, **then cookie** | **Yes** |
| Notifications service admin routes (`router.py:210, 226, 243`: wallet credit, broadcasts, etc.) | `get_current_user` reads **only** `Authorization: Bearer` (`notifications/auth.py:649-660`) | **No** |
| Frontend `adminJson` (`frontend/src/lib/customerService.ts:543-556`), e.g. `POST ${NOTIFICATIONS_API_BASE}/api/wallet/transactions` | sends `Authorization: Bearer <token>` from `localStorage` | **No** |
| Frontend guards (`AdminGuard.tsx`, `SuperadminGuard.tsx`) and `authStore.ts` | decode `session.token` client-side to decide the role | **No** |

The cookie **does reach the Python services**:
- production is same-origin (the Vercel rewrite sends `/api/*` to Render);
- the cookie path is `/api`;
- the gateway forwards every request header, including `Cookie` (`backend/scripts/render-gateway.mjs:181-183`).

In local development, Vite proxies `/api` the same way.

## Migration, in independently reversible phases

**Phase 1: Notifications service accepts the cookie. Owner: Manya. Additive only.**
- In `get_current_user` and `get_optional_user`: when there is no Bearer header, read `request.cookies["inferxe_admin_session"]`.
- Accept it **only** through the existing HS256 admin path (signature with `ADMIN_SESSION_SECRET`, then the `admin_sessions`/`admin_users` checks). A Cognito (RS256) token in that cookie must be rejected.
- **CSRF:** for cookie-authenticated, state-changing requests (POST, PUT, PATCH, DELETE), require the `Origin` header to match the allowed origins, or require a custom header such as `X-Inferxe-Admin: 1` that cross-site forms cannot send. SameSite=Lax already blocks cross-site POSTs; this is defense in depth.
- **Tests:**
  - a cookie works on an admin route;
  - a Cognito token in the cookie is rejected;
  - a revoked session is rejected;
  - a cross-origin POST with only the cookie is rejected;
  - Bearer still works.
- *Rollback:* revert the change; Bearer was never removed.

**Phase 2: Frontend stops sending the token. Owner: you (frontend auth).**
- `adminJson` and every admin fetch use `credentials: 'include'` (plus the custom header) and no `Authorization`.
- Guards ask the server instead of decoding the token: use the existing Node session-verification route (the same check `verifyAdminSessionRecord` performs) and keep only non-secret display data (name, role) in storage.
- `customerService`, `adminAccountStore` and the superadmin pages all go through `adminJson`. Grep for `getAdminAuthToken` to find the rest.
- *Rollback:* revert the frontend; the server still accepts both.

**Phase 3: Stop exposing the token. Owner: you (Node admin auth).**
- Remove `token` from the login JSON (`adminAuth.js:2014-2018`).
- On load, delete any token left in `localStorage` from earlier sessions.
- Update the tests that read `json.token` to read the `Set-Cookie` header instead.
- *Rollback:* re-add the field.

**Phase 4 (optional): Admin tokens only by cookie.**
- Once nothing sends admin tokens as Bearer, the Python services can refuse HS256 tokens in the `Authorization` header. Customer Cognito Bearer tokens are unaffected.

## Checks after each phase

Manual, in a signed-in browser, both themes:
- **Admin:** sign-in, sign-out, the superadmin overview, customer management, a wallet credit (exercises the notifications admin route), and a broadcast.
- **Customer:** sign-in, which must be unaffected.
- **Phase 3 only:** DevTools shows no token in `localStorage`, and the login response has no `token` field.
