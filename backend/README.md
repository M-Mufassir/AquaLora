# AquaLoRa Multi-Tenant Backend

This folder contains the multi-tenant cloud API for the AquaLoRa aquaculture telemetry system. It is built with **FastAPI**, **SQLModel**, **PostgreSQL** (and SQLite for testing), and provides strict per-tenant data isolation based on physical Master Node identities.

---

## 1. Multi-Tenant Architecture

```
Desktop Workstations (Electron + SQLite)
  ├─ One-time Workstation Activation (via safeStorage token)
  ├─ Local operator sessions (offline-first)
  └─ POST /readings/sync & /alerts/sync ──┐
                                         │
Mobile Applications (React Native)       ├──→ Backend API (FastAPI + PostgreSQL)
  ├─ Dynamic Master Node Picker (directory)   ├─ GET  /master-nodes/directory (public)
  ├─ Authenticated by Node Code + Password   ├─ POST /auth/login (JWT with tenant claims)
  ├─ Facility Profile Viewer & Editor         ├─ GET/PATCH /master-nodes/me (tenant profile)
  └─ Remote Real-Time Telemetry Reads ───────┤─ POST /auth/change-password
                                             ├─ POST /master-nodes (super-admin only)
                                             ├─ GET  /readings/latest & /history (scoped)
                                             └─ GET  /alerts/latest & /history (scoped)
```

---

## 2. API Endpoints

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/health` | `GET` | None | API health check (`{"status": "ok"}`) |
| `/master-nodes/directory` | `GET` | None | Public directory of active Master Nodes (`[{node_code, display_name}]`) for client login dropdowns |
| `/auth/login` | `POST` | None | Authenticate with `{node_code, password}`. Returns JWT carrying `master_node_id`, `node_code`, and `role` |
| `/master-nodes/me` | `GET` | Bearer Token | Fetch profile details for the authenticated Master Node |
| `/master-nodes/me` | `PATCH` | Bearer Token | Update editable profile fields (display name, contact person, phone, site location, pond species) |
| `/auth/change-password` | `POST` | Bearer Token | Change Master Node password (verifies current password) |
| `/master-nodes` | `POST` | Super Admin | Provision a new Master Node record (super-admin only) |
| `/readings/sync` | `POST` | Bearer Token | Batch sync readings from desktop. Automatically stamps `master_node_id` from token |
| `/readings/latest` | `GET` | Bearer Token | Fetch latest readings per sensor node scoped strictly to caller's `master_node_id` |
| `/readings/history` | `GET` | Bearer Token | Fetch time-windowed readings scoped strictly to caller's `master_node_id` |
| `/alerts/sync` | `POST` | Bearer Token | Batch sync alerts from desktop. Automatically stamps `master_node_id` from token |
| `/alerts/latest` | `GET` | Bearer Token | Fetch latest alerts scoped strictly to caller's `master_node_id` |
| `/alerts/history` | `GET` | Bearer Token | Fetch filtered alert history scoped strictly to caller's `master_node_id` |

---

## 3. Database Schema

### `masternode`
- `id` (PK, Integer)
- `node_code` (Unique, Indexed, e.g. `AQL-0001`)
- `display_name` (Text, e.g. `Green Valley Prawn Farm - Pond 1`)
- `password_hash` (Bcrypt hash)
- `contact_name` (Text, optional)
- `contact_phone` (Text, optional)
- `site_location` (Text, optional)
- `pond_type` (Text, optional)
- `installed_at` (ISO timestamp, optional)
- `role` (`customer` | `super_admin`)
- `status` (`active` | `suspended`)
- `created_at` / `updated_at` (ISO timestamps)

### `reading`
- `id` (PK, Integer)
- `master_node_id` (FK → `masternode.id`, Indexed)
- `node_id` (Text, Sensor node identifier)
- `timestamp` (ISO timestamp)
- `temperature`, `turbidity`, `tds`, `ph`, `pond_type`, `battery_pct`, `rssi`, `created_at`

### `alert`
- `id` (PK, Integer)
- `master_node_id` (FK → `masternode.id`, Indexed)
- `node_id` (Text, Sensor node identifier)
- `timestamp` (ISO timestamp)
- `parameter`, `severity`, `message`, `created_at`, `synced_at`

---

## 4. Local Development & Testing

1. **Activate virtual environment**:
   ```bash
   .\.venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r Backend/requirements.txt
   ```

3. **Run database migration / bootstrap**:
   ```bash
   python Backend/scripts/migrate_multitenant.py
   ```

4. **Run automated test suite**:
   ```bash
   pytest Backend/tests/test_multitenant_auth.py -v
   ```

5. **Start development server**:
   ```bash
   uvicorn Backend.app.main:app --reload --host 0.0.0.0 --port 8000
   ```
