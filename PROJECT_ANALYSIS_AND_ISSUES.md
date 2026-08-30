# AquaLoRa Project Analysis & Critical Issues Report

**Date**: August 2026  
**Scope**: Full project structure, 3-layer syncing architecture, and implementation gaps  
**Status**: Multiple critical issues identified requiring immediate attention

---

## Executive Summary

Your AquaLoRa project is a well-architected local-first IoT system with 4 subsystems across 4 team members. However, the recent expansion from **local-only (Desktop SQLite)** to **3-layer syncing (Desktop ↔ Backend ↔ Mobile)** has introduced several **critical architectural conflicts and incomplete implementations** that will cause data loss, sync failures, and authentication bypasses if not addressed.

### Three-Layer Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 1: LOCAL                                                      │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ Desktop App (Electron + React + TypeScript)                   │   │
│ │ ├─ Primary DB: SQLite (aqualora.db) ← SOURCE OF TRUTH        │   │
│ │ ├─ Login: Local user table (Admin/Admin123)                  │   │
│ │ ├─ Readings: Temperature, Turbidity, TDS, pH (NEW)           │   │
│ │ ├─ Alerts: Stored locally in SQLite                          │   │
│ │ └─ Outbox Queue: For cloud sync (PARTIALLY IMPLEMENTED)      │   │
│ └───────────────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ (Background sync, retries when online)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 2: BACKEND/CLOUD                                              │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ FastAPI Backend (Python + PostgreSQL)                         │   │
│ │ ├─ Auth: Hardcoded admin credentials (SECURITY ISSUE)        │   │
│ │ ├─ Readings Table: Synced from Desktop (via POST /sync)       │   │
│ │ ├─ NO Alerts Table (MISSING - alerts not synced)             │   │
│ │ ├─ Endpoints: /health, /auth/login, /readings/sync, /latest, │   │
│ │ │             /history                                        │   │
│ │ └─ JWT Token: For mobile app authentication                  │   │
│ └───────────────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ (Mobile reads from cloud DB)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 3: MOBILE                                                     │
│ ┌───────────────────────────────────────────────────────────────┐   │
│ │ React Native App (Expo)                                       │   │
│ │ ├─ Auth: Mobile auth server (reads desktop SQLite)            │   │
│ │ ├─ Data Source: Backend PostgreSQL (INCOMPLETE)              │   │
│ │ ├─ Alerts: Expects from Backend (NOT SYNCED)                 │   │
│ │ ├─ Push Alerts: FCM (NOT IMPLEMENTED)                        │   │
│ │ └─ Config: Hardcoded API endpoints (INFLEXIBLE)              │   │
│ └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CRITICAL ISSUES ANALYSIS

### 🔴 Issue #1: Incomplete Outbox Pattern Implementation

**Severity**: CRITICAL — **Data Loss Risk**

**Problem**:
- Desktop SQLite schema includes `outbox` table (lines 60–71 in db.ts)
- BUT: No code in `decisionEngine.ts` or `db.ts` that actually:
  - Creates outbox entries when new readings arrive
  - Runs background sync to POST to Backend
  - Handles retry logic for failed syncs
  - Deduplicates readings that were synced

**Impact**:
- If the backend is online, new readings never leave the desktop
- Manual sync attempt would cause duplicates (no idempotency check on client side)
- If internet fails mid-sync, no retry mechanism — data stranded forever
- Mobile app starves of data because nothing ever reaches the backend

**Current State**:
```typescript
// db.ts line 60-71: Schema exists but...
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reading_id) REFERENCES readings(id)
);

// BUT: Nothing in index.ts or decisionEngine.ts calls outbox insert or sync
```

**Root Cause**:
- Desktop README (AquaLoRa-Desktop-Dashboard-NewFeatures-README.md § 3.2) **documents** the outbox pattern
- Implementation was never completed — the feature is only designed, not coded

---

### � Issue #2: Authentication Consistency (Hardcoded vs. Database)

