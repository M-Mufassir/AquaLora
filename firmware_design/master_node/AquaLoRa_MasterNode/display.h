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
 * @brief Unstick hung I2C bus by clocking SCL 9 times and generating a STOP condition.
 */
inline void recoverI2CBus(uint8_t sdaPin, uint8_t sclPin) {
    pinMode(sdaPin, INPUT_PULLUP);
    pinMode(sclPin, OUTPUT);
    digitalWrite(sclPin, HIGH);
    delayMicroseconds(10);

    // If SDA is stuck LOW by a slave mid-transaction, pulse SCL 9 times
    for (int i = 0; i < 9; i++) {
        digitalWrite(sclPin, LOW);
        delayMicroseconds(10);
        digitalWrite(sclPin, HIGH);
        delayMicroseconds(10);
    }

    // Generate I2C STOP condition
    pinMode(sdaPin, OUTPUT);
    digitalWrite(sdaPin, LOW);
    delayMicroseconds(10);
    digitalWrite(sclPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(sdaPin, HIGH);
    delayMicroseconds(10);

    pinMode(sdaPin, INPUT_PULLUP);
    pinMode(sclPin, INPUT_PULLUP);
    delay(10);
}

/**
 * @brief Active I2C Bus Scanner to locate connected OLED screen address.
 * @return Discovered I2C address (0x3C, 0x3D, or 0x00 if not found).
 */
inline uint8_t scanI2COLEDAddress() {
    Serial.printf("[I2C SCAN] Scanning I2C bus on SDA=GPIO%d, SCL=GPIO%d...\n", OLED_SDA, OLED_SCL);
    uint8_t foundAddr = 0x00;
    int deviceCount = 0;
    
    for (uint8_t addr = 1; addr < 127; addr++) {
        Wire.beginTransmission(addr);
        uint8_t error = Wire.endTransmission();
        if (error == 0) {
            Serial.printf("[I2C SCAN] SUCCESS: Found I2C device at address 0x%02X!\n", addr);
            deviceCount++;
            if (addr == 0x3C || addr == 0x3D) {
                foundAddr = addr;
            }
        }
    }
    
    if (deviceCount == 0) {
        Serial.println(F("[I2C SCAN] ⚠️ ERROR: No I2C devices responded!"));
        Serial.println(F("[I2C SCAN] HARDWARE CHECKLIST FOR 1.3\" OLED (DM0056):"));
        Serial.println(F("           1. POWER: DM0056 1.3\" module has an on-board 3.3V regulator (662K)."));
        Serial.println(F("              Connecting VCC to ESP32 3.3V can cause undervoltage (~2.7V)."));
        Serial.println(F("              RECOMMENDED: Connect OLED VCC to ESP32 5V (or VIN) pin!"));
        Serial.println(F("           2. GND: Connect OLED GND to ESP32 GND."));
        Serial.println(F("           3. SCL: Connect OLED SCL to ESP32 GPIO 22 (D22)."));
        Serial.println(F("           4. SDA: Connect OLED SDA to ESP32 GPIO 21 (D21)."));
        Serial.println(F("           5. PINOUT: Verify header order (some are GND-VCC-SCL-SDA, others VCC-GND-SCL-SDA)."));
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
        0x81, 0xFF, // Set Max Contrast
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
 * Supports standard SSD1306 (via display.display()) and SH1106 via 16-byte I2C chunking.
 */
inline void renderDisplayHardware() {
#if IS_SH1106_DISPLAY
    uint8_t *buf = display.getBuffer();
    if (!buf) {
        display.display();
        return;
    }

    for (uint8_t page = 0; page < 8; page++) {
        Wire.beginTransmission(g_oledI2CAddr);
        Wire.write(0x00);         // Control byte: Command mode
        Wire.write(0xB0 + page);  // Page 0..7
        Wire.write(0x02);         // Column address low nibble = 2 (SH1106 2-pixel offset)
        Wire.write(0x10);         // Column address high nibble = 0
        Wire.endTransmission();

        for (uint8_t chunk = 0; chunk < 8; chunk++) {
            Wire.beginTransmission(g_oledI2CAddr);
            Wire.write(0x40);     // Control byte: Data mode
            Wire.write(&buf[page * 128 + (chunk * 16)], 16);
            Wire.endTransmission();
        }
    }
#else
    display.display();
#endif
}

/**
 * @brief Update Boot Status on OLED Display during setup.
 */
inline void updateDisplayBootStatus(const char *title, const char *status, const char *detail = "") {
    display.clearDisplay();
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println(F("===================="));
    display.printf(" %s\n", title);
    display.println(F("===================="));
    display.setCursor(0, 30);
    display.println(status);
    if (detail && *detail) {
        display.setCursor(0, 46);
        display.println(detail);
    }
    renderDisplayHardware();
}

/**
 * @brief Initialize the OLED Display over Wire I2C (GPIO 21 SDA, GPIO 22 SCL).
 * Supports TRONIC.LK DM0056 1.3" / 0.96" SSD1306 OLED displays.
 * @return True if display initialized successfully.
 */
inline bool initDisplay() {
    Serial.println(F("[OLED] Initializing I2C bus and OLED display driver..."));
    
    // Step 1: Recover any stuck slave on I2C bus and set pull-ups
    recoverI2CBus(OLED_SDA, OLED_SCL);

    // Step 2: Start I2C bus at standard 100 kHz speed with safe timeout
    Wire.begin(OLED_SDA, OLED_SCL);
    Wire.setClock(100000); // 100 kHz I2C rate
    delay(50);             // Stabilization delay

    // Step 2: Perform I2C bus scan to find exact OLED hardware address
    g_oledI2CAddr = scanI2COLEDAddress();
    if (g_oledI2CAddr == 0x00) {
        g_oledI2CAddr = OLED_I2C_ADDRESS; // Default fallback to 0x3C
        Serial.printf("[OLED] No I2C ack detected, attempting default address 0x%02X...\n", g_oledI2CAddr);
    }

    // Step 3: Initialize Adafruit GFX display driver
    bool success = display.begin(SSD1306_SWITCHCAPVCC, g_oledI2CAddr, false, false);
    if (!success) {
        uint8_t altAddr = (g_oledI2CAddr == 0x3C) ? 0x3D : 0x3C;
        Serial.printf("[OLED] Retrying GFX initialization at 0x%02X...\n", altAddr);
        success = display.begin(SSD1306_SWITCHCAPVCC, altAddr, false, false);
        if (success) g_oledI2CAddr = altAddr;
    }

    if (!success) {
        Serial.println(F("[OLED] ERROR: Display GFX allocation / initialization failed!"));
        return false;
    }

#if IS_SH1106_DISPLAY
    Serial.println(F("[OLED] Configuring 1.3\" SH1106 controller hardware registers..."));
    initSH1106Hardware(g_oledI2CAddr);
#else
    // Explicitly power on SSD1306 display panel and set high contrast
    display.ssd1306_command(SSD1306_DISPLAYON);
    display.dim(false);
#endif

    // Step 4: Clear uninitialized RAM noise
    display.clearDisplay();
    renderDisplayHardware();
    delay(20);

    // Step 5: Configure text properties and render initial boot screen
    display.setTextColor(SSD1306_WHITE);
    display.setTextSize(1);
    updateDisplayBootStatus("AQUALORA MASTER", "Booting system...", "Init Wi-Fi & LoRa...");

    Serial.printf("[OLED] OLED Display initialized successfully at address 0x%02X!\n", g_oledI2CAddr);
    return true;
}

/**
 * @brief Live Refresh OLED Display with freshly received LoRa telemetry data.
 * Displays all 4 parameters: Temp, pH, TDS, Turbidity along with RSSI and Packet Count.
 */
inline void updateDisplayLive(const String &nodeId, float temp, int tds, float turb, float ph, int rssi, float snr, uint32_t packetCount) {
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

    // Row 2: Temperature & pH Reading
    display.setCursor(0, 26);
    display.printf("Tmp: %.1f C | pH: %.2f", temp, ph);

    // Row 3: TDS Reading
    display.setCursor(0, 38);
    display.printf("TDS: %d ppm", tds);

    // Row 4: Turbidity Reading
    display.setCursor(0, 50);
    display.printf("Turb: %.1f NTU", turb);

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
