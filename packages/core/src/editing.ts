import { randomUUID } from 'node:crypto';
import { capture, json } from './files';
import { ConflictError, current, saveFiles } from './project';
import type { Source, WireRef } from './model';
import {
  snapCanvasPoint,
  wireLayoutKey,
  transformedGeometry,
  wireConnections,
  sameWire,
} from './graphics';
import { arrangeWires } from './routing';

type Entry = {
  before: Record<string, string>;
  after: Record<string, string>;
  beforeDigest: string;
  afterDigest: string;
  revision: string;
};
const changes = (before: Record<string, string>, after: Record<string, string>) =>
  Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((name) => before[name] !== after[name])
      .map((name) => [name, after[name] ?? null]),
  );

export class DraftEdits {
  private projects = new Map<string, { undo: Entry[]; redo: Entry[] }>();
  private stack(root: string) {
    if (!this.projects.has(root)) this.projects.set(root, { undo: [], redo: [] });
    return this.projects.get(root)!;
  }
  async record<T>(root: string, operation: () => Promise<T>) {
    const before = await capture(root),
      revision = (await current(root)).revision;
    const result = await operation();
    const after = await capture(root);
    if (
      before.sourceDigest !== after.sourceDigest &&
      (result as { sourceDigest?: string })?.sourceDigest === after.sourceDigest
    ) {
      const stack = this.stack(root);
      stack.undo.push({
        before: before.files,
        after: after.files,
        beforeDigest: before.sourceDigest,
        afterDigest: after.sourceDigest,
        revision,
      });
      stack.undo = stack.undo.slice(-40);
      stack.redo = [];
    }
    return result;
  }
  async state(root: string) {
    const cap = await capture(root),
      revision = (await current(root)).revision,
      stack = this.stack(root);
    const undo = stack.undo.at(-1),
      redo = stack.redo.at(-1);
    return {
      undo: undo?.afterDigest === cap.sourceDigest && undo.revision === revision,
      redo: redo?.beforeDigest === cap.sourceDigest && redo.revision === revision,
      reason: '只復原本次開啟後的草稿修改；外部更新或套用版本後需使用歷史。',
    };
  }
  async move(
    root: string,
    direction: 'undo' | 'redo',
    expectedDigest: string,
    baseRevision: string,
  ) {
    const stack = this.stack(root),
      from = stack[direction],
      entry = from.at(-1);
    if (
      !entry ||
      entry.revision !== baseRevision ||
      (direction === 'undo' ? entry.afterDigest : entry.beforeDigest) !== expectedDigest
    )
      throw new ConflictError('草稿已由其他操作更新，不能覆寫；請到歷史比較。');
    const result = await saveFiles(
      root,
      direction === 'undo'
        ? changes(entry.after, entry.before)
        : changes(entry.before, entry.after),
      expectedDigest,
      baseRevision,
    );
    from.pop();
    stack[direction === 'undo' ? 'redo' : 'undo'].push(entry);
    return result;
  }
}

export function duplicateSelection(source: Source, ids: string[]) {
  if (
    source.circuit.instances.some(
      (instance) =>
        ids.includes(instance.id) &&
        [...source.catalog.definitions, ...source.custom].some(
          (definition) =>
            definition.typeId === instance.typeId &&
            definition.version === instance.definitionVersion &&
            definition.category === 'controller',
        ),
    )
  )
    throw new Error('一個專案只能使用一個主控制器，不能複製控制板');
  const selected = new Set(ids);
  if (
    !ids.length ||
    ids.some(
      (id) =>
        !source.circuit.instances.some((instance) => instance.id === id) &&
        source.layout[id]?.kind !== 'zone',
    )
  )
    throw new Error('選取的元件或區域已不存在');
  const layout = { ...source.layout },
    replacements = new Map<string, string>();
  const unique = (prefix: string) => prefix + '_' + randomUUID().slice(0, 8);
  const instances = source.circuit.instances
    .filter((instance) => selected.has(instance.id))
    .map((instance) => {
      const id = unique(instance.id);
      replacements.set(instance.id, id);
      layout[id] = {
        ...(source.layout[instance.id] ?? { x: 100, y: 100 }),
        ...snapCanvasPoint({
          x: (source.layout[instance.id]?.x ?? 100) + 40,
          y: (source.layout[instance.id]?.y ?? 100) + 40,
        }),
      };
      return { ...instance, id, parameters: { ...instance.parameters } };
    });
  for (const id of ids.filter((id) => source.layout[id]?.kind === 'zone'))
    layout['@zone:' + unique('copy')] = {
      ...source.layout[id],
      x: source.layout[id].x + 40,
      y: source.layout[id].y + 40,
    };
  const endpoint = (ref: string) => {
    const [id, pin] = ref.split('.');
    return replacements.get(id) + '.' + pin;
  };
  const nets = source.circuit.nets.flatMap((net) => {
    const endpoints = net.endpoints.filter((ref) => replacements.has(ref.split('.')[0]));
    if (endpoints.length < 2) return [];
    const id = unique('net'),
      entry = source.layout[wireLayoutKey(net.id)];
    if (entry)
      layout[wireLayoutKey(id)] = {
        ...entry,
        wireBend: entry.wireBend
          ? { x: entry.wireBend.x + 40, y: entry.wireBend.y + 40 }
          : undefined,
        wireRoutes: entry.wireRoutes
          ?.filter((route) => endpoints.includes(route.from) && endpoints.includes(route.to))
          .map((route) => ({
            ...route,
            from: endpoint(route.from),
            to: endpoint(route.to),
            points: route.points.map((point) => ({ x: point.x + 40, y: point.y + 40 })),
          })),
      };
    return [{ ...net, id, endpoints: endpoints.map(endpoint) }];
  });
  return {
    'circuit.json': json({
      ...source.circuit,
      instances: [...source.circuit.instances, ...instances],
      nets: [...source.circuit.nets, ...nets],
    }),
    'layout.json': json(layout),
  };
}

