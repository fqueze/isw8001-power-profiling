/**
 * MPM-1010 Series Power Meter Serial Communication Module
 *
 * Provides the MPM1010 class for communicating with MPM-1010 series power meters via RS232.
 *
 * Protocol:
 * 1. Send "?" to device
 * 2. Device responds with "!"
 * 3. Device sends 21 bytes of measurement data
 *
 * Data format: 5 measurements × 4 bytes each + 1 byte = 21 bytes
 * - Voltage (V): 4 bytes BCD, format XX.XXV
 * - Current (mA): 4 bytes BCD, format XXX.XmA
 * - Power (W): 4 bytes BCD, format XX.XXW
 * - Power Factor: 4 bytes BCD, format X.XXXPf
 * - Frequency (Hz): 4 bytes BCD, format XX.XXHz
 */

const { SerialPort } = require('serialport');
const EventEmitter = require('events');

// Configuration
const CONFIG = {
  path: process.env.MPM1010_PORT || process.env.ISW8001_PORT || '/dev/tty.usbserial-110',
  baudRate: 9600,
  dataBits: 8,
  parity: 'none',
  stopBits: 1
};

class MPM1010 extends EventEmitter {
  constructor(config = CONFIG) {
    super();
    this.config = config;
    this.port = null;
    this.buffer = Buffer.alloc(0);
    this.autoModeEnabled = false;
    this.pollInterval = null;
    this.fallbackTimer = null;
    this.nextRequestScheduled = false;
    this.delayedRequestScheduled = false;
    this.currentMeasurementTime = null;
    this.minInterval = 0;
    this.lastRequestTime = 0;
  }

  /**
   * Open serial port connection
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort(this.config, (err) => {
        if (err) {
          reject(new Error(`Failed to open port: ${err.message}`));
          return;
        }
      });

      // Handle incoming data
      this.port.on('data', (data) => {
        const now = Date.now();

        if (process.env.DEBUG) {
          console.log('← Raw:', data.toString('hex'));
        }

        // If this chunk contains a '!' and we don't have a timestamp yet, record it
        if (data.indexOf(0x21) >= 0 && !this.currentMeasurementTime) {
          this.currentMeasurementTime = now;
        }

        // Emit timing event for data received
        this.emit('debug-timing', {
          type: 'data-received',
          timestamp: now,
          bytes: data.length,
          data: data.toString('hex')
        });

        // Accumulate data in buffer
        this.buffer = Buffer.concat([this.buffer, data]);

        // Check if we have a complete message
        this.processBuffer();
      });

      this.port.on('open', async () => {
        console.log(`✓ Connected to ${this.config.path} at ${this.config.baudRate} baud`);
        // Give device time to initialize
        await this.sleep(500);
        resolve();
      });

      this.port.on('error', (err) => {
        console.error('Serial port error:', err.message);
      });
    });
  }

  /**
   * Process incoming data buffer
   */
  processBuffer() {
    // Look for "!" acknowledgment
    const ackIndex = this.buffer.indexOf(0x21); // '!' = 0x21

    if (ackIndex >= 0) {
      // Send next request once we have power value (13 bytes: '!' + 4 voltage + 4 current + 4 power)
      // This will interrupt the current measurement, but we'll get fresh data faster
      if (this.autoModeEnabled && !this.nextRequestScheduled && this.buffer.length >= ackIndex + 13) {
        // Check if enough time has passed since last request
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        if (timeSinceLastRequest >= this.minInterval) {
          // Clear any pending fallback timer
          if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
            this.fallbackTimer = null;
          }
          // Send next request immediately (will interrupt PF/frequency transmission)
          this.nextRequestScheduled = true;
          this.requestMeasurement();
        } else if (this.minInterval > 0 && !this.delayedRequestScheduled) {
          // Schedule request for when minimum interval is met
          const delay = this.minInterval - timeSinceLastRequest;
          if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
          }
          this.delayedRequestScheduled = true;
          this.fallbackTimer = setTimeout(() => {
            if (this.autoModeEnabled) {
              this.delayedRequestScheduled = false;
              this.requestMeasurement();
            }
          }, delay);
        }
      }

      // Look for the NEXT '!' to know where this measurement ends
      // (It might be interrupted by a new measurement starting)
      const nextAckIndex = this.buffer.indexOf(0x21, ackIndex + 1);

      let measurementEndIndex;
      if (nextAckIndex >= 0) {
        // Found next '!' - current measurement was interrupted
        measurementEndIndex = nextAckIndex;
      } else if (this.buffer.length >= ackIndex + 21) {
        // No interruption, have full 21 bytes
        measurementEndIndex = ackIndex + 21;
      } else {
        // Not enough data yet, wait for more
        return;
      }

      // Use the timestamp when '!' arrived, not when we finished processing
      const measurementTimestamp = this.currentMeasurementTime || Date.now();
      const measurementLength = measurementEndIndex - ackIndex - 1; // -1 to skip '!'
      const measurementData = this.buffer.slice(ackIndex + 1, measurementEndIndex);

      if (process.env.DEBUG) {
        console.log(`← Measurement data (${measurementLength} bytes):`, measurementData.toString('hex'));
      }

      // Parse what we have (will handle partial data gracefully)
      const parsed = this.parseMeasurement(measurementData);

