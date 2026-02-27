'use strict';

const Homey = require('homey');

class WS90Device extends Homey.Device {

    async onInit() {
        this.log('WS90 Device initialized (Global MQTT)');
        this.setAvailable().catch(this.error);

        // Migration: Remove old raw rain capability
        if (this.hasCapability('measure_rain')) {
            this.log('Removing legacy capability: measure_rain');
            await this.removeCapability('measure_rain').catch(this.error);
        }

        // Migration: Add new capabilities if missing
        const newCaps = [
            'measure_gust_strength',
            'measure_apparent_temperature',
            'alarm_rain',
            'measure_rain_today',
            'measure_rain_hour',
            'measure_rain_24h'
        ];
        for (const cap of newCaps) {
            if (!this.hasCapability(cap)) {
                this.log(`Adding missing capability: ${cap}`);
                await this.addCapability(cap).catch(this.error);
            }
        }

        // Restore rain history from persistent store
        this.rainHistory = this.getStoreValue('rainHistory') || [];
        this._lastStoredTs = this.rainHistory.length > 0
            ? this.rainHistory[this.rainHistory.length - 1].ts
            : 0;
        this._lastPrecipitation = this.rainHistory.length > 0
            ? this.rainHistory[this.rainHistory.length - 1].value
            : null;
    }

    updateFromPayload(payload) {
        if (!payload) {
            this.homey.app.logger.log('WARN', 'DEVICE', `[${this.getName()}] Received empty payload`);
            return;
        }

        const receivedFields = Object.keys(payload);
        this.homey.app.logger.log('DEBUG', 'DEVICE', `[${this.getName()}] Processing payload`, { fields: receivedFields });

        // Map: Payload Field -> Homey Capability (numeric)
        const map = {
            'temperature': 'measure_temperature',
            'humidity': 'measure_humidity',
            'pressure': 'measure_pressure',
            'wind_speed': 'measure_wind_strength',
            'wind_direction': 'measure_wind_angle',
            'uv': 'measure_ultraviolet',
            'illuminance': 'measure_luminance',
            'battery': 'measure_battery',
            'dew_point': 'measure_dew_point',
            'gust_speed': 'measure_gust_strength'
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

        // Boolean rain status
        if (payload.rain_status !== undefined) {
            this.setCapabilityValue('alarm_rain', payload.rain_status === 1).catch(err => {
                this.homey.app.logger.log('ERROR', 'DEVICE', `[${this.getName()}] Failed to set alarm_rain`, { error: err.message });
            });
        }

        this.updateFeelsLike(payload);
        this.updateRainHistory(payload);
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

    updateRainHistory(payload) {
        const ts = Number(payload.ts);
        const precipitation = Number(payload.precipitation);
        if (isNaN(ts) || isNaN(precipitation)) return;

        const nowMs = ts * 1000;

        // Detect sensor reset or uint16 rollover (precipitation dropped)
        if (this._lastPrecipitation !== null && precipitation < this._lastPrecipitation) {
            this.homey.app.logger.log('WARN', 'DEVICE', `[${this.getName()}] Rain counter reset detected (${this._lastPrecipitation} -> ${precipitation}), clearing history`);
            this.rainHistory = [];
            this._lastStoredTs = 0;
            this.setStoreValue('rainHistory', []).catch(this.error);
        }
        this._lastPrecipitation = precipitation;

        // Downsample: only store one entry per minute to keep history size manageable
        // (~1,500 entries max for 25h, ~45KB — safe for setStoreValue)
        let historyUpdated = false;
        if (ts - this._lastStoredTs >= 60) {
            this.rainHistory.push({ ts, value: precipitation });
            this._lastStoredTs = ts;
            historyUpdated = true;

            // Prune entries older than 25 hours
            const cutoff = ts - (25 * 3600);
            this.rainHistory = this.rainHistory.filter(e => e.ts >= cutoff);

            // Persist (only when history changed)
            this.setStoreValue('rainHistory', this.rainHistory).catch(this.error);
        }

        // --- Rain last hour (rolling) ---
        const oneHourAgoTs = ts - 3600;
        const hourRef = this._findClosestValue(oneHourAgoTs);
        const rainHour = hourRef !== null ? Math.max(0, precipitation - hourRef) : 0;
        this.setCapabilityValue('measure_rain_hour', Math.round(rainHour * 10) / 10).catch(err => {
            this.homey.app.logger.log('ERROR', 'DEVICE', `[${this.getName()}] Failed to set measure_rain_hour`, { error: err.message });
        });

        // --- Rain last 24h (rolling) ---
        const dayAgoTs = ts - (24 * 3600);
        const dayRef = this._findClosestValue(dayAgoTs);
        const rain24h = dayRef !== null ? Math.max(0, precipitation - dayRef) : 0;
        this.setCapabilityValue('measure_rain_24h', Math.round(rain24h * 10) / 10).catch(err => {
            this.homey.app.logger.log('ERROR', 'DEVICE', `[${this.getName()}] Failed to set measure_rain_24h`, { error: err.message });
        });

        // --- Rain today (since midnight local time) ---
        const localDate = new Date(nowMs);
        const midnightTs = new Date(
            localDate.getFullYear(),
            localDate.getMonth(),
            localDate.getDate()
        ).getTime() / 1000;

        const midnightRef = this._findFirstValueAtOrAfter(midnightTs);
        const rainToday = midnightRef !== null ? Math.max(0, precipitation - midnightRef) : 0;
        this.setCapabilityValue('measure_rain_today', Math.round(rainToday * 10) / 10).catch(err => {
            this.homey.app.logger.log('ERROR', 'DEVICE', `[${this.getName()}] Failed to set measure_rain_today`, { error: err.message });
        });
    }

    // Find the precipitation value of the history entry closest to targetTs
    _findClosestValue(targetTs) {
        if (this.rainHistory.length === 0) return null;
        let best = null;
        let bestDiff = Infinity;
        for (const e of this.rainHistory) {
            const diff = Math.abs(e.ts - targetTs);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = e.value;
            }
        }
        return best;
    }

    // Find the precipitation value of the FIRST history entry at or after targetTs
    _findFirstValueAtOrAfter(targetTs) {
        if (this.rainHistory.length === 0) return null;
        const sorted = [...this.rainHistory].sort((a, b) => a.ts - b.ts);
        const found = sorted.find(e => e.ts >= targetTs);
        return found ? found.value : null;
    }

}

module.exports = WS90Device;
