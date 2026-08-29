# Master Node Firmware — AquaLoRa Marine Telemetry System

Production firmware for the office gateway Master Node unit (**SLIIT IE3044 Design Project**).

---

## 1. System Overview

The Master Node acts as the gateway between the pond-side slave nodes and the desktop application:

1. **LoRa Receiver**: Receives 433 MHz RF packets over SPI from Slave Nodes (`"slave-01,25.40,320,1.50"`).
2. **OLED Display Driver**: Renders live telemetry metrics and system status directly to a 1.3" SH1106 / 0.96" SSD1306 OLED screen (I2C).
3. **External WiFi / WebSocket Gateway**: Connects to a normal farm or office WiFi network and exposes an AES-256-GCM encrypted WebSocket endpoint such as `ws://192.168.1.50:8081` for the desktop dashboard.

This is the final deployment model used in the project: the Master Node joins an external WiFi network instead of depending on the ESP32 AP alone. The desktop app then connects to the Master Node over the LAN and syncs local readings to the cloud backend as a secondary backup.

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

| Component        | Function | ESP32 GPIO | Description                      |
| :--------------- | :------- | :--------- | :------------------------------- |
| **Ra-02 LoRa**   | SPI SCK  | `GPIO 18`  | Hardware SPI Clock               |
| **Ra-02 LoRa**   | SPI MISO | `GPIO 19`  | Hardware SPI Master In Slave Out |
| **Ra-02 LoRa**   | SPI MOSI | `GPIO 23`  | Hardware SPI Master Out Slave In |
| **Ra-02 LoRa**   | SPI NSS  | `GPIO 5`   | SPI Chip Select Line             |
| **Ra-02 LoRa**   | Reset    | `GPIO 27`  | LoRa Reset Line                  |
| **Ra-02 LoRa**   | DIO0     | `GPIO 13`  | LoRa Interrupt Line              |
| **OLED Display** | I2C SDA  | `GPIO 21`  | Hardware I2C Data                |
| **OLED Display** | I2C SCL  | `GPIO 22`  | Hardware I2C Clock               |

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

### External WiFi / router mode (final production path)

1. Configure the ESP32 to join an external WiFi router by setting:
   - `WIFI_USE_EXTERNAL_NETWORK 1`
   - `EXTERNAL_WIFI_SSID = "YourRouterSSID"`
   - `EXTERNAL_WIFI_PASSWORD = "YourRouterPassword"`
2. Flash the firmware and power the ESP32.
3. The ESP32 joins the router and assigns itself a LAN IP, for example `192.168.1.50`.
4. In the desktop app, open **Settings → Connection** and set:
   - WiFi SSID = the same external WiFi network
   - WiFi password = router password
   - Master Node URL = `ws://192.168.1.50:8081`
   - Cloud backup URL = `https://aqualora.up.railway.app`
5. The desktop app connects to the Master Node over the router and begins local monitoring plus cloud sync.

This is the final architecture for the project: normal office/farm WiFi for the Master Node, local SQLite as the operational database, and the Railway backend as a cloud backup layer.

### AP mode (legacy / fallback)

AP mode is still supported as a fallback and troubleshooting mode, but it is no longer the primary deployment method for the final system. In AP mode, the ESP32 creates its own network and serves the dashboard at `ws://192.168.4.1:8081`.
