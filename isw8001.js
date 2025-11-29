/**
 * ISW 8001 Wattmeter Serial Communication Module
 *
 * Provides the ISW8001 class for communicating with the ISW 8001 digital wattmeter via RS232.
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');

// Configuration
const CONFIG = {
  path: process.env.ISW8001_PORT || '/dev/tty.usbserial-110',
  baudRate: 9600, // Can be 1200 or 9600
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  xon: true,
  xoff: true
};

// Lookup tables
const UNIT_MAP = {
  'W': 'W',
  'VAR': 'VAr',  // Device sends VAR (all caps)
  'PF': '',      // Power factor (dimensionless, can be "overflow")
  'DCV': 'V',
  'ACV': 'V',
  'DCA': 'A',
  'ACA': 'A'
};

const VOLTAGE_RANGES = {
  'U1': '50V',
  'U2': '150V',
  'U3': '500V'
};

const CURRENT_RANGES = {
  'I1': '160mA',
  'I2': '1.6A',
  'I3': '16A',
  'Ix': 'External'
};

class ISW8001 extends EventEmitter {
  constructor(config = CONFIG) {
    super();
    this.config = config;
    this.port = null;
    this.parser = null;
    this.responseQueue = [];
    this.waitingForResponse = false;
    this.autoModeEnabled = false;
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

      // Create line parser (commands end with CR)
      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r' }));

      // Handle incoming data
      this.parser.on('data', (line) => {
        // Remove XON/XOFF control characters and trim
        line = line.replace(/[\x11\x13]/g, '').trim();
        if (line.length > 0) {
          if (process.env.DEBUG) {
            console.log('←', line);
          }

          const parsed = this.parseMeasurement(line);

          // If in auto mode, emit measurement events
          if (this.autoModeEnabled && parsed.value !== undefined) {
            this.emit('measurement', parsed);
          }

          this.responseQueue.push(line);
        }
      });

      this.port.on('open', async () => {
        console.log(`✓ Connected to ${this.config.path} at ${this.config.baudRate} baud`);
        // Give device time to initialize after opening port
        await this.sleep(500);
        resolve();
      });

      this.port.on('error', (err) => {
        console.error('Serial port error:', err.message);
      });
    });
  }

  /**
   * Send command to device
   */
  sendCommand(command) {
    if (process.env.DEBUG) {
      console.log('→', command);
    }
    this.port.write(command + '\r');
  }

  /**
   * Send command and wait for response
   */
  async sendAndWait(command, timeoutMs = 1000) {
    this.responseQueue = [];
    this.sendCommand(command);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkResponse = () => {
        if (this.responseQueue.length > 0) {
          resolve(this.responseQueue[0]);
        } else if (Date.now() - startTime > timeoutMs) {
          reject(new Error('Timeout waiting for response'));
        } else {
          setTimeout(checkResponse, 50);
        }
      };

      checkResponse();
    });
  }

  /**
   * Get device identification
   * Returns object with name and version
   */
  async identify() {
    let name = 'ISW8001';
    let version = null;
    try {
      name = await this.sendAndWait('*IDN?');
      version = await this.sendAndWait('VERSION?');
    } catch (e) {
      // Use defaults
    }
    return { name, version };
  }

  /**
   * Get current measurement value
   */
  async getValue() {
    return await this.sendAndWait('VAL?');
  }

  /**
   * Get status and value
   */
  async getStatusAndValue() {
    return await this.sendAndWait('VAS?');
  }

  /**
   * Get device status
   */
  async getStatus() {
    return await this.sendAndWait('STATUS?');
  }

  /**
   * Set measurement function
   * Note: PF (power factor) mode cannot be activated via serial command, only via front panel button
   */
  async setFunction(func) {
    const validFunctions = ['WATT', 'VAR', 'VOLT', 'AMP'];
    if (!validFunctions.includes(func.toUpperCase())) {
      throw new Error(`Invalid function. Must be one of: ${validFunctions.join(', ')}`);
    }
    this.sendCommand(func.toUpperCase());
    await this.sleep(200); // Give device time to switch
  }

  /**
   * Enable automatic measurement mode (continuous output)
   */
  async enableAutoMode() {
    this.autoModeEnabled = true;
    this.sendCommand('MA1');
    await this.sleep(100); // Give device time to start
    console.log('✓ Automatic measurement mode enabled');
  }

  /**
   * Disable automatic measurement mode
   */
  async disableAutoMode() {
    this.autoModeEnabled = false;
    this.sendCommand('MA0');
    await this.sleep(100); // Give device time to stop
    console.log('✓ Automatic measurement mode disabled');
  }

  /**
   * Enable auto-range selection
   */
  async enableAutoRange() {
    this.sendCommand('AUTORANGE');
    await this.sleep(100);
  }

  /**
   * Disable auto-range selection (manual mode)
   */
  async disableAutoRange() {
    this.sendCommand('MANUAL');
    await this.sleep(100);
  }

  /**
   * Set voltage range
   * @param {number} range - Range number (1, 2, or 3)
   */
  async setVoltageRange(range) {
    if (![1, 2, 3].includes(range)) {
      throw new Error('Invalid voltage range. Must be 1 (50V), 2 (150V), or 3 (500V)');
    }
    this.sendCommand(`SET:U${range}`);
    await this.sleep(100);
  }

  /**
   * Set current range
   * @param {number} range - Range number (1, 2, or 3)
   */
  async setCurrentRange(range) {
    if (![1, 2, 3].includes(range)) {
      throw new Error('Invalid current range. Must be 1 (160mA), 2 (1.6A), or 3 (16A)');
    }
    this.sendCommand(`SET:I${range}`);
    await this.sleep(100);
  }

  /**
   * Parse measurement response
   * Format: U1=0.01E+0 I1=0.0E-3   W=-0.000E+0
   * or: U3 I1 W=200.0E+0 (when using VAS? command)
   */
  parseMeasurement(response) {
    const parts = response.trim().split(/\s+/);
    const result = {};

    for (const part of parts) {
      if (part.includes('=')) {
        const [type, value] = part.split('=');

        // For measurement function (W, VAR, PF, etc)
        if (type in UNIT_MAP) {
          result.type = type;
          const numValue = parseFloat(value);
          // Handle special values like "overflow"
          result.value = isNaN(numValue) ? value : numValue;
          result.unit = UNIT_MAP[type];
        }
        // For voltage/current values like U1=value or I1=value
        else if (type.startsWith('U') && type.length >= 2) {
          const rangeKey = type.substring(0, 2); // Extract U1, U2, U3
          result.voltageRange = VOLTAGE_RANGES[rangeKey] || type;
          result.voltage = parseFloat(value);
        } else if (type.startsWith('I') && type.length >= 2) {
          const rangeKey = type.substring(0, 2); // Extract I1, I2, I3, Ix
          result.currentRange = CURRENT_RANGES[rangeKey] || type;
          result.current = parseFloat(value);
        }
      } else if (part.startsWith('U')) {
        result.voltageRange = VOLTAGE_RANGES[part] || part;
      } else if (part.startsWith('I')) {
        result.currentRange = CURRENT_RANGES[part] || part;
      }
    }

    return result;
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

module.exports = ISW8001;
