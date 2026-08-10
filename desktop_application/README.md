# AquaLoRa Dashboard

Desktop dashboard application for **AquaLoRa** — a LoRa-based, solar-powered IoT system for real-time water quality monitoring and early-warning protection of fish and prawn ponds.

This README covers (1) how this dashboard fits into the full AquaLoRa system, (2) this repo's own architecture, and (3) the exact phase-by-phase order to build it from scratch.

---

## 1. Full System Architecture

AquaLoRa has four subsystems built by four team members. This repository is the **Dashboard & Database** subsystem only — understanding the other three is necessary context, not something you need to build.

```
┌─────────────────┐   LoRa    ┌──────────────────┐   WiFi    ┌───────────────────┐
│   Slave Node     │  433MHz   │   Master Node     │ WebSocket │   THIS REPO:       │
│   (Pond side)    │──────────▶│   (Office gateway)│──────────▶│   Dashboard + DB   │
│                  │◀──────────│                   │◀──────────│                   │
│ ESP32 + sensors  │  downlink │ ESP32 + LoRa RX/TX│  downlink │ Electron + React  │
│ + solar/battery  │           │ + OLED + WiFi     │           │ + SQLite          │
└─────────────────┘           └──────────────────┘           └─────────┬─────────┘
                                                                          │
                                                                          ▼
                                                                ┌───────────────────┐
                                                                │  Decision Engine   │
                                                                │  (Python, separate │
                                                                │  process)          │
                                                                │  Fish Health Index │
                                                                └───────────────────┘
```

**Uplink (sensor data flowing in):** Slave Node samples temperature/turbidity/TDS → transmits over LoRa → Master Node receives, buffers, forwards over WiFi → this dashboard stores it in SQLite (the permanent record) → passes the reading to the Decision Engine → gets back a Fish Health Index score and status.

**Downlink (commands flowing out):** User changes the sampling interval in this dashboard → queued at the Master Node → relayed over LoRa to the Slave Node during its next post-transmission listen window.

**The core architectural decision this repo implements:** unlike comparable systems (which treat a cloud platform like Firebase/ThingSpeak as the only copy of data), this dashboard's local SQLite database is the **permanent system of record**. Cloud sync, if ever added, is optional and secondary — the system works fully offline by design.

---

## 2. This Repository's Architecture

Electron apps split into two isolated processes that only talk through a controlled bridge:

```
src/
├── main/            Node.js backend — the only part allowed to touch the
│                    filesystem or network. Owns:
│                      - WebSocket client to the Master Node
│                      - SQLite database (better-sqlite3)
│                      - IPC channels to the renderer
│
├── preload/         Security bridge — exposes only specific, safe
│                    functions from main to renderer (never the raw
│                    Node.js APIs)
│
└── renderer/         React + TypeScript UI — gauges, graphs, alerts.
                       Never touches the network or filesystem directly;
                       only receives data pushed from main.
```

**Why this separation matters:** the renderer is effectively a sandboxed browser page. If it could reach the filesystem or network directly, a compromised UI dependency could read/write anything on the machine. Routing everything through `main` and a narrow `preload` bridge is standard Electron security practice, not extra caution.

### Data contract (agreed with the LoRa/firmware team)

```json
{
  "node_id": "slave-01",
  "timestamp": "2026-08-10T14:32:00Z",
  "temperature": 28.5,
  "turbidity": 35.2,
  "tds": 220,
  "battery_pct": 87,
  "rssi": -62
}
```

This shape is fixed by agreement with Member 2 (LoRa/firmware) — do not change field names or units without re-syncing with them, since firmware sends exactly this shape.

### Database schema

```sql
nodes     (id, name, location, last_seen, battery_pct, lora_rssi, status)
readings  (id, node_id, timestamp, temperature, turbidity, tds)
alerts    (id, node_id, timestamp, parameter, severity, message, acknowledged)
users     (id, username, password_hash, role)        -- optional login feature
```

---

## 3. Implementation Phases — Build Order From Scratch

