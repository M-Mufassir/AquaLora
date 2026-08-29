# AquaLoRa — Desktop Dashboard: New Feature Implementation

**Implementation guide — Desktop App (Electron + React + TypeScript + better-sqlite3)**
Subsystem owner: Mufassir (IT23650848) — Dashboard & Database
Module: IE3044 Design Project, SLIIT

---

## 1. Scope of this document

This covers changes to the **existing desktop dashboard app only**. It's the companion doc to the mobile app / backend README — read that one for the cloud backend, FCM alerts, and mobile UI. This doc answers: _what does the desktop app itself need to change to support the pH sensor and the new cloud backup?_

Three new features land on the desktop side:

1. **pH sensor as a 4th node/reading** — new column, new FHI input, new UI element
2. **Primary (SQLite) + Cloud (Postgres) backup**, kept in sync via the outbox pattern
3. **Login screen** — desktop app gains (or formalizes) the same credential check the mobile app uses, so both apps are gated the same way (but no need to synceverytime - that stores locally like the same as desktop)

---

## 2. Feature 1 — pH sensor integration (dashboard side)

The pH probe itself, ESP32 wiring, and calibration are the Sensing subsystem's responsibility (Anojan) — this section only covers what **your** dashboard/database code needs to change once pH data starts arriving over LoRa.

### 2.1 Database schema change

Add a `ph` column to the existing readings table in SQLite:

```sql
ALTER TABLE readings ADD COLUMN ph REAL;
```

Keep it nullable — historical rows recorded before the pH sensor was added won't have a value, and your UI/queries need to handle that gracefully (don't crash on `NULL`, show "—" or "no data" instead).

### 2.2 FHI formula update

Current formula (3-sensor scope):

```
FHI = 0.5 × S_temp + 0.3 × S_turbidity + 0.2 × S_TDS
```

New formula needs a 4th weighted term:

```
FHI = w1 × S_temp + w2 × S_turbidity + w3 × S_TDS + w4 × S_pH
```

**This is not your call to make alone** — the weights (`w1..w4`) belong to Pratheesa's Decision Support subsystem. Your job on the dashboard side is to:

- Accept whatever weights the decision engine returns/uses
- Display the FHI breakdown clearly (e.g. a small "contribution per sensor" view) so the team can sanity-check the new weighting during testing
- Make sure the Python decision engine bridge (stdin/stdout) is passed the new `ph` field in every reading payload it receives

### 2.3 Dashboard UI changes

- Add a 4th gauge/tile alongside temp, turbidity, TDS on the live readings view
- Add pH to the historical chart/trend view (same treatment as the other 3 sensors — same time-series component, just a new series)
- Add a safe-range indicator for pH (e.g. color-coded: green/amber/red zones) consistent with how the other sensors are shown
- Update any CSV/report export functionality to include the new column

### 2.4 Sub-score conversion curve

Recall this was already flagged as pending: how a raw out-of-range pH reading maps to a 0–100 sub-score needs the same conversion-curve treatment as your other 3 sensors. Coordinate this with Pratheesa — don't invent a curve unilaterally since it directly affects FHI accuracy.

---

## 3. Feature 2 — Primary DB (SQLite) + Cloud backup DB (Postgres)

### 3.1 Why this is "primary + backup," not "local + cloud mirror"

Important framing for your report: SQLite stays the **primary, authoritative** database — every reading is written there first, and the desktop app's own dashboard always reads from SQLite, never from the cloud. Postgres on the backend is a **full backup copy**, not a cache or a subset. The mobile app happens to read from the backup copy (since it can't reach the desktop machine directly), but the backup copy is designed to hold everything the primary does.

This matters because it keeps your "local dashboard always works, no internet dependency" guarantee fully intact — the backup DB is additive, never load-bearing for the desktop app itself.

### 3.2 What needs to be built on the desktop side

**Outbox table** (in the same SQLite file):

```sql
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | synced | failed
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reading_id) REFERENCES readings(id)
);
```

**On every new reading insert:**

1. Insert into `readings` (as today)
2. Insert a matching row into `outbox` with `status = 'pending'`, `payload_json` containing the full reading (including the new `ph` field)

