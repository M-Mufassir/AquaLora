# AquaLoRa Master Node Firmware

This folder contains the production gateway firmware. It receives real LoRa packets from Slave Nodes, renders the latest packet on the OLED, and forwards telemetry to the AquaLoRa desktop application.

## Production data path

```text
Slave sensors -> SX1278/RA-02 LoRa -> ESP32 Master Node
              -> AES-256-GCM WebSocket -> Desktop SQLite/cloud sync
              -> UDP discovery beacon (port 8082)
```

The WebSocket protocol is compatible with the tested dummy firmware and desktop application. The production difference is that `lora_receiver.h` parses real LoRa packets instead of generating random values.

## Files

| File | Responsibility |
|---|---|
| `AquaLoRa_MasterNode.ino` | Initializes Wi-Fi, WebSocket, OLED, and LoRa; runs the loop |
| `config.h` | Pins, RF settings, Wi-Fi mode, gateway identity, discovery settings |
| `lora_receiver.h` | SX1278 setup and LoRa telemetry parsing |
| `secure_ws.h` | AES-256-GCM WebSocket gateway, node registry, commands, UDP discovery |
| `display.h` | SH1106/SSD1306 OLED rendering |

`AquaLoRa_MasterNode_Dummy` is retained only as a desktop integration fixture. It is not the firmware to flash for a real installation.

## Hardware

| Device | ESP32 pin |
|---|---:|
| LoRa SCK / MISO / MOSI | 18 / 19 / 23 |
| LoRa NSS / RESET / DIO0 | 5 / 27 / 13 |
| OLED SDA / SCL | 21 / 22 |

The RA-02 and Slave Node must use identical RF settings: 433 MHz, 125 kHz bandwidth, SF7, coding rate 4/5, and sync word `0xF3`.

## LoRa payload contract

The parser accepts:

```text
node_id,temperature,tds,turbidity,ph
```

It also accepts the legacy four-field form and defaults pH to `7.0`:

```text
node_id,temperature,tds,turbidity
```

Example: `slave-01,28.50,220,35.20,7.40`.

The gateway adds the UTC timestamp and LoRa RSSI, then sends desktop-compatible JSON containing `node_id`, `timestamp`, `temperature`, `turbidity`, `tds`, `ph`, `battery_pct`, and `rssi`. Battery is currently `95` because the existing LoRa payload has no battery field.

## Wi-Fi and security

The default AP configuration is:

- SSID: `AquaLoRa-MasterNode`
- Password: `aqualora123`
- WebSocket: `ws://192.168.4.1:8081`
- UDP discovery: port `8082`

For router deployment, set `WIFI_USE_EXTERNAL_NETWORK` to `1` and configure the external credentials. If the router is unavailable, the firmware falls back to AP mode. WebSocket messages use the shared AES-256-GCM `{ "iv", "tag", "data" }` envelope with a SHA-256 key derived from the Wi-Fi password.

## Build and flash

Install the ESP32 Arduino board package and these libraries:

- WebSockets by Markus Sattler
- ArduinoJson by Benoit Blanchon
- LoRa by Sandeep Mistry
- Adafruit GFX Library
- Adafruit SSD1306

Open `AquaLoRa_MasterNode/AquaLoRa_MasterNode.ino`, select **ESP32 Dev Module**, upload, and monitor at **115200 baud**.

Before field deployment:

1. Confirm wiring and antenna connection.
2. Match RF settings with the Slave Node.
3. Change the default Wi-Fi password.
4. Configure router credentials if using station mode.
5. Confirm OLED and LoRa initialization messages.
6. Send a real Slave Node packet and verify parsed values in Serial Monitor.
7. Pair the desktop using discovery or the WebSocket URL.

## Desktop pairing

The gateway broadcasts an unencrypted UDP presence beacon every three seconds. On WebSocket connection it sends a `node_list` message, then broadcasts each received LoRa reading to connected desktop clients. The desktop stores readings locally and does not require cloud connectivity. Pairing another Master Node does not erase existing local telemetry.

## Current limitation

Battery percentage is a gateway fallback (`95`) because the current LoRa packet contract has no battery field. Add that field to the Slave Node contract before replacing the fallback.
