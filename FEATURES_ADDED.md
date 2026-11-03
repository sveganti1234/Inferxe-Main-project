# Inferxe — Features Added & Authentication System

## 1. Overview
This update introduces user authentication (Sign In, Sign Up, and Forgot Password) and seamless navigation into the Inferxe Control Plane Dashboard. Users can sign in from the top navigation bar, authenticate with their enterprise credentials (or quick demo roles), and immediately access the marketplace dashboard.

---

## 2. New Files Added

| File | Purpose |
| :--- | :--- |
| `src/pages/Login.tsx` | Implements Sign In, Sign Up (Create Account), and Forgot Password recovery forms with validation and demo auto-logins. |
| `src/styles/auth.css` | High-fidelity dark futuristic stylesheet for authentication cards, inputs, tabs, and actions. |
| `src/lib/authStore.ts` | Session management, local session storage, and backend API integration (`VITE_AUTH_API_ENDPOINT`). |
| `.env.example` | Provides environment configuration template including authentication and marketplace backend endpoints. |
| `FEATURES_ADDED.md` | Feature documentation and architecture overview. |

---

## 3. Existing Files Modified

| File | Changes Made |
| :--- | :--- |
| `src/App.tsx` | Added `/login`, `/signup`, and `/forgot-password` routes and lazy-loaded `Login` component. |
| `src/components/layout/Navbar.tsx` | Removed standalone Console button and added sleek `Sign in` link in top-right navbar and mobile menu. |
| `src/data/site.ts` | Added authentication-related routes and command palette search entries. |
| `src/main.tsx` | Imported the authentication stylesheet (`./styles/auth.css`). |
| `src/styles/layout.css` | Styled the `.nav__signin` navigation link with subtle glass background and neon lime hover glow. |
| `public/sitemap.xml` | Added the `/login` URL to sitemap index. |
| `README.md` | Updated setup, authentication flow, and feature documentation. |

---

## 4. Authentication & Dashboard Workflow

1. **Top-Right Navigation**:
   - The user visits the public Inferxe website.
   - In the top-right navbar, next to "Request access", the user clicks **Sign in**.

2. **Sign In & Sign Up Interface (`/login`)**:
   - The user enters their work email and password.
   - For rapid demonstration and testing, 1-click quick login credentials are provided:
     - **Super Admin** (`alex.chen@inferxe.internal`)
     - **Developer** (`priya.s@novatech.ai`)
   - Alternatively, users can toggle to **Create Account** to register a new organization account or **Forgot Password** to request a magic recovery link.

3. **Dashboard Activation (`/dashboard`)**:
   - Upon successful authentication, the session is saved in `localStorage`.
   - The user is immediately redirected to the **Inferxe Control Plane Dashboard** (`/dashboard` and `/dashboard/users/add`).
   - The user profile in the top-right header displays their authenticated details, active cluster status, and sign-out option.

---

# Update 2 — Features from the "Features stack" checklist

| # | Feature | Where |
| :-- | :-- | :-- |
| 1/2/3 | **AWS Cognito sign-in / sign-up + JWT**. Set `VITE_COGNITO_REGION` and `VITE_COGNITO_CLIENT_ID` in `.env`; the Cognito ID token (JWT) becomes the session token and its `exp` claim is enforced (`src/lib/authStore.ts`). Without these variables the demo logins still work. | `authStore.ts`, `.env.example` |
| 3 | **JupyterLab + SSH access**, with an optional "Inferxe bot" read-only access toggle | `/dashboard/notebooks` |
| 9 | **One API, many providers**: provider comparison + single request example | `/dashboard/providers` |
| 10 | **"Request access" removed from the top of the Home page**; replaced by "Log in to try free for 1 hour" | `Home.tsx` |
| 14/15 | **Usage page**: running models, live GPU temperatures, 24h usage graph, wallet time left, free-trial time left | `/dashboard/analytics` |
| 16 | **Chatbot**: GPU recommendations (by model size or budget), wallet / time-left answers, proactive low-wallet alert | `GlobalBotCompanion.tsx` |
| 19 | **Review page** after a purchase completes: star rating + note | `/dashboard/reviews` |
| 26 | **Tagline** "Login to experience our model for a limited time" and a **creator / YouTuber 1-hour trial code** (`YOUTUBE1HR`) | `Login.tsx`, `/dashboard/rewards` |
| 28 | **Light mode and dark mode** toggle in the dashboard top bar (saved per browser) | `DashboardLayout.tsx`, `dashboard-extra.css` |
| 30 | **Discounts**: referral link/code, `FRIEND15` coupon at checkout, earned-discount tracker | `/dashboard/rewards`, checkout |

New files: `src/pages/dashboard/ExtraSections.tsx`, `src/styles/dashboard-extra.css`.

Still demo-only (needs a real backend): payments, wallet, billing, API-key issuing, provider routing, notebook/SSH provisioning, reviews and referrals persistence, and server-side JWT verification.
