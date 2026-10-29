/**
 * @file secure_ws.h
 * @brief Wi-Fi AP & AES-256-GCM Encrypted WebSocket Server Module for AquaLoRa Master Node
 * @project AquaLoRa Marine Telemetry System - Master Receiver Node
 */

#ifndef SECURE_WS_H
#define SECURE_WS_H

#include <Arduino.h>
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
#include <ESPmDNS.h>
#include "config.h"

// Maximum tracked slave nodes in registry
#define MAX_DISCOVERED_NODES 10

// Node tracking structure
struct DiscoveredNode
{
    char node_id[32];
    unsigned long last_seen_ms;
};

static DiscoveredNode g_discoveredNodes[MAX_DISCOVERED_NODES];
static int g_discoveredNodeCount = 0;

static WebSocketsServer g_webSocket(WEBSOCKET_PORT);
static mbedtls_gcm_context g_gcmCtx;
static const size_t GCM_IV_LEN = 12;
static const size_t GCM_TAG_LEN = 16;
static const size_t MAX_PLAINTEXT_LEN = 256;

static unsigned long g_samplingIntervalMs = 10000;
static WiFiUDP g_discoveryUdp;
static unsigned long g_lastDiscoveryMs = 0;

/**
 * @brief Register or update a discovered LoRa node ID in local registry.
 */
inline void registerNode(const String &nodeId)
{
    if (nodeId.length() == 0 || nodeId == "Unknown")
        return;

    // Check if node already registered
    for (int i = 0; i < g_discoveredNodeCount; i++)
    {
        if (strcmp(g_discoveredNodes[i].node_id, nodeId.c_str()) == 0)
        {
            g_discoveredNodes[i].last_seen_ms = millis();
            return;
        }
    }

    // Register new node if space available
    if (g_discoveredNodeCount < MAX_DISCOVERED_NODES)
    {
        strncpy(g_discoveredNodes[g_discoveredNodeCount].node_id, nodeId.c_str(), 31);
        g_discoveredNodes[g_discoveredNodeCount].node_id[31] = '\0';
        g_discoveredNodes[g_discoveredNodeCount].last_seen_ms = millis();
        g_discoveredNodeCount++;
        Serial.printf("[REGISTRY] Registered new LoRa Node ID: '%s' (Total: %d)\n",
                      nodeId.c_str(), g_discoveredNodeCount);
    }
}

/**
 * @brief Initialize AES-256-GCM cipher with SHA-256 key derived from MASTER_PASSWORD.
 */
inline void initCipher()
{
    uint8_t key[32];
    const mbedtls_md_info_t *mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    mbedtls_md(mdInfo, (const unsigned char *)MASTER_PASSWORD, strlen(MASTER_PASSWORD), key);
    mbedtls_gcm_init(&g_gcmCtx);
    mbedtls_gcm_setkey(&g_gcmCtx, MBEDTLS_CIPHER_ID_AES, key, 256);
    Serial.println(F("[CRYPTO] AES-256-GCM initialized with SHA-256 derived key."));
}

/**
 * @brief Fill buffer with cryptographically secure random bytes from hardware RNG.
 */
inline void fillRandomBytes(uint8_t *buf, size_t len)
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

/**
 * @brief Encrypt plaintext JSON into base64 AES-256-GCM envelope {"iv","tag","data"}.
 */
