# ISW8001 Wattmeter - Communication Protocol

Technical reference for the IeS ISW8001 digital wattmeter serial communication protocol.

The [official manual](https://web.archive.org/web/20081113070441if_/http://www.instruments-systemes.fr/telechargement/NOTICE/NOT-ISW8001.DOC) (French) contains several errors:
- Command terminator stated as 0x13, actually 0x0D
- Response format shows only ranges before measurement (e.g., `U3 I1 W=200.0E+0`), but device actually sends voltage and current values (e.g., `U3=238.5E+0 I1=0.3E-3 W=0.02E+0`)
- COS command for power factor doesn't work, use `PWF` instead
- XON/XOFF (0x11, 0x13) embedded in data not documented

## Hardware

- **Device**: IeS ISW8001A Digital Wattmeter
- **Manufacturer**: Instruments Et Systemes (France)
- **Interface**: RS232 via USB-to-Serial adapter
- **Measurements**: Voltage, Current, Real Power, Reactive Power, Power Factor (one at a time)

## Serial Configuration

- **Baud Rate**: 9600 or 1200 (configurable on device, default 9600)
- **Data Bits**: 8
- **Parity**: None
- **Stop Bits**: 1
- **Flow Control**: Xon-Xoff (software)
- **Command Terminator**: CR (0x0D)

### Changing Device Baud Rate

1. Turn off device
2. Press and hold **PF** button
3. Turn on device while holding button
4. Keep holding until device enters normal mode
5. New baud rate is saved

The configured baud rate is displayed briefly on power-on.

## Commands

Commands are case insensitive, terminated with CR (0x0D).

### Function Selection

- `WATT` - Measure real power (W)
- `VAR` - Measure reactive power (VAR)
- `VOLT` - Measure voltage (V)
- `AMP` - Measure current (A)
- `PWF` - Measure power factor (PF)

### Range Selection

**Manual mode:**
- `SET:U1` - Voltage range 50V
- `SET:U2` - Voltage range 150V
- `SET:U3` - Voltage range 500V
- `SET:I1` - Current range 160mA
- `SET:I2` - Current range 1.6A
- `SET:I3` - Current range 16A

**Range mode control:**
- `MANUAL` - Manual range switching
- `AUTORANGE` - Automatic range switching

### Query Commands

- `*IDN?` - Device identification
- `VERSION?` - Firmware version
- `STATUS?` - Current status (function and ranges)
- `VAS?` - Status + value
- `VAL?` - Current measurement value (same as VAS? in practice)

### Measurement Modes

- `MA1` - Enable automatic measurement output (~470ms interval)
- `MA0` - Disable automatic measurement output

### Other Commands

- `BEEP` - Execute a beep
- `BEEP1` - Enable beeper
- `BEEP0` - Disable beeper
- `FAV0` - Lock front panel
- `FAV1` - Unlock front panel

## Response Formats

### Measurement Response

```
U3=238.5E+0 I1=0.3E-3 W=0.02E+0
```

**Format:**
- `U1/U2/U3=<value>E<exp>` - Voltage range and value (50V/150V/500V)
- `I1/I2/I3/Ix=<value>E<exp>` - Current range and value (160mA/1.6A/16A/external)
- `W/VAR/PF/DCV/ACV/DCA/ACA=<value>E<exp>` - Measurement type and value

Values are in scientific notation with spaces as separators.

**Special case:** Power factor can return `PF=overflow` (text, not numeric) when unmeasurable.

### Status Response

```
WATT U1 I2
```

Format: `<function> <voltage_range> <current_range>`

### Identification Response

```
*IDN?
IeS type ISW8001A
```

### Version Response

```
VERSION?
version 1.04
```

## Implementation Notes

**Critical:** The device embeds XON (0x11) and XOFF (0x13) in response data - filter these bytes before parsing. The device transmits one byte at a time, requiring buffering.

Measurements follow: `<RANGE>=<VALUE>E<EXPONENT>` (e.g., `U3=238.5E+0`). Values are in scientific notation, space-separated.

## Performance

**Automatic mode (MA1):** ~2.1 Hz (470ms interval)

Polling faster using `VAL?` does not increase measurement frequency - the device only generates new measurements every 470ms.
