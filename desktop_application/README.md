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
<<<<<<< HEAD
├── main/            Node.js backend — the only part allowed to touch the
│   │                filesystem or network.
│   ├── masterNodeClient.ts      WebSocket client to the Master Node,
│   │                              writes readings to SQLite
│   └── decisionEngineClient.ts   Spawns and talks to the Python decision
│                                   engine (see Phase 6)
=======
├── main/              Node.js backend — the only part allowed to touch the
│                      filesystem or network. Owns:
│                        - masterNodeClient.ts   WebSocket client to the Master Node
│                        - wifiManager.ts        OS-level WiFi scan/join (node-wifi)
│                        - db.ts                 SQLite database (better-sqlite3)
│                        - decisionEngine.ts      spawns the Python scorer, stdin/stdout
│                        - index.ts               window, all ipcMain handlers
>>>>>>> df5cca1f21ece9976e42abae21e7a6d0f4427081
│
├── preload/           Security bridge — exposes only specific, safe
│                      functions from main to renderer (never the raw
│                      Node.js APIs) via window.api
│
<<<<<<< HEAD
└── renderer/         React + TypeScript UI — gauges, graphs, alerts.
                       Never touches the network or filesystem directly;
                       only receives data pushed from main.

decision-engine/
└── decision_engine.py   Fish Health Index scoring — persistent process,
                           reads readings from stdin, writes scores to
                           stdout (see Phase 6 for the pending formula note)
=======
├── shared/            types.ts — the data contract types, plus pure helpers
│                      (deriveStatusTier, deriveParamStatus) shared by main
│                      and renderer so both sides agree on one definition
│
└── renderer/src/       React + TypeScript UI. Never touches the network or
    ├── pages/           filesystem directly — only receives data pushed
    │   HomePage, LogsPage, SettingsPage, ConnectDevicePage   from main over IPC.
    ├── components/
    │   Gauge, NodeStatusBar, AlertList, HistoryPanel, LoginScreen,
    │   ThemeToggle, CriticalAlertOverlay, NodeList, NodeSummaryCard
    ├── store/            useReadingsStore.ts — Zustand, multi-node state
    └── hooks/            useAlertSound.ts — Web Audio critical-alert beep

decision-engine/
└── fish_health_index.py   Fish Health Index scorer (Member 4's subsystem —
                            see § 6, thresholds here are provisional)
