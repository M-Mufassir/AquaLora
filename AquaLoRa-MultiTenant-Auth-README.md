# AquaLoRa — Multi-Tenant Cloud Authentication

**New feature spec: Master Node identity, one-time PC login, and per-customer data isolation**

Scope reviewed: `Backend/` (FastAPI + PostgreSQL), `desktop_app/` (Electron + React + SQLite),
`mobile_application/` (React Native/Expo). This document is the result of that review — what
exists today, why it can't support multiple customers yet, and the design to fix it.

---

## 1. Why the current system can't support multiple customers

Today there is exactly **one tenant**. Every part of the stack assumes a single deployment:

| Layer | What it does today | Why that breaks with multiple customers |
|---|---|---|
| **Backend `/auth/login`** | Checks the submitted username/password against one hardcoded pair (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, default `Admin` / `Admin123`) from environment config. | There's no concept of *which customer* is logging in — everyone shares one login. |
| **Backend `Reading` / `Alert` tables** | Store a free-text `node_id` string, but nothing links a `node_id` to an owner. | Customer A's node data and Customer B's node data sit in the same table with no ownership boundary. |
| **Backend `GET /readings/latest`, `/readings/history`, `/alerts/latest`, `/alerts/history`** | Have **no auth dependency at all** — they're open endpoints. | Anyone with the API URL can read every customer's readings and alerts, not just their own. |
| **Backend `POST /readings/sync`, `/alerts/sync`** | Require a valid JWT, but the JWT only encodes a `username` (`Admin`), not a node/tenant identity. | Any authenticated caller can push data under *any* `node_id` — there's no ownership check on write either. |
| **Desktop app login** | Fully local: a `users` table in the per-PC SQLite DB, seeded on first run with `Admin` / `Admin123`. Cloud sync separately re-uses the same hardcoded `Admin` / `Admin123` pair to fetch a token from the backend. | Local login has nothing to do with cloud identity, and the cloud credential is the same for every installation — it isn't "your PC talking to your account," it's every PC sharing one cloud identity. |
| **Mobile app login** | Calls the same `/auth/login`, falls back to an offline `admin` / `Admin123` check if the backend is unreachable. | Same single shared credential problem, plus the offline fallback is a hardcoded password baked into the app binary. |

In short: the backend is currently a **single-tenant "cloud backup," not a multi-tenant hub**. To
sell AquaLoRa to multiple customers (each with their own Master Node), the system needs an
identity that represents *"which customer/pond installation is this,"* and every piece of data
and every login needs to be scoped to that identity.

---

## 2. Proposed model: the Master Node **is** the login identity

Each customer owns one physical Master Node (mains-powered LoRa receiver + the PC/mobile devices
that read its data). We make that Master Node the tenant boundary and the login identity:

- One **Master Node record** = one customer/installation = one login.
- The Master Node record carries a short human-assigned **Node ID/Code** (e.g. `AQL-0042`), a
  **display name** (e.g. `"Green Valley Prawn Farm — Pond 3"`), a password, and editable profile
  fields (site name, location, contact person/phone, pond type, install date, notes).
- Every reading, alert, and sensor record is scoped to a `master_node_id` foreign key — never
  just a bare `node_id` string.
- The JWT issued at login encodes the `master_node_id`, so every subsequent API call is
  automatically scoped to that customer's data. A customer's dashboard or app can never see
  another customer's data, even by URL-guessing.

This is a fairly standard "row-per-tenant" SaaS pattern, sized appropriately for a two-node
LoRa/solar aquaculture product rather than a general-purpose multi-org system.

### 2.1 New/changed backend data model

```
master_nodes
├── id                  (PK)
├── node_code           (unique, e.g. "AQL-0042" — what's typed/selected at login)
├── display_name        (e.g. "Green Valley Prawn Farm — Pond 3")
├── password_hash        (bcrypt, never store plaintext)
├── contact_name
├── contact_phone
├── site_location
├── pond_type
├── installed_at
├── status               (active | suspended)
├── created_at / updated_at

readings                 (existing table)
├── ...existing columns...
└── master_node_id       (NEW, FK → master_nodes.id, indexed)

alerts                   (existing table)
├── ...existing columns...
└── master_node_id       (NEW, FK → master_nodes.id, indexed)
```

`node_id` (the hardware/LoRa identifier already sent by the desktop app) is kept as-is for
telemetry — it just now always travels alongside `master_node_id`, so one customer could in
principle have more than one physical node in future without a redesign.

