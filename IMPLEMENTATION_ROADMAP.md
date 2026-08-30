# AquaLora Implementation Roadmap

**Version**: 1.0  
**Date**: 2026-08-30  
**Status**: Starting Phase 1

---

## Overview

This document breaks down the 4-phase implementation plan from PROJECT_ANALYSIS_AND_ISSUES.md into specific, actionable steps with file paths, code changes, and verification checkpoints.

### Critical Path Timeline
- **Phase 1 (Days 1-3)**: Outbox sync (BLOCKS mobile from getting data)
- **Phase 2 (Days 4-5)**: Alerts sync (enables mobile alerts)
- **Phase 3 (Days 6-8)**: pH integration (completes sensor suite)
- **Phase 4 (Days 9-10)**: Documentation (finalizes README updates)

---

## PHASE 1: Implement Outbox Sync (Days 1-3)

**Goal**: Desktop readings reliably sync to backend, no data loss

### Step 1.1: Verify Current Outbox Schema
**File**: `desktop_application/src/main/db.ts`  
**Status**: ✅ Schema exists

```typescript
// Expected (lines 60-71):
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reading_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reading_id) REFERENCES readings(id)
);
```

**Verification Task**: 
- [ ] Read `db.ts` and confirm schema exists
- [ ] If missing: add the table creation SQL

### Step 1.2: Auto-Insert Outbox Entry on New Readings
**File**: `desktop_application/src/main/db.ts`  
**Current Issue**: No code inserts into outbox when new reading created

**Changes Needed**:
1. Find the `insertReading()` function
2. After inserting into `readings` table, also insert into `outbox`

**Code Pattern**:
```typescript
export function insertReading(reading: Reading): number {
  const stmt = db.prepare(`
    INSERT INTO readings (node_id, timestamp, temperature, turbidity, tds, ph, pond_type, battery_pct, rssi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    reading.node_id,
    reading.timestamp,
    reading.temperature,
    reading.turbidity,
    reading.tds,
    reading.ph,
    reading.pond_type,
    reading.battery_pct,
    reading.rssi
  );
  
  const readingId = result.lastInsertRowid as number;
  
  // ✅ NEW: Also queue for sync
  const outboxStmt = db.prepare(`
    INSERT INTO outbox (reading_id, payload_json, status, created_at)
    VALUES (?, ?, 'pending', ?)
  `);
  
  outboxStmt.run(
    readingId,
    JSON.stringify(reading),
    new Date().toISOString()
  );
  
  return readingId;
}
```

**Verification Task**:
- [ ] Locate `insertReading()` in `db.ts`
- [ ] Add outbox insertion after reading insertion
- [ ] Check that both use same reading data
- [ ] Verify payload_json structure matches Reading type

### Step 1.3: Create Sync Loop (Background Process)
**File**: `desktop_application/src/main/index.ts` (or new `sync.ts`)  
**Current Issue**: No background sync process

**Changes Needed**:
1. Create a `syncOutbox()` function that runs every 2-5 minutes
2. Fetch pending outbox entries
3. POST them to backend `/readings/sync`
4. Mark as synced or update retry count on failure

**Code Pattern**:
```typescript
// File: desktop_application/src/main/sync.ts (new file)

import { BrowserWindow } from 'electron';
import db from './db';
import axios from 'axios';

