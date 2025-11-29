#!/usr/bin/env node

/**
 * ISW 8001 Wattmeter Test Script
 *
 * Comprehensive test script to exercise all ISW8001 methods and ensure
 * proper parsing of responses.
 *
 * Usage:
 *   node test-isw8001.js                    # Run all tests
 *   node test-isw8001.js --continuous       # Continuous monitoring mode
 *   node test-isw8001.js --fast             # Fast polling mode
 *   node test-isw8001.js --command WATT     # Send custom command
 */

const ISW8001 = require('./isw8001.js');

/**
 * Display measurement with timestamp and delta
 */
function displayMeasurement(parsed, lastTime) {
  const now = Date.now();
  const timeDelta = lastTime ? Math.round(now - lastTime) + 'ms' : '0ms';

  const timestamp = new Date().toISOString().substr(11, 12);
  console.log(`[${timestamp}] Δt=${timeDelta} | ${parsed.type}=${parsed.value} ${parsed.unit} | Range: ${parsed.voltageRange}, ${parsed.currentRange}`);

  return now;
}

// Parse command line arguments
const args = process.argv.slice(2);
const continuous = args.includes('--continuous');
const fastPoll = args.includes('--fast');
const commandIndex = args.indexOf('--command');
const customCommand = commandIndex >= 0 ? args[commandIndex + 1] : null;

/**
 * Run comprehensive tests on all ISW8001 methods
 */
async function runTests() {
  const meter = new ISW8001();

  try {
    console.log('=== ISW8001 Comprehensive Test Suite ===\n');

    // Test 1: Connection
    console.log('Test 1: Connecting to device...');
    await meter.connect();
    console.log('✓ Connection successful\n');

    // Test 2: Device Identification
    console.log('Test 2: Device identification (*IDN? and VERSION?)');
    const info = await meter.identify();
    console.log('  Name:', info.name);
    console.log('  Version:', info.version);
    console.log('  ✓ identify() returned:', typeof info.name === 'string' && info.name.length > 0 ? 'valid object' : 'FAIL');
    console.log();

    // Test 3: Get Status
    console.log('Test 3: Device status (STATUS?)');
    const status = await meter.getStatus();
    console.log('  Response:', status);
    console.log('  ✓ getStatus() returned:', typeof status === 'string' && status.length > 0 ? 'valid string' : 'FAIL');
    console.log();

    // Test 4: Get Value
    console.log('Test 4: Current value (VAL?)');
    const value = await meter.getValue();
    console.log('  Response:', value);
    const parsedValue = meter.parseMeasurement(value);
    console.log('  Parsed:', parsedValue);
    console.log('  ✓ getValue() returned:', typeof value === 'string' ? 'valid string' : 'FAIL');
    console.log('  ✓ Parsed value:', parsedValue.value !== undefined ? parsedValue.value + ' ' + parsedValue.unit : 'FAIL');
    console.log('  ✓ Voltage range:', parsedValue.voltageRange || 'FAIL');
    console.log('  ✓ Current range:', parsedValue.currentRange || 'FAIL');
    console.log();

    // Test 5: Get Status and Value
    console.log('Test 5: Status and value (VAS?)');
    const statusAndValue = await meter.getStatusAndValue();
    console.log('  Response:', statusAndValue);
    const parsedVAS = meter.parseMeasurement(statusAndValue);
    console.log('  Parsed:', parsedVAS);
    console.log('  ✓ getStatusAndValue() returned:', typeof statusAndValue === 'string' ? 'valid string' : 'FAIL');
    console.log();

    // Test 6: Switch measurement functions
    console.log('Test 6: Switching measurement functions');

    console.log('  6a: Switch to VOLT');
    await meter.setFunction('VOLT');
    await meter.sleep(300);
    const voltValue = await meter.getValue();
    const parsedVolt = meter.parseMeasurement(voltValue);
    console.log('    Response:', voltValue);
    console.log('    Parsed:', parsedVolt);
    console.log('    ✓ Voltage measurement:', parsedVolt.type === 'DCV' || parsedVolt.type === 'ACV' ? 'OK' : 'FAIL');
    console.log();

    console.log('  6b: Switch to AMP');
    await meter.setFunction('AMP');
    await meter.sleep(300);
    const ampValue = await meter.getValue();
    const parsedAmp = meter.parseMeasurement(ampValue);
    console.log('    Response:', ampValue);
    console.log('    Parsed:', parsedAmp);
    console.log('    ✓ Current measurement:', parsedAmp.type === 'DCA' || parsedAmp.type === 'ACA' ? 'OK' : 'FAIL');
    console.log();

    console.log('  6c: Switch to VAR');
    await meter.setFunction('VAR');
    await meter.sleep(300);
    const varValue = await meter.getValue();
    const parsedVar = meter.parseMeasurement(varValue);
    console.log('    Response:', varValue);
    console.log('    Parsed:', parsedVar);
    console.log('    ✓ Reactive power measurement:', parsedVar.type === 'VAR' ? 'OK' : 'FAIL');
    console.log();

    console.log('  6d: Switch to PWF (Power Factor)');
    await meter.setFunction('PWF');
    await meter.sleep(300);
    const pwfValue = await meter.getValue();
    const parsedPWF = meter.parseMeasurement(pwfValue);
    console.log('    Response:', pwfValue);
    console.log('    Parsed:', parsedPWF);
    console.log('    ✓ Power factor measurement:', parsedPWF.type === 'PF' ? 'OK' : 'FAIL');
    console.log();

    console.log('  6e: Switch back to WATT');
    await meter.setFunction('WATT');
    await meter.sleep(300);
    const wattValue = await meter.getValue();
    const parsedWatt = meter.parseMeasurement(wattValue);
    console.log('    Response:', wattValue);
    console.log('    Parsed:', parsedWatt);
    console.log('    ✓ Power measurement:', parsedWatt.type === 'W' ? 'OK' : 'FAIL');
    console.log();

    // Test 7: Parsing edge cases
    console.log('Test 7: Parser edge cases');

    // Test overflow value
    const overflowTest = meter.parseMeasurement('U1=0.01E+0 I1=0.0E-3 PF=overflow');
    console.log('  Overflow test:', overflowTest);
    console.log('  ✓ Handles overflow:', overflowTest.value === 'overflow' ? 'OK' : 'FAIL');

    // Test negative values
    const negativeTest = meter.parseMeasurement('U1=0.01E+0 I1=0.0E-3 W=-0.000E+0');
    console.log('  Negative test:', negativeTest);
    console.log('  ✓ Handles negative:', typeof negativeTest.value === 'number' ? 'OK' : 'FAIL');

    // Test various ranges
    const rangeTests = [
      'U1 I1 W=1.0E+0',
      'U2 I2 W=10.0E+0',
      'U3 I3 W=100.0E+0',
      'U1 Ix W=5.0E+0'
    ];

    for (const test of rangeTests) {
      const parsed = meter.parseMeasurement(test);
      console.log(`  Range test "${test}":`, parsed);
      console.log(`    ✓ Voltage range: ${parsed.voltageRange}, Current range: ${parsed.currentRange}`);
    }
    console.log();

    console.log('=== All Tests Complete ===\n');

    await meter.disconnect();

  } catch (error) {
    console.error('\n✗ Test Error:', error.message);
    await meter.disconnect();
    process.exit(1);
  }
}

