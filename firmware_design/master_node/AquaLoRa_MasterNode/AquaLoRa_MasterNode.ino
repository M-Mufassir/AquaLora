/**
 * @file AquaLoRa_MasterNode.ino
 * @brief Production Firmware for AquaLoRa Master Receiver Node with Live OLED & AES-256-GCM WebSockets
 * @project AquaLoRa Marine Telemetry System - Master Receiver Node
 * 
 * HARDWARE PINOUT:
 * - RA-02 LoRa SPI: SCK=GPIO18, MISO=GPIO19, MOSI=GPIO23, NSS=GPIO5, RST=GPIO27, DIO0=GPIO13
 * - OLED I2C: SDA=GPIO21, SCL=GPIO22 (1.3" SH1106 / 0.96" SSD1306)
 * - Wi-Fi AP: SSID="AquaLoRa-MasterNode", Password="aqualora123"
 * - WebSocket Server: Port 8081 (ws://192.168.4.1:8081) with AES-256-GCM encryption
 */

#include <Wire.h>
#include <SPI.h>
#include "config.h"
#include "display.h"
#include "secure_ws.h"
#include "lora_receiver.h"

// Define global Adafruit_SSD1306 display object declared as extern in display.h
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

void setup() {
    // Initialize Serial Debug Console
    Serial.begin(SERIAL_BAUD);
    delay(100);
    Serial.println(F("\n=================================================="));
    Serial.println(F("    AquaLoRa Master Node Firmware Starting...     "));
    Serial.println(F("=================================================="));

    // Step 1: Initialize Wi-Fi AP & AES-256-GCM Encrypted WebSocket Server
    bool wsOK = initSecureWebSocket();
    if (!wsOK) {
        Serial.println(F("[BOOT] WARNING: Wi-Fi AP / WebSocket server failed to initialize!"));
    }

    // Step 2: Initialize 0.96" SSD1306 / 1.3" SH1106 OLED Display (GPIO 21 SDA, GPIO 22 SCL)
    bool displayOK = initDisplay();
    if (!displayOK) {
        Serial.println(F("[BOOT] WARNING: OLED display failed to initialize. Continuing Serial mode."));
    }

    // Step 3: Initialize Ra-02 (SX1278) LoRa Transceiver (SPI: 18, 19, 23, 5, 27, 13)
    bool loraOK = initLoRaMaster();
    if (!loraOK) {
        Serial.println(F("[BOOT] CRITICAL ERROR: Ra-02 LoRa failed to initialize!"));
        showDisplayError("LoRa Ra-02 Init Fail!\nCheck SPI Pinout\nSCK:18, MISO:19\nMOSI:23, NSS:5");
    } else {
        Serial.println(F("[BOOT] Master Node system setup complete. Listening for LoRa telemetry & WebSocket clients..."));
    }
    Serial.println(F("==================================================\n"));
}

void loop() {
    // 1. Process Wi-Fi WebSocket incoming/outgoing data and client events
    processWebSocket();

    // 2. Continuously monitor and process incoming LoRa telemetry packets
    // Updates OLED display LIVE and broadcasts telemetry to Dashboard over WebSocket
    processIncomingLoRa();

    // Short yield delay to prevent CPU starving and keep system responsive
    delay(10);
}
