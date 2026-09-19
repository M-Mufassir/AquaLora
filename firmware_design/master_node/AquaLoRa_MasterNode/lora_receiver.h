/**
 * @file lora_receiver.h
 * @brief LoRa Packet Receiver & Telemetry Parser Module
 * @project AquaLoRa Marine Telemetry System - Master Receiver Node
 */

#ifndef LORA_RECEIVER_H
#define LORA_RECEIVER_H

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "config.h"
#include "display.h"
#include "secure_ws.h"

// Global packet counter tracking received telemetry packets
static uint32_t g_packetCounter = 0;

/**
 * @brief Directly read SX1278 Version Register (0x42) over SPI for diagnostics.
 * @return Register 0x42 byte value (0x12 expected for genuine SX1278 chip).
 */
inline uint8_t probeMasterLoRaVersion() {
    pinMode(LORA_NSS, OUTPUT);
    digitalWrite(LORA_NSS, HIGH);
    delay(5);

    SPI.beginTransaction(SPISettings(2000000, MSBFIRST, SPI_MODE0));
    digitalWrite(LORA_NSS, LOW);
    SPI.transfer(0x42 & 0x7F); // Read register 0x42 address (bit 7 = 0)
    uint8_t version = SPI.transfer(0x00);
    digitalWrite(LORA_NSS, HIGH);
    SPI.endTransaction();

    return version;
}

/**
 * @brief Initialize the Ra-02 (SX1278) LoRa transceiver in Master Receiver Mode over SPI.
 * @return True if transceiver responded and initialized successfully.
 */
inline bool initLoRaMaster() {
    Serial.println(F("[LORA] Initializing SPI bus and Ra-02 receiver..."));

    // Step 1: Pre-initialize NSS (GPIO 5) output HIGH to prevent SPI bus contention
    pinMode(LORA_NSS, OUTPUT);
    digitalWrite(LORA_NSS, HIGH);

    // Step 2: Hardware Reset Cycle for Ra-02 module (GPIO 27)
    if (LORA_RST != -1) {
        pinMode(LORA_RST, OUTPUT);
        digitalWrite(LORA_RST, LOW);
        delay(50);
        digitalWrite(LORA_RST, HIGH);
        delay(100);
    }

    // Step 3: Initialize hardware SPI bus with Master pinout (SCK:18, MISO:19, MOSI:23, NSS:5)
    SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);

    // Step 4: Diagnostic Direct Register Read (Reg 0x42 Version Probe)
    uint8_t versionByte = probeMasterLoRaVersion();
    Serial.printf("[LORA] SPI Version Read Reg 0x42: 0x%02X (Expected: 0x12)\n", versionByte);

    if (versionByte == 0x00) {
        Serial.println(F("[LORA] DIAGNOSTIC HINT: 0x00 read! Check 3.3V power, MISO line (19) or NSS pin 5 connection."));
    } else if (versionByte == 0xFF) {
        Serial.println(F("[LORA] DIAGNOSTIC HINT: 0xFF read! Check MISO line (19) or MOSI line (23) wiring."));
    } else if (versionByte == 0x12) {
        Serial.println(F("[LORA] Genuine SX1278 Transceiver Silicon Detected (0x12)!"));
    }

    // Step 5: Configure LoRa driver control pins
    LoRa.setSPI(SPI);
    LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

    // Step 6: Attempt transceiver initialization on 433 MHz with retry loop
    bool initialized = false;
    for (int attempt = 1; attempt <= 3; attempt++) {
        if (LoRa.begin(LORA_FREQUENCY)) {
            initialized = true;
            break;
        }

        // Retry hardware reset
        if (LORA_RST != -1) {
            digitalWrite(LORA_RST, LOW);
            delay(50);
            digitalWrite(LORA_RST, HIGH);
            delay(100);
        }
        delay(100);
    }

    if (!initialized) {
        Serial.println(F("[LORA] ERROR: Master Ra-02 initialization failed after 3 attempts!"));
        Serial.println(F("[LORA] DIAGNOSTICS: Check 3.3V power, GND, and SPI pinout:"));
        Serial.printf("        SCK=%d, MISO=%d, MOSI=%d, NSS=%d, RST=%d, DIO0=%d\n",
                      LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS, LORA_RST, LORA_DIO0);
        return false;
    }

    // Step 7: Apply identical RF parameters to match Slave Node transceiver
    LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
    LoRa.setSignalBandwidth(LORA_BANDWIDTH);
    LoRa.setCodingRate4(LORA_CODING_RATE);
    LoRa.setSyncWord(LORA_SYNC_WORD);
    LoRa.enableCrc(); // Enable hardware CRC checking to automatically drop noise/corrupted packets

    Serial.printf("[LORA] Master Receiver Ready! Freq: %.1f MHz, Sync: 0x%02X, CRC: Enabled\n", 
                  LORA_FREQUENCY / 1E6, LORA_SYNC_WORD);
    return true;
}

