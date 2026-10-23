import type { ComponentVisual, Definition, GraphicPreset, LayoutEntry, WireRoute } from './model';

export const canvasGridSize = 20;
export function snapCanvasPoint(point: { x: number; y: number }) {
  return {
    x: Math.round(point.x / canvasGridSize) * canvasGridSize,
    y: Math.round(point.y / canvasGridSize) * canvasGridSize,
  };
}

export const boardLeft = [
  '3V3',
  'EN',
  'GPIO36',
  'GPIO39',
  'GPIO34',
  'GPIO35',
  'GPIO32',
  'GPIO33',
  'GPIO25',
  'GPIO26',
  'GPIO27',
  'GPIO14',
  'GPIO12',
  'GND',
  'GPIO13',
  'SD2',
  'SD3',
  'CMD',
  '5V',
];
export const boardRight = [
  'GND',
  'GPIO23',
  'GPIO22',
  'GPIO1',
  'GPIO3',
  'GPIO21',
  'GND',
  'GPIO19',
  'GPIO18',
  'GPIO5',
  'GPIO17',
  'GPIO16',
  'GPIO4',
  'GPIO0',
  'GPIO2',
  'GPIO15',
  'SD1',
  'SD0',
  'CLK',
];
const presets: Record<string, GraphicPreset> = {
  'arduino-uno-r3': 'uno',
  'esp32-devkitc-v4': 'esp32',
  'led-red': 'led',
  resistor: 'resistor',
  'ssd1306-oled': 'oled',
  'ssd1306-oled-5v': 'oled',
  dht22: 'dht',
  'dht22-5v': 'dht',
  button: 'button',
  mpu6050: 'mpu',
  'mpu6050-5v': 'mpu',
  buzzer: 'buzzer',
  breadboard: 'breadboard',
  jumper: 'jumper',
  'usb-supply': 'supply',
  capacitor: 'capacitor',
  header: 'header',
  ground: 'ground',
};
const sizes: Record<GraphicPreset, [number, number]> = {
  uno: [320, 220],
  esp32: [220, 392],
  led: [88, 128],
  resistor: [184, 72],
  oled: [190, 176],
  dht: [114, 166],
  button: [88, 88],
  mpu: [140, 138],
  buzzer: [108, 116],
  breadboard: [316, 188],
  jumper: [174, 84],
  supply: [150, 128],
  capacitor: [90, 100],
  header: [174, 68],
  ground: [68, 68],
  generic: [180, 140],
};
export function defaultVisual(d: Definition): ComponentVisual {
  const preset = presets[d.typeId.split(':')[1]] ?? 'generic';
  const [width, height] =
    preset === 'generic'
      ? [180, Math.max(140, Math.ceil(d.pins.length / 2) * 22 + 50)]
      : sizes[preset];
  const pinPositions: ComponentVisual['pinPositions'] = {};
  const put = (id: string, x: number, y: number, side: 'left' | 'right' | 'top' | 'bottom') => {
    if (d.pins.some((p) => p.id === id)) pinPositions[id] = { x: x / width, y: y / height, side };
  };
  if (preset === 'uno') {
    for (let n = 0; n < 14; n++) put('D' + n, 85 + (13 - n) * 15, 18, 'top');
    for (let n = 0; n < 6; n++) put('A' + n, 190 + n * 16, 202, 'bottom');
    put('3V3', 96, 202, 'bottom');
    put('5V', 112, 202, 'bottom');
    put('GND', 128, 202, 'bottom');
  } else if (preset === 'esp32') {
    boardLeft.forEach((p, index) => put(p, 18, 64 + index * 15, 'left'));
    boardRight.forEach((p, index) => {
      if (p !== 'GND') put(p, 202, 64 + index * 15, 'right');
    });
  } else if (preset === 'led') {
    put('A', 31, 117, 'bottom');
    put('K', 58, 109, 'bottom');
  } else if (preset === 'resistor') {
    put('A', 12, 36, 'left');
    put('B', 172, 36, 'right');
  } else if (preset === 'oled') {
    ['GND', 'VCC', 'SCL', 'SDA'].forEach((p, i) => put(p, 47 + i * 32, 15, 'top'));
  } else if (preset === 'dht') {
    ['VCC', 'DATA', 'GND'].forEach((p, i) => put(p, 27 + i * 30, 153, 'bottom'));
  } else if (preset === 'mpu') {
    ['VCC', 'GND', 'SCL', 'SDA'].forEach((p, i) => put(p, 25 + i * 30, 125, 'bottom'));
  } else if (preset === 'button') {
    put('A', 9, 44, 'left');
    put('B', 79, 44, 'right');
  } else if (preset === 'buzzer') {
    put('SIG', 34, 104, 'bottom');
    put('GND', 74, 104, 'bottom');
  } else if (preset === 'capacitor') {
    put('A', 30, 88, 'bottom');
    put('B', 60, 88, 'bottom');
  } else if (preset === 'supply') {
    put('5V', 139, 45, 'right');
    put('GND', 139, 82, 'right');
  } else if (preset === 'ground') put('GND', 34, 8, 'top');
  d.pins.forEach((p, index) => {
    if (!pinPositions[p.id])
      pinPositions[p.id] = {
        x: index % 2 ? 0.95 : 0.05,
        y: (32 + Math.floor(index / 2) * 22) / height,
        side: index % 2 ? 'right' : 'left',
      };
  });
  return { preset, width, height, pinPositions };
}
export function componentVisual(d: Definition): ComponentVisual {
  const base = defaultVisual(d);
  return {
    ...base,
    ...d.visual,
    pinPositions: { ...base.pinPositions, ...d.visual?.pinPositions },
  };
}
export function transformedGeometry(d: Definition, entry: LayoutEntry = { x: 0, y: 0 }) {
  const visual = componentVisual(d),
    rotation = entry.rotation ?? 0,
    scale = entry.scale ?? 1;
  const width = (rotation % 180 ? visual.height : visual.width) * scale,
    height = (rotation % 180 ? visual.width : visual.height) * scale;
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const pins = Object.fromEntries(
    Object.entries(visual.pinPositions).map(([id, p]) => {
      let x = p.x * visual.width,
        y = p.y * visual.height;
      if (rotation === 90) [x, y] = [visual.height - y, x];
      else if (rotation === 180) [x, y] = [visual.width - x, visual.height - y];
      else if (rotation === 270) [x, y] = [y, visual.width - x];
      const side = sides[(sides.indexOf(p.side ?? 'left') + rotation / 90) % 4];
      return [id, { x: x * scale, y: y * scale, side }];
    }),
  );
  const transform =
    rotation === 90
      ? `translate(${visual.height} 0) rotate(90)`
      : rotation === 180
        ? `translate(${visual.width} ${visual.height}) rotate(180)`
        : rotation === 270
          ? `translate(0 ${visual.width}) rotate(270)`
          : 'rotate(0)';
  return { visual, width, height, pins, transform, scale };
}
export const wireLayoutKey = (netId: string) => '@wire:' + netId;
export const sameWire = (a: { from: string; to: string }, b: { from: string; to: string }) =>
  (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);

