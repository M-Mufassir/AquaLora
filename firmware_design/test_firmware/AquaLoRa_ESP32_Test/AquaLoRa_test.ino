// AquaLoRa ESP32 Test & Master Node Combined Firmware
//
// Combines real-world field telemetry generation with:
//   1. Wi-Fi Station (STA) mode to join an external Wi-Fi / Mobile Hotspot,
//      with automatic retry and SoftAP fallback (AquaLoRa-MasterNode).
//   2. UDP Broadcast Discovery on port 8082: Periodically broadcasts presence
//      ("I am AQL-001 at IP X.X.X.X") on 255.255.255.255 so the desktop app
//      discovers it automatically without any manual IP configuration!
//   3. mDNS responder: advertises aqualora-aql001.local via ESPmDNS.
//   4. Encrypted WebSocket Server on port 8081 (AES-256-GCM) matching desktop app:
//      Sends 4 telemetry values (temp, turbidity, TDS, pH) + battery_pct & RSSI.
//   5. Bidirectional downlink support: Decrypts commands from desktop (e.g. set_interval).
//
// Libraries needed:
//   - WebSockets by Markus Sattler (Links2004/arduinoWebSockets)
//   - ArduinoJson by Benoit Blanchon (v6 or v7)
// Board: ESP32 Dev Module

#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include <mbedtls/gcm.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>

// ---------------------------------------------------------------------------
// Configuration: Wi-Fi Credentials & Node Identity
// ---------------------------------------------------------------------------
// External Wi-Fi / Mobile Hotspot credentials
#define WIFI_SSID "Aqualora"
#define WIFI_PASSWORD "Aqualora"

// Fallback SoftAP credentials if router/hotspot connection fails
static const char *AP_SSID = "AquaLoRa-MasterNode";
static const char *AP_PASSWORD = "aqualora123";

// Node Identity (Used for cloud sync and node identification)
static const char *NODE_CODE = "AQL-001";
static const char *NODE_ID = "AQL-001";

// Desktop-to-ESP32 AES-256-GCM pairing encryption secret
static const char *PAIRING_PASSWORD = "aqualora123";

static const uint16_t WS_PORT = 8081;             // WebSocket server port
static const uint16_t UDP_DISCOVERY_PORT = 8082;  // UDP discovery broadcast port

static const unsigned long DEFAULT_SAMPLE_INTERVAL_MS = 10000;
static const unsigned long UDP_BROADCAST_INTERVAL_MS = 3000;
static const unsigned long WIFI_RETRY_INTERVAL_MS = 15000;
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 25000;

// ---------------------------------------------------------------------------
// State & Handles
// ---------------------------------------------------------------------------
WebSocketsServer webSocket(WS_PORT);
WiFiUDP udpDiscovery;
mbedtls_gcm_context gcmCtx;

unsigned long samplingIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
unsigned long lastSampleMs = 0;
unsigned long lastUdpBroadcastMs = 0;
unsigned long lastWifiRetryMs = 0;
bool isApFallbackActive = false;

// ---------------------------------------------------------------------------
// AES-256-GCM Encryption / Decryption
// ---------------------------------------------------------------------------
static const size_t GCM_IV_LEN = 12;
static const size_t GCM_TAG_LEN = 16;
static const size_t MAX_PLAINTEXT_LEN = 256;
static const size_t IV_B64_LEN = 24;
static const size_t TAG_B64_LEN = 32;
static const size_t DATA_B64_LEN = 348;

void initCipher()
{
    uint8_t key[32];
    const mbedtls_md_info_t *mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    mbedtls_md(mdInfo, (const unsigned char *)PAIRING_PASSWORD, strlen(PAIRING_PASSWORD), key);
    mbedtls_gcm_init(&gcmCtx);
    mbedtls_gcm_setkey(&gcmCtx, MBEDTLS_CIPHER_ID_AES, key, 256);
}

void fillRandom(uint8_t *buffer, size_t length)
{
    size_t offset = 0;
    while (offset < length)
    {
        uint32_t randomValue = esp_random();
        size_t copyLength = min((size_t)4, length - offset);
        memcpy(buffer + offset, &randomValue, copyLength);
        offset += copyLength;
    }
}