**Background sync process** (Electron main process, runs on a timer — e.g. every 2–5 minutes):

1. Check connectivity (simple approach: try a lightweight request to the backend's health endpoint)
2. If online, fetch all `outbox` rows with `status = 'pending'`
3. POST them in a batch to the backend's `/readings/sync` endpoint
4. On success response, mark those rows `status = 'synced'`
5. On failure (network error, backend down, etc.), leave them `pending`, increment `retry_count`, try again next cycle — no data loss either way

**Idempotency:** each reading needs a stable unique key (e.g. `node_id + timestamp`) so if a batch gets sent twice (e.g. app crashed mid-sync before marking rows as synced), the backend can safely upsert instead of creating duplicates. This key should already exist from your original sync design — reuse it here.

### 3.3 Desktop-side UI addition

A small, unobtrusive **sync status indicator** somewhere in the dashboard (e.g. a small badge: "Backed up 2 min ago" / "3 readings pending sync" / "Offline — backup paused"). Cheap to build, and it gives you a concrete, honest answer in the viva for "what happens if internet drops" — the indicator makes the offline-first behavior visible rather than invisible.

---

## 4. Feature 3 — Login screen (desktop side)

Since the mobile app now requires login with the shared admin credential (`Admin` / `Admin123`), the desktop app should present the **same login gate**, so both entry points into the system are protected consistently — not just the newer mobile surface.

### 4.1 Two implementation options

| Option                                | How it works                                                                       | Trade-off                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Local-only check**              | Desktop app checks the credential against a hardcoded/local value, no network call | Works even fully offline; simplest to build; but the credential lives in two places (desktop code + backend code) and could drift out of sync if changed later      |
| **B — Validates against the backend** | Desktop app calls the same `POST /auth/login` endpoint the mobile app uses         | Single source of truth for the credential; but desktop app now needs internet for its _login screen_ (though not for ongoing operation, since SQLite stays primary) |

**Recommendation:** Option A for the desktop app. The desktop app's core value is working without internet — making its login gate depend on the backend being reachable would be a small but real regression of that guarantee. Keep the credential check local on desktop, and only mobile depends on the backend for login (which it needs internet for anyway, to fetch history and receive alerts).

State this reasoning explicitly in your report — it shows a deliberate trade-off, not an inconsistency between the two apps.

### 4.2 What to build

- A simple login screen shown on app launch (username + password fields)
- Store login state in memory/session (or a short-lived local flag) so the user isn't forced to re-login every time they switch dashboard tabs — just once per app session
- No need for password reset flows, multi-user roles, or session expiry for this scope — matches the "single shared admin credential, academic demo" framing already agreed for the mobile side

---

## 5. Implementation order (desktop side)

1. **Schema migration** — add `ph` column, create `outbox` table
2. **Decision engine bridge update** — pass `ph` field through to the Python process; confirm FHI weights from Pratheesa are wired in
3. **UI: 4th sensor tile + chart series** — pH added alongside existing 3
4. **Outbox insert logic** — every new reading also writes an outbox row
5. **Background sync service** — connectivity check + batch POST + retry logic
6. **Sync status indicator** — small UI element showing last-synced state
7. **Login screen** — local credential check, session-scoped
8. **End-to-end test**:
   - Insert a reading with pH → confirm it shows correctly in UI and FHI recalculates
   - Disconnect internet → confirm readings still log, outbox queues up, login still works
   - Reconnect → confirm outbox drains, no duplicate rows appear in the cloud backup DB
   - Confirm a reading synced from desktop shows up correctly when queried from the mobile app

---

## 6. Summary of what goes in the final report (desktop side)

- Updated ER diagram / schema showing the new `ph` column and the `outbox` table
- Updated FHI formula with final weights (once agreed with Pratheesa) and a short note on the sub-score conversion curve for pH
- Explanation of "primary vs backup" DB framing — SQLite is authoritative, Postgres is a full backup, not a subset
- Outbox/sync design explained as the same offline-first pattern used elsewhere in the system, for consistency
- Justification for local (not backend-dependent) login on desktop vs backend-dependent login on mobile — a deliberate, explained trade-off
