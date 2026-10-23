import type { Source } from './model';
import { wireConnections, wireLayoutKey } from './graphics';

export function estimatedConsumables(s: Source) {
  const wires = s.circuit.nets.reduce(
    (count, net) =>
      count + wireConnections(net.endpoints, s.layout[wireLayoutKey(net.id)]?.wireRoutes).length,
    0,
  );
  return [
    { typeId: 'official:jumper', quantity: wires, note: '依接腳連線數估算，不含長度與接頭種類' },
    { typeId: 'official:header', quantity: null, note: '是否需焊接排針與排數，請自行確認' },
  ];
}
export function automaticWireColor(s: Source, endpoints: string[]) {
  const pins = endpoints.map((endpoint) => {
    const [id, pin] = endpoint.split('.');
    const instance = s.circuit.instances.find((instance) => instance.id === id);
    return [...s.catalog.definitions, ...s.custom]
      .find(
        (definition) =>
          definition.typeId === instance?.typeId &&
          definition.version === instance?.definitionVersion,
      )
      ?.pins.find((p) => p.id === pin);
  });
  if (pins.some((pin) => pin?.direction === 'ground')) return '#526377';
  if (pins.some((pin) => pin?.direction === 'power')) return '#cc6151';
  if (endpoints.some((endpoint) => /(?:SDA|A4)$/.test(endpoint))) return '#3c84b7';
  if (endpoints.some((endpoint) => /(?:SCL|A5)$/.test(endpoint))) return '#d1a03a';
  return '#3f9782';
}