export function orthogonalPoints(
  start: { x: number; y: number },
  stops: { x: number; y: number }[],
  vertical = false,
) {
  const result = [start];
  for (const stop of stops) {
    const previous = result[result.length - 1];
    const elbow = vertical ? { x: previous.x, y: stop.y } : { x: stop.x, y: previous.y };
    for (const point of [elbow, stop]) {
      const last = result[result.length - 1];
      if (last.x !== point.x || last.y !== point.y) result.push(point);
    }
  }
  return result;
}
export const wirePath = (points: { x: number; y: number }[]) =>
  points.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join('');

// Keep drawn branches, then connect any remaining endpoints without duplicating branches.
export function wireConnections(endpoints: string[], routes: WireRoute[] = []): WireRoute[] {
  const parent = new Map(endpoints.map((endpoint) => [endpoint, endpoint]));
  const root = (endpoint: string): string => {
    const next = parent.get(endpoint)!;
    return next === endpoint ? endpoint : root(next);
  };
  const connections: WireRoute[] = [];
  for (const route of routes) {
    if (
      !parent.has(route.from) ||
      !parent.has(route.to) ||
      route.from === route.to ||
      connections.some((saved) => sameWire(saved, route))
    )
      continue;
    connections.push(route);
    parent.set(root(route.to), root(route.from));
  }
  for (const endpoint of endpoints.slice(1)) {
    if (root(endpoint) === root(endpoints[0])) continue;
    connections.push({ from: endpoints[0], to: endpoint, points: [] });
    parent.set(root(endpoint), root(endpoints[0]));
  }
  return connections;
}
