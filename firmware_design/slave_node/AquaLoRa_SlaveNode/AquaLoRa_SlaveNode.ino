/**
 * @file AquaLoRa_SlaveNode.ino
 * @brief Production Firmware for AquaLoRa Slave Node with PCF8563 RTC & Dual Timer Deep Sleep
 * @project AquaLoRa Marine Telemetry System - Solar-Powered Marine Telemetry Node
 * @author Embedded Systems Expert
 * 
 * 7-STEP OPERATIONAL LIFECYCLE:
 * 1. Wake Up: ESP32 boots from deep sleep (ext0 RTC interrupt on GPIO 27 or internal timer backup).
 * 2. Sensor Power-Up: GPIO 33 set HIGH to turn ON 5V sensor rail (2N7000 + IRF4905 MOSFET).
 * 3. Stabilization Delay: Delay 2000ms for 5V boost converter & sensor op-amps to warm up.
 * 4. Data Acquisition: Sample DS18B20 temp (GPIO 4), TDS (GPIO 34), Turbidity (GPIO 35),
 *    pH (GPIO 32), and read real-time ISO timestamp from PCF8563 RTC over I2C.
 * 5. LoRa Transmission: Initialize Ra-02 radio over SPI, pack telemetry payload, transmit RF packet, and sleep radio.
 * 6. Power Down: GPIO 33 set LOW to completely cut power to 5V sensor rail.
 * 7. Deep Sleep: Program PCF8563 countdown timer, configure ext0 + safety timer backup, and enter deep sleep.
 */

#include <Arduino.h>
#include <Wire.h>
#include "config.h"
#include "sensors.h"
#include "rtc_driver.h"
#include "lora_comms.h"

