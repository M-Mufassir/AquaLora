// AquaLoRa — Dummy Master Node firmware (Test / Simulation Mode)
//
// Stand-in for the real Master Node when physical LoRa hardware / slave nodes
// are not available. Operates in pure Station (STA) Wi-Fi mode (no AP mode),
// connecting to an external Wi-Fi router / mobile hotspot, matching the exact
// production Master Node network architecture.
//
// Features:
// 1. Pure Station Mode: Joins external 2.4 GHz hotspot ("Aqualora" / "Aqualora ")
//    with automatic background reconnection.
// 2. Distinct Test Authentication:
//    - Node Code: "AQL-TEST"
//    - Gateway ID: "test-master-node"
//    - Pairing / Cloud Password: "testmaster123"
//    - AES-256-GCM encryption key derived from SHA-256("testmaster123")
//    Completely segregates simulation testing from the production AQL-0001 master node.
// 3. Autonomous Cloud Sync: Syncs telemetry directly to Azure backend in real-time,
//    so mobile phone users can monitor readings even when desktop app is OFF.
// 4. Simultaneous Encrypted WebSocket: Broadcasts AES-256-GCM encrypted readings
//    to the desktop application when connected.
// 5. Real NTP Wall-Clock Time Sync with Downlink fallback: Accurately timestamps
//    readings using SNTP time servers.
// 6. LAN UDP Discovery Beacon: Periodically announces test master presence on port 8082.
//
// Board: any ESP32 Dev Module (Arduino IDE, esp32 board package).
// Libraries (Library Manager):
//   - "WebSockets" by Markus Sattler (Links2004/arduinoWebSockets)
//   - "ArduinoJson" by Benoit Blanchon
// mbedtls (AES-GCM, SHA-256, base64) ships with the esp32 board package.

#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include <mbedtls/gcm.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>

// ============================================================================
// CLOUD BACKEND DIRECT SYNC CONFIGURATION (Simulation / Test Credentials)
// ============================================================================
#define CLOUD_SYNC_ENABLED 1
#define CLOUD_API_BASE_URL "https://aqualora-backend-brdufwffeddhd6a8.centralindia-01.azurewebsites.net/api"
#define CLOUD_NODE_CODE "AQL-TEST"
#define CLOUD_PASSWORD "testmaster123"
#define CLOUD_CLIENT_ID "masternode"
#define CLOUD_REQUEST_TIMEOUT_MS 4000

// ============================================================================
// TEST MASTER IDENTITY & AES-256-GCM AUTHENTICATION
// ============================================================================
#define MASTER_NODE_ID "test-master-node"
#define MASTER_NODE_CODE "AQL-TEST"
#define MASTER_DISPLAY_NAME "Test Master Node (Simulation)"
static const char *GATEWAY_PASSWORD = "testmaster123"; ///< Pairing secret & AES key seed

// ============================================================================
// PURE STATION WI-FI CONFIGURATION (NO AP MODE)
// ============================================================================
#define WIFI_SSID "Aqualora "              ///< Hotspot SSID (phone hotspot often has trailing space)
#define WIFI_SSID_ALT "Aqualora"           ///< Fallback without space
#define WIFI_PASSWORD "Aqualora"           ///< Hotspot Password
static const uint16_t WS_PORT = 8081;             ///< WebSocket Server Port
static const uint16_t UDP_DISCOVERY_PORT = 8082;   ///< Desktop discovery beacon port
static const unsigned long UDP_BROADCAST_INTERVAL_MS = 2000;

static WiFiUDP udpDiscovery;
static unsigned long lastUdpBroadcastMs = 0;
static bool g_wifiConnectedHandled = false;

// ============================================================================
// DUMMY SENSOR NODE PROFILES
// ============================================================================
struct DummyNode
{
  const char *node_id;
  float tempMin, tempMax;
  float turbMin, turbMax;
  int tdsMin, tdsMax;
};