      // Emit timing event
      this.emit('debug-timing', {
        type: 'measurement-complete',
        timestamp: measurementTimestamp,
        partial: measurementLength < 20
      });

      if (this.autoModeEnabled && parsed.voltage !== undefined) {
        this.emit('measurement', parsed);
      }

      // Remove processed data from buffer (up to start of next measurement or end of complete one)
      this.buffer = this.buffer.slice(measurementEndIndex);

      // Reset timestamp and flag for next measurement
      this.currentMeasurementTime = null;
      this.nextRequestScheduled = false;

      // If there's more data, process it immediately (might have the next '!' already)
      if (this.buffer.length > 0) {
        setImmediate(() => this.processBuffer());
      }
    }
  }

  /**
   * Request a measurement
   */
  requestMeasurement() {
    const now = Date.now();
    this.lastRequestTime = now;

    if (process.env.DEBUG) {
      console.log('→ ?');
    }
    this.port.write('?');

    // Emit timing event for debugging
    this.emit('debug-timing', {
      type: 'request-sent',
      timestamp: now
    });

    // Always set fallback timer in case we don't get a response
    if (this.autoModeEnabled) {
      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
      }
      // Use max of 100ms or minInterval + 50ms as fallback timeout
      const fallbackTimeout = Math.max(100, this.minInterval + 50);
      this.fallbackTimer = setTimeout(() => {
        if (this.autoModeEnabled) {
          if (process.env.DEBUG) {
            console.log('⚠ Fallback timer triggered - no response received');
          }
          this.requestMeasurement();
        }
      }, fallbackTimeout);
    }
  }

  /**
   * Get a single measurement
   */
  async getMeasurement() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for measurement'));
      }, 2000);

      // Set up one-time listener
      const onData = (parsed) => {
        clearTimeout(timeout);
        this.removeListener('measurement', onData);
        resolve(parsed);
      };

      this.emit('measurement', onData);

      // Temporarily enable auto mode for this measurement
      const wasAutoMode = this.autoModeEnabled;
      this.autoModeEnabled = true;

      this.requestMeasurement();

      // Wait for response
      setTimeout(() => {
        this.autoModeEnabled = wasAutoMode;
      }, 1500);
    });
  }

  /**
   * Parse measurement data (up to 20 bytes, may be partial)
   * Format: 5 measurements × 4 bytes each
   *
   * Encoding: Each byte encodes one digit:
   * - Low nibble (bits 0-3): digit value (0-9)
   * - High nibble bit 4: if set, decimal point follows this digit
   *
   * Partial measurements are acceptable - we prioritize fresh power data
   * over complete but stale measurements
   */
  parseMeasurement(data) {
    if (data.length < 12) {
      // Need at least voltage + current + power (12 bytes)
      return {};
    }

    const result = {
      voltage: this.decodeDigits(data.slice(0, 4)),
      current: this.decodeDigits(data.slice(4, 8)),
      power: this.decodeDigits(data.slice(8, 12)),
      powerFactor: data.length >= 16 ? this.decodeDigits(data.slice(12, 16)) : undefined,
      frequency: data.length >= 20 ? this.decodeDigits(data.slice(16, 20)) : undefined
    };

    return result;
  }

  /**
   * Decode 4 bytes into a decimal number
   * Each byte: low nibble = digit, high nibble bit 4 set = decimal point after
   * @param {Buffer} bytes - 4 bytes to decode
   * @returns {number} Decoded value
   */
  decodeDigits(bytes) {
    let result = '';

    for (let i = 0; i < bytes.length; i++) {
      const lowNibble = bytes[i] & 0x0F;
      const highNibble = (bytes[i] >> 4) & 0x0F;

      // Add the digit
      result += lowNibble.toString();

      // Check if decimal point follows (bit 4 set means high nibble has value 1)
      if (highNibble === 1) {
        result += '.';
      }
    }

    return parseFloat(result);
  }

  /**
   * Enable continuous measurement mode
   * Strategy: Request next sample immediately after receiving power value
   * This interrupts PF/frequency transmission but ensures fresh power data
   * Falls back to 100ms timeout if no response received
   * @param {number} intervalMs - Minimum interval between requests in ms (default: immediate after power)
   */
  async enableAutoMode(intervalMs = 0) {
    this.autoModeEnabled = true;
    this.minInterval = intervalMs;
    this.lastRequestTime = 0;

    // Send the first request to kick off the request/response cycle
    this.requestMeasurement();

    if (intervalMs > 0) {
      console.log(`✓ Automatic measurement mode enabled (${intervalMs}ms minimum interval)`);
    } else {
      console.log(`✓ Automatic measurement mode enabled (interrupts after V/I/W for maximum freshness)`);
    }
  }

  /**
   * Disable continuous measurement mode
   */
  async disableAutoMode() {
    this.autoModeEnabled = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    console.log('✓ Automatic measurement mode disabled');
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close connection
   */
  async disconnect() {
    if (this.port && this.port.isOpen) {
      // Disable auto mode if enabled
      if (this.autoModeEnabled) {
        await this.disableAutoMode();
      }

      await new Promise((resolve) => {
        this.port.close(() => {
          console.log('✓ Disconnected');
          resolve();
        });
      });
    }
  }
}

module.exports = MPM1010;
