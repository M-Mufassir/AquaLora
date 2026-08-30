# AquaLoRa

**LoRa-Based Smart Fish Farm Monitoring and Protection System Using IoT**

A solar-powered, offline-capable water quality monitoring system for small-scale aquaculture in Sri Lanka. Built as an SLIIT IE3044 Design Project.

|                                 |                                      |
| ------------------------------- | ------------------------------------ |
| **R Anojan** — IT23670648       | Water Quality Sensing                |
| **S Abiram** — IT23669826       | LoRa Communication & Solar Power     |
| **M R M Mufassir** — IT23650848 | Dashboard & Database                 |
| **S Pratheesa** — IT23619630    | Decision Support (Fish Health Index) |

---

## 1. The Problem

Small and medium-scale fish/prawn farms in Sri Lanka check water quality manually, once or twice a day. Conditions can shift dangerously between checks — an overnight oxygen crash or a post-rainfall turbidity spike can go undetected until fish are already stressed or dying. Existing commercial IoT monitoring systems assume continuous WiFi/cellular connectivity and a third-party cloud subscription — both impractical for ponds that sit far from the farmhouse with no power infrastructure nearby.

## 2. The Solution — System Architecture

Two physically separated nodes, communicating over long-range radio, feeding a locally-owned dashboard and a lightweight decision engine:

```
┌──────────────────┐   LoRa 433MHz   ┌───────────────────┐   WiFi/WebSocket   ┌────────────────────┐
│   SLAVE NODE      │ ──────────────▶ │   MASTER NODE      │ ──────────────────▶ │   DASHBOARD          │
│   (Pond edge)     │ ◀────────────── │   (Office gateway) │ ◀────────────────── │   (Desktop app)      │
│                   │    downlink     │                    │      downlink       │                      │
│ ESP32             │                 │ ESP32              │                     │ Electron + React     │
│ DS18B20 temp      │                 │ SX1278 LoRa RX/TX  │                     │ SQLite (record of    │
│ Turbidity sensor  │                 │ 1.3" OLED display  │                     │  truth)               │
│ TDS sensor        │                 │ LittleFS buffer    │                     │ Local network only —  │
│ PCF8563 RTC       │                 │ WiFi + AP fallback │                     │  works with zero      │
│ Solar + 3×18650   │                 │                    │                     │  internet              │
└──────────────────┘                 └───────────────────┘                     └──────────┬───────────┘
   Deep sleep most                                                                          │
   of every hour;                                                                           ▼
   ~5-6s active per cycle                                                        ┌────────────────────┐
                                                                                   │  DECISION ENGINE     │
                                                                                   │  (Python process)    │
                                                                                   │  Fish Health Index:  │
                                                                                   │  0.5×Temp+0.3×Turb   │
                                                                                   │  +0.2×TDS → 0-100    │
                                                                                   │  Normal/Warning/     │
                                                                                   │  Critical            │
                                                                                   └────────────────────┘
```

**The core design decision:** every comparable system reviewed in our literature research treats a third-party cloud platform (Firebase, ThingSpeak, Blynk) as the _only_ copy of the data. AquaLoRa inverts this — the dashboard's local SQLite database is the permanent record; cloud sync, if ever added, is optional. Combined with a WiFi-less, solar-powered Slave Node and a lightweight rule-based decision engine (chosen over ML/fuzzy logic to run on low-cost hardware without training data), this is the specific combination that doesn't exist elsewhere in the reviewed literature — local or international.

### WiFi communication model update

The Master Node no longer depends only on its own access point. The production design now supports both:

- **AP mode**: the ESP32 starts `AquaLoRa-MasterNode` and the dashboard connects to `ws://192.168.4.1:8081`.
- **External WiFi / station mode**: the ESP32 joins an office or home router, and the dashboard connects directly to the node's LAN IP, for example `ws://192.168.1.50:8081`.

The dashboard connection wizard and firmware therefore support both deployment styles, while the local-first SQLite + outbox cloud backup model remains unchanged.

### New Feature: 4-Sensor Integration (Temperature, Turbidity, TDS, pH)

The system now includes a **4th sensor — pH probe** — integrated into the full monitoring stack:

- **Slave Node firmware**: pH sensor wired and sampled (hardware & calibration: Member 1)
- **Decision Engine**: Fish Health Index now weighted across 4 sensors (formula: Member 4)
- **Dashboard**: pH gauge, historical trends, safe-range indicators (UI: Member 3)
- **Backend**: pH field included in all sync operations
- **Mobile App**: pH data displayed in real-time and historical views (new subsystem)