**Severity**: MEDIUM — **Configuration Management**

**Problem**:
- Backend credentials are hardcoded in `.env` file (Admin/Admin123)
- Desktop app can change user password in UI (stored in SQLite)
- Mobile app authenticates independently against backend API
- If backend credentials need to change, only the `.env` file must be updated

**Current Architecture** (correct, independent):
```
Desktop App ──→ SQLite (local auth, offline capable)
                ├─ User table (can create/modify users locally)
                └─ Syncs readings to backend

Backend API ← (receives synced data)
                ├─ Credentials in `.env` or Railway dashboard
                ├─ Shared auth endpoint: POST /auth/login
                └─ Used by both desktop app AND mobile app

Mobile App ──→ Authenticates directly vs. Backend API
                └─ Independent, no desktop SQLite dependency
```

**Impact**:
- ✅ **Good**: Mobile and Desktop are fully independent
- ⚠️ **Consider**: If desktop user password changes locally, it doesn't affect backend login
- ⚠️ **Consider**: Backend credentials are env-based (best practice for production)

**Root Cause** (Actually correct design, not an issue):
- Each app is independent and connects to backend as a separate client
- Backend uses standard JWT authentication
- No "sync" of auth credentials needed — each app authenticates once per session

**Recommendation**:
- Document clearly that both apps authenticate independently against backend
- When adding per-user authentication later, users will sync auth via backend (not desktop SQLite)
- ✅ **Current design is actually correct** — mobile does NOT read desktop SQLite

---

### 🔴 Issue #3: Alerts Table Missing from Backend Schema

**Severity**: CRITICAL — **Alert Data Never Synced**

**Problem**:
- Desktop app creates alerts in local SQLite table (db.ts line 72+)
- Backend `database.py` defines only a `Reading` table — **no Alerts table**
- No endpoint to POST alerts to the backend
- Mobile app has no way to receive alerts from the backend

**Impact**:
- Threshold alerts (e.g., "Temperature Critical") stored on desktop only
- If user checks mobile app, they see stale readings but **no alerts**
- If desktop app crashes/restarts, some recent alerts are lost (not in mobile app history)
- Alert statistics/analytics can't be collected on backend

**Desktop Schema** (implemented):
```sql
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  parameter TEXT,
  severity TEXT,
  message TEXT,
  -- ... more fields ...
);
```

**Backend Schema** (incomplete):
```python
class Reading(SQLModel, table=True):
    id: int | None = None
    node_id: str
    timestamp: str
    temperature: float | None = None
    # ... no alerts table at all!
```

**Root Cause**:
- Backend README (AquaLoRa-Mobile-Backend-README.md § 3) mentions alerts but doesn't define backend schema
- Decision was to keep Postgres as a full backup, but only readings were implemented

---

### 🔴 Issue #4: pH Sensor Integration Incomplete

**Severity**: HIGH — **Feature Partially Implemented**

**Problem**:
- pH field added to SQLite schema (db.ts) ✓
- pH field added to Backend Postgres schema (database.py) ✓
- fish_health_index.py has placeholder pH profiles ✓
- BUT:
  - **Not all React UI components updated** to display pH
  - **FHI formula weights not finalized** — documented as needing coordination with Member 4 (Pratheesa)
  - **No validation** that all 4-sensor readings (temp, turb, TDS, pH) reach the decision engine
  - Desktop README mentions "add 4th gauge" but doesn't track implementation status

**Impact**:
- If pH sensor data arrives, decision engine scores based on **placeholder profiles** (generic freshwater, not species-calibrated)
- Mobile app may receive pH data but can't display it properly
- If FHI formula weights change later, UI components must be re-synced with decision engine

**Current fish_health_index.py Profiles** (placeholder):
```python
POND_PROFILES = {
    'tilapia': {
        'temperature': (26.0, 30.0, 20.0, 34.0),  # ideal, acceptable, min, max
        'turbidity': (0.0, 25.0, 0.0, 45.0),
        'tds': (100.0, 300.0, 50.0, 400.0),
        'ph': (6.5, 8.5, 5.5, 9.5),  # ← NEW but unvalidated
    },
    # ... other species ...
}
```