>>>>>>> df5cca1f21ece9976e42abae21e7a6d0f4427081
```

The Master Node firmware itself — including the dummy/testing sketch used to validate the pairing flow below — lives one level up, outside this subsystem, at `../firmware_design/master_node/` (see the root `README.md`'s Repository Structure). This repo (`desktop_application/`) only ever talks to it over WiFi/WebSocket; it never touches or builds the firmware.

**Why this separation matters:** the renderer is effectively a sandboxed browser page. If it could reach the filesystem or network directly, a compromised UI dependency could read/write anything on the machine. Routing everything through `main` and a narrow `preload` bridge is standard Electron security practice, not extra caution.

### App structure (as built)

Three pages behind a login screen, navigated with `react-router-dom` (`HashRouter`):

- **Home** — fleet-wide KPI row (Good/Warning/Critical/Offline counts), a card per node with live mini-gauges, and a recent-alerts feed across all nodes.
- **Logs** — a node list on the left; the right pane shows the selected node's live gauges stacked above its history graphs (no tab-switching), plus alerts.
- **Settings** — light/dark theme toggle, Critical-alert sound on/off, Device Connection (re-open the pairing wizard), and user management (add/delete/change password), gated to the `admin` role.
- **Connect Device** (`/connect`) — the WiFi pairing wizard described below. A freshly logged-in user with zero paired nodes lands here automatically instead of an empty Home page.

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

One SQLite file (`app.getPath('userData')/aqualora.db`) is the whole system of record — nodes, readings, alerts, users, and settings all live in it. `nodes` rows are created automatically, two ways: the moment the Master Node reports its node list right after the dashboard connects (a `{"type":"node_list", ...}` WebSocket message — see § "Real MCU pairing" below), and/or the first time a reading with a new `node_id` arrives. There's no manual "add node" step — the physical Slave Node's `node_id` is whatever the firmware sends, discovered automatically, never typed in by hand.

### Real MCU pairing

Unlike a typical Master Node setup where the dashboard machine and the Master Node just happen to share a LAN, this Master Node broadcasts **its own WiFi access point** — the dashboard has to join it directly, like pairing any smart-home device. The desktop app drives that join itself rather than asking the user to leave the app:

1. **Settings → Device Connection**, or automatically on first run with zero paired nodes → `/connect`.
2. **Enable WiFi & Scan** — `wifiManager.ts` (wraps the `node-wifi` package, which drives `netsh` on Windows / `nmcli` on Linux / `airport` on macOS) lists nearby SSIDs; any containing "aqualora" is tagged `MCU`.
3. **Pick the network, enter its password, Connect** — `wifiManager.connectToNetwork()` joins it at the OS level.
4. **Auto-link** — once joined, the dashboard connects `masterNodeClient` to `ws://192.168.4.1:8081` (the fixed gateway address any ESP32 `WiFi.softAP()` hands out), encrypted (see below).
5. **Auto-detect nodes** — the Master Node sends an encrypted `{"type":"node_list","nodes":[{"node_id":"..."}]}` the instant the WebSocket connects; the wizard shows "N nodes detected" immediately, before any node's first periodic `Reading` even arrives.
6. The resolved URL (and the derived encryption key) is saved to `settings`, so restarts reconnect automatically without repeating the wizard.

**Windows permission caveat**: joining a *new* WiFi network via `netsh` can require elevated rights depending on machine policy — the wizard never hard-blocks on this. If the automatic join fails, it offers "Open Windows WiFi Settings" plus "I've connected manually — Continue," so the user can finish the OS-level join themselves and the wizard proceeds regardless.

**Encryption**: every message over the WebSocket link is AES-256-GCM encrypted (`src/main/secureChannel.ts`) — confidentiality plus tamper detection (a forged/altered message fails the auth tag and is dropped, not trusted). The key is derived (SHA-256) from the same WiFi password typed into step 3 above, so there's no separate secret to provision — the pairing password *is* the encryption secret. This applies to both directions: uplink readings/discovery and downlink commands (`set_interval`). Leaving the password field blank falls back to plain JSON, which only makes sense for the dev mock (below) — a real device should always be paired with its password.

**Testing without real hardware**: `mock_master_node.js` sends the same `node_list` message, and the wizard has a dev-only "Use local mock" shortcut that skips straight to linking against it. **Testing with real hardware but no LoRa Slave Nodes yet**: flash an ESP32 with `../firmware_design/master_node/AquaLoRa_MasterNode_Dummy/` — it creates the AP and streams dummy readings using this exact protocol, so the full pairing flow can be validated on real WiFi hardware before the LoRa side exists. See `../firmware_design/master_node/README.md`.

---

## 3. Implementation Phases — Build Order

Everything through Phase 9 is **done** — the dashboard is fully built, and the real-MCU WiFi pairing flow is validated against a dummy-firmware ESP32 (see `../firmware_design/master_node/`). Phase 10 is **blocked on hardware** (see § 6 for the full remaining-work list).

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

<<<<<<< HEAD
**Status: scaffolding done and tested; one formula pending team confirmation (see callout below).**

The decision engine runs as a **persistent Python child process**, spawned once when the app starts and kept alive for its whole lifetime — not relaunched per reading, which would add Python's startup cost to every single sensor update. Communication happens over stdin/stdout as line-delimited JSON: `main` writes one reading per line to the process's stdin, the process writes one result per line back to stdout.

**Files:**

