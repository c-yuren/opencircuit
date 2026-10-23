import Ajv from 'ajv';
import type { Source } from './model';
import { validateComponentParameters } from './component-settings';
const str = { type: 'string', minLength: 1 };
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' };
const version = { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' };
const uint = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const positive = { type: 'integer', minimum: 1, maximum: 1000000 };
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const arr = (items: unknown) => ({ type: 'array', items });
const record = (additionalProperties: unknown) => ({ type: 'object', additionalProperties });
const params = record({ type: ['string', 'number', 'boolean'] });
export const priceSchema = obj({
  low: uint,
  high: uint,
  currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  packSize: positive,
  basis: { enum: ['pack', 'piece'] },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  source: str,
  demo: { type: 'boolean' },
});
const pin = obj(
  {
    id: { type: 'string', pattern: '^[A-Za-z0-9_]+$' },
    name: str,
    direction: { enum: ['input', 'output', 'bidirectional', 'passive', 'power', 'ground'] },
    interfaces: arr(str),
    required: { type: 'boolean' },
    voltage: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2, maxItems: 2 },
    gpio: uint,
    capabilities: arr(str),
  },
  ['id', 'name', 'direction', 'interfaces', 'required'],
);
export const visualSchema = obj(
  {
    preset: {
      enum: [
        'uno',
        'esp32',
        'led',
        'resistor',
        'oled',
        'dht',
        'button',
        'mpu',
        'buzzer',
        'breadboard',
        'jumper',
        'supply',
        'capacitor',
        'header',
        'ground',
        'generic',
      ],
    },
    image: {
      type: 'string',
      pattern: '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$',
      maxLength: 2800000,
    },
    width: { type: 'number', minimum: 40, maximum: 600 },
    height: { type: 'number', minimum: 40, maximum: 600 },
    pinPositions: record(
      obj(
        {
          x: { type: 'number', minimum: 0, maximum: 1 },
          y: { type: 'number', minimum: 0, maximum: 1 },
          side: { enum: ['left', 'right', 'top', 'bottom'] },
        },
        ['x', 'y'],
      ),
    ),
  },
  ['width', 'height', 'pinPositions'],
);
export const definitionSchema = obj(
  {
    typeId: { type: 'string', pattern: '^(official|custom):[A-Za-z0-9_-]+$' },
    version,
    category: {
      enum: ['controller', 'sensor', 'output', 'power', 'passive', 'connector', 'consumable'],
    },
    name: str,
    model: str,
    moduleVersion: str,
    unit: str,
    source: str,
    physical: { type: 'boolean' },
    pins: arr(pin),
    parameters: params,
    price: { anyOf: [priceSchema, { type: 'null' }] },
    driver: obj({ name: str, version }),
    compileProfile: str,
    simulationAdapter: str,
    fixedAddress: { type: 'integer', minimum: 0, maximum: 127 },
    visual: visualSchema,
  },
  [
    'typeId',
    'version',
    'category',
    'name',
    'model',
    'moduleVersion',
    'unit',
    'source',
    'physical',
    'pins',
    'parameters',
    'price',
  ],
);
const instanceProperties = {
  id,
  typeId: str,
  definitionVersion: version,
  parameters: params,
  quantity: uint,
};
export const schemas = {
  project: obj({
    formatVersion: { const: 1 },
    name: str,
    board: { type: 'string' },
    catalogVersion: version,
    profile: { enum: ['led', 'oled', 'temperature', 'custom'] },
  }),
  circuit: obj({
    instances: arr(obj(instanceProperties)),
    nets: arr(
      obj({
        id,
        name: str,
        endpoints: {
          type: 'array',
          items: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]*\\.[A-Za-z0-9_]+$' },
          uniqueItems: true,
          minItems: 2,
        },
      }),
    ),
    bindings: arr(
      obj({
        name: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' },
        kind: { enum: ['digitalOutput', 'digitalInput', 'i2cSda', 'i2cScl'] },
        endpoint: str,
      }),
    ),
  }),
  layout: record(
    obj(
      {
        x: { type: 'number' },
        y: { type: 'number' },
        kind: { enum: ['component', 'zone', 'wire'] },
        rotation: { enum: [0, 90, 180, 270] },
        scale: { type: 'number', minimum: 0.5, maximum: 2 },
        labels: { type: 'boolean' },
        label: { type: 'string', maxLength: 120 },
        color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        width: { type: 'number', minimum: 100, maximum: 2000 },
        height: { type: 'number', minimum: 80, maximum: 2000 },
        wireStyle: { enum: ['orthogonal', 'straight', 'curve'] },
        wireWidth: { type: 'integer', minimum: 1, maximum: 6 },
        wireBend: obj({ x: { type: 'number' }, y: { type: 'number' } }),
        wireRoutes: arr(
          obj(
            {
              from: str,
              to: str,
              points: arr(obj({ x: { type: 'number' }, y: { type: 'number' } })),
              name: str,
              color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
              wireWidth: { type: 'integer', minimum: 1, maximum: 6 },
            },
            ['from', 'to', 'points'],
          ),
        ),
      },
      ['x', 'y'],
    ),
  ),
  catalog: obj({ version, definitions: arr(definitionSchema) }),
  custom: arr(definitionSchema),
  procurement: obj({
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    budget: { anyOf: [uint, { type: 'null' }] },
    reserve: uint,
    missingMaterials: arr(str),
    inventory: record(obj({ quantity: uint, usable: { type: 'boolean' } })),
    overrides: record(priceSchema),
    manual: arr(obj({ ...instanceProperties, instanceRefs: arr(str) })),
    locked: arr(str),
    requiredFeatures: arr(str),
    substitutable: arr(str),
  }),
  comments: arr(
    obj({
      id,
      target: obj({ kind: { enum: ['instance', 'pin', 'net'] }, id: str }),
      text: str,
      baseRevision: str,
      status: { enum: ['open', 'resolved'] },
    }),
  ),
  dependencies: obj({
    fqbn: { type: 'string', pattern: '^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' },
    core: obj({ name: { type: 'string', pattern: '^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' }, version }),
    libraries: arr(obj({ name: { type: 'string', pattern: '^[A-Za-z0-9 _.-]+$' }, version })),
    buildProperties: arr({
      type: 'string',
      pattern:
        '^build\\.(partitions=(default|huge_app|min_spiffs|no_ota)|flash_size=(4MB|8MB|16MB)|f_cpu=(80000000L|160000000L|240000000L)|boot=(dio|qio)|flash_mode=(dio|qio))$',
    }),
  }),
  firmware: { type: 'string' },
  extraFirmware: record({ type: 'string' }),
};
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(obj(schemas));
const defValidate = ajv.compile(definitionSchema);
export function validateDefinition(value: unknown): asserts value is import('./model').Definition {
  if (!defValidate(value)) throw new Error('元件格式錯誤：' + ajv.errorsText(defValidate.errors));
  const d = value as unknown as import('./model').Definition;
  if (new Set(d.pins.map((p) => p.id)).size !== d.pins.length) throw new Error('接腳 ID 重複');
  for (const p of d.pins)
    if (p.voltage && p.voltage[0] > p.voltage[1]) throw new Error('接腳電壓範圍顛倒');
  for (const pinId of Object.keys(d.visual?.pinPositions ?? {}))
    if (!d.pins.some((p) => p.id === pinId))
      throw new Error('圖片接腳位置引用不存在的 pin ID：' + pinId);
  if (d.price) validatePrice(d.price);
}
export function validatePrice(p: import('./model').Price) {
  if (p.low > p.high) throw new Error('價格下限不可大於上限');
  if (p.basis === 'piece' && p.packSize !== 1) throw new Error('每件計價的包裝量必須為 1');
}
export function validateSource(value: unknown): asserts value is Source {
  if (!validate(value)) throw new Error('專案格式錯誤：' + ajv.errorsText(validate.errors));
  const s = value as unknown as Source;
  const unique = (a: string[], name: string) => {
    if (new Set(a).size !== a.length) throw new Error(name + ' ID 重複');
  };
  unique(
    s.circuit.instances.map((i) => i.id),
    '元件',
  );
  unique(
    s.circuit.nets.map((n) => n.id),
    '網路',
  );
  unique(
    s.circuit.bindings.map((b) => b.name),
    '訊號',
  );
  unique(
    s.comments.map((c) => c.id),
    '留言',
  );
  unique(
    s.procurement.manual.map((c) => c.id),
    '手動材料',
  );
  const defs = [...s.catalog.definitions, ...s.custom];
  unique(
    defs.map((d) => d.typeId + '@' + d.version),
    '定義',
  );
  defs.forEach(validateDefinition);
  s.circuit.instances.forEach(validateComponentParameters);
  if (
    s.catalog.definitions.some((d) => !d.typeId.startsWith('official:')) ||
    s.custom.some((d) => !d.typeId.startsWith('custom:'))
  )
    throw new Error('官方與自訂命名空間不可混用');
  Object.values(s.procurement.overrides).forEach(validatePrice);
}