String encryptEnvelope(const String &plaintext)
{
    size_t length = plaintext.length();
    if (length == 0 || length > MAX_PLAINTEXT_LEN)
        return String();

    uint8_t iv[GCM_IV_LEN];
    uint8_t cipherText[MAX_PLAINTEXT_LEN];
    uint8_t tag[GCM_TAG_LEN];
    fillRandom(iv, GCM_IV_LEN);

    if (mbedtls_gcm_crypt_and_tag(
            &gcmCtx, MBEDTLS_GCM_ENCRYPT, length, iv, GCM_IV_LEN,
            nullptr, 0, (const uint8_t *)plaintext.c_str(), cipherText,
            GCM_TAG_LEN, tag) != 0)
    {
        Serial.println("[crypto] Encryption failed");
        return String();
    }

    char ivBase64[IV_B64_LEN];
    char tagBase64[TAG_B64_LEN];
    char dataBase64[DATA_B64_LEN];
    size_t outputLength = 0;

    mbedtls_base64_encode((uint8_t *)ivBase64, sizeof(ivBase64), &outputLength, iv, GCM_IV_LEN);
    ivBase64[outputLength] = '\0';

    mbedtls_base64_encode((uint8_t *)tagBase64, sizeof(tagBase64), &outputLength, tag, GCM_TAG_LEN);
    tagBase64[outputLength] = '\0';

    mbedtls_base64_encode((uint8_t *)dataBase64, sizeof(dataBase64), &outputLength, cipherText, length);
    dataBase64[outputLength] = '\0';

    StaticJsonDocument<640> envelope;
    envelope["iv"] = ivBase64;
    envelope["tag"] = tagBase64;
    envelope["data"] = dataBase64;
    String serialized;
    serializeJson(envelope, serialized);
    return serialized;
}

bool decryptEnvelope(const String &envelopeJson, String &outPlain)
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
        return false; // Auth failed

    plainBuf[cipherLen] = '\0';
    outPlain = String((char *)plainBuf);
    return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
String getCurrentIPString()
{
    if (WiFi.getMode() & WIFI_STA && WiFi.status() == WL_CONNECTED)
        return WiFi.localIP().toString();
    return WiFi.softAPIP().toString();
}

String isoTimestampNow()
{
    time_t now = time(nullptr);
    struct tm timeInfo;
    gmtime_r(&now, &timeInfo);
    char buffer[25];
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
    return String(buffer);
}

float randomFloat(float minimum, float maximum)
{
    return minimum + (maximum - minimum) * (float)random(0, 10001) / 10000.0f;
}

// ---------------------------------------------------------------------------
// UDP Broadcast Discovery (The "Under the Hood" Automatic Discovery)
// ---------------------------------------------------------------------------
void broadcastPresence()
{
    IPAddress broadcastIp;
    if (WiFi.getMode() & WIFI_AP && !isApFallbackActive)
    {
        broadcastIp = IPAddress(192, 168, 4, 255);
    }
    else
    {
        broadcastIp = IPAddress(255, 255, 255, 255);
    }

    StaticJsonDocument<256> doc;
    doc["service"] = "aqualora-master";
    doc["id"] = NODE_ID;
    doc["code"] = NODE_CODE;
    doc["ip"] = getCurrentIPString();
    doc["port"] = WS_PORT;
    doc["mode"] = (WiFi.status() == WL_CONNECTED) ? "STA" : "AP";

    String jsonStr;
    serializeJson(doc, jsonStr);

    udpDiscovery.beginPacket(broadcastIp, UDP_DISCOVERY_PORT);
    udpDiscovery.write((const uint8_t *)jsonStr.c_str(), jsonStr.length());
    udpDiscovery.endPacket();

    Serial.printf("[discovery] UDP broadcast sent -> %s:%u (IP: %s)\n",
                  broadcastIp.toString().c_str(), UDP_DISCOVERY_PORT, getCurrentIPString().c_str());
}

// ---------------------------------------------------------------------------
// WebSocket Telemetry Transmission
// ---------------------------------------------------------------------------
void sendEncrypted(uint8_t clientId, const String &payload)
{
    String envelope = encryptEnvelope(payload);
    if (envelope.length() > 0)
        webSocket.sendTXT(clientId, envelope);
}

void sendNodeList(uint8_t clientId)
{
    StaticJsonDocument<160> message;
    message["type"] = "node_list";
    JsonArray nodes = message.createNestedArray("nodes");
    JsonObject node = nodes.createNestedObject();
    node["node_id"] = NODE_ID;

    String payload;
    serializeJson(message, payload);
    sendEncrypted(clientId, payload);
}

void broadcastReading()
{
    // Generates the 4 water quality parameters + battery + rssi
    StaticJsonDocument<300> message;
    message["node_id"] = NODE_ID;
    message["timestamp"] = isoTimestampNow();
    message["temperature"] = randomFloat(25.5f, 29.5f);
    message["turbidity"] = randomFloat(10.0f, 25.0f);
    message["tds"] = randomFloat(180.0f, 260.0f);
    message["ph"] = randomFloat(7.0f, 8.0f);
    message["battery_pct"] = random(80, 100);
    message["rssi"] = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -65;

    String payload;
    serializeJson(message, payload);
    String envelope = encryptEnvelope(payload);
    if (envelope.length() > 0)
        webSocket.broadcastTXT(envelope);

    Serial.printf("[reading] %s | Temp=%.1f°C Turb=%.1fNTU TDS=%.0fppm pH=%.2f Batt=%d%% RSSI=%d\n",
                  NODE_ID,
                  (double)message["temperature"],
                  (double)message["turbidity"],
                  (double)message["tds"],
                  (double)message["ph"],
                  (int)message["battery_pct"],
                  (int)message["rssi"]);
}

