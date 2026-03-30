'use strict';

class WeatherAnalytics {
    constructor() {
        this.history = {
            pressure: [], // { ts, value }
            precipitation: [],
            wind: []
        };
        this.state = {
            beaufort: 0,
            windDirectionText: 'N/A',
            rainRate: 0,
            pressureTrend: 'Steady',
            dryingIndex: 0,
            rainExpected: false,
            frostWarning: false
        };
    }

    update(payload) {
        const ts = Number(payload.ts) * 1000 || Date.now(); // milliseconds
        const data = {
            temp: payload.temperature !== undefined ? Number(payload.temperature) : NaN,
            humidity: payload.humidity !== undefined ? Number(payload.humidity) : NaN,
            pressure: payload.pressure !== undefined ? Number(payload.pressure) : NaN,
            windSpeed: payload.wind_speed !== undefined ? Number(payload.wind_speed) : NaN,
            windDir: payload.wind_direction !== undefined ? Number(payload.wind_direction) : NaN,
            precipitation: payload.precipitation !== undefined ? Number(payload.precipitation) : NaN
        };

        // Prune old history
        const threeHoursAgo = ts - (3 * 3600 * 1000);
        this.history.pressure = this.history.pressure.filter(e => e.ts >= threeHoursAgo);
        this.history.precipitation = this.history.precipitation.filter(e => e.ts >= threeHoursAgo);
        this.history.wind = this.history.wind.filter(e => e.ts >= threeHoursAgo);

        // Update history and latest results IF the data is present in this payload
        if (!isNaN(data.pressure)) {
            this.history.pressure.push({ ts, value: data.pressure });
            this.state.pressureTrend = this._calculatePressureTrend(ts, data.pressure);
        }
        if (!isNaN(data.precipitation)) {
            this.history.precipitation.push({ ts, value: data.precipitation });
            this.state.rainRate = this._calculateRainRate(ts, data.precipitation);
        }
        if (!isNaN(data.windSpeed)) {
            this.history.wind.push({ ts, value: data.windSpeed });
            this.state.beaufort = this._calculateBeaufort(data.windSpeed);
        }
        if (!isNaN(data.windDir)) {
            this.state.windDirectionText = this._degreesToCardinal(data.windDir);
        }

        // Update complex indices if inputs are mostly present
        if (!isNaN(data.temp) || !isNaN(data.humidity) || !isNaN(data.windSpeed)) {
            this.state.dryingIndex = this._calculateDryingIndex(data);
            this.state.rainExpected = this._predictRain(data);
            this.state.frostWarning = this._frostWarning(data);
        }

        return this.state;
    }

    _calculateBeaufort(speedMs) {
        if (isNaN(speedMs)) return 0;
        const limits = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
        for (let i = 0; i < limits.length; i++) {
            if (speedMs < limits[i]) return i;
        }
        return 12;
    }

    _degreesToCardinal(deg) {
        if (isNaN(deg)) return 'N/A';
        const val = Math.floor((deg / 22.5) + 0.5);
        const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
        return arr[(val % 16)];
    }

    _calculateRainRate(ts, currentPrecip) {
        // Calculate rain rate (mm/h) based on the last 15 minutes of data
        if (this.history.precipitation.length < 2) return 0;
        const fifteenMinsAgo = ts - (15 * 60 * 1000);

        // Find reference point ~15 mins ago
        let ref = this.history.precipitation[0];
        for (const e of this.history.precipitation) {
            if (e.ts >= fifteenMinsAgo) {
                ref = e;
                break;
            }
        }

        const timeDiffHours = (ts - ref.ts) / (3600 * 1000);
        if (timeDiffHours <= 0) return 0;

        let rainDiff = currentPrecip - ref.value;
        if (rainDiff < 0) rainDiff = 0; // Handle reset/reboot roughly here (actual accurate handling is done in device.js)

        const rate = rainDiff / timeDiffHours;
        return Math.round(rate * 10) / 10;
    }

    _calculatePressureTrend(ts, currentPressure) {
        if (this.history.pressure.length < 2) return 'Steady';
        const oneHourAgo = ts - (3600 * 1000);

        let ref = this.history.pressure[0];
        for (const e of this.history.pressure) {
            if (e.ts >= oneHourAgo) {
                ref = e;
                break;
            }
        }

        const drop = ref.value - currentPressure;
        if (drop >= 1.0) return 'Falling Fast';
        if (drop >= 0.5) return 'Falling';
        if (drop <= -1.0) return 'Rising Fast';
        if (drop <= -0.5) return 'Rising';
        return 'Steady';
    }

    _calculateDryingIndex(data) {
        // Simple index 0-10 based on temp, humidity and wind
        if (isNaN(data.temp) || isNaN(data.humidity) || isNaN(data.windSpeed)) return 0;

        let index = 5;

        // Temperature contribution (higher temp = better drying)
        index += (data.temp - 15) * 0.2;

        // Humidity contribution (lower humidity = better drying)
        index += (50 - data.humidity) * 0.1;

        // Wind contribution (more wind = better drying, up to a point)
        index += Math.min(data.windSpeed, 10) * 0.5;

        // Constrain to 0-10
        return Math.round(Math.max(0, Math.min(10, index)));
    }

    _predictRain(data) {
        // High humidity + falling pressure + increasing wind
        const trend = this._calculatePressureTrend(Date.now(), data.pressure);
        const pressureFalling = trend.includes('Falling');

        if (pressureFalling && data.humidity > 85 && data.windSpeed > 3.0) {
            return true;
        }
        return false;
    }

    _frostWarning(data) {
        // Frost risk if temp is low and humidity is relatively high
        if (!isNaN(data.temp) && !isNaN(data.humidity)) {
            if (data.temp <= 3.0 && data.humidity > 70) {
                return true;
            }
        }
        return false;
    }
}

module.exports = WeatherAnalytics;
