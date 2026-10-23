export type Status = 'open' | 'draft' | 'checking' | 'ready' | 'failed' | 'conflict' | 'applied';
export type ResultState = 'pass' | 'fail' | 'unknown' | 'not_run';
export type Category =
  | 'controller'
  | 'sensor'
  | 'output'
  | 'power'
  | 'passive'
  | 'connector'
  | 'consumable';
export interface Price {
  low: number;
  high: number;
  currency: string;
  packSize: number;
  basis: 'pack' | 'piece';
  date: string;
  source: string;
  demo: boolean;
}
export interface Pin {
  id: string;
  name: string;
  direction: 'input' | 'output' | 'bidirectional' | 'passive' | 'power' | 'ground';
  interfaces: string[];
  required: boolean;
  voltage?: [number, number];
  gpio?: number;
  capabilities?: string[];
}
export interface Definition {
  typeId: string;
  version: string;
  category: Category;
  name: string;
  model: string;
  moduleVersion: string;
  unit: string;
  source: string;
  physical: boolean;
  pins: Pin[];
  parameters: Record<string, string | number | boolean>;
  price: Price | null;
  driver?: { name: string; version: string };
  compileProfile?: string;
  simulationAdapter?: string;
  fixedAddress?: number;
  visual?: ComponentVisual;
}
export type GraphicPreset =
  | 'uno'
  | 'esp32'
  | 'led'
  | 'resistor'
  | 'oled'
  | 'dht'
  | 'button'
  | 'mpu'
  | 'buzzer'
  | 'breadboard'
  | 'jumper'
  | 'supply'
  | 'capacitor'
  | 'header'
  | 'ground'
  | 'generic';
export interface ComponentVisual {
  preset?: GraphicPreset;
  image?: string;
  width: number;
  height: number;
  pinPositions: Record<
    string,
    { x: number; y: number; side?: 'left' | 'right' | 'top' | 'bottom' }
  >;
}
export interface LayoutEntry {
  x: number;
  y: number;
  kind?: 'component' | 'zone' | 'wire';
  rotation?: 0 | 90 | 180 | 270;
  scale?: number;
  labels?: boolean;
  label?: string;
  color?: string;
  width?: number;
  height?: number;
  wireStyle?: 'orthogonal' | 'straight' | 'curve';
  wireWidth?: number;
  wireBend?: { x: number; y: number };
  wireRoutes?: WireRoute[];
}
export interface WireRoute {
  from: string;
  to: string;
  points: { x: number; y: number }[];
  name?: string;
  color?: string;
  wireWidth?: number;
}
export type WireRef = Pick<WireRoute, 'from' | 'to'>;
export interface Instance {
  id: string;
  typeId: string;
  definitionVersion: string;
  parameters: Record<string, string | number | boolean>;
  quantity: number;
}
export interface Net {
  id: string;
  name: string;
  endpoints: string[];
}
export interface Binding {
  name: string;
  kind: 'digitalOutput' | 'digitalInput' | 'i2cSda' | 'i2cScl';
  endpoint: string;
}
export interface Circuit {
  instances: Instance[];
  nets: Net[];
  bindings: Binding[];
}
export interface Project {
  formatVersion: 1;
  name: string;
  board: string;
  catalogVersion: string;
  profile: 'led' | 'oled' | 'temperature' | 'custom';
}
export interface Procurement {
  currency: string;
  budget: number | null;
  reserve: number;
  missingMaterials: string[];
  inventory: Record<string, { quantity: number; usable: boolean }>;
  overrides: Record<string, Price>;
  manual: ({ id: string; instanceRefs: string[] } & Instance)[];
  locked: string[];
  requiredFeatures: string[];
  substitutable: string[];
}
export interface Comment {
  id: string;
  target: { kind: 'instance' | 'pin' | 'net'; id: string };
  text: string;
  baseRevision: string;
  status: 'open' | 'resolved';
}
export interface Dependencies {
  fqbn: string;
  core: { name: string; version: string };
  libraries: { name: string; version: string }[];
  buildProperties: string[];
}
export interface Source {
  project: Project;
  circuit: Circuit;
  layout: Record<string, LayoutEntry>;
  catalog: { version: string; definitions: Definition[] };
  custom: Definition[];
  procurement: Procurement;
  comments: Comment[];
  dependencies: Dependencies;
  firmware: string;
  extraFirmware: Record<string, string>;
}
export interface Diagnostic {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  state: ResultState;
  target: string;
  relatedTargets?: string[];
  reason: string;
  basis: string;
  action: string;
  inputDigest: string;
}
export interface BomRow {
  key: string;
  category: Category;
  name: string;
  model: string;
  moduleVersion: string;
  unit: string;
  demand: number;
  owned: number;
  toBuy: number;
  packages: number | null;
  price: Price | null;
  subtotal: [number, number] | null;
  materialValue: [number, number] | null;
  sources: string[];
  locked: boolean;
}
export interface Bom {
  currency: string;
  rows: BomRow[];
  spend: [number, number];
  materialValue: [number, number];
  incomplete: boolean;
  materialValueIncomplete: boolean;
  missing: string[];
  overBudget: boolean;
  budgetState: 'unset' | 'within' | 'possible' | 'over' | 'incomplete';
  budget: number | null;
  reserve: number;
  inputDigest: string;
}
export interface BuildResult {
  state: ResultState;
  version: string | null;
  fqbn: string;
  dependencies: Dependencies;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  inputDigest: string;
  durationMs: number;
  artifacts: { path: string; size: number; sha256: string }[];
  startedAt: string;
  cachedFrom?: string;
  reason?: string;
  toolDigest?: string;
  cancelled?: boolean;
  timedOut?: boolean;
}
export interface Snapshot {
  id: string;
  baseRevision: string;
  sourceDigest: string;
  electricalDigest: string;
  costDigest: string;
  createdAt: string;
  files: Record<string, string>;
  diagnostics: Diagnostic[];
  build: BuildResult;
  bom: Bom;
  status: Status;
  restoredFrom?: string;
}
export interface Current {
  revision: string;
  draft: string | null;
  selection: Comment['target'] | null;
  status: Status;
}
