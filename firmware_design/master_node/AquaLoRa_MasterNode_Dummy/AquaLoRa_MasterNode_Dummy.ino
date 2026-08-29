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
// Every message is AES-256-GCM encrypted (confidentiality + tamper
// detection) using a key derived from AP_PASSWORD below — the same
// password the user types into the dashboard's wizard to join this AP, so
// there's nothing extra to provision. See secureChannel.ts on the dashboard
// side for the matching implementation; the envelope format
// ({"iv","tag","data"}, all base64) must stay identical on both ends.
//
// Board: any ESP32 Dev Module (Arduino IDE, esp32 board package).
// Libraries (Library Manager):
//   - "WebSockets" by Markus Sattler (Links2004/arduinoWebSockets)
//   - "ArduinoJson" by Benoit Blanchon
// mbedtls (AES-GCM, SHA-256, base64) ships with the esp32 board package —
// no extra library needed for the crypto itself.
//
// See README.md (this folder) for setup steps.

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include <mbedtls/gcm.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>

// ---- WiFi mode selection -------------------------------------------------
// The ESP32 can run in two modes:
//   1) AP mode: it starts its own WiFi access point, which matches the
//      original pairing flow used by the dashboard.
//   2) STA mode: it joins an existing external WiFi router, and the
//      dashboard connects directly to the ESP32's assigned IP address on the
//      LAN instead of 192.168.4.1.
// Set USE_EXTERNAL_WIFI to 1 when the Master Node should join a router.
// The dashboard will then connect to ws://<ESP32_IP>:8081 instead of the AP
// gateway. -----------------------------------------------------------------
#define USE_EXTERNAL_WIFI 0
#define EXTERNAL_WIFI_SSID "YourRouterSSID"
#define EXTERNAL_WIFI_PASSWORD "YourRouterPassword"

// ---- WiFi AP config — used as the fallback if external WiFi is unavailable
// or disabled. This password is also the encryption pairing secret (see the
// AES key derivation below), so changing it changes the encryption key too —
// nothing else to keep in sync. -------------------------------------------
static const char *AP_SSID = "AquaLoRa-MasterNode";
static const char *AP_PASSWORD = "aqualora123"; // WPA2 min length is 8 chars
static const uint16_t WS_PORT = 8081;           // matches mock_master_node.js

// ---- Dummy sensor node profiles — same tuned ranges as
// mock_master_node.js, so Fish Health Index status tiers still demo
// correctly (one healthy, one mixed, one borderline). ----------------------
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

static unsigned long samplingIntervalMs = 10000; // default 10s, same as the mock
static unsigned long lastSendMs[NODE_COUNT] = {0};

WebSocketsServer webSocket(WS_PORT);

// ---------------------------------------------------------------------
// Encryption — AES-256-GCM, key = SHA-256(AP_PASSWORD). Must exactly match
// desktop_application/src/main/secureChannel.ts: same KDF, 12-byte random
// IV per message, 16-byte auth tag, no additional authenticated data, and
// the same {"iv","tag","data"} JSON envelope shape (all three fields
// base64). ---------------------------------------------------------------
static mbedtls_gcm_context gcmCtx;
static const size_t GCM_IV_LEN = 12;
static const size_t GCM_TAG_LEN = 16;
static const size_t MAX_PLAINTEXT_LEN = 256; // generous for our small JSON messages

static void initCipher()
{
  uint8_t key[32];
  const mbedtls_md_info_t *mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md(mdInfo, (const unsigned char *)AP_PASSWORD, strlen(AP_PASSWORD), key);
  mbedtls_gcm_init(&gcmCtx);
  mbedtls_gcm_setkey(&gcmCtx, MBEDTLS_CIPHER_ID_AES, key, 256);
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

// Returns an empty String on failure (caller should skip sending rather
// than transmit something unencrypted).
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

// Returns false (and leaves outPlain untouched) on any failure — bad JSON,
// undersized/oversized fields, or a failed auth tag all mean "don't trust
// this message, drop it" rather than something to recover from.
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
  {
    return false;
  }
  if (mbedtls_base64_decode(tag, sizeof(tag), &olen, (const uint8_t *)tagB64, strlen(tagB64)) != 0 || olen != GCM_TAG_LEN)
  {
    return false;
  }
  if (mbedtls_base64_decode(cipherBuf, sizeof(cipherBuf), &olen, (const uint8_t *)dataB64,
                            strlen(dataB64)) != 0)
  {
    return false;
  }
  size_t cipherLen = olen;

  uint8_t plainBuf[MAX_PLAINTEXT_LEN + 1];
  int ret = mbedtls_gcm_auth_decrypt(
      &gcmCtx, cipherLen,
      iv, GCM_IV_LEN,
      nullptr, 0,
      tag, GCM_TAG_LEN,
      cipherBuf, plainBuf);
  if (ret != 0)
    return false; // MBEDTLS_ERR_GCM_AUTH_FAILED: wrong key or tampered message

  plainBuf[cipherLen] = '\0';
  outPlain = String((char *)plainBuf);
  return true;
}

