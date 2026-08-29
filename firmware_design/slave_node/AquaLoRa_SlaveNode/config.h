/**
 * @file config.h
 * @brief Master System Configuration & Hardware Pinout Definitions
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * DESIGN NOTES:
 * - ESP32-WROOM-32 pinout optimized for low-power operation and peripheral bus separation.
 * - GPIO 34 and GPIO 35 are ADC1 pins (Input Only), avoiding WiFi/BT and RTC conflicts.
 * - GPIO 27 is an RTC-capable GPIO (RTC_GPIO17) used for ext0 deep-sleep wakeup.
 * - GPIO 33 drives a 2N7000 N-channel MOSFET gate, which pulls the IRF4905 P-channel MOSFET Gate LOW
 *   to turn ON 5V boost converter power to the analog sensor suite. Setting GPIO 33 LOW cuts power completely.
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================================================
// SYSTEM IDENTIFICATION & TIMING CONSTANTS
// ============================================================================
#define NODE_ID                 "Node1"         ///< Unique telemetry node identifier
#define SERIAL_BAUD             115200          ///< UART Serial debug output baud rate
#define STABILIZATION_DELAY_MS  1000            ///< Delay (ms) for 5V boost converter & sensor stabilization
#define SLEEP_DURATION_SEC      30              ///< Target RTC deep sleep cycle interval in seconds

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================

// --- 1. SENSORS PINOUT ---
#define TDS_PIN                 34              ///< Analog Input (ADC1_CH6) - Water TDS / EC Sensor
#define TURBIDITY_PIN           35              ///< Analog Input (ADC1_CH7) - Optical Turbidity Sensor
#define ONE_WIRE_BUS            4               ///< Digital I/O (OneWire) - DS18B20 Temperature Sensor

// --- 2. I2C BUS PINOUT (RTC PCF8563) ---
#define I2C_SDA                 25              ///< Hardware I2C Serial Data
#define I2C_SCL                 26              ///< Hardware I2C Serial Clock
#define RTC_INT_PIN             27              ///< Hardware Interrupt Input (Active LOW ext0 wakeup pin)

// --- 3. SPI BUS PINOUT (LoRa Ra-02 / SX1278) ---
#define LORA_SCK                19              ///< Hardware SPI Serial Clock (D19 per hardware spec)
#define LORA_MISO               18              ///< Hardware SPI Master In Slave Out (D18 per hardware spec)
#define LORA_MOSI               23              ///< Hardware SPI Master Out Slave In (D23)
#define LORA_NSS                5               ///< SPI Chip Select / Slave Select (D5)
#define LORA_RST                16              ///< Hardware Reset Pin (D16)
#define LORA_DIO0               17              ///< Digital I/O 0 (D17)

// --- 4. POWER MANAGEMENT PINOUT ---
#define MOSFET_PIN              33              ///< High-Side MOSFET Control Gate
#define MOSFET_ACTIVE_STATE     HIGH            ///< 3.3V HIGH to 2N7000 pulls IRF4905 Gate LOW -> 5V ON

// ============================================================================
// SENSOR CALIBRATION & ADC CONSTANTS
// ============================================================================
#define ADC_VREF                3.3f            ///< ESP32 Analog Reference Voltage (Volts)
#define ADC_RESOLUTION          4095.0f         ///< 12-Bit ADC Max Digital Value (2^12 - 1)
#define ADC_SAMPLES             10              ///< Oversampling iteration count for noise reduction

// ============================================================================
// LORA RF CONFIGURATION (SX1278 / Ra-02 433MHz)
// ============================================================================
#define LORA_FREQUENCY          433E6           ///< Operating Frequency (433 MHz for Ra-02)
#define LORA_BANDWIDTH          125E3           ///< Signal Bandwidth (125 kHz)
#define LORA_SPREADING_FACTOR   7               ///< Spreading Factor (SF7 - optimal balance of range & airtime)
#define LORA_CODING_RATE        5               ///< Coding Rate (4/5)
#define LORA_SYNC_WORD          0xF3            ///< Network Sync Word to isolate packets
#define LORA_TX_POWER           17              ///< Transmit Power level in dBm (PA_BOOST pin)

#endif // CONFIG_H
