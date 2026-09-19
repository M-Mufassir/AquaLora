/**
 * @file config.h
 * @brief Centralized Hardware Pinout, Sensor Calibration & System Configuration
 * @project AquaLoRa Marine Telemetry System - Slave Node Firmware
 * 
 * HARDWARE PINOUT & PROTECTION SUMMARY:
 * - ESP32 Board: Standard Production ESP32
 * - Power Switch Control (5V Sensor Rail): GPIO 33 (Controls 2N7000 + IRF4905 high-side MOSFET)
 *     * GPIO 33 HIGH -> 2N7000 ON -> IRF4905 Gate LOW -> 5V Sensor Rail Powered ON
 *     * GPIO 33 LOW  -> 2N7000 OFF -> IRF4905 Gate HIGH -> 5V Sensor Rail Powered OFF
 * - pH Sensor (Analog): GPIO 32 (ADC1_CH4, routed through 10k/22k voltage divider)
 * - Turbidity Sensor (Analog): GPIO 35 (ADC1_CH7, routed through 10k/22k voltage divider)
 * - TDS Sensor (Analog): GPIO 34 (ADC1_CH6, native 0-2.3V output range)
 * - DS18B20 Temp Sensor (1-Wire): GPIO 4 (3.3V power rail with 4.7k pull-up resistor)
 * - RTC Module (PCF8563 I2C): SDA = GPIO 25, SCL = GPIO 26, INT = GPIO 27 (Active LOW ext0 wakeup)
 * - LoRa Transceiver (Ra-02 / SX1278 SPI):
 *     * NSS/CS = GPIO 5, RST = GPIO 16, DIO0 = GPIO 17
 *     * SCK = GPIO 19, MISO = GPIO 18, MOSI = GPIO 23
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================================================
// SYSTEM IDENTIFICATION & TIMING CONSTANTS
// ============================================================================
#define NODE_ID                 "Node1"         ///< Unique telemetry node identifier
#define SERIAL_BAUD             115200          ///< UART Serial debug output baud rate
#define STABILIZATION_DELAY_MS  2000            ///< Warm-up delay (ms) for op-amps, probes & 5V rail stabilization
#define SLEEP_DURATION_SEC      30              ///< Target RTC deep sleep cycle interval in seconds

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================

// --- 1. POWER MANAGEMENT CONTROL ---
#define MOSFET_PIN              33              ///< GPIO 33: High-Side MOSFET Switch Gate Control (HIGH = 5V ON, LOW = 5V OFF)

// --- 2. ANALOG & DIGITAL SENSORS PINOUT ---
#define PH_PIN                  32              ///< GPIO 32: Analog Input (ADC1_CH4) - pH Sensor Probe (via 10k/22k divider)
#define TURBIDITY_PIN           35              ///< GPIO 35: Analog Input (ADC1_CH7) - Optical Turbidity Sensor (via 10k/22k divider)
#define TDS_PIN                 34              ///< GPIO 34: Analog Input (ADC1_CH6) - Water TDS/EC Sensor (Native 0-2.3V range)
#define ONE_WIRE_BUS            4               ///< GPIO 4:  Digital I/O (OneWire) - DS18B20 Temperature Sensor

// --- 3. I2C BUS PINOUT (PCF8563 RTC) ---
#define I2C_SDA                 25              ///< GPIO 25: Hardware I2C Serial Data
#define I2C_SCL                 26              ///< GPIO 26: Hardware I2C Serial Clock
#define RTC_INT_PIN             27              ///< GPIO 27: Hardware Interrupt Input from PCF8563 INT (Active LOW ext0 wakeup)

// --- 4. SPI BUS PINOUT (Ra-02 / SX1278 LoRa Module) ---
#define LORA_SCK                19              ///< GPIO 19: Hardware SPI Serial Clock
#define LORA_MISO               18              ///< GPIO 18: Hardware SPI Master In Slave Out
#define LORA_MOSI               23              ///< GPIO 23: Hardware SPI Master Out Slave In
#define LORA_NSS                5               ///< GPIO 5:  SPI Chip Select / Slave Select
#define LORA_RST                16              ///< GPIO 16: Hardware Reset Pin
#define LORA_DIO0               17              ///< GPIO 17: Digital I/O 0 Interrupt Pin

// ============================================================================
// ADC & VOLTAGE DIVIDER CALIBRATION CONSTANTS
// ============================================================================
#define ADC_VREF                3.3f            ///< ESP32 Analog Reference Voltage (Volts)
#define ADC_RESOLUTION          4095.0f         ///< 12-Bit ADC Max Digital Value (2^12 - 1)
#define ADC_SAMPLES             15              ///< Oversampling iteration count for noise reduction

/**
 * VOLTAGE DIVIDER SCALE FACTOR (pH & Turbidity Sensors):
 * Sensors operating at 5V output an analog signal up to 5.0V.
 * To protect ESP32 ADC inputs (3.3V max), a voltage divider with R1 = 10k (top) and R2 = 22k (bottom to GND) is used.
 * V_pin = V_sensor * (R2 / (R1 + R2)) = V_sensor * (22k / 32k) = V_sensor * 0.6875
 * To reconstruct V_sensor from measured V_pin:
 * V_sensor = V_pin * ((R1 + R2) / R2) = V_pin * (32k / 22k) = V_pin * 1.454545f
 */