### New Feature: 3-Layer Syncing Architecture (Local → Cloud → Mobile)

AquaLoRa now extends beyond desktop-only:

```
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 1: LOCAL (Source of Truth)                                 │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Desktop App (Electron + React + TypeScript)                │   │
│ │ ├─ Primary DB: SQLite (aqualora.db)                        │   │
│ │ ├─ Sensors: Temperature, Turbidity, TDS, pH               │   │
│ │ ├─ Alerts: Threshold-based + Staleness (1h timeout)       │   │
│ │ ├─ Decision Engine: Fish Health Index (Python subprocess) │   │
│ │ └─ Sync Queue: Outbox pattern (readings + alerts)         │   │
│ └────────────────────────────────────────────────────────────┘   │
│                           │ (background sync, ~2–5 min interval) │
└───────────────────────────┼──────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 2: CLOUD (Secondary Backup)                                │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ FastAPI Backend (Python + PostgreSQL on Railway)           │   │
│ │ ├─ Endpoints: /health, /auth/login, /readings/sync,       │   │
│ │ │             /readings/latest, /readings/history         │   │
│ │ ├─ Full secondary copy of all readings                    │   │
│ │ ├─ Sync status tracking (pending/synced/failed)           │   │
│ │ └─ JWT authentication for mobile + desktop               │   │
│ └────────────────────────────────────────────────────────────┘   │
│                           │ (mobile reads cloud DB)               │
└───────────────────────────┼──────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ LAYER 3: MOBILE (Remote Access)                                  │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ React Native Mobile App (Expo)                             │   │
│ │ ├─ Current readings: from Backend PostgreSQL              │   │
│ │ ├─ Historical data: from Backend PostgreSQL               │   │
│ │ ├─ Push alerts: via FCM (Firebase Cloud Messaging)        │   │
│ │ ├─ Login: via mobile auth server (reads desktop SQLite)   │   │
│ │ └─ Network-dependent (assumes stable internet)            │   │
│ └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

**Design Principle**: Desktop SQLite is the **permanent system of record**. The backend Postgres is a **full secondary backup** — if the desktop app is offline, mobile can still access historical data from the cloud. If the cloud is down, the desktop app continues monitoring with zero degradation.

**Implementation Status**: See `PROJECT_ANALYSIS_AND_ISSUES.md` for detailed implementation checklist and known gaps.

## 3. Repository Structure

```
AquaLoRa/
├── Backend/                      Cloud Backup API (FastAPI + PostgreSQL)
│   ├── app/
│   │   ├── main.py              API endpoints (/sync, /latest, /history)
│   │   ├── database.py          PostgreSQL schema (readings table)
│   │   ├── auth.py              JWT token creation/validation
│   │   └── config.py            Environment configuration
│   └── requirements.txt          Python dependencies
│
├── desktop_application/          Dashboard + Decision Engine (Members 3 & 4)
│   ├── src/                      Electron + React + TS + SQLite (Member 3)
│   │   ├── main/                 Node.js backend — WebSocket client, DB, IPC, outbox sync
│   │   ├── preload/              Security bridge
│   │   └── renderer/             React UI — gauges, graphs, alerts
│   │       └── components/       LoginScreen, Gauge, AlertList, NodeList, HistoryPanel, etc.
│   ├── decision-engine/          Fish Health Index engine — Python (Member 4)
│   │   └── fish_health_index.py  4-sensor scoring (temp, turbidity, TDS, pH)
│   └── README.md                 Desktop app setup & architecture
│
├── mobile_application/           React Native Mobile App (Expo)
│   ├── src/
│   │   ├── screens/              LoginScreen, DashboardScreen, NodesScreen, AlertsScreen, SettingsScreen
│   │   ├── services/             API calls to backend
│   │   ├── context/              Authentication context
│   │   ├── navigation/           Bottom-tab navigation
│   │   └── config.ts             API endpoints configuration
│   ├── package.json
│   ├── app.json                  Expo configuration
│   └── README.md                 Mobile app setup & architecture
│
├── firmware_design/
│   ├── master_node/              Office gateway firmware (Member 2)
│   │   ├── AquaLoRa_MasterNode/           Production firmware
│   │   │   ├── AquaLoRa_MasterNode.ino    Main sketch
│   │   │   ├── config.h                   Hardware pinouts
│   │   │   ├── display.h                  OLED driver (SH1106/SSD1306)
│   │   │   ├── lora_receiver.h            LoRa RX driver
│   │   │   └── secure_ws.h                AES-256-GCM WebSocket
│   │   ├── AquaLoRa_MasterNode_Dummy/    Mock firmware (for testing without hardware)
│   │   └── README.md
│   └── slave_node/               Pond-side firmware (Members 1 & 2)
│       └── AquaLoRa_SlaveNode/
│           ├── AquaLoRa_SlaveNode.ino    Main sketch
│           ├── config.h                  Hardware pinouts
│           ├── sensors.h                 DS18B20, TDS, Turbidity, pH drivers
│           ├── lora_comms.h              LoRa TX driver
│           └── README.md
│
├── research_notes/               Proposal, literature review, diagrams, presentation, defense
│
├── PROJECT_ANALYSIS_AND_ISSUES.md    ← **START HERE** — Full analysis of critical issues & fixes
├── README.md                         This file
└── ARCHITECTURE.md                   (Recommended: create this for consolidated design docs)
```

**New files in this phase**: `Backend/`, `mobile_application/`, `PROJECT_ANALYSIS_AND_ISSUES.md`  
**Key change**: Desktop app now includes `outbox` table and sync logic (in development)  
**Key change**: Decision engine now handles 4-sensor input (pH added to formula)

## 4. Tech Stack by Subsystem

| Subsystem            | Location                               | Stack                                                                    | Status |
| -------------------- | -------------------------------------- | ---                                                                    | --- |
| Slave Node firmware  | `firmware_design/slave_node/`          | Arduino/C++, ESP32, RadioHead or Arduino-LoRa library, OneWire (DS18B20), pH ADC | ✅ Hardware in progress |
| Master Node firmware | `firmware_design/master_node/`         | Arduino/C++, ESP32, ESPAsyncWebServer, ArduinoJson, LittleFS, AES-256-GCM | ✅ In progress |
| Desktop Dashboard    | `desktop_application/src/renderer/`    | Electron, React, TypeScript, better-sqlite3, Recharts, Zustand, react-router | ✅ Core complete |
| Decision Engine      | `desktop_application/decision-engine/` | Python (subprocess via stdin/stdout), 4-sensor Fish Health Index        | 🟡 pH integration in progress |
| Cloud Backend        | `Backend/`                             | FastAPI, PostgreSQL (Railway), SQLModel, JWT, Pydantic                  | 🟡 Outbox sync pending |
| Mobile App           | `mobile_application/`                  | React Native (Expo), Axios, Secure Storage, Bottom-Tab Navigation       | 🟡 Auth complete, data sync pending |

## 5. The Data Contract (critical — read this before writing integration code)

All four subsystems must agree on this shape. If any one changes it unilaterally, integration week breaks.

**Uplink — Slave → Master → Desktop Dashboard → Backend:**

```json
{
  "node_id": "slave-01",
  "timestamp": "2026-08-10T14:32:00Z",
  "temperature": 28.5,
  "turbidity": 35.2,
  "tds": 220,
  "ph": 7.4,
  "battery_pct": 87,
  "rssi": -62
}
```

**Downlink — Dashboard → Master → Slave:**

```json
{ "type": "set_interval", "minutes": 30 }
```

**Dashboard → Decision Engine (local subprocess, via stdin/stdout):**

```json
// Request:
{ "temperature": 28.5, "turbidity": 35.2, "tds": 220, "ph": 7.4 }

