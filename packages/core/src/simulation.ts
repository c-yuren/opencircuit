import {
  CPU,
  avrInstruction,
  AVRTimer,
  timer0Config,
  timer1Config,
  timer2Config,
  AVRIOPort,
  portBConfig,
  portCConfig,
  portDConfig,
  AVRUSART,
  usart0Config,
  AVRTWI,
  twiConfig,
  PinState,
} from 'avr8js';
import type { Source } from './model';
import { moduleKind } from './catalog';
import {
  DHT22_START_US,
  Buzzer,
  Dht22,
  I2CBus,
  dht22Response,
  i2cDevices,
  peripheralState,
  setPeripheral,
  type Peripheral,
} from './peripherals';
import { signalVcd, simulationSerialBytes, type SimulationAdapter } from './digital-simulation';
import { ESP32_DIGITAL_STARTUP, ESP32_STARTUP_FILE } from './esp32-startup';
import {
  bindingGPIO,
  checkRules,
  graph,
  reachable,
  resolvePin,
  isUnusedComponent,
} from './analysis';
export interface SimulationPlan {
  mode: 'local-avr8js' | 'local-esp32-qemu' | 'external-wokwi';
  supported: boolean;
  reasons: string[];
  capabilities: {
    instance: string;
    typeId: string;
    local: boolean;
    external: boolean;
    unused: boolean;
    note: string;
  }[];
  leds: { id: string; gpio: number }[];
  buttons: { id: string; gpio: number }[];
  // Module models: I²C OLED / MPU6050 on Uno and ESP32, single-wire DHT22 on Uno.
  i2c?: { id: string; kind: 'oled' | 'mpu6050'; address: number }[];
  dhts?: { id: string; gpio: number }[];
  // Passive buzzers: pitch is measured from the GPIO square wave and played in the browser.
  buzzers?: { id: string; gpio: number }[];
}
const externalTypes: Record<string, string> = {
  'official:esp32-devkitc-v4': 'board-esp32-devkit-c-v4',
  'official:arduino-uno-r3': 'wokwi-arduino-uno',
  'official:led-red': 'wokwi-led',
  'official:resistor': 'wokwi-resistor',
  'official:button': 'wokwi-pushbutton',
  'official:ssd1306-oled': 'board-ssd1306',
  'official:ssd1306-oled-5v': 'board-ssd1306',
  'official:dht22': 'wokwi-dht22',
  'official:dht22-5v': 'wokwi-dht22',
  'official:ground': 'wokwi-gnd',
};
// DHT sensor library 1.4.6 crashes the PICSimLab QEMU engine (Cache error) inside read(), with
// or without a modelled sensor attached, so ESP32 DHT22 stays unsupported.
const ESP32_MODULES: (string | undefined)[] = ['oled', 'mpu6050'];
export function simulationPlan(s: Source): SimulationPlan {
  const avr = s.dependencies.fqbn === 'arduino:avr:uno',
    esp32 = s.dependencies.fqbn === 'esp32:esp32:esp32',
    local = avr || esp32,
    reasons: string[] = [],
    leds: SimulationPlan['leds'] = [],
    buttons: SimulationPlan['buttons'] = [],
    i2c: NonNullable<SimulationPlan['i2c']> = [],
    dhts: NonNullable<SimulationPlan['dhts']> = [],
    buzzers: NonNullable<SimulationPlan['buzzers']> = [];
  // Module models available per engine (ESP32: over the QEMU I²C bridge).
  const localKind = (typeId: string) => {
    const kind = moduleKind(typeId);
    return avr || (esp32 && ESP32_MODULES.includes(kind!)) ? kind : undefined;
  };
  const capabilities = s.circuit.instances.map((i) => {
    const unused = isUnusedComponent(s, i);
    const module = !!localKind(i.typeId);
    const modeled =
      module ||
      [
        'official:arduino-uno-r3',
        'official:esp32-devkitc-v4',
        'official:led-red',
        'official:resistor',
        'official:button',
        'official:buzzer',
        'official:ground',
      ].includes(i.typeId);
    return {
      instance: i.id,
      typeId: i.typeId,
      local: modeled,
      external: !!externalTypes[i.typeId],
      unused,
      note: unused
        ? '尚未接線，不參與模擬'
        : module
          ? '本機功能模型（韌體可見的通訊與資料）；不模擬電氣特性'
          : i.typeId === 'official:buzzer'
            ? esp32
              ? '本機頻率模型：tone()／LEDC PWM 的音高直接讀自引擎的 LEDC 暫存器（每 10 ms 取樣），不修改韌體；數位翻轉則由 GPIO 方波量測；在瀏覽器發聲，不模擬喇叭聲學'
              : '本機頻率模型：由 GPIO 方波量測音高並在瀏覽器發聲；不模擬喇叭聲學'
            : modeled
              ? '本機數位功能模型；不計算類比電流'
              : esp32 && moduleKind(i.typeId) === 'dht22'
                ? 'DHT 函式庫會讓 ESP32 本機引擎當機（Cache error）；請改用 Uno 模擬'
                : esp32 && moduleKind(i.typeId)
                  ? 'ESP32 尚未提供此模組的本機模型；可改用 Uno'
                  : '沒有本機元件模型',
    };
  });
  if (!local) reasons.push('此主板未提供離線模擬；請使用外部 Wokwi 匯出');
  if (esp32 && !s.dependencies.buildProperties.includes('build.boot=dio'))
    reasons.push('ESP32 本機引擎需要 DIO Flash 模式；請在模擬面板套用 DIO 設定');
  if (esp32 && s.extraFirmware[ESP32_STARTUP_FILE] !== ESP32_DIGITAL_STARTUP)
    reasons.push('ESP32 需要數位模擬啟動；不支援 OTA、NVS 與 Wi-Fi，請在模擬面板套用設定');
  if (
    esp32 &&
    /\b(WiFi|Preferences|EEPROM|SPIFFS|LittleFS|SD|Update|ArduinoOTA)\b|\bnvs_\w+\s*\(/.test(
      s.firmware +
        Object.entries(s.extraFirmware)
          .filter(([name]) => name !== ESP32_STARTUP_FILE)
          .map(([, text]) => text)
          .join('\n'),
    )
  )
    reasons.push('此階段不支援 Wi-Fi、儲存與 OTA 韌體 API');
  if (
    esp32 &&
    s.dependencies.buildProperties.some(
      (p) => p.startsWith('build.flash_size=') && p !== 'build.flash_size=4MB',
    )
  )
    reasons.push('ESP32 本機引擎目前支援 4MB Flash');
  if (local)
    for (const c of capabilities)
      if (!c.local && !c.unused) reasons.push(c.instance + '：' + c.note);
  const g = graph(s);
  for (const i of s.circuit.instances) {
    if (isUnusedComponent(s, i)) continue;
    if (i.typeId === 'official:led-red') {
      const gpio = bindingGPIO(s, i.id + '.A');
      if (gpio.length !== 1) reasons.push(i.id + ' 無法唯一解析 GPIO');
      else leds.push({ id: i.id, gpio: gpio[0].resolved!.pin.gpio! });
    }
    if (i.typeId === 'official:button') {
      const a = bindingGPIO(s, i.id + '.A'),
        b = bindingGPIO(s, i.id + '.B'),
        gpio = a.length ? a : b,
        groundSide = a.length ? 'B' : 'A';
      const refs = [...reachable(g, i.id + '.' + groundSide)];
      const grounded = refs.some((r) => resolvePin(s, r)?.pin.direction === 'ground');
      if (gpio.length !== 1 || !grounded)
        reasons.push(i.id + ' 僅支援 GPIO→按鈕→GND（INPUT_PULLUP）');
      else buttons.push({ id: i.id, gpio: gpio[0].resolved!.pin.gpio! });
    }
    if (i.typeId === 'official:buzzer') {
      const signal = bindingGPIO(s, i.id + '.SIG'),
        grounded = [...reachable(g, i.id + '.GND')].some(
          (r) => resolvePin(s, r)?.pin.direction === 'ground' && !r.startsWith(i.id + '.'),
        );
      if (signal.length !== 1) reasons.push(i.id + ' 的 SIG 必須接到唯一的 GPIO');
      else if (!grounded) reasons.push(i.id + ' 的 GND 必須接地');
      else buzzers.push({ id: i.id, gpio: signal[0].resolved!.pin.gpio! });
    }
    const kind = localKind(i.typeId);
    if (kind === 'oled' || kind === 'mpu6050') {
      const busPin = (pin: string, capability: string) =>
        bindingGPIO(s, i.id + '.' + pin).some((x) =>
          x.resolved!.pin.capabilities?.includes(capability),
        );
      const address = Number(
        i.parameters.address ?? resolvePin(s, i.id + '.SDA')?.def.parameters.address,
      );
      if (!busPin('SDA', 'i2cSda') || !busPin('SCL', 'i2cScl'))
        reasons.push(i.id + ' 的 SDA／SCL 必須接到板子的 I²C 腳' + (avr ? '（Uno：A4／A5）' : ''));
      else if (Number.isInteger(address)) i2c.push({ id: i.id, kind, address });
    }
    if (kind === 'dht22') {
      const data = bindingGPIO(s, i.id + '.DATA');
      if (data.length !== 1) reasons.push(i.id + ' 的 DATA 必須接到唯一的 GPIO');
      else dhts.push({ id: i.id, gpio: data[0].resolved!.pin.gpio! });
    }
  }
  const failures = checkRules(s).filter((d) => d.state === 'fail');
  reasons.push(...failures.map((d) => d.ruleId + ': ' + d.reason));
  return {
    mode: avr ? 'local-avr8js' : esp32 ? 'local-esp32-qemu' : 'external-wokwi',
    supported: !reasons.length,
    reasons,
    capabilities,
    leds,
    buttons,
    i2c,
    dhts,
    buzzers,
  };
}
export function loadIntelHex(text: string) {
  const bytes = new Uint8Array(32768);
  let base = 0,
    eof = false;
  for (const line of text.trim().split(/\r?\n/)) {
    if (!/^:[0-9a-f]+$/i.test(line) || line.length % 2 !== 1) throw new Error('韌體 HEX 格式錯誤');
    const data = Uint8Array.from(
      line
        .slice(1)
        .match(/../g)!
        .map((n) => parseInt(n, 16)),
    );
    if (data.length !== data[0] + 5 || data.reduce((a, b) => a + b, 0) % 256)
      throw new Error('HEX checksum 錯誤');
    const address = data[1] * 256 + data[2],
      type = data[3];
    if (type === 0) {
      const pos = base + address;
      if (pos + data[0] > bytes.length) throw new Error('HEX 超出 ATmega328P Flash');
      bytes.set(data.slice(4, 4 + data[0]), pos);
    } else if (type === 1) {
      eof = true;
      break;
    } else if (type === 4) base = (data[4] * 256 + data[5]) * 65536;
    else if (type === 2) base = (data[4] * 256 + data[5]) * 16;
    else throw new Error('未支援 HEX record ' + type);
  }
  if (!eof) throw new Error('HEX 缺少 EOF');
  return new Uint16Array(bytes.buffer);
}
const AVR_TICK_BUDGET_MS = 8,
  AVR_CHUNK_CYCLES = 20000;
export class AvrSimulation implements SimulationAdapter {
  readonly adapter = 'avr8js@0.21.0';
  paused = false;
  speed = 1;
  effectiveSpeed: number | null = null;
  private speedWindow = { ms: 0, cycles: 0 };
  readonly peripherals = new Map<string, Peripheral>();
  readonly cpu: CPU;
  readonly ports: { B: AVRIOPort; C: AVRIOPort; D: AVRIOPort };
  readonly serial: AVRUSART;
  running = false;
  timer: ReturnType<typeof setTimeout> | undefined;
  private serialInput: number[] = [];
  private readonly buzzers: { gpio: number; model: Buzzer }[] = [];
  outputs: Record<string, boolean> = {};
  log = '';
  transitions: { id: string; on: boolean; cycles: number }[] = [];
  error: string | null = null;
  constructor(
    hex: string,
    readonly plan: SimulationPlan,
  ) {
    if (!plan.supported || plan.mode !== 'local-avr8js')
      throw new Error(plan.reasons.join('\n') || '不支援此本機模擬');
    this.cpu = new CPU(loadIntelHex(hex));
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    this.ports = {
      B: new AVRIOPort(this.cpu, portBConfig),
      C: new AVRIOPort(this.cpu, portCConfig),
      D: new AVRIOPort(this.cpu, portDConfig),
    };
    this.serial = new AVRUSART(this.cpu, usart0Config, 16000000);
    const decoder = new TextDecoder('utf-8');
    this.serial.onByteTransmit = (value) => {
      this.log = (this.log + decoder.decode(Uint8Array.of(value), { stream: true })).slice(
        -1_000_000,
      );
    };
    for (const port of Object.values(this.ports)) port.addListener(() => this.updateOutputs());
    for (const b of plan.buttons) this.button(b.id, false);
    const devices = i2cDevices(plan.i2c ?? []);
    if (devices.length) {
      const bus = new I2CBus(devices),
        twi = new AVRTWI(this.cpu, twiConfig, 16000000);
      twi.eventHandler = {
        start: () => twi.completeStart(),
        stop: () => {
          bus.stop();
          twi.completeStop();
        },
        connectToSlave: (address, write) => twi.completeConnect(bus.connect(address, write)),
        writeByte: (value) => twi.completeWrite(bus.write(value)),
        readByte: () => twi.completeRead(bus.read()),
      };
      for (const device of devices) this.peripherals.set(device.id, device);
    }
    for (const d of plan.dhts ?? []) this.attachDht(new Dht22(d.id), d.gpio);
    for (const d of plan.buzzers ?? []) {
      const model = new Buzzer(d.id, () => this.cpu.cycles * (1e9 / 16000000));
      this.buzzers.push({ gpio: d.gpio, model });
      this.peripherals.set(d.id, model);
    }
    this.updateOutputs();
  }
  // DHT22 single-wire protocol: after the host holds DATA low for the start signal and releases
  // it, the module drives the response bits with datasheet timing, scheduled in CPU cycles.
  private attachDht(model: Dht22, gpio: number) {
    this.peripherals.set(model.id, model);
    const p = this.pin(gpio);
    let lowSince: number | null = null,
      responding = false;
    p.port.setPin(p.index, true); // module pull-up keeps an idle line high
    p.port.addListener(() => {
      if (p.port.pinState(p.index) === PinState.Low) {
        lowSince ??= this.cpu.cycles;
        return;
      }
      if (lowSince === null) return;
      const heldUs = (this.cpu.cycles - lowSince) / 16;
      lowSince = null;
      if (responding || heldUs < DHT22_START_US) return;
      responding = true;
      model.reads++;
      let at = 0;
      for (const [level, us] of dht22Response(model.values)) {
        this.cpu.addClockEvent(() => p.port.setPin(p.index, level), Math.max(1, at * 16));
        at += us;
      }
      this.cpu.addClockEvent(
        () => {
          responding = false;
        },
        at * 16 + 1,
      );
    });
  }
  setSensor(id: string, values: Record<string, unknown>) {
    setPeripheral(this.peripherals, id, values);
  }
  pin(n: number) {
    if (n < 0 || n > 19) throw new Error('AVR GPIO 超出範圍');
    return n < 8
      ? { port: this.ports.D, index: n }
      : n < 14
        ? { port: this.ports.B, index: n - 8 }
        : { port: this.ports.C, index: n - 14 };
  }
  updateOutputs() {
    for (const led of this.plan.leds) {
      const p = this.pin(led.gpio),
        on = p.port.pinState(p.index) === PinState.High;
      if (this.outputs[led.id] !== on) {
        this.outputs[led.id] = on;
        this.transitions.push({ id: led.id, on, cycles: this.cpu.cycles });
        if (this.transitions.length > 2000) this.transitions.shift();
      }
    }
    for (const b of this.buzzers) {
      const p = this.pin(b.gpio);
      b.model.edge(p.port.pinState(p.index) === PinState.High);
    }
  }
  button(id: string, pressed: boolean) {
    const b = this.plan.buttons.find((b) => b.id === id);
    if (!b) throw new Error('未支援此輸入元件');
    const p = this.pin(b.gpio);
    p.port.setPin(p.index, !pressed);
  }
  advance(cycles: number) {
    const end = this.cpu.cycles + cycles;
    while (this.cpu.cycles < end) {
      if (
        this.serialInput.length &&
        !this.serial.rxBusy &&
        this.serial.writeByte(this.serialInput[0])
      )
        this.serialInput.shift();
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
    this.updateOutputs();
  }
  // Executes up to `cycles`, in chunks, but stops once `budgetMs` of host time is used so the
  // simulation (which shares the API server's thread) never blocks requests for long.
  runFor(
    cycles: number,
    budgetMs = AVR_TICK_BUDGET_MS,
    now: () => number = () => performance.now(),
  ) {
    const started = now(),
      first = this.cpu.cycles,
      end = first + cycles;
    while (this.cpu.cycles < end && now() - started < budgetMs)
      this.advance(Math.min(AVR_CHUNK_CYCLES, end - this.cpu.cycles));
    return this.cpu.cycles - first;
  }
  // Requested speed is a target; when the host cannot keep up the deficit is dropped rather than
  // accumulated, and the achieved rate is reported as effectiveSpeed.
  measureSpeed(elapsedMs: number, executed: number) {
    this.speedWindow.ms += elapsedMs;
    this.speedWindow.cycles += executed;
    if (this.speedWindow.ms >= 500) {
      this.effectiveSpeed =
        Math.round((this.speedWindow.cycles / (this.speedWindow.ms * 16000)) * 100) / 100;
      this.speedWindow = { ms: 0, cycles: 0 };
    }
  }
  start() {
    if (this.running) return;
    this.running = true;
    let previous = performance.now();
    const tick = () => {
      if (!this.running) return;
      try {
        const now = performance.now(),
          elapsed = now - previous;
        previous = now;
        if (!this.paused)
          this.measureSpeed(elapsed, this.runFor(Math.round(elapsed * 16000 * this.speed)));
        this.timer = setTimeout(tick, 4);
      } catch (e) {
        this.error = (e as Error).message;
        this.running = false;
      }
    };
    tick();
  }
  stop() {
    this.running = false;
    this.paused = false;
    this.serialInput = [];
    this.effectiveSpeed = null;
    this.speedWindow = { ms: 0, cycles: 0 };
    if (this.timer) clearTimeout(this.timer);
  }
  pause() {
    this.paused = true;
    this.effectiveSpeed = null;
    this.speedWindow = { ms: 0, cycles: 0 };
  }
  resume() {
    this.paused = false;
  }
  step() {
    if (!this.paused) throw new Error('請先暫停模擬');
    this.advance(160000);
  }
  setSpeed(speed: number) {
    if (![1, 2, 10, 100].includes(speed)) throw new Error('無效模擬速度');
    this.speed = speed;
    this.effectiveSpeed = null;
    this.speedWindow = { ms: 0, cycles: 0 };
  }
  sendSerial(text: string) {
    if (!this.running) throw new Error('模擬未執行');
    const bytes = simulationSerialBytes(text);
    if (this.serialInput.length + bytes.length > 4096)
      throw new Error('序列輸入佇列已滿，請稍後重試');
    this.serialInput.push(...bytes);
  }
  vcd() {
    return signalVcd(
      this.transitions.flatMap((t) => {
        const gpio = this.plan.leds.find((l) => l.id === t.id)?.gpio;
        return gpio === undefined
          ? []
          : [
              {
                gpio,
                timeNs: Math.round((t.cycles * 1e9) / 16000000),
                value: t.on ? ('HIGH' as const) : ('LOW' as const),
              },
            ];
      }),
    );
  }
  state() {
    return {
      running: this.running,
      paused: this.paused,
      speed: this.speed,
      effectiveSpeed: this.effectiveSpeed,
      cycles: this.cpu.cycles,
      simulatedSeconds: this.cpu.cycles / 16000000,
      outputs: this.outputs,
      buttons: this.plan.buttons,
      transitions: this.transitions,
      serial: this.log,
      peripherals: peripheralState(this.peripherals),
      error: this.error,
      mode: '完全本機 AVR8js · ATmega328P 16 MHz',
      verification: '正在執行已編譯韌體，非實機驗證',
    };
  }
}
export function wokwiDiagram(s: Source) {
  const unsupported = s.circuit.instances.filter((i) => !externalTypes[i.typeId]);
  if (unsupported.length)
    throw new Error(
      '外部 adapter 未支援：' + unsupported.map((i) => i.id + ' (' + i.typeId + ')').join(', '),
    );
  const pins = (ref: string) => {
    const [id, p] = ref.split('.'),
      i = s.circuit.instances.find((i) => i.id === id)!;
    let pin = p;
    if (i.typeId === 'official:arduino-uno-r3') {
      if (p.startsWith('D')) pin = p.slice(1);
      if (p === 'GND') pin = 'GND.1';
      if (p === '3V3') throw new Error('外部 Uno 模擬不支援 3.3V 供電接腳');
    }
    if (i.typeId === 'official:esp32-devkitc-v4') {
      if (p.startsWith('GPIO')) pin = p.slice(4);
      if (p === 'GND') pin = 'GND.1';
    }
    if (i.typeId === 'official:button') pin = p === 'A' ? '1.l' : '2.l';
    if (i.typeId === 'official:resistor') pin = p === 'A' ? '1' : '2';
    if (moduleKind(i.typeId) === 'dht22' && p === 'DATA') pin = 'SDA';
    if (i.typeId === 'official:ground') pin = 'GND';
    return id + ':' + pin;
  };
  return {
    version: 1,
    author: 'OpenCircuit',
    editor: 'wokwi',
    parts: s.circuit.instances.map((i) => ({
      type: externalTypes[i.typeId],
      id: i.id,
      top: s.layout[i.id]?.y ?? 0,
      left: s.layout[i.id]?.x ?? 0,
      attrs:
        i.typeId === 'official:resistor'
          ? { value: String(i.parameters.resistance ?? 220) }
          : i.typeId === 'official:led-red'
            ? { color: 'red' }
            : {},
    })),
    connections: s.circuit.nets.flatMap((n) =>
      n.endpoints.slice(1).map((ep) => [pins(n.endpoints[0]), pins(ep), 'green', []]),
    ),
  };
}
