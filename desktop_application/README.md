# AquaLoRa Dashboard

Desktop dashboard application for **AquaLoRa** — a LoRa-based, solar-powered IoT system for real-time water quality monitoring and early-warning protection of fish and prawn ponds.

This README covers (1) how this dashboard fits into the full AquaLoRa system, (2) this repo's own architecture, (3) what's been built so far and how to run it, (4) the exact wire protocol/encryption and node-detection techniques underneath the pairing flow, and (5) what's left before this can go live on real hardware.

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

### WiFi connectivity model — AP mode and external WiFi mode

The project now supports two operating modes for the ESP32 Master Node:

1. **AP mode (legacy / pairing-first mode)**
   - The ESP32 opens its own WiFi access point, e.g. `AquaLoRa-MasterNode`.
   - The dashboard joins the AP, then connects to `ws://192.168.4.1:8081`.
   - Best for direct pairing and validation on a bench or a small demo.

2. **External WiFi / station mode (production deployment mode)**
   - The ESP32 joins a local router or office WiFi network using configured credentials.
   - The dashboard no longer needs to be physically joined to the ESP32 AP.
   - The dashboard connects directly to the ESP32's LAN IP, e.g. `ws://192.168.1.50:8081`.
   - This is the model needed for real-world deployment and remote monitoring.

This means the dashboard pairing flow now supports both patterns: either (a) connect to the node AP during setup, or (b) connect directly to the ESP32 IP on the external network after it has joined the router.

---

## 2. This Repository's Architecture

Electron apps split into two isolated processes that only talk through a controlled bridge:

