'use strict';

module.exports = {
    async getLogs({ homey }) {
        return homey.app.logger.getAll();
    },

    async deleteLogs({ homey }) {
        homey.app.logger.clear();
        return true;
    },

    async getStatus({ homey }) {
        return {
            status: homey.app.mqttStatus || 'Initializing...',
            summary: homey.app.logger.getSummary()
        };
    },
};