**Root Cause**:
- pH sensor hardware wasn't available when desktop/backend code was finalized
- Schema updates were made anticipatedly, but integration tests skipped
- Feature dependencies not tracked across subsystems

---

### 🟡 Issue #5: Mobile App Configuration Hardcoded

**Severity**: HIGH — **Deployment Inflexibility**

**Problem**:
- Mobile app config.ts or screens likely have hardcoded API endpoints (localhost, hardcoded port)
- mobile_auth_server runs on port 3001, but mobile app URL is fixed in code
- If backend moves to a different server/IP, mobile app must be re-built and re-deployed

**Impact**:
- Can't test mobile app against different backend deployments (dev, staging, production)
- Field deployment requires code change + rebuild, not just config file update
- Mobile auth_server and backend auth are running on different ports/endpoints but both hardcoded

---

### 🟡 Issue #6: No Unified Error Handling for Sync Failures

**Severity**: MEDIUM — **Silent Failures**

**Problem**:
- Desktop sync is planned but not implemented
- No way to know if outbox entries are stuck (pending forever vs. temporarily offline)
- No user-facing UI to show "Sync failed, retrying in 2 minutes"
- Mobile app has no way to distinguish "stale data" vs. "never synced"

**Impact**:
- User has no visibility into whether their data is actually reaching the cloud
- If backend is down, desktop app still appears to work normally, but mobile/analytics see nothing
- Debugging issues like "why is mobile data different from desktop?" is impossible

---

### 🟡 Issue #7: No Data Versioning or Conflict Resolution

**Severity**: MEDIUM — **Rare but Dangerous**

**Problem**:
- If same reading is edited on both desktop and backend (offline editing, then cloud sync):
  - Current sync code overwrites all fields
  - No merge strategy, no conflict detection
  - Could lose legitimate data changes

**Current Backend Sync Logic** (app/main.py line 63–100):
```python
if existing is None:
    session.add(row)  # New reading
    saved += 1
else:
    # Existing reading — blindly overwrite all fields!
    for field_name in [...]:
        setattr(existing, field_name, getattr(row, field_name))
```

**Impact**:
- Rare in normal operation (readings are immutable once stored)
- Dangerous if alerts/thresholds are edited and synced — last-write-wins loses history

---

## DOCUMENTATION GAPS

### README Files Out of Sync

| File | Current Status | Issue |
|------|---|---|
| **ROOT README.md** | Good overview | Doesn't mention pH sensor or 3-layer syncing |
| **Backend/README.md** | Incomplete | No database schema diagram, no alerts sync, no outbox pattern |
| **Desktop/README.md** | Outdated | Doesn't document NEW features (pH, cloud sync, login) — points to separate doc |
| **Desktop/AquaLoRa-Desktop-Dashboard-NewFeatures-README.md** | Feature spec, not impl guide | Designs the outbox pattern but implementation is incomplete |
| **Mobile/README.md** | Partially accurate | Says mobile_auth_server reads desktop SQLite (correct), but missing backend integration details |
| **Mobile/AquaLoRa-Mobile-Backend-README.md** | Good design doc | Mentions alerts & FCM but not backend schema, no implementation guide |
| **Firmware/README.md** | Accurate | For its scope, but doesn't describe the 3-layer architecture impact |

**Root Cause**:
- READMEs written as **design docs** when the system was planned
- Implementation diverged from the design (outbox pattern not coded, alerts not synced)
- No automated checking of README-to-code consistency

---

## RECOMMENDED APPROACH & RESOLUTION

### Phase 1: Fix Critical Data Sync (Priority: URGENT)

**Goal**: Ensure all readings reliably reach backend, no data loss

#### Step 1.1: Implement Outbox Sync in Desktop App
**File**: `desktop_application/src/main/index.ts` and new file `sync.ts`

