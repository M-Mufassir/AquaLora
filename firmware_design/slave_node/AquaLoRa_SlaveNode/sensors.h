/**
 * @file sensors.h
 * @brief Sensor Subsystem Driver Module (pH, Turbidity, TDS, DS18B20)
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * VOLTAGE DIVIDER & ADC PROTECTION METHODOLOGY:
 * 1. Power Gating: 5V rail sensors receive power only when GPIO 33 is driven HIGH.
 * 2. Warm-Up Settling: Op-amps and RC filters are allowed warm-up delay before sampling.
 * 3. 10k/22k Voltage Divider Scaling (pH on GPIO 32, Turbidity on GPIO 35):
 *    - V_pin = V_sensor * (22k / 32k) = V_sensor * 0.6875.
 *    - Reconstructed V_sensor = V_pin * (32k / 22k) = V_pin * VOLTAGE_DIVIDER_SCALE.
 * 4. Native ADC Input (TDS on GPIO 34): Native 0-2.3V output range (no voltage divider needed).
 * 5. 1-Wire Digital Input (DS18B20 on GPIO 4): 3.3V power rail with internal + external pull-up resistor.
 */

#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "config.h"

// Static instances for OneWire & DS18B20 digital temperature sensor
static OneWire oneWireBus(ONE_WIRE_BUS);
static DallasTemperature ds18b20Sensor(&oneWireBus);

/**
 * @brief Initialize sensor hardware interfaces, ADC resolution, and attenuation.
 * Must be called after GPIO 33 (MOSFET) is driven HIGH and allowed warm-up stabilization time.
 */
inline void initSensors() {
    // Configure ESP32 ADC global 12-bit resolution (0 - 4095)
    analogReadResolution(12);

    // Set ADC attenuation to 11dB (full scale 0 - 3.3V input range)
    analogSetPinAttenuation(PH_PIN, ADC_11db);
    analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);
    analogSetPinAttenuation(TDS_PIN, ADC_11db);

    // Enable internal pull-up on GPIO 4 as fallback for DS18B20 1-Wire bus
    pinMode(ONE_WIRE_BUS, INPUT_PULLUP);

    // Initialize OneWire DS18B20 bus
    ds18b20Sensor.begin();
    ds18b20Sensor.setWaitForConversion(true); // Blocking mode for single-shot reading

    Serial.println(F("[SENSORS] Subsystems, ADC attenuation & OneWire initialized."));
}

/**
 * @brief Read water temperature from DS18B20 digital sensor on GPIO 4 with retry logic.
 * @return Temperature in Degrees Celsius (°C), or fallback 25.0°C reference if sensor fails.
 */
inline float readTemperature() {
    float tempC = DEVICE_DISCONNECTED_C;

    // Enable internal pull-up resistor on GPIO 4
    pinMode(ONE_WIRE_BUS, INPUT_PULLUP);

    // Re-initialize OneWire bus instance in case power transition occurred
    ds18b20Sensor.begin();
    delay(50);

    // Attempt up to 3 times for OneWire bus stabilization
    for (int attempt = 1; attempt <= 3; attempt++) {
        ds18b20Sensor.requestTemperatures();
        tempC = ds18b20Sensor.getTempCByIndex(0);

        if (tempC != DEVICE_DISCONNECTED_C && tempC >= -55.0f && tempC <= 125.0f) {
            Serial.printf("[SENSORS] Temperature (GPIO 4): %.2f °C (Attempt %d)\n", tempC, attempt);
            return tempC;
        }
        delay(100);
    }

    Serial.println(F("[SENSORS] WARNING: DS18B20 read failure! Check GPIO 4 & 4.7k pull-up resistor."));
    Serial.println(F("[SENSORS] Falling back to 25.0°C reference temperature for TDS calculation."));
    return 25.0f; // Default room temp reference
}

/**
 * @brief Read TDS (Total Dissolved Solids) in PPM with temperature compensation.
 * Native 0-2.3V output on GPIO 34 (no voltage divider needed).
 * Note: When probe is in dry air, TDS reading is 0 PPM (0.00V).
 * 
 * @param temperature Current water temperature (°C) for EC temperature coefficient adjustment.
 * @return Calculated TDS value in Parts Per Million (PPM).
 */
