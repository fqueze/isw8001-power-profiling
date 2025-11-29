#!/usr/bin/env node

/**
 * ISW 8001 Wattmeter Web Server
 *
 * Continuously samples power data from the ISW8001 and serves it via HTTP
 */

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const ISW8001 = require('./isw8001.js');

const PORT = process.env.PORT || 2122;

// Global state
let meter = null;
let samples = [];
let sampleTimes = [];
let voltageData = [];
let currentData = [];
let voltageRangeData = [];
let currentRangeData = [];
let startTime = null;
let deviceName = null;
let deviceVersion = null;

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
  console.log('Starting ISW8001 sampling...');

  meter = new ISW8001();

  try {
    await meter.connect();

    // Get device info
    ({ name: deviceName, version: deviceVersion } = await meter.identify());
    console.log('Device:', deviceName);
    if (deviceVersion) {
      console.log('Version:', deviceVersion);
    }

    // Initialize timing
    startTime = Date.now();

    // Listen for measurement events
    meter.on('measurement', (parsed) => {
      if (parsed.value !== undefined && typeof parsed.value === 'number') {
        const timeMs = Date.now() - startTime;

        // Store sample
        samples.push(parsed.value);
        sampleTimes.push(timeMs);

        // Store voltage and current data
        voltageData.push(parsed.voltage !== undefined ? parsed.voltage : null);
        currentData.push(parsed.current !== undefined ? parsed.current : null);
        voltageRangeData.push(parsed.voltageRange || null);
        currentRangeData.push(parsed.currentRange || null);

        // Log every 100 samples
        if (samples.length % 100 === 0) {
          console.log(`Samples: ${samples.length}, Latest: ${parsed.value} ${parsed.unit}, Δt: ${(timeMs - sampleTimes.at(-2)).toFixed(1)}ms`);
        }
      }
    });

    // Enable automatic measurement mode (MA1)
    await meter.enableAutoMode();

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
      device_name: deviceName,
      device_version: deviceVersion
    });
    return;
  }

  // /range endpoint to set range mode or specific ranges
  if (req.url === "/range" && req.method === "POST") {
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

  // /data endpoint for web UI
  if (req.url.startsWith("/data")) {
    if (samples.length === 0) {
      sendJSON(res, {
        start_index: 0,
        power_values: [],
        voltage_values: [],
        current_values: [],
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
