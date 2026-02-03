'use strict';

const Homey = require('homey');

class WS90Device extends Homey.Device {

    async onInit() {
        this.log('WS90 Device initialized (Global MQTT)');
        this.setAvailable().catch(this.error);
    }

    updateFromPayload(payload) {
        if (!payload) return;

        // Map: Payload Field -> Homey Capability
        const map = {
            'temperature': 'measure_temperature',
            'humidity': 'measure_humidity',
            'pressure': 'measure_pressure',
            'wind_speed': 'measure_wind_strength',
            'wind_direction': 'measure_wind_angle',
            'uv': 'measure_ultraviolet',
            'illuminance': 'measure_luminance',
            'battery': 'measure_battery',
            'precipitation': 'measure_rain',
            'dew_point': 'measure_dew_point'
        };

        for (const [key, capability] of Object.entries(map)) {
            if (payload[key] !== undefined && payload[key] !== null) {
                const val = Number(payload[key]);
                if (!isNaN(val)) {
                    this.setCapabilityValue(capability, val).catch(this.error);
                }
            }
        }
    }

}

module.exports = WS90Device;
