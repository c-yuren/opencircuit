import type { Definition, Source } from './model';
import { isEsp32DigitalStartup, ESP32_STARTUP_FILE } from './esp32-startup';
export const boards = {
  'esp32:esp32:esp32': {
    name: 'ESP32-DevKitC V4',
    typeId: 'official:esp32-devkitc-v4',
    core: { name: 'esp32:esp32', version: '3.3.2' },
    flash: 1310720,
    ram: 327680,
  },
  'arduino:avr:uno': {
    name: 'Arduino Uno R3',
    typeId: 'official:arduino-uno-r3',
    core: { name: 'arduino:avr', version: '1.8.6' },
    flash: 32256,
    ram: 2048,
  },
} as const;
export const unoDefinition: Definition = {
  typeId: 'official:arduino-uno-r3',
  version: '1.0.0',
  category: 'controller',
  name: 'Arduino Uno R3',
  model: 'ATmega328P · 16 MHz',
  moduleVersion: 'R3',
  unit: '個',
  source: 'https://docs.arduino.cc/hardware/uno-rev3/',
  physical: true,
  parameters: {},
  price: null,
  compileProfile: 'arduino:avr:uno',
  simulationAdapter: 'avr8js',
  pins: [
    { id: '5V', name: '5V', direction: 'power', required: false, voltage: [5, 5], interfaces: [] },
    {
      id: '3V3',
      name: '3V3',
      direction: 'power',
      required: false,
      voltage: [3.3, 3.3],
      interfaces: [],
    },
    { id: 'GND', name: 'GND', direction: 'ground', required: false, interfaces: [] },
    ...Array.from({ length: 20 }, (_, n) => ({
      id: n < 14 ? 'D' + n : 'A' + (n - 14),
      name: n < 14 ? 'D' + n : 'A' + (n - 14),
      direction: 'bidirectional' as const,
      required: false,
      interfaces: ['digital', ...(n >= 18 ? ['i2c'] : [])],
      voltage: [5, 5] as [number, number],
      gpio: n,
      capabilities: [
        'digitalInput',
        'digitalOutput',
        ...(n === 18 ? ['i2cSda'] : n === 19 ? ['i2cScl'] : []),
      ],
    })),
  ],
};
export const BUTTON_FIRMWARE =
  '#include "pinmap.h"\nvoid setup(){Serial.begin(115200);pinMode(LED_PIN,OUTPUT);pinMode(BUTTON_PIN,INPUT_PULLUP);Serial.println("READY");}\nvoid loop(){bool pressed=!digitalRead(BUTTON_PIN);digitalWrite(LED_PIN,pressed);Serial.println(pressed?"PRESSED":"RELEASED");delay(10);}\n';
export function changeBoard(s: Source, fqbn: string): Source {
  if (!(fqbn in boards)) throw new Error('尚未支援此板型');
  const selected = boards[fqbn as keyof typeof boards];
  const next = structuredClone(s),
    board = next.circuit.instances.find((i) => i.id === next.project.board)!;
  if (!board) throw new Error('找不到主控制板');
  if (board.typeId === selected.typeId && next.dependencies.fqbn === fqbn) return next;
  const map: Record<string, string> = {
    GPIO25: 'D13',
    GPIO26: 'D12',
    GPIO27: 'D2',
    GPIO21: 'A4',
    GPIO22: 'A5',
  };
  const toUno = fqbn === 'arduino:avr:uno',
    translate = (ref: string) => {
      if (!ref.startsWith(board.id + '.')) return ref;
      const pin = ref.slice(board.id.length + 1);
      if (['5V', '3V3', 'GND'].includes(pin)) return ref;
      const replacement = toUno ? map[pin] : Object.entries(map).find(([, p]) => p === pin)?.[0];
      if (!replacement) throw new Error('跨板型無法對應接腳 ' + ref + '；請先移除或手動整理此接線');
      return board.id + '.' + replacement;
    };
  next.circuit.nets = next.circuit.nets.map((n) => ({
    ...n,
    endpoints: n.endpoints.map(translate),
  }));
  next.circuit.bindings = next.circuit.bindings.map((b) => ({
    ...b,
    endpoint: translate(b.endpoint),
  }));
  for (const entry of Object.values(next.layout))
    if (entry.wireRoutes)
      entry.wireRoutes = entry.wireRoutes.map((route) => ({
        ...route,
        from: translate(route.from),
        to: translate(route.to),
      }));
  board.typeId = selected.typeId;
  board.definitionVersion = '1.0.0';
  if (toUno && !next.catalog.definitions.some((d) => d.typeId === unoDefinition.typeId))
    next.catalog.definitions.push(structuredClone(unoDefinition));
  next.dependencies.fqbn = fqbn;
  next.dependencies.core = { ...selected.core };
  next.dependencies.buildProperties = [];
  if (toUno && isEsp32DigitalStartup(next.extraFirmware[ESP32_STARTUP_FILE]))
    delete next.extraFirmware[ESP32_STARTUP_FILE];
  if (next.project.profile === 'oled') {
    next.firmware = toUno
      ? next.firmware.replace('Wire.begin(I2C_SDA, I2C_SCL);', 'Wire.begin();')
      : next.firmware.replace('Wire.begin();', 'Wire.begin(I2C_SDA, I2C_SCL);');
  }
  return next;
}
