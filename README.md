# ISW8001 Wattmeter Power Profiling

Node.js tools for the IeS ISW8001 digital wattmeter that make it easy to:
- Monitor power consumption in real-time via a web interface
- Export power profiles to the [Firefox Profiler](https://profiler.firefox.com) for detailed analysis
- Control the device and run measurements via command line

The web interface continuously samples power data and displays live charts with statistics. Power profiles can be exported in Firefox Profiler format, allowing you to correlate power consumption with system activity and performance measurements.

## Hardware Requirements

- IeS ISW8001 Wattmeter (manufactured by Instruments Et Systemes)
- USB-to-Serial adapter

## Installation

```bash
npm install
```

## Configuration

The serial port can be configured via environment variable:

```bash
export ISW8001_PORT=/dev/tty.usbserial-110
```

Default port is `/dev/tty.usbserial-110`.

To find your serial port on macOS:
```bash
ls /dev/tty.*
```

### Baud Rate

The device supports 1200 or 9600 baud. The configured baud rate is displayed briefly when you power on the device. The default is 9600.

**To change the baud rate on the device:**
1. Turn off the device
2. Press and hold the **PF** button
3. Turn on the device while holding the button
4. Keep holding until the device enters normal mode
5. The new baud rate is now saved

After changing the device baud rate, update the `baudRate` value in the CONFIG section of `isw8001.js` if needed.

To change the web server port:
```bash
export PORT=2122  # Default is 2122
```

To enable debug logging (shows all serial commands and responses):
```bash
export DEBUG=1
node wattmeter-server.js  # or any other script
```

## Usage

### Web Server Mode (Power Profiling)

Start the web server to continuously collect power data and visualize it in a browser:

```bash
node wattmeter-server.js
```

Then open http://localhost:2122/ in your browser to see:
- Real-time power monitoring with live charts
- Statistics (current, average, peak power, total energy)
- Voltage, current, and power measurements with range information
- Export to Firefox Profiler format for detailed analysis
- CSV export functionality

### Testing and Command Line Usage

Run comprehensive tests that exercise all ISW8001 methods:
```bash
npm test
# or
node test-isw8001.js
```

Continuous monitoring mode (~470ms interval):
```bash
npm run test:continuous
# or
node test-isw8001.js --continuous
```

Fast polling mode:
```bash
npm run test:fast
# or
node test-isw8001.js --fast
```

Send custom command:
```bash
node test-isw8001.js --command "VOLT"     # Switch to voltage measurement
node test-isw8001.js --command "WATT"     # Switch to power measurement
node test-isw8001.js --command "STATUS?"  # Get device status
node test-isw8001.js --command "VAL?"     # Get current value
```

Press Ctrl+C to stop continuous or fast modes.

## Available Commands

Based on the ISW8001 documentation:

### Function Selection
- `WATT` - Measure real power
- `VAR` - Measure reactive power
- `VOLT` - Measure voltage
- `AMP` - Measure current
- `PWF` - Measure power factor (PF mode)
  - **Note**: The manual documents a `COS` command, but it doesn't work. Use `PWF` instead.

### Range Selection (Manual Mode)
- `SET:U1` - Voltage range 50V
- `SET:U2` - Voltage range 150V
- `SET:U3` - Voltage range 500V
- `SET:I1` - Current range 160mA
- `SET:I2` - Current range 1.6A
- `SET:I3` - Current range 16A
- `MANUAL` - Manual range switching
- `AUTORANGE` - Automatic range switching

### Query Commands
- `*IDN?` - Device identification
- `VERSION?` - Firmware version
- `STATUS?` - Current status (function and ranges)
- `VAL?` - Current measurement value (same output as `VAS?` in practice)
- `VAS?` - Status + value

### Modes
- `MA1` - Enable automatic measurement output
- `MA0` - Disable automatic measurement output

### Other
- `BEEP` - Execute a beep
- `BEEP1` - Enable beeper
- `BEEP0` - Disable beeper
- `FAV0` - Lock front panel
- `FAV1` - Unlock front panel

## Response Format

**IMPORTANT: Actual Protocol Differences from Manual**

The ISW8001's actual protocol differs significantly from what's documented in the manual:

1. **Command Terminator**: Manual states CR is `0x13`, but the device actually uses standard CR (`0x0D`)
2. **Flow Control Characters**: Device embeds XON (`0x11`) and XOFF (`0x13`) characters in response data - these must be filtered out
3. **Response Format**: Manual shows `U3 I1 W=200.0E+0`, but device actually sends `U1=0.01E+0 I1=0.0E-3 W=-0.000E+0` with `=` signs for ALL values (voltage, current, and power)
4. **Unit Names**: Device sends `VAR` (all caps) for reactive power, not `VAr` as documented. Power factor uses `PF`, not `COS`
5. **Power Factor Command**: Manual documents `COS` command to switch to power factor mode, but it doesn't work. Use `PWF` instead
6. **Special Values**: Power factor can return `overflow` as a text value, not just numbers
7. **Data Transmission**: Device sends data one byte at a time, requiring proper buffering

### Measurement Response (Actual Format)
```
U1=0.01E+0 I1=0.0E-3 W=-0.000E+0
```
- `U1=0.01E+0` - Voltage range and value (U1=50V, U2=150V, U3=500V)
- `I1=0.0E-3` - Current range and value (I1=160mA, I2=1.6A, I3=16A, Ix=external clamp)
- `W=-0.000E+0` - Measurement type and value
  - Types: `W` (Watts), `VAR` (VoltAmps Reactive), `PF` (power factor, can be "overflow"), `DCV`/`ACV` (DC/AC Volts), `DCA`/`ACA` (DC/AC Amps)

### Status Response
```
WATT U1 I2
```
- Function: `WATT`, `VAR`, `VOLT`, `AMP`, `PF`
- Voltage range: `U1`, `U2`, `U3`
- Current range: `I1`, `I2`, `I3`, `Ix`

## Example Output

### Single Measurement
With `DEBUG=1` to show serial communication:
```
✓ Connected to /dev/tty.usbserial-110 at 9600 baud
→ *IDN?
← IeS type ISW8001A
→ VERSION?
← version 1.04
→ STATUS?
← WATT U3 I1
→ VAL?
← U3=238.5E+0 I1=0.3E-3   W=0.02E+0
```

### Continuous Monitoring (--continuous)
Shows timestamp and time delta (Δt) between measurements (~470ms):
```
✓ Automatic measurement mode enabled
[12:34:56.123] Δt=470ms | W=261.4 W | Range: 500V, 160mA
[12:34:56.593] Δt=470ms | W=262.1 W | Range: 500V, 160mA
```

### Fast Polling (--fast)
Polls by sending VAL? commands as fast as possible:
```
✓ Fast polling mode enabled
[12:34:56.100] Δt=520ms | W=22.5 W | Range: 500V, 160mA
[12:34:56.620] Δt=520ms | W=24.6 W | Range: 500V, 160mA
```

Note: Fast polling is not actually faster than continuous mode (MA1), as the device takes time to respond to each query.

## Technical Details

- **Protocol**: RS232, 3-wire (RxD, TxD, GND)
- **Flow Control**: Xon-Xoff (software) - XON/XOFF characters are embedded in data and must be filtered
- **Data Format**: 8 bits, no parity, 1 stop bit
- **Command Terminator**: Carriage Return (CR, 0x0D) - Note: Manual incorrectly states 0x13
- **Commands**: Case insensitive
- **Response Parsing**: Must filter XON (0x11) and XOFF (0x13) from all responses
- **Sampling Rate**: MA1 automatic mode provides ~470ms between measurements
- **Frequency Range**: DC, 20Hz-1kHz (power: DC, 20Hz-400Hz)
- **Max Voltage**: 500V
- **Max Current**: 16A (internal shunt) or 30A/300A (external clamp)

## Documentation

The full manual (French) can be downloaded from:
https://web.archive.org/web/20081113070441if_/http://www.instruments-systemes.fr/telechargement/NOTICE/NOT-ISW8001.DOC
