# Dummy Master Node Firmware

Stand-in Master Node firmware for testing the dashboard's real-MCU WiFi pairing flow (Connect Device wizard) end-to-end on actual hardware, before the LoRa/Slave Node side exists. It creates its own WiFi access point and speaks the exact same WebSocket protocol as `../mock_master_node.js` — same JSON shapes, same port — so nothing on the dashboard side needs a special case for "real hardware vs. mock."

Plain WebSocket, no encryption/authentication, matching the dashboard's current state. A secure transport is scoped as future work once this connection workflow itself is validated.

## What it does

- Creates a WiFi AP: SSID `AquaLoRa-MasterNode`, password `aqualora123` (change both in the sketch if you want — just make sure they match what you type into the dashboard's wizard).
- Runs a WebSocket server on port `8081` at the AP's gateway address, `192.168.4.1` (the standard default for `WiFi.softAP()` — no configuration needed).
- The moment the dashboard connects, sends a `{"type":"node_list","nodes":[...]}` message listing 3 dummy sensor nodes (`slave-01`, `slave-02`, `slave-03`) — this is what makes the wizard show "3 nodes detected" immediately.
- Every 10 seconds (configurable), broadcasts a dummy reading per node matching the dashboard's fixed data contract:
  ```json
  { "node_id": "slave-01", "timestamp": "...", "temperature": 28.5, "turbidity": 35.2, "tds": 220, "battery_pct": 87, "rssi": -62 }
  ```
  Each node's value ranges are tuned the same way as the mock server, so all three Fish Health Index status tiers (Good/Warning/Critical) still demo correctly.
- Listens for `{"type":"set_interval","minutes":N}` downlink commands from the dashboard (sent when you change the sampling interval in the UI) and actually applies it.
- Timestamps are well-formed ISO 8601 but **not wall-clock accurate** — the AP-only ESP32 has no internet access for NTP, so the sketch seeds its clock once at boot with a fixed date and lets it free-run. Fine for testing the connection/data pipeline; not meant to represent real time.

## Setup

1. **Arduino IDE**: File → Preferences → Additional Boards Manager URLs, add:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   Then Tools → Board → Boards Manager → install "esp32" (by Espressif Systems).
2. **Libraries** (Tools → Manage Libraries):
   - `WebSockets` by Markus Sattler (this is the Links2004/arduinoWebSockets package)
   - `ArduinoJson` by Benoit Blanchon
3. Open `AquaLoRa_MasterNode_Dummy/AquaLoRa_MasterNode_Dummy.ino`, select your ESP32 board + port, and upload.
4. Open the Serial Monitor at 115200 baud to confirm it prints the AP SSID and IP address on boot.

## Testing against the dashboard

1. Power the ESP32.
2. In the dashboard, go to Settings → Device Connection → Connect Device (or it'll prompt automatically on first run).
3. Scan, pick `AquaLoRa-MasterNode` from the list (tagged "MCU"), enter `aqualora123`, connect.
4. The wizard should link to `ws://192.168.4.1:8081` and report "3 nodes detected" within a couple of seconds.
5. Continue to the dashboard — readings for `slave-01`/`02`/`03` should start appearing live within ~10s.

If the automatic WiFi join fails (Windows can require elevated permissions to add a new network profile via `netsh`), join `AquaLoRa-MasterNode` manually from Windows WiFi settings and click "I've connected manually — Continue" in the wizard; everything past that point works the same.

## Adjusting the dummy data

- Node count/ranges: edit the `NODES[]` array.
- Send interval: edit `samplingIntervalMs` (or just use the dashboard's sampling-interval control once connected — it sends a live `set_interval` command).
- SSID/password/port: edit the `AP_SSID` / `AP_PASSWORD` / `WS_PORT` constants at the top of the sketch.
