/**
 * @file rtc_driver.h
 * @brief PCF8563 Real-Time Clock (RTC) I2C Driver & Deep-Sleep Wakeup Interrupt Interface
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * DESIGN NOTES:
 * - PCF8563 is accessed via I2C bus on GPIO 25 (SDA) and GPIO 26 (SCL).
 * - Hardware Interrupt INT pin connected to GPIO 27 (Active LOW).
 * - Uses exact NXP datasheet register sequence: Disable Timer -> Clear Flags -> Write Value -> Enable Timer.
 * - Enables RTC GPIO internal pull-up on GPIO 27 to hold 3.3V during sleep.
 */

#ifndef RTC_DRIVER_H
#define RTC_DRIVER_H

#include <Arduino.h>
#include <Wire.h>
#include <driver/rtc_io.h>
#include "config.h"

/**
 * @brief Convert Binary-Coded Decimal (BCD) byte to Standard Decimal integer.
 */
inline uint8_t bcdToDec(uint8_t val) {
    return ((val >> 4) * 10) + (val & 0x0F);
}

/**
 * @brief Convert Standard Decimal integer to Binary-Coded Decimal (BCD) byte.
 */
inline uint8_t decToBcd(uint8_t val) {
    return ((val / 10) << 4) | (val % 10);
}

/**
 * @brief Clear PCF8563 status flags (TF & AF) to release INT pin (GPIO 27 -> HIGH).
 */
inline bool clearRTCFlags() {
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_STAT2);
    Wire.write(0x00); // Clear AF (bit 4) and TF (bit 3), disable TIE until re-armed
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
        Serial.println(F("[RTC] Status flags (TF & AF) cleared. INT pin (GPIO 27) released HIGH."));
    }
    return (err == 0);
}

/**
 * @brief Write default initial date/time to PCF8563 (2026-09-05 12:00:00) to clear VL flag.
 */
inline bool setRTCDefaultTime() {
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_VL_SECONDS);
    Wire.write(decToBcd(0));  // 00 seconds (Bit 7 VL = 0)
    Wire.write(decToBcd(0));  // 00 minutes
    Wire.write(decToBcd(12)); // 12 hours
    Wire.write(decToBcd(5));  // Day 5
    Wire.write(decToBcd(6));  // Saturday
    Wire.write(decToBcd(9));  // September
    Wire.write(decToBcd(26)); // Year 26 (2026)
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
        Serial.println(F("[RTC] Initialized default time (2026-09-05 12:00:00). VL flag cleared."));
    }
    return (err == 0);
}

/**
 * @brief Initialize Wire I2C interface, probe PCF8563 RTC, and clear pending interrupt flags.
 * @return True if PCF8563 responds on I2C bus address 0x51.
 */
inline bool initRTC() {
    Wire.begin(I2C_SDA, I2C_SCL);

    Wire.beginTransmission(PCF8563_I2C_ADDR);
    uint8_t error = Wire.endTransmission();

    if (error != 0) {
        Serial.println(F("[RTC] ERROR: PCF8563 RTC not responding on I2C bus (0x51)!"));
        Serial.printf("[RTC] DIAGNOSTICS: Verify SDA=GPIO %d, SCL=GPIO %d, pull-up resistors & CR2032 battery.\n", I2C_SDA, I2C_SCL);
        return false;
    }

    Serial.println(F("[RTC] PCF8563 I2C module initialized successfully."));

    // Enable RTC IO internal pull-up on GPIO 27 right away
    rtc_gpio_init((gpio_num_t)RTC_INT_PIN);
    rtc_gpio_set_direction((gpio_num_t)RTC_INT_PIN, RTC_GPIO_MODE_INPUT_ONLY);
    rtc_gpio_pullup_en((gpio_num_t)RTC_INT_PIN);
    rtc_gpio_pulldown_dis((gpio_num_t)RTC_INT_PIN);

    // Clear pending alarm & timer flags so INT pin (GPIO 27) releases HIGH!
    clearRTCFlags();

    return true;
}

/**
 * @brief Read current Date & Time from PCF8563 RTC over I2C and format ISO timestamp string.
 * 
 * @param timestampStr Output parameter formatted as "YYYY-MM-DDTHH:MM:SSZ"
 * @return True if date/time read succeeded from RTC hardware.
 */
