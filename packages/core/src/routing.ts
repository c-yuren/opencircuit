import type { Net, Source, WireRef, WireRoute } from './model';
import {
  canvasGridSize,
  orthogonalPoints,
  snapCanvasPoint,
  transformedGeometry,
  wireConnections,
  wireLayoutKey,
  sameWire,
} from './graphics';

export type WirePoint = { x: number; y: number };
export type WireObstacle = { id: string; left: number; top: number; right: number; bottom: number };
type WireTerminal = WirePoint & { owner: string; side: 'left' | 'right' | 'top' | 'bottom' };

export function segmentHitsObstacle(a: WirePoint, b: WirePoint, box: WireObstacle) {
  if (a.y === b.y)
    return (
      a.y > box.top &&
      a.y < box.bottom &&
      Math.max(a.x, b.x) > box.left &&
      Math.min(a.x, b.x) < box.right
    );
  if (a.x === b.x)
    return (
      a.x > box.left &&
      a.x < box.right &&
      Math.max(a.y, b.y) > box.top &&
      Math.min(a.y, b.y) < box.bottom
    );
  return true;
}

function compact(points: WirePoint[]) {
  const result: WirePoint[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const previous = result.at(-2);
    if (
      previous &&
      last &&
      ((previous.x === last.x && last.x === point.x) ||
        (previous.y === last.y && last.y === point.y))
    )
      result.pop();
    result.push(point);
  }
  return result;
}

// Route cost model, in canvas pixels. A turn costs as much as walking a few grid cells, and a
// crossing as much as walking a few more, so a tidy detour beats a short but tangled path.
const BEND_COST = 30;
const CROSSING_COST = canvasGridSize * 3;

// Parallel wires need separate lanes; perpendicular crossings are less costly
// than hiding a whole length of one wire underneath another.
function wireCongestion(a: WirePoint, b: WirePoint, wires: WirePoint[][]) {
  const horizontal = a.y === b.y;
  let cost = 0;
  for (const wire of wires) {
    for (let at = 1; at < wire.length; at++) {
      const c = wire[at - 1],
        d = wire[at];
      if (c.x === d.x && c.y === d.y) continue;
      if (horizontal === (c.y === d.y)) {
        const distance = Math.abs(horizontal ? a.y - c.y : a.x - c.x);
        if (distance >= canvasGridSize) continue;
        const overlap = horizontal
          ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
          : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
        if (overlap > 0) cost += overlap * 40 * (1 - distance / canvasGridSize);
      } else {
        const h1 = horizontal ? a : c,
          h2 = horizontal ? b : d;
        const v1 = horizontal ? c : a,
          v2 = horizontal ? d : b;
        if (
          v1.x > Math.min(h1.x, h2.x) &&
          v1.x < Math.max(h1.x, h2.x) &&
          h1.y > Math.min(v1.y, v2.y) &&
          h1.y < Math.max(v1.y, v2.y)
        )
          cost += CROSSING_COST;
      }
    }
  }
  return cost;
}

// Cost of a finished route against the wires around it: the measure the arranger uses to decide
// whether re-routing a wire after its neighbours moved actually made it better.
export function pathCost(points: WirePoint[], occupied: WirePoint[][]) {
  let cost = 0;
  const segments = points.slice(1).map((point, at) => [points[at], point] as const);
  const live = segments.filter(([a, b]) => a.x !== b.x || a.y !== b.y);
  live.forEach(([a, b], at) => {
    cost += Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + wireCongestion(a, b, occupied);
    const next = live[at + 1];
    if (next && (a.y === b.y) !== (next[0].y === next[1].y)) cost += BEND_COST;
  });
  return cost;
}

