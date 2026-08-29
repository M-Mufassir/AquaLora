/**
 * @file lora_comms.h
 * @brief LoRa Communication Driver Module (Ra-02 / SX1278 SPI Transceiver)
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * LORA ULTRA-LOW-POWER TRANSMISSION METHODOLOGY:
 * 1. SPI Re-Initialization: Hardware SPI bus configuration using designated pinout.
 * 2. Hardware Reset: Toggles LORA_RST line before initializing to ensure transceiver is out of reset state.
 * 3. Deep Sleep Radio Mode: `LoRa.sleep()` forces SX1278 transceiver into ultra-low-power sleep mode (< 0.2 µA).
 */

#ifndef LORA_COMMS_H
#define LORA_COMMS_H

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include "config.h"

/**
 * @brief Initialize the Ra-02 (SX1278) LoRa transceiver over SPI with hardware reset & diagnostics.
 * @return True if transceiver responded and initialized successfully.
 */
inline bool initLoRa() {
    Serial.println(F("[LORA] Initializing SPI bus and Ra-02 transceiver..."));

    // Step 1: Initialize hardware SPI bus with custom pin mapping
    SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);

    // Step 2: Pass SPI instance and control pins (NSS, RST, DIO0) to LoRa driver
    LoRa.setSPI(SPI);
    LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);

    // Step 3: Hardware Reset Cycle for Ra-02 module
    if (LORA_RST != -1) {
        pinMode(LORA_RST, OUTPUT);
        digitalWrite(LORA_RST, LOW);
        delay(20);
        digitalWrite(LORA_RST, HIGH);
        delay(50);
    }

    // Step 4: Attempt transceiver initialization on configured frequency
    if (!LoRa.begin(LORA_FREQUENCY)) {
        Serial.println(F("[LORA] ERROR: Ra-02 initialization failed!"));
        Serial.println(F("[LORA] DIAGNOSTICS: Check 3.3V power, GND, and SPI pinout:"));
        Serial.printf("        SCK=%d, MISO=%d, MOSI=%d, NSS=%d, RST=%d, DIO0=%d\n",
                      LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS, LORA_RST, LORA_DIO0);
        return false;
    }

    // Step 5: Apply RF parameters for optimized link budget & power efficiency
    LoRa.setTxPower(LORA_TX_POWER);
    LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
    LoRa.setSignalBandwidth(LORA_BANDWIDTH);
    LoRa.setCodingRate4(LORA_CODING_RATE);
    LoRa.setSyncWord(LORA_SYNC_WORD);

    Serial.printf("[LORA] Ra-02 Initialized! Freq: %.1f MHz, Power: %d dBm, Sync: 0x%02X\n", 
                  LORA_FREQUENCY / 1E6, LORA_TX_POWER, LORA_SYNC_WORD);
    return true;
}

/**
 * @brief Transmit formatted string telemetry payload over LoRa RF link.
 * 
 * @param payload Telemetry string formatted as: "Node1,Temp,TDS,Turb"
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
