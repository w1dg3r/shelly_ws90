'use strict';

const Homey = require('homey');
const mqtt = require('mqtt');

module.exports = class WS90App extends Homey.App {

  async onInit() {
    this.log('WS90 Weather (MQTT) App initialized');

    // Clear old debug msg on start
    this.homey.settings.set('last_message', '');

    await this.connectMqtt();

    this.homey.settings.on('set', async (key) => {
      if (key.startsWith('mqtt_')) {
        this.log('Settings changed, reconnecting...');
        await this.connectMqtt();
      }
    });
  }

  async connectMqtt() {
    if (this.mqttClient) {
      this.mqttClient.end();
      this.mqttClient = null;
    }

    const host = this.homey.settings.get('mqtt_host') || '192.168.1.182';
    const port = this.homey.settings.get('mqtt_port') || 1883;
    const user = this.homey.settings.get('mqtt_user');
    const pass = this.homey.settings.get('mqtt_pass');
    this.topic = this.homey.settings.get('mqtt_topic') || 'shelly/weather/ws90';

    const brokerUrl = `mqtt://${host}:${port}`;
    const options = {
      username: user,
      password: pass,
      reconnectPeriod: 5000,
    };

    this.log(`Connecting to ${brokerUrl}...`);

    try {
      this.mqttClient = mqtt.connect(brokerUrl, options);

      this.mqttClient.on('connect', () => {
        this.log('Connected to MQTT');
        this.mqttClient.subscribe(this.topic, (err) => {
          if (err) this.error('Subscribe error', err);
          else this.log('Subscribed to', this.topic);
        });
      });

      this.mqttClient.on('message', (topic, message) => {
        this.onMessage(topic, message);
      });

      this.mqttClient.on('error', (err) => this.error('MQTT Error', err.message));

    } catch (err) {
      this.error('Init error', err);
    }
  }

  onMessage(topic, message) {
    if (topic !== this.topic) return;

    let payload;
    let rawString = message.toString();

    // Debug Log
    if (this.homey.settings.get('debug_log') === true) {
      this.homey.settings.set('last_message', rawString);
    }

    try {
      payload = JSON.parse(rawString);
    } catch (err) {
      return;
    }

    const driver = this.homey.drivers.getDriver('ws90');
    if (driver) {
      driver.getDevices().forEach(device => {
        device.updateFromPayload(payload);
      });
    }
  }

};
