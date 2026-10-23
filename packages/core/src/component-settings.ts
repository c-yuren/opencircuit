import type { Definition, Instance } from './model';

export function componentName(definition: Definition) {
  return (
    (
      {
        'official:usb-supply': '電源',
        'official:resistor': '電阻',
        'official:capacitor': '電容',
        'official:led-red': 'LED',
      } as Record<string, string>
    )[definition.typeId] ?? definition.name
  );
}

export function validateComponentParameters(instance: Instance) {
  const p = instance.parameters;
  const positive = (value: unknown, name: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      throw new Error(name + '必須是大於零的數字');
  };
  if (instance.typeId === 'official:resistor' && p.resistance !== undefined)
    positive(p.resistance, '阻值');
  if (instance.typeId === 'official:usb-supply' && p.voltage !== undefined)
    positive(p.voltage, '電壓');
  if (
    instance.typeId === 'official:capacitor' &&
    p.capacitance !== undefined &&
    (typeof p.capacitance !== 'string' ||
      !/^(?:\d+(?:\.\d+)?|\.\d+)(?:pF|nF|uF)$/.test(p.capacitance) ||
      parseFloat(p.capacitance) <= 0)
  )
    throw new Error('容量必須是正數，單位為 pF、nF 或 uF');
  if (
    instance.typeId === 'official:led-red' &&
    p.color !== undefined &&
    (typeof p.color !== 'string' ||
      (!['red', 'green', 'blue', 'yellow', 'white'].includes(p.color) &&
        !/^#[\da-f]{6}$/i.test(p.color)))
  )
    throw new Error('請選擇有效的 LED 顏色');
}

export function instanceDefinition(definition: Definition, instance: Instance): Definition {
  if (definition.typeId !== 'official:usb-supply') return definition;
  const voltage = Number(instance.parameters.voltage ?? definition.parameters.voltage ?? 5);
  return {
    ...definition,
    pins: definition.pins.map((pin) =>
      pin.direction === 'power' ? { ...pin, name: '+', voltage: [voltage, voltage] } : pin,
    ),
  };
}
