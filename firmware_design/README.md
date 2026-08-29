# AquaLoRa Firmware Architecture & Embedded Firmware Subsystems

Industrial-grade, solar-powered IoT marine telemetry firmware for off-grid aquaculture water quality monitoring. Designed for the **SLIIT IE3044 Design Project**.

---

## 1. System Overview

The AquaLoRa firmware system consists of two physically decoupled ESP32 node architectures linked via 433 MHz LoRa RF radio transmission and AES-256-GCM encrypted Wi-Fi WebSockets:

```
┌────────────────────────────────────────────────────────┐
│                   AQUALORA SLAVE NODE                  │
│  (Pond-side Solar-Powered Telemetry Unit - Member 1 & 2)│
│                                                        │
│  Sensors: DS18B20 Temp | TDS Sensor | Turbidity Sensor │
│  Power Management: 2N7000/IRF4905 High-Side MOSFET     │
│  Sleep Trigger: PCF8563 RTC Hardware Interrupt (D27)   │
│  Radio: Ra-02 SX1278 433MHz LoRa Transmitter (SPI)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ 433 MHz LoRa RF Link
                            │ Payload: "Node1,25.40,320,1.50"
                            ▼
┌────────────────────────────────────────────────────────┐
│                  AQUALORA MASTER NODE                  │
│    (Office Gateway Telemetry Receiver Unit - Member 2) │
│                                                        │
│  Radio: Ra-02 SX1278 433MHz LoRa Receiver (SPI)        │
│  Display: 1.3" SH1106 / 0.96" SSD1306 OLED (I2C)       │
│  Wi-Fi AP: SSID "AquaLoRa-MasterNode" (192.168.4.1)    │
│  WebSocket Server: Port 8081 (AES-256-GCM Encrypted)   │
└───────────────────────────┬────────────────────────────┘
                            │
                            │ Wi-Fi WebSocket (ws://192.168.4.1:8081)
                            │ AES-256-GCM Base64 JSON Envelope
                            ▼
┌────────────────────────────────────────────────────────┐
│               AQUALORA DESKTOP DASHBOARD               │
│     (Electron + React Live Monitoring - Member 3 & 4)  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```text
firmware_design/
├── master_node/
│   ├── AquaLoRa_MasterNode/         Production Master Node Firmware (LoRa SPI + OLED + Wi-Fi AP + AES-256-GCM)
│   │   ├── AquaLoRa_MasterNode.ino  Main sketch (Setup AP, OLED, LoRa & Dual Processing Loop)
│   │   ├── config.h                 Hardware pinouts, Wi-Fi credentials & RF frequency settings
│   │   ├── display.h                OLED display driver (SH1106 page mode & SSD1306 support)
│   │   ├── lora_receiver.h          SX1278 SPI driver & comma-separated payload parser
│   │   └── secure_ws.h              AES-256-GCM mbedtls cipher & WebSocketsServer gateway
│   │
│   ├── AquaLoRa_MasterNode_Dummy/   Dev Mock Stand-in (Simulated sensor telemetry without LoRa HW)
│   └── README.md                    Master Node implementation & dashboard pairing guide
│
└── slave_node/
    └── AquaLoRa_SlaveNode/          Production Slave Node Firmware (Sensors + Power Gating + PCF8563 RTC)
        ├── AquaLoRa_SlaveNode.ino   Main sketch (MOSFET Power On -> Sample -> LoRa TX -> RTC Deep Sleep)
        ├── config.h                 Slave Hardware pinouts, ADC constants & LoRa RF parameters
        ├── sensors.h                DS18B20 OneWire, TDS temp compensation & Turbidity NTU mapping
        └── lora_comms.h             SX1278 LoRa transmitter driver & power-down handler
