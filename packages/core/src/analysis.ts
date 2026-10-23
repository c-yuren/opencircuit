import { createHash } from 'node:crypto';
import { example, moduleKind } from './catalog';
import { boards } from './boards';
import { catalogPrice } from './pricing';
import { instanceDefinition } from './component-settings';
import type { Source, Instance, Definition, Diagnostic, Bom, BomRow, Pin } from './model';
export const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
export const digest = (v: unknown) =>
  createHash('sha256')
    .update(typeof v === 'string' || v instanceof Uint8Array ? v : stable(v))
    .digest('hex');
export const definitions = (s: Source) => [...s.catalog.definitions, ...s.custom];
export const definitionFor = (s: Source, i: Instance) =>
  definitions(s).find((d) => d.typeId === i.typeId && d.version === i.definitionVersion);
export function isUnusedComponent(s: Source, i: Instance) {
  const prefix = i.id + '.';
  return (
    i.id !== s.project.board &&
    Boolean(definitionFor(s, i)?.pins.length) &&
    !s.circuit.nets.some((net) => net.endpoints.some((endpoint) => endpoint.startsWith(prefix))) &&
    !s.circuit.bindings.some((binding) => binding.endpoint.startsWith(prefix))
  );
}
export function electricalDigest(s: Source) {
  return digest({
    project: s.project,
    circuit: s.circuit,
    defs: definitions(s)
      .filter((d) =>
        s.circuit.instances.some((i) => i.typeId === d.typeId && i.definitionVersion === d.version),
      )
      .map(({ price, visual, ...d }) => d),
    firmware: s.firmware,
    extraFirmware: s.extraFirmware,
    dependencies: s.dependencies,
  });
}
export const costDigest = (s: Source) =>
  digest({
    circuit: s.circuit,
    definitions: definitions(s).map((d) => ({ ...d, price: catalogPrice(d) })),
    procurement: s.procurement,
  });
