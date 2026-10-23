import { renderToStaticMarkup } from 'react-dom/server';
import { getSmoothStepPath, Position } from '@xyflow/react';
import type { Source } from '../../../packages/core/src/model';
import {
  transformedGeometry,
  wireConnections,
  wireLayoutKey,
  orthogonalPoints,
  wirePath,
} from '../../../packages/core/src/graphics';
import { automaticWireColor } from '../../../packages/core/src/planning';
import { HardwareArt } from './HardwareArt';
import { componentName, instanceDefinition } from '../../../packages/core/src/component-settings';
import { t } from './i18n';

export function circuitSvg(source: Source) {
  const parts = source.circuit.instances.map((instance) => {
    const definition = [...source.catalog.definitions, ...source.custom].find(
      (definition) =>
        definition.typeId === instance.typeId && definition.version === instance.definitionVersion,
    )!;
    const entry = source.layout[instance.id] ?? { x: 100, y: 100 };
    return { instance, definition, entry, geometry: transformedGeometry(definition, entry) };
  });
  const terminal = (ref: string) => {
    const [id, pin] = ref.split('.'),
      part = parts.find((part) => part.instance.id === id)!;
    const position = part.geometry.pins[pin];
    return { x: part.entry.x + position.x, y: part.entry.y + position.y, side: position.side };
  };
  const sides = {
    left: Position.Left,
    right: Position.Right,
    top: Position.Top,
    bottom: Position.Bottom,
  };
  const wires = source.circuit.nets.flatMap((net) =>
    wireConnections(net.endpoints, source.layout[wireLayoutKey(net.id)]?.wireRoutes).map(
      (route, index) => {
        const a = terminal(route.from),
          b = terminal(route.to),
          entry = {
            ...(source.layout[wireLayoutKey(net.id)] ?? { x: 0, y: 0 }),
            color: route.color ?? source.layout[wireLayoutKey(net.id)]?.color,
            wireWidth: route.wireWidth ?? source.layout[wireLayoutKey(net.id)]?.wireWidth,
          };
        const points = route.points.length ? route.points : entry?.wireBend ? [entry.wireBend] : [];
        const path = points.length
          ? wirePath(orthogonalPoints(a, [...points, b], a.side === 'top' || a.side === 'bottom'))
          : getSmoothStepPath({
              sourceX: a.x,
              sourceY: a.y,
              targetX: b.x,
              targetY: b.y,
              sourcePosition: sides[a.side],
              targetPosition: sides[b.side],
              borderRadius: 0,
              offset: 22,
            })[0];
        const coordinates = (path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
        return { net, entry, index, path, coordinates, a, label: route.name ?? net.name };
      },
    ),
  );
  const bounds = parts.map((part) => {
    const labelMargin = Math.max(
      40,
      ((part.entry.label ?? part.definition.name).length * 14 - part.geometry.width) / 2,
    );
    return {
      x: part.entry.x - labelMargin,
      y: part.entry.y - 30,
      right: part.entry.x + part.geometry.width + labelMargin,
      bottom: part.entry.y + part.geometry.height + 65,
    };
  });
  for (const entry of Object.values(source.layout).filter((entry) => entry.kind === 'zone'))
    bounds.push({
      x: entry.x,
      y: entry.y,
      right: entry.x + (entry.width ?? 460),
      bottom: entry.y + (entry.height ?? 300),
    });
  for (const wire of wires)
    for (let at = 0; at < wire.coordinates.length; at += 2)
      bounds.push({
        x: wire.coordinates[at] - 100,
        y: wire.coordinates[at + 1] - 30,
        right: wire.coordinates[at] + Math.max(100, wire.net.name.length * 9),
        bottom: wire.coordinates[at + 1] + 30,
      });
  if (!bounds.length) bounds.push({ x: 0, y: 0, right: 600, bottom: 400 });
  const x = Math.min(...bounds.map((bound) => bound.x)) - 30,
    y = Math.min(...bounds.map((bound) => bound.y)) - 30;
  const width = Math.ceil(Math.max(...bounds.map((bound) => bound.right)) - x + 30),
    height = Math.ceil(Math.max(...bounds.map((bound) => bound.bottom)) - y + 30);
  const svg = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`${x} ${y} ${width} ${height}`}
    >
      <title>{source.project.name}</title>
      <rect x={x} y={y} width={width} height={height} fill="#fff" />
      {Object.entries(source.layout)
        .filter(([, entry]) => entry.kind === 'zone')
        .map(([id, entry]) => (
          <g key={id}>
            <rect
              x={entry.x}
              y={entry.y}
              width={entry.width ?? 460}
              height={entry.height ?? 300}
              fill="none"
              stroke={entry.color ?? '#58877b'}
              strokeDasharray="6 4"
            />
            <text x={entry.x + 12} y={entry.y + 22} fontSize={14} fill="#243c3c">
              {entry.label ?? t('區域')}
            </text>
          </g>
        ))}
      {parts.map((part) => (
        <g key={part.instance.id} transform={`translate(${part.entry.x} ${part.entry.y})`}>
          <g transform={`scale(${part.geometry.scale}) ${part.geometry.transform}`}>
            <HardwareArt
              definition={instanceDefinition(part.definition, part.instance)}
              parameters={part.instance.parameters}
            />
          </g>
          <text
            x={part.geometry.width / 2}
            y={part.geometry.height + 22}
            textAnchor="middle"
            fontSize={14}
            fill="#243c3c"
          >
            {part.entry.label ?? t(componentName(part.definition))}
          </text>
          {Object.entries(part.geometry.pins).map(([id, pin]) => (
            <g key={id}>
              <circle cx={pin.x} cy={pin.y} r={3} fill="#d9b653" stroke="#725c23" />
              <text
                x={pin.x + (pin.side === 'left' ? -8 : 8)}
                y={pin.y - 6}
                textAnchor={pin.side === 'left' ? 'end' : 'start'}
                fontSize={10}
                fill="#243c3c"
              >
                {id}
              </text>
            </g>
          ))}
        </g>
      ))}
      {wires.map((wire) => (
        <g key={wire.net.id + wire.index}>
          <path
            d={wire.path}
            fill="none"
            stroke={wire.entry?.color ?? automaticWireColor(source, wire.net.endpoints)}
            strokeWidth={wire.entry?.wireWidth ?? 3}
          />
          {
            <text x={wire.a.x + 12} y={wire.a.y - 12} fontSize={11} fill="#243c3c">
              {wire.label}
            </text>
          }
        </g>
      ))}
    </svg>,
  );
  return { svg, width, height };
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadCircuit(source: Source, format: 'svg' | 'png') {
  const { svg, width, height } = circuitSvg(source),
    blob = new Blob([svg], { type: 'image/svg+xml' });
  if (format === 'svg') return downloadBlob('OpenCircuit-circuit.svg', blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(t('電路圖圖片無法載入，請改用 SVG。')));
      image.src = url;
    });
    const scale = Math.min(1, 4096 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('瀏覽器不能產生 PNG，請改用 SVG。'));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t('PNG 匯出失敗')))),
        'image/png',
      ),
    );
    downloadBlob('OpenCircuit-circuit.png', png);
  } finally {
    URL.revokeObjectURL(url);
  }
}