inline String encryptEnvelope(const String &plaintext)
{
    size_t len = plaintext.length();
    if (len == 0 || len > MAX_PLAINTEXT_LEN)
        return String();

    uint8_t iv[GCM_IV_LEN];
    fillRandomBytes(iv, GCM_IV_LEN);

    uint8_t cipherBuf[MAX_PLAINTEXT_LEN];
    uint8_t tag[GCM_TAG_LEN];
    int ret = mbedtls_gcm_crypt_and_tag(
        &g_gcmCtx, MBEDTLS_GCM_ENCRYPT, len,
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

/**
 * @brief Decrypt incoming encrypted JSON envelope from dashboard client.
 */
inline bool decryptEnvelope(const String &envelopeJson, String &outPlain)
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
    if (mbedtls_base64_decode(cipherBuf, sizeof(cipherBuf), &olen, (const uint8_t *)dataB64, strlen(dataB64)) != 0)
    {
        return false;
    }
    size_t cipherLen = olen;

    uint8_t plainBuf[MAX_PLAINTEXT_LEN + 1];
    int ret = mbedtls_gcm_auth_decrypt(
        &g_gcmCtx, cipherLen,
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

static bool g_ntpSyncStarted = false;
static bool g_clockSynchronized = false;
static String g_cloudAuthToken = "";

/**
 * @brief Initialize SNTP network time sync over Wi-Fi.
 */
inline void initNtpClock()
{
    Serial.println(F("[NTP] Initializing SNTP time synchronization..."));
    configTime(0, 0, NTP_SERVER1, NTP_SERVER2, NTP_SERVER3);
    g_ntpSyncStarted = true;
}

/**
 * @brief Check if system clock has acquired real wall-clock time (> 1700000000).
 */
inline bool isClockSynchronized()
{
    time_t now = time(nullptr);
    if (now > 1700000000)
    {
        g_clockSynchronized = true;
        return true;
    }
    return g_clockSynchronized;
}

/**
 * @brief Seed initial fallback monotonic clock if NTP not yet locked.
 */
inline void seedInitialClock()
{
    time_t now = time(nullptr);
    if (now < 1000000) {
        // Only set fallback if clock is completely uninitialized (at epoch 0)
        struct timeval tv = {.tv_sec = 1767225600, .tv_usec = 0};
        settimeofday(&tv, nullptr);
    }
}

/**
 * @brief Generate ISO 8601 UTC timestamp string from real wall-clock time.
 */
inline String isoTimestampNow()
{
    time_t now = time(nullptr);
    struct tm tmInfo;
    gmtime_r(&now, &tmInfo);
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmInfo);
    return String(buf);
}

/**
 * @brief Authenticate directly with Cloud Backend to obtain JWT Bearer token.
 */
inline bool loginCloudBackend()
{
    if (WiFi.status() != WL_CONNECTED)
    {
        return false;
    }

    WiFiClientSecure secClient;
    secClient.setInsecure(); // Accept Azure HTTPS without bundle size overhead
    HTTPClient http;
    http.setTimeout(CLOUD_REQUEST_TIMEOUT_MS);

    String loginUrl = String(CLOUD_API_BASE_URL) + "/auth/login";
    if (!http.begin(secClient, loginUrl))
    {
        Serial.println(F("[CLOUD] Error: Failed to initiate HTTP connection to /auth/login"));
        return false;
    }

    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<256> reqDoc;
    reqDoc["node_code"] = CLOUD_MASTER_NODE_CODE;
    reqDoc["password"] = CLOUD_MASTER_PASSWORD;
    reqDoc["client"] = CLOUD_CLIENT_ID;

    String reqBody;
    serializeJson(reqDoc, reqBody);

    Serial.printf("[CLOUD] Authenticating to cloud as '%s'...\n", CLOUD_MASTER_NODE_CODE);
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
                Serial.println(F("[CLOUD] Authentication SUCCESS: JWT token acquired!"));
                http.end();
                return true;
            }
        }
    }
    else
    {
        Serial.printf("[CLOUD] Login failed (HTTP %d)\n", httpCode);
    }

    http.end();
    return false;
}

/**
 * @brief Directly synchronize reading telemetry to Cloud Backend API.
 * Ensures data reaches cloud even when desktop application is OFF!
 */