interface OutboxEntry {
  id: number;
  reading_id: number;
  payload_json: string;
  status: 'pending' | 'synced' | 'failed';
  retry_count: number;
  created_at: string;
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const MAX_RETRIES = 5;
const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

let authToken: string | null = null;

export function setAuthToken(token: string) {
  authToken = token;
}

export async function syncOutbox(): Promise<void> {
  if (!authToken) {
    console.log('[sync] No auth token, skipping sync');
    return;
  }

  try {
    // Fetch pending entries (limit 50 per batch)
    const pending = db.prepare(`
      SELECT id, reading_id, payload_json, status, retry_count, created_at
      FROM outbox
      WHERE status = 'pending' AND retry_count < ?
      ORDER BY created_at ASC
      LIMIT 50
    `).all(MAX_RETRIES) as OutboxEntry[];

    if (pending.length === 0) {
      console.log('[sync] No pending entries');
      return;
    }

    console.log(`[sync] Processing ${pending.length} pending entries...`);

    // Extract readings from JSON
    const readings = pending.map(entry => JSON.parse(entry.payload_json));

    // POST to backend
    const response = await axios.post(`${BACKEND_URL}/readings/sync`, 
      { readings },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.status === 200) {
      // Mark all as synced
      const ids = pending.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      
      db.prepare(`
        UPDATE outbox
        SET status = 'synced'
        WHERE id IN (${placeholders})
      `).run(...ids);

      console.log(`[sync] ✅ Successfully synced ${pending.length} entries`);
      
      // Emit event to renderer process to update UI
      return {
        success: true,
        synced: pending.length,
        failed: 0
      };
    }
  } catch (err: any) {
    console.error('[sync] Error:', err.message);

    // Increment retry count for failed entries
    for (const entry of pending) {
      if (entry.retry_count < MAX_RETRIES) {
        db.prepare(`
          UPDATE outbox
          SET retry_count = retry_count + 1
          WHERE id = ?
        `).run(entry.id);
      } else {
        // Mark as failed after max retries
        db.prepare(`
          UPDATE outbox
          SET status = 'failed'
          WHERE id = ?
        `).run(entry.id);
      }
    }

    return {
      success: false,
      error: err.message,
      attempted: pending.length
    };
  }
}

export function startSyncLoop(): NodeJS.Timeout {
  console.log('[sync] Starting outbox sync loop (every 2 minutes)');
  return setInterval(syncOutbox, SYNC_INTERVAL);
}

export function stopSyncLoop(intervalId: NodeJS.Timeout): void {
  clearInterval(intervalId);
  console.log('[sync] Stopped sync loop');
}
```

**Integration in Main Process**:
```typescript
// File: desktop_application/src/main/index.ts

import { startSyncLoop, stopSyncLoop, setAuthToken } from './sync';

let syncInterval: NodeJS.Timeout | null = null;

app.on('ready', () => {
  // ... existing code ...
  
  // Start sync loop after app is ready
  syncInterval = startSyncLoop();
});

// After user successfully logs in (in your auth handler):
app.on('user-logged-in', (token: string) => {
  setAuthToken(token);
  console.log('[app] User logged in, sync enabled');
});

app.on('before-quit', () => {
  if (syncInterval) {
    stopSyncLoop(syncInterval);
  }
});
```

**Verification Tasks**:
- [ ] Create new file `desktop_application/src/main/sync.ts`
- [ ] Implement `syncOutbox()`, `startSyncLoop()`, `setAuthToken()`
- [ ] Integrate into `index.ts` with app lifecycle hooks
- [ ] Verify auth token is passed after login
- [ ] Check that sync interval is 2 minutes

### Step 1.4: Create Sync Status UI Component
**File**: `desktop_application/src/renderer/components/SyncStatusIndicator.tsx` (new)  
**Purpose**: Show user sync status in real-time

**Code Pattern**:
```typescript
// File: desktop_application/src/renderer/components/SyncStatusIndicator.tsx

import React, { useState, useEffect } from 'react';
import { useReadingsStore } from '../store/useReadingsStore';

type SyncStatus = 'synced' | 'pending' | 'syncing' | 'failed' | 'no-network';

interface SyncStats {
  pending: number;
  synced: number;
  failed: number;
  lastSyncTime: string | null;
}

export const SyncStatusIndicator: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus>('no-network');
  const [stats, setStats] = useState<SyncStats>({
    pending: 0,
    synced: 0,
    failed: 0,
    lastSyncTime: null
  });