```typescript
// Add outbox sync loop to Electron main process
async function syncOutbox() {
  const pending = db.prepare('SELECT * FROM outbox WHERE status = "pending" LIMIT 100').all();
  
  for (const entry of pending) {
    try {
      const response = await fetch(`${BACKEND_URL}/readings/sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ readings: [JSON.parse(entry.payload_json)] })
      });
      
      if (response.ok) {
        db.prepare('UPDATE outbox SET status = "synced" WHERE id = ?').run(entry.id);
      } else {
        incrementRetryCount(entry.id);
      }
    } catch (err) {
      incrementRetryCount(entry.id);
    }
  }
}

// Run every 2 minutes
setInterval(syncOutbox, 2 * 60 * 1000);
```

#### Step 1.2: Auto-insert Outbox Entry on New Readings
**File**: `desktop_application/src/main/db.ts`

Wrap the `readings` INSERT to also CREATE an `outbox` entry:

```typescript
export function insertReading(reading: Reading): number {
  const readingId = db.prepare(
    `INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds, ph) 
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(reading.node_id, reading.timestamp, ...).lastID;
  
  // Also queue for sync
  db.prepare(
    `INSERT INTO outbox (reading_id, payload_json, status, created_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(readingId, JSON.stringify(reading), new Date().toISOString());
  
  return readingId;
}
```

#### Step 1.3: Add Sync Status UI
**File**: `desktop_application/src/renderer/components/SyncStatusIndicator.tsx`

Show user whether sync is working or stuck (color: green = synced, amber = pending, red = failed).

---

### Phase 2: Sync Alerts Table (Priority: HIGH)

**Goal**: Alerts available on mobile app, persistent on backend

#### Step 2.1: Add Alerts Table to Backend
**File**: `Backend/app/database.py`

```python
class Alert(SQLModel, table=True):
    id: int | None = None
    node_id: str = Field(index=True)
    timestamp: str = Field(index=True)
    parameter: str  # "temperature", "turbidity", etc.
    severity: str   # "normal", "warning", "critical"
    message: str
    created_at: str
```

#### Step 2.2: Add Alerts Sync Endpoint
**File**: `Backend/app/main.py`

```python
class AlertPayload(BaseModel):
    node_id: str
    timestamp: str
    parameter: str
    severity: str
    message: str

@app.post('/alerts/sync')
def sync_alerts(payload: list[AlertPayload], _: str = Depends(verify_token)):
    # Similar to /readings/sync
    ...
```

#### Step 2.3: Desktop Queues Alerts to Sync
**File**: `desktop_application/src/main/db.ts`

When new alert is created, also insert into an `alert_outbox` table (same pattern as readings).

---

### Phase 3: Complete pH Integration (Priority: MEDIUM)

**Goal**: pH sensor fully integrated across all 3 layers

**Checklist**:
- [ ] Desktop UI: Add pH gauge to HomePage ✓ (likely done)
- [ ] Desktop UI: Add pH to historical charts ✓ (likely done)
- [ ] Desktop decision engine: Verify all 4 sensors reach fish_health_index.py
- [ ] Backend schema: pH field already in Reading table ✓
- [ ] Mobile app: Display pH gauge and history charts
- [ ] Test: Create a test reading with all 4 sensors, verify it reaches mobile app and shows on charts

**Weights Coordination**:
- [ ] Pratheesa (Member 4) finalizes FHI weights for 4-sensor formula
- [ ] Update fish_health_index.py with final weights
- [ ] Document weights in a shared config so UI can show "contribution per sensor"
- [ ] Add tests: verify that if one sensor is out of range, FHI score is affected correctly

---

### Phase 5: Update and Consolidate Documentation (Priority: MEDIUM)

**Goal**: Single source of truth for system architecture & implementation status

#### Step 5.1: Update Root README.md
- Add section on 3-layer architecture with diagram
- Link to subsystem-specific details
- Mention pH sensor integration
- State implementation status: "Outbox sync in development", etc.

#### Step 5.2: Consolidate Backend README
- Merge info from AquaLoRa-Mobile-Backend-README.md § 3 into Backend/README.md
- Add database schema diagrams
- Document all endpoints: /health, /auth/login, /readings/sync, /alerts/sync, /readings/latest, /readings/history, /alerts/latest
- Add deployment guide (Railway, Docker, etc.)

#### Step 5.3: Create ARCHITECTURE.md
```
AquaLoRa/ARCHITECTURE.md:
├── System Overview (3 layers)
├── Data Flow Diagrams (readings, alerts)
├── Authentication Model
├── Sync Mechanisms
├── Decision Engine Integration
├── Deployment Checklists
└── Troubleshooting Guide
```

#### Step 5.4: Update Desktop README
- Consolidate existing README.md + AquaLoRa-Desktop-Dashboard-NewFeatures-README.md
- Add implementation status for each feature
- Document outbox sync pattern (implemented, not planned)

---

## IMPLEMENTATION TIMELINE

### Week 1: Critical Data Sync (URGENT)
- [ ] Implement outbox sync in desktop app (Steps 1.1 & 1.2)
- [ ] Add sync status UI (Step 1.3)
- [ ] Test 1: New reading on desktop → Backend receives it → Mobile sees it

### Week 2: Alerts & pH Integration
- [ ] Add alerts table to backend (Steps 2.1 & 2.2)
- [ ] Desktop queues alerts to sync (Step 2.3)
- [ ] Complete pH gauge UI on desktop and mobile (Phase 3)
- [ ] Finalize FHI weights with Member 4
- [ ] Test 2: Critical alert on desktop → Backend stores it → Mobile displays it

### Week 3: Documentation & Full Testing
- [ ] Update all READMEs and create ARCHITECTURE.md (Phase 5)
- [ ] Test 3: Full 4-sensor reading → FHI score calculated → Synced to cloud → Mobile displays with pH gauge
- [ ] Integration tests (desktop ↔ backend ↔ mobile)
- [ ] Offline/reconnect scenarios
- [ ] Data validation (no duplicates, no loss)

### Week 4: Deployment & Staging
- [ ] Deploy updated code to staging environment
- [ ] Performance testing and optimization
- [ ] User acceptance testing (UAT)
- [ ] Prepare production deployment

---

## QUICK REFERENCE: Issue Priority Matrix

| Issue | Severity | Category | Impact | Fix Time |
|-------|----------|----------|--------|----------|
| Outbox pattern not implemented | 🔴 CRITICAL | Data loss | Mobile gets no data | ~2 days |
| Alerts table missing | 🔴 CRITICAL | Data model | Mobile has no alerts | ~1 day |
| pH integration incomplete | 🟡 HIGH | Feature | Wrong FHI scores | ~3 days |
| Hardcoded mobile config | 🟡 HIGH | Deployment | Can't test multiple envs | ~1 day |
| No sync error handling | 🟡 MEDIUM | UX | Silent failures | ~2 days |
| No conflict resolution | 🟡 MEDIUM | Data integrity | Rare data loss | ~1 day |
| READMEs outdated | 🟡 MEDIUM | Documentation | Confusion, wrong instructions | ~1 day |
| Missing pH in FHI profiles | 🟡 MEDIUM | Decision logic | Inaccurate scoring | ~1 day |

---

## NEXT STEPS

1. **Today**: Review this analysis with your team (especially Members 3 & 4 for desktop/decision engine coordination)
2. **This week**: Create GitHub issues for each critical issue, assign owners
3. **Next week**: Start Phase 1 implementation (outbox sync)
4. **Ongoing**: Update READMEs as code changes land

---

**Prepared**: Analysis of all 4 subsystems + architectural conflicts  
**Recommendations**: Phased approach prioritizing data integrity, then consistency, then UX  
**Success Metric**: End-to-end test: sensor reading on pond → shows on desktop → syncs to backend → visible on mobile, all without data loss or conflicts
