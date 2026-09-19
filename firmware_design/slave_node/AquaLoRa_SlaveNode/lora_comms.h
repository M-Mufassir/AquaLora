/**
 * @file lora_comms.h
 * @brief LoRa Communication Driver Module (Ra-02 / SX1278 SPI Transceiver)
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * LORA ULTRA-LOW-POWER TRANSMISSION METHODOLOGY:
 * 1. Hardware SPI Initialization: Custom SPI bus on SCK=19, MISO=18, MOSI=23, NSS=5.
 * 2. Hardware Reset Cycle: Toggles LORA_RST line (GPIO 16) to ensure transceiver boots cleanly.
 * 3. SPI Diagnostics: Directly reads register 0x42 (Silicon Version byte, expects 0x12).
 * 4. Hardware CRC Protection: Enables hardware CRC checking to discard RF noise packets.
 * 5. Power Optimization: `LoRa.sleep()` forces SX1278 transceiver into ultra-low-power sleep mode (< 0.2 µA).
 */

#ifndef LORA_COMMS_H
#define LORA_COMMS_H

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "config.h"

/**
 * @brief Directly read SX1278 Version Register (0x42) over SPI for diagnostics.
 * @return Register 0x42 byte value (0x12 expected for genuine SX1278 chip).
 */
inline uint8_t probeLoRaVersion() {
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
 * @brief Initialize the Ra-02 (SX1278) LoRa transceiver over SPI with hardware reset & diagnostics.
 * @return True if transceiver responded and initialized successfully.
 */
inline bool initLoRa() {
    Serial.println(F("[LORA] Initializing SPI bus and Ra-02 transceiver..."));

    // Step 1: Pre-initialize NSS (GPIO 5) output HIGH to prevent SPI bus contention
    pinMode(LORA_NSS, OUTPUT);
    digitalWrite(LORA_NSS, HIGH);

    // Step 2: Perform clean hardware reset cycle for Ra-02 module
    if (LORA_RST != -1) {
        pinMode(LORA_RST, OUTPUT);
        digitalWrite(LORA_RST, LOW);
        delay(50);
        digitalWrite(LORA_RST, HIGH);
        delay(100);
    }

    // Step 3: Initialize hardware SPI bus with designated custom pin mapping
    SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);

    // Step 4: Diagnostic Direct Register Read (Reg 0x42 Version Probe)
    uint8_t versionByte = probeLoRaVersion();
    Serial.printf("[LORA] SPI Version Read Reg 0x42: 0x%02X (Expected: 0x12)\n", versionByte);

    if (versionByte == 0x00) {
        Serial.println(F("[LORA] DIAGNOSTIC HINT: 0x00 read! Check 3.3V power, MISO line or NSS pin 5 connection."));
    } else if (versionByte == 0xFF) {
        Serial.println(F("[LORA] DIAGNOSTIC HINT: 0xFF read! Check MISO line (GPIO 18) or MOSI line (GPIO 23) wiring."));
    } else if (versionByte == 0x12) {
        Serial.println(F("[LORA] Genuine SX1278 Transceiver Silicon Detected (0x12)!"));
    }

    // Step 5: Pass SPI instance and control pins (NSS, RST, DIO0) to LoRa driver
    LoRa.setSPI(SPI);
    LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

    // Step 6: Attempt transceiver initialization on configured frequency (433MHz) with retry loop
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
        Serial.println(F("[LORA] ERROR: Ra-02 initialization failed after 3 attempts!"));
        Serial.println(F("[LORA] DIAGNOSTICS: Check 3.3V power, GND, and SPI pinout:"));
        Serial.printf("        SCK=%d, MISO=%d, MOSI=%d, NSS=%d, RST=%d, DIO0=%d\n",
                      LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS, LORA_RST, LORA_DIO0);
        return false;
    }

    // Step 7: Apply RF parameters for optimized link budget & power efficiency
    LoRa.setTxPower(LORA_TX_POWER);
    LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
    LoRa.setSignalBandwidth(LORA_BANDWIDTH);
    LoRa.setCodingRate4(LORA_CODING_RATE);
    LoRa.setSyncWord(LORA_SYNC_WORD);
    LoRa.enableCrc(); // Enable hardware CRC to discard RF noise packets

    Serial.printf("[LORA] Ra-02 Initialized! Freq: %.1f MHz, Power: %d dBm, Sync: 0x%02X, CRC: Enabled\n", 
                  LORA_FREQUENCY / 1E6, LORA_TX_POWER, LORA_SYNC_WORD);
    return true;
}

/**
 * @brief Transmit formatted telemetry payload over LoRa RF link.
 * 
 * @param payload Telemetry string formatted as: "Node1,Timestamp,Temp,TDS,Turbidity,pH"
 * @return True if packet was queued and transmitted successfully.
 */
inline bool sendLoRaData(const String &payload) {
    Serial.printf("[LORA] Transmitting payload: '%s'\n", payload.c_str());

    // Begin packet transmission
    if (LoRa.beginPacket() == 0) {
        Serial.println(F("[LORA] ERROR: Failed to begin packet transmission."));
        return false;
    }

    LoRa.print(payload);
    
    // Blocking call until hardware transmission completes
    int result = LoRa.endPacket();

    if (result == 1) {
        Serial.println(F("[LORA] Packet transmitted successfully!"));
    } else {
        Serial.println(F("[LORA] ERROR: Packet transmission failed."));
    }

    // MANDATORY POWER SAVING: Put SX1278 into deep sleep mode (< 0.2 µA)
    LoRa.sleep();
    Serial.println(F("[LORA] Transceiver placed into SLEEP mode."));

    return (result == 1);
}

#endif // LORA_COMMS_H
