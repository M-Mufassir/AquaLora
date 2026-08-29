# Master Node Firmware — AquaLoRa Marine Telemetry System

Production firmware for the office gateway Master Node unit (**SLIIT IE3044 Design Project**).

---

## 1. System Overview

The Master Node acts as a dual-bridge telemetry gateway:
1. **LoRa Receiver**: Receives 433 MHz RF packets over SPI from Slave Nodes (`"slave-01,25.40,320,1.50"`).
2. **OLED Display Driver**: Renders live telemetry metrics and system status directly to a 1.3" SH1106 / 0.96" SSD1306 OLED screen (I2C).
3. **Wi-Fi Access Point & WebSocket Gateway**: Runs its own Wi-Fi Access Point (`AquaLoRa-MasterNode`) and AES-256-GCM encrypted WebSocket server (`ws://192.168.4.1:8081`) to push live data to the desktop dashboard app.

---

## 2. Directory Structure

```text
master_node/
├── AquaLoRa_MasterNode/         Production Master Node Firmware (LoRa SPI + OLED + Wi-Fi AP + AES-256-GCM)
│   ├── AquaLoRa_MasterNode.ino  Main sketch (Setup AP, OLED, LoRa & Dual Processing Loop)
│   ├── config.h                 Hardware pinouts, Wi-Fi credentials & RF frequency settings
│   ├── display.h                OLED display driver (SH1106 page mode & SSD1306 support)
│   ├── lora_receiver.h          SX1278 SPI driver & comma-separated payload parser
│   └── secure_ws.h              AES-256-GCM mbedtls cipher & WebSocketsServer gateway
│
├── AquaLoRa_MasterNode_Dummy/   Dev Mock Stand-in (Simulated telemetry without LoRa HW)
└── README.md                    This documentation file
```

---

## 3. Hardware Pinout & Specs

| Component | Function | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **Ra-02 LoRa** | SPI SCK | `GPIO 18` | Hardware SPI Clock |
| **Ra-02 LoRa** | SPI MISO | `GPIO 19` | Hardware SPI Master In Slave Out |
| **Ra-02 LoRa** | SPI MOSI | `GPIO 23` | Hardware SPI Master Out Slave In |
| **Ra-02 LoRa** | SPI NSS | `GPIO 5` | SPI Chip Select Line |
| **Ra-02 LoRa** | Reset | `GPIO 27` | LoRa Reset Line |
| **Ra-02 LoRa** | DIO0 | `GPIO 13` | LoRa Interrupt Line |
| **OLED Display** | I2C SDA | `GPIO 21` | Hardware I2C Data |
| **OLED Display** | I2C SCL | `GPIO 22` | Hardware I2C Clock |

---

## 4. Encryption & Communication Protocol

- **Wi-Fi Access Point**: SSID `AquaLoRa-MasterNode`, Password `aqualora123`.
- **WebSocket Server**: Port `8081` at gateway IP `192.168.4.1`.
- **AES-256-GCM Encryption**: Every message is encrypted using `mbedtls` with a 256-bit key derived via `SHA-256("aqualora123")`.
- **JSON Data Contract**:
  ```json
  {
    "node_id": "slave-01",
    "timestamp": "2026-08-22T12:00:00Z",
    "temperature": 28.5,
    "turbidity": 35.2,
    "tds": 220,
    "battery_pct": 95,
    "rssi": -62
  }
  ```
- **Base64 JSON Envelope**:
  ```json
  {
    "iv": "base64_iv_12_bytes",
    "tag": "base64_tag_16_bytes",
    "data": "base64_ciphertext"
  }
  ```

---

## 5. Setup & Compilation

1. **Arduino IDE**: File → Preferences → Additional Boards Manager URLs, add:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. **Install Required Libraries**:
   - `WebSockets` by Markus Sattler (Links2004)
   - `ArduinoJson` by Benoit Blanchon
   - `LoRa` by Sandeep Mistry
   - `Adafruit GFX Library` & `Adafruit SSD1306`
3. Open `AquaLoRa_MasterNode/AquaLoRa_MasterNode.ino`.
4. Select board **ESP32 Dev Module**, select COM port, and click **Upload**.
5. Open Serial Monitor at **115200 baud** to view boot logs.

---

## 6. Pairing with Dashboard App

1. Power the ESP32 Master Node.
2. On your PC, connect to Wi-Fi SSID **`AquaLoRa-MasterNode`** (password: **`aqualora123`**).
3. Open Desktop Application dashboard -> **Settings -> Connect Device**.
4. Enter password `aqualora123` and connect. The dashboard links to `ws://192.168.4.1:8081` and streams live telemetry!
