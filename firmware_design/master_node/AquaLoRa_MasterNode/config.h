/**
 * @file config.h
 * @brief Master System Configuration & Hardware Pinout Definitions
 * @project AquaLoRa Marine Telemetry System - Master Receiver Node
 *
 * HARDWARE WIRING VERIFIED:
 * - RA-02 LoRa SPI: SCK=18, MISO=19, MOSI=23, NSS=5, RST=27, DIO0=13
 * - OLED I2C: SDA=21, SCL=22 (Address 0x3C)
 * - DISPLAY TYPE: 1.3" OLEDs physically use the SH1106 driver IC (IS_SH1106_DISPLAY = true)
 * - WIFI AP: SSID="AquaLoRa-MasterNode", Password="aqualora123"
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================================================
// SYSTEM CONFIGURATION
// ============================================================================
#define SERIAL_BAUD 115200 ///< UART Serial debug output baud rate

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================

// --- 1. SPI BUS PINOUT (LoRa Ra-02 / SX1278) ---
#define LORA_SCK 18  ///< Hardware SPI Serial Clock (GPIO 18)
#define LORA_MISO 19 ///< Hardware SPI Master In Slave Out (GPIO 19)
#define LORA_MOSI 23 ///< Hardware SPI Master Out Slave In (GPIO 23)
#define LORA_NSS 5   ///< SPI Chip Select / Slave Select (GPIO 5)
#define LORA_RST 27  ///< Hardware Reset Pin (GPIO 27)
#define LORA_DIO0 13 ///< Digital I/O 0 Pin (GPIO 13)

// --- 2. I2C BUS PINOUT (1.3" / 0.96" OLED DISPLAY) ---
#define OLED_SDA 21           ///< Hardware I2C Serial Data (GPIO 21 for D21)
#define OLED_SCL 22           ///< Hardware I2C Serial Clock (GPIO 22)
#define OLED_RESET -1         ///< Display Reset Pin (-1 if shared with ESP32)
#define SCREEN_WIDTH 128      ///< OLED display width in pixels
#define SCREEN_HEIGHT 64      ///< OLED display height in pixels
#define OLED_I2C_ADDRESS 0x3C ///< Standard I2C address for OLED (0x3C)

// --- 3. DISPLAY DRIVER CHIP SELECTION ---
// TRONIC.LK DM0056 1.3" OLED displays physically use the SH1106 controller chip (true).
// 0.96-inch OLED displays physically use the SSD1306 controller chip (false).
#define IS_SH1106_DISPLAY true ///< Set to true for 1.3" SH1106 (fixes dalmatian noise screen)

// ============================================================================
// LORA RF CONFIGURATION (SX1278 / Ra-02 433MHz) - MUST MATCH SLAVE NODE!
// ============================================================================
#define LORA_FREQUENCY 433E6    ///< Operating Frequency (433 MHz)
#define LORA_BANDWIDTH 125E3    ///< Signal Bandwidth (125 kHz)
#define LORA_SPREADING_FACTOR 7 ///< Spreading Factor (SF7)
#define LORA_CODING_RATE 5      ///< Coding Rate (4/5)
#define LORA_SYNC_WORD 0xF3     ///< Network Sync Word to isolate packets

// ============================================================================
// WIFI HOTSPOT & WEBSOCKET GATEWAY CONFIGURATION
// ============================================================================
#define WIFI_SSID "Aqualora "              ///< Mobile hotspot / Router SSID (Note: phone hotspot has trailing space)
#define WIFI_SSID_ALT "Aqualora"           ///< Fallback without space
#define WIFI_PASSWORD "Aqualora"           ///< Mobile hotspot / Router Password
#define MASTER_PASSWORD "aqualora123"      ///< Gateway pairing password & AES-256 Key Seed
#define WEBSOCKET_PORT 8081                ///< WebSocket Server Port (ws://<ip>:8081)
#define UDP_DISCOVERY_PORT 8082            ///< Desktop discovery beacon port
#define MDNS_HOSTNAME "aqualora"           ///< mDNS hostname (resolvable at aqualora.local)
#define MASTER_NODE_ID "master-node"       ///< Gateway identity
#define MASTER_NODE_CODE "AQL-001"         ///< Gateway code
#define DISCOVERY_INTERVAL_MS 1000         ///< UDP presence beacon interval (1.0s for instant desktop detection)

#endif // CONFIG_H
