#!/usr/bin/env node

/**
 * Wattmeter Web Server
 *
 * Continuously samples power data from ISW8001 or MPM1010 and serves it via HTTP
 *
 * Environment variables:
 *   WATTMETER_TYPE=isw8001 or mpm1010 (default: isw8001)
 *   PORT=2122 (default: 2122)
 *   ISW8001_PORT or MPM1010_PORT - serial port path
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const ISW8001 = require('./isw8001.js');
const MPM1010 = require('./mpm1010.js');

const PORT = process.env.PORT || 2122;
const WATTMETER_TYPE = (process.env.WATTMETER_TYPE || 'isw8001').toLowerCase();

// Global state
let meter = null;
let samples = [];
let sampleTimes = [];
let voltageData = [];
let currentData = [];
let powerFactorData = [];
let frequencyData = [];
let voltageRangeData = [];
let currentRangeData = [];
let debugTimingEvents = []; // For debugging timing analysis
let startTime = null;
let deviceName = null;
let deviceVersion = null;
let deviceType = WATTMETER_TYPE;

function sendJSON(res, obj) {
  const json = JSON.stringify(obj);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(json);
}

function sendError(res, message) {
  console.error(message);
  res.writeHead(400, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(message);
}

/**
 * Start continuous sampling
 */
async function startSampling() {
  console.log(`Starting ${deviceType.toUpperCase()} sampling...`);

  // Create appropriate meter instance
  if (deviceType === 'mpm1010') {
    meter = new MPM1010();
  } else if (deviceType === 'isw8001') {
    meter = new ISW8001();
  } else {
    console.error(`Unknown wattmeter type: ${deviceType}`);
    console.error('Set WATTMETER_TYPE to "isw8001" or "mpm1010"');
    process.exit(1);
  }

  try {
    await meter.connect();

    // Get device info
    if (deviceType === 'isw8001') {
      ({ name: deviceName, version: deviceVersion } = await meter.identify());
      console.log('Device:', deviceName);
      if (deviceVersion) {
        console.log('Version:', deviceVersion);
      }
    } else {
      deviceName = 'MPM-1010';
      deviceVersion = null;
      console.log('Device: MPM-1010');
    }

    // Initialize timing
    startTime = Date.now();

    // Listen for debug timing events (MPM1010 only)
    if (deviceType === 'mpm1010') {
      meter.on('debug-timing', (event) => {
        const timeMs = event.timestamp - startTime;
        debugTimingEvents.push({
          type: event.type,
          timeMs: timeMs,
          bytes: event.bytes, // for data-received events
          data: event.data // hex string of received data
        });
      });
    }

    // Listen for measurement events
    meter.on('measurement', (parsed) => {
      const timeMs = Date.now() - startTime;

      if (deviceType === 'isw8001') {
        // ISW8001 format: { type, value, unit, voltage, current, voltageRange, currentRange }
        if (parsed.value !== undefined && typeof parsed.value === 'number') {
          samples.push(parsed.value);
          sampleTimes.push(timeMs);
          voltageData.push(parsed.voltage !== undefined ? parsed.voltage : null);
          currentData.push(parsed.current !== undefined ? parsed.current : null);
          powerFactorData.push(null); // ISW8001 doesn't provide PF
          frequencyData.push(null); // ISW8001 doesn't provide frequency
          voltageRangeData.push(parsed.voltageRange || null);
          currentRangeData.push(parsed.currentRange || null);

          // Log every 100 samples
          if (samples.length % 100 === 0) {
            console.log(`Samples: ${samples.length}, Latest: ${parsed.value} ${parsed.unit}, Δt: ${(timeMs - sampleTimes.at(-2)).toFixed(1)}ms`);
          }
        }
      } else {
        // MPM1010 format: { voltage, current, power, powerFactor, frequency }
        if (parsed.power !== undefined && typeof parsed.power === 'number') {
          samples.push(parsed.power);
          sampleTimes.push(timeMs);
          voltageData.push(parsed.voltage !== undefined ? parsed.voltage : null);
          currentData.push(parsed.current !== undefined ? parsed.current : null);
          powerFactorData.push(parsed.powerFactor !== undefined ? parsed.powerFactor : null);
          frequencyData.push(parsed.frequency !== undefined ? parsed.frequency : null);
          voltageRangeData.push(null); // MPM1010 doesn't have configurable ranges
          currentRangeData.push(null);

          // Log every 100 samples
          if (samples.length % 100 === 0) {
            console.log(`Samples: ${samples.length}, Latest: ${parsed.power.toFixed(2)}W, Δt: ${(timeMs - sampleTimes.at(-2)).toFixed(1)}ms`);
          }
        }
      }
    });

    // Enable automatic measurement mode
    if (deviceType === 'isw8001') {
      await meter.enableAutoMode(); // ISW8001: MA1 command
    } else {
      await meter.enableAutoMode(50); // MPM1010: 50ms minimum interval to test internal sampling rate
    }

    console.log('✓ Sampling started');

  } catch (error) {
    console.error('Failed to start sampling:', error.message);
    process.exit(1);
  }
}


