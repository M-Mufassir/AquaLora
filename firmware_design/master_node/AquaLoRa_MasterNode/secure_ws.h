/**
 * @file secure_ws.h
 * @brief Wi-Fi AP & AES-256-GCM Encrypted WebSocket Server Module for AquaLoRa Master Node
 * @project AquaLoRa Marine Telemetry System - Master Receiver Node
 */

#ifndef SECURE_WS_H
#define SECURE_WS_H

#include <Arduino.h>
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <time.h>
#include <sys/time.h>
#include <mbedtls/gcm.h>
#include <mbedtls/base64.h>
#include <mbedtls/md.h>
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
 * @brief Initialize AES-256-GCM cipher with SHA-256 key derived from AP_PASSWORD.
 */
inline void initCipher()
{
    uint8_t key[32];
    const mbedtls_md_info_t *mdInfo = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    mbedtls_md(mdInfo, (const unsigned char *)WIFI_AP_PASSWORD, strlen(WIFI_AP_PASSWORD), key);
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

/**
 * @brief Seed fake clock at boot for monotonic ISO 8601 timestamps.
 */
inline void seedFakeClock()
{
    struct timeval tv = {.tv_sec = 1767225600, .tv_usec = 0}; // 2026-01-01T00:00:00Z
    settimeofday(&tv, nullptr);
}

/**
 * @brief Generate ISO 8601 UTC timestamp string.
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
        o["node_id"] = "slave-01";
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
inline void broadcastLoRaTelemetryWS(const String &nodeId, float temp, int tds, float turb, int rssi)
{
    registerNode(nodeId);

    StaticJsonDocument<256> doc;
    doc["node_id"] = nodeId;
    doc["timestamp"] = isoTimestampNow();
    doc["temperature"] = temp;
    doc["turbidity"] = turb;
    doc["tds"] = tds;
    doc["ph"] = 7.0f;
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
 * @brief Initialize Wi-Fi Access Point and AES-256-GCM WebSocket Server.
 */
inline bool initSecureWebSocket()
{
    Serial.println(F("[WIFI] Starting Master Node network connection..."));
    seedFakeClock();
    randomSeed(esp_random());
    initCipher();

    // Default slave node pre-registration
    registerNode("slave-01");

#if WIFI_USE_EXTERNAL_NETWORK
    WiFi.mode(WIFI_STA);
    WiFi.begin(EXTERNAL_WIFI_SSID, EXTERNAL_WIFI_PASSWORD);
    Serial.printf("[WIFI] Connecting to external network '%s'...\n", EXTERNAL_WIFI_SSID);

    unsigned long startMs = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startMs < 20000UL)
    {
        delay(250);
    }

    if (WiFi.status() != WL_CONNECTED)
    {
        Serial.println(F("[WIFI] External WiFi join failed. Falling back to AP mode."));
        WiFi.mode(WIFI_AP);
        bool apStarted = WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
        if (!apStarted)
        {
            Serial.println(F("[WIFI] ERROR: Failed to start Wi-Fi AP fallback!"));
            return false;
        }
        Serial.printf("[WIFI] Access Point Started! SSID: '%s'\n", WIFI_AP_SSID);
        Serial.printf("[WIFI] Master Node AP Gateway IP: %s\n", WiFi.softAPIP().toString().c_str());
    }
    else
    {
        Serial.printf("[WIFI] Connected to external WiFi. Local IP: %s\n", WiFi.localIP().toString().c_str());
    }
#else
    WiFi.mode(WIFI_AP);
    bool apStarted = WiFi.softAP(WIFI_AP_SSID, WIFI_AP_PASSWORD);
    if (!apStarted)
    {
        Serial.println(F("[WIFI] ERROR: Failed to start Wi-Fi AP!"));
        return false;
    }

    Serial.printf("[WIFI] Access Point Started! SSID: '%s'\n", WIFI_AP_SSID);
    Serial.printf("[WIFI] Master Node AP Gateway IP: %s\n", WiFi.softAPIP().toString().c_str());
#endif

    g_webSocket.begin();
    g_webSocket.onEvent(webSocketEvent);
    Serial.printf("[WS] WebSocket Server listening on port %u (AES-256-GCM Encrypted)\n", WEBSOCKET_PORT);
    return true;
}

/**
 * @brief Non-blocking WebSocket loop process.
 */
inline void processWebSocket()
{
    g_webSocket.loop();
}

#endif // SECURE_WS_H
