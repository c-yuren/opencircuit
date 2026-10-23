import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Snapshot, Source } from './model';
import type { SimulationPlan } from './simulation';
import { SimulationBus, simulationSerialBytes, type SimulationAdapter } from './digital-simulation';
import { appRoot, getAsciiPath } from './environment';
import { safePath } from './files';
import { validBuildArtifacts } from './compiler';
import { runProcess } from './process';
import {
  Buzzer,
  I2CBus,
  i2cDevices,
  peripheralState,
  setPeripheral,
  type Peripheral,
} from './peripherals';
import {
  esp32EnginePath,
  esp32EngineInstalled,
  pythonExecutable,
  ESP32_ENGINE_VERSION,
} from './esp32-engine';
export { esp32EnginePath, esp32EngineInstalled } from './esp32-engine';

export class Esp32Simulation implements SimulationAdapter {
  readonly adapter = 'picsimlab-qemu@' + ESP32_ENGINE_VERSION;
  readonly bus: SimulationBus;
  running = false;
  paused = false;
  speed = 1;
  log = '';
  error: string | null = null;
  outputs: Record<string, boolean> = {};
  transitions: { id: string; on: boolean; timeNs: number; cycles: number }[] = [];
  readonly peripherals = new Map<string, Peripheral>();
  private readonly i2c: I2CBus;
  private readonly buzzers: { gpio: number; model: Buzzer }[] = [];
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdout = '';
  private stderr = '';
  private readonly decoder = new TextDecoder();
  private readonly directions = new Map<number, boolean>();
  private readonly levels = new Map<number, boolean>();
  private commandId = 0;
  private readonly acknowledgements = new Map<
    number,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private constructor(
    readonly source: Source,
    readonly plan: SimulationPlan,
    private readonly flash: string,
    private readonly efuse: string,
  ) {
    this.bus = new SimulationBus(source);
    for (const led of plan.leds) this.outputs[led.id] = false;
    const devices = i2cDevices(plan.i2c ?? []);
    this.i2c = new I2CBus(devices);
    for (const device of devices) this.peripherals.set(device.id, device);
    for (const b of plan.buzzers ?? []) {
      const model = new Buzzer(b.id, () => this.bus.clock.timeNs);
      this.buzzers.push({ gpio: b.gpio, model });
      this.peripherals.set(b.id, model);
    }
  }
  static async create(
    root: string,
    source: Source,
    snapshot: Snapshot,
    plan: SimulationPlan,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (!esp32EngineInstalled()) throw new Error('ESP32 本機引擎未安裝；執行 npm run setup:esp32');
    if (!plan.supported || plan.mode !== 'local-esp32-qemu')
      throw new Error(plan.reasons.join('\n'));
    if (!(await validBuildArtifacts(root, snapshot.build)))
      throw new Error('模擬產物 SHA-256 不符');
    const image = snapshot.build.artifacts.find((a) => a.path.endsWith('.ino.merged.bin'));
    if (!image || image.size !== 4 * 1024 * 1024)
      throw new Error('ESP32 需要含 bootloader 與 partition 的 4MB merged.bin');
    const flash = await safePath(root, `.hw/simulations/${snapshot.id}/flash.bin`, true);
    const efuse = await safePath(root, `.hw/simulations/${snapshot.id}/efuse.bin`, true);
    await fs.copyFile(await safePath(root, image.path), flash);
    const data = Buffer.alloc(124);
    data[13] = 0x80;
    data[22] = 0x10;
    await fs.writeFile(efuse, data);
    const simulation = new Esp32Simulation(source, plan, flash, efuse);
    try {
      await simulation.launch(signal);
    } catch (error) {
      await simulation.stop();
      throw error;
    }
    return simulation;
  }
  private async launch(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const python = pythonExecutable();
    const bridge = fileURLToPath(new URL('./esp32-bridge.py', import.meta.url));
    const child = spawn(
      python,
      [
        '-X',
        'utf8',
        bridge,
        getAsciiPath(esp32EnginePath()),
        getAsciiPath(this.flash),
        getAsciiPath(this.efuse),
        (this.plan.i2c ?? []).map((d) => d.address).join(','),
      ],
      { shell: false, windowsHide: true },
    );
    this.process = child;
    this.running = true;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        fail(new Error('ESP32 引擎啟動逾時'));
        void this.stop();
      }, 15000);
      const fail = (error: Error) => {
        this.error = error.message;
        this.running = false;
        this.rejectCommands(error);
        clearTimeout(timeout);
        if (!ready) reject(error);
      };
      const abort = () => {
        fail(new Error('ESP32 引擎啟動已取消'));
        void this.stop();
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.once('close', () => signal?.removeEventListener('abort', abort));
      if (signal?.aborted) abort();
      child.on('error', fail);
      child.stdin.on('error', (error) => {
        if (this.running) {
          fail(error);
          void this.stop();
        }
      });
      child.on('exit', (code) => {
        const expected = !this.running;
        this.running = false;
        if (!expected)
          fail(new Error(`ESP32 引擎退出 (${code})：${this.error ?? this.stderr.slice(-1000)}`));
      });
      child.stderr.on('data', (data) => {
        this.stderr = (this.stderr + data.toString()).slice(-100000);
      });
      child.stdout.on('data', (data) => {
        this.stdout += data.toString();
        let at: number;
        while ((at = this.stdout.indexOf('\n')) !== -1) {
          const line = this.stdout.slice(0, at).trim();
          this.stdout = this.stdout.slice(at + 1);
          if (!line.startsWith('OCSIM ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            this.accept(event);
            if (event.kind === 'ready') {
              ready = true;
              clearTimeout(timeout);
              resolve();
            }
          } catch (e) {
            fail(e as Error);
            this.stop();
          }
        }
        if (this.stdout.length > 1000000) {
          fail(new Error('ESP32 事件緩衝溢位'));
          this.stop();
        }
      });
    });
    for (const button of this.plan.buttons) this.button(button.id, false);
  }
  private accept(event: any) {
    if (!Number.isSafeInteger(event.timeNs) || event.timeNs < 0)
      throw new Error('無效引擎事件時間');
    this.bus.clock.advanceTo(event.timeNs);
    if (event.kind === 'gpio' || event.kind === 'direction') {
      if (!Number.isInteger(event.gpio) || event.gpio < 0 || event.gpio > 39)
        throw new Error('無效 GPIO 事件');
      if (event.kind === 'direction') this.directions.set(event.gpio, !!event.output);
      else this.levels.set(event.gpio, !!event.value);
      const driving = this.directions.get(event.gpio);
      const high = this.levels.get(event.gpio) ?? false;
      this.bus.publish({
        timeNs: event.timeNs,
        gpio: event.gpio,
        value: driving ? (high ? 'HIGH' : 'LOW') : 'Hi-Z',
      });
      for (const b of this.buzzers.filter((b) => b.gpio === event.gpio))
        b.model.edge(!!driving && high);
      for (const led of this.plan.leds.filter((l) => l.gpio === event.gpio)) {
        const on = !!driving && high;
        if (this.outputs[led.id] !== on) {
          this.outputs[led.id] = on;
          this.transitions.push({ id: led.id, on, timeNs: event.timeNs, cycles: 0 });
          if (this.transitions.length > 2000) this.transitions.shift();
        }
      }
    } else if (event.kind === 'pwm') {
      // LEDC state read from the engine; its pins never show edges (see esp32-bridge.py).
      if (
        !Number.isInteger(event.gpio) ||
        event.gpio < 0 ||
        event.gpio > 39 ||
        !Number.isFinite(event.frequency) ||
        event.frequency < 0
      )
        throw new Error('無效 PWM 事件');
      for (const b of this.buzzers.filter((b) => b.gpio === event.gpio))
        b.model.setTone(event.frequency, event.timeNs);
    } else if (event.kind === 'uart' && event.uart === 0) {
      if (!Number.isInteger(event.byte) || event.byte < 0 || event.byte > 255)
        throw new Error('無效 UART 事件');
      this.log = (
        this.log + this.decoder.decode(Uint8Array.of(event.byte), { stream: true })
      ).slice(-1000000);
      if (/Guru Meditation Error|assert failed:|abort\(\) was called/.test(this.log)) {
        this.error =
          'ESP32 韌體在本機引擎中崩潰；請查看序列輸出。此引擎尚未支援所有 ESP-IDF 外設。';
        void this.stop();
      }
    } else if (event.kind === 'i2c') {
      // The bridge only forwards addresses listed in the plan; reads wait for this reply.
      if (!Number.isInteger(event.addr) || event.addr < 0 || event.addr > 127)
        throw new Error('無效 I²C 事件');
      if (event.op === 'start') this.i2c.connect(event.addr, !!event.write);
      else if (event.op === 'write') this.i2c.write(Number(event.byte) & 0xff);
      else if (event.op === 'stop') this.i2c.stop();
      else if (event.op === 'read')
        this.send({ kind: 'i2c-reply', id: event.id, value: this.i2c.read() });
      else if (event.op === 'timeout') this.error = 'I²C 讀取逾時；韌體收到 0xFF';
    } else if (event.kind === 'paused') this.paused = !!event.paused;
    else if (event.kind === 'ack') {
      const command = this.acknowledgements.get(event.id);
      if (command) {
        clearTimeout(command.timer);
        this.acknowledgements.delete(event.id);
        if (event.error) command.reject(new Error(event.error));
        else command.resolve();
      }
    }
  }
  private rejectCommands(error: Error) {
    for (const command of this.acknowledgements.values()) {
      clearTimeout(command.timer);
      command.reject(error);
    }
    this.acknowledgements.clear();
  }
  private command(command: object) {
    const id = ++this.commandId;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acknowledgements.delete(id);
        reject(new Error('ESP32 控制回應逾時，請停止並重新開始模擬'));
      }, 5000);
      this.acknowledgements.set(id, { resolve, reject, timer });
      try {
        this.send({ ...command, id });
      } catch (error) {
        clearTimeout(timer);
        this.acknowledgements.delete(id);
        reject(error);
      }
    });
  }
  private send(command: object) {
    if (!this.running || !this.process?.stdin.writable) throw new Error('模擬未執行');
    this.process.stdin.write(JSON.stringify(command) + '\n');
  }
  start() {
    if (this.paused)
      void this.resume().catch((error) => {
        this.error = error.message;
      });
  }
  async stop() {
    this.running = false;
    this.paused = false;
    this.rejectCommands(new Error('模擬已停止'));
    const child = this.process;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      if (process.platform === 'win32' && child.pid)
        void runProcess('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          timeout: 3000,
        }).then((result) => {
          if (result.exitCode !== 0) child.kill();
        });
      else child.kill();
    });
  }
  pause() {
    return this.command({ kind: 'pause' });
  }
  resume() {
    return this.command({ kind: 'resume' });
  }
  step() {
    if (!this.paused) throw new Error('請先暫停模擬');
    return this.command({ kind: 'step' });
  }
  setSpeed(value: number) {
    if (![1, 2, 10, 100].includes(value)) throw new Error('無效模擬速度');
    return this.command({ kind: 'speed', value }).then(() => {
      this.speed = value;
    });
  }
  button(id: string, pressed: boolean) {
    const button = this.plan.buttons.find((b) => b.id === id);
    if (!button) throw new Error('未支援此輸入元件');
    this.send({ kind: 'input', gpio: button.gpio, value: !pressed });
  }
  sendSerial(text: string) {
    simulationSerialBytes(text);
    return this.command({ kind: 'serial', text });
  }
  setSensor(id: string, values: Record<string, unknown>) {
    setPeripheral(this.peripherals, id, values);
  }
  vcd() {
    return this.bus.vcd();
  }
  state() {
    return {
      running: this.running,
      paused: this.paused,
      speed: this.speed,
      simulatedSeconds: this.bus.clock.timeNs / 1e9,
      timeNs: this.bus.clock.timeNs,
      outputs: this.outputs,
      buttons: this.plan.buttons,
      gpio: this.bus.gpio,
      transitions: this.transitions,
      serial: this.log,
      peripherals: peripheralState(this.peripherals),
      error: this.error,
      mode: '完全本機 ESP32 · QEMU Xtensa',
      verification: '執行已編譯的 ESP32 韌體；數位 GPIO 模型，不計算類比電流',
    };
  }
}
