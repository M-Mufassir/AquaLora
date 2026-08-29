# AquaLoRa — Web Backend + Mobile Alert App

**Implementation guide & project specification**
Subsystem owner: Mufassir (IT23650848) — Dashboard & Database
Module: IE3044 Design Project, SLIIT

---

## 1. Purpose of this document

This covers the **upgrade scope** added on top of the existing AquaLoRa system (Master Node ↔ LoRa ↔ Slave Node ↔ Desktop App ↔ SQLite, already built and tested at 1km range). It does **not** re-document the sensing/LoRa/solar subsystems — see their respective READMEs.

This upgrade adds:
1. A **web-hosted backend** (cloud copy of readings from all 4 sensors — temp, turbidity, TDS, pH — + alert relay)
2. A **mobile app** that mirrors the desktop dashboard — full current readings, historical data, login-protected — with a push alert system layered on top for when the user isn't looking at either app

> Note: the pH sensor itself, wiring, calibration, and its role in the Fish Health Index are already implemented in the sensing/decision-engine subsystems. This document covers the backend + mobile app that surface that data remotely — it does not re-describe pH sensor integration.

---

## 2. Why this architecture (design rationale)

| Decision | Reasoning |
|---|---|
| Desktop app remains the source of truth | SQLite must keep working with zero dependency on internet — this protects the core monitoring guarantee that already exists |
| Cloud sync is secondary, best-effort | If the internet is down, pond monitoring must not stop. Cloud write failure ≠ system failure |
| Mobile app mirrors the desktop dashboard | Same 4 sensor readings (temp, turbidity, TDS, pH), same historical data access — the mobile app is the desktop dashboard made remotely accessible, not a separate lightweight tool. It's not live/real-time (matches the 15–30 min sensor cadence), but it's not stripped down either |
| Alerts are additional, not a replacement for browsing | The user can open the app anytime to check history/current readings, **and** gets pushed a notification automatically if something's wrong — covers both "I want to check" and "I wasn't looking" |
| Login required on first open | Matches the desktop app's access control — same credential model, so the mobile app isn't a weaker entry point into the system. **Locked: single shared admin credential** (`Admin` / `Admin123`), not per-user accounts — simplest possible auth that still gates access |
| FCM (Firebase Cloud Messaging) for push | The only way to reliably notify a closed/backgrounded phone app is via the OS-level push channel (APNs/FCM) — this is an OS constraint, not a design preference. **Locked: Android-only for now** — no APNs/iOS work in this phase |
| Two distinct alert types | **Threshold alerts** (a reading is unsafe — fire immediately) vs **staleness alerts** (no new reading for N hours — fire on a timer, **locked at 1 hour**). Different triggers, must not be conflated |
| Cloud DB as a real secondary copy | The Postgres backend isn't just a sync buffer for alerts — it's treated as a **full backup database**. Mobile history/charts read directly from it, so mobile sees the same depth of history as the desktop app, not a trimmed-down version |

**Stated assumption for the report:** the mobile app assumes the user has reasonably stable internet access when checking status; the system does not attempt to solve for a permanently offline phone. This is a deliberate scope decision, not an oversight — state it explicitly in your documentation.

---

## 3. System architecture

```
Sensors (incl. new pH) → Slave Node → LoRa → Master Node
                                                  │
                                                  ▼
                                          Desktop App (Electron)
                                          ├─ Writes to local SQLite (always, source of truth)
                                          ├─ Runs Python decision engine (FHI calculation)
                                          └─ Inserts into "outbox" queue (pending cloud sync)
                                                  │
                                          (background sync, retries when online)
                                                  ▼
                                          FastAPI Backend (Railway)
                                          ├─ Postgres DB — full secondary/backup copy of readings
                                          ├─ Threshold + staleness (1hr) alert evaluation
                                          └─ Sends push via Firebase Cloud Messaging (Android)
                                                  │
                                                  ▼
                                          Mobile App (React Native, Android)
                                          ├─ Login required (shared admin credential)
                                          ├─ Registers device token with backend on install
                                          ├─ Full dashboard: current + historical data, all 4 sensors
                                          └─ Receives push notifications (app closed or open)
```

---

## 4. Stack summary

