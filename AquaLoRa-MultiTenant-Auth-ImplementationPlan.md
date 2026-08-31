# AquaLoRa — Multi-Tenant Auth: Implementation Plan

**Companion to `AquaLoRa-MultiTenant-Auth-README.md`.** That doc was the *what/why*; this one is
the *how* — concrete, file-by-file, in the order it should actually be built and shipped, based on
a full read-through of `Backend/`, `desktop_app/`, and `mobile_application/` as they exist today.

Rough sizing: **Backend ~2–3 days, Desktop ~3–4 days, Mobile ~1–2 days, migration/testing ~1–2
days** for one person already familiar with the codebase. Ship backend → desktop → mobile, in that
order — each layer's rollout depends on the previous one being live.

---

## Phase 0 — Before touching code

1. Resolve the open decisions from the README §7 that affect schema (node provisioning method,
   one-vs-many nodes per customer, token lifetime). At minimum, lock down **token lifetime**
   before Phase 1, since it's a config value, not a redesign.
2. Take a Postgres backup/snapshot of the current Railway DB — Phase 1 migrations are additive
   but this is a good checkpoint regardless.
3. Decide the initial `node_code` for the existing single customer (e.g. `AQL-0001`) — needed for
   the backfill script in Phase 1.

---

## Phase 1 — Backend: schema + auth (`Backend/Backend/app/`)

### 1.1 New dependency
Add password hashing to `requirements.txt` (currently the backend has no hashing library —
`PyJWT` is there for tokens but passwords are compared with a plain `==` in `main.py`):
```
bcrypt==4.2.0
```

### 1.2 `app/database.py` — new table + FK columns
- Add a `MasterNode` model:
  ```python
  class MasterNode(SQLModel, table=True):
      id: int | None = Field(default=None, primary_key=True)
      node_code: str = Field(index=True, unique=True)
      display_name: str
      password_hash: str
      contact_name: str | None = None
      contact_phone: str | None = None
      site_location: str | None = None
      pond_type: str | None = None
      installed_at: str | None = None
      role: str = Field(default='customer')  # 'customer' | 'super_admin'
      status: str = Field(default='active')
      created_at: str | None = None
      updated_at: str | None = None
  ```
- Add `master_node_id: int | None = Field(default=None, index=True, foreign_key='masternode.id')`
  to both `Reading` and `Alert`. Nullable at first (existing rows have none until the Phase 1.5
  backfill runs), then tightened to `NOT NULL` for new writes at the application layer.