```
src/
├── main/              Node.js backend — the only part allowed to touch the
│                      filesystem or network. Owns:
│                        - masterNodeClient.ts   WebSocket client to the Master Node
│                        - secureChannel.ts      AES-256-GCM encrypt/decrypt for that link
│                        - wifiManager.ts        OS-level WiFi scan/join (node-wifi)
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
    │   HomePage, LogsPage, SettingsPage, ConnectDevicePage   from main over IPC.
    ├── components/
    │   Gauge, NodeStatusBar, AlertList, HistoryPanel, LoginScreen,
    │   ThemeToggle, CriticalAlertOverlay, NodeList, NodeSummaryCard
    ├── store/            useReadingsStore.ts — Zustand, multi-node state
    └── hooks/            useAlertSound.ts — Web Audio critical-alert beep

decision-engine/
└── fish_health_index.py   Fish Health Index scorer (Member 4's subsystem —
                            see § 6, thresholds here are provisional)
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

**Windows permission caveat**: joining a _new_ WiFi network via `netsh` can require elevated rights depending on machine policy — the wizard never hard-blocks on this. If the automatic join fails, it offers "Open Windows WiFi Settings" plus "I've connected manually — Continue," so the user can finish the OS-level join themselves and the wizard proceeds regardless.

**Encryption**: every message over the WebSocket link is AES-256-GCM encrypted (`src/main/secureChannel.ts`) — confidentiality plus tamper detection (a forged/altered message fails the auth tag and is dropped, not trusted). The key is derived (SHA-256) from the same WiFi password typed into step 3 above, so there's no separate secret to provision — the pairing password _is_ the encryption secret. This applies to both directions: uplink readings/discovery and downlink commands (`set_interval`). Leaving the password field blank falls back to plain JSON, which only makes sense for the dev mock (below) — a real device should always be paired with its password.

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

### ✅ Phase 7 — Remote Configuration (downlink)

Sampling-interval control in the UI sends `set_interval` over the same WebSocket link; the mock server logs whatever it receives, same channel the real Master Node would use.

### ✅ Phase 8 — Polish

- [x] Login — bcrypt-hashed passwords, `admin`/`operator` roles, default admin auto-created on first run
- [x] Node offline detection — 30s sweep, 5 min staleness threshold
- [x] Connection error states — visible "Disconnected — retrying…" banner, DB writes wrapped so a failure can't crash the app
- [x] _(added beyond the original plan)_ Light/dark theme, multi-page nav (Home/Logs/Settings), multi-node support, user management UI, logout

### ✅ Phase 9 — Real MCU WiFi Pairing

Originally scoped as just swapping `MASTER_NODE_URL` for a LAN IP, on the assumption the Master Node would already share a network with the dashboard machine. The actual Master Node broadcasts its own WiFi AP instead, so this phase became the Connect Device wizard described in § "Real MCU pairing" above: OS-level WiFi scan/join (`wifiManager.ts`, `node-wifi`), dynamic `masterNodeClient` target instead of a hardcoded constant, and node auto-detection via a `node_list` discovery message. Validated against `../firmware_design/master_node/AquaLoRa_MasterNode_Dummy/` (a real ESP32 broadcasting its own AP + streaming dummy readings over the same protocol) since the LoRa/Slave Node side isn't built yet.
**Done when:** the wizard pairs with a real ESP32's AP and dummy sensor data flows into the dashboard live. _(Swapping the dummy firmware for the real Slave-Node-relaying Master Node firmware, once Members 1/2 finish it, needs no dashboard changes — same protocol/port.)_

### ⏳ Phase 10 — Integration Testing & Validation (blocked on hardware)

Staged integration order from the proposal: Slave+Master LoRa link (Members 1/2) → Master+Dashboard (the WiFi pairing + WebSocket link itself is now validated via the dummy firmware, above — what's left here is confirming it holds with the _real_ Master Node firmware once it exists) → Dashboard+Decision Engine (confirm scoring holds up on real sensor noise, not just clean mock/dummy data).

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

## 5. Data Transmission & Node Detection — Technical Reference

This section is the detailed reference for exactly how bytes move between the Master Node and this dashboard, and exactly how a physical sensor node goes from "just started transmitting" to "visible in the UI." § 2's "Real MCU pairing" above covers the _user-facing_ wizard flow; this covers the _wire protocol and detection logic_ underneath it.

### 5.1 Transport

One WebSocket connection, opened by the dashboard (`src/main/masterNodeClient.ts`) as the client, to the Master Node (or the mock/dummy-firmware stand-in) acting as the server:

- **Dev mock**: `ws://localhost:8081` — `mock_master_node.js`, `ws` npm package (`WebSocketServer`).
- **Real/dummy hardware**: `ws://192.168.4.1:8081` — the fixed gateway address of the Master Node's own WiFi AP (`WiFi.softAP()` on ESP32 always hands out `192.168.4.1`), served by `WebSocketsServer` (Markus Sattler's Arduino library) in `firmware_design/master_node/AquaLoRa_MasterNode_Dummy/AquaLoRa_MasterNode_Dummy.ino`.

There is exactly **one physical connection**, multiplexing every logical channel — discovery, every sensor node's periodic readings, and downlink commands all share this one socket. Messages are distinguished purely by JSON shape (a `type` field for non-`Reading` messages; `Reading` itself has no `type` and is the implicit default), not by separate ports or sub-connections. This keeps the protocol identical whether there are 1 or 40 Slave Nodes behind the Master Node — the dashboard never needs to know the node count up front, only how to react to whichever `node_id` shows up.

`masterNodeClient` auto-reconnects 3s after any disconnect, and safely tears down (`removeAllListeners()` + `close()`) any existing socket before opening a new one — needed because `connect()` can now be called again mid-session when the user re-pairs to a different Master Node from the wizard, which never happened before this pairing flow existed.

### 5.2 Message catalog