| Layer | Choice | Why |
|---|---|---|
| Backend framework | **FastAPI** (Python) | Matches your existing Python decision engine — one language, less duplication of threshold logic. Async-friendly for I/O-bound sync/alert work. Auto-generated OpenAPI docs for the team |
| Backend DB | **PostgreSQL** via SQLAlchemy or SQLModel | Treated as a **full secondary/backup DB**, not just an alert buffer — schema mirrors the desktop app's SQLite tables exactly (all 4 sensor readings + timestamps), so mobile history queries return the same depth of data as the desktop app |
| Auth | Single shared admin credential (`Admin` / `Admin123`) + JWT session token | **Locked decision** — one team/admin login, no per-user accounts. Simplest auth that still gates access; mobile app requests a token on login and attaches it to every API call |
| Hosting | **Railway** | **Locked decision** — free tier, simple deploy for FastAPI + Postgres |
| Push notifications | **Firebase Cloud Messaging (FCM)** | Free, Android delivery (iOS/APNs out of scope for now — **locked: Android-only**) |
| Mobile framework | **React Native (Expo)** | Reuses your team's existing React knowledge; Expo simplifies build/config and pairs directly with **EAS Build** for cloud APK generation (no local Android Studio setup required) |
| Sync pattern | Outbox table + background retry | Standard "outbox pattern" — guarantees no data loss and no duplicate writes (idempotency key = node ID + timestamp) |

---

## 5. Implementation order (recommended sequence)

Build in this order — each phase should be independently testable before moving to the next.

### Phase 1 — Local outbox table (Desktop App)
1. Add an `outbox` table in SQLite: `id, reading_id, payload_json, status (pending/synced/failed), retry_count, created_at`
2. On every new reading insert (all 4 sensors), also insert a corresponding outbox row with `status = pending`
3. Build a background timer (e.g. every 2–5 min) that checks internet connectivity and attempts to POST pending rows to the backend
4. On success, mark `status = synced`. On failure, leave `pending`, increment `retry_count`

### Phase 2 — FastAPI backend (core + auth)
1. Scaffold FastAPI project with SQLModel/SQLAlchemy + Postgres, deployed on **Railway**
2. Build the readings table to fully mirror desktop SQLite's schema (temp, turbidity, TDS, pH, timestamp, node_id) — this table is the **secondary/backup DB**, not a trimmed copy
3. Build `POST /auth/login` — checks against the single hardcoded/seeded admin credential (`Admin` / `Admin123`), returns a JWT session token (mobile app calls this on first open)
4. Build `POST /readings/sync` — accepts a batch of readings, upserts using idempotency key (`node_id + timestamp`) to prevent duplicates
5. Build `GET /readings/latest` — current snapshot per node (mobile home screen)
6. Build `GET /readings/history` — supports date-range/paginated queries, backed by the full Postgres history, so mobile can browse the same depth of past data as the desktop app
7. Deploy to Railway, confirm the desktop app's outbox sync can reach it

### Phase 3 — Alert evaluation (backend)
1. **Threshold alerts**: on each synced reading, check if any of the 4 sensor values is out of safe range → fire immediately if so
2. **Staleness alerts**: a periodic job (e.g. every 15–30 min) compares `now - last_reading_timestamp` per node; **locked threshold: fire if no new reading for 1 hour**
3. Keep these two as separate functions — don't merge their logic
4. Store fired alerts in an `alerts` table so the mobile app can show alert history, not just live pushes

### Phase 4 — Firebase Cloud Messaging setup (Android)
1. Create a Firebase project (console.firebase.google.com), add an **Android app only** for now
2. Add the Firebase config (`google-services.json`) to your React Native (Expo) app
3. Build `POST /devices/register` on the backend — stores `{device_token, node_id or user_id}`
4. On the mobile app's first launch (after login), request notification permission, get the FCM token, register it with the backend
5. Wire alert firing (Phase 3) to call the FCM Admin SDK from FastAPI when a threshold/staleness alert triggers

### Phase 5 — Mobile app UI (React Native / Expo, Android)
1. **Login screen** — single admin credential (`Admin` / `Admin123`), calls `POST /auth/login`, stores the JWT securely (e.g. `expo-secure-store`)
2. **Dashboard/home screen** — full mirror of the desktop app: current readings for all 4 sensors, latest FHI score, per-node view
3. **History screen** — same depth as the desktop app, pulling from the Postgres backup DB via `GET /readings/history` (charts recommended, reuse the same visual language as the desktop app for consistency)
4. **Alerts screen** — list of past alerts (from `GET /alerts`), plus incoming push notifications
5. Notification handling: foreground banner (via `expo-notifications`) + background/closed handled automatically by FCM/OS