export function bomKey(d: Definition, i: Instance) {
  return stable([
    d.version,
    d.model,
    d.moduleVersion,
    { ...d.parameters, ...i.parameters },
    d.unit,
  ]);
}
export function calculateBom(s: Source): Bom {
  const p = s.procurement;
  const rows = new Map<string, BomRow>();
  const missing = [...p.missingMaterials];
  const add = (i: Instance, source: string) => {
    if (i.quantity === 0) return;
    const d = definitionFor(s, i);
    if (!d) {
      missing.push(`未登錄材料 ${i.id}: ${i.typeId}@${i.definitionVersion}`);
      return;
    }
    if (!d.physical) return;
    const key = bomKey(d, i);
    const row = rows.get(key);
    if (row) {
      row.demand += i.quantity;
      row.sources.push(source);
      return;
    }
    const raw =
      p.overrides[key] ?? catalogPrice({ ...d, parameters: { ...d.parameters, ...i.parameters } });
    const price = raw?.currency === p.currency ? raw : null;
    rows.set(key, {
      key,
      category: d.category,
      name: d.name,
      model: d.model,
      moduleVersion: d.moduleVersion,
      unit: d.unit,
      demand: i.quantity,
      owned: 0,
      toBuy: 0,
      packages: null,
      price,
      subtotal: null,
      materialValue: null,
      sources: [source],
      locked: p.locked.includes(key),
    });
  };
  s.circuit.instances.forEach((i) => add(i, 'circuit:' + i.id));
  const referenced = new Set<string>();
  for (const i of p.manual) {
    if (i.instanceRefs.length) {
      let represented = 0;
      let invalidReference = false;
      for (const ref of i.instanceRefs) {
        const circuitInstance = s.circuit.instances.find((x) => x.id === ref);
        if (!circuitInstance || referenced.has(ref)) {
          missing.push('無效或重複手動來源 ' + ref);
          invalidReference = true;
          continue;
        }
        referenced.add(ref);
        const d = definitionFor(s, i),
          cd = definitionFor(s, circuitInstance);
        if (!d || !cd || bomKey(d, i) !== bomKey(cd, circuitInstance)) {
          missing.push('手動材料規格與引用不符 ' + ref);
          invalidReference = true;
          continue;
        }
        represented += circuitInstance.quantity;
        const row = rows.get(bomKey(d, i));
        row?.sources.push('manual:' + i.id + '→' + ref);
      }
      if (!invalidReference && i.quantity > represented)
        add({ ...i, quantity: i.quantity - represented }, 'manual:' + i.id);
    } else add(i, 'manual:' + i.id);
  }
  const spend: [number, number] = [p.reserve, p.reserve],
    materialValue: [number, number] = [0, 0];
  let valueIncomplete = false;
  for (const row of rows.values()) {
    const inv = p.inventory[row.key];
    row.owned = inv?.usable ? Math.min(inv.quantity, row.demand) : 0;
    row.toBuy = Math.max(0, row.demand - row.owned);
    if (row.price) {
      const q = row.price;
      row.packages = Math.ceil(row.toBuy / q.packSize);
      row.subtotal = [row.packages * q.low, row.packages * q.high];
      row.materialValue = [
        Math.round((row.demand * q.low) / q.packSize),
        Math.round((row.demand * q.high) / q.packSize),
      ];
    } else {
      valueIncomplete = true;
      if (row.toBuy === 0) {
        row.packages = 0;
        row.subtotal = [0, 0];
      } else missing.push(row.model + ' 待估價（' + p.currency + '）');
    }
    if (row.subtotal) {
      spend[0] += row.subtotal[0];
      spend[1] += row.subtotal[1];
    }
    if (row.materialValue) {
      materialValue[0] += row.materialValue[0];
      materialValue[1] += row.materialValue[1];
    }
  }
  for (const n of [...spend, ...materialValue])
    if (!Number.isSafeInteger(n)) throw new Error('金額超過安全整數範圍');
  const incomplete = missing.length > 0,
    overBudget = p.budget !== null && spend[0] > p.budget;
  return {
    currency: p.currency,
    rows: [...rows.values()],
    spend,
    materialValue,
    incomplete,
    materialValueIncomplete: valueIncomplete,
    missing,
    overBudget,
    budgetState:
      p.budget === null
        ? 'unset'
        : overBudget
          ? 'over'
          : incomplete
            ? 'incomplete'
            : spend[1] <= p.budget
              ? 'within'
              : 'possible',
    budget: p.budget,
    reserve: p.reserve,
    inputDigest: costDigest(s),
  };
}
export function graph(s: Source, throughResistors = false) {
  const g = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    if (!g.has(a)) g.set(a, new Set());
    g.get(a)!.add(b);
  };
  for (const n of s.circuit.nets)
    for (const a of n.endpoints) for (const b of n.endpoints) if (a !== b) connect(a, b);
  if (throughResistors)
    for (const i of s.circuit.instances)
      if (i.typeId === 'official:resistor') {
        connect(i.id + '.A', i.id + '.B');
        connect(i.id + '.B', i.id + '.A');
      }
  return g;
}
export function reachable(g: Map<string, Set<string>>, start: string) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const b of g.get(queue.shift()!) ?? [])
      if (!seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
  }
  return seen;
}
export function resolvePin(
  s: Source,
  ref: string,
): { pin: Pin; def: Definition; instance: Instance } | undefined {
  const [i, p] = ref.split('.');
  const instance = s.circuit.instances.find((x) => x.id === i);
  const base = instance && definitionFor(s, instance);
  const def = instance && base ? instanceDefinition(base, instance) : undefined;
  const pin = def?.pins.find((x) => x.id === p);
  return instance && def && pin ? { pin, def, instance } : undefined;
}
export function bindingGPIO(s: Source, endpoint: string) {
  return [...reachable(graph(s, true), endpoint)]
    .map((ref) => ({ ref, resolved: resolvePin(s, ref) }))
    .filter(
      (x) => x.resolved?.instance.id === s.project.board && x.resolved.pin.gpio !== undefined,
    );
}
export function generatePinmap(s: Source) {
  let text = '// Generated by OpenCircuit. DO NOT EDIT.\n#pragma once\n';
  for (const b of s.circuit.bindings) {
    const matches = bindingGPIO(s, b.endpoint);
    if (matches.length !== 1) throw new Error(`無法唯一解析 ${b.name} 的 GPIO`);
    text += `constexpr int ${b.name} = ${matches[0].resolved!.pin.gpio};\n`;
  }
  const oled = s.circuit.instances.find((i) => moduleKind(i.typeId) === 'oled');
  if (oled) {
    const address = Number(oled.parameters.address ?? definitionFor(s, oled)?.parameters.address);
    if (!Number.isInteger(address) || address < 0 || address > 127)
      throw new Error('OLED address 無效');
    text += `constexpr int OLED_ADDRESS = ${address};\n`;
  }
  return text;
}
export function checkRules(s: Source): Diagnostic[] {
  const out: Diagnostic[] = [];
  const hash = electricalDigest(s);
  const add = (
    ruleId: string,
    state: Diagnostic['state'],
    target: string,
    reason: string,
    basis: string,
    action = '核對規格並修改接線',
    severity: Diagnostic['severity'] = state === 'fail'
      ? 'error'
      : state === 'unknown'
        ? 'warning'
        : 'info',
    relatedTargets?: string[],
  ) =>
    out.push({
      ruleId,
      state,
      severity,
      target,
      reason,
      basis,
      action,
      inputDigest: hash,
      ...(relatedTargets ? { relatedTargets } : {}),
    });
  if (!s.project.board)
    add(
      'board-selection',
      'unknown',
      'project.json',
      '尚未選擇主板',
      'project.board',
      '從元件庫加入 ESP32 或 Arduino',
    );
  else if (
    !s.circuit.instances.some(
      (i) => i.id === s.project.board && definitionFor(s, i)?.category === 'controller',
    )
  )
    add('reference', 'fail', s.project.board, '主控制板不存在或型別錯誤', 'project.board');
  if (
    s.circuit.instances.filter((instance) => definitionFor(s, instance)?.category === 'controller')
      .length > 1
  )
    add(
      'single-controller',
      'fail',
      'project.json',
      '一個專案只能使用一個主控制器，請移除多餘的控制板',
      '主控制器數量',
    );
  if (s.project.catalogVersion !== s.catalog.version)
    add(
      'reference',
      'fail',
      'components/catalog.json',
      '目錄版本與 project 不一致',
      '固定目錄版本',
    );
  const board = s.circuit.instances.find((i) => i.id === s.project.board);
  const boardDefinition = board && definitionFor(s, board);
  const knownBoard = boards[s.dependencies.fqbn as keyof typeof boards];
  if (
    boardDefinition?.compileProfile !== s.dependencies.fqbn ||
    s.dependencies.core.name !== s.dependencies.fqbn.split(':').slice(0, 2).join(':') ||
    (knownBoard && s.dependencies.core.version !== knownBoard.core.version) ||
    (s.dependencies.fqbn === 'arduino:avr:uno' && s.dependencies.buildProperties.length > 0)
  )
    add(
      'board-profile',
      'fail',
      s.project.board,
      '編譯 FQBN / core 與板型定義不一致',
      '固定板型 compileProfile',
      '同步 project 與 dependencies.lock.json',
    );
  const g = graph(s);
  const seenEndpoints = new Map<string, string>();
  for (const n of s.circuit.nets) {
    for (const e of n.endpoints) {
      if (!resolvePin(s, e))
        add('reference', 'fail', e, '元件或接腳不存在', 'circuit.json 與固定版本目錄');
      if (seenEndpoints.has(e))
        add(
          'net-membership',
          'fail',
          n.id,
          `${e} 同時位於不同 net；請合併為同一 net ID`,
          '每個實體端點只有一個導通網路',
        );
      seenEndpoints.set(e, n.id);
    }
    const pins = n.endpoints.map((e) => ({ ref: e, p: resolvePin(s, e) })).filter((x) => x.p);
    const supply = pins.filter((x) => x.p!.pin.direction === 'power');
    const ground = pins.some((x) => x.p!.pin.direction === 'ground');
    if (supply.length && ground)
      add('power-short', 'fail', n.id, '電源與接地直接短接', '已建模的 power / ground 接腳');
    const levels = supply.flatMap((x) => (x.p!.pin.voltage ? [x.p!.pin.voltage] : []));
    if (
      levels.length > 1 &&
      Math.max(...levels.map((v) => v[0])) > Math.min(...levels.map((v) => v[1]))
    )
      add('supply-voltage', 'fail', n.id, '不相容的供電電壓', '目錄供電範圍');
    const outputs = pins.filter(
      (x) =>
        x.p!.pin.direction === 'output' ||
        (x.p!.instance.id === s.project.board &&
          s.circuit.bindings.some(
            (b) =>
              b.kind === 'digitalOutput' && bindingGPIO(s, b.endpoint).some((g) => g.ref === x.ref),
          )),
    );
    if (outputs.length > 1)
      add('driver-conflict', 'fail', n.id, '多個推挽輸出互相驅動', '接腳 direction');
    const signals = pins.filter((x) => !['passive', 'ground'].includes(x.p!.pin.direction));
    const known = signals.filter((x) => x.p!.pin.voltage);
    if (
      known.length > 1 &&
      Math.max(...known.map((x) => x.p!.pin.voltage![0])) >
        Math.min(...known.map((x) => x.p!.pin.voltage![1]))
    )
      add('logic-voltage', 'fail', n.id, '接腳電壓範圍不相容', '供電／邏輯電壓範圍');
    if (signals.some((x) => !x.p!.pin.voltage && x.p!.def.typeId !== 'official:led-red'))
      add('logic-voltage', 'unknown', n.id, '有接腳未提供邏輯電壓', '目錄資料不足');
  }
  for (const i of s.circuit.instances) {
    const d = definitionFor(s, i);
    if (!d) {
      add('reference', 'fail', i.id, '未登錄的元件定義或版本', '固定版本目錄');
      continue;
    }
    if (i.quantity !== 1 && d.pins.length)
      add(
        'physical-instance',
        'fail',
        i.id,
        '有接腳的實體元件必須各自有 instance ID',
        '畫布不可用一個 ID 表示多件接線元件',
      );
    if (!d.pins.length && d.physical && d.category !== 'consumable' && d.category !== 'connector')
      add('pin-spec', 'unknown', i.id, '未建模接腳；僅可做材料規劃', '元件定義');
    if (isUnusedComponent(s, i)) {
      add(
        'unused-component',
        'pass',
        i.id,
        `${d.name} 尚未接線，保留在畫布與材料清單，不影響已接好的電路`,
        '沒有接線或程式接腳設定',
        '需要使用時再接線',
      );
      continue;
    }
    for (const p of d.pins.filter((p) => p.required)) {
      const ref = i.id + '.' + p.id;
      const peers = [...reachable(g, ref)].filter((x) => x !== ref);
      if (!peers.length) add('required-pin', 'fail', ref, '必要接腳尚未連接', d.source);
      else if (
        p.direction === 'power' &&
        !peers.some((x) => {
          const r = resolvePin(s, x);
          return (
            r &&
            (r.def.category === 'controller' || r.def.category === 'power') &&
            r.pin.direction === 'power'
          );
        })
      )
        add('supply-source', 'fail', ref, '供電接腳未連到電源來源', d.source);
      else if (
        p.direction === 'ground' &&
        !peers.some((x) => {
          const r = resolvePin(s, x);
          return (
            r &&
            (r.def.category === 'controller' || r.def.category === 'power') &&
            r.pin.direction === 'ground'
          );
        })
      )
        add('ground-source', 'fail', ref, '接地接腳未連到板端／電源地', d.source);
    }
    if (
      moduleKind(i.typeId) === 'oled' &&
      ((i.parameters.width ?? d.parameters.width) !== 128 ||
        (i.parameters.height ?? d.parameters.height) !== 64)
    )
      add(
        'template-parameters',
        'fail',
        i.id,
        'OLED 範本僅支援 128×64，尺寸變更需要同步功能程式',
        'SSD1306 範本契約',
        '修改韌體並以自訂草稿審查',
      );
    if (i.typeId === 'official:led-red') {
      const a = i.id + '.A',
        direct = [...reachable(g, a)];
      const resistor = s.circuit.instances.find(
        (r) =>
          r.typeId === 'official:resistor' &&
          ['A', 'B'].some((p) => direct.includes(r.id + '.' + p)) &&
          Number(r.parameters.resistance ?? definitionFor(s, r)?.parameters.resistance) > 0 &&
          Number(r.parameters.resistance ?? definitionFor(s, r)?.parameters.resistance) <= 100000,
      );
      const gpio = bindingGPIO(s, a);
      const bypass = direct.some((ref) => resolvePin(s, ref)?.pin.gpio !== undefined);
      if (!resistor || !gpio.length || bypass)
        add(
          'led-current-limit',
          'fail',
          i.id,
          'LED 必須經正阻值電阻接 GPIO，且不可旁路',
          '支援的 LED 串聯限流範本',
        );
    }
    if (
      ['sensor', 'output'].includes(d.category) &&
      (!d.compileProfile ||
        !(d.typeId === 'official:led-red' || ['oled', 'dht22'].includes(moduleKind(d.typeId)!)))
    )
      add(
        'firmware-coverage',
        'unknown',
        i.id,
        '沒有此元件的已驗證韌體範本，無法確認功能邏輯',
        '元件能力分開追蹤',
        '補齊韌體與驅動並人工審查',
      );
    if (
      d.driver &&
      !s.dependencies.libraries.some(
        (l) => l.name === d.driver!.name && l.version === d.driver!.version,
      )
    )
      add(
        'driver-lock',
        'fail',
        i.id,
        '缺少相符驅動函式庫版本',
        d.source,
        '同步 dependencies.lock.json',
      );
  }
  for (const b of s.circuit.bindings) {
    if (!resolvePin(s, b.endpoint))
      add('reference', 'fail', b.endpoint, '訊號綁定端點不存在', 'circuit bindings');
    const matches = bindingGPIO(s, b.endpoint);
    if (matches.length !== 1)
      add('binding', 'fail', b.endpoint, '訊號無法解析到唯一板端 GPIO', 'nets 與介面綁定');
    else {
      const p = matches[0].resolved!.pin;
      if (!p.capabilities?.includes(b.kind))
        add(
          'gpio-capability',
          'fail',
          matches[0].ref,
          `${p.id} 不支援 ${b.kind}；classic ESP32 GPIO34–39 僅能輸入`,
          matches[0].resolved!.def.source,
          '改用具備所需能力的 GPIO',
        );
    }
    const endpoint = resolvePin(s, b.endpoint);
    if (b.kind.startsWith('i2c') && endpoint && !endpoint.pin.interfaces.includes(b.kind))
      add('interface', 'fail', b.endpoint, 'I²C 訊號用途與接腳介面不符', endpoint.def.source);
  }
  const addresses = new Map<string, string>();
  for (const i of s.circuit.instances) {
    if (isUnusedComponent(s, i)) continue;
    const d = definitionFor(s, i);
    const sda = d?.pins.find((p) => p.interfaces.includes('i2cSda'));
    const scl = d?.pins.find((p) => p.interfaces.includes('i2cScl'));
    if (!sda || !scl) continue;
    const a = d?.fixedAddress ?? i.parameters.address ?? d?.parameters.address;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a > 127) {
      add(
        'i2c-address',
        a === undefined ? 'unknown' : 'fail',
        i.id,
        'I²C 位址未確定或無效',
        d!.source,
      );
      continue;
    }
    const key = stable([
      [...reachable(g, i.id + '.' + sda.id)].sort(),
      [...reachable(g, i.id + '.' + scl.id)].sort(),
      a,
    ]);
    if (addresses.has(key))
      add(
        'i2c-address',
        'fail',
        i.id,
        `同一 I²C 匯流排位址 ${a} 與 ${addresses.get(key)} 衝突`,
        d!.source,
        '更改位址或分開匯流排',
        'error',
        [i.id, addresses.get(key)!],
      );
    addresses.set(key, i.id);
  }
  const expected =
    s.project.profile === 'led'
      ? ['LED_PIN']
      : s.project.profile === 'oled'
        ? ['I2C_SDA', 'I2C_SCL']
        : s.project.profile === 'temperature'
          ? ['LED_PIN', 'DHT_PIN']
          : [];
  // Uno's Wire uses fixed A4/A5, so its firmware calls Wire.begin() without pin constants;
  // the wiring bindings are still required.
  const fixedI2c = s.dependencies.fqbn === 'arduino:avr:uno';
  // A template signal name must be bound to the component pin it stands for, so the generated
  // pinmap constant drives the intended load/sensor rather than any other valid GPIO.
  const signalContract: Record<
    string,
    { kind: string; pin: string; component: string; matches: (typeId: string) => boolean }
  > = {
    LED_PIN: {
      kind: 'digitalOutput',
      pin: 'A',
      component: 'LED',
      matches: (t) => t === 'official:led-red',
    },
    DHT_PIN: {
      kind: 'digitalOutput',
      pin: 'DATA',
      component: 'DHT22',
      matches: (t) => moduleKind(t) === 'dht22',
    },
    I2C_SDA: {
      kind: 'i2cSda',
      pin: 'SDA',
      component: 'SSD1306 OLED',
      matches: (t) => moduleKind(t) === 'oled',
    },
    I2C_SCL: {
      kind: 'i2cScl',
      pin: 'SCL',
      component: 'SSD1306 OLED',
      matches: (t) => moduleKind(t) === 'oled',
    },
  };
  for (const name of expected) {
    const named = s.circuit.bindings.filter((b) => b.name === name);
    if (!named.length || (!s.firmware.includes(name) && !(fixedI2c && name.startsWith('I2C_')))) {
      add(
        'template-binding',
        'fail',
        name,
        '範本缺少必要訊號綁定或韌體引用',
        '支援範本契約',
        '同步接線與韌體',
      );
      continue;
    }
    const want = signalContract[name];
    const bound = named.length === 1 ? resolvePin(s, named[0].endpoint) : undefined;
    if (
      want &&
      (named.length !== 1 ||
        named[0].kind !== want.kind ||
        !bound ||
        bound.pin.id !== want.pin ||
        !want.matches(bound.instance.typeId))
    )
      add(
        'template-binding',
        'fail',
        name,
        `${name} 必須唯一綁定到 ${want.component} 的 ${want.pin} 接腳（用途 ${want.kind}），目前綁定不符`,
        '支援範本訊號契約',
        `將 ${name} 綁定改回 ${want.component}.${want.pin}`,
      );
  }
  const normalizeFirmware = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, '');
  const knownTemplate =
    s.project.profile !== 'custom' &&
    normalizeFirmware(s.firmware) ===
      normalizeFirmware(
        s.dependencies.fqbn === 'arduino:avr:uno' && s.project.profile === 'oled'
          ? example('oled').firmware.replace('Wire.begin(I2C_SDA, I2C_SCL);', 'Wire.begin();')
          : example(s.project.profile).firmware,
      );
  if (
    !knownTemplate ||
    Object.keys(s.extraFirmware).length > 0 ||
    s.project.profile === 'custom' ||
    !s.firmware.includes('#include "pinmap.h"') ||
    /\b(pinMode|digitalWrite|digitalRead|analogRead|analogWrite)\s*\(\s*\d|Wire\.begin\s*\(\s*\d|REG_WRITE|GPIO\.out|gpio_set_level|#define\s+\w*PIN\s+\d/.test(
      s.firmware,
    )
  )
    add(
      'firmware-sync',
      'unknown',
      'firmware/main/main.ino',
      '任意韌體／手寫 GPIO 無法保證同步；編譯不等於硬體實測',
      '範本同步保證範圍',
      '使用生成常數並人工審查',
    );
  const ruleNames = [
    'reference',
    'net-membership',
    'power-short',
    'supply-voltage',
    'driver-conflict',
    'logic-voltage',
    'physical-instance',
    'pin-spec',
    'required-pin',
    'supply-source',
    'ground-source',
    'led-current-limit',
    'driver-lock',
    'binding',
    'gpio-capability',
    'interface',
    'i2c-address',
    'template-binding',
    'firmware-sync',
    'firmware-coverage',
    'template-parameters',
    'board-profile',
  ];
  for (const rule of ruleNames)
    if (!out.some((x) => x.ruleId === rule))
      add(
        rule,
        'pass',
        s.project.board,
        '已建模範圍內未發現違規',
        '固定版本目錄及支援範本',
        '仍需實體硬體測試',
      );
  return out;
}