/**
 * HTTP request handler
 */
const app = (req, res) => {
  console.log(new Date(), req.url);

  // /info endpoint for device information
  if (req.url === "/info") {
    sendJSON(res, {
      device_type: deviceType,
      device_name: deviceName,
      device_version: deviceVersion,
      has_range_control: deviceType === 'isw8001'
    });
    return;
  }

  // /range endpoint to set range mode or specific ranges (ISW8001 only)
  if (req.url === "/range" && req.method === "POST") {
    if (deviceType !== 'isw8001') {
      sendError(res, 'Range control not supported on MPM1010');
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const value = data.value.toLowerCase();

        if (value === 'auto') {
          await meter.enableAutoRange();
        } else if (value === 'manual') {
          await meter.disableAutoRange();
        } else if (value.startsWith('u')) {
          const range = parseInt(value.substring(1));
          await meter.setVoltageRange(range);
        } else if (value.startsWith('i')) {
          const range = parseInt(value.substring(1));
          await meter.setCurrentRange(range);
        } else {
          throw new Error(`Invalid range value: ${data.value}`);
        }

        sendJSON(res, { success: true });
      } catch (error) {
        sendError(res, error.message);
      }
    });
    return;
  }

  // /debug-timing endpoint for debugging serial communication timing
  if (req.url === "/debug-timing") {
    sendJSON(res, {
      events: debugTimingEvents
    });
    return;
  }

  // /data endpoint for web UI
  if (req.url.startsWith("/data")) {
    if (samples.length === 0) {
      sendJSON(res, {
        start_index: 0,
        power_values: [],
        voltage_values: [],
        current_values: [],
        power_factor_values: [],
        frequency_values: [],
        voltage_ranges: [],
        current_ranges: [],
        sample_times: []
      });
      return;
    }

    const query = url.parse(req.url, true).query;
    const startIndex = query.start ? Math.max(0, parseInt(query.start)) : 0;

    sendJSON(res, {
      start_index: startIndex,
      power_values: samples.slice(startIndex),
      voltage_values: voltageData.slice(startIndex),
      current_values: currentData.slice(startIndex),
      power_factor_values: powerFactorData.slice(startIndex),
      frequency_values: frequencyData.slice(startIndex),
      voltage_ranges: voltageRangeData.slice(startIndex),
      current_ranges: currentRangeData.slice(startIndex),
      sample_times: sampleTimes.slice(startIndex)
    });
    return;
  }

  // Serve index.html
  if (req.url === "/" || req.url === "/index.html") {
    const indexPath = path.join(__dirname, 'index.html');
    try {
      const data = fs.readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
      return;
    } catch (err) {
      // Fall through to 404
    }
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
};

/**
 * Start the HTTP server
 */
async function runServer() {
  const server = http.createServer(app);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✓ Server running at http://localhost:${PORT}/\n`);
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    if (meter) {
      await meter.disconnect();
    }
    server.close();
    process.exit(0);
  });
}

// Main
if (require.main === module) {
  startSampling().then(() => {
    runServer();
  });
}