### 2.2 New/changed backend endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /master-nodes/directory` | none (public, minimal fields only) | Returns `[{node_code, display_name}]` — powers the login dropdown. Never returns passwords, contact info, or readings. |
| `POST /auth/login` | none | Body becomes `{ node_code, password }` instead of `{ username, password }`. Returns a JWT whose payload includes `master_node_id`, `node_code`, `role`. |
| `GET /master-nodes/me` | JWT | Returns the authenticated node's full editable profile. |
| `PATCH /master-nodes/me` | JWT | Updates the editable profile fields (name, contact, location, pond type, notes). Password change is a separate endpoint with old-password confirmation. |
| `POST /auth/change-password` | JWT | Customer-initiated password change. |
| `POST /readings/sync`, `/alerts/sync` | JWT | **Unchanged shape**, but the server now stamps `master_node_id` from the JWT — a customer can only ever write rows under their own tenant, regardless of what `node_id` they claim. |
| `GET /readings/latest`, `/readings/history`, `/alerts/latest`, `/alerts/history` | **JWT now required** (currently open — this is a real gap to close) | Server filters every query by `master_node_id` from the JWT. A customer physically cannot query another customer's data. |
| `POST /master-nodes` (admin-only) | JWT + `role=super_admin` | Provisions a new customer/Master Node record (AquaLoRa staff only, for onboarding new customers). |

A `super_admin` role is introduced for AquaLoRa's own team, separate from the per-customer role,
so customer onboarding and account management doesn't require direct database access.

### 2.3 Migration of existing data

The current single-tenant data isn't lost — on rollout, a `DEFAULT` master node row is created
(e.g. `node_code = "AQL-0001"`, using the current `Admin` credentials as its initial password),
and all existing `readings`/`alerts` rows get backfilled with that node's `id`. Existing
deployments keep working through the migration; the shared `Admin/Admin123` pair becomes that one
customer's password, which they should then change.

---

## 3. Desktop app: "one-time login per PC"

This is the part you specifically asked about — logging in once per installation, staying logged
in indefinitely, and only being asked again after an explicit logout.

### 3.1 Flow

**First run on a PC (requires internet):**
1. Login screen shows a **dropdown of Master Node names/codes**, populated from
   `GET /master-nodes/directory` (requires internet, since this list lives in the cloud — this is
   the one moment the desktop app *needs* connectivity).
2. User selects their node and enters the password.
3. Electron main process calls `POST /auth/login` against the cloud backend.
4. On success, the backend's response (JWT + node identity) is written to a **local device
   session record**, encrypted at rest using Electron's `safeStorage` API (backed by the OS
   keychain — Windows DPAPI / macOS Keychain / libsecret on Linux), *not* plain SQLite. This
   record also gets a copy of the node's `master_node_id`/`node_code` written into the existing
   local `settings` table so the rest of the app (outbox, sync service, dashboard header) can use
   it immediately.
5. Local per-PC login (the existing `users` table) is layered **on top of** this — see 3.3.

**Every later app launch:**
1. App checks for a stored device session.
2. If one exists and hasn't been explicitly logged out, the **login screen is skipped entirely**
   — the app goes straight to the dashboard, exactly like today's "walk up and it's already
   signed in" experience.
3. If the app is online, it silently re-validates the stored token in the background (cheap
   `GET /master-nodes/me` call) and refreshes it if it's close to expiring. If that check fails
   (token revoked, node suspended), the user is dropped back to the login screen with an
   explanation — this is the only case where a signed-in device is forced to re-authenticate.
4. If the app is **offline**, it trusts the stored session and works exactly as it does today
   (offline-first guarantee preserved) — sensor ingestion, local dashboard, and the sync outbox
   all continue to function without the cloud reachable. Cloud sync itself simply queues until
   connectivity returns, same as the existing outbox pattern.

**Logout (explicit user action):**
1. Clears the stored device session (`safeStorage` entry + the cached node identity in
   `settings`).
2. Next launch behaves exactly like a brand-new install: dropdown + password, internet required.

This matches what you described: one-time authentication per PC, silent resume on every
subsequent run, and a full re-login only after an explicit logout — while keeping the
offline-first guarantee that already exists for day-to-day operation.

### 3.2 Why store a session instead of re-checking the cloud every launch

Requiring internet on *every* launch would break the offline-first design principle already in
place for this app (a pond-side PC may have flaky connectivity). Storing an encrypted session
locally means:
- Internet is required exactly once (first login) and never again unless the user logs out.
- The dashboard remains usable offline, consistent with the rest of the app's design.
- A stolen/cloned SQLite file alone can't be used to log in elsewhere — the session lives in the
  OS keychain via `safeStorage`, not in the portable app data.

### 3.3 Relationship to the existing local `users` table

The existing local login (per-PC operator accounts in SQLite, e.g. different staff sharing one
PC) is a **separate, lower-level concern** from the cloud Master Node identity, and both are kept:

- **Cloud/Master Node login** — answers *"which customer/installation is this PC provisioned
  for?"* Happens once, as described above.
- **Local operator login** — answers *"which staff member on-site is currently using this PC?"*
  Stays exactly as it is today (local SQLite `users` table, no internet needed), and continues to
  gate day-to-day dashboard access after the one-time Master Node provisioning is done.

