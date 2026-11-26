# Manual test checklist: signed-in flows

Use real test accounts only, never production customer accounts. Start everything with `npm run dev`; the app runs at `http://127.0.0.1:5173`. Run this checklist after migrations 009–012 are applied; before 009, the Deployments page returns HTTP 502 by design.

Accounts needed:
- two test customers (A and B) in the Cognito user pool;
- one standard admin;
- the Super Admin (`admin@inferxe.com`).

## Customer (as A)

- [ ] **Sign-in:** sign up or sign in through Cognito; you land on the dashboard. Refreshing the page keeps you signed in.
- [ ] **Sign-out:** after signing out, `/dashboard/app` sends you to `/login`.
- [ ] **Dashboard:** totals, usage and recent activity load, with no error banner.
- [ ] **Marketplace and LLM catalogue:** the lists load; filters work; saving a listing appears under saved items.
- [ ] **Deployments:**
  - [ ] create one (mock provider); it shows `running` or `provisioning`;
  - [ ] stop → `stopped`;
  - [ ] resume → `running`;
  - [ ] terminate → `terminated`;
  - [ ] double-clicking Create makes only one deployment.
- [ ] **API keys:** create one; the full key appears once; afterwards the list shows only the prefix. Revoking it removes it.
- [ ] **SSH keys:** add a valid public key; an invalid key is refused with a clear message; deleting it works.
- [ ] **Wallet:** the balance and transactions load. "Add money" works only if `WALLET_SELF_RECHARGE_ENABLED=true`, which is a local demo setting with no payment taken.
- [ ] **Orders, usage, notifications:** the lists load; marking a notification read updates the unread count.
- [ ] **Notebook:** create and stop a session; the status updates.
- [ ] **Profile:** edit your name and save; refresh; the change persists. (The JWT inspector shows a **simulated** token; the copied token is not usable.)

## Isolation (A against B)

- [ ] Signed in as B, none of A's deployments, keys, orders or notifications appear.
- [ ] Calling `GET /api/v1/gpu/deployments/<A's deployment id>` with B's token returns 404.
- [ ] Calling `/api/customer/workspace` with no token returns 401.

## Admin (standard admin)

- [ ] Sign in at `/login` (admin mode); the admin dashboard loads.
- [ ] Customer management: list, search and paginate; open a customer, whose plan and deployments show.
- [ ] Changing a customer's plan writes an audit entry.
- [ ] `/dashboard/super-admin/accounts` is refused (Super Admin only).
- [ ] An admin session token used against `/api/customer/*` returns 401.

## Super Admin

- [ ] Sign in; the overview loads.
- [ ] **Admin Accounts → Add Administrator:**
  - [ ] a weak password is refused;
  - [ ] a duplicate email (in any case) returns "already exists";
  - [ ] a valid entry creates an `admin`-role account; the new admin can sign in.
- [ ] Creating a second Super Admin is refused.
- [ ] Deactivating an admin signs them out at once, and they can no longer sign in.
- [ ] The audit log shows each of these actions.

Record the date, tester, accounts used, and any failure with its URL and HTTP status.