inline int readTDS(float temperature) {
    // Discard initial dummy reading to clear sample pipeline
    analogRead(TDS_PIN);
    delay(20);

    long analogSum = 0;

    // Oversample to reduce ESP32 ADC quantization noise
    for (int i = 0; i < ADC_SAMPLES; i++) {
        analogSum += analogRead(TDS_PIN);
        delay(10);
    }

    float averageAnalog = (float)analogSum / (float)ADC_SAMPLES;

    // If initial reading is 0, give op-amp additional 50ms and retry once
    if (averageAnalog == 0) {
        delay(50);
        analogSum = 0;
        for (int i = 0; i < ADC_SAMPLES; i++) {
            analogSum += analogRead(TDS_PIN);
            delay(10);
        }
        averageAnalog = (float)analogSum / (float)ADC_SAMPLES;
    }

    float rawVoltage = (averageAnalog / ADC_RESOLUTION) * ADC_VREF;

    if (averageAnalog == 0) {
        Serial.println(F("[SENSORS] WARNING: TDS Analog Raw is 0! (Normal if probe is in dry air)"));
    }

    // Apply standard 2.0% per °C temperature compensation formula (25°C base reference)
    float compensationCoefficient = 1.0f + 0.02f * (temperature - 25.0f);
    float compensatedVoltage = rawVoltage / compensationCoefficient;

    // Calculate TDS value using standard empirical cubic polynomial equation
    float tdsValue = (133.42f * pow(compensatedVoltage, 3) - 
                      255.86f * pow(compensatedVoltage, 2) + 
                      857.39f * compensatedVoltage) * 0.5f;

    if (tdsValue < 0.0f) tdsValue = 0.0f; // Clamp negative values

    int finalTDS = (int)tdsValue;
    Serial.printf("[SENSORS] TDS (GPIO 34) -> Raw: %.0f | Pin V: %.2fV | TDS: %d PPM\n", averageAnalog, rawVoltage, finalTDS);
    return finalTDS;
}

/**
 * @brief Read optical turbidity sensor voltage on GPIO 35 and convert to NTU.
 * Accounts for 10k/22k voltage divider scaling to reconstruct 5V module output voltage.
 * 
 * @return Turbidity reading formatted as NTU (Nephelometric Turbidity Units).
 */
inline float readTurbidity() {
    // Discard initial dummy reading
    analogRead(TURBIDITY_PIN);
    delay(20);

    long analogSum = 0;

    // Oversample for optical noise suppression
    for (int i = 0; i < ADC_SAMPLES; i++) {
        analogSum += analogRead(TURBIDITY_PIN);
        delay(10);
    }

    float averageAnalog = (float)analogSum / (float)ADC_SAMPLES;
    float pinVoltage = (averageAnalog / ADC_RESOLUTION) * ADC_VREF;

    // Reconstruct 5V sensor module output voltage using 10k/22k voltage divider ratio
    float sensorVoltage = pinVoltage * VOLTAGE_DIVIDER_SCALE;

    if (averageAnalog == 0) {
        Serial.println(F("[SENSORS] WARNING: Turbidity Analog Raw is 0! (Check GPIO 35 or 5V rail MOSFET GPIO 33)"));
    }

    // Optical turbidity sensor polynomial mapping
    float ntu = 0.0f;
    if (sensorVoltage < 2.5f) {
        ntu = 3000.0f; // High turbidity / opaque sample
    } else {
        ntu = -1120.4f * pow(sensorVoltage, 2) + 5742.3f * sensorVoltage - 4353.8f;
    }

    if (ntu < 0.0f) ntu = 0.0f;
    if (ntu > 3000.0f) ntu = 3000.0f;

    Serial.printf("[SENSORS] Turbidity (GPIO 35) -> Raw: %.0f | Pin V: %.2fV | Sensor Module V: %.2fV | NTU: %.2f\n", 
                  averageAnalog, pinVoltage, sensorVoltage, ntu);
    return ntu;
}

/**
 * @brief Read analog pH sensor probe voltage on GPIO 32 and calculate pH value.
 * Accounts for 10k/22k voltage divider scaling to reconstruct 5V module output voltage.
 * 
 * @return Calculated pH value (0.0 - 14.0).
 */
inline float readPH() {
    // Discard initial dummy reading
    analogRead(PH_PIN);
    delay(20);

    long analogSum = 0;

    // Oversample to filter probe electrical noise
    for (int i = 0; i < ADC_SAMPLES; i++) {
        analogSum += analogRead(PH_PIN);
        delay(10);
    }

    float averageAnalog = (float)analogSum / (float)ADC_SAMPLES;
    float pinVoltage = (averageAnalog / ADC_RESOLUTION) * ADC_VREF;

    // Reconstruct 5V sensor module output voltage using 10k/22k voltage divider ratio
    float sensorVoltage = pinVoltage * VOLTAGE_DIVIDER_SCALE;

    if (averageAnalog == 0) {
        Serial.println(F("[SENSORS] WARNING: pH Analog Raw is 0! (Check GPIO 32 or probe connection)"));
    }

    // Standard analog pH module calibration formula: pH = 3.5 * sensorVoltage
    float ph = 3.5f * sensorVoltage;
    if (ph < 0.0f) ph = 0.0f;
    if (ph > 14.0f) ph = 14.0f;

    Serial.printf("[SENSORS] pH (GPIO 32) -> Raw: %.0f | Pin V: %.2fV | Sensor Module V: %.2fV | pH: %.2f\n", 
                  averageAnalog, pinVoltage, sensorVoltage, ph);
    return ph;
}

/**
 * @brief Unified helper function to sample all 4 water quality sensors in a single pass.
 */
inline void readAllSensors(float &temp, int &tds, float &turbidity, float &ph) {
    temp = readTemperature();
    tds = readTDS(temp);
    turbidity = readTurbidity();
    ph = readPH();
}

#endif // SENSORS_H
