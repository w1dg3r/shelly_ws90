/**
 * Shelly Plus BLE → MQTT bridge for WS90 Weather Station
 *
 * - Listens for BTHome v2 BLE advertisements from WS90
 * - Decodes weather data (temp, humidity, pressure, wind, rain, UV, lux)
 * - Publishes both:
 *   - Full JSON payload
 *   - Individual MQTT topics per sensor
 *
 * Tested pattern: Shelly Plus Plug S
 */

// ================== CONFIG ==================

let CONFIG = {
    // WS90 MAC address (FROM SHELLY APP)
    ws90_address: "08:B9:5F:D3:62:38",

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

let uint8 = 0;
let int8 = 1;
let uint16 = 2;
let int16 = 3;
let uint24 = 4;
let int24 = 5;

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
    0x05: { n: "illuminance", t: uint24, f: 0.01 },      // lux
    0x20: { n: "rain_status", t: uint8 },                // 0/1
    0x44: { n: "wind_speed", t: uint16, f: 0.01 },       // m/s
    0x46: { n: "uv", t: uint8, f: 0.1 },                 // UV index
    0x5E: { n: "wind_direction", t: uint16, f: 0.01 },   // degrees

    // Packet type 2
    0x01: { n: "battery", t: uint8 },                     // %
    0x04: { n: "pressure", t: uint24, f: 0.01 },          // hPa
    0x08: { n: "dew_point", t: int16, f: 0.01 },         // °C
    0x0C: { n: "capacitor_voltage", t: uint16, f: 0.001 },// V
    0x2E: { n: "humidity", t: uint8 },                    // %
    0x45: { n: "temperature", t: int16, f: 0.1 },         // °C
    0x5F: { n: "precipitation", t: uint16, f: 0.1 }       // mm
};

// ================== DECODER ==================

let BTHomeDecoder = {

    utoi: function (num, bits) {
        let mask = 1 << (bits - 1);
        return num & mask ? num - (1 << bits) : num;
    },

    getValue: function (type, buf) {
        if (buf.length < getByteSize(type)) return null;
        if (type === uint8) return buf.at(0);
        if (type === int8) return this.utoi(buf.at(0), 8);
        if (type === uint16) return (buf.at(1) << 8) | buf.at(0);
        if (type === int16) return this.utoi((buf.at(1) << 8) | buf.at(0), 16);
        if (type === uint24) return (buf.at(2) << 16) | (buf.at(1) << 8) | buf.at(0);
        if (type === int24) return this.utoi(
            (buf.at(2) << 16) | (buf.at(1) << 8) | buf.at(0), 24
        );
        return null;
    },

    unpack: function (data) {
        let res = {};
        let dib = data.at(0);

        if ((dib >> 5) !== 2) return null;     // BTHome v2 only
        if (dib & 0x01) return null;           // encrypted → skip

        data = data.slice(1);

        // Räknare per ID, behövs för duplicerade IDs (t.ex. 0x44 wind + gust)
        let seen = {};

        while (data.length > 1) {
            let id = data.at(0);
            let def = BTH[id];
            if (!def) break;

            data = data.slice(1);
            let val = this.getValue(def.t, data);
            if (val === null) break;

            if (def.f) val *= def.f;

            seen[id] = (seen[id] || 0) + 1;

            // Specialfall: WS90 skickar två st 0x44 i Packet Type 1
            if (id === 0x44) {
                if (seen[id] === 1) res["wind_speed"] = val;	// average
                else if (seen[id] === 2) res["gust_speed"] = val;	// gust
                else res["wind_speed_" + seen[id]] = val; // fallback om fler dyker upp
            } else {
                res[def.n] = val;
            }

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