static DummyNode NODES[] = {
    {"slave-01", 24, 31, 5, 60, 150, 320},
    {"slave-02", 27, 29, 5, 18, 180, 260},
    {"slave-03", 23, 33, 28, 50, 200, 360}};
static const int NODE_COUNT = sizeof(NODES) / sizeof(NODES[0]);

static unsigned long samplingIntervalMs = 10000; // default 10s
static unsigned long lastSendMs[NODE_COUNT] = {0};

WebSocketsServer webSocket(WS_PORT);

// ============================================================================
// AES-256-GCM ENCRYPTION (key = SHA-256(GATEWAY_PASSWORD))
// ============================================================================
static mbedtls_gcm_context gcmCtx;
static const size_t GCM_IV_LEN = 12;
static const size_t GCM_TAG_LEN = 16;
static const size_t MAX_PLAINTEXT_LEN = 256;

static void initCipher()
{
  uint8_t key[32];
  const mbedtls_md_info_t *mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md(mdInfo, (const unsigned char *)GATEWAY_PASSWORD, strlen(GATEWAY_PASSWORD), key);
  mbedtls_gcm_init(&gcmCtx);
  mbedtls_gcm_setkey(&gcmCtx, MBEDTLS_CIPHER_ID_AES, key, 256);
  Serial.printf("[test-master] AES-256-GCM initialized with key from '%s'\n", GATEWAY_PASSWORD);
}

static void fillRandom(uint8_t *buf, size_t len)
{
  size_t i = 0;
  while (i < len)
  {
    uint32_t r = esp_random();
    size_t n = min((size_t)4, len - i);
    memcpy(buf + i, &r, n);
    i += n;
  }
}

static String encryptEnvelope(const String &plaintext)
{
  size_t len = plaintext.length();
  if (len == 0 || len > MAX_PLAINTEXT_LEN)
    return String();

  uint8_t iv[GCM_IV_LEN];
  fillRandom(iv, GCM_IV_LEN);

  uint8_t cipherBuf[MAX_PLAINTEXT_LEN];
  uint8_t tag[GCM_TAG_LEN];
  int ret = mbedtls_gcm_crypt_and_tag(
      &gcmCtx, MBEDTLS_GCM_ENCRYPT, len,
      iv, GCM_IV_LEN,
      nullptr, 0,
      (const uint8_t *)plaintext.c_str(), cipherBuf,
      GCM_TAG_LEN, tag);
  if (ret != 0)
    return String();

  char ivB64[32];
  char tagB64[32];
  char dataB64[360];
  size_t olen;
  mbedtls_base64_encode((uint8_t *)ivB64, sizeof(ivB64), &olen, iv, GCM_IV_LEN);
  mbedtls_base64_encode((uint8_t *)tagB64, sizeof(tagB64), &olen, tag, GCM_TAG_LEN);
  mbedtls_base64_encode((uint8_t *)dataB64, sizeof(dataB64), &olen, cipherBuf, len);
  dataB64[olen] = '\0';

  StaticJsonDocument<640> env;
  env["iv"] = ivB64;
  env["tag"] = tagB64;
  env["data"] = dataB64;
  String out;
  serializeJson(env, out);
  return out;
}