- `decision-engine/decision_engine.py` — the scoring logic itself
- `src/main/decisionEngineClient.ts` — spawns the process, matches each request to its response, exposes `scoreReading()` to the rest of `main`

**Wire it in** alongside your existing reading-received handler:

```typescript
// on app startup, alongside connectToMasterNode()
startDecisionEngine();

// in your reading-received handler, after insertReading.run(reading)
const { score, status, recommendation } = await scoreReading(reading);
if (status !== "Normal") {
  insertAlert.run({
    node_id: reading.node_id,
    timestamp: reading.timestamp,
    severity: status,
    message: recommendation,
  });
  mainWindow.webContents.send("new-alert", { score, status, recommendation });
}
```

> **⚠️ Pending confirmation — `to_subscore()` in `decision_engine.py`:** the ideal ranges and the 0.5/0.3/0.2 weights are settled, but the exact curve used to convert an out-of-range reading into a 0–100 sub-score (currently a simple linear falloff) has not been confirmed against Pratheesa's intended design. **Do not treat the current numbers as final** — this is the one function in this phase that's still open, everything else (the process lifecycle, the stdin/stdout framing, the Node-side integration) is stable and tested.

**Before shipping — packaging note:** this assumes Python is installed on whoever runs the app. Before final distribution, bundle `decision_engine.py` with **PyInstaller** (`pyinstaller --onefile decision_engine.py`) into a standalone executable and spawn that instead of calling `python3` on a script — otherwise the app breaks on any machine without Python installed.

**Done when:** artificially sending a bad reading through the mock server triggers a visible alert in the UI, end to end.
=======
### ✅ Phase 7 — Remote Configuration (downlink)
>>>>>>> df5cca1f21ece9976e42abae21e7a6d0f4427081

Sampling-interval control in the UI sends `set_interval` over the same WebSocket link; the mock server logs whatever it receives, same channel the real Master Node would use.

### ✅ Phase 8 — Polish

- [x] Login — bcrypt-hashed passwords, `admin`/`operator` roles, default admin auto-created on first run
- [x] Node offline detection — 30s sweep, 5 min staleness threshold
- [x] Connection error states — visible "Disconnected — retrying…" banner, DB writes wrapped so a failure can't crash the app
- [x] *(added beyond the original plan)* Light/dark theme, multi-page nav (Home/Logs/Settings), multi-node support, user management UI, logout

### ✅ Phase 9 — Real MCU WiFi Pairing

Originally scoped as just swapping `MASTER_NODE_URL` for a LAN IP, on the assumption the Master Node would already share a network with the dashboard machine. The actual Master Node broadcasts its own WiFi AP instead, so this phase became the Connect Device wizard described in § "Real MCU pairing" above: OS-level WiFi scan/join (`wifiManager.ts`, `node-wifi`), dynamic `masterNodeClient` target instead of a hardcoded constant, and node auto-detection via a `node_list` discovery message. Validated against `../firmware_design/master_node/AquaLoRa_MasterNode_Dummy/` (a real ESP32 broadcasting its own AP + streaming dummy readings over the same protocol) since the LoRa/Slave Node side isn't built yet.
**Done when:** the wizard pairs with a real ESP32's AP and dummy sensor data flows into the dashboard live. *(Swapping the dummy firmware for the real Slave-Node-relaying Master Node firmware, once Members 1/2 finish it, needs no dashboard changes — same protocol/port.)*

### ⏳ Phase 10 — Integration Testing & Validation (blocked on hardware)

