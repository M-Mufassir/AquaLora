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

## 3. Repository Structure

```
AquaLoRa/
├── desktop_application/          Dashboard + Decision Engine (Members 3 & 4)
│   ├── src/                      Electron + React + TS + SQLite (Member 3)
│   │   ├── main/                 Node.js backend — WebSocket client, DB, IPC
│   │   ├── preload/               Security bridge
│   │   └── renderer/               React UI — gauges, graphs, alerts
│   └── decision-engine/           Fish Health Index engine — Python (Member 4)
│                                   spawned as a child process from Electron's
│                                   main process, kept separate so Members 3
│                                   and 4 can develop/test independently
│   (see desktop_application/README.md for detailed setup & phases)
│
├── firmware_design/
│   ├── master_node/               Office gateway firmware (Member 2)
│   │                                ESP32 + LoRa RX/TX + OLED + WiFi + LittleFS
│   │   └── AquaLoRa_MasterNode_Dummy/   Placeholder until Member 2's real
│   │                                     firmware lands: own WiFi AP + WebSocket
│   │                                     server + dummy sensor data, so Member 3
│   │                                     could build/validate the dashboard's WiFi
│   │                                     pairing flow against real hardware early
│   └── slave_node/                 Pond-side firmware (Members 1 & 2)
│                                     ESP32 + sensors + LoRa TX/RX + deep sleep
│
├── research_notes/                Proposal, literature review, diagrams,
│                                    presentation, defense prep documents
│
└── README.md                      This file
```

Each subsystem folder has its own README with implementation-specific detail; this file covers how they all fit together and the order to build them in as a team.

## 4. Tech Stack by Subsystem

| Subsystem            | Location                               | Stack                                                                    |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Slave Node firmware  | `firmware_design/slave_node/`          | Arduino/C++, ESP32, RadioHead or Arduino-LoRa library, OneWire (DS18B20) |
| Master Node firmware | `firmware_design/master_node/`         | Arduino/C++, ESP32, ESPAsyncWebServer, ArduinoJson, LittleFS             |
| Dashboard            | `desktop_application/src/`             | Electron, React, TypeScript, better-sqlite3, Recharts, Zustand           |
| Decision Engine      | `desktop_application/decision-engine/` | Python (spawned as a child process from Electron)                        |
| Research notes       | `research_notes/`                      | Markdown, SVG, DOCX, PDF                                                 |

## 5. The Data Contract (critical — read this before writing integration code)

All four subsystems must agree on this shape. If any one changes it unilaterally, integration week breaks.

**Uplink — Slave → Master → Dashboard:**

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

**Downlink — Dashboard → Master → Slave:**

```json
{ "type": "set_interval", "minutes": 30 }
```

**Master ↔ Dashboard transport & security**: this hop (WiFi/WebSocket only — not the LoRa hop) is AES-256-GCM encrypted, keyed by deriving SHA-256 of the same WiFi password used to pair with the Master Node's own access point — no separate secret to provision. Both JSON shapes above travel as an encrypted `{"iv","tag","data"}` envelope on real hardware; a message that fails decryption/authentication (wrong key, or tampered in transit) is dropped rather than trusted. A third message type, `{"type":"node_list","nodes":[{"node_id":"..."}]}`, is sent once by the Master Node the instant the dashboard connects, so the dashboard can auto-detect however many sensor nodes exist without any manual setup. Full protocol/encryption/detection reference: `desktop_application/README.md` § "Data Transmission & Node Detection."

**Dashboard → Decision Engine (local, not over the network):**

```json
// Request: { "temperature": 28.5, "turbidity": 35.2, "tds": 220 }
// Response: { "score": 88.4, "status": "Normal", "recommendation": null }
```

## 6. Whole-Team Implementation Order (10 weeks)

Software (dashboard, decision engine) deliberately starts **before** hardware exists — neither depends on physical sensors and both can be built against synthetic/mock data first. This is a deliberate risk-reduction choice: it keeps Week 5–7 (when everything meets for the first time) from being the first time any of this code has run at all.

| Phase                             | Weeks    | Owner(s)     | What happens                                                                                          |
| --------------------------------- | -------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| Procurement & bench testing       | W1–2     | All          | Order BOM, breadboard-test each sensor and LoRa module individually                                   |
| Dashboard & DB development        | W1–4     | Member 3     | Build against a mock Master Node (see `desktop_application/README.md`)                                |
| Decision engine development       | W2–5     | Member 4     | Build and unit-test the Fish Health Index logic against known inputs                                  |
| Master Node assembly & firmware   | W2–4     | Member 2     | LoRa RX/TX, OLED, WiFi, LittleFS buffering, AP fallback                                               |
| Slave Node PCB & firmware         | W2–5     | Member 1 & 2 | Three sub-circuits on Vero board, deep sleep/wake/median-filter firmware                              |
| Power system & enclosure          | W3–6     | Member 2     | Solar/battery circuit tuning, 3D-printed ASA/PLA enclosures                                           |
| **System integration**            | **W5–7** | **All**      | Staged: Slave+Master LoRa link → Master+Dashboard → Dashboard+Decision Engine → full end-to-end trace |
| Home deployment & evaluation      | W7–9     | All          | Range/RSSI/packet-loss testing, sensor calibration validation, battery endurance check                |
| Documentation & presentation prep | W8–10    | All          | Final report, results write-up, defense prep                                                          |