static bool decryptEnvelope(const String &envelopeJson, String &outPlain)
{
  StaticJsonDocument<640> env;
  if (deserializeJson(env, envelopeJson) != DeserializationError::Ok)
    return false;

  const char *ivB64 = env["iv"] | "";
  const char *tagB64 = env["tag"] | "";
  const char *dataB64 = env["data"] | "";
  if (!*ivB64 || !*tagB64 || !*dataB64)
    return false;

  uint8_t iv[GCM_IV_LEN];
  uint8_t tag[GCM_TAG_LEN];
  uint8_t cipherBuf[MAX_PLAINTEXT_LEN];
  size_t olen;

  if (mbedtls_base64_decode(iv, sizeof(iv), &olen, (const uint8_t *)ivB64, strlen(ivB64)) != 0 || olen != GCM_IV_LEN)
    return false;
  if (mbedtls_base64_decode(tag, sizeof(tag), &olen, (const uint8_t *)tagB64, strlen(tagB64)) != 0 || olen != GCM_TAG_LEN)
    return false;
  if (mbedtls_base64_decode(cipherBuf, sizeof(cipherBuf), &olen, (const uint8_t *)dataB64, strlen(dataB64)) != 0)
    return false;

  size_t cipherLen = olen;
  uint8_t plainBuf[MAX_PLAINTEXT_LEN + 1];
  int ret = mbedtls_gcm_auth_decrypt(
      &gcmCtx, cipherLen,
      iv, GCM_IV_LEN,
      nullptr, 0,
      tag, GCM_TAG_LEN,
      cipherBuf, plainBuf);
  if (ret != 0)
    return false;

  plainBuf[cipherLen] = '\0';
  outPlain = String((char *)plainBuf);
  return true;
}

// ============================================================================
// SNTP TIME SYNCHRONIZATION
// ============================================================================
static bool g_clockSynchronized = false;
static String g_cloudAuthToken = "";

static void initNtpClock()
{
  Serial.println(F("[test-master] initializing SNTP time synchronization..."));
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
}

static void seedInitialClock()
{
  time_t now = time(nullptr);
  if (now < 1000000)
  {
    // Fallback seed epoch (October 2026) to prevent 1970 zero timestamps if offline
    struct timeval tv = {.tv_sec = 1793263200, .tv_usec = 0};
    settimeofday(&tv, nullptr);
  }
}

static String isoTimestampNow()
{
  time_t now = time(nullptr);
  struct tm tmInfo;
  gmtime_r(&now, &tmInfo);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmInfo);
  return String(buf);
}

static float randomFloat(float lo, float hi)
{
  return lo + (hi - lo) * (float)random(0, 10001) / 10000.0f;
}

// ============================================================================
// CLOUD BACKEND LOGIN & REAL-TIME SYNCHRONIZATION
// ============================================================================
static bool loginCloudBackend()
{
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure secClient;
  secClient.setInsecure();
  HTTPClient http;
  http.setTimeout(CLOUD_REQUEST_TIMEOUT_MS);

  String loginUrl = String(CLOUD_API_BASE_URL) + "/auth/login";
  if (!http.begin(secClient, loginUrl))
    return false;

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> reqDoc;
  reqDoc["node_code"] = CLOUD_NODE_CODE;
  reqDoc["password"] = CLOUD_PASSWORD;
  reqDoc["client"] = CLOUD_CLIENT_ID;

  String reqBody;
  serializeJson(reqDoc, reqBody);

  Serial.printf("[test-master] authenticating to cloud as '%s'...\n", CLOUD_NODE_CODE);
  int httpCode = http.POST(reqBody);

  if (httpCode == 200)
  {
    String respPayload = http.getString();
    StaticJsonDocument<512> respDoc;
    DeserializationError err = deserializeJson(respDoc, respPayload);
    if (!err)
    {
      const char *token = respDoc["access_token"] | respDoc["token"] | "";
      if (strlen(token) > 0)
      {
        g_cloudAuthToken = String(token);
        Serial.println(F("[test-master] cloud auth SUCCESS: JWT token acquired for Test Master!"));
        http.end();
        return true;
      }
    }
  }
  else
  {
    Serial.printf("[test-master] cloud login returned HTTP %d\n", httpCode);
  }

  http.end();
  return false;
}