```

---

## 3. Hardware Pinout & Hardware Rules

### **CRITICAL HARDWARE RULES**
1. **No Strapping Pins**: Pins `GPIO 12` and `GPIO 15` are strictly avoided for sensor connections to prevent ESP32 boot mode failures.
2. **No ADC2 Conflict**: Pins `GPIO 13` (and other ADC2 pins) are reserved or avoided for analog sampling so Wi-Fi operation does not cause ADC reading distortion.

### **ESP32 Master Node Pinout**
| Component | Function | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **Ra-02 LoRa** | SCK | `GPIO 18` | SPI Hardware Clock |
| **Ra-02 LoRa** | MISO | `GPIO 19` | SPI Master In Slave Out |
| **Ra-02 LoRa** | MOSI | `GPIO 23` | SPI Master Out Slave In |
| **Ra-02 LoRa** | NSS | `GPIO 5` | SPI Chip Select |
| **Ra-02 LoRa** | RST | `GPIO 27` | Hardware Reset Line |
| **Ra-02 LoRa** | DIO0 | `GPIO 13` | Packet Tx/Rx Interrupt |
| **OLED Display** | SDA | `GPIO 21` | I2C Serial Data |
| **OLED Display** | SCL | `GPIO 22` | I2C Serial Clock |

### **ESP32 Slave Node Pinout**
| Component | Function | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **TDS Sensor** | Analog Input | `GPIO 34` | ADC1 Input (0–2.3V output range) |
| **Turbidity Sensor** | Analog Input | `GPIO 35` | ADC1 Input (via 10kΩ/22kΩ voltage divider) |
| **DS18B20 Temp** | OneWire Data | `GPIO 4` | Digital Input (Requires 4.7kΩ pull-up resistor to 3.3V) |
| **PCF8563 RTC** | SDA / SCL / INT | `D25`, `D26`, `D27` | I2C Bus & `ext0` Hardware Wakeup Interrupt (Active LOW) |
| **Ra-02 LoRa** | SPI Transceiver | `D19`(SCK), `D18`(MISO), `D23`(MOSI), `D5`(NSS), `D16`(RST), `D17`(DIO0) | Hardware SPI LoRa Transceiver |
| **MOSFET Gate** | Power Control | `GPIO 33` | High-Side Switch (3.3V HIGH = 5V ON, LOW = 5V OFF) |

---

## 4. Power Management Architecture (High-Side Load Switch)

To ensure long-term solar battery operation, the Slave Node uses a custom High-Side Power Gating switch:
- **Components**: 2N7000 (N-Channel MOSFET) and IRF4905 (P-Channel MOSFET).
- **Power Logic**:
  1. Upon boot, ESP32 sets `GPIO 33` **HIGH (3.3V)**.
  2. The 2N7000 turns ON, pulling the IRF4905 Gate to **GND**.
  3. The IRF4905 turns ON, allowing 5V from MT3608 Boost Converter to power TDS and Turbidity sensors.
  4. After sampling and transmitting via LoRa, ESP32 sets `GPIO 33` **LOW**.
  5. Power to analog sensors is completely cut off, preventing battery drain and sensor probe electrolysis during deep sleep.

---

## 5. Security & Encryption Specification

The Wi-Fi link between Master Node and Dashboard app is secured using **AES-256-GCM**:
- **Key Derivation**: `SHA-256(AP_PASSWORD)` -> 256-bit symmetric cipher key.
- **IV Generation**: 12-byte cryptographically secure random IV via `esp_random()`.
- **Auth Tag**: 16-byte GCM authentication tag for tamper verification.
- **Base64 JSON Envelope**:
  ```json
  {
    "iv": "base64_string",
    "tag": "base64_string",
    "data": "base64_string"
  }
  ```

---

## 6. Required Libraries & Setup

To compile both Master and Slave firmware in Arduino IDE:
1. **Board Package**: ESP32 by Espressif Systems (v2.x or v3.x).
2. **Libraries** (Tools -> Manage Libraries):
   - `WebSockets` by Markus Sattler (Links2004)
   - `ArduinoJson` by Benoit Blanchon
   - `LoRa` by Sandeep Mistry
   - `Adafruit GFX Library` & `Adafruit SSD1306`
   - `DallasTemperature` & `OneWire` (for Slave Node)

---

## 7. Whole-System Verification Steps

1. Upload `AquaLoRa_MasterNode.ino` to Master ESP32.
2. Verify Serial Monitor prints AP IP `192.168.4.1` and WebSocket server on port `8081`.
3. Upload `AquaLoRa_SlaveNode.ino` to Slave ESP32.
4. Verify Slave Node powers ON sensors, reads metrics, sends LoRa packet, and enters RTC deep sleep.
5. Verify Master Node OLED updates live with metrics.
6. Connect PC Wi-Fi to `AquaLoRa-MasterNode` (pass: `aqualora123`), start Dashboard app, and confirm live data stream.
