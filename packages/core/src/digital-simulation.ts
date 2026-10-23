import type { Source } from './model';

export type DigitalLevel = 'LOW' | 'HIGH' | 'Hi-Z' | 'CONFLICT';
export type SignalEvent = { timeNs: number; gpio: number; value: DigitalLevel };
export class VirtualClock {
  timeNs = 0;
  advanceTo(timeNs: number) {
    if (!Number.isSafeInteger(timeNs) || timeNs < this.timeNs)
      throw new Error('虛擬時間必須單調遞增且為安全整數');
    this.timeNs = timeNs;
  }
}

/** Stable event order makes same-time events reproducible in headless tests. */
export class EventQueue {
  private queue: { timeNs: number; order: number; run: () => void }[] = [];
  private order = 0;
  schedule(timeNs: number, run: () => void) {
    if (!Number.isSafeInteger(timeNs) || timeNs < 0) throw new Error('無效事件時間');
    this.queue.push({ timeNs, order: this.order++, run });
    this.queue.sort((a, b) => a.timeNs - b.timeNs || a.order - b.order);
  }
  step(clock: VirtualClock) {
    const next = this.queue.shift();
    if (!next) return false;
    clock.advanceTo(next.timeNs);
    next.run();
    return true;
  }
}

export function resolveDigital(drivers: DigitalLevel[], pull?: 'HIGH' | 'LOW'): DigitalLevel {
  const active = drivers.filter((d) => d !== 'Hi-Z');
  if (active.includes('CONFLICT') || (active.includes('HIGH') && active.includes('LOW')))
    return 'CONFLICT';
  return active[0] ?? pull ?? 'Hi-Z';
}

/** Circuit connectivity comes exclusively from circuit.json, never canvas edges. */
export class DigitalCircuit {
  private drivers = new Map<string, DigitalLevel>();
  constructor(readonly source: Source) {}
  drive(endpoint: string, level: DigitalLevel) {
    this.drivers.set(endpoint, level);
  }
  level(endpoint: string): DigitalLevel {
    const endpoints = new Set<string>([endpoint]),
      queue = [endpoint];
    while (queue.length) {
      const pin = queue.shift()!;
      const net = this.source.circuit.nets.find((n) => n.endpoints.includes(pin));
      const adjacent = [...(net?.endpoints ?? [])];
      const [id, terminal] = pin.split('.');
      if (
        this.source.circuit.instances.some((i) => i.id === id && i.typeId === 'official:resistor')
      )
        adjacent.push(`${id}.${terminal === 'A' ? 'B' : 'A'}`);
      for (const ref of adjacent)
        if (!endpoints.has(ref)) {
          endpoints.add(ref);
          queue.push(ref);
        }
    }
    return resolveDigital([...endpoints].map((p) => this.drivers.get(p) ?? 'Hi-Z'));
  }
}

export class SimulationBus {
  readonly clock = new VirtualClock();
  readonly events: SignalEvent[] = [];
  readonly gpio: Record<string, DigitalLevel> = {};
  readonly circuit: DigitalCircuit;
  constructor(source: Source) {
    this.circuit = new DigitalCircuit(source);
  }
  publish(event: SignalEvent) {
    this.clock.advanceTo(event.timeNs);
    if (this.gpio[event.gpio] === event.value) return;
    this.gpio[event.gpio] = event.value;
    this.circuit.drive(`${this.circuit.source.project.board}.GPIO${event.gpio}`, event.value);
    this.events.push(event);
    if (this.events.length > 10000) this.events.shift();
  }
  vcd() {
    return signalVcd(this.events);
  }
}

export function signalVcd(events: SignalEvent[]) {
  const pins = [...new Set(events.map((e) => e.gpio))].sort((a, b) => a - b);
  const codes = new Map(pins.map((pin, index) => [pin, 'p' + index]));
  const lines = [
    '$timescale 1ns $end',
    '$scope module OpenCircuit $end',
    ...pins.map((pin) => `$var wire 1 ${codes.get(pin)} GPIO${pin} $end`),
    '$upscope $end',
    '$enddefinitions $end',
  ];
  for (const event of events)
    lines.push(
      '#' + event.timeNs,
      { HIGH: '1', LOW: '0', 'Hi-Z': 'z', CONFLICT: 'x' }[event.value] + codes.get(event.gpio),
    );
  return lines.join('\n') + '\n';
}

export interface SimulationAdapter {
  readonly adapter: string;
  running: boolean;
  paused: boolean;
  error?: string | null;
  log: string;
  start(): void;
  stop(): void | Promise<void>;
  pause(): void | Promise<void>;
  resume(): void | Promise<void>;
  step(): void | Promise<void>;
  setSpeed(speed: number): void | Promise<void>;
  button(id: string, pressed: boolean): void;
  setSensor?(id: string, values: Record<string, unknown>): void | Promise<void>;
  sendSerial(text: string): void | Promise<void>;
  state(): any;
  vcd(): string;
}

export function simulationSerialBytes(text: string) {
  if (typeof text !== 'string' || !text.length) throw new Error('請輸入序列訊息');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 4096) throw new Error('序列訊息最多 4096 位元組');
  return bytes;
}