void handleDownlinkCommand(const String &plain)
{
    StaticJsonDocument<256> cmd;
    DeserializationError err = deserializeJson(cmd, plain);
    if (err)
    {
        Serial.println("[ws] Received non-JSON downlink message");
        return;
    }
    const char *type = cmd["type"] | "";
    if (strcmp(type, "set_interval") == 0)
    {
        long minutes = cmd["minutes"] | 10;
        samplingIntervalMs = (unsigned long)minutes * 60000UL;
        Serial.printf("[ws] Downlink command: set_interval -> %ld minute(s)\n", minutes);
    }
}

void webSocketEvent(uint8_t clientId, WStype_t type, uint8_t *payload, size_t length)
{
    switch (type)
    {
    case WStype_CONNECTED:
        Serial.printf("[ws] Desktop connected, client #%u\n", clientId);
        sendNodeList(clientId);
        // Immediately broadcast reading upon connect
        broadcastReading();
        break;
    case WStype_DISCONNECTED:
        Serial.printf("[ws] Desktop disconnected, client #%u\n", clientId);
        break;
    case WStype_TEXT:
    {
        String envelope((char *)payload, length);
        String plain;
        if (!decryptEnvelope(envelope, plain))
        {
            Serial.println("[ws] Dropped downlink: decryption/auth failed");
            break;
        }
        handleDownlinkCommand(plain);
        break;
    }
    default:
        break;
    }
}

// ---------------------------------------------------------------------------
// Network Connection Routines
// ---------------------------------------------------------------------------
void startSoftAP()
{
    isApFallbackActive = true;
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("[wifi] SoftAP started -> SSID: %s | IP: %s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
}

bool connectToRouter()
{
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false); // Keeps Wi-Fi radio responsive
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[wifi] Connecting to Wi-Fi / Hotspot: %s\n", WIFI_SSID);

    unsigned long startedAt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS)
    {
        delay(350);
        Serial.print('.');
    }
    Serial.println();

    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println("[wifi] Hotspot connection timed out.");
        return false;
    }

    isApFallbackActive = false;
    Serial.printf("[wifi] Connected! Assigned IP: %s (Gateway: %s)\n",
                  WiFi.localIP().toString().c_str(),
                  WiFi.gatewayIP().toString().c_str());

    // Start mDNS service: aqualora-aql001.local
    if (MDNS.begin("aqualora-aql001"))
    {
        MDNS.addService("ws", "tcp", WS_PORT);
        MDNS.addService("aqualora", "udp", UDP_DISCOVERY_PORT);
        Serial.println("[mdns] mDNS responder started: aqualora-aql001.local");
    }

    return true;
}

// ---------------------------------------------------------------------------
// Arduino Setup & Main Loop
// ---------------------------------------------------------------------------
void setup()
{
    Serial.begin(115200);
    delay(500);
    Serial.println("\n==========================================");
    Serial.println("  AquaLoRa ESP32 Master Node Firmware");
    Serial.println("==========================================");

    randomSeed(esp_random());
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    initCipher();

    // Try connecting to external router / hotspot
    if (!connectToRouter())
    {
        Serial.println("[wifi] Falling back to SoftAP mode so pairing can still happen.");
        startSoftAP();
    }

    // Initialize UDP discovery socket
    udpDiscovery.begin(UDP_DISCOVERY_PORT);

    // Initialize WebSocket server
    webSocket.begin();
    webSocket.onEvent(webSocketEvent);

    Serial.printf("[ready] WebSocket listening on ws://%s:%u\n", getCurrentIPString().c_str(), WS_PORT);
    Serial.printf("[ready] UDP Discovery broadcasting on port %u\n", UDP_DISCOVERY_PORT);
    Serial.println("==========================================\n");
}

void loop()
{
    unsigned long now = millis();

    // Handle background Wi-Fi reconnection if router is lost
    if (!isApFallbackActive && WiFi.status() != WL_CONNECTED)
    {
        if (now - lastWifiRetryMs >= WIFI_RETRY_INTERVAL_MS)
        {
            lastWifiRetryMs = now;
            Serial.println("[wifi] Link lost, retrying connection...");
            if (connectToRouter())
            {
                Serial.printf("[wifi] Reconnected! IP: %s\n", WiFi.localIP().toString().c_str());
            }
        }
    }

    // Process WebSocket server events
    webSocket.loop();

    // Periodically broadcast UDP discovery beacon (every 3 seconds)
    if (now - lastUdpBroadcastMs >= UDP_BROADCAST_INTERVAL_MS)
    {
        lastUdpBroadcastMs = now;
        broadcastPresence();
    }

    // Periodically broadcast sensor readings (every sampling interval)
    if (now - lastSampleMs >= samplingIntervalMs)
    {
        lastSampleMs = now;
        broadcastReading();
    }
}