export function routeAroundComponents(
  start: WireTerminal,
  end: WireTerminal,
  obstacles: WireObstacle[],
  occupied: WirePoint[][] = [],
) {
  const escape = (pin: WireTerminal) => {
    const box = obstacles.find((box) => box.id === pin.owner)!;
    if (pin.side === 'left') return { x: box.left, y: pin.y };
    if (pin.side === 'right') return { x: box.right, y: pin.y };
    if (pin.side === 'top') return { x: pin.x, y: box.top };
    return { x: pin.x, y: box.bottom };
  };
  const first = escape(start),
    last = escape(end);
  if (
    obstacles.some(
      (box) =>
        (box.id !== start.owner && segmentHitsObstacle(start, first, box)) ||
        (box.id !== end.owner && segmentHitsObstacle(last, end, box)),
    )
  )
    return null;
  const axes = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const lanes = occupied.flat();
  const xs = axes([
    first.x,
    last.x,
    first.x - canvasGridSize,
    first.x + canvasGridSize,
    last.x - canvasGridSize,
    last.x + canvasGridSize,
    ...obstacles.flatMap((box) => [box.left, box.right]),
    ...lanes.flatMap((point) => [point.x - canvasGridSize, point.x, point.x + canvasGridSize]),
  ]);
  const ys = axes([
    first.y,
    last.y,
    first.y - canvasGridSize,
    first.y + canvasGridSize,
    last.y - canvasGridSize,
    last.y + canvasGridSize,
    ...obstacles.flatMap((box) => [box.top, box.bottom]),
    ...lanes.flatMap((point) => [point.y - canvasGridSize, point.y, point.y + canvasGridSize]),
  ]);
  xs.unshift(xs[0] - canvasGridSize);
  xs.push(xs.at(-1)! + canvasGridSize);
  ys.unshift(ys[0] - canvasGridSize);
  ys.push(ys.at(-1)! + canvasGridSize);
  const pointAt = (index: number) => ({
    x: xs[index % xs.length],
    y: ys[Math.floor(index / xs.length)],
  });
  const indexAt = (point: WirePoint) => ys.indexOf(point.y) * xs.length + xs.indexOf(point.x);
  const source = indexAt(first),
    target = indexAt(last);
  // Search the compressed grid at obstacle boundaries, with a small cost for turns.
  type Step = { index: number; direction: number; cost: number; estimate: number; previous?: Step };
  const pending: Step[] = [{ index: source, direction: -1, cost: 0, estimate: 0 }];
  const costs = new Map<string, number>();
  const dx = last.x - first.x,
    dy = last.y - first.y;
  const directLength = Math.hypot(dx, dy);
  // Prefer turns near the connection corridor over enclosing the whole workspace.
  const corridorCost = (a: WirePoint, b: WirePoint, length: number) => {
    if (!directLength) return 0;
    const x = (a.x + b.x) / 2 - first.x,
      y = (a.y + b.y) / 2 - first.y;
    const distance = Math.abs(x * dy - y * dx) / directLength;
    return ((length * distance) / (directLength + canvasGridSize)) * 2;
  };
  const push = (step: Step) => {
    pending.push(step);
    let index = pending.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (pending[parent].estimate <= step.estimate) break;
      pending[index] = pending[parent];
      index = parent;
    }
    pending[index] = step;
  };
  const pop = () => {
    const first = pending[0],
      last = pending.pop()!;
    if (pending.length) {
      let index = 0;
      while (index * 2 + 1 < pending.length) {
        let child = index * 2 + 1;
        if (child + 1 < pending.length && pending[child + 1].estimate < pending[child].estimate)
          child++;
        if (pending[child].estimate >= last.estimate) break;
        pending[index] = pending[child];
        index = child;
      }
      pending[index] = last;
    }
    return first;
  };
  while (pending.length) {
    const step = pop();
    const key = step.index + ':' + step.direction;
    if ((costs.get(key) ?? Infinity) < step.cost) continue;
    if (step.index === target) {
      const route: WirePoint[] = [];
      for (let at: Step | undefined = step; at; at = at.previous) route.unshift(pointAt(at.index));
      return compact([start, ...route, end]);
    }
    const x = step.index % xs.length,
      y = Math.floor(step.index / xs.length),
      a = pointAt(step.index);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      if (x + dx < 0 || x + dx >= xs.length || y + dy < 0 || y + dy >= ys.length) continue;
      const index = (y + dy) * xs.length + x + dx,
        b = pointAt(index),
        direction = dx ? 0 : 1;
      if (obstacles.some((box) => segmentHitsObstacle(a, b, box))) continue;
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const cost =
        step.cost +
        length +
        corridorCost(a, b, length) +
        wireCongestion(a, b, occupied) +
        (step.direction >= 0 && step.direction !== direction ? BEND_COST : 0);
      const nextKey = index + ':' + direction;
      if (cost >= (costs.get(nextKey) ?? Infinity)) continue;
      costs.set(nextKey, cost);
      push({
        index,
        direction,
        cost,
        estimate: cost + Math.abs(b.x - last.x) + Math.abs(b.y - last.y),
        previous: step,
      });
    }
  }
  return null;
}

