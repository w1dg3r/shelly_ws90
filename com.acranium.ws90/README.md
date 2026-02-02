# WS90 Weather (MQTT)

This is a Homey Pro app to connect to an MQTT broker and read data from a WS90 Weather Station.

## Features
- **Global MQTT Configuration**: Configure your Broker once in the App Settings.
- **Single Connection**: Efficiently manages one connection for the entire app.
- Reads `measure_temperature` from the WS90 weather data.

## Installation & Running

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run**
   ```bash
   homey app run
   ```

3. **Configure MQTT**
   - Go to **More (...)** > **Apps** > **WS90 Weather (MQTT)** > **Configure App**.
   - Enter Host, Port, Topic etc.
   - Click **Save**.

4. **Add Device**
   - Go to **Devices** > **+** > **WS90 Weather (MQTT)**.
   - Select **WS90 Weather Station**.
   - Click **Connect** (It will just add the device).
   - The device will start receiving data from the global MQTT connection.
   
## Development info
- **SDK**: v3
- **Dependencies**: `mqtt`
