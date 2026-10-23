// Functional models of common modules for the local simulators. They reproduce what firmware
// observes (I²C registers, display RAM, single-wire bit timing), not analog electrical behavior.

export interface I2CDevice {
  readonly address: number;
  start(write: boolean): void;
  write(byte: number): boolean;
  read(): number;
  stop(): void;
}

// Routes master transactions to the device answering the address; absent addresses NACK.
export class I2CBus {
  private active: I2CDevice | null = null;
  constructor(readonly devices: I2CDevice[]) {}
  connect(address: number, write: boolean) {
    const device = this.devices.find((d) => d.address === address) ?? null;
    if (this.active && this.active !== device) this.active.stop();
    this.active = device;
    device?.start(write);
    return !!device;
  }
  write(byte: number) {
    return this.active ? this.active.write(byte & 0xff) : false;
  }
  read() {
    return this.active ? this.active.read() & 0xff : 0xff;
  }
  stop() {
    this.active?.stop();
    this.active = null;
  }
}

const finite = (value: unknown, min: number, max: number, name: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} 必須介於 ${min} 與 ${max}`);
  return value;
};

export interface MotionValues {
  ax: number; // g
  ay: number;
  az: number;
  gx: number; // °/s
  gy: number;
  gz: number;
  temperature: number; // °C
}
const motionLimits: Record<keyof MotionValues, [number, number]> = {
  ax: [-16, 16],
  ay: [-16, 16],
  az: [-16, 16],
  gx: [-2000, 2000],
  gy: [-2000, 2000],
  gz: [-2000, 2000],
  temperature: [-40, 85],
};

// MPU6050 register model: identity, power management, full-scale ranges and sensor data.
export class Mpu6050 implements I2CDevice {
  readonly registers = new Uint8Array(128);
  values: MotionValues = { ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, temperature: 25 };
  private pointer = 0;
  private expectPointer = false;
  constructor(
    readonly id: string,
    readonly address = 0x68,
  ) {
    this.reset();
  }
  private reset() {
    this.registers.fill(0);
    this.registers[0x6b] = 0x40; // sleep after power-up
    this.registers[0x75] = 0x68; // WHO_AM_I
  }
  set(values: Partial<Record<keyof MotionValues, unknown>>) {
    const next = { ...this.values };
    for (const [key, value] of Object.entries(values)) {
      const limits = motionLimits[key as keyof MotionValues];
      if (!limits) throw new Error('MPU6050 沒有此輸入：' + key);
      next[key as keyof MotionValues] = finite(value, limits[0], limits[1], key);
    }
    this.values = next;
  }
  start(write: boolean) {
    this.expectPointer = write;
  }
  write(byte: number) {
    if (this.expectPointer) {
      this.pointer = byte & 0x7f;
      this.expectPointer = false;
      return true;
    }
    if (this.pointer === 0x6b && byte & 0x80) this.reset();
    else if (!(this.pointer >= 0x3b && this.pointer <= 0x60) && this.pointer !== 0x75)
      this.registers[this.pointer] = byte;
    this.pointer = (this.pointer + 1) & 0x7f;
    return true;
  }
  read() {
    const value = this.register(this.pointer);
    this.pointer = (this.pointer + 1) & 0x7f;
    return value;
  }
  stop() {}
  state() {
    return {
      kind: 'mpu6050' as const,
      values: this.values,
      awake: !(this.registers[0x6b] & 0x40),
    };
  }
  private register(index: number) {
    if (index < 0x3b || index > 0x48) return this.registers[index];
    if (this.registers[0x6b] & 0x40) return 0; // sleeping: no new samples
    const accel = 16384 >> ((this.registers[0x1c] >> 3) & 3);
    const gyro = [131, 65.5, 32.8, 16.4][(this.registers[0x1b] >> 3) & 3];
    const v = this.values;
    const words = [
      v.ax * accel,
      v.ay * accel,
      v.az * accel,
      (v.temperature - 36.53) * 340,
      v.gx * gyro,
      v.gy * gyro,
      v.gz * gyro,
    ].map((n) => Math.max(-32768, Math.min(32767, Math.round(n))) & 0xffff);
    const word = words[(index - 0x3b) >> 1];
    return (index - 0x3b) % 2 ? word & 0xff : word >> 8;
  }
}

const SSD1306_ARGS: Record<number, number> = {
  0x20: 1,
  0x21: 2,
  0x22: 2,
  0x26: 6,
  0x27: 6,
  0x29: 5,
  0x2a: 5,
  0x81: 1,
  0x8d: 1,
  0xa3: 2,
  0xa8: 1,
  0xd3: 1,
  0xd5: 1,
  0xd9: 1,
  0xda: 1,
  0xdb: 1,
};

// SSD1306 128×64 over I²C: control bytes, the command set used by Adafruit SSD1306 and U8g2,
// horizontal / vertical / page addressing and orientation.
export class Ssd1306 implements I2CDevice {
  readonly ram = new Uint8Array(1024); // 8 pages × 128 columns, LSB = top row of a page
  on = false;
  inverted = false;
  entireOn = false;
  segmentRemap = false;
  comReverse = false;
  startLine = 0;
  contrast = 0x7f;
  version = 0;
  private mode = 2;
  private columnStart = 0;
  private columnEnd = 127;
  private pageStart = 0;
  private pageEnd = 7;
  private column = 0;
  private page = 0;
  private control: 'control' | 'command' | 'data' = 'control';
  private single = false;
  private pending: number[] = [];
  constructor(
    readonly id: string,
    readonly address = 0x3c,
  ) {}
  start() {
    this.control = 'control';
  }
  write(byte: number) {
    if (this.control === 'control') {
      this.single = !!(byte & 0x80);
      this.control = byte & 0x40 ? 'data' : 'command';
      return true;
    }
    if (this.control === 'data') this.data(byte);
    else this.command(byte);
    if (this.single) this.control = 'control';
    return true;
  }
  read() {
    return this.on ? 0x00 : 0x40; // status byte: bit 6 = display off
  }
  stop() {
    this.control = 'control';
  }
  private data(byte: number) {
    this.ram[this.page * 128 + this.column] = byte;
    this.version++;
    if (this.mode === 0) {
      if (++this.column > this.columnEnd) {
        this.column = this.columnStart;
        if (++this.page > this.pageEnd) this.page = this.pageStart;
      }
    } else if (this.mode === 1) {
      if (++this.page > this.pageEnd) {
        this.page = this.pageStart;
        if (++this.column > this.columnEnd) this.column = this.columnStart;
      }
    } else this.column = (this.column + 1) & 0x7f;
  }
  // Multi-byte commands may be split across transactions; pending arguments persist.
  private command(byte: number) {
    if (this.pending.length) {
      this.pending.push(byte);
      if (this.pending.length > SSD1306_ARGS[this.pending[0]]) {
        this.apply(this.pending[0], this.pending.slice(1));
        this.pending = [];
      }
      return;
    }
    if (SSD1306_ARGS[byte]) this.pending = [byte];
    else this.apply(byte, []);
  }
  private apply(op: number, args: number[]) {
    const before = this.version;
    if (op === 0xae || op === 0xaf) this.on = op === 0xaf;
    else if (op === 0xa6 || op === 0xa7) this.inverted = op === 0xa7;
    else if (op === 0xa4 || op === 0xa5) this.entireOn = op === 0xa5;
    else if (op === 0xa0 || op === 0xa1) this.segmentRemap = op === 0xa1;
    else if (op >= 0xc0 && op <= 0xcf) this.comReverse = op >= 0xc8;
    else if (op >= 0x40 && op <= 0x7f) this.startLine = op & 0x3f;
    else if (op === 0x81) this.contrast = args[0];
    else if (op === 0x20) this.mode = args[0] & 3;
    else if (op === 0x21) {
      this.columnStart = this.column = args[0] & 0x7f;
      this.columnEnd = args[1] & 0x7f;
    } else if (op === 0x22) {
      this.pageStart = this.page = args[0] & 7;
      this.pageEnd = args[1] & 7;
    } else if (op >= 0xb0 && op <= 0xb7) this.page = op & 7;
    else if (op <= 0x0f) this.column = (this.column & 0xf0) | op;
    else if (op <= 0x1f) this.column = ((op & 0x0f) << 4) | (this.column & 0x0f);
    else return;
    if (this.version === before) this.version++;
  }
  pixel(x: number, y: number) {
    if (!this.on) return false;
    if (this.entireOn) return !this.inverted;
    const column = this.segmentRemap ? x : 127 - x;
    const row = ((this.comReverse ? y : 63 - y) + this.startLine) & 63;
    const lit = !!((this.ram[(row >> 3) * 128 + column] >> (row & 7)) & 1);
    return lit !== this.inverted;
  }
  private cached = { version: -1, frame: '' };
  // Row-major 1-bit image of the visible panel (MSB = leftmost pixel), base64 encoded.
  frame() {
    if (this.cached.version === this.version) return this.cached.frame;
    const bytes = new Uint8Array(1024);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 128; x++)
        if (this.pixel(x, y)) bytes[y * 16 + (x >> 3)] |= 0x80 >> (x & 7);
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    this.cached = { version: this.version, frame: btoa(text) };
    return this.cached.frame;
  }
  state() {
    return { kind: 'oled' as const, on: this.on, version: this.version, frame: this.frame() };
  }
}

export const BUZZER_MIN_HZ = 20;
export const BUZZER_MAX_HZ = 20000;
const BUZZER_NOTE_LIMIT = 64;
const BUZZER_RETUNE = 0.03; // a new pitch must differ by more than 3% to count as a new note
const BUZZER_WALL_SILENCE_MS = 400;
const BUZZER_WINDOW = 9; // rising edges per pitch estimate (8 periods)
const BUZZER_STEADY = 1.02; // two-period spans in a window may differ by 2% at most

// Passive piezo buzzer: measures the pitch of the square wave on SIG from rising-edge spacing in
// virtual time and keeps a log of pitch changes (0 Hz = silent) so a browser can replay melodies
// between polls. It models what the firmware plays, not the acoustics of a real transducer.
//
// The pitch comes from a window of 8 periods rather than one period, because an engine may
// timestamp edges coarsely (the ESP32 engine alternates 2.35 / 2.65 ms for a steady 2.5 ms wave).
// Two-period spans cancel that alternation. A window that straddles two notes has unequal spans
// and is ignored, so a new note is logged only once its own edges fill a window, stamped with the
// first of those edges.
export class Buzzer {
  frequency = 0;
  count = 0; // notes logged so far; lets a client tell which log entries it has not seen yet
  readonly notes: { n: number; atNs: number; frequency: number }[] = [];
  private level = false;
  private rises: number[] = [];
  private periodNs = 0;
  private lastWallMs = 0;
  private driven = false; // true while the pitch comes from setTone() rather than pin edges
  constructor(
    readonly id: string,
    private readonly nowNs: () => number,
    private readonly wallMs: () => number = () => performance.now(),
  ) {}
  // Pitch reported directly by an engine that models PWM hardware (ESP32 LEDC), where the pin
  // never shows edges. 0 = silent. Such a note lasts until the engine reports another one.
  setTone(frequency: number, atNs: number) {
    this.driven = true;
    this.setFrequency(
      frequency >= BUZZER_MIN_HZ && frequency <= BUZZER_MAX_HZ
        ? Math.round(frequency * 10) / 10
        : 0,
      atNs,
    );
  }
  private get lastRiseNs() {
    return this.rises.length ? this.rises[this.rises.length - 1] : null;
  }
  edge(high: boolean) {
    if (high === this.level) return;
    this.level = high;
    if (!high) return;
    this.driven = false;
    const at = this.nowNs(),
      last = this.lastRiseNs;
    this.lastWallMs = this.wallMs();
    if (last !== null && (at <= last || at - last > 1e9 / BUZZER_MIN_HZ)) this.rises = [];
    this.rises.push(at);
    if (this.rises.length > BUZZER_WINDOW) this.rises.shift();
    if (this.rises.length < BUZZER_WINDOW) return;
    const spans = this.rises.slice(2).map((t, i) => t - this.rises[i]);
    if (Math.max(...spans) > Math.min(...spans) * BUZZER_STEADY) return;
    const periodNs = (at - this.rises[0]) / (BUZZER_WINDOW - 1),
      hz = 1e9 / periodNs;
    this.periodNs = periodNs;
    if (hz < BUZZER_MIN_HZ || hz > BUZZER_MAX_HZ) this.setFrequency(0, this.rises[0]);
    else if (!this.frequency || Math.abs(hz - this.frequency) / this.frequency > BUZZER_RETUNE)
      this.setFrequency(Math.round(hz * 10) / 10, this.rises[0]);
  }
  private setFrequency(frequency: number, atNs: number) {
    if (frequency === this.frequency) return;
    this.frequency = frequency;
    this.notes.push({ n: ++this.count, atNs, frequency });
    if (this.notes.length > BUZZER_NOTE_LIMIT) this.notes.shift();
  }
  // Silence is detected lazily: the pin simply stops toggling, which raises no event.
  private settle() {
    const last = this.lastRiseNs;
    if (this.driven || !this.frequency || last === null) return;
    const idleNs = Math.max(30e6, this.periodNs * 4);
    if (this.nowNs() - last > idleNs || this.wallMs() - this.lastWallMs > BUZZER_WALL_SILENCE_MS)
      this.setFrequency(0, last + this.periodNs * 2);
  }
  state() {
    this.settle();
    return {
      kind: 'buzzer' as const,
      frequency: this.frequency,
      count: this.count,
      timeNs: this.nowNs(),
      notes: [...this.notes],
    };
  }
}

export type Peripheral = Ssd1306 | Mpu6050 | Dht22 | Buzzer;
// Shared by the AVR and ESP32 adapters: devices from the simulation plan, sensor input, state.
export function i2cDevices(plan: { id: string; kind: 'oled' | 'mpu6050'; address: number }[]) {
  return plan.map((d) =>
    d.kind === 'oled' ? new Ssd1306(d.id, d.address) : new Mpu6050(d.id, d.address),
  );
}
export function setPeripheral(
  peripherals: Map<string, Peripheral>,
  id: string,
  values: Record<string, unknown>,
) {
  const device = peripherals.get(id);
  if (!(device instanceof Mpu6050 || device instanceof Dht22))
    throw new Error('沒有可調整的感測器：' + id);
  if (!values || typeof values !== 'object') throw new Error('感測器輸入格式錯誤');
  device.set(values);
}
export const peripheralState = (peripherals: Map<string, Peripheral>) =>
  Object.fromEntries([...peripherals].map(([id, device]) => [id, device.state()]));

export interface ClimateValues {
  temperature: number; // °C
  humidity: number; // %RH
}

// DHT22 data frame: humidity ×10, temperature ×10 (sign in bit 15), checksum.
export function dht22Bytes(values: ClimateValues) {
  const humidity = Math.round(values.humidity * 10),
    temperature =
      Math.round(Math.abs(values.temperature) * 10) | (values.temperature < 0 ? 0x8000 : 0);
  const bytes = [humidity >> 8, humidity & 0xff, temperature >> 8, temperature & 0xff];
  return [...bytes, bytes.reduce((sum, b) => sum + b, 0) & 0xff];
}
// Levels the sensor drives after the host releases DATA, as [level, microseconds] segments.
export function dht22Response(values: ClimateValues): [boolean, number][] {
  const segments: [boolean, number][] = [
    [true, 30],
    [false, 80],
    [true, 80],
  ];
  for (const byte of dht22Bytes(values))
    for (let bit = 7; bit >= 0; bit--)
      segments.push([false, 50], [true, (byte >> bit) & 1 ? 70 : 26]);
  segments.push([false, 50], [true, 0]);
  return segments;
}
// The host start signal is ≥1 ms low (DHT22 datasheet); shorter pulses are ignored.
export const DHT22_START_US = 500;

export class Dht22 {
  values: ClimateValues = { temperature: 25, humidity: 50 };
  reads = 0;
  constructor(readonly id: string) {}
  set(values: Partial<Record<keyof ClimateValues, unknown>>) {
    const next = { ...this.values };
    for (const [key, value] of Object.entries(values)) {
      if (key === 'temperature') next.temperature = finite(value, -40, 80, key);
      else if (key === 'humidity') next.humidity = finite(value, 0, 100, key);
      else throw new Error('DHT22 沒有此輸入：' + key);
    }
    this.values = next;
  }
  state() {
    return { kind: 'dht22' as const, values: this.values, reads: this.reads };
  }
}
