# WS90 Weather Station Setup Guide

This guide explains how to set up the **WS90 Weather (MQTT)** Homey app after installing it from the Homey App Store.

## Prerequisites

Before you begin, you need:

1. **MQTT Broker** - An MQTT server running on your network
2. **Shelly Device with Bluetooth** - A Shelly device with BLE support (e.g., Shelly Plus Plug S) located within range of your WS90 weather station
3. **WS90 Weather Station** - The Ecowitt WS90 weather station

## Step 1: Install MQTT Broker

### Option A: Use Homey's MQTT Server App

1. Install the **MQTT Server** app from the Homey App Store
2. Open the MQTT Server app settings
3. Create a new user with a username and password
4. Note down the credentials - you'll need them later

### Option B: Use External MQTT Broker

If you already have an MQTT broker (like Mosquitto) running on your network, note down:
- Broker IP address
- Port (usually `1883`)
- Username and password (if authentication is enabled)

## Step 2: Configure Shelly BLE Script

1. **Find your WS90's MAC address**:
   - Open the Shelly app on your phone
   - Go to the Shelly device that will run the script
   - Navigate to **Bluetooth** scanner
   - Find your WS90 device and note its MAC address (e.g., `AA:BB:CC:DD:EE:FF`)

2. **Create the script**:
   - In the Shelly app, go to your Shelly device
   - Navigate to **Scripts** → **Add Script**
   - Paste the following script:

```javascript
/**
 * Shelly Plus BLE → MQTT bridge for WS90 Weather Station
 */

// ================== CONFIG ==================

let CONFIG = {
    // WS90 MAC address (FROM SHELLY APP)
    ws90_address: "AA:BB:CC:DD:EE:FF",  // ← CHANGE THIS

    // Base MQTT topic
    mqtt_base: "shelly/weather/ws90",

    // Health / watchdog
    health_interval_ms: 300000,   // 5 min
    watchdog_timeout_ms: 600000   // 10 min
};

// Normalize MAC
CONFIG.ws90_address = CONFIG.ws90_address.toUpperCase();

// ================== CONSTANTS ==================

let BTHOME_SVC_ID_STR = "fcd2";
let SCAN_DURATION = BLE.Scanner.INFINITE_SCAN;

let uint8  = 0;
let int8   = 1;
let uint16 = 2;
let int16  = 3;
let uint24 = 4;
let int24  = 5;

// ================== HELPERS ==================

function getByteSize(type) {
    if (type === uint8 || type === int8) return 1;
    if (type === uint16 || type === int16) return 2;
    if (type === uint24 || type === int24) return 3;
    return 255;
}

function mqtt_publish(topic, payload) {
    if (!MQTT.isConnected()) return;
    try {
        MQTT.publish(topic, JSON.stringify(payload), 0, false);
    } catch (e) {
        console.log("MQTT publish error:", e);
    }
}

// ================== BTHOME MAP ==================

let BTH = {
  0x00: { n: "pid", t: uint8 },

  // Packet type 1
  0x05: { n: "illuminance", t: uint24, f: 0.01 },
  0x20: { n: "rain_status", t: uint8 },
  0x44: { n: "wind_speed", t: uint16, f: 0.01 },
  0x46: { n: "uv", t: uint8, f: 0.1 },
  0x5E: { n: "wind_direction", t: uint16, f: 0.01 },

  // Packet type 2
  0x01: { n: "battery", t: uint8 },
  0x04: { n: "pressure", t: uint24, f: 0.01 },
  0x08: { n: "dew_point", t: int16, f: 0.01 },
  0x0C: { n: "capacitor_voltage", t: uint16, f: 0.001 },
  0x2E: { n: "humidity", t: uint8 },
  0x45: { n: "temperature", t: int16, f: 0.1 },
  0x5F: { n: "precipitation", t: uint16, f: 0.1 }
};

// ================== DECODER ==================

let BTHomeDecoder = {

    utoi: function (num, bits) {
        let mask = 1 << (bits - 1);
        return num & mask ? num - (1 << bits) : num;
    },

    getValue: function (type, buf) {
        if (buf.length < getByteSize(type)) return null;
        if (type === uint8)  return buf.at(0);
        if (type === int8)   return this.utoi(buf.at(0), 8);
        if (type === uint16) return (buf.at(1) << 8) | buf.at(0);
        if (type === int16)  return this.utoi((buf.at(1) << 8) | buf.at(0), 16);
        if (type === uint24) return (buf.at(2) << 16) | (buf.at(1) << 8) | buf.at(0);
        if (type === int24)  return this.utoi(
            (buf.at(2) << 16) | (buf.at(1) << 8) | buf.at(0), 24
        );
        return null;
    },

    unpack: function (data) {
        let res = {};
        let dib = data.at(0);

        if ((dib >> 5) !== 2) return null;
        if (dib & 0x01) return null;

        data = data.slice(1);

        while (data.length > 1) {
            let id = data.at(0);
            let def = BTH[id];
            if (!def) break;

            data = data.slice(1);
            let val = this.getValue(def.t, data);
            if (val === null) break;

            if (def.f) val *= def.f;
            res[def.n] = val;

            data = data.slice(getByteSize(def.t));
        }
        return res;
    }
};

// ================== STATS ==================

let last_pid = -1;
let lastPacketTime = Date.now();
let packetCount = 0;

// ================== BLE CALLBACK ==================

function scanCB(ev, res) {
    if (ev !== BLE.Scanner.SCAN_RESULT) return;

    if (res.addr.toUpperCase() !== CONFIG.ws90_address) return;
    if (!res.service_data || !res.service_data[BTHOME_SVC_ID_STR]) return;

    let decoded = BTHomeDecoder.unpack(res.service_data[BTHOME_SVC_ID_STR]);
    if (!decoded) return;

    if (decoded.pid === last_pid) return;
    last_pid = decoded.pid;

    decoded.rssi = res.rssi;
    decoded.ts = Math.floor(Date.now() / 1000);

    packetCount++;
    lastPacketTime = Date.now();

    // Publish full JSON
    mqtt_publish(CONFIG.mqtt_base, decoded);

    // Publish individual values
    for (let k in decoded) {
        if (typeof decoded[k] === "number") {
            mqtt_publish(CONFIG.mqtt_base + "/" + k, decoded[k]);
        }
    }

    console.log("WS90:", JSON.stringify(decoded));
}

// ================== HEALTH ==================

function publishHealth() {
    mqtt_publish(CONFIG.mqtt_base + "/health", {
        mqtt: MQTT.isConnected(),
        packets: packetCount,
        last_seen_sec: Math.floor((Date.now() - lastPacketTime) / 1000),
        uptime_sec: Math.floor(Shelly.getUptimeMs() / 1000)
    });
}

// ================== START ==================

print("WS90 BLE → MQTT bridge started");

Timer.set(CONFIG.health_interval_ms, true, publishHealth);

BLE.Scanner.Start(
    { duration_ms: SCAN_DURATION, active: false },
    scanCB
);
```