void setup() {
    // ========================================================================
    // STEP 1: BOOT PHASE & WAKEUP CAUSE DIAGNOSTICS
    // ========================================================================
    // Immediate pin setup for MOSFET gate to begin powering sensors as early as possible
    pinMode(MOSFET_PIN, OUTPUT);
    digitalWrite(MOSFET_PIN, HIGH); // GPIO 33 HIGH -> 2N7000 ON -> IRF4905 Gate LOW -> 5V ON

    // Initialize Serial Debug Console
    Serial.begin(SERIAL_BAUD);
    delay(10);
    Serial.println(F("\n=================================================="));
    Serial.println(F("    AquaLoRa Slave Node Production Firmware       "));
    Serial.println(F("=================================================="));

    // Check ESP32 deep sleep wakeup reason
    esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
    if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
        Serial.println(F("[WAKE] Woken up by PCF8563 RTC Hardware Interrupt (GPIO 27 ext0 LOW)."));
    } else if (wakeup_reason == ESP_SLEEP_WAKEUP_TIMER) {
        Serial.println(F("[WAKE] Woken up by ESP32 Internal Safety Timer (Backup)."));
    } else {
        Serial.println(F("[WAKE] Cold Boot / Power-On Reset detected."));
    }

    // Initialize PCF8563 RTC and IMMEDIATELY clear TF/AF flags so INT (GPIO 27) releases HIGH!
    bool rtcAvailable = initRTC();

    // ========================================================================
    // STEP 2 & 3: SENSOR POWER-UP & STABILIZATION DELAY
    // ========================================================================
    Serial.println(F("[POWER] GPIO 33 set HIGH -> 5V High-Side MOSFET Powered ON."));
    Serial.printf("[POWER] Waiting %dms for sensor op-amps, probe RC filters & boost converter to stabilize...\n", STABILIZATION_DELAY_MS);
    delay(STABILIZATION_DELAY_MS);
    Serial.println(F("[POWER] Stabilization complete. Ready for sampling."));

    // ========================================================================
    // STEP 4: DATA ACQUISITION & RTC TIMESTAMP READING
    // ========================================================================
    // Initialize sensor ADC resolution/attenuation & OneWire bus
    initSensors();

    // Read Real-Time Clock date and time over I2C (SDA=25, SCL=26)
    String timestampStr = "2026-01-01T00:00:00Z";
    if (rtcAvailable) {
        readRTCDateTime(timestampStr);
    }

    // Acquire all 4 water quality sensor readings
    float tempC = 0.0f;
    int tdsPPM = 0;
    float turbidityNTU = 0.0f;
    float phVal = 7.0f;

    readAllSensors(tempC, tdsPPM, turbidityNTU, phVal);

    // ========================================================================
    // STEP 5: PACK PAYLOAD & LORA TRANSMISSION
    // ========================================================================
    // Format payload string: "Node1,YYYY-MM-DDTHH:MM:SSZ,Temp,TDS,Turbidity,pH"
    char payloadBuffer[128];
    snprintf(payloadBuffer, sizeof(payloadBuffer), "%s,%s,%.2f,%d,%.2f,%.2f",
             NODE_ID, timestampStr.c_str(), tempC, tdsPPM, turbidityNTU, phVal);

    String telemetryPayload = String(payloadBuffer);
    Serial.printf("[TELEMETRY] Formatted Payload: '%s'\n", telemetryPayload.c_str());

    // Initialize Ra-02 LoRa radio over SPI (SCK=19, MISO=18, MOSI=23, NSS=5, RST=16, DIO0=17)
    bool loraSuccess = initLoRa();
    if (loraSuccess) {
        sendLoRaData(telemetryPayload);
    } else {
        Serial.println(F("[LORA] ERROR: Skipping transmission due to Ra-02 initialization failure."));
    }

    // ========================================================================
    // STEP 6: POWER DOWN PHASE - CUT 5V SENSOR RAIL POWER
    // ========================================================================
    digitalWrite(MOSFET_PIN, LOW); // GPIO 33 LOW -> Turn OFF 2N7000 / IRF4905 -> Cut 5V power
    Serial.println(F("[POWER] GPIO 33 set LOW -> 5V Sensor Rail Completely Cut OFF."));

    // ========================================================================
    // STEP 7: DUAL DEEP SLEEP WAKEUP CONFIGURATION (PCF8563 INT + TIMER BACKUP)
    // ========================================================================
    Serial.println(F("[SLEEP] Programming PCF8563 countdown timer for next cycle..."));
    bool rtcAlarmSet = false;

    if (rtcAvailable) {
        rtcAlarmSet = setupRTCAlarm(SLEEP_DURATION_SEC);
    }

    if (rtcAlarmSet) {
        // Trigger 1: PCF8563 RTC Hardware Interrupt (GPIO 27 Active LOW)
        esp_sleep_enable_ext0_wakeup((gpio_num_t)RTC_INT_PIN, 0); // 0 = trigger when GPIO 27 is LOW
        Serial.printf("[SLEEP] Primary Wakeup Armed: PCF8563 ext0 enabled on GPIO %d (Active LOW).\n", RTC_INT_PIN);
    }

    // Trigger 2: ESP32 Internal Timer Safety Backup (32 seconds)
    // Guarantees ESP32 NEVER gets stuck in deep sleep forever if RTC wire is loose!
    uint32_t safetyTimerSec = SLEEP_DURATION_SEC + 2;
    esp_sleep_enable_timer_wakeup((uint64_t)safetyTimerSec * 1000000ULL);
    Serial.printf("[SLEEP] Safety Backup Wakeup Armed: ESP32 Internal Timer (%d sec).\n", safetyTimerSec);

    Serial.printf("[SLEEP] ESP32 entering Deep Sleep mode (%d sec cycle). Goodnight!\n", SLEEP_DURATION_SEC);
    Serial.println(F("==================================================\n"));
    Serial.flush();

    // Enter ESP32 Deep Sleep Mode
    esp_deep_sleep_start();
}

void loop() {
    // Empty - execution never reaches loop() due to deep sleep entry in setup()
}