/**
 * Continuous monitoring mode
 */
async function runContinuous() {
  const meter = new ISW8001();
  let lastMeasurementTime = null;

  try {
    await meter.connect();

    console.log('\n--- Continuous Monitoring Mode ---');
    console.log('Using MA1 automatic mode (~470ms between measurements)');
    console.log('Press Ctrl+C to stop\n');

    // Listen for measurement events
    meter.on('measurement', (parsed) => {
      lastMeasurementTime = displayMeasurement(parsed, lastMeasurementTime);
    });

    await meter.enableAutoMode();

    process.on('SIGINT', async () => {
      console.log('\n\nStopping...');
      await meter.disconnect();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    await meter.disconnect();
    process.exit(1);
  }
}

/**
 * Fast polling mode
 */
async function runFastPoll() {
  const meter = new ISW8001();
  let running = true;
  let lastMeasurementTime = null;

  try {
    await meter.connect();

    console.log('\n--- Fast Polling Mode ---');
    console.log('Requesting VAL? continuously as fast as possible');
    console.log('Press Ctrl+C to stop\n');

    process.on('SIGINT', async () => {
      console.log('\n\nStopping...');
      running = false;
      await meter.disconnect();
      process.exit(0);
    });

    // Poll as fast as possible
    while (running) {
      try {
        const response = await meter.getValue();
        const parsed = meter.parseMeasurement(response);

        if (parsed.value !== undefined) {
          lastMeasurementTime = displayMeasurement(parsed, lastMeasurementTime);
        }
      } catch (error) {
        console.error('Error reading value:', error.message);
      }
    }

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    await meter.disconnect();
    process.exit(1);
  }
}

/**
 * Custom command mode
 */
async function runCustomCommand(command) {
  const meter = new ISW8001();

  try {
    await meter.connect();

    console.log(`\n--- Custom Command: ${command} ---`);

    if (command.endsWith('?')) {
      const response = await meter.sendAndWait(command);
      console.log('Response:', response);

      // Try to parse if it looks like a measurement
      if (response.includes('=')) {
        const parsed = meter.parseMeasurement(response);
        console.log('Parsed:', parsed);
      }
    } else {
      meter.sendCommand(command);
      await meter.sleep(500);
      console.log('Command sent (no response expected)');
    }

    await meter.disconnect();

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    await meter.disconnect();
    process.exit(1);
  }
}

// Main entry point
if (require.main === module) {
  if (customCommand) {
    runCustomCommand(customCommand);
  } else if (continuous) {
    runContinuous();
  } else if (fastPoll) {
    runFastPoll();
  } else {
    runTests();
  }
}

module.exports = { runTests, runContinuous, runFastPoll, runCustomCommand };