3. **Update the configuration**:
   - Change `ws90_address` to your WS90's MAC address
   - If needed, change `mqtt_base` to a different topic path

4. **Save and enable the script**
5. **Change the "MQTT settings" in the Shelly device, where to send the data**

## Step 3: Configure WS90 Homey App

1. Open the Homey app
2. Go to **Settings** → **Apps** → **WS90 Weather (MQTT)**
3. Click **Configure**
4. Enter your MQTT settings:
   - **Host**: `127.0.0.1` (if using Homey's MQTT Server) or your broker's IP
   - **Port**: `1883` (default)
   - **Username**: Your MQTT username
   - **Password**: Your MQTT password
   - **Topic**: `shelly/weather/ws90` (must match the script's `mqtt_base`)
5. Click **Save Configuration**

> **Note**: The status indicator will show "Connected" when successfully connected to the broker.

## Step 4: Add WS90 Device

1. In the Homey app, go to **Devices** → **Add Device**
2. Search for **WS90 Weather**
3. Select the **WS90 Weather Station** device
4. Follow the pairing wizard
5. The device will be added and start receiving data automatically

## Troubleshooting

### No data appearing

1. **Check the Shelly script logs**:
   - Open the Shelly app
   - Go to Scripts → Your WS90 script → Logs
   - You should see messages like `WS90: {"temperature":...}`

2. **Verify MQTT connection**:
   - In the WS90 app settings, check the status indicator
   - If it shows "Error: Not authorized", verify your username/password
   - If it shows "Offline", check that your MQTT broker is running

3. **Enable Debug Log**:
   - In the WS90 app settings, enable "Debug Log"
   - Watch the log area for incoming messages
   - You should see data updates when the WS90 transmits

### Connection loops

If you see repeated "Not authorized" errors:
- Double-check your MQTT credentials
- Restart the WS90 Homey app (disable/enable in Homey settings)
- Verify the MQTT broker is accessible from Homey

### Script not running

- Ensure your Shelly device has Bluetooth enabled
- Check that the WS90 is within BLE range (typically 10-30 meters)
- Verify the MAC address in the script matches your WS90

## Available Sensors

Once configured, your WS90 device will provide:

- Temperature (°C)
- Humidity (%)
- Pressure (hPa)
- Wind Speed (m/s)
- Wind Direction (°)
- UV Index
- Illuminance (lux)
- Precipitation (mm)
- Battery (%)
- Dew Point (°C)

## Support

For issues or questions:
- Check the [GitHub repository](https://github.com/w1dg3r/shelly_ws90)
- Report bugs via GitHub Issues