Practically: the Master Node login becomes a one-time **setup/provisioning step** (think of it as
"activating" the installation), and the existing local login remains the everyday sign-in screen
staff see. This avoids forcing an internet-dependent login every day while still tying the PC to
exactly one customer's cloud data.

---

## 4. Mobile app: same identity, always-online login

The mobile app already talks to the online DB for everything, so there's no "offline-first"
constraint to preserve here — it can simply mirror the new login shape:

- Login screen gets the same **Master Node dropdown** (from `GET /master-nodes/directory`) +
  password field, replacing the free-text username field.
- `authService.login()` calls the updated `/auth/login` with `{ node_code, password }` and stores
  the returned JWT (already using `expo-secure-store`, which is appropriate here).
- The current **hardcoded offline fallback** (`admin` / `Admin123` baked into the app) should be
  removed now that login is tenant-specific — a hardcoded fallback password can no longer be
  correct for more than one customer, and shipping a fixed password in the app binary is a
  security gap regardless of the multi-tenant change.
- Session persists across app restarts (already implemented via `SecureStore`) until the user
  taps "Log out," at which point they're returned to the same dropdown + password screen.
- All data screens (readings, history, charts, push alerts) are automatically scoped to the
  logged-in Master Node's data, since the backend now filters every query by the JWT's
  `master_node_id`.

---

## 5. Editable Master Node dashboard

A new profile screen (desktop and mobile) backed by `GET /master-nodes/me` /
`PATCH /master-nodes/me`:

- **View:** node code, display name, site location, pond type, contact name/phone, install date,
  connection/last-sync status.
- **Edit:** all of the above except `node_code` and `id` (identity fields are fixed once
  provisioned — changing them would require re-provisioning, not an edit).
- **Password change:** separate flow requiring the current password.
- Changes are `PATCH`ed directly to the cloud (this one action does require connectivity on
  desktop, same as any cloud write) and reflected locally.

---

## 6. Security notes

- **Password storage:** bcrypt (or argon2) hashes only, never plaintext — the current backend
  already hashes local desktop `users` passwords the same way; the same approach extends to
  `master_nodes.password_hash`.
- **JWT scope:** every protected endpoint derives `master_node_id` from the token server-side —
  never trusts a `node_id`/`master_node_id` passed in the request body for authorization
  purposes.
- **Closing the open-read gap:** `GET /readings/*` and `/alerts/*` currently have no auth at all
  and must be locked down as part of this change, not left "public read" — otherwise tenant
  isolation only exists on the write path.
- **Rate limiting on `/auth/login`:** recommended, since node codes are semi-guessable
  (`AQL-0001`, `AQL-0002`, …) and this is now a login boundary between customers, not just a demo
  credential.
- **Session storage on desktop:** OS keychain via Electron `safeStorage`, not the SQLite file
  itself, so the device session isn't portable if the DB file is copied elsewhere.
- **Removing the mobile hardcoded fallback credential:** flagged above in §4 — this becomes a
  real cross-tenant risk once there's more than one legitimate password in the system.

---

## 7. Open decisions (need your/team input before implementation)

1. **Node provisioning:** should AquaLoRa staff create new Master Node accounts through a simple
   internal admin script/endpoint (`POST /master-nodes`, `super_admin`-only), or is a lightweight
   admin UI worth building? For a small number of customers, a script is likely enough to start.
2. **One node per customer, or many:** the schema above supports a customer having more than one
   Master Node later (via `master_node_id` scoping) even though today's product is one node per
   installation — worth confirming that's the right assumption for how AquaLoRa expects to sell
   this.
3. **Token lifetime:** how long should a desktop "stay signed in" session last before it's forced
   to silently re-validate/expire (e.g. 30/90 days), and should there be a hard maximum even if
   the PC never goes online to refresh it?
4. **Forgot-password flow:** out of scope for this first pass (no email/SMS infrastructure yet) —
   for now, password resets would go through AquaLoRa support/the `super_admin` role directly.
5. **FHI/decision-engine impact:** none expected — the decision engine consumes readings by
   `node_id` locally on the desktop app and isn't cloud/tenant-aware, so this change doesn't touch
   Pratheesa's subsystem.

---

## 8. Summary of changes by component

| Component | Change |
|---|---|
| Backend | `master_nodes` table; `master_node_id` FK on `readings`/`alerts`; login takes `node_code` not free-text username; all read/write endpoints scoped + auth-required; new profile CRUD endpoints; `super_admin` role for provisioning. |
| Desktop app | Login screen becomes a Master Node dropdown + password; cloud login happens once per PC via `safeStorage`-backed device session; silent resume on every later launch; explicit logout is the only thing that forces re-login; existing local operator login and offline-first behavior unchanged. |
| Mobile app | Login screen becomes the same Master Node dropdown + password; hardcoded offline fallback credential removed; session persistence otherwise unchanged (`SecureStore`, logout-to-reset). |
| Both apps | New editable Master Node profile/dashboard screen backed by `GET/PATCH /master-nodes/me`. |
