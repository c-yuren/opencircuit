import type { Definition, Pin, Source, Instance } from './model';
import { unoDefinition } from './boards';
const espSource =
  'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/hw-reference/esp32/get-started-devkitc.html';
const pin = (
  id: string,
  direction: Pin['direction'],
  required = true,
  interfaces: string[] = [],
  voltage?: [number, number],
): Pin => ({ id, name: id, direction, required, interfaces, ...(voltage ? { voltage } : {}) });
const power = () => [pin('VCC', 'power', true, [], [3.3, 3.3]), pin('GND', 'ground')];
const def = (
  slug: string,
  name: string,
  model: string,
  category: Definition['category'],
  pins: Pin[] = [],
  extra: Partial<Definition> = {},
): Definition => ({
  typeId: `official:${slug}`,
  version: '1.0.0',
  category,
  name,
  model,
  moduleVersion: '1',
  unit: '個',
  source: 'OpenCircuit 手動定義；使用前核對實際模組',
  physical: true,
  pins,
  parameters: {},
  price: null,
  ...extra,
});
export const catalog: Source['catalog'] = {
  version: '1.0.0',
  definitions: [
    def(
      'esp32-devkitc-v4',
      'ESP32 開發板',
      'ESP32-DevKitC V4 / WROOM-32E',
      'controller',
      [
        pin('3V3', 'power', false, [], [3.3, 3.3]),
        pin('5V', 'power', false, [], [5, 5]),
        pin('GND', 'ground', false),
        ...[
          0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35,
          36, 39,
        ].map((n) => ({
          ...pin(
            'GPIO' + n,
            n >= 34 ? 'input' : 'bidirectional',
            false,
            ['digital', ...(n < 34 ? ['i2c'] : [])],
            [3.3, 3.3],
          ),
          gpio: n,
          capabilities:
            n >= 34 ? ['digitalInput'] : ['digitalInput', 'digitalOutput', 'i2cSda', 'i2cScl'],
        })),
      ],
      { moduleVersion: 'V4 / WROOM-32E', source: espSource, compileProfile: 'esp32:esp32:esp32' },
    ),
    def('led-red', '紅色 LED', '5mm red LED', 'output', [pin('A', 'input'), pin('K', 'ground')], {
      parameters: { color: 'red' },
      source: 'https://www.kingbrightusa.com/images/catalog/SPEC/WP7113ID.pdf',
      compileProfile: 'led',
    }),
    def(
      'resistor',
      '限流電阻',
      'Through-hole resistor',
      'passive',
      [pin('A', 'passive'), pin('B', 'passive')],
      { parameters: { resistance: 220 }, source: 'https://www.vishay.com/docs/28729/mba0204.pdf' },
    ),
    def(
      'ssd1306-oled',
      'OLED 顯示模組',
      'SSD1306 128×64 I2C breakout',
      'output',
      [
        ...power(),
        pin('SDA', 'bidirectional', true, ['i2cSda'], [3.3, 3.3]),
        pin('SCL', 'input', true, ['i2cScl'], [3.3, 3.3]),
      ],
      {
        parameters: { address: 60, width: 128, height: 64 },
        source: 'https://learn.adafruit.com/monochrome-oled-breakouts/wiring-128x64-oleds',
        driver: { name: 'Adafruit SSD1306', version: '2.5.13' },
        compileProfile: 'oled',
      },
    ),
    def(
      'dht22',
      '溫濕度模組',
      'DHT22 breakout with pull-up',
      'sensor',
      [...power(), pin('DATA', 'bidirectional', true, ['digital'], [3.3, 3.3])],
      {
        source: 'https://learn.adafruit.com/dht/connecting-to-a-dhtxx-sensor',
        driver: { name: 'DHT sensor library', version: '1.4.6' },
        compileProfile: 'temperature',
      },
    ),
    def('button', '按鈕', 'Momentary switch', 'sensor', [pin('A', 'passive'), pin('B', 'passive')]),
    def(
      'mpu6050',
      '六軸慣性感測模組',
      'MPU6050 3.3V breakout',
      'sensor',
      [
        ...power(),
        pin('SDA', 'bidirectional', true, ['i2cSda'], [3.3, 3.3]),
        pin('SCL', 'input', true, ['i2cScl'], [3.3, 3.3]),
      ],
      {
        parameters: { address: 104 },
        source: 'https://invensense.tdk.com/products/motion-tracking/6-axis/mpu-6050/',
      },
    ),
    def('buzzer', '被動蜂鳴器', 'Passive piezo buzzer', 'output', [
      pin('SIG', 'input'),
      pin('GND', 'ground'),
    ]),
    def('breadboard', '麵包板', '400 tie points', 'connector', [], { unit: '片' }),
    def('jumper', '杜邦線', 'Male–male jumper', 'consumable', [], { unit: '條' }),
    def('usb-supply', 'USB 電源供應器', '5V USB supply', 'power', [
      pin('5V', 'power', false, [], [5, 5]),
      pin('GND', 'ground', false),
    ]),
    def(
      'capacitor',
      '陶瓷電容',
      '100nF ceramic',
      'passive',
      [pin('A', 'passive'), pin('B', 'passive')],
      { parameters: { capacitance: '100nF' } },
    ),
    def('header', '排針', '2.54mm header', 'connector', [], { unit: '排' }),
    def('ground', '接地符號', 'GND symbol', 'power', [pin('GND', 'ground', false)], {
      physical: false,
    }),
    unoDefinition,
    // 5V-tolerant variants (onboard regulator and pull-ups), usable with 5V boards such as Uno.
    def(
      'ssd1306-oled-5v',
      'OLED 顯示模組（3.3–5V）',
      'SSD1306 128×64 I2C breakout, onboard regulator',
      'output',
      [
        pin('VCC', 'power', true, [], [3.3, 5]),
        pin('GND', 'ground'),
        pin('SDA', 'bidirectional', true, ['i2cSda'], [3.3, 5]),
        pin('SCL', 'input', true, ['i2cScl'], [3.3, 5]),
      ],
      {
        parameters: { address: 60, width: 128, height: 64 },
        source: 'https://learn.adafruit.com/monochrome-oled-breakouts/wiring-128x64-oleds',
        driver: { name: 'Adafruit SSD1306', version: '2.5.13' },
        compileProfile: 'oled',
      },
    ),
    def(
      'dht22-5v',
      '溫濕度模組（3.3–5V）',
      'DHT22 breakout with pull-up, 3.3–5V',
      'sensor',
      [
        pin('VCC', 'power', true, [], [3.3, 5]),
        pin('GND', 'ground'),
        pin('DATA', 'bidirectional', true, ['digital'], [3.3, 5]),
      ],
      {
        source: 'https://learn.adafruit.com/dht/connecting-to-a-dhtxx-sensor',
        driver: { name: 'DHT sensor library', version: '1.4.6' },
        compileProfile: 'temperature',
      },
    ),
    def(
      'mpu6050-5v',
      '六軸慣性感測模組（3.3–5V）',
      'GY-521 MPU6050 breakout, onboard regulator',
      'sensor',
      [
        pin('VCC', 'power', true, [], [3.3, 5]),
        pin('GND', 'ground'),
        pin('SDA', 'bidirectional', true, ['i2cSda'], [3.3, 5]),
        pin('SCL', 'input', true, ['i2cScl'], [3.3, 5]),
      ],
      {
        parameters: { address: 104 },
        source: 'https://invensense.tdk.com/products/motion-tracking/6-axis/mpu-6050/',
      },
    ),
  ],
};
// Module families that share firmware templates and local simulation models across variants.
export type ModuleKind = 'oled' | 'dht22' | 'mpu6050';
const moduleKinds: Record<string, ModuleKind> = {
  'official:ssd1306-oled': 'oled',
  'official:ssd1306-oled-5v': 'oled',
  'official:dht22': 'dht22',
  'official:dht22-5v': 'dht22',
  'official:mpu6050': 'mpu6050',
  'official:mpu6050-5v': 'mpu6050',
};
export const moduleKind = (typeId: string): ModuleKind | undefined => moduleKinds[typeId];
// Instructions every AI coding agent reads from the project directory. AGENTS.md is the shared
// standard (Codex, Cursor, Copilot, Windsurf, Antigravity, Amp, Zed, Aider...); CLAUDE.md and
// GEMINI.md are thin pointers written by ensureAgentFiles. Keep this text self-contained: the agent
// may be started inside the project folder without ever seeing the app repository's AGENTS.md.
export const projectAgentInstructions = [
  '# OpenCircuit project - agent instructions',
  '',
  'You edit an electronics prototype as plain files (circuit JSON + Arduino firmware). The user watches the result live in a web page; you do not draw anything yourself. Reply in the language the user writes in.',
  '',
  '## How the loop works',
  '',
  '- The OpenCircuit local service watches this folder. Saving a source file shows up in the web page within about a second as a **draft** (http://127.0.0.1:4318 when served, http://127.0.0.1:5173 in dev mode). If a file is not valid JSON or references an unknown component, the page keeps the last valid view and shows the error: fix the file, do not work around it.',
  '- Do not start, stop or restart the service, and do not kill processes, unless the user asks. If the page seems down, tell the user to run `install-and-start.cmd` (Windows) or `npm run local` in the app folder.',
  '- Direct edits only create a draft. A draft becomes the applied revision only through `hw apply`, and only when the user asks for it or confirms it.',
  '',
  '## Start here: which project do you edit?',
  '',
  'The user may have started you in the project folder, in `<APP>`, or in a parent folder. `<APP>` is the OpenCircuit app folder (contains `package.json`, `bin/hw`, `packages/`); a project folder is any directory containing `project.json`, normally `<APP>/.local/projects/<folder>`.',
  '',
  '1. Your working directory has `project.json` -> that is the project.',
  '2. Otherwise find the project the user has open in the web page: `GET http://127.0.0.1:4318/api/projects` (e.g. `node -e "fetch(\'http://127.0.0.1:4318/api/projects\').then(r=>r.json()).then(d=>console.log(d.activeFolder,JSON.stringify(d.projects.map(p=>[p.folder,p.name,p.components]))))"`). `activeFolder` is the open project, `projects` lists all with display names. Edit **that** project in place. Do not create a new one just because it is easier: the user watches that page.',
  '3. Create a new project only when the user asks for a new/separate design, or the open project already holds an unrelated circuit. Use an ASCII folder name: `node <APP>/bin/hw init <APP>/.local/projects/<name> --template blank` (templates: `blank|led|oled|temperature`; the target folder must not exist or be empty; always pass an absolute path). Then set the display `name` in its `project.json`, and **tell the user to open it** from the project menu at the top of the web page: the page does not switch projects by itself.',
  '4. The service is offline (the fetch fails) -> you can still edit and check files; tell the user the page needs to be started.',
  '5. Unsure which project is meant -> ask one short question instead of guessing.',
  '',
  'Run the CLI as `node <APP>/bin/hw <command> --brief` from the project folder (works on Windows, macOS and Linux, no install). From anywhere else add `--project <absolute-path>`. `--brief` prints only what you need (diagnostics that are not `pass`, build state and the tail of compiler errors); `--json` without `--brief` prints entire sources, histories and BOMs, which is huge. Do not use `npm --prefix ... run hw` with a relative `--project`: npm changes the working directory. You never need to read the app source code to do this job; if something here is wrong or missing, say so in your report.',
  '',
  '## Files',
  '',
  'Edit these (sources):',
  '',
  '| File | Content |',
  '| --- | --- |',
  '| `circuit.json` | The only source of electrical truth: `instances`, `nets`, `bindings` |',
  '| `layout.json` | Canvas position and look only; never defines connectivity |',
  '| `firmware/main/main.ino` (+ other `.ino/.h/.hpp/.c/.cpp` under `firmware/main/`) | Arduino code |',
  '| `project.json` | name, `board` (instance id of the main board), `profile` |',
  '| `procurement.json` | budget, stock, manual parts, price overrides |',
  '| `components/custom/*.json` | custom component definitions (`custom:` namespace) |',
  '| `dependencies.lock.json`, `components/catalog.json`, `comments.json` | locked toolchain/catalog; legacy comments. Leave unchanged unless the task requires it |',
  '',
  'Never hand-edit: `bom.json`, `firmware/main/pinmap.h` (regenerated by `hw bom` / `hw build`), anything under `.hw/` (history is immutable), `AGENTS.md`.',
  '',
  '## circuit.json',
  '',
  '- `instances[]`: `{ id, typeId, definitionVersion, parameters, quantity }`. `id` matches `^[A-Za-z_][A-Za-z0-9_-]*$` and never changes once created (history, layout and nets refer to it). `typeId` must exist in `components/catalog.json` (`official:*`) or `components/custom/` (`custom:*`): read the catalog for exact ids, parameters and pin ids instead of guessing.',
  '- Official types in the catalog: `esp32-devkitc-v4`, `led-red`, `resistor` (parameter `resistance`, ohm), `ssd1306-oled` (parameter `address`), `dht22`, `button`, `mpu6050`, `buzzer`, `usb-supply`, `breadboard`, `jumper`, plus `-5v` variants of the OLED/DHT22/MPU6050 modules. `arduino-uno-r3` appears after the user switches the project board to Uno.',
  '- Do not swap the main board by editing files. Ask the user to change "專案板型" in the web page: it remaps pins, FQBN and core, and keeps instance ids.',
  '- `nets[]`: `{ id, name, endpoints: ["<instanceId>.<PIN>", ...] }`, at least 2 unique endpoints. Endpoints on the same net are connected. To connect more pins, add the endpoint to the existing net rather than creating a duplicate net (the `net-membership` rule checks this).',
  '- `bindings[]`: `{ name, kind, endpoint }`, `name` is UPPER_SNAKE, `kind` is `digitalOutput | digitalInput | i2cSda | i2cScl`. Each binding becomes `constexpr int NAME = <gpio>;` in `firmware/main/pinmap.h`. Firmware must use these names (`#include "pinmap.h"`), never literal pin numbers, so rewiring in the circuit propagates to the code.',
  '- Voltage levels are checked: a 5V logic board cannot drive 3.3V-only modules (use the `-5v` variants); LEDs need a series resistor. Do not hide such diagnostics: change the wiring or the part.',
  '',
  '### Pins of the official parts',
  '',
  '| typeId | pin ids |',
  '| --- | --- |',
  '| `esp32-devkitc-v4` | `3V3` `5V` `GND` `GPIO0-5` `GPIO12-19` `GPIO21-23` `GPIO25-27` `GPIO32-36` `GPIO39` (GPIO34-39 are input only; boot/flash pins GPIO0/2/12/15 have startup constraints) |',
  '| `led-red` | `A` (anode) `K` (cathode) |',
  '| `resistor` | `A` `B` (parameter `resistance`) |',
  '| `button` | `A` `B` (contacts; wire one to a GPIO, the other to GND and use `INPUT_PULLUP`) |',
  '| `buzzer` (passive) | `SIG` `GND` |',
  '| `ssd1306-oled` | `VCC` `GND` `SDA` `SCL` |',
  '| `mpu6050` | `VCC` `GND` `SDA` `SCL` |',
  '| `dht22` | `VCC` `GND` `DATA` |',
  '',
  'ESP32 I2C defaults: SDA `GPIO21`, SCL `GPIO22`. Other catalog fields (voltage, parameters) are in `components/catalog.json`.',
  '',
  '### Worked example: buzzer + 2 buttons on ESP32 (`blank` project)',
  '',
  '`project.json`: `"board": "esp1"`. `circuit.json`:',
  '',
  '```json',
  '{',
  '  "instances": [',
  '    { "id": "esp1", "typeId": "official:esp32-devkitc-v4", "definitionVersion": "1.0.0", "parameters": {}, "quantity": 1 },',
  '    { "id": "buzzer1", "typeId": "official:buzzer", "definitionVersion": "1.0.0", "parameters": {}, "quantity": 1 },',
  '    { "id": "btn1", "typeId": "official:button", "definitionVersion": "1.0.0", "parameters": {}, "quantity": 1 },',
  '    { "id": "btn2", "typeId": "official:button", "definitionVersion": "1.0.0", "parameters": {}, "quantity": 1 }',
  '  ],',
  '  "nets": [',
  '    { "id": "buzzer-signal", "name": "Buzzer signal", "endpoints": ["esp1.GPIO18", "buzzer1.SIG"] },',
  '    { "id": "key1", "name": "Key 1", "endpoints": ["esp1.GPIO14", "btn1.A"] },',
  '    { "id": "key2", "name": "Key 2", "endpoints": ["esp1.GPIO27", "btn2.A"] },',
  '    { "id": "ground", "name": "GND", "endpoints": ["esp1.GND", "buzzer1.GND", "btn1.B", "btn2.B"] }',
  '  ],',
  '  "bindings": [',
  '    { "name": "BUZZER_PIN", "kind": "digitalOutput", "endpoint": "buzzer1.SIG" },',
  '    { "name": "KEY1_PIN", "kind": "digitalInput", "endpoint": "btn1.A" },',
  '    { "name": "KEY2_PIN", "kind": "digitalInput", "endpoint": "btn2.A" }',
  '  ]',
  '}',
  '```',
  '',
  '`layout.json`: `{ "esp1": {"x":60,"y":60}, "buzzer1": {"x":560,"y":60}, "btn1": {"x":560,"y":240}, "btn2": {"x":560,"y":380} }`. `main.ino`: `#include "pinmap.h"`, then `pinMode(KEY1_PIN, INPUT_PULLUP)`, `tone(BUZZER_PIN, 262)`. A binding endpoint is the part pin that is wired to a GPIO; the generated constant is that GPIO number.',
  '',
  'Expected `hw check` result for such custom parts: no `fail`, but `unknown` for `firmware-sync`, `firmware-coverage` (and sometimes `logic-voltage`), because only the shipped LED/OLED/DHT22 templates are verified automatically. Report these as "not auto-verified, needs human review", not as errors and not as passed.',
  '',
  '## layout.json',
  '',
  '- Key = instance id: `{ x, y, rotation: 0|90|180|270, scale: 0.5..2, labels, label }`. New instances need an entry; keep roughly 300-500 px between large parts so they do not overlap.',
  '- Keys `@wire:<netId>`: `{ x:0, y:0, wireStyle: orthogonal|straight|curve, wireRoutes: [{ from, to, points: [{x,y}] }] }` (endpoints as `inst.PIN`; `points` are the bend points and may be empty). Keys `@zone:<id>`: `{ kind:"zone", x, y, width, height, label, color:"#rrggbb" }`.',
  '- `@wire:` entries are optional: the example projects ship without them. Remove layout entries of deleted instances/nets. Wire styling is cosmetic, so prefer fixing `circuit.json` over tuning routes.',
  '- Full JSON Schemas: `<APP>/packages/core/schemas/*.schema.json`.',
  '',
  '## Firmware',
  '',
  '- Use only libraries pinned in `dependencies.lock.json`. Adding a library or changing core/FQBN is a dependency change: tell the user first.',
  '- Arbitrary hand-written GPIO numbers, direct register access or extra firmware files make the "firmware sync" check report **unknown**; the code still compiles but the project will not reach hardware `ready`. Prefer the generated constants.',
  '- Keep `#include "pinmap.h"` and keep the board profile (ESP32 `esp32:esp32:esp32` / Uno `arduino:avr:uno`). Uno and ESP32 differ: pin names, 5V vs 3.3V, memory.',
  '',
  '## Workflow for every change',
  '',
  '1. `hw context --brief`: note `current.revision` (base revision), `sourceDigest`, existing instances and nets. Re-run it if the user may have edited in the web page meanwhile: never overwrite newer content.',
  '2. Edit the source files (small, complete, valid JSON with 2-space indent and trailing newline; edit all files of one logical change together, then verify). Write `circuit.json`, `layout.json` and firmware in one go so the page does not show a half-finished design for long.',
  '3. `hw check --brief`: `diagnostics` lists every rule that is not `pass` (`fail | unknown`). Fix every `fail`; explain every `unknown` honestly.',
  '4. `hw build --brief`: real Arduino compile (`build.state` is `pass | fail | unknown`; `not_run` after `hw check` is normal). The first ESP32 build can take several minutes: wait for the command to end and never run two builds at once. `hw doctor --json` reports a missing toolchain, `hw install --json` installs the pinned one. If it cannot run, say the build was **not run**: do not claim it passed.',
  '5. `hw bom --brief` regenerates `bom.json` (cost summary). `hw diff <base-revision>` shows the full source diff for the user.',
  '6. Only when the user asks: `hw apply <snapshot-id>` (snapshot id comes from the `id` of a passing `hw check`/`hw build`; stale base or changed sources are rejected with exit code 3). `hw rollback <revision>` restores history by creating a new revision.',
  '',
  'Other commands: `hw simulate --json` (Uno: AVR8js; ESP32: PICSimLab QEMU on Windows), `hw simulate --headless --duration <s> [--scenario file.json] [--vcd file]`, `hw scan`, `hw upload --port <port>` (writes to real hardware: only on explicit user request), `hw export` (Wokwi ZIP).',
  '',
  'Exit codes: 0 ok; 1 failure or error; 2 capability unknown / tool or dependency missing / usage; 3 revision conflict (re-read `hw context`, merge your change onto the newer files, retry).',
  '',
  '## Rules',
  '',
  '- Never fabricate build, simulation, test or price results. Report exact outcomes: passed, failed, unknown, not run. Compilation and simulation do not prove the physical circuit works.',
  '- Costs are non-negative integer minor currency units (TWD, USD, EUR and HKD have two decimals, so 1.00 = 100); unknown price is `null`. Never invent market prices or suppliers; demo prices need `"demo": true`, a source and a date. Do not add up different currencies.',
  '- While a simulation is running the project is locked: the service and `hw` refuse every edit (error code `LOCKED`, "模擬進行中，專案已鎖定"). Writing the source files directly does not get around it: the simulator notices within a second and stops, which throws away the user\'s running simulation. Do not edit the files, delete them or kill the simulator. Tell the user the project is locked and ask them to stop the simulation, then make the change.',
  '- Keep ids stable when moving or restyling things. Graphical crossings never define connectivity: only shared `net` membership does.',
  '- I2C buses may legally have several devices (distinct addresses, `i2c-address` rule). Let `hw check` decide about driver conflicts instead of guessing.',
  '- Do not add shell commands, hooks or URLs to JSON; do not edit files outside this project folder; do not commit `.local/`, credentials or tokens.',
  '- Stay within what the user asked. After finishing, summarize: what changed (files, parts, nets, pins), the `hw check` / `hw build` results, and anything not verified.',
  '',
].join('\n');
// Pointers for agents that do not read AGENTS.md natively. Both import the shared instructions.
export const agentPointerFiles: Record<string, string> = {
  'CLAUDE.md':
    '# OpenCircuit project\n\nThe instructions for this project are shared with other coding agents in AGENTS.md:\n\n@AGENTS.md\n',
  'GEMINI.md':
    '# OpenCircuit project\n\nThe instructions for this project are shared with other coding agents in AGENTS.md:\n\n@AGENTS.md\n',
};
export function example(
  profile: 'led' | 'oled' | 'temperature' = 'led',
  name = '我的電路',
): Source {
  const instance = (
    id: string,
    typeId: string,
    parameters: Instance['parameters'] = {},
  ): Instance => ({
    id,
    typeId: 'official:' + typeId,
    definitionVersion: '1.0.0',
    parameters,
    quantity: 1,
  });
  const s: Source = {
    project: { formatVersion: 1, name, board: 'esp1', catalogVersion: '1.0.0', profile },
    catalog: structuredClone(catalog),
    custom: [],
    circuit: { instances: [instance('esp1', 'esp32-devkitc-v4')], nets: [], bindings: [] },
    layout: { esp1: { x: 60, y: 60 } },
    procurement: {
      currency: 'TWD',
      budget: null,
      reserve: 0,
      missingMaterials: [],
      inventory: {},
      overrides: {},
      manual: [],
      locked: [],
      requiredFeatures: [],
      substitutable: [],
    },
    comments: [],
    dependencies: {
      fqbn: 'esp32:esp32:esp32',
      core: { name: 'esp32:esp32', version: '3.3.2' },
      libraries: [],
      buildProperties: [],
    },
    firmware: '',
    extraFirmware: {},
  };
  const addLed = () => {
    s.circuit.instances.push(
      instance('r1', 'resistor', { resistance: 220 }),
      instance('led1', 'led-red'),
    );
    s.layout.r1 = { x: 430, y: 100 };
    s.layout.led1 = { x: 750, y: 100 };
    s.circuit.nets.push(
      { id: 'led-drive', name: 'LED drive', endpoints: ['esp1.GPIO25', 'r1.A'] },
      { id: 'led-anode', name: '限流路徑', endpoints: ['r1.B', 'led1.A'] },
      { id: 'ground', name: 'GND', endpoints: ['esp1.GND', 'led1.K'] },
    );
    s.circuit.bindings.push({ name: 'LED_PIN', kind: 'digitalOutput', endpoint: 'led1.A' });
  };
  if (profile === 'led') {
    addLed();
    s.firmware =
      '#include "pinmap.h"\nvoid setup() { pinMode(LED_PIN, OUTPUT); }\nvoid loop() { digitalWrite(LED_PIN, HIGH); delay(500); digitalWrite(LED_PIN, LOW); delay(500); }\n';
  }
  if (profile === 'oled') {
    s.circuit.instances.push(instance('oled1', 'ssd1306-oled', { address: 60 }));
    s.layout.oled1 = { x: 550, y: 110 };
    s.circuit.nets = [
      { id: 'vcc', name: '3.3V', endpoints: ['esp1.3V3', 'oled1.VCC'] },
      { id: 'ground', name: 'GND', endpoints: ['esp1.GND', 'oled1.GND'] },
      { id: 'sda', name: 'I²C SDA', endpoints: ['esp1.GPIO21', 'oled1.SDA'] },
      { id: 'scl', name: 'I²C SCL', endpoints: ['esp1.GPIO22', 'oled1.SCL'] },
    ];
    s.circuit.bindings = [
      { name: 'I2C_SDA', kind: 'i2cSda', endpoint: 'oled1.SDA' },
      { name: 'I2C_SCL', kind: 'i2cScl', endpoint: 'oled1.SCL' },
    ];
    s.dependencies.libraries = [
      { name: 'Adafruit SSD1306', version: '2.5.13' },
      { name: 'Adafruit GFX Library', version: '1.12.1' },
      { name: 'Adafruit BusIO', version: '1.17.2' },
    ];
    s.firmware =
      '#include <Wire.h>\n#include <Adafruit_SSD1306.h>\n#include "pinmap.h"\nAdafruit_SSD1306 display(128, 64, &Wire, -1);\nvoid setup() {\n  Wire.begin(I2C_SDA, I2C_SCL);\n  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) return;\n  display.clearDisplay(); display.setTextSize(1); display.setTextColor(SSD1306_WHITE);\n  display.setCursor(0, 0); display.println("OpenCircuit"); display.display();\n}\nvoid loop() {}\n';
  }
  if (profile === 'temperature') {
    addLed();
    s.circuit.instances.push(instance('dht1', 'dht22'));
    s.layout.dht1 = { x: 460, y: 370 };
    s.circuit.nets.find((n) => n.id === 'ground')!.endpoints.push('dht1.GND');
    s.circuit.nets.push(
      { id: 'vcc', name: '3.3V', endpoints: ['esp1.3V3', 'dht1.VCC'] },
      { id: 'data', name: 'DHT data', endpoints: ['esp1.GPIO27', 'dht1.DATA'] },
    );
    s.circuit.bindings.push({ name: 'DHT_PIN', kind: 'digitalOutput', endpoint: 'dht1.DATA' });
    s.dependencies.libraries = [
      { name: 'DHT sensor library', version: '1.4.6' },
      { name: 'Adafruit Unified Sensor', version: '1.1.15' },
    ];
    s.firmware =
      '#include <DHT.h>\n#include "pinmap.h"\nDHT dht(DHT_PIN, DHT22);\nvoid setup() { pinMode(LED_PIN, OUTPUT); dht.begin(); }\nvoid loop() { float t=dht.readTemperature(); digitalWrite(LED_PIN, !isnan(t) && t>30 ? HIGH : LOW); delay(2000); }\n';
  }
  return s;
}