- `init_db()` stays as-is (`SQLModel.metadata.create_all` handles the new table/columns
  additively — no destructive migration needed since SQLModel/SQLAlchemy will just add what's
  missing on a fresh `create_all`; for the *existing* Railway Postgres DB, this needs an explicit
  `ALTER TABLE` since `create_all` doesn't alter existing tables — see 1.5).

### 1.3 `app/auth.py` — token payload
- `create_token(username: str)` → `create_token(master_node_id: int, node_code: str, role: str)`,
  encoding all three into the JWT `sub`/custom claims instead of just `sub=username`.
- `verify_token(...)` → return the decoded claims dict (`{master_node_id, node_code, role}`)
  instead of just a username string, so route handlers can pull `master_node_id` straight off it.
- Add a small `require_super_admin(claims=Depends(verify_token))` dependency for the
  admin-only provisioning endpoint.

### 1.4 `app/main.py` — the bulk of the work
- **`LoginRequest`**: `username`/`password` → `node_code`/`password`.
- **`POST /auth/login`**: look up `MasterNode` by `node_code`, `bcrypt.checkpw` against
  `password_hash` (replacing the current `payload.password != settings.admin_password` check),
  return a token carrying `master_node_id`.
- **New `GET /master-nodes/directory`**: no auth, returns
  `[{node_code, display_name} for active nodes]` only — this is what feeds the login dropdown on
  both apps.
- **New `GET /master-nodes/me`** / **`PATCH /master-nodes/me`**: behind `verify_token`, scoped to
  `claims['master_node_id']` — read/update the editable profile fields.
- **New `POST /auth/change-password`**: behind `verify_token`, requires current password match
  before updating `password_hash`.
- **New `POST /master-nodes`**: behind `require_super_admin`, for provisioning new customers.
- **`POST /readings/sync`, `POST /alerts/sync`**: unchanged request shape, but every inserted
  `Reading`/`Alert` row now gets `master_node_id=claims['master_node_id']` stamped from the token
  — not from anything in the request body.
- **`GET /readings/latest`, `/readings/history`, `/alerts/latest`, `/alerts/history`**: currently
  have no `Depends(verify_token)` at all — **add it**, and add
  `.where(Reading.master_node_id == claims['master_node_id'])` /
  same for `Alert` to every query in these four handlers. This is the single most important
  change in the whole plan — it's what actually stops one customer from reading another's data.
- Remove `settings.admin_username`/`admin_password` usage from `main.py` once login no longer
  needs them (keep the settings fields around only if you want a bootstrap super-admin fallback —
  see 1.5).

### 1.5 Data migration (run once, against the live Railway Postgres DB)
Since the table already exists in production, this needs real `ALTER TABLE` statements, not just
`create_all`. A one-off script (e.g. `Backend/Backend/scripts/migrate_multitenant.py`) that:
1. Creates the `masternode` table.
2. Inserts one row using the pre-agreed `node_code` (Phase 0.3) and a bcrypt hash of the current
   `ADMIN_PASSWORD`, `role='super_admin'` (so the existing credential keeps working as the first
   account, with super-admin rights to provision others — swap to `role='customer'` once real
   provisioning is in place if you don't want the original account to stay privileged).
3. Runs `ALTER TABLE reading ADD COLUMN master_node_id INTEGER;` and same for `alert` (Postgres
   syntax; SQLModel's table name will be lowercase class name unless overridden — confirm actual
   table names via `\dt` before writing the migration).
4. Backfills: `UPDATE reading SET master_node_id = <that id> WHERE master_node_id IS NULL;` (same
   for `alert`).
5. Adds the `NOT NULL` + FK constraint only after the backfill confirms zero remaining NULLs.

### 1.6 `app/config.py`
- `admin_username`/`admin_password` can be removed once 1.5's bootstrap account exists in the DB
  — they were only ever used for the single hardcoded check being replaced.
- `jwt_secret` unchanged, `jwt_algorithm` unchanged.

**Backend is now safely deployable on its own** — until the desktop/mobile apps are updated, they
authenticate with the old `Admin`/`Admin123` pair, which now resolves to the bootstrap
`master_node` row from 1.5, so nothing breaks mid-rollout.

---

## Phase 2 — Desktop app (`desktop_app/src/`)

### 2.1 New file: `src/main/cloudSession.ts`
A small module, separate from the existing `secureChannel.ts` (that one's for LoRa/WiFi message
encryption — unrelated concern), responsible for the **one-time-per-PC cloud session**:
- `saveCloudSession({ token, masterNodeId, nodeCode, displayName, expiresAt })`: writes the token
  via Electron's `safeStorage.encryptString()`, storing the resulting buffer (base64) in the
  existing `settings` table (`setSetting('cloud_session', ...)`) rather than plain SQLite —
  `settings` already exists and is the right place, it just needs the value encrypted before it
  lands there.
- `loadCloudSession()`: reads `getSettingOptional('cloud_session')`, decrypts with
  `safeStorage.decryptString()`, returns `null` if missing/corrupt/decrypt fails.
- `clearCloudSession()`: `setSetting('cloud_session', '')` (or a dedicated delete-setting helper
  if `db.ts` doesn't have one yet — add one, it's a one-line addition next to `setSetting`).
- `validateCloudSession(baseUrl, token)`: calls `GET /master-nodes/me` with the stored token;
  used for the silent background re-validation described in the README §3.1 step 3.

### 2.2 `src/main/index.ts`
- Remove the hardcoded `CLOUD_ADMIN_USERNAME`/`CLOUD_ADMIN_PASSWORD` constants and
  `getCloudAuthToken()`'s username/password login call — replace with
  `loadCloudSession()`'s stored token. If no session or the token's expired,
  `syncQueuedReadings()` should surface a clear "not signed in to cloud" state rather than
  silently failing (today it throws a generic auth error — worth a distinct error message so the
  UI can prompt re-login instead of just retrying forever).
- Add new IPC handlers:
  - `ipcMain.handle('cloud:login', (_e, nodeCode, password) => ...)` → calls
    `POST /auth/login` against the configured `cloud_sync_url`, on success calls
    `saveCloudSession(...)`.
  - `ipcMain.handle('cloud:logout', () => clearCloudSession())`.
  - `ipcMain.handle('cloud:getSession', () => loadCloudSession())` — used at app start to decide
    whether to show the login screen at all.
  - `ipcMain.handle('cloud:getDirectory', () => fetch GET /master-nodes/directory)` — powers the
    dropdown; requires internet, called only from the login screen.
- The existing `ipcMain.handle('auth:login', ...)` (local operator login) **stays exactly as
  is** — it's a separate concern per the README §3.3.
- `app.whenReady()` block: keep the `userCount() === 0` bootstrap for the *local* operator
  account; that's unrelated to cloud identity.

### 2.3 `src/preload/index.ts`
Expose the three new IPC calls on `window.api`: `cloudLogin`, `cloudLogout`, `getCloudSession`,
`getCloudDirectory` (also update `src/preload/index.d.ts` with matching types).

### 2.4 `src/renderer/src/components/LoginScreen.tsx`
This screen currently only handles the local operator login. Two options, pick one:
- **(A) Simpler, matches README §3.3):** Leave `LoginScreen.tsx` doing local operator login as-is.
  Add a **new, separate `CloudActivationScreen.tsx`** that only appears when
  `window.api.getCloudSession()` resolves `null` (first run / after logout) — it shows the Master
  Node dropdown (from `getCloudDirectory`) + password, calls `cloudLogin`, and on success proceeds
  to the normal local `LoginScreen`. This cleanly separates "activate this PC for a customer"
  from "which staff member is using it right now," matching the README's two-tier model exactly.
- **(B)** Merge both prompts into one screen shown only on first run. Simpler UX for a
  single-operator install, but muddier if a site ever has multiple staff logins on one activated
  PC. **Recommend (A)** given the existing local multi-user support already in `db.ts`.

### 2.5 `src/renderer/src/App.tsx`
- On mount (before the existing `currentUser` check), call `window.api.getCloudSession()`.
  - `null` → render `CloudActivationScreen` (2.4A) until it resolves a session.
  - present → proceed straight to the existing `if (!currentUser) return <LoginScreen .../>`
    flow, unchanged.
- Add a "Sign out of this PC" action (distinct from local logout) somewhere in `SettingsPage.tsx`
  that calls `window.api.cloudLogout()` and reloads to the activation screen — this is the
  explicit action described in the README as the only thing that forces re-login.
- Wire a lightweight background check: on app start when online, call `validateCloudSession()`
  (2.1) and only fall back to the activation screen if it explicitly fails (revoked/suspended) —
  don't block the UI on this, run it after the dashboard is already showing, per the README's
  offline-first requirement.

### 2.6 New profile screen
Add `src/renderer/src/pages/MasterNodeProfilePage.tsx` (new route, e.g. `/profile`, linked from
the top nav) that calls `GET /master-nodes/me` / `PATCH /master-nodes/me` directly over `fetch`
using the stored cloud token (via a new small `masterNodeApi.ts` helper next to
`masterNodeClient.ts`, which today is used for the LoRa-side master node connection, not the cloud
API — keep these separate, similar naming is coincidental).

---

## Phase 3 — Mobile app (`mobile_application/src/`)

### 3.1 `src/services/authService.ts`
- `login(username, password)` → `login(nodeCode, password)`, body becomes
  `{ node_code, password }`.
- **Remove the offline hardcoded fallback block** (the `admin`/`Admin123` check under
  `if (!err.response)`) — flagged in the README §4 as a real risk once passwords are
  customer-specific. If an offline/degraded mode is still wanted for mobile, it should reuse
  whatever *last successfully verified* session is already in `SecureStore` (i.e., "stay logged
  in if you were already logged in and the network drops," not "accept a fixed password"), which
  is effectively already what `getStoredAuth()` + normal session persistence gives you for free —
  so this fallback branch can likely just be deleted outright rather than replaced.
- Add `getDirectory()` calling the new `GET /master-nodes/directory`.

### 3.2 `src/screens/LoginScreen.tsx`
- Replace the free-text username `TextInput` with a dropdown/picker populated from
  `authService.getDirectory()` (a simple `Picker` or a searchable modal list, depending on how
  many customers are expected — a plain dropdown is fine at small scale).
- Drop the hardcoded default state `useState('Admin')` / `useState('Admin123')` — those were
  demo-credential conveniences that shouldn't ship once logins are per-customer.

### 3.3 `src/context/AuthContext.tsx`
- No structural change needed — `handleLogin`/`handleLogout` already just delegate to
  `authService`. Update the `User` type if you want to carry `nodeCode`/`displayName` through the
  context for display in the app header.

### 3.4 `src/services/apiService.ts`
No change needed — it already attaches `Authorization: Bearer <token>` via an interceptor and
already has 401-refresh handling, which now transparently benefits from the backend's new
per-tenant scoping without any extra client-side filtering logic.

### 3.5 New profile screen
Add a `MasterNodeProfileScreen.tsx` mirroring 2.6, using the existing `apiService` (which already
handles auth headers) to call `GET/PATCH /master-nodes/me`.

---

## Phase 4 — Rollout order & testing

1. **Deploy backend first**, run the Phase 1.5 migration against Railway. Verify with `curl`:
   `POST /auth/login` with the bootstrap `node_code`/old password still works, and that
   `GET /readings/latest` now returns `401` without a token (confirms the open-read gap is
   closed).
2. **Ship desktop update.** On first launch post-update, existing installs will hit
   `getCloudSession() → null` (no session was ever stored before this change) and correctly drop
   into the new `CloudActivationScreen` once — exactly the "treat this like the very first login"
   behavior wanted, with no special-casing needed for upgrades.
3. **Ship mobile update.** Existing `SecureStore` tokens from the old login shape will fail the
   new backend's `node_code` expectations — on next `apiService` 401, the interceptor's refresh
   will fail and the user gets bounced to the new dropdown login, which is the correct behavior
   for a breaking auth change.
4. **Test matrix before calling it done:**
   - Two different `master_node` accounts (create a second one via `POST /master-nodes`) confirm
     data isolation: Customer A's desktop app never sees Customer B's readings/alerts via any of
     the four `GET` endpoints.
   - Desktop: fresh install → activation → close app → reopen → **no login prompt at all**.
   - Desktop: explicit "sign out of this PC" → reopen → activation screen again, requires
     internet.
   - Desktop offline: after activation, disconnect network, confirm dashboard still loads and
     sync simply queues in the outbox (existing behavior, just confirming it isn't broken by the
     session change).
   - Mobile: login, force-quit, reopen → still logged in; explicit logout → dropdown screen again.
   - `PATCH /master-nodes/me` edits reflected on both desktop and mobile.

---

## Summary checklist

- [ ] Backend: `bcrypt` dependency, `MasterNode` model, FK columns on `Reading`/`Alert`
- [ ] Backend: `auth.py` token claims rework
- [ ] Backend: `main.py` — login, directory, profile CRUD, super-admin provisioning, **and the
      four previously-open `GET` endpoints locked down + scoped**
- [ ] Backend: one-off migration script + run against Railway
- [ ] Desktop: `cloudSession.ts` (new), `index.ts` IPC handlers, `preload` exposure
- [ ] Desktop: `CloudActivationScreen.tsx` (new), `App.tsx` gating, sign-out action in Settings
- [ ] Desktop: `MasterNodeProfilePage.tsx` (new)
- [ ] Mobile: `authService.ts` rework, drop hardcoded fallback + default credentials
- [ ] Mobile: `LoginScreen.tsx` dropdown
- [ ] Mobile: `MasterNodeProfileScreen.tsx` (new)
- [ ] Test matrix from Phase 4.4 passing on a second real customer account, not just the bootstrap
      one
