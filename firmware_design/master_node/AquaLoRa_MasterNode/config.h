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
#define OLED_SDA 21           ///< Hardware I2C Serial Data (GPIO 21)
#define OLED_SCL 22           ///< Hardware I2C Serial Clock (GPIO 22)
#define OLED_RESET -1         ///< Display Reset Pin (-1 if shared with ESP32)
#define SCREEN_WIDTH 128      ///< OLED display width in pixels
#define SCREEN_HEIGHT 64      ///< OLED display height in pixels
#define OLED_I2C_ADDRESS 0x3C ///< Standard I2C address for OLED (0x3C)

// --- 3. DISPLAY DRIVER CHIP SELECTION ---
// 1.3-inch OLED displays (DM0056) physically use the SH1106 controller chip.
// Setting this to true enables SH1106 132x64 page addressing mode with 2-pixel offset.
#define IS_SH1106_DISPLAY true ///< true for 1.3" SH1106 OLEDs, false for 0.96" SSD1306

// ============================================================================
// LORA RF CONFIGURATION (SX1278 / Ra-02 433MHz) - MUST MATCH SLAVE NODE!
// ============================================================================
#define LORA_FREQUENCY 433E6    ///< Operating Frequency (433 MHz)
#define LORA_BANDWIDTH 125E3    ///< Signal Bandwidth (125 kHz)
#define LORA_SPREADING_FACTOR 7 ///< Spreading Factor (SF7)
#define LORA_CODING_RATE 5      ///< Coding Rate (4/5)
#define LORA_SYNC_WORD 0xF3     ///< Network Sync Word to isolate packets

// ============================================================================
// WIFI MODE & WEBSOCKET DASHBOARD CONFIGURATION
// ============================================================================
// Set WIFI_USE_EXTERNAL_NETWORK to 1 when the Master Node should join a
// local WiFi router instead of starting its own AP. In that mode the
// dashboard connects directly to the ESP32's assigned IP on the LAN, e.g.
// ws://192.168.1.50:8081. When set to 0, the ESP32 starts its own AP and
// behaves like the original pairing flow.
#define WIFI_USE_EXTERNAL_NETWORK 0
#define EXTERNAL_WIFI_SSID "YourRouterSSID"
#define EXTERNAL_WIFI_PASSWORD "YourRouterPassword"

#define WIFI_AP_SSID "AquaLoRa-MasterNode" ///< Wi-Fi AP SSID for Dashboard Pairing
#define WIFI_AP_PASSWORD "aqualora123"     ///< Wi-Fi Password & AES-256 Key Seed
#define WEBSOCKET_PORT 8081                ///< WebSocket Server Port (ws://192.168.4.1:8081)

#endif // CONFIG_H
