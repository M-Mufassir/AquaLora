/**
 * @file sensors.h
 * @brief Sensor Subsystem Driver Module (TDS, Turbidity, DS18B20)
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * SENSOR POWER MANAGEMENT & SAMPLING METHODOLOGY:
 * 1. Power Gating: Analog sensors receive 5V power exclusively when GPIO 33 is set HIGH.
 * 2. Noise Mitigation: ESP32 ADC non-linearity and high-frequency noise are mitigated via 
 *    10-sample ADC oversampling and averaging.
 * 3. Temperature Compensation: TDS electrical conductivity calculations dynamically adjust based 
 *    on standard 2.0% per °C temperature coefficient anchored at 25°C.
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
 * @brief Initialize all sensor hardware interfaces and ADC attenuation settings.
 * Must be called after GPIO 33 (MOSFET) is driven HIGH and allowed time to stabilize.
 */
inline void initSensors() {
    // Configure ESP32 ADC global 12-bit resolution and pin attenuation (0-3.3V range)
    analogReadResolution(12);
    analogSetPinAttenuation(TDS_PIN, ADC_11db);
    analogSetPinAttenuation(TURBIDITY_PIN, ADC_11db);

    // Initialize OneWire DS18B20 sensor bus
    ds18b20Sensor.begin();
    ds18b20Sensor.setWaitForConversion(true); // Blocking mode for single-shot reading
    
    Serial.println(F("[SENSORS] Subsystems & ADC attenuation initialized."));
}

/**
 * @brief Read water temperature from DS18B20 digital sensor with retry logic.
 * @return Temperature in Degrees Celsius (°C), or fallback 25.0°C if sensor disconnected.
 */
inline float readTemperature() {
    float tempC = DEVICE_DISCONNECTED_C;
    
    // Attempt up to 3 times for OneWire bus stabilization
    for (int attempt = 1; attempt <= 3; attempt++) {
        ds18b20Sensor.requestTemperatures();
        tempC = ds18b20Sensor.getTempCByIndex(0);
        
        if (tempC != DEVICE_DISCONNECTED_C && tempC >= -55.0f && tempC <= 125.0f) {
            Serial.printf("[SENSORS] Temperature: %.2f °C (Attempt %d)\n", tempC, attempt);
            return tempC;
        }
        delay(100);
    }

    Serial.println(F("[SENSORS] WARNING: DS18B20 read failure! Check 5V power, GPIO 4 & 4.7k pull-up resistor."));
    Serial.println(F("[SENSORS] Falling back to 25.0°C reference temperature."));
    return 25.0f; // Default room temp reference for TDS calculation
}

/**
 * @brief Read TDS (Total Dissolved Solids) in PPM with temperature compensation.
 * 
 * @param temperature Current water temperature (°C) for EC temperature coefficient adjustment.
 * @return Calculated TDS value in Parts Per Million (PPM).
 */
inline int readTDS(float temperature) {
    long analogSum = 0;
    
    // Oversample to reduce ADC quantization noise
    for (int i = 0; i < ADC_SAMPLES; i++) {
        analogSum += analogRead(TDS_PIN);
        delay(10);
    }
    
    float averageAnalog = (float)analogSum / (float)ADC_SAMPLES;
    float rawVoltage = (averageAnalog / ADC_RESOLUTION) * ADC_VREF;

    if (averageAnalog == 0) {
        Serial.println(F("[SENSORS] WARNING: TDS Analog Raw is 0! (Check 5V boost converter output or MOSFET GPIO 33)"));
    }

    // Apply temperature compensation formula (25°C base reference)
    float compensationCoefficient = 1.0f + 0.02f * (temperature - 25.0f);
    float compensatedVoltage = rawVoltage / compensationCoefficient;

    // Calculate TDS value using standard empirical cubic polynomial equation
    float tdsValue = (133.42f * pow(compensatedVoltage, 3) - 
                      255.86f * pow(compensatedVoltage, 2) + 
                      857.39f * compensatedVoltage) * 0.5f;

    if (tdsValue < 0) tdsValue = 0; // Clamp negative values

    int finalTDS = (int)tdsValue;
    Serial.printf("[SENSORS] TDS Analog Raw: %.0f | Voltage: %.2fV | TDS: %d PPM\n", averageAnalog, rawVoltage, finalTDS);
    return finalTDS;
}

/**
 * @brief Read optical turbidity sensor voltage and convert to NTU.
 * 
 * @return Turbidity reading formatted as NTU (Nephelometric Turbidity Units).
 */
inline float readTurbidity() {
    long analogSum = 0;
    
    // Oversample for optical noise suppression
    for (int i = 0; i < ADC_SAMPLES; i++) {
        analogSum += analogRead(TURBIDITY_PIN);
        delay(10);
    }
    
    float averageAnalog = (float)analogSum / (float)ADC_SAMPLES;
    float voltage = (averageAnalog / ADC_RESOLUTION) * ADC_VREF;

    if (averageAnalog == 0) {
        Serial.println(F("[SENSORS] WARNING: Turbidity Analog Raw is 0! (Check 5V boost converter output or MOSFET GPIO 33)"));
    }

    // Optical turbidity sensor mapping (higher voltage = clearer water)
    float ntu = 0.0f;
    if (voltage < 2.5f) {
        ntu = 3000.0f; // Highly turbid or low voltage input
    } else {
        ntu = -1120.4f * pow(voltage, 2) + 5742.3f * voltage - 4353.8f;
    }
    if (ntu < 0) ntu = 0.0f;

    Serial.printf("[SENSORS] Turbidity Analog Raw: %.0f | Voltage: %.2fV | NTU: %.2f\n", averageAnalog, voltage, ntu);
    return ntu;
}

/**
 * @brief Read analog pH sensor probe voltage and calculate pH.
 * 
 * @return Calculated pH value (0.0 - 14.0).
 */
inline float readPH() {
    long analogSum = 0;
    for (int i = 0; i < ADC_SAMPLES; i++) {
        analogSum += analogRead(PH_PIN);
        delay(10);
    }
    float averageAnalog = (float)analogSum / (float)ADC_SAMPLES;
    float voltage = (averageAnalog / ADC_RESOLUTION) * ADC_VREF;

    // Standard analog pH sensor calibration formula: pH = 3.5 * voltage + offset
    float ph = 3.5f * voltage;
    if (ph < 0.0f) ph = 0.0f;
    if (ph > 14.0f) ph = 14.0f;

    Serial.printf("[SENSORS] pH Analog Raw: %.0f | Voltage: %.2fV | pH: %.2f\n", averageAnalog, voltage, ph);
    return ph;
}

/**
 * @brief Unified helper function to sample all 4 sensors in a single pass.
 */
inline void readAllSensors(float &temp, int &tds, float &turbidity, float &ph) {
    temp = readTemperature();
    tds = readTDS(temp);
    turbidity = readTurbidity();
    ph = readPH();
}

#endif // SENSORS_H