export function deleteSelection(source: Source, ids: string[], netId?: string, branch?: WireRef) {
  if (branch) {
    if (!netId || ids.length) throw new Error('請選取單一接線');
    return disconnectWire(source, netId, branch);
  }
  const selected = new Set(ids),
    layout = { ...source.layout };
  if (
    ids.some(
      (id) =>
        !source.circuit.instances.some((instance) => instance.id === id) &&
        layout[id]?.kind !== 'zone',
    ) ||
    (netId && !source.circuit.nets.some((net) => net.id === netId))
  )
    throw new Error('選取目標已不存在，請重新選取');
  for (const id of ids) delete layout[id];
  const nets = source.circuit.nets
    .filter((net) => net.id !== netId)
    .map((net) => ({
      ...net,
      endpoints: net.endpoints.filter((ref) => !selected.has(ref.split('.')[0])),
    }))
    .filter((net) => net.endpoints.length >= 2);
  for (const net of source.circuit.nets) {
    const retained = nets.find((next) => next.id === net.id),
      key = wireLayoutKey(net.id);
    if (!retained) delete layout[key];
    else if (layout[key]?.wireRoutes)
      layout[key] = {
        ...layout[key],
        wireRoutes: layout[key].wireRoutes?.filter(
          (route) =>
            retained.endpoints.includes(route.from) && retained.endpoints.includes(route.to),
        ),
      };
  }
  return {
    'circuit.json': json({
      ...source.circuit,
      instances: source.circuit.instances.filter((instance) => !selected.has(instance.id)),
      nets,
      bindings: source.circuit.bindings.filter(
        (binding) => !selected.has(binding.endpoint.split('.')[0]),
      ),
    }),
    'layout.json': json(layout),
    'project.json': json({
      ...source.project,
      board: selected.has(source.project.board) ? '' : source.project.board,
      profile: selected.has(source.project.board) ? 'custom' : source.project.profile,
    }),
  };
}

export function disconnectWire(source: Source, netId: string, branch: WireRef) {
  const net = source.circuit.nets.find((net) => net.id === netId);
  if (!net) throw new Error('選取接線已不存在，請重新選取');
  const key = wireLayoutKey(netId),
    entry = source.layout[key];
  const routes = wireConnections(net.endpoints, entry?.wireRoutes);
  if (!routes.some((route) => sameWire(route, branch)))
    throw new Error('選取接線已不存在，請重新選取');
  const retained = routes.filter((route) => !sameWire(route, branch));
  const remaining = new Set(net.endpoints);
  const groups: string[][] = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value!],
      group: string[] = [];
    while (queue.length) {
      const ref = queue.shift()!;
      if (!remaining.delete(ref)) continue;
      group.push(ref);
      for (const route of retained) {
        if (route.from === ref) queue.push(route.to);
        if (route.to === ref) queue.push(route.from);
      }
    }
    if (group.length >= 2) groups.push(group);
  }
  const layout = { ...source.layout };
  delete layout[key];
  const nets = groups.map((endpoints, index) => {
    const id = index === 0 ? net.id : 'net_' + randomUUID().replaceAll('-', '').slice(0, 12);
    layout[wireLayoutKey(id)] = {
      ...(entry ?? { x: 0, y: 0 }),
      wireBend: undefined,
      wireRoutes: retained.filter(
        (route) => endpoints.includes(route.from) && endpoints.includes(route.to),
      ),
    };
    return { ...net, id, endpoints };
  });
  return {
    'circuit.json': json({
      ...source.circuit,
      nets: source.circuit.nets.flatMap((saved) => (saved.id === netId ? nets : [saved])),
    }),
    'layout.json': json(layout),
  };
}

export function organizeWorkspace(source: Source) {
  const layout = { ...source.layout };
  const remaining = new Set(source.circuit.instances.map((instance) => instance.id));
  const order: string[] = [];
  const queue =
    source.project.board && remaining.has(source.project.board) ? [source.project.board] : [];
  while (remaining.size) {
    if (!queue.length) queue.push(remaining.values().next().value!);
    const id = queue.shift()!;
    if (!remaining.delete(id)) continue;
    order.push(id);
    for (const net of source.circuit.nets.filter((net) =>
      net.endpoints.some((endpoint) => endpoint.startsWith(id + '.')),
    ))
      for (const endpoint of net.endpoints)
        if (remaining.has(endpoint.split('.')[0])) queue.push(endpoint.split('.')[0]);
  }
  const definitions = [...source.catalog.definitions, ...source.custom];
  const geometry = order.map((id) => {
    const instance = source.circuit.instances.find((instance) => instance.id === id)!;
    const definition = definitions.find(
      (definition) =>
        definition.typeId === instance.typeId && definition.version === instance.definitionVersion,
    )!;
    return transformedGeometry(definition, layout[id] ?? { x: 0, y: 0 });
  });
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(order.length))));
  const width = Math.ceil((Math.max(0, ...geometry.map((item) => item.width)) + 180) / 20) * 20;
  const height = Math.ceil((Math.max(0, ...geometry.map((item) => item.height)) + 160) / 20) * 20;
  order.forEach((id, index) => {
    layout[id] = {
      ...layout[id],
      x: 80 + (index % columns) * width,
      y: 80 + Math.floor(index / columns) * height,
    };
  });
  return arrangeWires({ ...source, layout });
}