// Timestamp is a placeholder: the AP-only ESP32 has no internet access for
// NTP, so there's no way to get real wall-clock time. We seed the system
// clock once at boot with a fixed date and let it free-run from there —
// timestamps come out as well-formed, monotonically increasing ISO 8601
// strings (what the dashboard needs for sorting/range queries), just not
// tied to the real calendar date. Fine for a connection-workflow test.
static void seedFakeClock()
{
  struct timeval tv = {.tv_sec = 1767225600, .tv_usec = 0}; // 2026-01-01T00:00:00Z
  settimeofday(&tv, nullptr);
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

static void sendEncrypted(uint8_t clientId, const String &plain, const char *label)
{
  String envelope = encryptEnvelope(plain);
  if (envelope.length() == 0)
  {
    Serial.printf("[master] encrypt failed, dropping %s\n", label);
    return;
  }
  webSocket.sendTXT(clientId, envelope);
  Serial.printf("[master] sent %s (encrypted, %u bytes plaintext)\n", label, plain.length());
}

static void broadcastEncrypted(const String &plain, const char *label)
{
  String envelope = encryptEnvelope(plain);
  if (envelope.length() == 0)
  {
    Serial.printf("[master] encrypt failed, dropping %s\n", label);
    return;
  }
  webSocket.broadcastTXT(envelope);
  Serial.printf("[master] sent %s (encrypted, %u bytes plaintext)\n", label, plain.length());
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
  StaticJsonDocument<256> doc;
  doc["node_id"] = node.node_id;
  doc["timestamp"] = isoTimestampNow();
  doc["temperature"] = randomFloat(node.tempMin, node.tempMax);
  doc["turbidity"] = randomFloat(node.turbMin, node.turbMax);
  doc["tds"] = random(node.tdsMin, node.tdsMax);
  doc["ph"] = randomFloat(6.5, 8.5);
  doc["battery_pct"] = random(60, 100);
  doc["rssi"] = -random(50, 90);
  String plain;
  serializeJson(doc, plain);
  broadcastEncrypted(plain, "reading");
}

static void handleDownlinkCommand(const String &plain)
{
  StaticJsonDocument<256> cmd;
  DeserializationError err = deserializeJson(cmd, plain);
  if (err)
  {
    Serial.println("[master] received non-JSON downlink message");
    return;
  }
  const char *type = cmd["type"] | "";
  if (strcmp(type, "set_interval") == 0)
  {
    long minutes = cmd["minutes"] | 10;
    samplingIntervalMs = (unsigned long)minutes * 60000UL;
    Serial.printf("[master] set_interval -> %ld minute(s)\n", minutes);
  }
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
  switch (type)
  {
  case WStype_CONNECTED:
    Serial.printf("[master] dashboard connected (client #%u)\n", num);
    sendNodeList(num);
    // Force every node to send immediately on this new connection, then
    // fall back to its normal interval.
    for (int i = 0; i < NODE_COUNT; i++)
      lastSendMs[i] = 0;
    break;
  case WStype_DISCONNECTED:
    Serial.printf("[master] dashboard disconnected (client #%u)\n", num);
    break;
  case WStype_TEXT:
  {
    String envelope((char *)payload, length);
    String plain;
    if (!decryptEnvelope(envelope, plain))
    {
      Serial.println("[master] dropped downlink message: decrypt/auth failed (wrong password or tampered)");
      break;
    }
    handleDownlinkCommand(plain);
    break;
  }
  default:
    break;
  }
}

void setup()
{
  Serial.begin(115200);
  seedFakeClock();
  randomSeed(esp_random());
  initCipher();

#if USE_EXTERNAL_WIFI
  WiFi.mode(WIFI_STA);
  WiFi.begin(EXTERNAL_WIFI_SSID, EXTERNAL_WIFI_PASSWORD);
  Serial.printf("[master] connecting to external WiFi: %s\n", EXTERNAL_WIFI_SSID);

  unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 20000)
  {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.print("[master] external WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("[master] external WiFi failed — falling back to AP mode");
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.print("[master] AP started, SSID: ");
    Serial.println(AP_SSID);
    Serial.print("[master] AP IP address: ");
    Serial.println(WiFi.softAPIP());
  }
#else
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  Serial.print("[master] AP started, SSID: ");
  Serial.println(AP_SSID);
  Serial.print("[master] AP IP address: ");
  Serial.println(WiFi.softAPIP()); // normally 192.168.4.1
#endif

  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  Serial.printf("[master] WebSocket server listening on port %u (AES-256-GCM encrypted)\n", WS_PORT);
}

void loop()
{
  webSocket.loop();

  unsigned long now = millis();
  for (int i = 0; i < NODE_COUNT; i++)
  {
    if (now - lastSendMs[i] >= samplingIntervalMs)
    {
      lastSendMs[i] = now;
      broadcastReading(NODES[i]);
    }
  }
}