| Message              | Direction          | `type` field           | Sent by     | Sent when                                                                                  | Handled by                                                                                                     |
| -------------------- | ------------------ | ---------------------- | ----------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `Reading`            | Uplink             | _(none — the default)_ | Master Node | Once per sampling interval, per known sensor node (10s default in the mock/dummy firmware) | `masterNodeClient.onReading` → `db.upsertNodeFromReading` + `db.insertReading` → `decisionEngine.scoreReading` |
| `NodeListMessage`    | Uplink (discovery) | `"node_list"`          | Master Node | Once, immediately on every new WebSocket connection                                        | `masterNodeClient.onNodeList` → `db.upsertNodeStub` per node                                                   |
| `SetIntervalCommand` | Downlink           | `"set_interval"`       | Dashboard   | Whenever the user changes the sampling interval in the UI                                  | Master Node applies it to its own send timer (LoRa firmware would relay it onward to the Slave Node)           |

`Reading`'s shape is the fixed data contract agreed with the LoRa/firmware team (§ 2, "Data contract") — `node_id`, `timestamp`, `temperature`, `turbidity`, `tds`, `battery_pct`, `rssi`. The other two are dashboard-internal protocol messages layered on top; they never travel over the LoRa hop, only the WiFi/WebSocket one.

### 5.3 Encryption layer

Every message in both directions is wrapped in an AES-256-GCM envelope before it hits the wire — implemented in `src/main/secureChannel.ts` on the dashboard side and mirrored line-for-line (same KDF, same envelope shape) in the firmware's `mbedtls`-based functions:

```
Dashboard                                          Master Node (ESP32 AP)
    |                                                      |
    |── WiFi join (node-wifi → netsh/nmcli/airport) ─────▶|   OS-level, not this protocol
    |── WebSocket connect ws://192.168.4.1:8081 ─────────▶|
    |                                                      |
    |◀═ {"iv","tag","data"} — encrypted node_list ═════════|   discovery, sent once per connection
    |   decrypt → upsertNodeStub() per node               |   UI shows "N nodes detected" immediately
    |                                                      |
    |◀═ {"iv","tag","data"} — encrypted Reading ═══════════|   periodic uplink, one per node per interval
    |   decrypt → upsertNodeFromReading() + insertReading()|   (also the fallback detection path — see 5.4)
    |                                                      |
    |── {"iv","tag","data"} — encrypted set_interval ────▶|   downlink, applied to the send timer live
```

**Envelope**: `{ "iv": "<base64>", "tag": "<base64>", "data": "<base64>" }` — a fresh random 12-byte IV per message (`crypto.randomBytes` / `esp_random()`), the 16-byte GCM authentication tag, and the ciphertext. No additional authenticated data (AAD) is used.

**Key derivation**: `SHA-256(WiFi AP password)` → a 32-byte AES-256 key. The _same password_ the user types into the Connect Device wizard to join the Master Node's AP (`AP_PASSWORD` in the firmware sketch) is the pairing secret _and_ the encryption secret — there's nothing separate to generate, distribute, or keep in sync between the dashboard and firmware. Changing the AP password on either side changes the key on both automatically, since both sides derive it the same way at connect time.

**Persistence**: `master:connect` derives the key once and stores it — hex-encoded, alongside the paired URL — in the `settings` table (`master_node_key_hex`), so a restart reconnects encrypted without asking the user to retype the password. (This means the key sits in the local SQLite file in the clear, same trust boundary as everything else the dashboard stores — acceptable for a local single-machine app, not something to widen the exposure of.)

**Failure handling**: `decryptMessage()` (dashboard) / `decryptEnvelope()` (firmware) return `null`/`false` on _any_ failure — malformed envelope, wrong key, or a failed GCM auth-tag check (meaning the message was corrupted or forged) — and the caller just drops the message and logs why, rather than crashing the connection or trusting unverified data. This is what makes the auth tag meaningful: a tampered message doesn't silently decrypt to garbage that gets processed, it fails closed.

**When it's skipped**: pairing with no password (the dev-only "Use local mock" shortcut, or an intentionally open MCU AP) falls back to plain JSON on both ends — `masterNodeClient.connect(url)` with no key, matching `mock_master_node.js`, which never speaks the encrypted envelope format at all.