/**
 * @brief Non-blocking LoRa packet check. If a packet is received, it parses
 * the payload, logs to Serial, updates OLED display live, and broadcasts telemetry to Dashboard.
 * 
 * Supports:
 * - 6-Field Timestamped Format: "Node1,YYYY-MM-DDTHH:MM:SSZ,Temp,TDS,Turbidity,pH"
 * - 5-Field Legacy Format: "Node1,Temp,TDS,Turbidity,pH"
 * - 4-Field Standard Format: "Node1,Temp,TDS,Turbidity"
 */
inline void processIncomingLoRa() {
    int packetSize = LoRa.parsePacket();
    if (packetSize == 0) {
        return; // No packet received yet
    }

    // Read full packet payload string
    String rawPayload = "";
    while (LoRa.available()) {
        rawPayload += (char)LoRa.read();
    }
    rawPayload.trim();

    // Fetch RF Signal Metrics
    int rssi = LoRa.packetRssi();
    float snr = LoRa.packetSnr();
    g_packetCounter++;

    Serial.println(F("\n=================================================="));
    Serial.printf("[LORA RX] Packet #%u Received (%d bytes) | RSSI: %d dBm | SNR: %.2f dB\n", 
                  g_packetCounter, packetSize, rssi, snr);
    Serial.printf("[LORA RX] Raw Payload: '%s'\n", rawPayload.c_str());

    String nodeId = "Unknown";
    String timestampStr = "";
    float tempC = 0.0f;
    int tdsPPM = 0;
    float turbidityNTU = 0.0f;
    float phVal = 7.0f;

    // Count commas to determine payload format
    int commaCount = 0;
    for (size_t i = 0; i < rawPayload.length(); i++) {
        if (rawPayload.charAt(i) == ',') commaCount++;
    }

    if (commaCount >= 3) {
        // Parse CSV fields
        int indices[6];
        int idx = 0;

        for (size_t i = 0; i < rawPayload.length() && idx < 6; i++) {
            if (rawPayload.charAt(i) == ',') {
                indices[idx++] = i;
            }
        }

        if (commaCount >= 5) { // 6 fields: NodeID, Timestamp, Temp, TDS, Turbidity, pH
            nodeId       = rawPayload.substring(0, indices[0]);
            timestampStr = rawPayload.substring(indices[0] + 1, indices[1]);
            tempC        = rawPayload.substring(indices[1] + 1, indices[2]).toFloat();
            tdsPPM       = rawPayload.substring(indices[2] + 1, indices[3]).toInt();
            turbidityNTU = rawPayload.substring(indices[3] + 1, indices[4]).toFloat();
            phVal        = rawPayload.substring(indices[4] + 1).toFloat();
        } 
        else if (commaCount == 4) { // 5 fields: NodeID, Temp, TDS, Turbidity, pH
            nodeId       = rawPayload.substring(0, indices[0]);
            tempC        = rawPayload.substring(indices[0] + 1, indices[1]).toFloat();
            tdsPPM       = rawPayload.substring(indices[1] + 1, indices[2]).toInt();
            turbidityNTU = rawPayload.substring(indices[2] + 1, indices[3]).toFloat();
            phVal        = rawPayload.substring(indices[3] + 1).toFloat();
        } 
        else if (commaCount == 3) { // 4 fields: NodeID, Temp, TDS, Turbidity
            nodeId       = rawPayload.substring(0, indices[0]);
            tempC        = rawPayload.substring(indices[0] + 1, indices[1]).toFloat();
            tdsPPM       = rawPayload.substring(indices[1] + 1, indices[2]).toInt();
            turbidityNTU = rawPayload.substring(indices[2] + 1).toFloat();
            phVal        = 7.0f;
        }

        Serial.printf("[PARSED] Node: %s | Time: %s | Temp: %.2f C | TDS: %d ppm | Turbidity: %.2f NTU | pH: %.2f\n",
                      nodeId.c_str(), timestampStr.length() > 0 ? timestampStr.c_str() : "N/A", tempC, tdsPPM, turbidityNTU, phVal);

        // LIVE REFRESH OLED DISPLAY IMMEDIATELY FOR EVERY RECEIVED PACKET
        updateDisplayLive(nodeId, tempC, tdsPPM, turbidityNTU, phVal, rssi, snr, g_packetCounter);
        Serial.println(F("[OLED] Display refreshed with live telemetry readings."));

        // BROADCAST ENCRYPTED TELEMETRY TO DASHBOARD VIA WEBSOCKET
        broadcastLoRaTelemetryWS(nodeId, timestampStr, tempC, tdsPPM, turbidityNTU, phVal, rssi);
        Serial.println(F("[WS] Telemetry encrypted & broadcasted to dashboard."));
    } else {
        Serial.println(F("[PARSER] WARNING: Received payload format invalid! Expected 'NodeID,Timestamp,Temp,TDS,Turb,pH'"));
    }
    Serial.println(F("=================================================="));
}

#endif // LORA_RECEIVER_H