  useEffect(() => {
    // Listen for sync events from main process
    const handleSyncUpdate = (event: any, data: any) => {
      setStats({
        pending: data.pending || 0,
        synced: data.synced || 0,
        failed: data.failed || 0,
        lastSyncTime: data.lastSyncTime || stats.lastSyncTime
      });

      // Determine status
      if (data.failed > 0) {
        setStatus('failed');
      } else if (data.pending > 0) {
        setStatus('pending');
      } else {
        setStatus('synced');
      }
    };

    window.ipcRenderer?.on('sync-status-update', handleSyncUpdate);

    return () => {
      window.ipcRenderer?.removeListener('sync-status-update', handleSyncUpdate);
    };
  }, [stats]);

  const statusColors = {
    synced: '#10b981',      // green
    pending: '#f59e0b',     // amber
    syncing: '#3b82f6',     // blue
    failed: '#ef4444',      // red
    'no-network': '#9ca3af' // gray
  };

  const statusText = {
    synced: 'All data synced ✓',
    pending: `${stats.pending} reading(s) pending...`,
    syncing: 'Syncing...',
    failed: `${stats.failed} sync failure(s)`,
    'no-network': 'No connection'
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      borderRadius: '4px',
      backgroundColor: `${statusColors[status]}20`,
      border: `1px solid ${statusColors[status]}`
    }}>
      <div
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: statusColors[status],
          animation: status === 'syncing' ? 'pulse 2s infinite' : 'none'
        }}
      />
      <span style={{ fontSize: '12px', color: statusColors[status] }}>
        {statusText[status]}
      </span>
      {stats.lastSyncTime && (
        <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: 'auto' }}>
          Last: {new Date(stats.lastSyncTime).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
};
```

**Integration in Home Page**:
```typescript
// File: desktop_application/src/renderer/src/pages/HomePage.tsx

import { SyncStatusIndicator } from '../components/SyncStatusIndicator';

export const HomePage: React.FC = () => {
  return (
    <div className="home-page">
      <SyncStatusIndicator />
      {/* ... rest of page ... */}
    </div>
  );
};
```

**Verification Tasks**:
- [ ] Create new file `SyncStatusIndicator.tsx`
- [ ] Add IPC listener for sync-status-update events
- [ ] Integrate into HomePage component
- [ ] Test with mock sync status data

### Step 1.5: Update Backend to Emit Sync Confirmation
**File**: `Backend/app/main.py`  
**Current Status**: `/readings/sync` endpoint exists, returns success

**Enhancement**: Return deduplication count so desktop knows what was new

**Code Pattern**:
```python
# File: Backend/app/main.py

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List
from datetime import datetime

class ReadingPayload(BaseModel):
    node_id: str
    timestamp: str
    temperature: float
    turbidity: float
    tds: float
    ph: float
    pond_type: str | None = None
    battery_pct: int
    rssi: int

class SyncRequest(BaseModel):
    readings: List[ReadingPayload]

class SyncResponse(BaseModel):
    success: bool
    message: str
    new_readings: int
    duplicate_readings: int
    failed_readings: int

