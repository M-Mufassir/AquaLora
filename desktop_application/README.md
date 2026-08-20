# AquaLoRa Dashboard

Desktop dashboard application for **AquaLoRa** — a LoRa-based, solar-powered IoT system for real-time water quality monitoring and early-warning protection of fish and prawn ponds.

This README covers (1) how this dashboard fits into the full AquaLoRa system, (2) this repo's own architecture, (3) what's been built so far and how to run it, and (4) what's left before this can go live on real hardware.

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
├── main/              Node.js backend — the only part allowed to touch the
│                      filesystem or network. Owns:
│                        - masterNodeClient.ts   WebSocket client to the Master Node
│                        - db.ts                 SQLite database (better-sqlite3)
│                        - decisionEngine.ts      spawns the Python scorer, stdin/stdout
│                        - index.ts               window, all ipcMain handlers
│
├── preload/           Security bridge — exposes only specific, safe
│                      functions from main to renderer (never the raw
│                      Node.js APIs) via window.api
│
├── shared/            types.ts — the data contract types, plus pure helpers
│                      (deriveStatusTier, deriveParamStatus) shared by main
│                      and renderer so both sides agree on one definition
│
└── renderer/src/       React + TypeScript UI. Never touches the network or
    ├── pages/           filesystem directly — only receives data pushed
    │   HomePage, LogsPage, SettingsPage    from main over IPC.
    ├── components/
    │   Gauge, NodeStatusBar, AlertList, HistoryPanel, LoginScreen,
    │   ThemeToggle, CriticalAlertOverlay, NodeList, NodeSummaryCard,
    │   AddNodeModal
    ├── store/            useReadingsStore.ts — Zustand, multi-node state
    └── hooks/            useAlertSound.ts — Web Audio critical-alert beep

decision-engine/
└── fish_health_index.py   Fish Health Index scorer (Member 4's subsystem —
                            see § 6, thresholds here are provisional)
```

**Why this separation matters:** the renderer is effectively a sandboxed browser page. If it could reach the filesystem or network directly, a compromised UI dependency could read/write anything on the machine. Routing everything through `main` and a narrow `preload` bridge is standard Electron security practice, not extra caution.

### App structure (as built)

Three pages behind a login screen, navigated with `react-router-dom` (`HashRouter`):

- **Home** — fleet-wide KPI row (Good/Warning/Critical/Offline counts), a card per node with live mini-gauges, and a recent-alerts feed across all nodes.
- **Logs** — a node list on the left; the right pane shows the selected node's live gauges stacked above its history graphs (no tab-switching), plus alerts and an "+ Add Node" flow.
- **Settings** — light/dark theme toggle, Critical-alert sound on/off, and user management (add/delete/change password), gated to the `admin` role.

A full-screen takeover + generated alarm tone fires for any unacknowledged **Critical** alert, from any page, until acknowledged.

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
users     (id, username, password_hash, role)   -- role: 'admin' | 'operator'
settings  (key, value)                          -- theme, sound_enabled
```

One SQLite file (`app.getPath('userData')/aqualora.db`) is the whole system of record — nodes, readings, alerts, users, and settings all live in it. `nodes` rows are created two ways: automatically the first time a reading with a new `node_id` arrives, or manually via the "+ Add Node" button (which just needs a `node_id` matching what the physical Slave Node will send, plus a friendly name/location).

---

## 3. Implementation Phases — Build Order

Everything through Phase 8 is **done** — the dashboard is fully built and running against the mock Master Node. Phases 9–10 are **blocked on hardware** (see § 6 for the full remaining-work list).

### Phase 0 — Prerequisites

- [x] Install Node.js (LTS) and a code editor
- [x] Get sign-off from Member 2 on the JSON data contract above
- [ ] Confirm target species for the demo (fish vs. prawns) — still open; see § 6, it affects the decision-engine's ideal ranges

### ✅ Phase 1 — Environment & Scaffold

Electron + React + TypeScript via `electron-vite`, `better-sqlite3` + `recharts` + `zustand` + `ws` + `bcryptjs` + `react-router-dom` for state, charts, the Master Node link, auth, and routing.

### ✅ Phase 2 — Mock Server & Live Connection

`mock_master_node.js` simulates the Master Node relaying **4 Slave Nodes** (not just one) over a single WebSocket, each with a distinct, statistically-tuned health profile — one consistently healthy, one borderline, one that regularly goes Critical — so every status tier is demonstrable without touching real hardware. `main/masterNodeClient.ts` connects, auto-reconnects on drop, and reports connection state to the UI.

### ✅ Phase 3 — Database Layer

Full schema above, all in one SQLite file. Readings, nodes, alerts, users, and settings all persist across restarts.

### ✅ Phase 4 — Live Dashboard UI

Went beyond a single gauge screen: a full **Home** page (fleet KPIs + per-node cards with mini-gauges) and a **Logs** page (node list → live gauges + history for the selected node), built on a shared Zustand store keyed by `node_id` so any number of nodes work, not just one.

### ✅ Phase 5 — Historical Data & Graphs

Recharts line graphs per parameter with 1h/24h/7d/All range presets, and CSV export via a native save dialog.

### ✅ Phase 6 — Alerts & Decision Engine Integration

`decision-engine/fish_health_index.py` is spawned once and scores every reading over stdin/stdout (line-delimited JSON). Warning/Critical alerts are written to `alerts` and pushed live. **Critical** additionally triggers a full-screen takeover with a generated alarm tone (Web Audio, no bundled asset), toggleable in Settings.

