/**
 * @file AquaLoRa_SlaveNode.ino
 * @brief Production Firmware for AquaLoRa Slave Node with PCF8563 RTC Hardware Interrupt Sleep
 * @project AquaLoRa Marine Telemetry System - Solar-Powered Marine Telemetry Node
 * @author Senior Embedded Systems Engineer
 */

#include <Wire.h>
#include "config.h"
#include "sensors.h"
#include "lora_comms.h"

// PCF8563 I2C Address and Control Registers
#define PCF8563_I2C_ADDR        0x51
#define PCF8563_REG_STAT2       0x01
#define PCF8563_REG_TIMER_CTRL  0x0E
#define PCF8563_REG_TIMER_VAL   0x0F

/**
 * @brief Configure external PCF8563 RTC countdown timer for next alarm cycle (30 seconds).
 * Clears status register interrupt flags (AF & TF) and enables Timer Interrupt (TIE).
 * When countdown reaches 0, INT pin (connected to ESP32 GPIO 27) pulls LOW.
 * 
 * @return True if PCF8563 responded on I2C and timer hardware interrupt was configured.
 */
bool setupRTCAlarm() {
    // Step 1: Start I2C strictly on designated SDA (GPIO 25) & SCL (GPIO 26) pins
    Wire.begin(I2C_SDA, I2C_SCL);
    
    // Step 2: Probe PCF8563 on I2C bus (0x51)
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: PCF8563 RTC not responding at I2C address 0x51!"));
        Serial.println(F("[RTC] DIAGNOSTICS: Check CR2032 battery, I2C pull-ups, and SDA(25)/SCL(26) wiring."));
        return false;
    }
    Serial.println(F("[RTC] PCF8563 I2C communication verified OK."));

    // Step 3: Clear PCF8563 status register 2 flags (AF & TF) & set TIE bit (Timer Interrupt Enable)
    // Register 0x01: Bit 1 (TIE) = 1, Bit 3 (TF) = 0, Bit 4 (AF) = 0 -> 0x02
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_STAT2);
    Wire.write(0x02); 
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: Failed to clear flags / write Control_Status_2 register."));
        return false;
    }

    // Step 4: Configure Timer Control: Enable Timer (bit 7 = 1), Clock freq 1 Hz (1 tick/sec, bits 0-1 = 10) -> 0x82
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_CTRL);
    Wire.write(0x82); 
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: Failed to write Timer Control register."));
        return false;
    }

    // Step 5: Set Timer Countdown Value (30 seconds)
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_VAL);
    Wire.write(SLEEP_DURATION_SEC);
    if (Wire.endTransmission() != 0) {
        Serial.println(F("[RTC] ERROR: Failed to write Timer Value register."));
        return false;
    }

    // Step 6: Perform readback verification to ensure timer register accepted value
    Wire.beginTransmission(PCF8563_I2C_ADDR);
    Wire.write(PCF8563_REG_TIMER_VAL);
    Wire.endTransmission();
    Wire.requestFrom(PCF8563_I2C_ADDR, 1);
    uint8_t readbackVal = Wire.available() ? Wire.read() : 0xFF;

    if (readbackVal == SLEEP_DURATION_SEC) {
        Serial.printf("[RTC] SUCCESS: PCF8563 timer programmed for %d seconds. Hardware INT armed on GPIO 27.\n", SLEEP_DURATION_SEC);
        return true;
    } else {
        Serial.printf("[RTC] WARNING: PCF8563 timer readback mismatch (expected %d, got %d).\n", SLEEP_DURATION_SEC, readbackVal);
        return false;
    }
}