**Integration order matters — don't skip steps:** LoRa link first (isolates radio problems from software problems), then Master+Dashboard (confirms real data replaces mock data correctly), then Dashboard+Decision Engine (confirms scoring works on real sensor noise, not clean synthetic data), then one full manual end-to-end trace before calling it done.

## 7. Hardware Budget

| Category                                      | Cost (Rs.)        |
| --------------------------------------------- | ----------------- |
| Telemetry (2× LoRa Ra-02 + antennas)          | 4,240.00          |
| Microcontrollers (2× ESP32 + RTC)             | 3,150.00          |
| Sensors (DS18B20, turbidity, TDS)             | 4,330.00          |
| Power system (solar, charger, battery, boost) | 2,330.00          |
| Assembly (board, headers, connectors)         | 940.00            |
| **Total**                                     | **Rs. 14,990.00** |

## 8. Key Design Decisions (the "why" behind the architecture)

- **433 MHz LoRa over WiFi/cellular at the Slave Node** — longer wavelength penetrates obstacles better; no need for grid power or router coverage at the pond
- **Two-way LoRa (uplink + downlink)** — not just telemetry; the dashboard can push sampling-interval changes back to the Slave Node, relayed during its brief post-transmission listen window
- **Local SQLite as system of record, not cloud** — removes recurring subscription cost and continuous-connectivity dependency that every reviewed comparable system has
- **AES-256-GCM over WSS/TLS for the Master↔Dashboard WiFi hop** — the Master Node broadcasts its own AP for the dashboard to pair with directly (no home router involved), and `WebSocketsServer` has no well-supported TLS mode on ESP32; deriving a symmetric key from the pairing password itself gives confidentiality and tamper detection without certificate management that a closed single-client AP link doesn't need
- **Rule-based Fish Health Index over ML/fuzzy logic** — a 2025 comparative study found threshold rules score ~77.8% vs. fuzzy logic's ~89.6%; the accuracy trade-off is accepted deliberately in exchange for a system that runs on low-cost embedded hardware with no training dataset required
- **ASA (not PLA) for the Slave Node enclosure** — UV/weather resistance for permanent outdoor deployment; Master Node uses standard PLA since it stays indoors
- **Hand-soldered Vero board for this prototype phase** — a fabricated PCB's design-fab-ship cycle doesn't fit a 10-week timeline; a production PCB is named explicitly as future work, not hidden as a limitation

## 9. Known Limitations (stated honestly, not hidden)

- LoRa uplink/downlink (Slave ↔ Master) currently has no encryption or authentication — a pre-shared-key/checksum scheme is scoped as future work. (The WiFi hop, Master ↔ Dashboard, is AES-256-GCM encrypted — see § 5 above — so this gap is specific to the LoRa segment.)
- Sensor suite covers temperature, turbidity, and TDS only — dissolved oxygen and pH (ranked more physiologically critical in the literature) are future work
- Validated in a controlled home-environment demo, not a live commercial farm, for this project phase

## 10. Documentation

All in `research_notes/`:

- `AquaLoRa_Design_Project_Proposal.docx` — full proposal: requirements, architecture, engineering calculations, methodology, risk assessment
- `AquaLoRa_Master_Research_Document.pdf` — literature review, historical development, positioning, defense Q&A prep
- `AquaLoRa_How_It_Works_And_Implementation_Guide.docx` — plain-language system walkthrough with a worked Fish Health Index example
- `AquaLoRa_Reference_DeepDive.pdf` — full annotated reference list with source summaries
- `AquaLoRa_Presentation.pptx` — proposal defense slide deck

## 11. Getting Started

Each subsystem is developed and run independently — see the README inside each folder for setup instructions specific to that part:

```bash
git clone <repo-url>
cd AquaLoRa

# Desktop application — dashboard (Member 3) + decision engine (Member 4)
# Can start immediately, no hardware needed (builds against a mock Master Node)
cd desktop_application && cat README.md

# Firmware (Members 1 & 2) — needs ESP32 boards + PlatformIO/Arduino IDE
cd firmware_design/master_node && cat README.md
cd firmware_design/slave_node && cat README.md
```
