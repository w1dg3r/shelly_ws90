'use strict';

const Homey = require('homey');
const mqtt = require('mqtt');
const DebugLogger = require('./lib/logger');

module.exports = class WS90App extends Homey.App {

  async onInit() {
    this.log('WS90 Weather (MQTT) App initialized');

    // Initialize Logger & Status
    this.logger = new DebugLogger();
    this.mqttStatus = 'Initializing...';
    this.logger.log('INFO', 'SYSTEM', 'App starting...');

    // Clear old debug msg on start
    this.homey.settings.set('last_message', '');

    await this.connectMqtt();

    this.homey.settings.on('set', (key) => {
      if (key.startsWith('mqtt_')) {
        this.logger.log('INFO', 'SYSTEM', `Setting changed: ${key}`);
        // Debounce settings changes (1 second)
        if (this._settingsDebounce) clearTimeout(this._settingsDebounce);
        this._settingsDebounce = setTimeout(() => {
          this.log('Settings changed, reconnecting...');
          this.connectMqtt();
        }, 1000);
      }
    });
  }

  async connectMqtt() {
    if (this.mqttClient) {
      this.log('Disconnecting previous MQTT client...');
      try {
        this.mqttClient.end(true);
        this.mqttClient.removeAllListeners();
      } catch (e) { }
      this.mqttClient = null;
    }

    const host = this.homey.settings.get('mqtt_host') || '127.0.0.1';
    const port = this.homey.settings.get('mqtt_port') || 1883;
    const user = this.homey.settings.get('mqtt_user');
    const pass = this.homey.settings.get('mqtt_pass');
    this.topic = this.homey.settings.get('mqtt_topic') || 'shelly/weather/ws90';

    if (!host || !port || !this.topic) {
      this.log('Missing MQTT configuration.');
      this.homey.api.realtime('mqtt_status', 'Missing Configuration');
      return;
    }

    const clientId = 'homey_ws90_' + Math.random().toString(16).substr(2, 8);
    const brokerUrl = `mqtt://${host}:${port}`;

    this.mqttStatus = 'Connecting...';
    this.logger.log('INFO', 'MQTT', `Connecting to ${brokerUrl} (Topic: ${this.topic})`, { host, port, user: user ? '****' : null });
    this.homey.api.realtime('mqtt_status', this.mqttStatus);

    try {
      this.mqttClient = mqtt.connect(brokerUrl, {
        username: user,
        password: pass,
        clientId: clientId,
        clean: true,
        reconnectPeriod: 10000,
        connectTimeout: 10000,
      });

      this.mqttClient.on('connect', () => {
        this.mqttStatus = 'Connected';
        this.logger.log('INFO', 'MQTT', 'Connected to MQTT');
        this.homey.api.realtime('mqtt_status', this.mqttStatus);

        this.mqttClient.subscribe(this.topic, (err) => {
          if (err) {
            this.logger.log('ERROR', 'MQTT', `Subscribe error: ${err.message}`, { topic: this.topic });
            this.homey.api.realtime('mqtt_log', `Subscribe Error: ${err.message}`);
          } else {
            this.logger.log('INFO', 'MQTT', `Subscribed to topic: ${this.topic}`);
            this.homey.api.realtime('mqtt_log', `Subscribed to ${this.topic}`);
          }
        });
      });

      this.mqttClient.on('message', (topic, message) => {
        this.onMessage(topic, message);
      });

      this.mqttClient.on('error', (err) => {
        this.mqttStatus = `Error: ${err.message}`;
        this.logger.log('ERROR', 'MQTT', `MQTT Client Error: ${err.message}`);
        this.homey.api.realtime('mqtt_status', this.mqttStatus);
        this.homey.api.realtime('mqtt_log', `Connection Error: ${err.message}`);
      });

      this.mqttClient.on('offline', () => {
        this.mqttStatus = 'Offline / Reconnecting';
        this.logger.log('WARN', 'MQTT', 'Broker offline or reconnecting');
        this.homey.api.realtime('mqtt_status', this.mqttStatus);
      });

    } catch (err) {
      this.error('Init error', err);
      this.homey.api.realtime('mqtt_status', `Init Error: ${err.message}`);
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
      this.logger.log('DEBUG', 'DATA', `Received message on ${topic}`, payload);

      this.homey.api.realtime('weather_update', payload);

    } catch (err) {
      this.logger.log('ERROR', 'DATA', 'Failed to parse JSON message', { raw: rawString, error: err.message });
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