@app.post("/readings/sync", response_model=SyncResponse)
def sync_readings(
    request: SyncRequest,
    session: Session = Depends(get_session),
    _: str = Depends(verify_token)
):
    """Idempotent sync endpoint for desktop app outbox"""
    
    new_count = 0
    duplicate_count = 0
    failed_count = 0
    
    for payload in request.readings:
        try:
            # Check if reading already exists (by node_id + timestamp)
            stmt = select(Reading).where(
                (Reading.node_id == payload.node_id) &
                (Reading.timestamp == payload.timestamp)
            )
            existing = session.exec(stmt).first()
            
            if existing:
                # This reading already in database
                duplicate_count += 1
                continue
            
            # Create new reading
            reading = Reading(
                node_id=payload.node_id,
                timestamp=payload.timestamp,
                temperature=payload.temperature,
                turbidity=payload.turbidity,
                tds=payload.tds,
                ph=payload.ph,
                pond_type=payload.pond_type,
                battery_pct=payload.battery_pct,
                rssi=payload.rssi,
                synced_at=datetime.utcnow().isoformat()
            )
            session.add(reading)
            new_count += 1
            
        except Exception as e:
            logger.error(f"Failed to sync reading from {payload.node_id}: {e}")
            failed_count += 1
    
    try:
        session.commit()
    except Exception as e:
        logger.error(f"Database commit failed: {e}")
        session.rollback()
        return SyncResponse(
            success=False,
            message=f"Failed to commit sync: {str(e)}",
            new_readings=0,
            duplicate_readings=0,
            failed_readings=len(request.readings)
        )
    
    return SyncResponse(
        success=True,
        message=f"Synced {new_count} new readings",
        new_readings=new_count,
        duplicate_readings=duplicate_count,
        failed_readings=failed_count
    )
```

**Verification Tasks**:
- [ ] Review current `/readings/sync` endpoint in `Backend/app/main.py`
- [ ] Update to return deduplication counts
- [ ] Test POST with sample readings

### Step 1.6: Integration Test Checklist

**Test Scenario**: Desktop → Backend → Mobile

**Preconditions**:
- [ ] Backend running on `http://localhost:8000`
- [ ] Desktop app running
- [ ] Mobile app running (or curl with token)

**Test Steps**:

1. **Create Reading on Desktop**
   - [ ] Open desktop app
   - [ ] Manually create a test reading (or wait for sensor data)
   - [ ] Verify reading appears in desktop database
   - [ ] Check SyncStatusIndicator shows "pending"

2. **Monitor Sync**
   - [ ] Wait 2-5 minutes (sync interval)
   - [ ] Check SyncStatusIndicator changes to "synced"
   - [ ] Verify backend database has the reading
   - [ ] Verify retry count is 0

3. **Verify Mobile Access**
   - [ ] Open mobile app
   - [ ] Navigate to Dashboard
   - [ ] Verify same reading appears on mobile
   - [ ] Verify data matches (timestamp, temp, turbidity, etc.)

4. **Test Duplicate Handling**
   - [ ] Create same reading again (same node_id + timestamp)
   - [ ] Sync
   - [ ] Verify backend sync response shows duplicate_count = 1
   - [ ] Verify desktop outbox entry marked as synced (not failed)

5. **Test Offline Scenario**
   - [ ] Stop backend
   - [ ] Create new reading on desktop
   - [ ] Verify outbox entry created with status = "pending"
   - [ ] Start backend
   - [ ] Verify sync eventually succeeds
   - [ ] Verify mobile sees the reading

6. **Test Retry Logic**
   - [ ] Break network (disconnect WiFi or stop backend)
   - [ ] Create reading
   - [ ] Let sync attempt a few times
   - [ ] Verify retry_count increments (check DB directly)
   - [ ] Restore network
   - [ ] Verify sync succeeds

**Success Criteria**:
- ✅ New desktop reading reaches backend within 5 minutes
- ✅ Backend removes duplicates
- ✅ Mobile app sees the reading immediately via `/readings/latest`
- ✅ No data loss on offline→online transitions
- ✅ Retry logic handles transient failures

---

## PHASE 2: Alerts Sync (Days 4-5)

**Goal**: Alerts created on desktop sync to backend and reach mobile

### Step 2.1: Add Alerts Table to Backend
**File**: `Backend/app/database.py`

```python
from sqlmodel import SQLModel, Field
from typing import Optional

class Alert(SQLModel, table=True):
    """Alert events from desktop app"""
    id: Optional[int] = Field(default=None, primary_key=True)
    node_id: str = Field(index=True)
    timestamp: str = Field(index=True)
    parameter: str  # "temperature", "turbidity", "tds", "ph"
    severity: str   # "normal", "warning", "critical"
    message: str
    created_at: str
    synced_at: Optional[str] = None
```

