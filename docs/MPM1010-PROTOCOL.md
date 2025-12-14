# MPM-1010 Series Power Meter - Communication Protocol

Technical reference for the MPM-1010 power meter communication protocol.

## Hardware

- **Device**: MPM-1010 Series Power Meter
- **Interface**: RS232 via USB-to-Serial adapter (appears as `/dev/tty.usbserial-*`)
- **Measurements**: AC Voltage, Current, Power, Power Factor, Frequency (all simultaneous)

## Serial Configuration

- **Baud Rate**: 9600
- **Data Bits**: 8
- **Parity**: None
- **Stop Bits**: 1
- **Flow Control**: None (do NOT enable XON/XOFF)

## Protocol

### Request/Response

**Request:** `?` (ASCII 0x3F)
**Response:** `!` (ASCII 0x21) + 20 bytes of measurement data

The device uses pure request/response - each `?` triggers one measurement response. No automatic mode.

### Response Format (21 bytes total)

```
Byte 0:      0x21 ('!') - frame delimiter
Bytes 1-4:   Voltage (4 bytes)
Bytes 5-8:   Current (4 bytes)
Bytes 9-12:  Power (4 bytes)
Bytes 13-16: Power Factor (4 bytes)
Bytes 17-20: Frequency (4 bytes)
```

### Data Encoding

Each byte encodes one decimal digit with optional decimal point:
- **Low nibble (bits 0-3)**: Digit value (0-9)
- **High nibble**: If `1`, decimal point follows this digit

**Examples:**

```
0x02 = '2'     (no decimal point)
0x12 = '2.'    (decimal point after 2)
0x10 = '0.'    (decimal point after 0)
```

**Voltage = 242.3V:**
```
0x02 0x04 0x12 0x03 → "2" "4" "2." "3" → 242.3
```

**Current = 0.005A:**
```
0x10 0x00 0x00 0x05 → "0." "0" "0" "5" → 0.005
```

**Power Factor = 1.000:**
```
0x11 0x00 0x00 0x00 → "1." "0" "0" "0" → 1.000
```

### Decoding Algorithm

For each byte: extract digit from low nibble (bits 0-3), check if high nibble is 1 (add decimal point after digit).

## Frame Synchronization

### The '!' Character as Frame Delimiter

The `!` character marks the start of a measurement. If you send `?` while the device is transmitting, it **immediately interrupts** and starts a new measurement with `!`.

**Interrupted transmission example:**
```
Request 1: "?"
Response 1: 21 02 04 12 03 10 00 00 05 00 11 00 09...
            !  V=242.3V    I=0.005A      P=01.09W...
Request 2: "?" (sent after 13 bytes)
Response 2: 21 02 04 12 03...
            !  V=242.3V (new measurement, response 1 interrupted)
```

### Handling Interruptions

Always search for `!` characters to find measurement boundaries. Look for the next `!` to detect if a measurement was interrupted.

## Performance Characteristics

### Serial Communication Rate

- **Complete measurements (21 bytes)**: ~30-35 Hz achievable
- **Interrupt-after-power (13 bytes)**: ~45-55 Hz achievable (50 Hz typical)
- **Theoretical maximum (13 bytes)**: 52-58 Hz (13 bytes at 9600 baud + turnaround)

### Internal Measurement Update Rates

The device updates measurements at different rates regardless of serial polling speed:

- **Voltage, Current, Power, Power Factor**: ~4 Hz (250ms intervals = 12.5 AC cycles @ 50Hz)
- **Frequency**: ~2.5 Hz (400ms intervals = 20 AC cycles @ 50Hz)

**Implication:** Polling faster than 10-20 Hz produces many duplicate readings.

**Polling strategies:** 50ms (20 Hz) for low latency profiling with ~5x duplicates, or 250ms (4 Hz) to match internal update rate with minimal duplicates.

**Interrupt-after-power:** Request next sample after receiving power value (13 bytes) for maximum speed (~50 Hz), but PF/frequency often interrupted.

## Implementation Notes

**Critical:**
- Disable flow control - Bytes 0x11 and 0x13 are valid data, not XON/XOFF
- Search for `!` delimiters - Don't assume fixed 21-byte packets
- Handle partial measurements - Accept V/I/W only (13 bytes) when interrupted
- Timestamp when `!` arrives, not when measurement completes

**Frame misalignment error:** If you don't detect `!` delimiters, you may parse bytes spanning two measurements. Example: `...11 00 09 21 02 04 12 03...` where `21` is `!` starting a new measurement with voltage 242.3V. Parsing `21 02 04 12` as power gives "1242." = 1242W (bogus for typical loads). Always detect `!` to split measurements.