inline bool syncReadingToCloud(const String &nodeId, const String &timestamp, float temp, int tds, float turb, float ph, int rssi)
{
    if (!CLOUD_SYNC_ENABLED)
        return false;

    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println(F("[CLOUD] Wi-Fi offline. Telemetry sync to cloud skipped."));
        return false;
    }

    // Acquire JWT token if missing
    if (g_cloudAuthToken.length() == 0)
    {
        if (!loginCloudBackend())
        {
            Serial.println(F("[CLOUD] Unable to sync reading: Authentication failed."));
            return false;
        }
    }

    WiFiClientSecure secClient;
    secClient.setInsecure();
    HTTPClient http;
    http.setTimeout(CLOUD_REQUEST_TIMEOUT_MS);

    String syncUrl = String(CLOUD_API_BASE_URL) + "/readings/sync";
    if (!http.begin(secClient, syncUrl))
    {
        Serial.println(F("[CLOUD] Error connecting to /readings/sync"));
        return false;
    }

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

    Serial.printf("[CLOUD] Syncing reading to cloud (%s @ %s)...\n", nodeId.c_str(), timestamp.c_str());
    int httpCode = http.POST(body);

    if (httpCode == 200 || httpCode == 201)
    {
        Serial.printf("[CLOUD] SUCCESS: Telemetry saved in cloud database! (HTTP %d)\n", httpCode);
        http.end();
        return true;
    }
    else if (httpCode == 401)
    {
        // Expired token: clear and retry once
        Serial.println(F("[CLOUD] Token expired (HTTP 401). Refreshing token and retrying..."));
        g_cloudAuthToken = "";
        http.end();
        if (loginCloudBackend())
        {
            WiFiClientSecure secRetry;
            secRetry.setInsecure();
            HTTPClient httpRetry;
            httpRetry.setTimeout(CLOUD_REQUEST_TIMEOUT_MS);
            if (httpRetry.begin(secRetry, syncUrl))
            {
                httpRetry.addHeader("Content-Type", "application/json");
                httpRetry.addHeader("Authorization", "Bearer " + g_cloudAuthToken);
                int retryCode = httpRetry.POST(body);
                httpRetry.end();
                if (retryCode == 200 || retryCode == 201)
                {
                    Serial.println(F("[CLOUD] SUCCESS: Reading synced on retry with new token!"));
                    return true;
                }
            }
        }
    }
    else
    {
        Serial.printf("[CLOUD] Warning: Sync returned HTTP %d\n", httpCode);
    }

    http.end();
    return false;
}

/**
 * @brief Send encrypted message to a specific WebSocket client.
 */
inline void sendEncryptedWS(uint8_t clientId, const String &plain, const char *label)
{
    String envelope = encryptEnvelope(plain);
    if (envelope.length() == 0)
    {
        Serial.printf("[WS] Encrypt failed, dropping %s\n", label);
        return;
    }
    g_webSocket.sendTXT(clientId, envelope);
    Serial.printf("[WS] Sent %s to client #%u (encrypted, %u bytes plain)\n", label, clientId, plain.length());
}

/**
 * @brief Broadcast encrypted message to all connected WebSocket clients.
 */
inline void broadcastEncryptedWS(const String &plain, const char *label)
{
    String envelope = encryptEnvelope(plain);
    if (envelope.length() == 0)
    {
        Serial.printf("[WS] Encrypt failed, dropping broadcast %s\n", label);
        return;
    }
    g_webSocket.broadcastTXT(envelope);
    Serial.printf("[WS] Broadcasted %s (encrypted, %u bytes plain)\n", label, plain.length());
}

/**
 * @brief Transmit node list to dashboard client upon connection.
 */
inline void sendNodeListWS(uint8_t clientId)
{
    StaticJsonDocument<256> doc;
    doc["type"] = "node_list";
    JsonArray arr = doc.createNestedArray("nodes");

    if (g_discoveredNodeCount == 0)
    {
        // Fallback default node if no LoRa node discovered yet
        JsonObject o = arr.createNestedObject();
        o["node_id"] = "Node1";
    }
    else
    {
        for (int i = 0; i < g_discoveredNodeCount; i++)
        {
            JsonObject o = arr.createNestedObject();
            o["node_id"] = g_discoveredNodes[i].node_id;
        }
    }

    String plain;
    serializeJson(doc, plain);
    sendEncryptedWS(clientId, plain, "node_list");
}

/**
 * @brief Broadcast real received LoRa telemetry data to connected dashboard clients.
 */
inline void broadcastLoRaTelemetryWS(const String &nodeId, const String &timestamp, float temp, int tds, float turb, float ph, int rssi)
{
    registerNode(nodeId);

    StaticJsonDocument<384> doc;
    doc["node_id"] = nodeId;
    doc["timestamp"] = (timestamp.length() > 0 && timestamp != "Unknown") ? timestamp : isoTimestampNow();
    doc["temperature"] = temp;
    doc["turbidity"] = turb;
    doc["tds"] = tds;
    doc["ph"] = ph;
    doc["battery_pct"] = 95; // Telemetry default
    doc["rssi"] = rssi;

    String plain;
    serializeJson(doc, plain);
    broadcastEncryptedWS(plain, "telemetry_reading");
}

/**
 * @brief Process incoming downlink commands from dashboard.
 */