**Verification Task**:
- [ ] Add to `database.py`
- [ ] Run migration: drop and recreate tables
- [ ] Verify table created in postgres

### Step 2.2: Create Alerts Sync Endpoint
**File**: `Backend/app/main.py`

```python
class AlertPayload(BaseModel):
    node_id: str
    timestamp: str
    parameter: str
    severity: str
    message: str

@app.post("/alerts/sync")
def sync_alerts(
    request: List[AlertPayload],
    session: Session = Depends(get_session),
    _: str = Depends(verify_token)
):
    """Sync alerts from desktop app"""
    new_count = 0
    
    for payload in request:
        existing = session.exec(
            select(Alert).where(
                (Alert.node_id == payload.node_id) &
                (Alert.timestamp == payload.timestamp)
            )
        ).first()
        
        if not existing:
            alert = Alert(
                node_id=payload.node_id,
                timestamp=payload.timestamp,
                parameter=payload.parameter,
                severity=payload.severity,
                message=payload.message,
                created_at=datetime.utcnow().isoformat(),
                synced_at=datetime.utcnow().isoformat()
            )
            session.add(alert)
            new_count += 1
    
    session.commit()
    return {"success": True, "synced": new_count}
```

**Verification Task**:
- [ ] Add endpoint to `main.py`
- [ ] Test with curl

### Step 2.3: Create Alerts Outbox in Desktop
**File**: `desktop_application/src/main/db.ts`

