'use strict';

const Homey = require('homey');

class WS90Device extends Homey.Device {

    async onInit() {
        this.log('WS90 Device initialized (Global MQTT)');
        this.setAvailable().catch(this.error);
    }

    updateFromPayload(payload) {
        if (!payload) {
            this.homey.app.logger.log('WARN', 'DEVICE', `[${this.getName()}] Received empty payload`);
            return;
        }

        const receivedFields = Object.keys(payload);
        this.homey.app.logger.log('DEBUG', 'DEVICE', `[${this.getName()}] Processing payload`, { fields: receivedFields });

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
                    this.setCapabilityValue(capability, val).catch(err => {
                        this.homey.app.logger.log('ERROR', 'DEVICE', `[${this.getName()}] Failed to set ${capability}`, { value: val, error: err.message });
                    });
                } else {
                    this.homey.app.logger.log('WARN', 'DEVICE', `[${this.getName()}] Invalid numeric value for ${key}`, { value: payload[key] });
                }
            } else {
                // Potential missing field logging (uncomment if needed, but might be noisy)
                // this.homey.app.logger.log('DEBUG', 'DEVICE', `[${this.getName()}] Field ${key} missing in payload`);
            }
        }
    }

}

module.exports = WS90Device;