inline void handleDownlinkCommand(const String &plain)
{
    StaticJsonDocument<256> cmd;
    DeserializationError err = deserializeJson(cmd, plain);
    if (err)
    {
        Serial.println(F("[WS] Received non-JSON downlink message"));
        return;
    }
    const char *type = cmd["type"] | "";
    if (strcmp(type, "set_interval") == 0)
    {
        long minutes = cmd["minutes"] | 10;
        g_samplingIntervalMs = (unsigned long)minutes * 60000UL;
        Serial.printf("[WS] Downlink command: set_interval -> %ld minute(s)\n", minutes);
    }
    else if (strcmp(type, "sync_time") == 0)
    {
        long epochSec = cmd["epoch"] | 0;
        if (epochSec > 1700000000)
        {
            struct timeval tv = {.tv_sec = (time_t)epochSec, .tv_usec = 0};
            settimeofday(&tv, nullptr);
            g_clockSynchronized = true;
            Serial.printf("[TIME] System clock synchronized via desktop downlink: %ld (Now: %s)\n",
                          epochSec, isoTimestampNow().c_str());
        }
    }
}

/**
 * @brief WebSocket Server Event Handler.
 */
inline void webSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length)
{
    switch (type)
    {
    case WStype_CONNECTED:
        Serial.printf("[WS] Dashboard connected (client #%u)\n", num);
        sendNodeListWS(num);
        break;
    case WStype_DISCONNECTED:
        Serial.printf("[WS] Dashboard disconnected (client #%u)\n", num);
        break;
    case WStype_TEXT:
    {
        String envelope((char *)payload, length);
        String plain;
        if (!decryptEnvelope(envelope, plain))
        {
            Serial.println(F("[WS] Dropped downlink message: decrypt/auth failed"));
            break;
        }
        handleDownlinkCommand(plain);
        break;
    }
    default:
        break;
    }
}

/**
 * @brief Transmit UDP presence discovery beacon to let desktop dashboard locate this Master Node.
 */
inline void sendDiscoveryBeacon()
{
    StaticJsonDocument<256> beacon;
    beacon["service"] = "aqualora-master";
    beacon["id"] = MASTER_NODE_ID;
    beacon["code"] = MASTER_NODE_CODE;
    beacon["name"] = "AquaLoRa Master Node";
    beacon["ip"] = WiFi.localIP().toString();
    beacon["port"] = WEBSOCKET_PORT;
    beacon["mode"] = "STA";
    String payload;
    serializeJson(beacon, payload);

    // 1. Send to standard global broadcast address
    IPAddress globalBroadcast(255, 255, 255, 255);
    g_discoveryUdp.beginPacket(globalBroadcast, UDP_DISCOVERY_PORT);
    g_discoveryUdp.write((const uint8_t *)payload.c_str(), payload.length());
    g_discoveryUdp.endPacket();

    // 2. Send to subnet directed broadcast address
    if (WiFi.status() == WL_CONNECTED) {
        uint32_t ip = (uint32_t)WiFi.localIP();
        uint32_t mask = (uint32_t)WiFi.subnetMask();
        IPAddress subnetBroadcast = IPAddress(ip | ~mask);
        g_discoveryUdp.beginPacket(subnetBroadcast, UDP_DISCOVERY_PORT);
        g_discoveryUdp.write((const uint8_t *)payload.c_str(), payload.length());
        g_discoveryUdp.endPacket();
    }
}

/**
 * @brief Initialize Pure Station Wi-Fi connection, mDNS, and AES-256-GCM WebSocket Server.
 */
