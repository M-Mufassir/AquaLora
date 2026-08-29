/**
 * @file display.h
 * @brief SSD1306 & SH1106 OLED Display Driver Module for AquaLoRa Master Node
 * @project AquaLoRa Marine Telemetry System - Master Receiver Node
 */

#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"

// Global SSD1306/Adafruit_GFX Display Instance
extern Adafruit_SSD1306 display;

// Active target I2C address detected on startup
static uint8_t g_oledI2CAddr = OLED_I2C_ADDRESS;

/**
 * @brief Active I2C Bus Scanner to locate connected OLED screen address.
 * @return Discovered I2C address (0x3C, 0x3D, or 0x00 if not found).
 */
inline uint8_t scanI2COLEDAddress() {
    Serial.println(F("[I2C SCAN] Scanning I2C bus on SDA (GPIO 21) & SCL (GPIO 22)..."));
    uint8_t foundAddr = 0x00;
    
    for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        if (Wire.endTransmission() == 0) {
            Serial.printf("[I2C SCAN] Found I2C device at address 0x%02X!\n", addr);
            if (addr == 0x3C || addr == 0x3D) {
                foundAddr = addr;
            }
        }
    }
    
    if (foundAddr == 0x00) {
        Serial.println(F("[I2C SCAN] WARNING: No OLED display detected on I2C bus!"));
        Serial.println(F("[I2C SCAN] DIAGNOSTICS: Check VCC (3.3V), GND, SDA (21), SCL (22) jumper wires."));
    }
    return foundAddr;
}

/**
 * @brief Initialize SH1106 hardware registers (Charge Pump ON, Page Addressing Mode).
 */
inline void initSH1106Hardware(uint8_t i2cAddr) {
    static const uint8_t initCmds[] = {
        0x00,       // Control byte: Command stream
        0xAE,       // Display OFF
        0x02,       // Set Low Column Address (2-pixel SH1106 offset)
        0x10,       // Set High Column Address
        0x40,       // Set Display Start Line 0
        0x81, 0x80, // Set Contrast 128
        0xA1,       // Set Segment Re-map (ADC = 1, normal orientation)
        0xC8,       // Set COM Output Scan Direction (remapped)
        0xA6,       // Normal Display (non-inverted)
        0xA8, 0x3F, // Multiplex Ratio 1/64
        0xD3, 0x00, // Display Offset 0
        0xD5, 0x80, // Clock Divide Ratio
        0xD9, 0x22, // Pre-charge Period
        0xDA, 0x12, // COM Pins Hardware Config
        0xDB, 0x40, // VCOMH Deselect Level
        0xAD, 0x8B, // SH1106 DC-DC Control (Charge Pump ON)
        0xAF        // Display ON
    };

    Wire.beginTransmission(i2cAddr);
    Wire.write(initCmds, sizeof(initCmds));
    Wire.endTransmission();
    delay(50);
}

/**
 * @brief Render Adafruit_GFX framebuffer to hardware screen.
 * Automatically handles SH1106 132x64 page addressing mode with 2-pixel column offset!
 */
inline void renderDisplayHardware() {
#if IS_SH1106_DISPLAY
    uint8_t *buf = display.getBuffer();
    if (!buf) {
        display.display();
        return;
    }

    for (uint8_t page = 0; page < 8; page++) {
        // Set Page Address and 2-pixel column offset for SH1106
        Wire.beginTransmission(g_oledI2CAddr);
        Wire.write(0x00);         // Control byte: Command mode
        Wire.write(0xB0 + page);  // Page 0..7
        Wire.write(0x02);         // Column address low nibble = 2 (SH1106 2-pixel offset)
        Wire.write(0x10);         // Column address high nibble = 0
        Wire.endTransmission();

        // Write 128 bytes of pixel data for this page (split into two 64-byte transfers)
        Wire.beginTransmission(g_oledI2CAddr);
        Wire.write(0x40);         // Control byte: Data mode
        Wire.write(&buf[page * 128], 64);
        Wire.endTransmission();

        Wire.beginTransmission(g_oledI2CAddr);
        Wire.write(0x40);         // Control byte: Data mode
        Wire.write(&buf[page * 128 + 64], 64);
        Wire.endTransmission();
    }
#else
    display.display();
#endif
}

