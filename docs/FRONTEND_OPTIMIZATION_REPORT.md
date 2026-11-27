# Frontend optimization report — 2026-11-27

This is for the Inferxe team. It covers the React, TypeScript and Vite frontend. Earlier passes are in `OPTIMIZATION_AUDIT.md` and `OPTIMIZATION_REPORT.md`; this report covers the 2026-11-27 pass.

## Summary

No frontend code changed in this pass. Every remaining frontend win either needs a check in a signed-in browser (which this session cannot do without real accounts), touches UI/UX-owned components, or risks merge conflicts in files several teammates edit. Each one is listed below with evidence and an exact plan. What was done instead:
- The report-only security headers were merged on top of teammate commit `48d3f1b`.
- Bundle and CSS facts were measured.

## Measurements (production `vite build`, Node 24, Windows)

| Metric | Value |
|---|---|
| Entry chunk `index-*.js` | 534,957 B raw / 169,849 B gzip |
| Single CSS file | 482,871 B raw / 80,055 B gzip |
| First load (entry plus CSS) | 1,017,828 B raw / 249,904 B gzip |
| All JS | 2,240,735 B in 140 files |
| Largest lazy chunks | `MarketplaceWorkspace` 280,951 B (62,994 gzip); `GlobalBotCompanion` 180,989 B (72,289 gzip); `useAdminSidebarKeyboardNav` 121,908 B (43,999 gzip); `Login` 106,800 B (27,026 gzip) |
| Build time | 28–55 s; it varies with machine load, since the test suite ran in parallel |
| Lighthouse | **Not available.** It isn't installed, and adding it would be a new dependency. |

These match the 2026-11-26 baseline: the entry and CSS sizes are byte-identical.

**What is in the entry chunk** (sourcemap breakdown, characters of source before minification):

| Module | Size |
|---|---:|
| react-dom | 635K |
| react-router | 377K |
| framer-motion and motion-dom | 510K |
| Amplify auth and core | 233K |
| `authStore.ts` | 56K |
| `customerService.ts` | 18K |

## CSS findings (import order, specificity, cascade)

All stylesheets are imported globally from `frontend/src/main.tsx:9-31` in a fixed order. `index.css` comes last, `dashboard.css` and `dashboard-extra.css` before it.

| File | Bytes | Rules | `!important` | Global (`html`/`body`/`:root`) rules |
|---|---:|---:|---:|---:|
| `dashboard-extra.css` | 270,226 | 1,354 | **1,760** | 4 |
| `dashboard.css` | 111,693 | 666 | 35 | 0 |
| `super-admin.css` | 96,409 | 511 | 34 | 0 |
| `index.css` | 73,228 | 232 | **784** | 6 |
| `auth.css` | 31,541 | 194 | 11 | 0 |
| `bot.css` | 23,230 | 107 | 9 | 66 |

The selectors are mostly prefixed (`.dash-` 607 times, `.verdelo-` 456, `.zesto-` 320), which would make them safe to move. But **`dashboard-extra.css:5448-5466` sets the `html` and `body` background with `!important`**, so it styles every page, including public pages. Moving the dashboard CSS into the lazy dashboard chunks would therefore change the public site's background, and the `!important` overrides in `index.css` would compete differently. That is why the CSS was not moved.

**Plan for the CSS split** (UI/UX owner involvement needed):
1. Move the global `html`/`body` background rules from `dashboard-extra.css` into `base.css` or `index.css`, keeping their current order.
2. Screenshot every public page in both themes before and after; the headless Chrome script from the verification pass can do this.
3. Import `dashboard.css`, `dashboard-extra.css` and `super-admin.css` from `DashboardLayout`, `AdminShell` and `CustomerApp` instead of `main.tsx`.
4. Run a signed-in visual pass of every dashboard page in both themes.

Expected saving: most of the 80 KB of gzipped CSS on public pages, not yet measured.

## Remaining opportunities (not implemented, with reasons)

| # | Opportunity | Evidence | Why not now | Plan |
|---|---|---|---|---|
| FE-1 | Keep Amplify (about 233K characters) out of the entry chunk | `main.tsx` configures Amplify; `lib/authStore.ts:1` imports `aws-amplify/auth` at the top | Sign-in cannot be tested without real Cognito credentials; a mistake breaks login in production | Load `aws-amplify/auth` dynamically inside the three authStore functions that use it, and configure Amplify lazily before the first call. Verify with a real sign-in, sign-out, password change and token refresh. |
| FE-2 | Load framer-motion features after first paint (`LazyMotion`) | 34 files use framer-motion, 12 with layout animations | Visual change risk on every animated screen (UI/UX) | Estimated 25–30 KB gzip; needs before/after screenshots |
| FE-3 | Split the dashboard CSS out of public pages | see the CSS findings | Changes the public background; needs visual QA | Plan above |
| FE-4 | Delete the about-2,700 unreachable lines in `MarketplaceWorkspace.tsx` | `App.tsx:164-174` mounts it only for `/dashboard/provider/*` and `/dashboard/users/map`; the `models`, `gpus`, `deployments`, `api-keys`, … branches (`MarketplaceWorkspace.tsx:1406-4150`) can never render | 5+ teammates edit this file, so a large deletion would cause merge conflicts | Coordinate a quiet window, delete the branches and their now-unused state, and measure the chunk |
| FE-5 | About 4.2 MB of unreferenced files in `frontend/public` | `Green Data Cloud Logo.png`, `favicon2.svg`, `transperent Logo.png`, … | UI/UX-owned assets | Handoff |
| FE-6 | Admin header search pulls 73 KB of map SVG | `AdminHeaderSearch.tsx:25` imports `SovereignNodesMap` | Teammate component | Handoff: move `GEO_DISTRIBUTION` to a data file |
| FE-7 | Customer presence stops after back/forward navigation | `CustomerHeartbeat.tsx:31, 101-106` (`pagehide` sets a flag that `pageshow` never resets) | Teammate component | Handoff: add a `pageshow` handler for `event.persisted` |
| FE-8 | Playground fetches health twice | `PlaygroundPage.tsx:46` | Teammate component | Handoff |

## Earlier frontend changes still uncommitted, for owner review

These were made in earlier passes (with your approval where needed) and are in the working tree:
- **SSH (Diya):** `SshKeysPage.tsx` and its test.
- **UI/UX (Sahith):** `CheckoutPage.tsx`, `ProfilePage.tsx`, `ApiKeysPage.tsx`, `DashboardLayout.tsx` and `AdminShell.tsx`, with logic-only changes.
- **Shared:** the new `orderNumber.ts` and its tests.

The details are in `OPTIMIZATION_REPORT.md` and `PRODUCTION_READINESS.md`.

## Tests

The frontend Vitest suite passes 483 of 483 (49 files). TypeScript and the production build pass.