inline bool initSecureWebSocket()
{
    Serial.println(F("\n[WIFI] Initializing Master Node Wi-Fi Station connection..."));
    seedInitialClock();
    randomSeed(esp_random());
    initCipher();
    
    // Default slave node pre-registration
    registerNode("Node1");

    // Clean previous stale Wi-Fi state & disable power-save sleep
    WiFi.persistent(false);
    WiFi.disconnect(true, true);
    delay(200);

    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);

    // 1. Scan available networks to detect the exact SSID of the phone hotspot / router
    Serial.println(F("[WIFI] Scanning nearby Wi-Fi networks..."));
    int n = WiFi.scanNetworks(false, true);
    String targetSsid = WIFI_SSID;

    if (n > 0) {
        Serial.printf("[WIFI] Found %d Wi-Fi networks in range:\n", n);
        for (int i = 0; i < n; i++) {
            String scannedSsid = WiFi.SSID(i);
            int rssi = WiFi.RSSI(i);
            Serial.printf("       [%d] '%s' (RSSI: %d dBm)\n", i + 1, scannedSsid.c_str(), rssi);

            // Match if SSID contains Aqualora (case-insensitive or whitespace-trimmed)
            String trimmed = scannedSsid;
            trimmed.trim();
            if (trimmed.equalsIgnoreCase("Aqualora") || scannedSsid == WIFI_SSID || scannedSsid == WIFI_SSID_ALT) {
                targetSsid = scannedSsid; // Lock on to exact broadcast SSID string!
                Serial.printf("[WIFI] >>> MATCHED Hotspot SSID: '%s' (Length: %d chars) <<<\n", 
                              targetSsid.c_str(), targetSsid.length());
            }
        }
    } else {
        Serial.println(F("[WIFI] Scan returned no networks, proceeding with default configured SSID."));
    }
    WiFi.scanDelete();

    // 2. Connect to the target SSID
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
        Serial.println(F("[WIFI] =============================================="));
        Serial.println(F("[WIFI] SUCCESS: Master Node connected to Wi-Fi!"));
        Serial.printf("[WIFI] Connected SSID : '%s'\n", WiFi.SSID().c_str());
        Serial.printf("[WIFI] IP Address     : %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[WIFI] Subnet Mask    : %s\n", WiFi.subnetMask().toString().c_str());
        Serial.printf("[WIFI] Gateway IP     : %s\n", WiFi.gatewayIP().toString().c_str());
        Serial.printf("[WIFI] Signal Strength: %d dBm\n", WiFi.RSSI());
        Serial.println(F("[WIFI] =============================================="));

        // 1. Synchronize real UTC wall-clock time via SNTP
        initNtpClock();

        // 2. Pre-authenticate with Cloud Backend for autonomous sync
        loginCloudBackend();
    }
    else
    {
        Serial.printf("[WIFI] ⚠️ WARNING: Connection to '%s' timed out (Status code: %d).\n", 
                      targetSsid.c_str(), (int)WiFi.status());
        Serial.println(F("[WIFI] HINTS:"));
        Serial.println(F("       1. Ensure your phone hotspot is set to 2.4 GHz (Turn ON 'Maximize Compatibility')."));
        Serial.println(F("       2. Check hotspot password matches 'Aqualora'."));
        Serial.println(F("       3. Background auto-reconnect will continue retrying..."));
    }

    // Start mDNS Responder (e.g., ws://aqualora.local:8081)
    if (MDNS.begin(MDNS_HOSTNAME))
    {
        MDNS.addService("aqualora", "tcp", WEBSOCKET_PORT);
        Serial.printf("[MDNS] Responder active at http://%s.local\n", MDNS_HOSTNAME);
    }

    // Start UDP Presence Discovery Beacon
    g_discoveryUdp.begin(UDP_DISCOVERY_PORT);
    Serial.printf("[DISCOVERY] UDP presence beacon enabled on port %u\n", UDP_DISCOVERY_PORT);

    // Send immediate beacon if connected
    if (WiFi.status() == WL_CONNECTED)
    {
        sendDiscoveryBeacon();
    }

    // Start WebSocket Server
    g_webSocket.begin();
    g_webSocket.onEvent(webSocketEvent);
    Serial.printf("[WS] WebSocket Server listening on port %u (AES-256-GCM Encrypted)\n", WEBSOCKET_PORT);
    return true;
}

static bool g_wifiConnectedHandled = false;

/**
 * @brief Non-blocking WebSocket loop process.
 */
inline void processWebSocket()
{
    g_webSocket.loop();
    const unsigned long now = millis();

    // Check Wi-Fi state transition
    if (WiFi.status() == WL_CONNECTED)
    {
        if (!g_wifiConnectedHandled)
        {
            g_wifiConnectedHandled = true;
            Serial.println(F("[WIFI] Wi-Fi connected! Starting NTP sync and Cloud auth..."));
            initNtpClock();
            loginCloudBackend();
        }
    }
    else
    {
        g_wifiConnectedHandled = false;
    }

    if (now - g_lastDiscoveryMs >= DISCOVERY_INTERVAL_MS)
    {
        g_lastDiscoveryMs = now;
        sendDiscoveryBeacon();
    }
}

#endif // SECURE_WS_H
