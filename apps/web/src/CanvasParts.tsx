import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  useReactFlow,
  useUpdateNodeInternals,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import type { Definition, Instance, LayoutEntry } from '../../../packages/core/src/model';
import {
  transformedGeometry,
  orthogonalPoints,
  wirePath,
  snapCanvasPoint,
} from '../../../packages/core/src/graphics';
import { HardwareArt } from './HardwareArt';
import { runtimePost } from './LocalTools';
import { componentName } from '../../../packages/core/src/component-settings';
import { useT } from './i18n';
import {
  insertWirePoint,
  moveWireSegment,
  type WirePoint,
} from '../../../packages/core/src/routing';

export function PhysicalNode({ id, data, selected }: NodeProps<Node<any>>) {
  const t = useT();
  const d = data.definition as Definition,
    i = data.instance as Instance,
    entry = (data.entry ?? { x: 0, y: 0 }) as LayoutEntry;
  const geo = transformedGeometry(d, entry),
    update = useUpdateNodeInternals();
  // Push buttons can be held on the canvas while a simulation runs; the level is sent on change.
  const [pressed, setHeld] = useState(false),
    sent = useRef(false);
  useEffect(() => {
    if (pressed === sent.current) return;
    sent.current = pressed;
    void runtimePost('simulation/input', { id: i.id, pressed }).catch((error) => {
      if (pressed) console.warn('按鈕輸入失敗：', error.message);
    });
  }, [pressed, i.id]);
  useEffect(() => {
    if (!data.pressable) setHeld(false);
  }, [data.pressable]);
  useEffect(() => {
    update(id);
  }, [id, geo.width, geo.height, entry.rotation, d.visual, update]);
  const sides = {
    left: Position.Left,
    right: Position.Right,
    top: Position.Top,
    bottom: Position.Bottom,
  };
  return (
    <article
      className={
        'component-node physical-node ' +
        (selected ? 'active ' : '') +
        (entry.labels || data.showPins ? 'show-pin-labels' : '')
      }
      style={{ width: geo.width, height: geo.height + 36 }}
      data-rotation={entry.rotation ?? 0}
    >
      <div className="part-selection-outline" style={{ height: geo.height }} />
      <svg
        className="physical-art"
        width={geo.width}
        height={geo.height}
        viewBox={`0 0 ${geo.width} ${geo.height}`}
      >
        <g transform={`scale(${geo.scale}) ${geo.transform}`}>
          <HardwareArt
            definition={d}
            parameters={i.parameters}
            ledOn={data.ledOn}
            screen={data.screen}
            buzzing={data.buzzing}
            pressed={pressed}
          />
        </g>
      </svg>
      {data.pressable && (
        <button
          type="button"
          className={'sim-press nodrag nopan' + (pressed ? ' held' : '')}
          style={{ width: geo.width, height: geo.height }}
          aria-label={t('按住 {id}', { id: i.id })}
          aria-pressed={pressed}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setHeld(true);
          }}
          onPointerUp={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onLostPointerCapture={() => setHeld(false)}
          onBlur={() => setHeld(false)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              // Keep React Flow from selecting the part, which would release the held button.
              e.stopPropagation();
              if (!e.repeat) setHeld(true);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              setHeld(false);
            }
          }}
        />
      )}
      {d.pins.map((pin) => {
        const pos = geo.pins[pin.id],
          ref = i.id + '.' + pin.id;
        const focused = data.target?.id === ref,
          pending = data.wireStart === ref;
        return (
          <div key={pin.id}>
            <Handle
              type="source"
              isConnectableStart={false}
              isConnectableEnd={false}
              id={pin.id}
              position={sides[pos.side]}
              className={
                'physical-handle nodrag ' +
                (data.connected?.includes(ref) ? 'connected ' : '') +
                (focused ? 'focused ' : '') +
                (pending ? 'wire-start' : '')
              }
              style={{ left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }}
              aria-label={t('接腳') + ' ' + ref}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  data.pinClick(ref);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                data.pinClick(ref);
              }}
            />
            <button
              className={'pin-caption nodrag ' + pos.side + (focused ? ' focused' : '')}
              style={{ left: pos.x, top: pos.y }}
              onClick={(e) => {
                e.stopPropagation();
                data.select({ kind: 'pin', id: ref });
              }}
              tabIndex={entry.labels || data.showPins ? 0 : -1}
            >
              {pin.name}
            </button>
          </div>
        );
      })}
      <button
        className="part-name nodrag"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        hidden={data.showNames === false}
        style={{ top: geo.height + 22 }}
        onClick={(e) => {
          e.stopPropagation();
          data.select({ kind: 'instance', id: i.id }, e.shiftKey || e.ctrlKey || e.metaKey);
        }}
      >
        <strong>{entry.label || t(componentName(d))}</strong>
        {!d.pins.length && <em>{t('材料規劃')}</em>}
      </button>
      {data.diagnostics?.some((item: any) => item.state !== 'pass') && (
        <button
          className={
            'part-check nodrag ' +
            (data.diagnostics.some((item: any) => item.state === 'fail')
              ? 'fail'
              : data.diagnostics.some(
                    (item: any) => item.state === 'unknown' || item.state === 'not_run',
                  )
                ? 'unknown'
                : 'pass')
          }
          aria-label={t('{id} 檢查結果', { id: i.id })}
          title={
            data.diagnostics
              .filter((item: any) => item.state !== 'pass')
              .map((item: any) => t(item.reason))
              .join('\n') || t('檢查通過')
          }
          onClick={(event) => {
            event.stopPropagation();
            data.select({ kind: 'instance', id: i.id });
          }}
        >
          <span aria-hidden="true">!</span>
        </button>
      )}
    </article>
  );
}
export function ZoneNode({ data, selected }: NodeProps<Node<any>>) {
  const t = useT();
  const entry = data.entry as LayoutEntry;
  return (
    <section
      className={'work-zone ' + (selected ? 'selected' : '')}
      style={
        {
          width: entry.width ?? 460,
          height: entry.height ?? 300,
          '--zone-color': entry.color ?? '#8dbfa5',
        } as CSSProperties
      }
      aria-label={t('工作區域 {label}', { label: entry.label ?? t('自訂區域') })}
    >
      <span className="zone-title">
        <b>▧</b>
        {entry.label ?? t('自訂區域')}
      </span>
      <small>{t('自由配置區域')}</small>
    </section>
  );
}
export function WireEdge(props: EdgeProps) {
  const t = useT();
  const {
    sourceX: rawSx,
    sourceY: rawSy,
    targetX: rawTx,
    targetY: rawTy,
    sourcePosition,
    targetPosition,
    data,
    selected,
    style,
  } = props;
  const sx = Math.round(rawSx * 1000) / 1000,
    sy = Math.round(rawSy * 1000) / 1000,
    tx = Math.round(rawTx * 1000) / 1000,
    ty = Math.round(rawTy * 1000) / 1000;
  const flow = useReactFlow(),
    edgeData = data ?? {},
    entry = (edgeData.entry ?? {}) as LayoutEntry;
  const clipId = 'wire-label-clearance-' + useId().replace(/:/g, '');
  // Keep component-name buttons clickable even when a saved wire crosses them.
  const labelHoles = flow
    .getNodes()
    .flatMap((node) => {
      const definition = node.data.definition as Definition | undefined;
      if (!definition || node.data.showNames === false) return [];
      const layout = (node.data.entry ?? node.position) as LayoutEntry;
      const geometry = transformedGeometry(definition, layout);
      const name = layout.label || componentName(definition);
      const width = Math.max(
        24,
        [...name].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 10 : 6), 12),
      );
      const x = node.position.x + geometry.width / 2 - width / 2;
      const y = node.position.y + geometry.height + 22;
      return [`M${x} ${y}h${width}v24h${-width}Z`];
    })
    .join('');
  const [draft, setDraft] = useState<{ x: number; y: number }[] | null>(null);
  const standard = getSmoothStepPath({
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
    offset: 22,
  });
  // With zero corner radius React Flow emits only M/L coordinate pairs.
  const coordinates = (standard[0].match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  const standardVertices: WirePoint[] = [];
  for (let at = 0; at < coordinates.length; at += 2) {
    const point = { x: coordinates[at], y: coordinates[at + 1] };
    const last = standardVertices.at(-1);
    if (last?.x !== point.x || last?.y !== point.y) standardVertices.push(point);
  }
  const savedPoints = (edgeData.points ?? []) as { x: number; y: number }[];
  const points =
    draft ?? (savedPoints.length ? savedPoints : entry.wireBend ? [entry.wireBend] : []);
  const vertices = points.length
    ? orthogonalPoints(
        { x: sx, y: sy },
        [...points, { x: tx, y: ty }],
        sourcePosition === Position.Top || sourcePosition === Position.Bottom,
      )
    : standardVertices;
  const path = wirePath(vertices);
  const labelSegment = vertices.slice(0, -1).reduce(
    (best, a, index) => {
      const b = vertices[index + 1];
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      return length > best.length ? { a, b, length } : best;
    },
    { a: vertices[0], b: vertices[1] ?? vertices[0], length: -1 },
  );
  const labelHorizontal = labelSegment.a.y === labelSegment.b.y;
  const labelMiddleX = (labelSegment.a.x + labelSegment.b.x) / 2;
  const labelMiddleY = (labelSegment.a.y + labelSegment.b.y) / 2;
  const labelX = labelMiddleX + (labelHorizontal ? 0 : labelMiddleX > Math.max(sx, tx) ? -48 : 48);
  const labelY =
    labelMiddleY + (labelHorizontal ? (labelMiddleY < Math.min(sy, ty) ? 32 : -32) : 0);
  const drag = useRef<{
    vertices: WirePoint[];
    index: number;
    x: number;
    y: number;
    moved: boolean;
    cursor?: WirePoint;
  } | null>(null);
  const editingVertices = drag.current?.vertices ?? vertices;
  const segments = editingVertices
    .slice(0, -1)
    .map((a, index) => ({ a, b: editingVertices[index + 1], index }));
  const addPoint = (index: number, x: number, y: number) =>
    (edgeData.change as Function)(
      insertWirePoint(vertices, index, flow.screenToFlowPosition({ x, y })),
    );
  return (
    <>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path
            d={'M-1000000 -1000000h2000000v2000000h-2000000Z' + labelHoles}
            clipRule="evenodd"
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <BaseEdge
          id={props.id}
          path={path}
          style={{
            ...style,
            strokeWidth: entry.wireWidth ?? 3,
            strokeLinecap: 'round',
            strokeLinejoin: 'miter',
            filter: 'drop-shadow(0 1px 1px #19362733)',
          }}
          interactionWidth={18}
        />
        {segments.map(({ a, b, index }) => (
          <path
            key={index}
            className="wire-segment-hit"
            data-edge-id={props.id}
            d={wirePath([a, b])}
            fill="none"
            stroke="transparent"
            strokeWidth={18}
            onClick={(event) => {
              event.stopPropagation();
              (edgeData.select as Function)({ kind: 'net', id: edgeData.netId });
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              void addPoint(index, event.clientX, event.clientY);
            }}
          />
        ))}
      </g>
      <EdgeLabelRenderer>
        {Boolean(data?.first) && (
          <>
            <button
              className={'wire-label nodrag nopan ' + (selected ? 'selected' : '')}
              data-edge-id={props.id}
              style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
              onClick={(event) => {
                event.stopPropagation();
                event.currentTarget.focus();
                (edgeData.select as Function)({ kind: 'net', id: edgeData.netId });
              }}
            >
              {props.label}
              {Boolean((edgeData.diagnostics as any[])?.length) && (
                <span
                  className="wire-warning"
                  title={(edgeData.diagnostics as any[]).map((item) => t(item.reason)).join('\n')}
                  aria-label={t('接線有問題')}
                >
                  {' '}
                  !
                </span>
              )}
            </button>
          </>
        )}
        {selected &&
          segments.map(({ a, b, index }) => (
            <button
              key={index}
              aria-label={t('拖曳接線中點')}
              data-edge-id={props.id}
              data-segment-length={Math.abs(a.x - b.x) + Math.abs(a.y - b.y)}
              title={t('拖曳移動線段，雙擊新增控制點')}
              onClick={(event) => event.stopPropagation()}
              className={
                'wire-bend wire-midpoint nodrag nopan ' + (a.y === b.y ? 'horizontal' : 'vertical')
              }
              style={{
                transform: `translate(-50%,-50%) translate(${drag.current?.index === index && a.x === b.x && drag.current.cursor ? drag.current.cursor.x : (a.x + b.x) / 2}px,${drag.current?.index === index && a.y === b.y && drag.current.cursor ? drag.current.cursor.y : (a.y + b.y) / 2}px)`,
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                void addPoint(index, event.clientX, event.clientY);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                const startVertices = vertices;
                const startIndex = index;
                const startX = e.clientX;
                const startY = e.clientY;
                let moved = false;
                drag.current = {
                  vertices: startVertices,
                  index: startIndex,
                  x: startX,
                  y: startY,
                  moved: false,
                };

                const handleMove = (ev: PointerEvent) => {
                  if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3 && !moved) return;
                  moved = true;
                  if (drag.current) drag.current.moved = true;
                  const position = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
                  if (drag.current) drag.current.cursor = snapCanvasPoint(position);
                  setDraft(moveWireSegment(startVertices, startIndex, position));
                };

                const handleUp = (ev: PointerEvent) => {
                  window.removeEventListener('pointermove', handleMove);
                  window.removeEventListener('pointerup', handleUp);
                  window.removeEventListener('pointercancel', handleCancel);
                  if (!moved) {
                    drag.current = null;
                    return;
                  }
                  const point = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
                  Promise.resolve(
                    (edgeData.change as Function)(
                      moveWireSegment(startVertices, startIndex, point),
                    ),
                  ).finally(() => {
                    setDraft(null);
                    drag.current = null;
                  });
                };

                const handleCancel = () => {
                  window.removeEventListener('pointermove', handleMove);
                  window.removeEventListener('pointerup', handleUp);
                  window.removeEventListener('pointercancel', handleCancel);
                  setDraft(null);
                  drag.current = null;
                };

                window.addEventListener('pointermove', handleMove);
                window.addEventListener('pointerup', handleUp);
                window.addEventListener('pointercancel', handleCancel);
              }}
            >
              <span aria-hidden="true">•</span>
            </button>
          ))}
        {selected &&
          points.map((point, index) => (
            <button
              key={'control-' + index}
              className="wire-control nodrag nopan"
              aria-label={t('接線控制點')}
              data-edge-id={props.id}
              data-control-index={index}
              title={t('接線控制點')}
              onClick={(event) => event.stopPropagation()}
              style={{ transform: `translate(-50%,-50%) translate(${point.x}px,${point.y}px)` }}
              onKeyDown={(event) => {
                if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                event.preventDefault();
                event.stopPropagation();
                void (edgeData.change as Function)(points.filter((_point, at) => at !== index));
              }}
            />
          ))}
      </EdgeLabelRenderer>
    </>
  );
}
export const canvasNodeTypes = { component: PhysicalNode, zone: ZoneNode };
export const canvasEdgeTypes = { wire: WireEdge };

