'use strict';

const Homey = require('homey');

class WS90Driver extends Homey.Driver {

  async onPairListDevices() {
    return [
      {
        name: 'WS90 Analytics Insights',
        data: {
          id: 'ws90_analytics_device'
        }
      }
    ];
  }

}

module.exports = WS90Driver;
