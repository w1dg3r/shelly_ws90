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
            'dew_point': 'measure_dew_point',
            'gust_speed': 'measure_wind_gust'
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
            }
        }

        this.updateFeelsLike(payload);
    }

    updateFeelsLike(payload) {
        const temp = payload.temperature !== undefined ? Number(payload.temperature) : this.getCapabilityValue('measure_temperature');
        const windSpeedMs = payload.wind_speed !== undefined ? Number(payload.wind_speed) : this.getCapabilityValue('measure_wind_strength');

        if (temp === null || isNaN(temp) || windSpeedMs === null || isNaN(windSpeedMs)) return;

        let feelsLike = temp;
        const windSpeedKmh = windSpeedMs * 3.6;

        // WMO / NOAA Wind Chill Index: T <= 10°C and v > 1.3 m/s (4.68 km/h)
        if (temp <= 10 && windSpeedKmh > 4.68) {
            feelsLike = 13.12
                + (0.6215 * temp)
                - (11.37 * Math.pow(windSpeedKmh, 0.16))
                + (0.3965 * temp * Math.pow(windSpeedKmh, 0.16));

            feelsLike = Math.round(feelsLike * 10) / 10;
        }

        this.setCapabilityValue('measure_apparent_temperature', feelsLike).catch(err => {
            this.homey.app.logger.log('ERROR', 'DEVICE', `[${this.getName()}] Failed to set measure_apparent_temperature`, { value: feelsLike, error: err.message });
        });
    }

}

module.exports = WS90Device;