Each phase produces something runnable before moving to the next. Don't skip ahead — later phases assume earlier ones work.

### Phase 0 — Prerequisites (before writing any code)

- [ ] Confirm target species for the demo (fish vs. prawns — changes ideal TDS/turbidity ranges)
- [ ] Get sign-off from Member 2 on the JSON data contract above
- [ ] Install Node.js (LTS) and a code editor

### Phase 1 — Environment & Scaffold

```bash
npm create electron-vite@latest aqualora-dashboard -- --template react-ts
cd aqualora-dashboard
npm install
npm install better-sqlite3 recharts zustand ws
npm install -D @types/better-sqlite3
```

**Done when:** `npm run dev` opens a blank Electron window with hot-reload working.

### Phase 2 — Mock Server & Live Connection

Run a fake Master Node (`mock_master_node.js`) that sends fabricated readings over WebSocket on a short interval, so development doesn't wait on hardware. Wire up `main/masterNodeClient.ts` to connect to it and log incoming readings to the console.
**Done when:** the Electron app's console shows readings arriving every ~10 seconds from the mock server.

### Phase 3 — Database Layer

Create the SQLite schema (above) in `main`. On each incoming reading, insert it into `readings`. Add a simple query function to fetch the last N readings.
**Done when:** you can close and reopen the app and see previously received readings still in the database file.

### Phase 4 — Live Dashboard UI

Build the React components for live display: current temperature/turbidity/TDS gauges, node status (battery %, RSSI), using IPC to receive pushes from `main`.
**Done when:** the gauges update in real time as the mock server sends new data, with zero manual refresh.

### Phase 5 — Historical Data & Graphs

Add a query for date-ranged historical readings, and a Recharts line graph per parameter. Add the CSV export button.
**Done when:** you can view a trend graph over the readings accumulated so far and export it to a CSV file.

### Phase 6 — Alerts & Decision Engine Integration

Stand up the Python decision engine as a separate process. On each new reading, `main` sends it to the engine (via child process stdin/stdout or a local socket) and receives back a Fish Health Index score + status. If status is Warning/Critical, write a row to `alerts` and surface it in the UI.
**Done when:** artificially sending a bad reading through the mock server triggers a visible alert in the UI.

### Phase 7 — Remote Configuration (downlink)

Add a UI control to change the sampling interval, send it as a `set_interval` command over the WebSocket, and confirm the mock server logs receiving it.
**Done when:** changing the interval in the UI produces a logged command on the mock server side.

### Phase 8 — Polish

- [ ] Optional login (bcrypt password hashing)
- [ ] Node offline detection (no reading received in N minutes → status change)
- [ ] Error states for DB/connection failures

### Phase 9 — Swap to Real Hardware

Once Member 2's firmware is flashed and running, change one constant — `MASTER_NODE_URL` — from the mock server's address to the real Master Node's LAN IP. If the contract from Phase 0 held, no other code changes are needed.
**Done when:** real sensor data from the physical Slave Node appears in the dashboard.

### Phase 10 — Integration Testing & Validation

Follow the staged integration order from the proposal: Slave+Master LoRa link (Member 1/2's job) → Master+Dashboard (this repo, confirm real data flows correctly) → Dashboard+Decision Engine (confirm scoring works on real sensor noise, not just clean mock data).

---

## 4. Setup & Run

```bash
# Install dependencies
npm install

# Terminal 1: start the mock Master Node (development only)
node mock_master_node.js

# Terminal 2: start the dashboard
npm run dev
```

To point at real hardware instead of the mock server, edit `MASTER_NODE_URL` in `src/main/masterNodeClient.ts`.

---

## 5. Related Documents

- `AquaLoRa_Design_Project_Proposal.docx` — full requirements, architecture justification, engineering calculations
- `AquaLoRa_Master_Research_Document.pdf` — literature review, historical context, defense Q&A prep
- `AquaLoRa_How_It_Works_And_Implementation_Guide.docx` — plain-language system walkthrough