### ✅ Phase 7 — Remote Configuration (downlink)

Sampling-interval control in the UI sends `set_interval` over the same WebSocket link; the mock server logs whatever it receives, same channel the real Master Node would use.

### ✅ Phase 8 — Polish

- [x] Login — bcrypt-hashed passwords, `admin`/`operator` roles, default admin auto-created on first run
- [x] Node offline detection — 30s sweep, 5 min staleness threshold
- [x] Connection error states — visible "Disconnected — retrying…" banner, DB writes wrapped so a failure can't crash the app
- [x] *(added beyond the original plan)* Light/dark theme, multi-page nav (Home/Logs/Settings), multi-node support, user management UI, logout

### ⏳ Phase 9 — Swap to Real Hardware (blocked on hardware)

Change `MASTER_NODE_URL` in `src/main/masterNodeClient.ts` from the mock server's address to the real Master Node's LAN IP. If the data contract held, no other code changes are needed.
**Done when:** real sensor data from a physical Slave Node appears in the dashboard.

### ⏳ Phase 10 — Integration Testing & Validation (blocked on hardware)

Staged integration order from the proposal: Slave+Master LoRa link (Members 1/2) → Master+Dashboard (confirm real data flows correctly) → Dashboard+Decision Engine (confirm scoring holds up on real sensor noise, not just clean mock data).

---

## 4. Setup & Run

**Prerequisites:** Node.js LTS, and Python 3 on `PATH` (as `python` or `python3` — needed for the decision engine; the dashboard still runs and persists data without it, just without Fish Health Index scoring/alerts).

```bash
cd desktop_application
npm install
```

Then, in **two separate terminals**:

```bash
# Terminal 1 — mock Master Node (simulates 4 nodes; dev/demo only, not needed with real hardware)
npm run mock:master   # same as: node mock_master_node.js

# Terminal 2 — the dashboard itself
npm run dev
```

Order doesn't matter — `masterNodeClient` auto-reconnects every 3s, so it's fine to start the dashboard first.

**First run:** since the `users` table starts empty, the app auto-creates a default `admin` account and logs the generated password to the **Terminal 2** console once (`[auth] no users found — created default account...`). Log in with that, then change it from Settings → Users → Change password.

**Other useful commands** (from `desktop_application/`):

```bash
npm run typecheck   # main + renderer, no emit
npm run build        # electron-vite production build (out/main, out/preload, out/renderer)
npm run build:win    # the above, then electron-builder — produces a distributable installer
```

The SQLite file lives at `%APPDATA%/aqualora-dashboard/aqualora.db` (Windows) — delete it to reset the app to a fresh first-run state.

To point at real hardware instead of the mock server, see Phase 9 above.

---

## 6. What's Left — Next Steps After Hardware Arrives

The dashboard side is functionally complete against the mock server. What's actually blocking a full end-to-end demo is hardware, plus a handful of follow-ups:

**Blocked on Members 1/2's hardware:**

- [ ] **Phase 9** — point `MASTER_NODE_URL` at the real Master Node once its firmware is flashed and on the same LAN.
- [ ] **Phase 10** — staged integration testing: LoRa link first, then Master+Dashboard, then Dashboard+Decision Engine on *real* sensor noise (mock data is clean by comparison — expect to find edge cases: dropped packets, out-of-order readings, sensor glitches the mock never produces).

**Needs a team decision, not hardware:**

- [ ] **Confirm target species** (Phase 0 was never checked off) — fish vs. prawns changes the ideal temperature/turbidity/TDS ranges, which feeds directly into the next item.
- [ ] **Calibrate the Fish Health Index thresholds.** The ranges in `decision-engine/fish_health_index.py` (`IDEAL_RANGES`, `STATUS_THRESHOLDS`) are **provisional** — tuned only so the mock data demonstrates all three status tiers, not sourced from aquaculture research. This is Member 4's subsystem; review and replace these constants once real target ranges are settled.
- [ ] **Decide on operator vs. admin permissions.** Right now the only role check anywhere is Settings → Users (admin-only). Every other action — acknowledging alerts, adding nodes, changing the sampling interval — is open to both roles identically. If the team wants a real split (e.g. operators can view/acknowledge but not reconfigure), that's a small change (a few more role checks) but needs someone to define what each role should and shouldn't do.
- [ ] **LoRa uplink/downlink has no encryption or authentication** (a known limitation carried from the root project README) — a pre-shared-key/checksum scheme is scoped as future work, owned by Members 1/2's firmware side, not this dashboard.

**Polish, not blocking:**

- [ ] Production packaging (`npm run build:win`) hasn't been run end-to-end to produce a real installer — worth doing at least once before a demo/handoff.
- [ ] App window size/position and last-viewed node aren't remembered between launches (always opens maximized, always starts on Home).
- [ ] The Critical-alert sound is a generated two-tone beep (Web Audio, no bundled file) — fine as-is, but swap-able for a custom sound if the team wants one.
- [ ] There's a leftover `operator` test account in the dev database from earlier UI testing with an unknown password — delete it (or reset its password) via Settings before demoing, or just start from a fresh DB (see § 4).

---

## 7. Related Documents

- `AquaLoRa_Design_Project_Proposal.docx` — full requirements, architecture justification, engineering calculations
- `AquaLoRa_Master_Research_Document.pdf` — literature review, historical context, defense Q&A prep
- `AquaLoRa_How_It_Works_And_Implementation_Guide.docx` — plain-language system walkthrough