Staged integration order from the proposal: Slave+Master LoRa link (Members 1/2) → Master+Dashboard (the WiFi pairing + WebSocket link itself is now validated via the dummy firmware, above — what's left here is confirming it holds with the *real* Master Node firmware once it exists) → Dashboard+Decision Engine (confirm scoring holds up on real sensor noise, not just clean mock/dummy data).

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

Order doesn't matter. On a fresh install (or any install that's never been paired), the app does **not** auto-connect to anything — `nodes` starts empty and stays empty until you actually pair with a Master Node through the Connect Device wizard (Terminal 1's mock server sits there unconnected until you do). Once paired, `master_node_url` is saved and `masterNodeClient` auto-reconnects to it (every 3s on drop) on every subsequent launch, no need to repeat the wizard.

**First run:** since the `users` table starts empty, the app auto-creates a default `admin` account and logs the generated password to the **Terminal 2** console once (`[auth] no users found — created default account...`). Log in with that, then change it from Settings → Users → Change password. You'll land on the Connect Device wizard automatically, since there are no paired nodes yet — pick "Skip pairing — use local mock (dev only)" to link to Terminal 1's mock server and see live data flow in.

**To test the real WiFi pairing flow instead** (no LoRa Slave Node needed — just an ESP32): flash `../firmware_design/master_node/AquaLoRa_MasterNode_Dummy/` per its README, then use the wizard's normal WiFi scan/join path instead of the mock shortcut. See § "Real MCU pairing" above for the full flow and the Windows WiFi-permission caveat.

**Other useful commands** (from `desktop_application/`):

```bash
npm run typecheck   # main + renderer, no emit
npm run build        # electron-vite production build (out/main, out/preload, out/renderer)
npm run build:win    # the above, then electron-builder — produces a distributable installer
```

The SQLite file lives at `%APPDATA%/aqualora-dashboard/aqualora.db` (Windows) — delete it to reset the app to a fresh first-run state.

To pair with real hardware instead of the mock server, see § "Real MCU pairing" above.

---

## 6. What's Left — Next Steps After Hardware Arrives

The dashboard side, including the real-MCU WiFi pairing flow, is functionally complete and validated against a dummy-firmware ESP32. What's actually blocking a full end-to-end demo is the real LoRa/Slave Node hardware, plus a handful of follow-ups:

**Blocked on Members 1/2's hardware:**

- [ ] **Phase 10** — staged integration testing: LoRa link first, then confirm the real Master Node firmware works against the dashboard the same way the dummy firmware does, then Dashboard+Decision Engine on *real* sensor noise (mock/dummy data is clean by comparison — expect to find edge cases: dropped packets, out-of-order readings, sensor glitches neither ever produces).

**Needs a team decision, not hardware:**

- [ ] **Confirm target species** (Phase 0 was never checked off) — fish vs. prawns changes the ideal temperature/turbidity/TDS ranges, which feeds directly into the next item.
- [ ] **Calibrate the Fish Health Index thresholds.** The ranges in `decision-engine/fish_health_index.py` (`IDEAL_RANGES`, `STATUS_THRESHOLDS`) are **provisional** — tuned only so the mock data demonstrates all three status tiers, not sourced from aquaculture research. This is Member 4's subsystem; review and replace these constants once real target ranges are settled.
- [ ] **Decide on operator vs. admin permissions.** Right now the only role check anywhere is Settings → Users (admin-only). Every other action — acknowledging alerts, changing the sampling interval, pairing a device — is open to both roles identically. If the team wants a real split (e.g. operators can view/acknowledge but not reconfigure), that's a small change (a few more role checks) but needs someone to define what each role should and shouldn't do.
- [ ] **The LoRa link (Slave ↔ Master) still has no encryption or authentication** (a known limitation carried from the root project README, owned by Members 1/2's firmware). The WiFi hop (Master ↔ Dashboard) is now AES-256-GCM encrypted (see § "Real MCU pairing" above), so this gap is specifically the LoRa segment, not the whole pipeline anymore. A pre-shared-key/checksum scheme for LoRa is scoped as future work.
- [ ] The WiFi-link encryption key is derived from the AP password alone (SHA-256, no salt/PBKDF2 stretching) — adequate for a closed local AP with a reasonably strong password, but worth hardening (e.g. PBKDF2/HKDF with iteration count) before this pattern is reused anywhere with weaker password hygiene.

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
