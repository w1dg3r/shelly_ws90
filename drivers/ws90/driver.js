'use strict';

const Homey = require('homey');

class WS90Driver extends Homey.Driver {

  async onPairListDevices() {
    return [
      {
        name: 'WS90 Weather Station',
        data: {
          id: 'ws90_device'
        }
      }
    ];
  }

}

module.exports = WS90Driver;