export function arrangeWires(source: Source, netId?: string, branch?: WireRef) {
  if (
    branch &&
    (!netId ||
      !source.circuit.nets.some(
        (net) =>
          net.id === netId &&
          wireConnections(net.endpoints, source.layout[wireLayoutKey(net.id)]?.wireRoutes).some(
            (route) => sameWire(route, branch),
          ),
      ))
  )
    throw new Error('選取接線已不存在，請重新選取');
  const parts = source.circuit.instances.map((instance) => {
    const definition = [...source.catalog.definitions, ...source.custom].find(
      (definition) =>
        definition.typeId === instance.typeId && definition.version === instance.definitionVersion,
    )!;
    const entry = source.layout[instance.id] ?? { x: 100, y: 100 };
    const geometry = transformedGeometry(definition, entry);
    const margin = 12;
    const box = {
      id: instance.id,
      left: Math.floor((entry.x - margin) / canvasGridSize) * canvasGridSize,
      top: Math.floor((entry.y - margin) / canvasGridSize) * canvasGridSize,
      right: Math.ceil((entry.x + geometry.width + margin) / canvasGridSize) * canvasGridSize,
      bottom:
        Math.ceil((entry.y + geometry.height + 36 + margin) / canvasGridSize) * canvasGridSize,
    };
    return { instance, entry, geometry, box };
  });
  const terminal = (ref: string): WireTerminal => {
    const [id, pin] = ref.split('.');
    const part = parts.find((part) => part.instance.id === id)!;
    const position = part.geometry.pins[pin];
    return {
      x: part.entry.x + position.x,
      y: part.entry.y + position.y,
      side: position.side,
      owner: id,
    };
  };
  const layout = { ...source.layout };
  const occupied: WirePoint[][] = [];
  // Keep unselected wires in place and reserve their saved paths (or an
  // orthogonal fallback for connections that have not been arranged yet).
  if (netId) {
    for (const net of source.circuit.nets) {
      const entry = layout[wireLayoutKey(net.id)];
      for (const route of wireConnections(net.endpoints, entry?.wireRoutes)) {
        if (net.id === netId && (!branch || sameWire(route, branch))) continue;
        const start = terminal(route.from),
          end = terminal(route.to);
        const stops = route.points.length ? route.points : entry?.wireBend ? [entry.wireBend] : [];
        occupied.push(
          orthogonalPoints(start, [...stops, end], start.side === 'top' || start.side === 'bottom'),
        );
      }
    }
  }
  const obstacles = parts.map((part) => part.box);
  type Job = { net: Net; route: WireRoute; path?: WirePoint[] };
  const jobs: Job[] = [];
  const connections = new Map<string, WireRoute[]>();
  for (const net of source.circuit.nets.filter((net) => !netId || net.id === netId)) {
    let routes = wireConnections(net.endpoints, layout[wireLayoutKey(net.id)]?.wireRoutes);
    if (!branch && isAutoStar(net.endpoints, routes))
      routes = treeConnections(net.endpoints, terminal);
    connections.set(net.id, routes);
    for (const route of routes) if (!branch || sameWire(route, branch)) jobs.push({ net, route });
  }
  // Short wires first: they have the fewest choices and should keep the direct lanes.
  const distance = (job: Job) => {
    const a = terminal(job.route.from),
      b = terminal(job.route.to);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  jobs.sort((a, b) => distance(a) - distance(b));
  const place = (job: Job) => {
    const points = routeAroundComponents(
      terminal(job.route.from),
      terminal(job.route.to),
      obstacles,
      occupied,
    );
    if (!points) throw new Error('接線附近的元件太靠近，請先拉開一點再理線：' + job.net.name);
    job.path = points;
    occupied.push(points);
  };
  for (const job of jobs) place(job);
  // Rip up and re-route: once its neighbours are in place a wire can often take a cheaper path
  // than the one it got when it was routed early. Keep a change only if it is strictly cheaper.
  const passes = jobs.length > 60 ? 1 : 3;
  for (let pass = 0; pass < passes && jobs.length > 1; pass++) {
    let improved = false;
    const ranked = jobs
      .map((job) => ({
        job,
        cost: pathCost(
          job.path!,
          occupied.filter((path) => path !== job.path),
        ),
      }))
      .sort((a, b) => b.cost - a.cost);
    for (const { job } of ranked) {
      const others = occupied.filter((path) => path !== job.path);
      const before = pathCost(job.path!, others);
      const points = routeAroundComponents(
        terminal(job.route.from),
        terminal(job.route.to),
        obstacles,
        others,
      );
      if (!points || pathCost(points, others) >= before - 1) continue;
      occupied.splice(occupied.indexOf(job.path!), 1, points);
      job.path = points;
      improved = true;
    }
    if (!improved) break;
  }
  for (const [id, routes] of connections) {
    const key = wireLayoutKey(id);
    layout[key] = {
      ...(layout[key] ?? { x: 0, y: 0 }),
      wireBend: undefined,
      wireStyle: 'orthogonal',
      wireRoutes: routes.map((route) => {
        const job = jobs.find((job) => job.route === route);
        return job ? { ...route, points: job.path!.slice(1, -1) } : route;
      }),
    };
  }
  return layout;
}

// A net whose wires all leave its first pin and carry no names or styling is the default layout
// nobody drew on purpose, so it is free to be re-planned.
function isAutoStar(endpoints: string[], routes: WireRoute[]) {
  return (
    endpoints.length > 2 &&
    routes.length === endpoints.length - 1 &&
    routes.every(
      (route) =>
        route.from === endpoints[0] && !route.name && !route.color && route.wireWidth === undefined,
    )
  );
}

// Connects the pins with the shortest total wire (minimum spanning tree, Manhattan distance)
// instead of a star from the first pin, so a shared net such as GND runs pin to nearest pin.
function treeConnections(endpoints: string[], terminal: (ref: string) => WirePoint): WireRoute[] {
  const inTree = [endpoints[0]];
  const routes: WireRoute[] = [];
  while (inTree.length < endpoints.length) {
    let best: { from: string; to: string; length: number } | undefined;
    for (const from of inTree)
      for (const to of endpoints) {
        if (inTree.includes(to)) continue;
        const a = terminal(from),
          b = terminal(to),
          length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (!best || length < best.length) best = { from, to, length };
      }
    routes.push({ from: best!.from, to: best!.to, points: [] });
    inTree.push(best!.to);
  }
  return routes;
}

export function moveWireSegment(points: WirePoint[], index: number, cursor: WirePoint) {
  const a = points[index],
    b = points[index + 1],
    horizontal = a.y === b.y;
  const snapped = snapCanvasPoint(cursor);
  const movedA = horizontal ? { x: a.x, y: snapped.y } : { x: snapped.x, y: a.y };
  const movedB = horizontal ? { x: b.x, y: snapped.y } : { x: snapped.x, y: b.y };
  const stops = [...points.slice(1, index), movedA, movedB, ...points.slice(index + 2)];
  if (index + 1 === points.length - 1) stops.push(b);
  return orthogonalPoints(points[0], stops, horizontal).slice(1, -1);
}

export function insertWirePoint(points: WirePoint[], index: number, cursor: WirePoint) {
  const a = points[index],
    b = points[index + 1],
    snapped = snapCanvasPoint(cursor);
  const point =
    a.y === b.y
      ? { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snapped.x)), y: a.y }
      : { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), snapped.y)) };
  if ((a.x === point.x && a.y === point.y) || (b.x === point.x && b.y === point.y))
    Object.assign(
      point,
      a.y === b.y
        ? { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), cursor.x)) }
        : { y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), cursor.y)) },
    );
  if ((a.x === point.x && a.y === point.y) || (b.x === point.x && b.y === point.y))
    return points.slice(1, -1);
  return [...points.slice(1, index + 1), point, ...points.slice(index + 1, -1)];
}
