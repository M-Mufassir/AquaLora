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
 * @brief Initialize the Ra-02 (SX1278) LoRa transceiver in Master Receiver Mode over SPI.
 * @return True if transceiver responded and initialized successfully.
 */
inline bool initLoRaMaster() {
    Serial.println(F("[LORA] Initializing SPI bus and Ra-02 receiver..."));

    // Step 1: Initialize hardware SPI bus with Master pinout (SCK:18, MISO:19, MOSI:23, NSS:5)
    SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);

    // Step 2: Configure LoRa driver control pins
    LoRa.setSPI(SPI);
    LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

    // Step 3: Hardware Reset Cycle for Ra-02 module (GPIO 27)
    if (LORA_RST != -1) {
        pinMode(LORA_RST, OUTPUT);
        digitalWrite(LORA_RST, LOW);
        delay(20);
        digitalWrite(LORA_RST, HIGH);
        delay(50);
    }

    // Step 4: Attempt transceiver initialization on 433 MHz
    if (!LoRa.begin(LORA_FREQUENCY)) {
        Serial.println(F("[LORA] ERROR: Ra-02 initialization failed!"));
        Serial.println(F("[LORA] DIAGNOSTICS: Check 3.3V power, GND, and SPI pinout:"));
        Serial.printf("        SCK=%d, MISO=%d, MOSI=%d, NSS=%d, RST=%d, DIO0=%d\n",
                      LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS, LORA_RST, LORA_DIO0);
        return false;
    }

    // Step 5: Apply identical RF parameters to match Slave Node transceiver
    LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
    LoRa.setSignalBandwidth(LORA_BANDWIDTH);
    LoRa.setCodingRate4(LORA_CODING_RATE);
    LoRa.setSyncWord(LORA_SYNC_WORD);

    Serial.printf("[LORA] Master Receiver Ready! Freq: %.1f MHz, Sync: 0x%02X\n", 
                  LORA_FREQUENCY / 1E6, LORA_SYNC_WORD);
    return true;
}

/**
 * @brief Non-blocking LoRa packet check. If a packet is received, it parses
 * the comma-separated telemetry payload ("Node1,Temp,TDS,Turb"), logs to Serial,
 * IMMEDIATELY updates the OLED display live, and broadcasts encrypted data to Dashboard over WebSocket.
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

    // Parse comma-separated payload: "Node1,25.40,320,1.50,7.20" or legacy "Node1,25.40,320,1.50"
    String nodeId = "Unknown";
    float tempC = 0.0f;
    int tdsPPM = 0;
    float turbidityNTU = 0.0f;
    float phVal = 7.0f;

    int firstComma = rawPayload.indexOf(',');
    int secondComma = rawPayload.indexOf(',', firstComma + 1);
    int thirdComma = rawPayload.indexOf(',', secondComma + 1);
    int fourthComma = rawPayload.indexOf(',', thirdComma + 1);

    if (firstComma != -1 && secondComma != -1 && thirdComma != -1) {
        nodeId = rawPayload.substring(0, firstComma);
        tempC = rawPayload.substring(firstComma + 1, secondComma).toFloat();
        tdsPPM = rawPayload.substring(secondComma + 1, thirdComma).toInt();
        
        if (fourthComma != -1) {
            turbidityNTU = rawPayload.substring(thirdComma + 1, fourthComma).toFloat();
            phVal = rawPayload.substring(fourthComma + 1).toFloat();
        } else {
            turbidityNTU = rawPayload.substring(thirdComma + 1).toFloat();
            phVal = 7.0f;
        }

        Serial.printf("[PARSED] Node: %s | Temp: %.2f C | TDS: %d ppm | Turbidity: %.2f NTU | pH: %.2f\n",
                      nodeId.c_str(), tempC, tdsPPM, turbidityNTU, phVal);

        // LIVE REFRESH OLED DISPLAY IMMEDIATELY FOR EVERY RECEIVED PACKET
        updateDisplayLive(nodeId, tempC, tdsPPM, turbidityNTU, rssi, snr, g_packetCounter);
        Serial.println(F("[OLED] Display refreshed with live telemetry readings."));

        // BROADCAST ENCRYPTED TELEMETRY TO DASHBOARD VIA WEBSOCKET
        broadcastLoRaTelemetryWS(nodeId, tempC, tdsPPM, turbidityNTU, phVal, rssi);
        Serial.println(F("[WS] Telemetry encrypted & broadcasted to dashboard."));
    } else {
        Serial.println(F("[PARSER] WARNING: Received payload format invalid! Expected 'NodeID,Temp,TDS,Turb[,pH]'"));
    }
    Serial.println(F("=================================================="));
}

#endif // LORA_RECEIVER_H
