# AquaLoRa ESP32 Test Firmware

This sketch is for one ESP32 Dev Module. It joins an existing Wi-Fi router and sends simulated telemetry to the desktop application every 10 seconds.

## Values sent

Each message contains:

- `temperature`
- `turbidity`
- `tds`
- `ph`

The simulated sensor node is identified as `AQL-001`.

## Arduino IDE setup

1. Install the ESP32 board package and select **ESP32 Dev Module**.
2. Install these libraries from Library Manager:
   - WebSockets by Markus Sattler
   - ArduinoJson by Benoit Blanchon
3. Open `AquaLoRa_ESP32_Test.ino`.
4. Replace `WIFI_SSID` and `WIFI_PASSWORD` with the same router used by the desktop computer.
5. Upload the sketch and open Serial Monitor at `115200` baud.
6. Copy the printed ESP32 IP address, for example `192.168.1.50`.

## Desktop pairing

In the desktop app, configure the Master Node URL as:

```text
ws://<ESP32_IP>:8081
```

Use the pairing password below when the desktop asks for the Wi-Fi/encryption password:

```text
aqualora123
```

The desktop must be connected to the same router as the ESP32. The desktop will decrypt and store the readings locally, then upload them to the configured cloud backend.

## Cloud login credentials

The ESP32 does not call the cloud API directly. Before testing cloud sync, an administrator must create this customer Master Node in the web admin console:

```text
Node code: AQL-001
Password: AQL-001
Role: customer
Status: active
```

Use `AQL-001` / `AQL-001` to activate the desktop cloud session and to sign in to the mobile application. After signing in, the customer can change the password from the profile/settings flow.

These are separate secrets:

- `AQL-001`: initial cloud customer password.
- `aqualora123`: desktop-to-ESP32 encryption/pairing password.
- Your router password: only used by the ESP32 to join Wi-Fi.

## Expected flow

```text
ESP32 -> encrypted WebSocket -> Desktop SQLite -> cloud backend -> Mobile app / Web admin
```

The web application remains administrator-only. The mobile and desktop cloud clients use customer credentials.
