'use strict';

const Homey = require('homey');
const WeatherAnalytics = require('../../lib/WeatherAnalytics');

class WS90AnalyticsDevice extends Homey.Device {

    async onInit() {
        this.log('WS90 Analytics Device initialized');
        this.setAvailable().catch(this.error);

        this.analytics = new WeatherAnalytics();

        // Fire flow triggers when alarm states change
        this.registerCapabilityListener('alarm_frost', async (value) => {
            const triggerId = value ? 'frost_warning_on' : 'frost_warning_off';
            this.homey.flow.getDeviceTriggerCard(triggerId).trigger(this).catch(this.error);
        });

        this.registerCapabilityListener('alarm_rain_imminent', async (value) => {
            const triggerId = value ? 'rain_imminent_on' : 'rain_imminent_off';
            this.homey.flow.getDeviceTriggerCard(triggerId).trigger(this).catch(this.error);
        });
    }

    updateFromPayload(payload) {
        if (!payload) return;

        const results = this.analytics.update(payload);

        // Map calculated results to capabilities
        this.setCapabilityValue('measure_wind_beaufort', results.beaufort).catch(this.error);
        this.setCapabilityValue('measure_wind_direction_string', results.windDirectionText).catch(this.error);
        this.setCapabilityValue('measure_rain_rate', results.rainRate).catch(this.error);
        this.setCapabilityValue('measure_pressure_trend', results.pressureTrend).catch(this.error);
        this.setCapabilityValue('measure_solar_drying_index', results.dryingIndex).catch(this.error);
        this.setCapabilityValue('alarm_frost', results.frostWarning).catch(this.error);
        this.setCapabilityValue('alarm_rain_imminent', results.rainExpected).catch(this.error);
    }
}

module.exports = WS90AnalyticsDevice;
