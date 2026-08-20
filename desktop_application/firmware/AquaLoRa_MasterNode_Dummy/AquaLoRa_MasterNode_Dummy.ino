// AquaLoRa — Dummy Master Node firmware
//
// Stand-in for the real Master Node while the LoRa/Slave Node side isn't
// available yet. Creates its own WiFi access point (exactly how the real
// Master Node will work — the dashboard pairs directly with it, no home
// router involved) and runs a WebSocket server that speaks the exact same
// protocol as desktop_application/mock_master_node.js, so the dashboard's
// Connect Device wizard and live-data pipeline can be tested end-to-end
// against real hardware before real sensors exist.
//
// Plain WebSocket, no TLS/auth — matches the dashboard's current state
// (direct transfer for now, a security pass is explicitly future work).
//
// Board: any ESP32 Dev Module (Arduino IDE, esp32 board package).
// Libraries (Library Manager):
//   - "WebSockets" by Markus Sattler (Links2004/arduinoWebSockets)
//   - "ArduinoJson" by Benoit Blanchon
//
// See firmware/README.md for setup steps.

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>

// ---- WiFi AP config — must match what the dashboard's Connect Device
// wizard expects the user to pick from the network list. -------------------
static const char* AP_SSID = "AquaLoRa-MasterNode";
static const char* AP_PASSWORD = "aqualora123";  // WPA2 min length is 8 chars
static const uint16_t WS_PORT = 8081;            // matches mock_master_node.js

// ---- Dummy sensor node profiles — same tuned ranges as
// mock_master_node.js, so Fish Health Index status tiers still demo
// correctly (one healthy, one mixed, one borderline). ----------------------
struct DummyNode {
  const char* node_id;
  float tempMin, tempMax;
  float turbMin, turbMax;
  int tdsMin, tdsMax;
};

static DummyNode NODES[] = {
  { "slave-01", 24, 31, 5, 60, 150, 320 },
  { "slave-02", 27, 29, 5, 18, 180, 260 },
  { "slave-03", 23, 33, 28, 50, 200, 360 }
};
static const int NODE_COUNT = sizeof(NODES) / sizeof(NODES[0]);

static unsigned long samplingIntervalMs = 10000;  // default 10s, same as the mock
static unsigned long lastSendMs[NODE_COUNT] = { 0 };

WebSocketsServer webSocket(WS_PORT);

// Timestamp is a placeholder: the AP-only ESP32 has no internet access for
// NTP, so there's no way to get real wall-clock time. We seed the system
// clock once at boot with a fixed date and let it free-run from there —
// timestamps come out as well-formed, monotonically increasing ISO 8601
// strings (what the dashboard needs for sorting/range queries), just not
// tied to the real calendar date. Fine for a connection-workflow test.
static void seedFakeClock() {
  struct timeval tv = { .tv_sec = 1767225600, .tv_usec = 0 };  // 2026-01-01T00:00:00Z
  settimeofday(&tv, nullptr);
}

static String isoTimestampNow() {
  time_t now = time(nullptr);
  struct tm tmInfo;
  gmtime_r(&now, &tmInfo);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmInfo);
  return String(buf);
}

static float randomFloat(float lo, float hi) {
  return lo + (hi - lo) * (float)random(0, 10001) / 10000.0f;
}

static void sendNodeList(uint8_t clientId) {
  StaticJsonDocument<256> doc;
  doc["type"] = "node_list";
  JsonArray arr = doc.createNestedArray("nodes");
  for (int i = 0; i < NODE_COUNT; i++) {
    JsonObject o = arr.createNestedObject();
    o["node_id"] = NODES[i].node_id;
  }
  String out;
  serializeJson(doc, out);
  webSocket.sendTXT(clientId, out);
  Serial.println("[master] sent node_list: " + out);
}

static void broadcastReading(const DummyNode& node) {
  StaticJsonDocument<256> doc;
  doc["node_id"] = node.node_id;
  doc["timestamp"] = isoTimestampNow();
  doc["temperature"] = randomFloat(node.tempMin, node.tempMax);
  doc["turbidity"] = randomFloat(node.turbMin, node.turbMax);
  doc["tds"] = random(node.tdsMin, node.tdsMax);
  doc["battery_pct"] = random(60, 100);
  doc["rssi"] = -random(50, 90);
  String out;
  serializeJson(doc, out);
  webSocket.broadcastTXT(out);
  Serial.println("[master] sent reading: " + out);
}

static void handleDownlinkCommand(uint8_t* payload, size_t length) {
  StaticJsonDocument<256> cmd;
  DeserializationError err = deserializeJson(cmd, payload, length);
  if (err) {
    Serial.println("[master] received non-JSON downlink message");
    return;
  }
  const char* type = cmd["type"] | "";
  if (strcmp(type, "set_interval") == 0) {
    long minutes = cmd["minutes"] | 10;
    samplingIntervalMs = (unsigned long)minutes * 60000UL;
    Serial.printf("[master] set_interval -> %ld minute(s)\n", minutes);
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("[master] dashboard connected (client #%u)\n", num);
      sendNodeList(num);
      // Force every node to send immediately on this new connection, then
      // fall back to its normal interval.
      for (int i = 0; i < NODE_COUNT; i++) lastSendMs[i] = 0;
      break;
    case WStype_DISCONNECTED:
      Serial.printf("[master] dashboard disconnected (client #%u)\n", num);
      break;
    case WStype_TEXT:
      handleDownlinkCommand(payload, length);
      break;
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  seedFakeClock();
  randomSeed(esp_random());

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("[master] AP started, SSID: ");
  Serial.println(AP_SSID);
  Serial.print("[master] AP IP address: ");
  Serial.println(WiFi.softAPIP());  // normally 192.168.4.1

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.printf("[master] WebSocket server listening on port %u\n", WS_PORT);
}

void loop() {
  webSocket.loop();

  unsigned long now = millis();
  for (int i = 0; i < NODE_COUNT; i++) {
    if (now - lastSendMs[i] >= samplingIntervalMs) {
      lastSendMs[i] = now;
      broadcastReading(NODES[i]);
    }
  }
}