```typescript
// Add alert_outbox table schema
export function initializeDatabase() {
  db.exec(`
    ... existing tables ...
    
    CREATE TABLE IF NOT EXISTS alert_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (alert_id) REFERENCES alerts(id)
    );
  `);
}

// Insert alert and queue for sync
export function insertAlert(alert: Alert): number {
  const stmt = db.prepare(`
    INSERT INTO alerts (node_id, timestamp, parameter, severity, message)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    alert.node_id,
    alert.timestamp,
    alert.parameter,
    alert.severity,
    alert.message
  );
  
  const alertId = result.lastInsertRowid as number;
  
  // Queue for sync
  const outboxStmt = db.prepare(`
    INSERT INTO alert_outbox (alert_id, payload_json, status, created_at)
    VALUES (?, ?, 'pending', ?)
  `);
  
  outboxStmt.run(
    alertId,
    JSON.stringify(alert),
    new Date().toISOString()
  );
  
  return alertId;
}
```

**Verification Task**:
- [ ] Add table schema
- [ ] Add insertAlert function
- [ ] Update decision engine to call insertAlert

### Step 2.4: Add Alerts to Sync Loop
**File**: `desktop_application/src/main/sync.ts`

```typescript
export async function syncOutbox(): Promise<void> {
  // ... existing readings sync ...
  
  // Also sync alerts
  try {
    const pendingAlerts = db.prepare(`
      SELECT id, alert_id, payload_json, status, retry_count, created_at
      FROM alert_outbox
      WHERE status = 'pending' AND retry_count < ?
      ORDER BY created_at ASC
      LIMIT 50
    `).all(MAX_RETRIES) as AlertOutboxEntry[];

    if (pendingAlerts.length > 0) {
      const alerts = pendingAlerts.map(e => JSON.parse(e.payload_json));
      
      await axios.post(`${BACKEND_URL}/alerts/sync`, alerts, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        timeout: 10000
      });

      const ids = pendingAlerts.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      
      db.prepare(`
        UPDATE alert_outbox
        SET status = 'synced'
        WHERE id IN (${placeholders})
      `).run(...ids);

      console.log(`[sync] ✅ Synced ${pendingAlerts.length} alerts`);
    }
  } catch (err) {
    console.error('[sync] Alert sync failed:', err);
    // Increment retry count
  }
}
```

**Verification Task**:
- [ ] Add alerts sync to existing syncOutbox function
- [ ] Test with manual alert creation

### Step 2.5: Add Alerts Endpoint to Mobile
**File**: `mobile_application/src/services/authService.ts` or new `alertService.ts`

```typescript
export async function fetchLatestAlerts(
  limit: number = 20
): Promise<Alert[]> {
  const response = await axios.get(
    `${API_BASE_URL}/alerts/latest?limit=${limit}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  return response.data;
}
```

**Verification Task**:
- [ ] Add backend endpoint `/alerts/latest`
- [ ] Add mobile fetch function
- [ ] Display in AlertsScreen

---

## PHASE 3: pH Integration (Days 6-8)

### Step 3.1: Validate pH in Fish Health Index
**File**: `desktop_application/decision-engine/fish_health_index.py`

- [ ] Review current profiles in fish_health_index.py
- [ ] Verify pH thresholds are present for all species
- [ ] Coordinate with Member 4 on calibration

### Step 3.2: Update Mobile UI for pH Display
**File**: `mobile_application/src/components/`

- [ ] Add pH gauge component
- [ ] Add pH to historical charts
- [ ] Display pH in reading details

---

## PHASE 4: Documentation (Days 9-10)

- [ ] Finalize all README updates (already done)
- [ ] Create ARCHITECTURE.md with deployment guides
- [ ] Update deployment checklists

---

## Verification Checklist

### Code Quality
- [ ] All TypeScript compiles without errors
- [ ] All Python passes linting
- [ ] No hardcoded secrets in commits
- [ ] Proper error handling in all new functions

### Testing
- [ ] Unit tests pass (if existing)
- [ ] Integration test scenarios complete
- [ ] Offline/online transitions work
- [ ] Retry logic handles failures

### Performance
- [ ] Sync doesn't block UI (runs in background)
- [ ] Database queries are indexed
- [ ] No memory leaks in sync loop
- [ ] Mobile network usage is minimal

### Security
- [ ] Auth tokens not logged
- [ ] Sensitive data not stored in outbox
- [ ] HTTPS enforced in production
- [ ] CORS properly configured

---

## Success Metrics

| Metric | Target | Verification |
|--------|--------|---|
| E2E sync time | < 5 min | Check desktop → backend → mobile flow |
| Data integrity | 0 duplicates | Verify /sync idempotency |
| Offline resilience | Works indefinitely | Test offline mode for 1+ hours |
| Error recovery | Auto-retry works | Simulate network failure |
| Mobile responsiveness | < 2 sec load | Check mobile /readings/latest |

---

## Troubleshooting Guide

### Issue: Desktop sync shows "pending" forever
**Diagnostics**:
- [ ] Check auth token in localStorage
- [ ] Verify backend is running
- [ ] Check desktop → backend network connectivity
- [ ] Review backend logs for errors
- [ ] Check outbox table in SQLite

**Fix**:
- [ ] Restart desktop app
- [ ] Login again to refresh token
- [ ] Restart backend

### Issue: Mobile doesn't show latest readings
**Diagnostics**:
- [ ] Check mobile is logged in
- [ ] Verify backend has readings (curl /readings/latest)
- [ ] Check mobile network connectivity
- [ ] Review mobile app logs

**Fix**:
- [ ] Pull to refresh on mobile
- [ ] Restart mobile app
- [ ] Logout and login again

### Issue: Backend sync returns "failed"
**Diagnostics**:
- [ ] Check payload format matches schema
- [ ] Verify pH field is present for all readings
- [ ] Check PostgreSQL logs
- [ ] Verify batch size (max 50?)

**Fix**:
- [ ] Reduce batch size in desktop sync
- [ ] Verify all required fields present
- [ ] Check PostgreSQL connection

---

**Next**: Review this roadmap and proceed with Step 1.1 verification.