inline bool readRTCDateTime(String &timestampStr) {
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_VL_SECONDS); // Start reading at register 0x02
    if (Wire.endTransmission() != 0) {
        timestampStr = "2026-01-01T00:00:00Z"; // Fallback timestamp
        Serial.println(F("[RTC] ERROR: Failed to transmit start register for reading date/time."));
        return false;
    }

    // Request 7 bytes (Seconds, Minutes, Hours, Days, Weekdays, Months/Century, Years)
    uint8_t bytesRead = Wire.requestFrom((uint8_t)PCF8563_I2C_ADDR, (uint8_t)7);
    if (bytesRead < 7) {
        timestampStr = "2026-01-01T00:00:00Z";
        Serial.println(F("[RTC] ERROR: Incomplete byte read from PCF8563."));
        return false;
    }

    uint8_t rawSec   = Wire.read();
    uint8_t rawMin   = Wire.read();
    uint8_t rawHour  = Wire.read();
    uint8_t rawDay   = Wire.read();
    Wire.read(); // Skip Weekday byte (register 0x06)
    uint8_t rawMonth = Wire.read();
    uint8_t rawYear  = Wire.read();

    // Check Voltage Low (VL) flag (Bit 7 of Seconds register)
    if (rawSec & 0x80) {
        Serial.println(F("[RTC] WARNING: PCF8563 VL flag set (low power/battery). Auto-resetting time..."));
        setRTCDefaultTime();
        timestampStr = "2026-09-05T12:00:00Z";
        return true;
    }

    // Mask out control/status bits
    uint8_t sec   = bcdToDec(rawSec & 0x7F);
    uint8_t min   = bcdToDec(rawMin & 0x7F);
    uint8_t hour  = bcdToDec(rawHour & 0x3F);
    uint8_t day   = bcdToDec(rawDay & 0x3F);
    uint8_t month = bcdToDec(rawMonth & 0x1F); // Bit 7 is Century bit
    int year      = 2000 + bcdToDec(rawYear);

    // Format ISO 8601 timestamp string: YYYY-MM-DDTHH:MM:SSZ
    char buffer[32];
    snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02dZ", year, month, day, hour, min, sec);
    timestampStr = String(buffer);

    Serial.printf("[RTC] Date/Time Read: %s\n", timestampStr.c_str());
    return true;
}

/**
 * @brief Configure external PCF8563 RTC countdown timer for next alarm cycle using standard NXP sequence.
 * NXP Datasheet Sequence: Disable Timer -> Clear Flags/Set TIE -> Write Countdown Value -> Enable Timer.
 * 
 * @param sleepSeconds Countdown interval in seconds.
 * @return True if PCF8563 accepted countdown timer configuration.
 */
inline bool setupRTCAlarm(uint32_t sleepSeconds) {
    // Step 1: Probe PCF8563 on I2C bus
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: PCF8563 not responding on I2C bus during alarm setup."));
        return false;
    }

    // Step 2: Disable timer first (write 0x00 to Timer Control 0x0E)
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_CTRL);
    Wire.write(0x00);
    Wire.endTransmission();

    // Step 3: Clear status flags (AF=0, TF=0) & set TIE (Timer Interrupt Enable, bit 1 = 1) -> 0x02
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_STAT2);
    Wire.write(0x02);
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: Failed to write Control_Status_2 register."));
        return false;
    }

    // Step 4: Write Timer Countdown Value (seconds)
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_VAL);
    Wire.write((uint8_t)(sleepSeconds > 255 ? 255 : sleepSeconds));
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: Failed to write Timer Value register."));
        return false;
    }

    // Step 5: Enable Timer with 1 Hz clock (Bit 7 TE=1, Bits 1-0 TD=10 -> 0x82)
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_CTRL);
    Wire.write(0x82);
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: Failed to write Timer Control register."));
        return false;
    }

    // Step 6: Configure RTC GPIO internal pull-up on GPIO 27 so it holds 3.3V HIGH during sleep
    rtc_gpio_init((gpio_num_t)RTC_INT_PIN);
    rtc_gpio_set_direction((gpio_num_t)RTC_INT_PIN, RTC_GPIO_MODE_INPUT_ONLY);
    rtc_gpio_pullup_en((gpio_num_t)RTC_INT_PIN);
    rtc_gpio_pulldown_dis((gpio_num_t)RTC_INT_PIN);

    // Step 7: Readback verification
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_VAL);
    Wire.endTransmission();
    Wire.requestFrom((uint8_t)PCF8563_I2C_ADDR, (uint8_t)1);
    uint8_t readbackVal = Wire.available() ? Wire.read() : 0xFF;

    if (readbackVal == sleepSeconds) {
        Serial.printf("[RTC] SUCCESS: PCF8563 countdown armed for %u sec. Hardware INT active LOW on GPIO %d.\n", sleepSeconds, RTC_INT_PIN);
        return true;
    } else {
        Serial.printf("[RTC] WARNING: Timer readback mismatch (expected %u, got %d).\n", sleepSeconds, readbackVal);
        return false;
    }
}

#endif // RTC_DRIVER_H