### Phase 6 — EAS Build (cloud APK generation)
Covered in detail in Section 6 below.

### Phase 7 — End-to-end test
1. Disconnect desktop app from internet → confirm local SQLite still logs normally
2. Reconnect → confirm outbox drains and backend receives the backlog without duplicates
3. Force a threshold breach (e.g. manually insert a bad reading) → confirm push notification arrives on a closed app
4. Stop sending readings for >1 hour → confirm staleness alert fires

---

## 6. Getting an APK via EAS Build (cloud, no local Android Studio)

**EAS Build** is Expo's cloud build service — it compiles your React Native app into an installable `.apk` (or `.aab` for Play Store) on Expo's servers, so your team doesn't need a local Android SDK setup.

### Step-by-step

1. **Install Expo CLI + EAS CLI**
   ```bash
   npm install -g eas-cli
   ```

2. **Create the Expo project** (if not already done)
   ```bash
   npx create-expo-app aqualora-mobile
   cd aqualora-mobile
   ```

3. **Log in to an Expo account**
   ```bash
   eas login
   ```

4. **Configure the project for EAS Build**
   ```bash
   eas build:configure
   ```
   This generates an `eas.json` file with build profiles (`development`, `preview`, `production`).

5. **Set the build profile to output an APK** (by default, Android production builds produce `.aab` for Play Store — you want `.apk` for direct install/testing, Android-only build). In `eas.json`, under the `preview` profile:
   ```json
   {
     "build": {
       "preview": {
         "android": {
           "buildType": "apk"
         }
       }
     }
   }
   ```

6. **Add Firebase config for push notifications**
   - Place `google-services.json` (from your Firebase console) in the project root
   - Reference it in `app.json` under `expo.android.googleServicesFile`

7. **Trigger the cloud build**
   ```bash
   eas build --platform android --profile preview
   ```
   This uploads your project to Expo's servers, builds remotely, and gives you a download link when done (usually 10–20 min).

8. **Download & distribute the APK**
   - Download from the link EAS provides, or scan the QR code EAS CLI shows
   - Share the `.apk` directly with your team/examiners for sideloading (no Play Store submission needed for a student project demo)

**Note for the report:** EAS Build is worth mentioning explicitly as your chosen build/distribution method — it's a legitimate, commonly used part of the Expo/React Native ecosystem, not a shortcut, and explains why you don't need a Play Store listing for your viva demo.

---

## 7. Locked decisions

| Item | Decision |
|---|---|
| Login model | Single shared admin credential: `Admin` / `Admin123` |
| Staleness alert threshold | Fixed at **1 hour** (no new reading for 1hr → alert) |
| Backend hosting | **Railway** |
| Platform scope | **Android-only** for now (iOS/APNs deferred) |
| Mobile history/dashboard depth | **Full parity with desktop** — Postgres backend acts as a real secondary/backup DB, not a trimmed alert buffer, so mobile history/charts pull the same data desktop does |

> Note: `Admin123` as a literal password is fine for a student demo, but mention in your report that it's a placeholder credential suitable for a controlled academic demo, not a production-grade secret — shows you're aware of the trade-off rather than having missed it.

---

## 8. Summary of what goes in the final report

- Architecture diagram (Master Node → Desktop App → Backend → Mobile App), explicitly showing the outbox/offline-first path as unaffected by connectivity
- Justification section: mobile app is a full mirror of the desktop dashboard (all 4 sensors + full history via the Postgres backup DB), with push alerts layered on top for when the user isn't looking at either app
- Explicit statement of the "stable internet assumption" as a scoped limitation
- FCM explanation: why OS-level push is required for background alerts (not a design choice, an OS constraint) — and why the demo is Android-only for now
- Login/auth flow: single shared admin credential + JWT, noted as sufficient for a controlled academic demo
- Staleness threshold (1 hour) tied back to the 15–30 min sampling cadence as justification
- EAS Build noted as the chosen distribution method for the demo APK