void setup() {
    // ========================================================================
    // BOOT PHASE: IMMEDIATE SENSOR POWER ON (GPIO 33 HIGH)
    // ========================================================================
    pinMode(MOSFET_PIN, OUTPUT);
    digitalWrite(MOSFET_PIN, HIGH); // GPIO 33 HIGH -> 2N7000 ON -> IRF4905 Gate LOW -> 5V ON
    
    // Initialize Serial Debug Console
    Serial.begin(SERIAL_BAUD);
    delay(10);
    Serial.println(F("\n=================================================="));
    Serial.println(F("    AquaLoRa Slave Node Firmware Starting...     "));
    Serial.println(F("=================================================="));
    Serial.println(F("[BOOT] GPIO 33 set HIGH -> High-Side MOSFET Switch Powered ON."));

    // Check wakeup cause for diagnostic logging
    esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
    if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
        Serial.println(F("[WAKE] Woken up by PCF8563 RTC Hardware Interrupt (GPIO 27 ext0 LOW)."));
    } else if (wakeup_reason == ESP_SLEEP_WAKEUP_TIMER) {
        Serial.println(F("[WAKE] Woken up by ESP32 Internal Timer (Fallback)."));
    } else {
        Serial.println(F("[WAKE] Cold Boot / Power-On Reset detected."));
    }

    // Delay 1000ms for 5V rail, boost converter & analog sensors to stabilize
    delay(STABILIZATION_DELAY_MS);
    Serial.printf("[BOOT] %dms power stabilization complete.\n", STABILIZATION_DELAY_MS);

    // ========================================================================
    // INITIALIZE SUBSYSTEMS & HARDWARE BUSES
    // ========================================================================
    initSensors();
    bool loraSuccess = initLoRa();

    // ========================================================================
    // READ SENSOR DATA
    // ========================================================================
    float tempC = 0.0f;
    int tdsPPM = 0;
    float turbidityNTU = 0.0f;
    float phVal = 7.0f;

    readAllSensors(tempC, tdsPPM, turbidityNTU, phVal);

    // ========================================================================
    // FORMAT PAYLOAD AS COMMA-SEPARATED STRING (Node1,Temp,TDS,Turb,pH)
    // ========================================================================
    char payloadBuffer[64];
    snprintf(payloadBuffer, sizeof(payloadBuffer), "%s,%.2f,%d,%.2f,%.2f", 
             NODE_ID, tempC, tdsPPM, turbidityNTU, phVal);
    
    String telemetryPayload = String(payloadBuffer);
    Serial.printf("[TELEMETRY] Formatted Payload: '%s'\n", telemetryPayload.c_str());

    // ========================================================================
    // TRANSMIT PACKET VIA LORA RA-02
    // ========================================================================
    if (loraSuccess) {
        sendLoRaData(telemetryPayload);
    } else {
        Serial.println(F("[LORA] Skipping transmission due to Ra-02 initialization failure."));
    }

    // ========================================================================
    // POWER DOWN PHASE: CUT 5V SENSOR POWER (GPIO 33 LOW) BEFORE SLEEP
    // ========================================================================
    digitalWrite(MOSFET_PIN, LOW); // Turn OFF 2N7000 / IRF4905 -> Cut 5V power to sensors
    Serial.println(F("[POWER] GPIO 33 set LOW -> 5V Sensor Rail Completely Cut OFF."));

    // ========================================================================
    // TRUE DEEP SLEEP PHASE: PCF8563 HARDWARE INTERRUPT (EXT0 WAKEUP)
    // ========================================================================
    Serial.println(F("[SLEEP] Configuring PCF8563 hardware interrupt timer..."));
    bool rtcAvailable = setupRTCAlarm();

    if (rtcAvailable) {
        // Primary Sleep Mode: Hardware interrupt wakeup on GPIO 27 when PCF8563 INT pulls LOW
        esp_sleep_enable_ext0_wakeup((gpio_num_t)RTC_INT_PIN, 0); // 0 = trigger when GPIO 27 is LOW
        Serial.println(F("[SLEEP] Hardware Wakeup Armed: ESP32 ext0 enabled on GPIO 27 (Active LOW)."));
        Serial.printf("[SLEEP] ESP32 entering Deep Sleep via RTC hardware interrupt (%d sec countdown). Goodnight!\n", SLEEP_DURATION_SEC);
    } else {
        // Fallback: Use internal ESP32 timer ONLY if PCF8563 RTC failed to initialize
        Serial.println(F("[SLEEP] CRITICAL WARNING: PCF8563 RTC failed to respond! Using ESP32 internal timer fallback."));
        esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_DURATION_SEC * 1000000ULL);
        Serial.printf("[SLEEP] ESP32 entering Deep Sleep via internal timer fallback (%d sec countdown). Goodnight!\n", SLEEP_DURATION_SEC);
    }

    Serial.println(F("==================================================\n"));
    Serial.flush();

    // Enter ESP32 Deep Sleep Mode
    esp_deep_sleep_start();
}

void loop() {
    // Empty - execution never reaches loop() due to deep sleep entering in setup()
}