**Why AES-256-GCM over WSS/TLS**: a real TLS transport was considered and rejected for this phase — `WebSocketsServer` on ESP32 has no well-supported secure-server mode, and provisioning/rotating a certificate is disproportionate overhead for a closed, single-client AP link where the "network" is the AP itself. AES-256-GCM gives the properties that actually matter here (confidentiality + tamper detection) with an implementation that comfortably fits the chip and needs no PKI.

### 5.4 Node detection techniques

A sensor node's `nodes` row (§ 2, "Database schema") is created automatically — there is deliberately no manual "Add Node" UI (removed; a `node_id` is only ever something firmware assigns, never something a person types in). Two independent mechanisms feed it, and either one alone is sufficient:

1. **Active discovery — the `node_list` message.** The Master Node enumerates every sensor node it currently knows about and sends it the instant a WebSocket connection opens (`WStype_CONNECTED` in the firmware). `masterNodeClient.onNodeList` calls `db.upsertNodeStub(node_id)` for each one — an `INSERT ... ON CONFLICT DO NOTHING`, so it only ever _creates_ a row if missing and never overwrites an existing one's `name`/`location`. That matters because this message re-fires on **every** reconnect (including the 3s auto-retry), so it must not clobber a name the user set later. This is what makes the Connect Device wizard able to show "N nodes detected" within a couple of seconds, well before any node's first periodic `Reading` arrives.

2. **Passive discovery — the first `Reading`.** `db.upsertNodeFromReading` fires on _every_ incoming reading and does a full upsert: creates the row if it's the first time that `node_id` has been seen, and on every call (new or existing) stamps `last_seen`/`battery_pct`/`lora_rssi` and sets `status = 'online'`. This is the fallback path — a node that, for whatever reason, wasn't part of the Master Node's `node_list` snapshot (e.g. it joined the LoRa mesh after that list was built) still gets detected the moment its first reading successfully relays through.

Both paths converge on the same `nodes` table and the same `node:updated` IPC push to the renderer, so the UI (Zustand's `knownNodes`) doesn't need to know or care which path created a given row.

**Node loss (the inverse)** works the same way, by absence rather than presence: a 30s sweep (`markStaleNodesOffline`, `OFFLINE_THRESHOLD_MS = 5 * 60_000`) flips any node whose `last_seen` has gone stale from `'online'` to `'offline'`, pushed live via `node:status`. There's no separate heartbeat/keepalive protocol — "online" and "offline" are both just derived from _when a `Reading` last arrived for that `node_id`_.

**Master Node detection** (a separate concern from sensor-_node_ detection above — this is about finding the gateway device itself, before any of the above can even start) is a third technique: `wifiManager.scanNetworks()` lists nearby WiFi SSIDs via the OS (`node-wifi`, which drives `netsh` on Windows / `nmcli` on Linux / `airport` on macOS). The wizard applies a soft heuristic — any SSID matching `/aqualora/i` gets an `MCU` badge — to help the user spot the right network in a crowded list; it's a hint, not a filter, so any SSID can still be selected and joined.

---

## 6. What's Left — Next Steps After Hardware Arrives

The dashboard side, including the real-MCU WiFi pairing flow, is functionally complete and validated against a dummy-firmware ESP32. What's actually blocking a full end-to-end demo is the real LoRa/Slave Node hardware, plus a handful of follow-ups:

**Blocked on Members 1/2's hardware:**

- [ ] **Phase 10** — staged integration testing: LoRa link first, then confirm the real Master Node firmware works against the dashboard the same way the dummy firmware does, then Dashboard+Decision Engine on _real_ sensor noise (mock/dummy data is clean by comparison — expect to find edge cases: dropped packets, out-of-order readings, sensor glitches neither ever produces).

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