// Response:
{ "score": 88.4, "status": "Normal", "recommendation": null }
```

**Desktop → Backend Cloud Sync (POST /readings/sync):**

```json
{
  "readings": [
    {
      "node_id": "slave-01",
      "timestamp": "2026-08-10T14:32:00Z",
      "temperature": 28.5,
      "turbidity": 35.2,
      "tds": 220,
      "ph": 7.4,
      "pond_type": "tilapia",
      "battery_pct": 87,
      "rssi": -62
    }
  ]
}
```

**Desktop → Backend Cloud Sync (POST /alerts/sync) — PLANNED:**

```json
{
  "alerts": [
    {
      "node_id": "slave-01",
      "timestamp": "2026-08-10T14:32:00Z",
      "parameter": "temperature",
      "severity": "critical",
      "message": "Temperature critical: 34.2°C (above 34.0°C)"
    }
  ]
}
```

**Master ↔ Dashboard transport & security**: this hop (WiFi/WebSocket only — not the LoRa hop) is AES-256-GCM encrypted. In AP mode the shared key is derived from the Master Node AP password; in external WiFi/station mode the same pattern still applies when the dashboard connects using the configured network password or a dedicated shared secret. Both JSON shapes above travel as an encrypted `{"iv","tag","data"}` envelope on real hardware; a message that fails decryption/authentication (wrong key, or tampered in transit) is dropped rather than trusted. A third message type, `{"type":"node_list","nodes":[{"node_id":"..."}]}`, is sent once by the Master Node the instant the dashboard connects, so the dashboard can auto-detect however many sensor nodes exist without any manual setup. Full protocol/encryption/detection reference: `desktop_application/README.md` § "Data Transmission & Node Detection."

**Key change in this phase**: pH is now a required field in the data contract (previously only 3 sensors). All endpoints above include pH.

## 6. Implementation Status & Critical Issues

**⚠️ IMPORTANT**: The system has expanded significantly with new features (pH sensor, cloud sync, mobile app), but some implementations are incomplete. **Read `PROJECT_ANALYSIS_AND_ISSUES.md` immediately** for a full analysis of:

- 🔴 **Critical Issues** (data loss risk, security gaps, incomplete features)
- 🟡 **High-Priority Fixes** (deployment blocks, missing backends)
- 📋 **Implementation Checklist** (what's done, what's pending)
- 🔧 **Recommended Fixes** (phased approach, code examples)

### Quick Status Summary

| Component | Feature | Status | Owner | Notes |
|-----------|---------|--------|-------|-------|
| Desktop App | Core dashboard, local SQLite | ✅ Complete | Member 3 | Works offline |
| Desktop App | Outbox sync to cloud | 🔴 Schema exists, no code | Member 3 | **CRITICAL** — data never leaves desktop |
| Desktop App | pH sensor integration (UI) | 🟡 Partial | Member 3 | Gauges added, needs validation |
| Decision Engine | 4-sensor FHI formula | 🟡 In progress | Member 4 | Weights need finalization |
| Backend | PostgreSQL schema | ✅ Readings table done | Mufassir | Alerts table missing |
| Backend | /readings/sync endpoint | ✅ Complete | Mufassir | Deduplication works |
| Backend | /alerts/sync endpoint | 🔴 Missing | Mufassir | **CRITICAL** — alerts never reach cloud |
| Backend | Authentication | ⚠️ Hardcoded credentials | Mufassir | **SECURITY ISSUE** — see analysis |
| Mobile App | Login flow | ✅ Complete | New dev | Reads desktop SQLite |
| Mobile App | Dashboard screens | 🟡 Partial | New dev | Layouts exist, data binding pending |
| Mobile App | Historical data fetch | 🔴 Missing | New dev | Should read from Backend PostgreSQL |
| Mobile App | Push alerts (FCM) | 🔴 Not started | New dev | Requires backend implementation first |

**Next Steps**:
1. **Today**: Review `PROJECT_ANALYSIS_AND_ISSUES.md` with the team
2. **This week**: Create GitHub issues for each critical item, assign owners
3. **Next week**: Start Phase 1 (outbox sync implementation)

---

## 7. Whole-Team Implementation Order (Revised for 3-Layer Architecture)

Software (dashboard, decision engine, backend) deliberately starts **before** hardware exists — none depend on physical sensors and all can be built against synthetic/mock data first. This is a deliberate risk-reduction choice: it keeps Week 5–7 (when everything meets for the first time) from being the first time any of this code has run at all.

| Phase                             | Weeks    | Owner(s)     | What happens                                                                                          |
| --------------------------------- | -------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| Procurement & bench testing       | W1–2     | All          | Order BOM, breadboard-test each sensor and LoRa module individually                                   |
| Dashboard & DB development        | W1–4     | Member 3     | Build against a mock Master Node (see `desktop_application/README.md`)                                |
| Decision engine (4-sensor FHI)    | W2–5     | Member 4     | Unit-test with all 4 sensors (temp, turb, TDS, pH) against known inputs                               |
| Backend setup & schema            | W1–3     | Mufassir     | PostgreSQL schema, FastAPI endpoints, Railway deployment (see `Backend/README.md`)                    |
| **Outbox sync implementation**    | **W2–3** | **Member 3** | **Desktop → Backend sync with retry logic, deduplication (CRITICAL PATH)**                            |
| **Alerts table & sync**           | **W3–4** | **Mufassir** | **Backend alerts table, POST /alerts/sync endpoint, desktop queues alerts**                           |
| Master Node assembly & firmware   | W2–4     | Member 2     | LoRa RX/TX, OLED, WiFi, LittleFS buffering, AP fallback                                               |
| Slave Node PCB & firmware         | W2–5     | Member 1 & 2 | Three sub-circuits on Vero board, **pH sensor integration**, deep sleep/wake firmware                 |
| Mobile app (auth + UI)            | W3–5     | New dev      | React Native screens, login flow, auth server (see `mobile_application/README.md`)                    |
| Mobile app (data sync)            | W4–5     | New dev      | Fetch readings/alerts from Backend, real-time updates                                                 |
| Power system & enclosure          | W3–6     | Member 2     | Solar/battery circuit tuning, 3D-printed ASA/PLA enclosures                                           |
| **System integration**            | **W5–7** | **All**      | **Staged: Slave+Master LoRa → Master+Dashboard → Dashboard+Decision Engine → Cloud sync → Mobile sync** |
| Home deployment & evaluation      | W7–9     | All          | Range/RSSI/packet-loss testing, sensor calibration validation, battery endurance check, cloud sync uptime |
| Documentation & presentation prep | W8–10    | All          | Final report, results write-up, defense prep, README consolidation                                    |

**Critical path changes**: Outbox sync and alerts sync are now on the critical path. The old "desktop-only" implementation assumed these were optional; they're not — without them, mobile data is perpetually stale and alerts never reach users.

## 8. Hardware Budget (Updated for pH Sensor)

| Category                                      | Cost (Rs.)        |
| --------------------------------------------- | ----------------- |
| Telemetry (2× LoRa Ra-02 + antennas)          | 4,240.00          |
| Microcontrollers (2× ESP32 + RTC)             | 3,150.00          |
| Sensors (DS18B20, turbidity, TDS, **pH probe**)   | **5,100.00**  |
| Power system (solar, charger, battery, boost) | 2,330.00          |
| Assembly (board, headers, connectors)         | 940.00            |
| **Total**                                     | **Rs. 15,760.00** |

*Note: pH probe (~Rs. 770) added to original BOM; calibration buffers included*

## 9. Key Design Decisions (the "why" behind the architecture)

- **433 MHz LoRa over WiFi/cellular at the Slave Node** — longer wavelength penetrates obstacles better; no need for grid power or router coverage at the pond
- **Two-way LoRa (uplink + downlink)** — not just telemetry; the dashboard can push sampling-interval changes back to the Slave Node, relayed during its brief post-transmission listen window
- **Local SQLite as system of record, not cloud** — removes recurring subscription cost and continuous-connectivity dependency that every reviewed comparable system has
- **AES-256-GCM over WSS/TLS for the Master↔Dashboard WiFi hop** — the Master Node broadcasts its own AP for the dashboard to pair with directly (no home router involved), and `WebSocketsServer` has no well-supported TLS mode on ESP32; deriving a symmetric key from the pairing password itself gives confidentiality and tamper detection without certificate management that a closed single-client AP link doesn't need
- **Rule-based Fish Health Index over ML/fuzzy logic** — a 2025 comparative study found threshold rules score ~77.8% vs. fuzzy logic's ~89.6%; the accuracy trade-off is accepted deliberately in exchange for a system that runs on low-cost embedded hardware with no training dataset required
- **ASA (not PLA) for the Slave Node enclosure** — UV/weather resistance for permanent outdoor deployment; Master Node uses standard PLA since it stays indoors
- **Hand-soldered Vero board for this prototype phase** — a fabricated PCB's design-fab-ship cycle doesn't fit a 10-week timeline; a production PCB is named explicitly as future work, not hidden as a limitation

## 10. Known Limitations (stated honestly, not hidden)

- LoRa uplink/downlink (Slave ↔ Master) currently has no encryption or authentication — a pre-shared-key/checksum scheme is scoped as future work. (The WiFi hop, Master ↔ Dashboard, is AES-256-GCM encrypted — see § 5 above — so this gap is specific to the LoRa segment.)
- pH sensor is now integrated (hardware, firmware, decision engine, UI) but the **calibration workflow and species-specific thresholds remain preliminary** — see `desktop_application/decision-engine/fish_health_index.py` for tuning requirements
- Mobile app assumes reasonably stable internet connectivity when checking status; the system does not attempt to handle permanently offline phones (by design — that's a deliberate scope decision to keep complexity manageable)
- Cloud authentication is currently hardcoded (see `PROJECT_ANALYSIS_AND_ISSUES.md` § Issue #2) — production deployment requires unified auth provider
- Sensor suite has been expanded from 3 to 4 sensors; dissolved oxygen remains future work and is ranked more physiologically critical in the literature
- Validated in a controlled home-environment demo, not a live commercial farm, for this project phase
- **Implementation is incomplete**: Outbox sync, alerts sync, and mobile data binding are in progress — see `PROJECT_ANALYSIS_AND_ISSUES.md` for the full checklist

### 3-Layer Architecture Scope & Design Trade-offs

The system now spans local (desktop) ↔ cloud (backend) ↔ mobile. Key design decisions:

| Design Choice | Rationale | Trade-off |
|---|---|---|
| **Desktop SQLite is primary record** | Removes internet dependency; local monitoring always works | Cloud is eventually-consistent, not real-time |
| **Full Postgres backup (not a cache)** | Mobile can see all history, not just a recent subset | Doubles storage requirements; outbox pattern adds complexity |
| **Hardcoded admin credential** | Simplest auth for an academic prototype | Production needs identity provider (see analysis doc) |
| **Mobile reads from cloud only** | Keeps mobile architecture simple; no p2p sync needed | Mobile is stale if desktop hasn't synced recently |
| **Android-only push alerts (FCM)** | Firebase is industry-standard for this | iOS requires APNs and separate setup; not included in this phase |
| **Outbox + retry pattern** | Handles transient network failures gracefully | Requires implementation complexity; not yet coded |

## 11. Documentation

All in `research_notes/` plus two new project docs:

**Academic & Design Documentation**:
- `AquaLoRa_Design_Project_Proposal.docx` — full proposal: requirements, architecture, engineering calculations, methodology, risk assessment
- `AquaLoRa_Master_Research_Document.pdf` — literature review, historical development, positioning, defense Q&A prep
- `AquaLoRa_How_It_Works_And_Implementation_Guide.docx` — plain-language system walkthrough with a worked Fish Health Index example
- `AquaLoRa_Reference_DeepDive.pdf` — full annotated reference list with source summaries
- `AquaLoRa_Presentation.pptx` — proposal defense slide deck

**Project Execution Documentation** (new):
- `PROJECT_ANALYSIS_AND_ISSUES.md` — **CRITICAL** — detailed analysis of 3-layer sync architecture, 7 critical issues, and phased implementation approach
- `ARCHITECTURE.md` (recommended) — consolidated system architecture, data flow diagrams, deployment checklists (to be created)
- `AquaLoRa_Reference_DeepDive.pdf` — full annotated reference list with source summaries
- `AquaLoRa_Presentation.pptx` — proposal defense slide deck

## 11. Deployment & Packaging

The AquaLoRa system is designed as a local-first architecture:

- The desktop app stores its main data in SQLite locally.
- It can also sync queued readings to the Railway PostgreSQL backend as a secondary cloud backup.
- The live backend URL used by the desktop app is:

```text
https://aqualora.up.railway.app
```

For deployment setup, see the backend README in `Backend/README.md` and the app configuration section in `desktop_application/README.md`.

### Build the desktop installer (.exe)

From the `desktop_application` folder, run:

```bash
npm install
npm run build:win
```

This builds the app and creates the Windows installer at:

```text
desktop_application/dist/aqualora-dashboard-0.1.0-setup.exe
```

The generated `.exe` file is the installable desktop application for Windows users. If you want a portable debug build or want to inspect unpacked files, the `dist/win-unpacked/` folder is also created automatically.

## 12. Getting Started

Each subsystem is developed and run independently — see the README inside each folder for setup instructions specific to that part:

```bash
git clone <repo-url>
cd AquaLoRa

# Desktop application — dashboard (Member 3) + decision engine (Member 4)
# Can start immediately, no hardware needed (builds against a mock Master Node)
cd desktop_application && cat README.md

# Cloud backend — PostgreSQL + FastAPI sync service
cd Backend && cat README.md

# Firmware (Members 1 & 2) — needs ESP32 boards + PlatformIO/Arduino IDE
cd firmware_design/master_node && cat README.md
cd firmware_design/slave_node && cat README.md
```