export function AppearanceSettings({
  entry,
  onSave,
}: {
  entry: LayoutEntry;
  onSave: (patch: Partial<LayoutEntry>) => void;
}) {
  const t = useT();
  return (
    <section className="appearance-settings">
      <h3>{t('外觀與擺放')}</h3>
      <div className="appearance-actions">
        <button
          aria-label={t('元件逆時針旋轉')}
          onClick={() =>
            onSave({ rotation: (((entry.rotation ?? 0) + 270) % 360) as LayoutEntry['rotation'] })
          }
        >
          ↶ 90°
        </button>
        <button
          aria-label={t('元件順時針旋轉')}
          onClick={() =>
            onSave({ rotation: (((entry.rotation ?? 0) + 90) % 360) as LayoutEntry['rotation'] })
          }
        >
          ↷ 90°
        </button>
      </div>
      <label>
        {t('元件尺寸')}
        <select
          aria-label={t('元件尺寸')}
          value={entry.scale ?? 1}
          onChange={(e) => onSave({ scale: Number(e.target.value) })}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
            <option key={s} value={s}>
              {Math.round(s * 100)}%
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={entry.labels ?? false}
          onChange={(e) => onSave({ labels: e.target.checked })}
        />
        {t('顯示全部接腳名稱')}
      </label>
      <label>
        {t('畫布自訂名稱')}
        <input
          aria-label={t('畫布自訂名稱')}
          defaultValue={entry.label ?? ''}
          key={entry.label}
          onBlur={(e) => {
            if (e.target.value !== (entry.label ?? '')) onSave({ label: e.target.value });
          }}
          maxLength={120}
        />
      </label>
    </section>
  );
}