static bool syncReadingToCloud(const char *nodeId, const String &timestamp, float temp, int tds, float turb, float ph, int rssi)
{
#if CLOUD_SYNC_ENABLED
  if (WiFi.status() != WL_CONNECTED)
    return false;

  if (g_cloudAuthToken.length() == 0)
  {
    if (!loginCloudBackend())
      return false;
  }

  WiFiClientSecure secClient;
  secClient.setInsecure();
  HTTPClient http;
  http.setTimeout(CLOUD_REQUEST_TIMEOUT_MS);

  String syncUrl = String(CLOUD_API_BASE_URL) + "/readings/sync";
  if (!http.begin(secClient, syncUrl))
    return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + g_cloudAuthToken);

  StaticJsonDocument<512> doc;
  JsonArray readings = doc.createNestedArray("readings");
  JsonObject r = readings.createNestedObject();
  r["node_id"] = nodeId;
  r["timestamp"] = timestamp;
  r["temperature"] = temp;
  r["turbidity"] = turb;
  r["tds"] = tds;
  r["ph"] = ph;
  r["pond_type"] = "tilapia";
  r["battery_pct"] = 95;
  r["rssi"] = rssi;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode == 200 || httpCode == 201)
  {
    Serial.printf("[test-master] reading synced to cloud: %s @ %s (HTTP %d)\n", nodeId, timestamp.c_str(), httpCode);
    http.end();
    return true;
  }
  else if (httpCode == 401)
  {
    g_cloudAuthToken = "";
    http.end();
    if (loginCloudBackend())
    {
      WiFiClientSecure retryClient;
      retryClient.setInsecure();
      HTTPClient retryHttp;
      retryHttp.setTimeout(CLOUD_REQUEST_TIMEOUT_MS);
      if (retryHttp.begin(retryClient, syncUrl))
      {
        retryHttp.addHeader("Content-Type", "application/json");
        retryHttp.addHeader("Authorization", "Bearer " + g_cloudAuthToken);
        int retryCode = retryHttp.POST(body);
        retryHttp.end();
        return (retryCode == 200 || retryCode == 201);
      }
    }
  }

  http.end();
#endif
  return false;
}

// ============================================================================
// WEBSOCKET COMMUNICATION (DESKTOP DASHBOARD)
// ============================================================================
static void sendEncrypted(uint8_t clientId, const String &plain, const char *label)
{
  String envelope = encryptEnvelope(plain);
  if (envelope.length() == 0)
  {
    Serial.printf("[test-master] encrypt failed, dropping %s\n", label);
    return;
  }
  webSocket.sendTXT(clientId, envelope);
}

static void broadcastEncrypted(const String &plain, const char *label)
{
  String envelope = encryptEnvelope(plain);
  if (envelope.length() == 0)
  {
    Serial.printf("[test-master] encrypt failed, dropping %s\n", label);
    return;
  }
  webSocket.broadcastTXT(envelope);
}

static void sendNodeList(uint8_t clientId)
{
  StaticJsonDocument<256> doc;
  doc["type"] = "node_list";
  JsonArray arr = doc.createNestedArray("nodes");
  for (int i = 0; i < NODE_COUNT; i++)
  {
    JsonObject o = arr.createNestedObject();
    o["node_id"] = NODES[i].node_id;
  }
  String plain;
  serializeJson(doc, plain);
  sendEncrypted(clientId, plain, "node_list");
}

static void broadcastReading(const DummyNode &node)
{
  String ts = isoTimestampNow();
  float temp = randomFloat(node.tempMin, node.tempMax);
  float turb = randomFloat(node.turbMin, node.turbMax);
  int tds = random(node.tdsMin, node.tdsMax);
  float ph = randomFloat(6.5, 8.5);
  int battery = random(60, 100);
  int rssi = -random(50, 90);

  // 1. Broadcast to Desktop via encrypted WebSocket
  StaticJsonDocument<256> doc;
  doc["node_id"] = node.node_id;
  doc["timestamp"] = ts;
  doc["temperature"] = temp;
  doc["turbidity"] = turb;
  doc["tds"] = tds;
  doc["ph"] = ph;
  doc["battery_pct"] = battery;
  doc["rssi"] = rssi;
  String plain;
  serializeJson(doc, plain);
  broadcastEncrypted(plain, "reading");

  // 2. Simultaneously synchronize directly to Cloud Backend
  // So readings reach the cloud & mobile app even when desktop app is off!
  syncReadingToCloud(node.node_id, ts, temp, tds, turb, ph, rssi);
}

