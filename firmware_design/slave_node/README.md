# Slave Node Firmware — AquaLoRa Marine Telemetry System

Industrial-grade, ultra-low-power telemetry firmware for the pond-side Slave Node unit (**SLIIT IE3044 Design Project**).

---

## Hardware Features & Power Management

- **Solar & Battery Power**: 5V Solar panel + 1N5822 Schottky diode + TP4056 charger + 3×18650 Li-ion batteries.
- **High-Side Load Switch**: 2N7000 (N-Channel) + IRF4905 (P-Channel) driven by ESP32 `GPIO 33`. Cuts 5V power to sensors during deep sleep to prevent battery drain and probe electrolysis.
- **PCF8563 RTC Hardware Interrupt**: Programmable timer triggers active LOW interrupt on ESP32 `GPIO 27` (`ext0` wakeup). Ultra-low sleep current (< 10 µA).
- **Sensors**:
  - `DS18B20` Digital Temperature Sensor (`GPIO 4`, OneWire bus with 4.7kΩ pull-up).
  - `TDS Sensor` (`GPIO 34`, ADC1 input, temperature compensated).
  - `Optical Turbidity Sensor` (`GPIO 35`, ADC1 input via 10kΩ/22kΩ voltage divider).
- **LoRa RF Transmitter**: Ra-02 (SX1278 433MHz) SPI transceiver sending comma-separated telemetry payload (`"Node1,25.40,320,1.50"`).

---

## Hardware Pinout Table

| Component | Function | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **MOSFET Gate** | Power Control | `GPIO 33` | HIGH = 5V Sensor Rail ON, LOW = 5V OFF |
| **TDS Sensor** | Analog Input | `GPIO 34` | ADC1 Channel 6 |
| **Turbidity Sensor**| Analog Input | `GPIO 35` | ADC1 Channel 7 (via 10kΩ/22kΩ divider) |
| **DS18B20 Temp** | Digital Data | `GPIO 4` | OneWire Bus |
| **PCF8563 RTC** | I2C SDA | `GPIO 25` | Hardware I2C Serial Data |
| **PCF8563 RTC** | I2C SCL | `GPIO 26` | Hardware I2C Serial Clock |
| **PCF8563 RTC** | INT Line | `GPIO 27` | Hardware Wakeup Interrupt Line (`ext0`) |
| **Ra-02 LoRa** | SPI SCK | `GPIO 19` | Hardware SPI Clock |
| **Ra-02 LoRa** | SPI MISO | `GPIO 18` | Hardware SPI Master In Slave Out |
| **Ra-02 LoRa** | SPI MOSI | `GPIO 23` | Hardware SPI Master Out Slave In |
| **Ra-02 LoRa** | SPI NSS | `GPIO 5` | SPI Chip Select Line |
| **Ra-02 LoRa** | Reset | `GPIO 16` | LoRa Reset Line |
| **Ra-02 LoRa** | DIO0 | `GPIO 17` | LoRa Interrupt Line |

---

## Program Execution Sequence

1. **Boot**: Driving `GPIO 33` HIGH activates 2N7000/IRF4905 MOSFET switch, powering ON the 5V rail for sensors.
2. **Stabilization**: 1000ms delay for boost converter and analog sensors to stabilize.
3. **Sampling**:
   - Reads DS18B20 temperature over OneWire.
   - Performs 10-sample ADC oversampling for TDS and Turbidity with temperature compensation.
4. **LoRa Transmission**: Formats string payload `"Node1,Temp,TDS,Turb"` and transmits over 433 MHz RF link.
5. **Power Cut**: Drives `GPIO 33` LOW, turning OFF 5V sensor rail.
6. **Deep Sleep**: Programs PCF8563 RTC 30-second timer, enables `ext0` hardware interrupt on `GPIO 27`, and enters ESP32 deep sleep.

---

## Setup & Compilation

1. Open `AquaLoRa_SlaveNode/AquaLoRa_SlaveNode.ino` in Arduino IDE.
2. Install required libraries: `LoRa`, `OneWire`, `DallasTemperature`.
3. Select board: **ESP32 Dev Module**.
4. Upload to Slave ESP32 board and open Serial Monitor at **115200 baud**.