#define R1_DIVIDER_OHMS         10000.0f        ///< Top Resistor in Voltage Divider (10k Ohms)
#define R2_DIVIDER_OHMS         22000.0f        ///< Bottom Resistor in Voltage Divider (22k Ohms)
#define VOLTAGE_DIVIDER_SCALE   ((R1_DIVIDER_OHMS + R2_DIVIDER_OHMS) / R2_DIVIDER_OHMS) ///< Scale factor (~1.454545f)

// pH Probe Calibration Parameters
#define PH_NEUTRAL_VOLTAGE      2.5f            ///< Reconstructed sensor voltage at pH 7.0 (5V scale)
#define PH_SLOPE                -3.5f           ///< Voltage to pH conversion slope factor

// ============================================================================
// PCF8563 RTC REGISTER DEFINITIONS
// ============================================================================
#define PCF8563_I2C_ADDR        0x51            ///< 7-bit I2C Address of PCF8563 RTC
#define PCF8563_REG_STAT1       0x00            ///< Control/Status 1 Register
#define PCF8563_REG_STAT2       0x01            ///< Control/Status 2 Register (AF, TF, AIE, TIE)
#define PCF8563_REG_VL_SECONDS  0x02            ///< Seconds & Voltage Low (VL) Flag
#define PCF8563_REG_MINUTES     0x03            ///< Minutes
#define PCF8563_REG_HOURS       0x04            ///< Hours
#define PCF8563_REG_DAYS        0x05            ///< Days
#define PCF8563_REG_WEEKDAYS    0x06            ///< Weekdays
#define PCF8563_REG_MONTHS      0x07            ///< Months & Century
#define PCF8563_REG_YEARS       0x08            ///< Years
#define PCF8563_REG_TIMER_CTRL  0x0E            ///< Timer Control Register
#define PCF8563_REG_TIMER_VAL   0x0F            ///< Timer Value Register

// ============================================================================
// LORA RF CONFIGURATION (Ra-02 / SX1278 433MHz)
// ============================================================================
#define LORA_FREQUENCY          433E6           ///< Operating Frequency (433 MHz for Ra-02)
#define LORA_BANDWIDTH          125E3           ///< Signal Bandwidth (125 kHz)
#define LORA_SPREADING_FACTOR   7               ///< Spreading Factor (SF7 - balance of range & low airtime)
#define LORA_CODING_RATE        5               ///< Coding Rate (4/5)
#define LORA_SYNC_WORD          0xF3            ///< Network Sync Word to isolate telemetry packets
#define LORA_TX_POWER           17              ///< Transmit Power level in dBm (PA_BOOST pin)

#endif // CONFIG_H