static void handleDownlinkCommand(const String &plain)
{
  StaticJsonDocument<256> cmd;
  DeserializationError err = deserializeJson(cmd, plain);
  if (err)
  {
    Serial.println(F("[test-master] received non-JSON downlink message"));
    return;
  }
  const char *type = cmd["type"] | "";
  if (strcmp(type, "set_interval") == 0)
  {
    long minutes = cmd["minutes"] | 10;
    samplingIntervalMs = (unsigned long)minutes * 60000UL;
    Serial.printf("[test-master] set_interval -> %ld minute(s)\n", minutes);
  }
  else if (strcmp(type, "sync_time") == 0)
  {
    long epochSec = cmd["epoch"] | 0;
    if (epochSec > 1700000000)
    {
      struct timeval tv = {.tv_sec = (time_t)epochSec, .tv_usec = 0};
      settimeofday(&tv, nullptr);
      g_clockSynchronized = true;
      Serial.printf("[test-master] clock synchronized via downlink: %ld (Now: %s)\n", epochSec, isoTimestampNow().c_str());
    }
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
  switch (type)
  {
  case WStype_CONNECTED:
    Serial.printf("[test-master] dashboard connected (client #%u)\n", num);
    sendNodeList(num);
    for (int i = 0; i < NODE_COUNT; i++)
      lastSendMs[i] = 0;
    break;
  case WStype_DISCONNECTED:
    Serial.printf("[test-master] dashboard disconnected (client #%u)\n", num);
    break;
  case WStype_TEXT:
  {
    String envelope((char *)payload, length);
    String plain;
    if (!decryptEnvelope(envelope, plain))
    {
      Serial.println(F("[test-master] dropped downlink message: decrypt/auth failed (wrong password or tampered)"));
      break;
    }
    handleDownlinkCommand(plain);
    break;
  }
  default:
    break;
  }
}

// ============================================================================
// UDP PRESENCE DISCOVERY BEACON
// ============================================================================
static void broadcastPresence()
{
  StaticJsonDocument<256> doc;
  doc["service"] = "aqualora-master";
  doc["id"] = MASTER_NODE_ID;
  doc["code"] = MASTER_NODE_CODE;
  doc["name"] = MASTER_DISPLAY_NAME;
  doc["ip"] = WiFi.localIP().toString();
  doc["port"] = WS_PORT;
  doc["mode"] = "STA";

  String jsonStr;
  serializeJson(doc, jsonStr);

  // 1. Send to global broadcast address
  IPAddress globalBroadcast(255, 255, 255, 255);
  udpDiscovery.beginPacket(globalBroadcast, UDP_DISCOVERY_PORT);
  udpDiscovery.write((const uint8_t *)jsonStr.c_str(), jsonStr.length());
  udpDiscovery.endPacket();

  // 2. Send to directed subnet broadcast if connected
  if (WiFi.status() == WL_CONNECTED)
  {
    uint32_t ip = (uint32_t)WiFi.localIP();
    uint32_t mask = (uint32_t)WiFi.subnetMask();
    IPAddress subnetBroadcast = IPAddress(ip | ~mask);
    udpDiscovery.beginPacket(subnetBroadcast, UDP_DISCOVERY_PORT);
    udpDiscovery.write((const uint8_t *)jsonStr.c_str(), jsonStr.length());
    udpDiscovery.endPacket();
  }

  Serial.printf("[discovery] Test Master UDP beacon sent -> %s (IP: %s)\n",
                MASTER_NODE_CODE, WiFi.localIP().toString().c_str());
}

// ============================================================================
// ARDUINO SETUP
// ============================================================================
void setup()
{
  Serial.begin(115200);
  delay(100);
  Serial.println(F("\n=================================================="));
  Serial.println(F("   AquaLoRa Test Master Node (Simulation Mode)    "));
  Serial.println(F("=================================================="));

  seedInitialClock();
  randomSeed(esp_random());
  initCipher();

  // Pure Station Wi-Fi connection (NO AP MODE)
  WiFi.persistent(false);
  WiFi.disconnect(true, true);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);

  Serial.println(F("[WIFI] Scanning nearby Wi-Fi networks..."));
  int n = WiFi.scanNetworks(false, true);
  String targetSsid = WIFI_SSID;

  if (n > 0)
  {
    Serial.printf("[WIFI] Found %d Wi-Fi networks in range:\n", n);
    for (int i = 0; i < n; i++)
    {
      String scannedSsid = WiFi.SSID(i);
      int rssi = WiFi.RSSI(i);
      Serial.printf("       [%d] '%s' (RSSI: %d dBm)\n", i + 1, scannedSsid.c_str(), rssi);

      String trimmed = scannedSsid;
      trimmed.trim();
      if (trimmed.equalsIgnoreCase("Aqualora") || scannedSsid == WIFI_SSID || scannedSsid == WIFI_SSID_ALT)
      {
        targetSsid = scannedSsid;
        Serial.printf("[WIFI] >>> MATCHED Hotspot SSID: '%s' <<<\n", targetSsid.c_str());
      }
    }
  }
  WiFi.scanDelete();

  Serial.printf("[WIFI] Connecting to '%s' (Password: '%s')...\n", targetSsid.c_str(), WIFI_PASSWORD);
  WiFi.begin(targetSsid.c_str(), WIFI_PASSWORD);

  unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000UL)
  {
    delay(400);
    Serial.print(F("."));
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED)
  {
    g_wifiConnectedHandled = true;
    Serial.println(F("[WIFI] SUCCESS: Connected to external Wi-Fi Station!"));
    Serial.printf("[WIFI] IP Address: %s\n", WiFi.localIP().toString().c_str());
    initNtpClock();
    loginCloudBackend();
  }
  else
  {
    Serial.println(F("[WIFI] WARNING: Initial connection timed out. Auto-reconnect active in background."));
  }

  udpDiscovery.begin(UDP_DISCOVERY_PORT);
  Serial.printf("[test-master] UDP Discovery broadcasting on port %u\n", UDP_DISCOVERY_PORT);

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.printf("[test-master] WebSocket server listening on port %u (AES-256-GCM encrypted)\n", WS_PORT);
  Serial.println(F("==================================================\n"));
}

// ============================================================================
// ARDUINO MAIN LOOP
// ============================================================================
void loop()
{
  webSocket.loop();

  unsigned long now = millis();

  // Wi-Fi connection / reconnection state change handler
  if (WiFi.status() == WL_CONNECTED)
  {
    if (!g_wifiConnectedHandled)
    {
      g_wifiConnectedHandled = true;
      Serial.println(F("[WIFI] Reconnected to external Wi-Fi! Starting NTP sync and Cloud auth..."));
      initNtpClock();
      loginCloudBackend();
    }
  }
  else
  {
    g_wifiConnectedHandled = false;
  }

  // Periodically broadcast UDP discovery beacon (every 2 seconds)
  if (now - lastUdpBroadcastMs >= UDP_BROADCAST_INTERVAL_MS)
  {
    lastUdpBroadcastMs = now;
    broadcastPresence();
  }

  // Generate and dispatch dummy telemetry readings
  for (int i = 0; i < NODE_COUNT; i++)
  {
    if (now - lastSendMs[i] >= samplingIntervalMs)
    {
      lastSendMs[i] = now;
      broadcastReading(NODES[i]);
    }
  }
}