/**
 * @brief Initialize the OLED Display over Wire I2C (GPIO 21 SDA, GPIO 22 SCL).
 * Supports both 1.3" SH1106 and 0.96" SSD1306 OLED displays.
 * @return True if display initialized successfully.
 */
inline bool initDisplay() {
    Serial.println(F("[OLED] Initializing I2C bus and OLED display driver..."));
    
    // Step 1: Start I2C bus at standard 100 kHz speed
    Wire.begin(OLED_SDA, OLED_SCL);
    Wire.setClock(100000); // 100 kHz I2C rate
    delay(100);            // 100ms power stabilization delay

    // Step 2: Perform I2C bus scan to find exact OLED hardware address
    g_oledI2CAddr = scanI2COLEDAddress();
    if (g_oledI2CAddr == 0x00) {
        g_oledI2CAddr = OLED_I2C_ADDRESS; // Default fallback to 0x3C
    }

    // Step 3: Initialize GFX buffer in RAM
    bool success = display.begin(SSD1306_SWITCHCAPVCC, g_oledI2CAddr, true, false);
    if (!success) {
        uint8_t altAddr = (g_oledI2CAddr == 0x3C) ? 0x3D : 0x3C;
        Serial.printf("[OLED] Retrying GFX initialization at 0x%02X...\n", altAddr);
        success = display.begin(SSD1306_SWITCHCAPVCC, altAddr, true, false);
        if (success) g_oledI2CAddr = altAddr;
    }

    if (!success) {
        Serial.println(F("[OLED] ERROR: Display GFX allocation failed!"));
        return false;
    }

#if IS_SH1106_DISPLAY
    Serial.println(F("[OLED] Configuring 1.3\" SH1106 controller hardware registers..."));
    initSH1106Hardware(g_oledI2CAddr);
#endif

    // Step 4: Clear uninitialized RAM noise ("messy white dots")
    display.clearDisplay();
    renderDisplayHardware();
    delay(50);

    // Step 5: Configure text properties
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    
    // Step 6: Render Boot Splash Screen
    display.setCursor(0, 0);
    display.println(F("===================="));
    display.println(F("  AQUALORA MASTER   "));
    display.println(F(" Telemetry Receiver "));
    display.println(F("===================="));
    display.setCursor(0, 40);
    display.println(F("Waiting for LoRa... "));
    display.println(F("Listening on 433MHz "));
    renderDisplayHardware();

    Serial.println(F("[OLED] 1.3\" SH1106 OLED Display initialized successfully!"));
    return true;
}

/**
 * @brief Live Refresh OLED Display with freshly received LoRa telemetry data.
 */
inline void updateDisplayLive(const String &nodeId, float temp, int tds, float turb, int rssi, float snr, uint32_t packetCount) {
    display.clearDisplay();
    
    // Top Banner Header
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.printf("AQUALORA RX [#%u]", packetCount);
    display.drawLine(0, 10, 127, 10, SSD1306_WHITE);

    // Row 1: Node ID & RSSI
    display.setCursor(0, 14);
    display.printf("%s | RSSI:%ddBm", nodeId.c_str(), rssi);

    // Row 2: Temperature Reading
    display.setCursor(0, 26);
    display.printf("Temp : %.2f C", temp);

    // Row 3: TDS Reading
    display.setCursor(0, 38);
    display.printf("TDS  : %d ppm", tds);

    // Row 4: Turbidity Reading
    display.setCursor(0, 50);
    display.printf("Turb : %.2f NTU", turb);

    // Render immediately to hardware screen
    renderDisplayHardware();
}

/**
 * @brief Display error status on OLED screen.
 */
inline void showDisplayError(const char *errorMessage) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(F("=== HARDWARE ERROR ==="));
    display.setCursor(0, 20);
    display.println(errorMessage);
    renderDisplayHardware();
}

#endif // DISPLAY_H
