import { appUrl } from './deployment';
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type CSSProperties,
} from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ViewportPortal,
  Handle,
  Position,
  ConnectionMode,
  useNodesState,
  useReactFlow,
  useNodesInitialized,
  type NodeProps,
  type Connection,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  Source,
  Definition,
  Instance,
  Comment,
  Current,
  Bom,
  Snapshot,
  Price,
  Category,
  WireRef,
  WireRoute,
} from '../../../packages/core/src/model';
import { catalog, moduleKind } from '../../../packages/core/src/catalog';
import { catalogPrice } from '../../../packages/core/src/pricing';
import type { getContext } from '../../../packages/core/src/project';
import type { LayoutEntry } from '../../../packages/core/src/model';
import {
  componentVisual,
  transformedGeometry,
  wireLayoutKey,
  wireConnections,
  orthogonalPoints,
  wirePath,
  canvasGridSize,
  snapCanvasPoint,
  sameWire,
} from '../../../packages/core/src/graphics';
import { HardwareArt } from './HardwareArt';
import { canvasNodeTypes, canvasEdgeTypes, AppearanceSettings } from './CanvasParts';
import { CustomVisualEditor } from './CustomVisualEditor';
import { LocalTools, runtimePost } from './LocalTools';
import { BuzzerPanel } from './SimulationPeripherals';
import { buzzerAudio } from './buzzerAudio';
import { ProjectManager } from './ProjectManager';
import { api } from './api';
import { WorkspaceActions, CodePreview, ResizeHandle } from './WorkspaceActions';
import { JobProgress } from './JobProgress';
import { boards } from '../../../packages/core/src/boards';
import { componentName, instanceDefinition } from '../../../packages/core/src/component-settings';
import { ComponentParameters } from './ComponentParameters';
import { estimatedConsumables, automaticWireColor } from '../../../packages/core/src/planning';
import { arrangeWires } from '../../../packages/core/src/routing';
import { Toolbar } from './Toolbar';
import { UpdateDialog, openIssueReport } from './SupportActions';
import { Dialog, IconButton, LanguageSwitch, usePreference } from './Ui';
import { intlLocale, t, useT } from './i18n';
import { ContextMenu, type MenuCommand } from './ContextMenu';
import { downloadBlob, downloadCircuit } from './DiagramExport';
import {
  CircuitBoard,
  FileCode2,
  Coins,
  History,
  Pin,
  X,
  Copy,
  Trash2,
  RotateCw,
  MousePointer2,
  Cable,
  Scan,
  Settings,
  Plus,
  SlidersHorizontal,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  LayoutGrid,
  ClipboardPaste,
  Lock,
  Unlock,
  Unplug,
  AlertTriangle,
} from 'lucide-react';
import type { WorkspaceRuntimeCommands } from './WorkspaceActions';
type Context = Awaited<ReturnType<typeof getContext>>;
type Target = Comment['target'];
const categories: Record<Category, string> = {
  controller: '控制器與通訊',
  sensor: '感測器與輸入',
  output: '顯示器與輸出',
  power: '電源',
  passive: '被動元件',
  connector: '排針與接頭材料',
  consumable: '線材與耗材',
};
const symbols: Record<Category, string> = {
  controller: '▦',
  sensor: '◉',
  output: '▣',
  power: 'ϟ',
  passive: '∿',
  connector: '⊞',
  consumable: '⌁',
};
const statusLabel: Record<string, string> = {
  open: '已開啟',
  draft: '草稿',
  checking: '檢查中',
  ready: '可套用',
  failed: '檢查失敗',
  conflict: '版本衝突',
  applied: '已套用',
  pass: '通過',
  fail: '失敗',
  unknown: '未知',
  not_run: '未執行',
};
const stateSymbol: Record<string, string> = { pass: '✓', fail: '×', unknown: '?', not_run: '○' };
const id = (prefix: string) => prefix + '_' + crypto.randomUUID().slice(0, 8);
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const jobNames: Record<string, string> = {
  simulate: '模擬',
  compile: '編譯',
  upload: '寫入板子',
  export: '匯出',
  install: '安裝工具',
};
const defFor = (s: Source, i: Instance) =>
  [...s.catalog.definitions, ...s.custom].find(
    (d) => d.typeId === i.typeId && d.version === i.definitionVersion,
  )!;
const money = (n: number, currency: string) =>
  new Intl.NumberFormat(intlLocale(), { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    n / 100,
  );
function minor(text: string) {
  if (!/^\d+(\.\d{0,2})?$/.test(text)) throw new Error(t('金額須為非負數，最多兩位小數'));
  const [a, b = ''] = text.split('.');
  const value = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) throw new Error(t('金額超出範圍'));
  return value;
}
const moneyRange = ([low, high]: [number, number], currency: string) =>
  low === high ? money(low, currency) : `${money(low, currency)} – ${money(high, currency)}`;

function PriceAttribution({ price }: { price: Price | null }) {
  const t = useT();
  if (!price) return <small>{t('尚無同幣別參考資料')}</small>;
  const url = price.source.match(/https:\/\/\S+/)?.[0];
  return (
    <small>
      {price.demo ? t('示範數據 · ') : ''}{price.date} · {t(url ? price.source.replace(url, '').trim() : price.source)}
      {url && <> · <a href={url} target="_blank" rel="noopener noreferrer">{t('查看價格來源')}</a></>}
    </small>
  );
}
export function App() {
  const t = useT();
  const [page, setPage] = useState(window.location.hash === '#workspace' ? 'workspace' : 'home');
  const pageRef = useRef(page);
  pageRef.current = page;
  const dirty = useRef(false);
  const reportDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  useEffect(() => {
    const change = () => {
      const next = window.location.hash === '#workspace' ? 'workspace' : 'home';
      if (
        pageRef.current === 'workspace' &&
        next === 'home' &&
        dirty.current &&
        !window.confirm(t('程式碼尚未儲存，要離開嗎？'))
      ) {
        window.history.replaceState(null, '', '#workspace');
        return;
      }
      setPage(next);
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('hashchange', change);
    window.addEventListener('beforeunload', leaving);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('beforeunload', leaving);
    };
  }, []);
  if (page === 'home')
    return (
      <ProjectManager
        onOpen={() => {
          window.location.hash = 'workspace';
        }}
      />
    );
  return (
    <ReactFlowProvider>
      <Workspace
        onDirtyChange={reportDirty}
        onHome={() => {
          window.location.hash = 'home';
        }}
      />
    </ReactFlowProvider>
  );
}
function Workspace({
  onHome,
  onDirtyChange,
}: {
  onHome: () => void;
  onDirtyChange: (value: boolean) => void;
}) {
  const t = useT();
  const [ctx, setCtx] = useState<Context | null>(null),
    [error, setError] = useState(''),
    [fileError, setFileError] = useState(''),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState('');
  const [target, setTarget] = useState<Target | null>(null),
    [selectedIds, setSelectedIds] = useState<string[]>([]),
    [mainView, setMainView] = useState('circuit'),
    [tab, setResultTab] = useState('rules'),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState('all'),
    [capability, setCapability] = useState('all');
  const [wireBranch, setWireBranch] = useState<(WireRef & { netId: string }) | null>(null);
  const [modal, setModal] = useState<'custom' | 'project' | 'template' | null>(null),
    [customSeed, setCustomSeed] = useState<Definition | null>(null);
  const [diff, setDiff] = useState<{ file: string; patch: string }[]>([]),
    [diffRev, setDiffRev] = useState(''),
    [editorFile, setEditorFile] = useState('firmware/main/main.ino'),
    [editor, setEditor] = useState(''),
    [editorDigest, setEditorDigest] = useState(''),
    [dirtyEditor, setDirtyEditor] = useState(false);
  const [editorDrafts, setEditorDrafts] = useState<
    Record<string, { text: string; digest: string }>
  >({});
  const setTab = useCallback((next: string) => {
    if (next === 'files') {
      setMainView('circuit');
      setResultTab('output');
    } else if (next === 'bom') setMainView('materials');
    else if (next === 'diff') setMainView('history');
    else {
      setMainView('circuit');
      setResultTab(next);
    }
  }, []);
  useEffect(() => {
    onDirtyChange(dirtyEditor || Object.keys(editorDrafts).length > 0);
    return () => onDirtyChange(false);
  }, [dirtyEditor, editorDrafts, onDirtyChange]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [wireStart, setWireStart] = useState<string | null>(null),
    [zoneId, setZoneId] = useState<string | null>(null);
  const wireStartRef = useRef<string | null>(null);
  wireStartRef.current = wireStart;
  const [wireDraft, setWireDraft] = useState<{
    points: { x: number; y: number }[];
    cursor: { x: number; y: number };
  } | null>(null);
  const wireDraftRef = useRef(wireDraft);
  wireDraftRef.current = wireDraft;
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const moreTools = false;
  const [checking, setChecking] = useState(false);
  const [preferences, setPreferences] = usePreference('workspace', {
    left: true,
    bottom: false,
    pinned: false,
    names: true,
    pins: false,
    grid: true,
    leftSize: 250,
    rightSize: 300,
    bottomSize: Math.round(window.innerHeight * 0.3),
  });
  const [canvasLocks, setCanvasLocks] = usePreference('canvas-locks', {
    projects: {} as Record<string, string[]>,
  });
  const lockedIds = (canvasLocks.projects[ctx?.root ?? ''] ?? []).filter((id) =>
    ctx?.source.circuit.instances.some((instance) => instance.id === id),
  );
  const [canvasClipboard, setCanvasClipboard] = useState<{ root: string; ids: string[] } | null>(
    null,
  );
  const [leftVisible, setLeftVisible] = useState(preferences.left),
    [rightVisible, setRightVisible] = useState(preferences.pinned),
    [bottomVisible, setBottomVisible] = useState(false),
    [leftSize, setLeftSize] = useState(preferences.leftSize),
    [rightSize, setRightSize] = useState(preferences.rightSize),
    [bottomSize, setBottomSize] = useState(preferences.bottomSize),
    [previewOpen, setPreviewOpen] = useState(false),
    [updateOpen, setUpdateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [boardReplacement, setBoardReplacement] = useState<Definition | null>(null),
    [actionIssue, setActionIssue] = useState(''),
    [displayOpen, setDisplayOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  const [exportKind, setExportKind] = useState<'svg' | 'png' | 'program' | 'project' | null>(null);
  const [compared, setCompared] = useState('');
  const [runtimeState, setRuntimeState] = useState<any>(null),
    [editState, setEditState] = useState({ undo: false, redo: false });
  const runtimeCommands = useRef<WorkspaceRuntimeCommands | null>(null);
  // A running simulation freezes the project: the service refuses every source write, so the
  // canvas, library and inspector are locked here instead of letting each edit fail.
  const frozen = !!(runtimeState?.simulationLocked || runtimeState?.simulation?.running);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: string;
    id?: string;
    ids: string[];
    point?: { x: number; y: number };
    edgeId?: string;
    controlIndex?: number;
  } | null>(null);
  const placement = useRef<{ x: number; y: number } | null>(null);
  const contextSelection = useRef<string[] | null>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const renameBaseline = useRef<{ root: string; digest: string; revision: string } | null>(null);
  const renamePending = useRef(false);
  const renameCancelled = useRef(false);
  useEffect(() => {
    renameCancelled.current = true;
    setWireBranch(null);
    renameBaseline.current = null;
    setRenamingProject(false);
  }, [ctx?.root]);
  const selectionVersion = useRef(0);
  const inspector = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const formDrafts = useRef(new Map<string, { digest: string; fields: Record<string, string> }>());
  const submittedForm = useRef<string | null>(null);
  useEffect(() => {
    setActionIssue('');
  }, [ctx?.root, ctx?.sourceDigest]);
  useEffect(() => {
    setPreferences((current) => ({
      ...current,
      left: leftVisible,
      bottom: bottomVisible,
      leftSize,
      rightSize,
      bottomSize,
    }));
  }, [leftVisible, bottomVisible, leftSize, rightSize, bottomSize]);
  useEffect(() => {
    if (target || zoneId) setRightVisible(true);
    else if (!preferences.pinned) setRightVisible(false);
  }, [target, zoneId, preferences.pinned]);
  useEffect(() => {
    const key = zoneId ?? target?.id;
    if (!key) return;
    const draft = formDrafts.current.get(key);
    if (draft)
      for (const input of inspector.current?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('form [name]') ?? [])
        if (input.name in draft.fields) input.value = draft.fields[input.name];
  }, [target, zoneId, ctx?.sourceDigest]);
  useEffect(() => {
    if (ctx?.sourceDigest)
      void api('edits')
        .then(setEditState)
        .catch(() => setEditState({ undo: false, redo: false }));
  }, [ctx?.sourceDigest, ctx?.current.revision]);
  const showChecks = useCallback(() => {
    setTab('rules');
    setBottomVisible(true);
  }, []);
  const removeRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !['Delete', 'Backspace'].includes(event.key)) return;
      const element = event.target as HTMLElement;
      if (element.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      event.preventDefault();
      removeRef.current();
    };
    window.addEventListener('keydown', handleDelete);
    return () => window.removeEventListener('keydown', handleDelete);
  }, []);
  const flow = useReactFlow();
  const currentRef = useRef<Context | null>(null);
  currentRef.current = ctx;
  // SSE events and /api/context responses can arrive out of order; keep only the newest state
  // published by the current server instance (a restarted server starts a new sequence).
  const published = useRef({ instance: '', seq: -1 });
  const receive = useCallback(
    (data: { context: Context | null; error: string | null; instance?: string; seq?: number }) => {
      if (data.instance && typeof data.seq === 'number') {
        const last = published.current;
        if (data.instance === last.instance && data.seq < last.seq) return;
        published.current = { instance: data.instance, seq: data.seq };
      }
      if (data.context) setCtx(data.context);
      setFileError(data.error ?? '');
      if (data.context && !data.error)
        setError((previous) => (previous.startsWith(t('自動檢查未完成：')) ? '' : previous));
    },
    [],
  );
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        await api('check', {});
        if (!cancelled) receive(await api('context'));
      } catch (error) {
        if (!cancelled) setError(t('自動檢查未完成：') + (error as Error).message);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ctx?.root, ctx?.sourceDigest, receive]);
  useEffect(() => {
    api('context')
      .then(receive)
      .catch((e) => setError(e.message));
    const events = new EventSource(appUrl('/api/events'));
    events.onmessage = (e) => receive(JSON.parse(e.data));
    events.onerror = () => setError(t('本機服務連線中斷；正在重新連線'));
    events.onopen = () => setError('');
    return () => events.close();
  }, [receive]);
  const nodesReady = useNodesInitialized();
  const fittedRoot = useRef<string | null>(null);
  useEffect(() => {
    if (ctx?.source.circuit.instances.length === 0) {
      fittedRoot.current = null;
    } else if (nodesReady && ctx?.root && fittedRoot.current !== ctx.root) {
      fittedRoot.current = ctx.root;
      void flow.fitView({ padding: 0.2 });
    }
  }, [nodesReady, ctx?.root, ctx?.source.circuit.instances.length, flow]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
        if (modal) {
          setModal(null);
          e.preventDefault();
          return;
        }
        if (!wireStartRef.current) {
          if (!preferences.pinned) setRightVisible(false);
          return;
        }
        wireStartRef.current = null;
        setWireStart(null);
        setWireDraft(null);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [modal, preferences.pinned]);
  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError('');
    try {
      await fn();
      receive(await api('context'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const select = useCallback((t: Target | null, preserve = false, branch?: WireRef) => {
    selectionVersion.current++;
    setTarget(t);
    setWireBranch(t?.kind === 'net' && branch ? { ...branch, netId: t.id } : null);
    if (preserve && t?.kind === 'instance')
      setSelectedIds((previous) =>
        previous.includes(t.id) ? previous.filter((id) => id !== t.id) : [...previous, t.id],
      );
    else if (!preserve)
      setSelectedIds(
        t?.kind === 'instance' ? [t.id] : t?.kind === 'pin' ? [t.id.split('.')[0]] : [],
      );
    api('selection', { target: t }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!ctx) return;
    setNodes([
      ...Object.entries(ctx.source.layout)
        .filter(([, e]) => e.kind === 'zone')
        .map(([id, entry]) => ({
          id,
          type: 'zone',
          position: { x: entry.x, y: entry.y },
          zIndex: -10,
          selected: selectedIds.includes(id),
          data: { entry },
        })),
      ...ctx.source.circuit.instances.map((i) => {
        const entry = ctx.source.layout[i.id];
        const def = defFor(ctx.source, i);
        const geo = transformedGeometry(def, entry);
        return {
          id: i.id,
          type: 'component',
          position: entry ?? { x: 100, y: 100 },
          width: geo.width,
          height: geo.height,
          selected: selectedIds.includes(i.id),
          draggable: !lockedIds.includes(i.id),
          zIndex: 10,
          data: {
            definition: instanceDefinition(def, i),
            instance: i,
            target,
            select,
            entry,
            wireStart,
            pinClick,
            showNames: preferences.names,
            showPins: preferences.pins,
            diagnostics:
              ctx.report?.sourceDigest === ctx.sourceDigest
                ? ctx.report.diagnostics.filter(
                    (diagnostic) =>
                      diagnostic.state !== 'pass' &&
                      diagnostic.ruleId !== 'i2c-address' &&
                      (diagnostic.target === i.id || diagnostic.target.startsWith(i.id + '.')),
                  )
                : [],
            connected: ctx.source.circuit.nets.flatMap((n) => n.endpoints),
          },
        };
      }),
    ]);
  }, [
    ctx?.sourceDigest,
    ctx?.report?.id,
    target,
    zoneId,
    wireStart,
    selectedIds,
    preferences.names,
    preferences.pins,
    lockedIds.join('|'),
    setNodes,
    select,
  ]);
  useEffect(() => {
    const simulation = runtimeState?.simulation;
    setNodes((current) =>
      current.map((node) => {
        if (moduleKind(node.data.instance?.typeId ?? '') === 'oled') {
          const panel = simulation?.running ? simulation.peripherals?.[node.id] : undefined;
          const screen = panel?.kind === 'oled' ? (panel.on ? panel.frame : '') : undefined;
          return node.data.screen === screen ? node : { ...node, data: { ...node.data, screen } };
        }
        if (node.data.instance?.typeId === 'official:buzzer') {
          const device = simulation?.peripherals?.[node.id];
          const buzzing =
            device?.kind === 'buzzer'
              ? !!simulation.running && !simulation.paused && device.frequency > 0
              : undefined;
          return node.data.buzzing === buzzing
            ? node
            : { ...node, data: { ...node.data, buzzing } };
        }
        if (node.data.instance?.typeId === 'official:button') {
          const pressable =
            !!simulation?.running && !!simulation.buttons?.some((b: any) => b.id === node.id);
          return node.data.pressable === pressable
            ? node
            : { ...node, data: { ...node.data, pressable } };
        }
        if (node.data.instance?.typeId !== 'official:led-red') return node;
        const output = simulation?.outputs?.[node.id];
        const ledOn = typeof output === 'boolean' ? !!simulation.running && output : undefined;
        return node.data.ledOn === ledOn ? node : { ...node, data: { ...node.data, ledOn } };
      }),
    );
  }, [runtimeState?.simulation, ctx?.sourceDigest, setNodes]);
  useEffect(() => {
    buzzerAudio.feed(runtimeState?.simulation);
  }, [runtimeState?.simulation]);
  useEffect(() => () => buzzerAudio.silenceAll(), []);
  useEffect(() => {
    if (ctx && !dirtyEditor) {
      setEditor(
        ctx.generatedFiles?.[editorFile as keyof typeof ctx.generatedFiles] ??
          ctx.files[editorFile] ??
          '',
      );
      setEditorDigest(ctx.sourceDigest);
    }
  }, [ctx?.sourceDigest, editorFile, dirtyEditor]);
  useEffect(() => {
    if (ctx && !diffRev) setDiffRev(ctx.current.revision);
  }, [ctx?.current.revision]);
  if (!ctx)
    return (
      <div className="loading">
        <div className="brand-mark">⌘</div>
        <h1>OpenCircuit</h1>
        <p>{error || fileError || t('正在開啟本機工作區…')}</p>
      </div>
    );
  const s = ctx.source,
    c = ctx.current,
    defs = [...s.catalog.definitions, ...s.custom];
  const sourceFiles: Record<string, string> = { ...ctx.files, ...ctx.generatedFiles };
  const generatedFile = Object.prototype.hasOwnProperty.call(ctx.generatedFiles ?? {}, editorFile);
  const openFile = (file: string) => {
    const draft = editorDrafts[file];
    setEditorFile(file);
    setEditor(draft?.text ?? sourceFiles[file] ?? '');
    setEditorDigest(draft?.digest ?? ctx.sourceDigest);
    setDirtyEditor(!!draft);
  };
  const save = async (files: Record<string, string | null>, expectedDigest = ctx.sourceDigest) => {
    const submitted = submittedForm.current;
    const draft = submitted ? formDrafts.current.get(submitted) : undefined;
    submittedForm.current = null;
    await api('save', { files, expectedDigest, baseRevision: c.revision });
    receive(await api('context'));
    if (submitted && formDrafts.current.get(submitted) === draft)
      formDrafts.current.delete(submitted);
  };
  const saveCircuit = async (circuit: Source['circuit'], layout = s.layout) =>
    save({ 'circuit.json': j(circuit), 'layout.json': j(layout) });
  const selectedInstance =
    selectedIds.length > 1
      ? undefined
      : s.circuit.instances.find(
          (i) => i.id === (target?.kind === 'pin' ? target.id.split('.')[0] : target?.id),
        );
  const selectedDef = selectedInstance ? defFor(s, selectedInstance) : null;
  const selectedNet = s.circuit.nets.find((n) => target?.kind === 'net' && n.id === target.id);
  const selectedZone = zoneId ? s.layout[zoneId] : null;
  const saveLayoutEntry = (key: string, patch: Partial<LayoutEntry>) =>
    run('儲存外觀', () =>
      save({
        'layout.json': j({
          ...s.layout,
          [key]: { ...(s.layout[key] ?? { x: 0, y: 0 }), ...patch },
        }),
      }),
    );
  const selectedWire = selectedNet ? s.layout[wireLayoutKey(selectedNet.id)] : null;
  const selectedBranch =
    selectedNet && wireBranch?.netId === selectedNet.id
      ? wireConnections(selectedNet.endpoints, selectedWire?.wireRoutes).find((route) =>
          sameWire(route, wireBranch),
        )
      : undefined;
  const updateSelectedWire = (patch: Partial<WireRoute>) => {
    if (!selectedNet) return;
    return saveLayoutEntry(
      wireLayoutKey(selectedNet.id),
      selectedBranch
        ? {
            wireRoutes: wireConnections(selectedNet.endpoints, selectedWire?.wireRoutes).map(
              (route) => (sameWire(route, selectedBranch) ? { ...route, ...patch } : route),
            ),
          }
        : patch,
    );
  };
  // Official definitions added to the catalog after this project was created stay addable.
  const libraryDefs = [
    ...defs,
    ...catalog.definitions.filter(
      (d) => !defs.some((x) => x.typeId === d.typeId && x.version === d.version),
    ),
  ];
  const filtered = libraryDefs.filter(
    (d) =>
      d.typeId.startsWith('official:') &&
      !['consumable', 'connector'].includes(d.category) &&
      (category === 'all' || d.category === category) &&
      (capability === 'all' ||
        (capability === 'wiring' && d.pins.length) ||
        (capability === 'firmware' && d.compileProfile) ||
        capability === 'bom') &&
      `${d.name} ${d.model} ${d.typeId}`.toLowerCase().includes(search.toLowerCase()),
  );
  const edges = s.circuit.nets.flatMap((n) =>
    wireConnections(n.endpoints, s.layout[wireLayoutKey(n.id)]?.wireRoutes).map((route, index) => ({
      id: n.id + '::' + index,
      source: route.from.split('.')[0],
      sourceHandle: route.from.split('.')[1],
      target: route.to.split('.')[0],
      targetHandle: route.to.split('.')[1],
      label:
        route.name ??
        (wireConnections(n.endpoints, s.layout[wireLayoutKey(n.id)]?.wireRoutes).length > 1
          ? `${n.name} · ${route.from.split('.')[1]} → ${route.to.split('.')[1]}`
          : n.name),
      type: 'wire',
      zIndex: 100,
      data: {
        netId: n.id,
        branch: { from: route.from, to: route.to },
        diagnostics:
          ctx.report?.sourceDigest === ctx.sourceDigest
            ? ctx.report.diagnostics.filter(
                (item) =>
                  item.target === n.id && item.state !== 'pass' && item.ruleId !== 'i2c-address',
              )
            : [],
        first: true,
        select: () => select({ kind: 'net', id: n.id }, false, route),
        entry: {
          ...(s.layout[wireLayoutKey(n.id)] ?? { x: 0, y: 0 }),
          wireWidth: route.wireWidth ?? s.layout[wireLayoutKey(n.id)]?.wireWidth,
        },
        points: route.points,
        change: (points: { x: number; y: number }[]) =>
          saveLayoutEntry(wireLayoutKey(n.id), {
            wireBend: undefined,
            wireRoutes: wireConnections(n.endpoints, s.layout[wireLayoutKey(n.id)]?.wireRoutes).map(
              (saved) => (sameWire(saved, route) ? { ...saved, points } : saved),
            ),
          }),
      },
      selected:
        target?.kind === 'net' &&
        target.id === n.id &&
        (!selectedBranch || sameWire(route, selectedBranch)),
      style: {
        stroke:
          route.color ?? s.layout[wireLayoutKey(n.id)]?.color ?? automaticWireColor(s, n.endpoints),
        strokeWidth: 3,
      },
    })),
  );
  async function connect(connection: Connection, points: { x: number; y: number }[] = []) {
    const selectedVersion = selectionVersion.current;
    if (!connection.sourceHandle || !connection.targetHandle) return;
    const a = connection.source + '.' + connection.sourceHandle,
      b = connection.target + '.' + connection.targetHandle;
    if (a === b) return;
    const touching = s.circuit.nets.filter(
      (n) => n.endpoints.includes(a) || n.endpoints.includes(b),
    );
    const net = {
      id: touching[0]?.id ?? id('net'),
      name: touching[0]?.name ?? '新訊號',
      endpoints: [...new Set([...touching.flatMap((n) => n.endpoints), a, b])],
    };
    const key = wireLayoutKey(net.id);
    const routes = touching.flatMap((n) =>
      wireConnections(n.endpoints, s.layout[wireLayoutKey(n.id)]?.wireRoutes),
    );
    const layout = {
      ...s.layout,
      [key]: {
        ...(s.layout[key] ?? { x: 0, y: 0 }),
        wireStyle: 'orthogonal' as const,
        wireRoutes: [
          ...routes.filter(
            (route) =>
              !(route.from === a && route.to === b) && !(route.from === b && route.to === a),
          ),
          { from: a, to: b, points },
        ],
      },
    };
    await saveCircuit(
      {
        ...s.circuit,
        nets: [...s.circuit.nets.filter((n) => !touching.includes(n)), net],
      },
      layout,
    );
    if (selectionVersion.current === selectedVersion)
      select({ kind: 'net', id: net.id }, false, { from: a, to: b });
  }
  function pinPosition(ref: string) {
    const [id, pin] = ref.split('.');
    const instance = s.circuit.instances.find((instance) => instance.id === id)!;
    const entry = s.layout[id] ?? { x: 100, y: 100 };
    const position = flow.getNode(id)?.position ?? entry;
    const geo = transformedGeometry(defFor(s, instance), entry).pins[pin];
    return {
      x: position.x + geo.x,
      y: position.y + geo.y,
      vertical: geo.side === 'top' || geo.side === 'bottom',
    };
  }
  function pinClick(ref: string) {
    if (frozen) return select({ kind: 'pin', id: ref });
    setZoneId(null);
    select({ kind: 'pin', id: ref });
    const start = wireStartRef.current;
    if (start) {
      wireStartRef.current = null;
      setWireStart(null);
      const points = wireDraftRef.current?.points ?? [];
      setWireDraft(null);
      if (start === ref) return;
      const [source, sourceHandle] = start.split('.'),
        [target, targetHandle] = ref.split('.');
      void run('接線', () => connect({ source, sourceHandle, target, targetHandle }, points));
    } else {
      wireStartRef.current = ref;
      setWireStart(ref);
      setWireDraft({ points: [], cursor: pinPosition(ref) });
    }
  }
  async function addZone() {
    const key = '@zone:' + id('area'),
      view = flow.getViewport(),
      position = snapCanvasPoint(
        flow.screenToFlowPosition({ x: window.innerWidth / 2 - 160, y: 250 }),
      );
    await save({
      'layout.json': j({
        ...s.layout,
        [key]: {
          ...position,
          kind: 'zone',
          label: '自訂工作區',
          width: 460,
          height: 300,
          color: '#8dbfa5',
        },
      }),
    });
    select(null);
    setZoneId(key);
  }
  async function add(d: Definition) {
    const selectedVersion = selectionVersion.current;
    if (!d.typeId.startsWith('official:')) throw new Error(t('目前只支援官方元件'));
    if (d.category === 'controller') {
      const controllers = s.circuit.instances.filter(
        (instance) => defFor(s, instance).category === 'controller',
      );
      if (controllers.length > 1)
        throw new Error(t('此專案已有多個控制器，請先刪除多餘的控制器，再更換板子。'));
      const existing = controllers[0];
      if (existing) {
        setBoardReplacement(d);
        return;
      }
    }
    const instance: Instance = {
      id: id(d.typeId.split(':')[1].replaceAll('-', '_')),
      typeId: d.typeId,
      definitionVersion: d.version,
      parameters: { ...d.parameters },
      quantity: 1,
    };
    const position =
      placement.current ??
      snapCanvasPoint(
        flow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 3,
        }),
      );
    placement.current = null;
    const primary =
      d.category === 'controller' &&
      !s.circuit.instances.some((item) => item.id === s.project.board);
    const board = boards[d.compileProfile as keyof typeof boards];
    const known = s.catalog.definitions.some(
      (x) => x.typeId === d.typeId && x.version === d.version,
    );
    await save({
      'circuit.json': j({ ...s.circuit, instances: [...s.circuit.instances, instance] }),
      'layout.json': j({ ...s.layout, [instance.id]: position }),
      ...(known
        ? {}
        : {
            'components/catalog.json': j({
              ...s.catalog,
              definitions: [...s.catalog.definitions, structuredClone(d)],
            }),
          }),
      ...(primary && board
        ? {
            'project.json': j({ ...s.project, board: instance.id, profile: 'custom' }),
            'dependencies.lock.json': j({
              ...s.dependencies,
              fqbn: d.compileProfile,
              core: board.core,
              buildProperties: [],
            }),
          }
        : {}),
    });
    if (selectionVersion.current === selectedVersion) select({ kind: 'instance', id: instance.id });
  }
  async function remove() {
    if (!target) return;
    if (selectedNet) {
      if (selectedBranch)
        await api('edit', {
          action: 'delete',
          ids: [],
          netId: selectedNet.id,
          branch: selectedBranch,
          expectedDigest: ctx?.sourceDigest ?? '',
          baseRevision: c.revision,
        });
      else
        await saveCircuit({
          ...s.circuit,
          nets: s.circuit.nets.filter((n) => n.id !== selectedNet.id),
        });
    } else if (selectedInstance) {
      const prefix = selectedInstance.id + '.';
      const layout = { ...s.layout };
      delete layout[selectedInstance.id];
      await save({
        'circuit.json': j({
          ...s.circuit,
          instances: s.circuit.instances.filter((i) => i.id !== selectedInstance.id),
          nets: s.circuit.nets
            .map((n) => ({ ...n, endpoints: n.endpoints.filter((e) => !e.startsWith(prefix)) }))
            .filter((n) => n.endpoints.length > 1),
          bindings: s.circuit.bindings.filter((b) => !b.endpoint.startsWith(prefix)),
        }),
        'layout.json': j(layout),
        'project.json': j({
          ...s.project,
          profile: 'custom',
          board: selectedInstance.id === s.project.board ? '' : s.project.board,
        }),
      });
    }
    select(null);
  }
  removeRef.current = () => {
    if (wireStartRef.current && wireDraftRef.current) {
      const draft = { ...wireDraftRef.current, points: wireDraftRef.current.points.slice(0, -1) };
      wireDraftRef.current = draft;
      setWireDraft(draft);
      return;
    }
    if (!busy && !frozen && (selectedIds.length || zoneId || target))
      void editCommand('delete', zoneId ? [zoneId] : selectedIds, selectedNet?.id, selectedBranch);
  };
  const locate = (ref: string) => {
    if (ref in sourceFiles) {
      setTab('output');
      setBottomVisible(true);
      return;
    }
    const kind = s.circuit.nets.some((n) => n.id === ref)
      ? 'net'
      : ref.includes('.')
        ? 'pin'
        : 'instance';
    const t = { kind, id: ref } as Target;
    select(t);
    const nodeId =
      kind === 'net'
        ? s.circuit.nets.find((n) => n.id === ref)?.endpoints[0]?.split('.')[0]
        : ref.split('.')[0];
    if (nodeId) void flow.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.8 });
  };
  const leaveWorkspace = () => {
    onHome();
  };
  const fitCanvas = () => {
    const points = (s.circuit.instances.length ? s.circuit.instances : []).flatMap((instance) => {
      const entry = s.layout[instance.id];
      if (!entry) return [];
      const geometry = transformedGeometry(defFor(s, instance), entry);
      return [
        { x: entry.x - 40, y: entry.y - 40 },
        {
          x: entry.x + (geometry?.width ?? 120) + 40,
          y: entry.y + (geometry?.height ?? 100) + 65,
        },
      ];
    });
    for (const entry of Object.values(s.layout)) {
      if (entry.wireBend) points.push(entry.wireBend);
      for (const route of entry.wireRoutes ?? []) points.push(...route.points);
    }
    if (!points.length) {
      void flow.fitView({ padding: 0.2 });
      return;
    }
    const x = Math.min(...points.map((point) => point.x)),
      y = Math.min(...points.map((point) => point.y));
    void flow.fitBounds(
      {
        x,
        y,
        width: Math.max(...points.map((point) => point.x)) - x,
        height: Math.max(...points.map((point) => point.y)) - y,
      },
      { padding: 0.18, duration: 150 },
    );
  };
  const saveProjectName = async () => {
    if (!renamingProject || renamePending.current || renameCancelled.current) return;
    const name = projectNameDraft.trim();
    if (!name) {
      setError(t('專案名稱不能空白'));
      return;
    }
    if (name === s.project.name) {
      setRenamingProject(false);
      return;
    }
    const baseline = renameBaseline.current;
    if (!baseline || baseline.root !== ctx.root) return;
    renamePending.current = true;
    setBusy('儲存專案名稱');
    try {
      await api('projects/rename', {
        folder: ctx.root.split(/[\\/]/).pop(),
        name,
        expectedDigest: baseline.digest,
        baseRevision: baseline.revision,
      });
      receive(await api('context'));
      setRenamingProject(false);
      setError('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      renamePending.current = false;
      setBusy('');
    }
  };
  const editCommand = (action: string, ids = selectedIds, netId?: string, branch?: WireRef) =>
    run('修改電路', async () => {
      await api('edit', {
        action,
        ids,
        netId,
        branch,
        expectedDigest: ctx.sourceDigest,
        baseRevision: c.revision,
      });
      if (action === 'delete') {
        select(null);
        setZoneId(null);
        requestAnimationFrame(() => canvasRef.current?.focus());
      }
    });
  const removeSelected = () => editCommand('delete', selectedIds, selectedNet?.id, selectedBranch);
  const moveEdit = (direction: 'undo' | 'redo') =>
    run(direction === 'undo' ? '復原' : '重做', async () => {
      await api('edits/' + direction, {
        expectedDigest: ctx.sourceDigest,
        baseRevision: c.revision,
      });
      select(null);
      setZoneId(null);
    });
  const showSettings = () => setSettingsOpen(true);
  const saveProgramDrafts = async (files = Object.keys(editorDrafts)) => {
    if (files.some((file) => editorDrafts[file].digest !== ctx.sourceDigest))
      throw new Error(t('專案已更新，程式草稿已保留；請先在歷史比較變更。'));
    const result = await api('save', {
      files: Object.fromEntries(files.map((file) => [file, editorDrafts[file].text])),
      expectedDigest: ctx.sourceDigest,
      baseRevision: c.revision,
    });
    setEditorDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous)
          .filter(([file]) => !files.includes(file))
          .map(([file, draft]) => [
            file,
            {
              ...draft,
              digest: draft.digest === ctx.sourceDigest ? result.sourceDigest : draft.digest,
            },
          ]),
      ),
    );
    if (files.includes(editorFile)) {
      setDirtyEditor(false);
      setEditorDigest(result.sourceDigest);
    }
    receive(await api('context'));
    return result.sourceDigest as string;
  };
  const exportProject = (
    kind: 'svg' | 'png' | 'program' | 'project',
    choice?: 'save' | 'saved',
  ) => {
    if (Object.keys(editorDrafts).length && !choice) {
      setExportKind(kind);
      return;
    }
    void run('匯出', async () => {
      const digest = choice === 'save' ? await saveProgramDrafts() : ctx.sourceDigest;
      const fresh: Context = (await api('context')).context;
      if (fresh.sourceDigest !== digest || fresh.current.revision !== c.revision)
        throw new Error(t('來源版本已更新，請重新確認後匯出。'));
      if (kind === 'svg' || kind === 'png') await downloadCircuit(fresh.source, kind);
      else {
        const response = await fetch(appUrl('/api/export'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, expectedDigest: digest, baseRevision: c.revision }),
        });
        if (!response.ok) throw new Error((await response.json()).error ?? t('匯出未完成'));
        if (response.headers.get('X-OpenCircuit-Source-Digest') !== digest)
          throw new Error(t('匯出版本不一致，未下載'));
        downloadBlob('OpenCircuit-' + kind + '.zip', await response.blob());
      }
      setExportOpen(false);
      setExportKind(null);
      setNotice(t('已匯出來源 ') + digest.slice(0, 12));
    });
  };
  const activeJob = runtimeState?.jobs?.find((job: any) => job.state === 'running');
  const cancelActiveJob = () =>
    void runtimePost('cancel', { id: activeJob.id }).catch((error) => setError(error.message));
  const issues: {
    reason: string;
    target: string;
    ruleId: string;
    severity: 'error' | 'warning';
    relatedTargets?: string[];
  }[] = [
    ...(ctx.report?.sourceDigest === ctx.sourceDigest
      ? ctx.report.diagnostics
          .filter((item) => item.state !== 'pass')
          .map((item) => ({
            severity: (item.state === 'fail' ? 'error' : 'warning') as 'error' | 'warning',
            reason:
              item.ruleId === 'firmware-sync' && item.state === 'unknown'
                ? '實體硬體尚未驗證；這項提醒不影響本機模擬'
                : item.ruleId === 'i2c-address' && item.relatedTargets
                  ? 'I²C 位址衝突'
                  : item.reason,
            target: item.target,
            ruleId: item.ruleId,
            relatedTargets: item.relatedTargets,
          }))
      : []),
    ...(runtimeState?.environment?.items?.some((item: any) => item.id === 'cli' && !item.ready)
      ? [
          {
            reason: 'arduino-cli 未安裝',
            target: 'environment',
            ruleId: 'environment',
            severity: 'error' as const,
          },
        ]
      : []),
    ...(actionIssue &&
    !(runtimeState?.jobs ?? []).some(
      (job: any) =>
        job.state === 'fail' && job.error === actionIssue && job.sourceDigest === ctx.sourceDigest,
    )
      ? [
          {
            reason: actionIssue,
            target: 'output',
            ruleId: 'runtime',
            severity: 'error' as const,
          },
        ]
      : []),
    ...(runtimeState?.jobs ?? [])
      .filter((job: any) => job.state === 'fail' && job.sourceDigest === ctx.sourceDigest)
      .slice(-1)
      .map((job: any) => ({
        reason: t(job.error ?? '程式編譯失敗').replace(/Wokwi/gi, t('外部模擬器')),
        target: 'output',
        ruleId: 'runtime',
        severity: 'error' as const,
      })),
  ].filter(
    (item, index, list) =>
      list.findIndex((other) => other.reason === item.reason && other.target === item.target) ===
      index,
  );
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const toolbarCommands = {
    history: () => setMainView('history'),
    check: () =>
      void run('接線檢查', async () => {
        await api('check', {});
        showChecks();
      }),
    compile: () => runtimeCommands.current?.compile(),
    simulate: () => runtimeCommands.current?.simulate(),
    upload: () => runtimeCommands.current?.upload(),
    serial: () => {
      setTab('serial');
      setBottomVisible(true);
    },
    settings: showSettings,
    export: () => setExportOpen(true),
    undo: () => void moveEdit('undo'),
    redo: () => void moveEdit('redo'),
    fit: () => {
      setMainView('circuit');
      void flow.fitView({ padding: 0.2 });
    },
    preview: () => setPreviewOpen(true),
    'simulator-export': () => runtimeCommands.current?.exportSimulator(),
    report: openIssueReport,
    update: () => setUpdateOpen(true),
  };
  const closeMenu = () => setMenu(null);
  const disconnectParts = (ids: string[]) =>
    run('斷開接線', () => {
      const nets = s.circuit.nets
        .map((net) => ({
          ...net,
          endpoints: net.endpoints.filter((endpoint) => !ids.includes(endpoint.split('.')[0])),
        }))
        .filter((net) => net.endpoints.length > 1);
      const layout = { ...s.layout };
      for (const net of s.circuit.nets) {
        const remaining = nets.find((item) => item.id === net.id),
          key = wireLayoutKey(net.id);
        if (!remaining) delete layout[key];
        else if (layout[key])
          layout[key] = {
            ...layout[key],
            wireBend: undefined,
            wireRoutes: layout[key].wireRoutes?.filter(
              (route) =>
                remaining.endpoints.includes(route.from) && remaining.endpoints.includes(route.to),
            ),
          };
      }
      return saveCircuit({ ...s.circuit, nets }, layout);
    });
  const showMenu = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    const element = event.target as HTMLElement;
    if (
      element.closest('input,textarea,select,[contenteditable="true"]') ||
      window.getSelection()?.toString()
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const box = element.getBoundingClientRect();
    const x = 'clientX' in event ? event.clientX : box.x + 12,
      y = 'clientY' in event ? event.clientY : box.y + 12;
    // Pin labels are translated, so the prefix is built from the same string the canvas uses.
    const pinPrefix = t('接腳') + ' ';
    const pin = element
      .closest(`[aria-label^="${pinPrefix}"]`)
      ?.getAttribute('aria-label')
      ?.slice(pinPrefix.length);
    const control = element.closest<HTMLElement>('.wire-control'),
      edge = element.closest('.react-flow__edge');
    const edgeId =
      control?.dataset.edgeId ??
      element.closest<HTMLElement>('[data-edge-id]')?.dataset.edgeId ??
      edge?.getAttribute('data-id') ??
      edge?.querySelector('.react-flow__edge-path')?.getAttribute('id');
    const nodeId = element.closest('.react-flow__node')?.getAttribute('data-id');
    if (pin) {
      select({ kind: 'pin', id: pin });
      setZoneId(null);
      setMenu({ x, y, kind: 'pin', id: pin, ids: [] });
    } else if (edgeId) {
      const netId = edgeId.split('::')[0];
      const net = s.circuit.nets.find((net) => net.id === netId);
      const branch =
        net &&
        wireConnections(net.endpoints, s.layout[wireLayoutKey(netId)]?.wireRoutes)[
          Number(edgeId.split('::')[1])
        ];
      select({ kind: 'net', id: netId }, false, branch);
      setZoneId(null);
      setMenu({
        x,
        y,
        kind: control ? 'control' : 'net',
        id: netId,
        ids: [],
        edgeId,
        controlIndex: control ? Number(control.dataset.controlIndex) : undefined,
      });
    } else if (nodeId) {
      const selection = contextSelection.current ?? selectedIds;
      contextSelection.current = null;
      const ids = selection.includes(nodeId) ? selection : [nodeId];
      setSelectedIds(ids);
      if (s.layout[nodeId]?.kind === 'zone') {
        select(null, true);
        setZoneId(nodeId);
        setRightVisible(true);
      } else {
        setZoneId(null);
        select({ kind: 'instance', id: nodeId }, true);
      }
      setMenu({
        x,
        y,
        kind: ids.length > 1 ? 'multiple' : s.layout[nodeId]?.kind === 'zone' ? 'zone' : 'instance',
        id: nodeId,
        ids,
      });
    } else
      setMenu({
        x,
        y,
        kind: 'canvas',
        ids: selectedIds,
        point: snapCanvasPoint(flow.screenToFlowPosition({ x, y })),
      });
  };
  const blocked = frozen
    ? t('模擬進行中，專案已鎖定；請先停止模擬')
    : wireStart
      ? t('請先完成或取消目前接線')
      : busy
        ? t('修改進行中')
        : undefined;
  const menuHasIssues = (ids: string[]) =>
    issues.some((issue) =>
      ids.some(
        (id) =>
          issue.target === id ||
          issue.target.startsWith(id + '.') ||
          issue.relatedTargets?.includes(id),
      ),
    );
  const menuItems: MenuCommand[] = menu
    ? wireStart
      ? [
          { label: '繼續接線', icon: <Cable size={16} />, action: () => {} },
          {
            label: '取消接線',
            icon: <X size={16} />,
            action: () => {
              setWireStart(null);
              wireStartRef.current = null;
              setWireDraft(null);
            },
          },
        ]
      : menu.kind === 'canvas'
        ? [
            {
              label: '貼上',
              icon: <ClipboardPaste size={16} />,
              disabled:
                blocked ||
                (!canvasClipboard ||
                canvasClipboard.root !== ctx.root ||
                !canvasClipboard.ids.every((id) =>
                  s.circuit.instances.some((instance) => instance.id === id),
                )
                  ? '請先複製此專案中的元件'
                  : undefined),
              action: () => canvasClipboard && void editCommand('copy', canvasClipboard.ids),
            },
            {
              label: '全選',
              icon: <MousePointer2 size={16} />,
              action: () => setSelectedIds(nodes.map((node) => node.id)),
            },
            {
              label: '整理畫布',
              icon: <LayoutGrid size={16} />,
              disabled: blocked || (lockedIds.length ? '請先解除元件鎖定' : undefined),
              action: () => void editCommand('organize'),
            },
            { label: '顯示全部', icon: <Scan size={16} />, action: fitCanvas },
            {
              label: '取消選取',
              icon: <X size={16} />,
              disabled: !target && !selectedIds.length ? '尚未選取項目' : undefined,
              action: () => {
                select(null);
                setZoneId(null);
              },
            },
          ]
        : menu.kind === 'pin'
          ? [
              {
                label: '開始接線',
                icon: <Cable size={16} />,
                disabled: blocked,
                action: () => pinClick(menu.id!),
              },
              ...(menuHasIssues([menu.id!])
                ? [{ label: '查看問題', icon: <AlertTriangle size={16} />, action: showChecks }]
                : []),
            ]
          : menu.kind === 'net' || menu.kind === 'control'
            ? [
                ...(menu.kind === 'control'
                  ? [
                      {
                        label: '移除控制點',
                        icon: <Trash2 size={16} />,
                        disabled: blocked,
                        danger: true,
                        action: () => {
                          const net = s.circuit.nets.find((net) => net.id === menu.id);
                          const route =
                            net &&
                            wireConnections(
                              net.endpoints,
                              s.layout[wireLayoutKey(net.id)]?.wireRoutes,
                            )[Number(menu.edgeId?.split('::')[1])];
                          if (
                            !net ||
                            !route ||
                            menu.controlIndex === undefined ||
                            !route.points[menu.controlIndex]
                          )
                            return setError(t('控制點已不存在'));
                          void saveLayoutEntry(wireLayoutKey(net.id), {
                            wireRoutes: [
                              ...(s.layout[wireLayoutKey(net.id)]?.wireRoutes ?? []).filter(
                                (saved) => !(saved.from === route.from && saved.to === route.to),
                              ),
                              {
                                ...route,
                                points: route.points.filter(
                                  (_point, index) => index !== menu.controlIndex,
                                ),
                              },
                            ],
                          });
                        },
                      },
                    ]
                  : []),
                {
                  label: '刪除接線',
                  icon: <Trash2 size={16} />,
                  shortcut: 'Delete',
                  disabled: blocked,
                  danger: true,
                  action: () => void editCommand('delete', [], menu.id, selectedBranch),
                },
                {
                  label: '重新佈線',
                  icon: <Cable size={16} />,
                  disabled: blocked,
                  action: () => void editCommand('arrange', [], menu.id, selectedBranch),
                },
                ...(menuHasIssues([menu.id!])
                  ? [{ label: '查看問題', icon: <AlertTriangle size={16} />, action: showChecks }]
                  : []),
              ]
            : menu.kind === 'zone'
              ? [
                  {
                    label: '刪除區域（保留元件）',
                    icon: <Trash2 size={16} />,
                    danger: true,
                    disabled: blocked,
                    action: () => void editCommand('delete', menu.ids),
                  },
                ]
              : [
                  {
                    label: '複製',
                    icon: <Copy size={16} />,
                    disabled:
                      blocked ||
                      (menu.ids.some((id) => {
                        const instance = s.circuit.instances.find((instance) => instance.id === id);
                        return instance && defFor(s, instance).category === 'controller';
                      })
                        ? '一個專案只能使用一個主控制器'
                        : undefined),
                    action: () => setCanvasClipboard({ root: ctx.root, ids: [...menu.ids] }),
                  },
                  {
                    label: '旋轉 90°',
                    icon: <RotateCw size={16} />,
                    disabled:
                      blocked ||
                      (menu.ids.some((id) => lockedIds.includes(id)) ? '請先解除鎖定' : undefined),
                    action: () => void editCommand('rotate', menu.ids),
                  },
                  {
                    label: menu.ids.every((id) => lockedIds.includes(id)) ? '解除鎖定' : '鎖定',
                    icon: menu.ids.every((id) => lockedIds.includes(id)) ? (
                      <Unlock size={16} />
                    ) : (
                      <Lock size={16} />
                    ),
                    action: () =>
                      setCanvasLocks((current) => {
                        const previous = current.projects[ctx.root] ?? [];
                        const next = menu.ids.every((id) => previous.includes(id))
                          ? previous.filter((id) => !menu.ids.includes(id))
                          : [...new Set([...previous, ...menu.ids])];
                        return { ...current, projects: { ...current.projects, [ctx.root]: next } };
                      }),
                  },
                  {
                    label: '斷開所有接線',
                    icon: <Unplug size={16} />,
                    group: 'connections',
                    disabled: blocked,
                    action: () => void disconnectParts(menu.ids),
                  },
                  ...(menuHasIssues(menu.ids)
                    ? [
                        {
                          label: '查看問題',
                          icon: <AlertTriangle size={16} />,
                          group: 'connections',
                          action: showChecks,
                        },
                      ]
                    : []),
                  {
                    label: '刪除',
                    icon: <Trash2 size={16} />,
                    shortcut: 'Delete',
                    group: 'delete',
                    danger: true,
                    disabled: blocked,
                    action: () => void editCommand('delete', menu.ids),
                  },
                ]
    : [];
  return (
    <div
      className={'app-shell ' + (canvasExpanded ? 'canvas-expanded' : '')}
      data-left-hidden={!leftVisible}
      data-right-hidden={!rightVisible || !!wireStart}
      data-bottom-hidden={!bottomVisible}
      data-view={mainView}
      style={
        {
          '--left-size': leftSize + 'px',
          '--right-size': rightSize + 'px',
          '--bottom-size': bottomSize + 'px',
        } as CSSProperties
      }
    >
      <header className="topbar">
        <button
          title={t('返回專案主頁')}
          aria-label={t('返回專案主頁')}
          disabled={!!busy}
          onClick={leaveWorkspace}
        >
          ←
        </button>
        <a className="brand" href="#workspace">
          <span className="brand-mark">⌘</span>
          <span>OpenCircuit</span>
        </a>
        <div className="project-title">
          <span aria-hidden="true">/</span>
          {renamingProject ? (
            <input
              aria-label={t('專案名稱')}
              autoFocus
              value={projectNameDraft}
              maxLength={80}
              disabled={renamePending.current}
              onChange={(event) => setProjectNameDraft(event.target.value)}
              onBlur={() => void saveProjectName()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveProjectName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  renameCancelled.current = true;
                  setRenamingProject(false);
                }
              }}
            />
          ) : (
            <button
              disabled={!!busy}
              title={t('修改專案名稱')}
              onClick={() => {
                renameCancelled.current = false;
                renameBaseline.current = {
                  root: ctx.root,
                  digest: ctx.sourceDigest,
                  revision: c.revision,
                };
                setProjectNameDraft(s.project.name);
                setRenamingProject(true);
              }}
            >
              {s.project.name}
            </button>
          )}
          <details className="project-menu">
            <summary aria-label={t('專案操作')}>
              <ChevronDown size={14} />
            </summary>
            <button onClick={leaveWorkspace}>{t('專案管理器')}</button>
          </details>
        </div>
        {issues.length ? (
          <button
            className="issue-status"
            data-severity={errorCount ? 'error' : 'warning'}
            onClick={() => {
              setMainView('circuit');
              showChecks();
            }}
          >
            ● {errorCount ? t('{count} 個問題', { count: errorCount }) : ''}
            {errorCount && warningCount ? ' · ' : ''}
            {warningCount ? t('{count} 個提醒', { count: warningCount }) : ''}
          </button>
        ) : (
          <span className="quiet-saved">{t('已儲存')}</span>
        )}
        <code className="revision" title={c.revision} hidden={!moreTools}>
          rev {c.revision.slice(-8)}
        </code>
        <LanguageSwitch />
        <div className="toolbar">
          <Toolbar
            commands={toolbarCommands}
            running={!!runtimeState?.simulation?.running}
            reasons={{
              ...Object.fromEntries(
                ['check', 'compile', 'upload', 'simulator-export', 'undo', 'redo']
                  .filter(() => !!busy || !!wireStart || !!activeJob)
                  .map((id) => [id, wireStart ? '請先完成或取消接線' : '工作執行中']),
              ),
              ...(activeJob ? { simulate: '工作執行中' } : {}),
              ...(!editState.undo ? { undo: '沒有可復原的草稿；已套用或外部修改請使用歷史' } : {}),
              ...(!editState.redo ? { redo: '沒有可重做的草稿' } : {}),
              ...(frozen ? { undo: '模擬進行中，專案已鎖定', redo: '模擬進行中，專案已鎖定' } : {}),
            }}
          />
          <WorkspaceActions
            root={ctx.root}
            sourceDigest={ctx.sourceDigest}
            baseRevision={c.revision}
            onCheck={showChecks}
            onError={setActionIssue}
            hideButtons
            commands={runtimeCommands}
            onState={setRuntimeState}
            onResult={(kind) => {
              setTab('output');
              setBottomVisible(true);
            }}
            onSimulation={() => {
              setTab('output');
              setBottomVisible(true);
            }}
          />
          <button
            hidden
            className="primary"
            disabled={!!busy || ctx.report?.status !== 'ready' || ctx.report.id === c.revision}
            onClick={() => {
              setMainView('history');
              void run('查看套用差異', async () => {
                setDiff(await api('diff', { revision: ctx.report!.id }));
                setCompared(ctx.report!.id + ':' + ctx.sourceDigest);
              });
            }}
          >
            套用草稿 ↗
          </button>
        </div>
      </header>
      <nav className="main-tabs" aria-label={t('主要工作區')}>
        {[
          { id: 'circuit', label: '電路', icon: CircuitBoard },
          { id: 'materials', label: '材料與成本', icon: Coins },
        ].map(({ id, label, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={t(label)}
            aria-current={mainView === id ? 'page' : undefined}
            onClick={() => setMainView(id)}
          />
        ))}
        <span className="save-status" hidden>
          {dirtyEditor || Object.keys(editorDrafts).length ? '程式尚未儲存' : '來源已儲存'} ·{' '}
          {c.status === 'draft' || c.draft ? '草稿尚未套用' : '已套用版本'}
        </span>
      </nav>
      {activeJob &&
        (activeJob.kind === 'install' ? (
          <div className="running-work" role="status">
            {t('{name}：{phase}', {
              name: t(jobNames[activeJob.kind] ?? activeJob.kind),
              phase: t(activeJob.phase ?? ''),
            })}
            {activeJob.startedAt &&
              t(' · 已 {seconds} 秒', {
                seconds: Math.max(
                  0,
                  Math.round((Date.now() - Date.parse(activeJob.startedAt)) / 1000),
                ),
              })}
            <button onClick={cancelActiveJob}>{t('取消工作')}</button>
          </div>
        ) : (
          <JobProgress
            key={activeJob.id}
            job={activeJob}
            esp32={s.dependencies.fqbn === 'esp32:esp32:esp32'}
            onCancel={cancelActiveJob}
          />
        ))}
      {(error || fileError) && (
        <div role="alert" className="alert error">
          <strong>{t(fileError ? '來源檔案錯誤 · 保留上次有效畫面' : '操作未完成')}</strong>
          <span>{t(fileError || error)}</span>
          <button
            onClick={() => {
              setError('');
              void api('context').then(receive);
            }}
          >
            {t('重新讀取')}
          </button>
        </div>
      )}
      {!fileError && ctx.warnings?.length > 0 && (
        <div role="status" className="alert">
          <strong>{t('部分專案檔案已略過')}</strong>
          <span>{ctx.warnings.map((warning: string) => t(warning)).join('\n')}</span>
        </div>
      )}
      {busy && (
        <div role="status" className="activity">
          <span className="spinner" />
          {t(busy)}…
        </div>
      )}
      {frozen && (
        <div role="status" className="activity frozen-banner">
          {t('模擬進行中：畫布、接線與程式已鎖定，停止模擬後才能修改。')} {t('若在介面之外修改專案檔案，模擬會立刻停止。')}
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {notice}
          <button aria-label={t('關閉通知')} onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      <div
        className="workspace"
        data-frozen={frozen}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            (event.target as HTMLElement).closest(
              'input,textarea,select,[contenteditable="true"],dialog',
            )
          )
            return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (!blocked) void moveEdit(event.shiftKey ? 'redo' : 'undo');
          }
        }}
      >
        <aside className="library">
          {
            <>
              <h2 className="library-title">{t('元件')}</h2>
              <div className="library-search">
                <input
                  aria-label={t('搜尋元件')}
                  placeholder={t('⌕ 搜尋名稱、型號…')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="filter-row">
                  <select
                    aria-label={t('元件分類')}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">{t('所有分類')}</option>
                    {Object.entries(categories)
                      .filter(([v]) => !['consumable', 'connector'].includes(v))
                      .map(([v, l]) => (
                        <option key={v} value={v}>
                          {t(l)}
                        </option>
                      ))}
                  </select>
                  <select
                    hidden
                    aria-label={t('用途篩選')}
                    value={capability}
                    onChange={(e) => setCapability(e.target.value)}
                  >
                    <option value="all">所有用途</option>
                    <option value="wiring">接線</option>
                    <option value="firmware">附範例程式</option>
                    <option value="bom">材料清單</option>
                  </select>
                </div>
              </div>
              <div className="catalog-scroll">
                {Object.entries(categories).map(([cat, label]) => {
                  const list = filtered.filter((d) => d.category === cat);
                  return list.length ? (
                    <section className="catalog-group" key={cat}>
                      <h3>
                        {t(label)}
                        <span>{list.length.toString().padStart(2, '0')}</span>
                      </h3>
                      {list.map((d) => (
                        <button
                          className="catalog-item"
                          key={d.typeId + '@' + d.version}
                          disabled={frozen}
                          title={frozen ? t('模擬進行中，專案已鎖定') : undefined}
                          onClick={() => run('新增元件', () => add(d))}
                        >
                          <span className={'catalog-icon hardware-thumbnail ' + cat}>
                            <HardwareArt definition={d} />
                          </span>
                          <span>
                            <strong>{t(componentName(d))}</strong>
                            {![
                              'official:usb-supply',
                              'official:resistor',
                              'official:capacitor',
                              'official:led-red',
                            ].includes(d.typeId) && <small>{d.model}</small>}
                            <em>
                              {d.pins.length ? t('接線') : ''}
                              {d.compileProfile ? t(' · 附程式') : ''}
                              {!d.pins.length ? t('材料規劃') : ''}
                              {d.typeId.startsWith('custom:') ? t(' · 自訂') : ''}
                            </em>
                          </span>
                          <b>＋</b>
                        </button>
                      ))}
                    </section>
                  ) : null;
                })}
              </div>
              <div className="library-footer">
                <button
                  hidden
                  onClick={() => {
                    setCustomSeed(null);
                    setModal('custom');
                  }}
                >
                  ＋ 自訂元件 / 匯入
                </button>
                <span>{t('{count} 種元件', { count: defs.length })}</span>
              </div>
            </>
          }
        </aside>
        {leftVisible && <ResizeHandle direction="left" value={leftSize} onChange={setLeftSize} />}
        <button
          className={'drawer-handle left-drawer ' + (leftVisible ? 'expanded' : '')}
          aria-label={t(leftVisible ? '隱藏元件區' : '顯示元件區')}
          title={t(leftVisible ? '隱藏元件區' : '顯示元件區')}
          aria-expanded={leftVisible}
          onClick={() => setLeftVisible((value) => !value)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <main className="main-area">
          <div className="canvas-top">
            <div>
              <strong>{t('電路畫布')}</strong>
              <span>
                {s.circuit.instances.length} {t('元件')} <i />{' '}
                {s.circuit.nets.reduce(
                  (count, net) =>
                    count +
                    wireConnections(net.endpoints, s.layout[wireLayoutKey(net.id)]?.wireRoutes)
                      .length,
                  0,
                )}{' '}
                {t('條接線')}
              </span>
            </div>
            <div>
              <IconButton
                icon={LayoutGrid}
                text={false}
                label={t('整理畫布')}
                detail={lockedIds.length ? t('請先解除元件鎖定') : t('整理目前元件與接線')}
                disabled={!!busy || frozen || !!lockedIds.length}
                onClick={() => void editCommand('organize')}
              />
              <IconButton icon={Scan} label={t('顯示全部')} text={false} onClick={fitCanvas} />
            </div>
          </div>
          <section
            ref={canvasRef}
            className="canvas"
            aria-label={t('電路畫布')}
            onContextMenu={showMenu}
            onPointerDownCapture={(event) => {
              if (event.button === 2) contextSelection.current = [...selectedIds];
            }}
            tabIndex={0}
            onKeyDown={(event) => {
              if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')
                showMenu(event);
            }}
            onPointerMove={(event) => {
              if (!wireStartRef.current || !wireDraftRef.current) return;
              const cursor = snapCanvasPoint(
                flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
              );
              setWireDraft({ ...wireDraftRef.current, cursor });
            }}
          >
            <ReactFlow
              nodes={nodes}
              snapToGrid
              snapGrid={[canvasGridSize, canvasGridSize]}
              edges={edges}
              elevateEdgesOnSelect={false}
              elevateNodesOnSelect={false}
              nodeTypes={canvasNodeTypes}
              edgeTypes={canvasEdgeTypes}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                const selections = changes.filter((change) => change.type === 'select');
                if (selections.length)
                  setSelectedIds((previous) => {
                    const next = new Set(previous);
                    for (const change of selections) {
                      if (change.selected) next.add(change.id);
                      else next.delete(change.id);
                    }
                    const ids = [...next];
                    return ids.join('|') === previous.join('|') ? previous : ids;
                  });
              }}
              selectionOnDrag
              multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
              connectionMode={ConnectionMode.Loose}
              connectOnClick={false}
              nodesDraggable={!wireStart && !frozen}
              panOnDrag={!wireStart}
              onNodeClick={(event, n) => {
                if (wireStartRef.current) return;
                if (event.shiftKey || event.ctrlKey || event.metaKey) {
                  selectionVersion.current++;
                  setTarget({ kind: 'instance', id: n.id });
                  setSelectedIds((previous) =>
                    previous.includes(n.id) ? previous : [...previous, n.id],
                  );
                  setRightVisible(true);
                  return;
                }
                if (n.type === 'zone') {
                  select(null);
                  setZoneId(n.id);
                } else {
                  setZoneId(null);
                  select({ kind: 'instance', id: n.id });
                }
              }}
              onEdgeClick={(_e, edge) =>
                select({ kind: 'net', id: edge.data!.netId }, false, edge.data!.branch)
              }
              onPaneClick={(event) => {
                if (wireStartRef.current && wireDraftRef.current) {
                  const point = snapCanvasPoint(
                    flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                  );
                  const next = { points: [...wireDraftRef.current.points, point], cursor: point };
                  wireDraftRef.current = next;
                  setWireDraft(next);
                  return;
                }
                select(null);
                setZoneId(null);
              }}
              onNodeDragStop={(_e, n, draggedNodes) =>
                void run('儲存位置', () =>
                  save({
                    'layout.json': j({
                      ...s.layout,
                      ...Object.fromEntries(
                        (draggedNodes.length ? draggedNodes : [n]).map((node) => [
                          node.id,
                          { ...s.layout[node.id], ...snapCanvasPoint(node.position) },
                        ]),
                      ),
                    }),
                  }),
                )
              }
              fitView
              minZoom={0.15}
              maxZoom={2}
              deleteKeyCode={null}
            >
              {preferences.grid && <Background gap={canvasGridSize} size={1} color="#c8d3cb" />}
              <Controls showInteractive={false} showFitView={false} />
              {moreTools && <MiniMap nodeColor="#58877b" maskColor="#ecf0e9bb" />}
              {wireStart && wireDraft && (
                <ViewportPortal>
                  <svg className="wire-preview" aria-label={t('接線預覽')}>
                    <path
                      d={wirePath(
                        orthogonalPoints(
                          pinPosition(wireStart),
                          [...wireDraft.points, wireDraft.cursor],
                          pinPosition(wireStart).vertical,
                        ),
                      )}
                    />
                    {wireDraft.points.map((point, index) => (
                      <circle key={index} cx={point.x} cy={point.y} r={4} />
                    ))}
                  </svg>
                </ViewportPortal>
              )}
            </ReactFlow>
          </section>
          {bottomVisible && mainView === 'circuit' && (
            <ResizeHandle direction="bottom" value={bottomSize} onChange={setBottomSize} />
          )}
          <button
            hidden={mainView !== 'circuit'}
            className={'drawer-handle bottom-drawer ' + (bottomVisible ? 'expanded' : '')}
            aria-label={t(bottomVisible ? '隱藏下方區塊' : '顯示下方區塊')}
            title={t(bottomVisible ? '隱藏下方區塊' : '顯示下方區塊')}
            aria-expanded={bottomVisible}
            onClick={() => setBottomVisible((value) => !value)}
          >
            <ChevronUp size={20} aria-hidden="true" />
          </button>
          <section className="bottom-panel">
            <nav className="panel-tabs">
              {[
                ['rules', '問題'],
                ['output', '輸出'],
                ['serial', '序列埠'],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={tab === v ? 'active' : ''}
                  onClick={() => {
                    setTab(v);
                    setBottomVisible(true);
                  }}
                >
                  {t(l)}
                  {v === 'rules' && ctx.report?.diagnostics.some((d) => d.state === 'fail') && (
                    <span className="count-error">!</span>
                  )}
                </button>
              ))}
              <button
                className="bottom-close"
                aria-label={t(bottomVisible ? '收起底部面板' : '展開底部面板')}
                onClick={() => setBottomVisible((value) => !value)}
              >
                <ChevronDown size={16} />
              </button>
            </nav>
            <div
              className={
                'panel-content' +
                (mainView === 'circuit' && tab === 'serial' ? ' serial-panel-content' : '')
              }
            >
              <div hidden={mainView !== 'circuit' || !['output', 'serial'].includes(tab)}>
                <LocalTools
                  key={ctx.root}
                  initialSection={tab}
                  onHelp={showSettings}
                  compact
                  root={ctx.root}
                  source={s}
                  sourceDigest={ctx.sourceDigest}
                  baseRevision={c.revision}
                />
              </div>
              {mainView === 'circuit' && tab === 'rules' && (
                <>
                  <div className="issue-list">
                    {issues.map((issue, index) => {
                      const instance = s.circuit.instances.find(
                        (item) =>
                          item.id === issue.target || issue.target.startsWith(item.id + '.'),
                      );
                      const net = s.circuit.nets.find((item) => item.id === issue.target);
                      const locatable = !!instance || !!net;
                      const related = issue.relatedTargets?.filter((id) =>
                        s.circuit.instances.some((item) => item.id === id),
                      );
                      const name = (id: string) => {
                        const item = s.circuit.instances.find((item) => item.id === id)!;
                        return s.layout[id]?.label ?? componentName(defFor(s, item));
                      };
                      return (
                        <article className="issue-row" data-severity={issue.severity} key={index}>
                          <span aria-hidden="true">!</span>
                          <div>
                            <strong>{t(issue.reason)}</strong>
                            <small>
                              {related?.length
                                ? related.map(name).join(' / ')
                                : instance
                                  ? name(instance.id) +
                                    (issue.target.includes('.')
                                      ? ' · ' + issue.target.split('.').slice(1).join('.')
                                      : '')
                                  : net
                                    ? [...new Set(net.endpoints.map((ref) => ref.split('.')[0]))]
                                        .map(name)
                                        .join(' / ')
                                    : issue.target === 'environment'
                                      ? t('系統環境')
                                      : t('專案 / 程式')}
                            </small>
                          </div>
                          <button
                            onClick={() => {
                              if (related?.length) {
                                select(null);
                                void flow.fitView({
                                  nodes: related.map((id) => ({ id })),
                                  padding: 0.5,
                                  duration: 300,
                                });
                              } else if (locatable) locate(issue.target);
                              else if (issue.target === 'environment') setSettingsOpen(true);
                              else setTab('output');
                            }}
                          >
                            {t(locatable || related?.length ? '定位' : '查看說明')}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                  <div hidden>
                    <div className="panel-heading">
                      <div>
                        <h3>接線與程式檢查</h3>
                        <span role="status">{checking ? '檢查中' : '來源變更後自動檢查'}</span>
                      </div>
                      {moreTools && (
                        <span className="digest">{ctx.electricalDigest.slice(0, 12)}</span>
                      )}
                    </div>
                    {ctx.report ? (
                      <div className="diagnostics">
                        {!moreTools && (
                          <p role="status">
                            {
                              ctx.report.diagnostics.filter(
                                (d) => d.state === 'pass' && d.ruleId !== 'unused-component',
                              ).length
                            }{' '}
                            項通過・
                            {ctx.report.diagnostics.filter((d) => d.state === 'fail').length}{' '}
                            項需修正・
                            {
                              ctx.report.diagnostics.filter(
                                (d) => d.state === 'unknown' || d.state === 'not_run',
                              ).length
                            }{' '}
                            項待確認
                          </p>
                        )}
                        {ctx.report.diagnostics
                          .filter(
                            (d) =>
                              moreTools || d.state !== 'pass' || d.ruleId === 'unused-component',
                          )
                          .map((d, i) => (
                            <button
                              key={i}
                              className={'diagnostic ' + d.state}
                              onClick={() => locate(d.target)}
                            >
                              <span className="result-icon">{stateSymbol[d.state]}</span>
                              <div>
                                <strong>
                                  {d.ruleId === 'unused-component'
                                    ? '尚未使用'
                                    : moreTools
                                      ? d.ruleId
                                      : '檢查項目'}{' '}
                                  <em>
                                    {d.ruleId === 'unused-component'
                                      ? '可保留'
                                      : statusLabel[d.state]}
                                  </em>
                                </strong>
                                <p>{t(d.reason)}</p>
                                {moreTools && d.state !== 'pass' && (
                                  <small>
                                    {d.target} · {d.action}
                                    <br />
                                    依據：{d.basis}
                                  </small>
                                )}
                              </div>
                              <span>↗</span>
                            </button>
                          ))}
                      </div>
                    ) : (
                      <div className="empty">
                        <span>◎</span>
                        <p>
                          接線準備好後，執行檢查。
                          <br />
                          <small>變更會保留為草稿，套用前會比對來源版本。</small>
                        </p>
                        <button onClick={() => run('規則檢查', () => api('check', {}))}>
                          執行第一次檢查
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div hidden={mainView !== 'history'} className="history-workspace">
                <div className="panel-heading">
                  <div>
                    <h3>{t('版本紀錄')}</h3>
                    <p>{t('還原電路、版面、程式與採購設定；不會自動寫入裝置。')}</p>
                  </div>
                </div>
                <div className="history-controls">
                  <select
                    aria-label={t('版本紀錄')}
                    value={diffRev}
                    onChange={(e) => setDiffRev(e.target.value)}
                  >
                    {ctx.history.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.id.slice(-8)} · {t(statusLabel[h.status])} · {h.createdAt}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      run('讀取差異', async () => {
                        setDiff(await api('diff', { revision: diffRev }));
                        setCompared(diffRev + ':' + ctx.sourceDigest);
                      })
                    }
                  >
                    {t('比較草稿')}
                  </button>
                  <button
                    className="danger"
                    disabled={!!busy || compared !== diffRev + ':' + ctx.sourceDigest}
                    title={t('先比較目前草稿與此版本')}
                    onClick={() =>
                      run('完整還原', () =>
                        api('rollback', {
                          revision: diffRev,
                          expectedDigest: ctx.sourceDigest,
                          baseRevision: c.revision,
                        }),
                      )
                    }
                  >
                    {t('還原此版本')}
                  </button>
                </div>
                <button
                  disabled={
                    !!busy ||
                    ctx.report?.status !== 'ready' ||
                    compared !== ctx.report.id + ':' + ctx.sourceDigest
                  }
                  onClick={() =>
                    void run('套用草稿', () => api('apply', { revision: ctx.report!.id }))
                  }
                >
                  {t('確認差異並套用草稿')}
                </button>
                {diff.length ? (
                  diff.map((d) => (
                    <details key={d.file} open>
                      <summary>{d.file}</summary>
                      {d.file.startsWith('firmware/') ? (
                        <p className="muted">{t('程式有變更；還原版本時會一併還原。')}</p>
                      ) : (
                        <pre className="diff">
                          {d.patch.split('\n').map((line, i) => (
                            <span
                              key={i}
                              className={
                                line.startsWith('+')
                                  ? 'added'
                                  : line.startsWith('-')
                                    ? 'removed'
                                    : ''
                              }
                            >
                              {line}
                              {'\n'}
                            </span>
                          ))}
                        </pre>
                      )}
                    </details>
                  ))
                ) : (
                  <p className="muted">{t('選擇版本並比較變更。')}</p>
                )}
              </div>
              <div className="materials-view" hidden={mainView !== 'materials'}>
                <BomPanel
                  bom={ctx.bom}
                  source={s}
                  save={(p) => save({ 'procurement.json': j(p) })}
                />
              </div>
            </div>
          </section>
        </main>
        <aside
          className="inspector floating-inspector"
          ref={inspector}
          aria-label={t('元件資訊')}
          onSubmitCapture={(event) => {
            const key = zoneId ?? target?.id;
            const draft = key ? formDrafts.current.get(key) : undefined;
            if (draft && draft.digest !== ctx.sourceDigest) {
              event.preventDefault();
              event.stopPropagation();
              setError(t('專案已有其他修改，未儲存的設定已保留。請重新確認後再修改。'));
              return;
            }
            submittedForm.current = key ?? null;
          }}
          onInput={(event) => {
            const input = event.target as HTMLInputElement;
            const key = zoneId ?? target?.id;
            if (key && input.name && input.closest('form'))
              formDrafts.current.set(key, {
                digest: formDrafts.current.get(key)?.digest ?? ctx.sourceDigest,
                fields: { ...formDrafts.current.get(key)?.fields, [input.name]: input.value },
              });
          }}
        >
          <div className="inspector-heading">
            <div className="island-actions">
              <IconButton
                icon={Pin}
                text={false}
                label={preferences.pinned ? t('取消固定資訊視窗') : t('固定資訊視窗')}
                aria-pressed={preferences.pinned}
                onClick={() => setPreferences((value) => ({ ...value, pinned: !value.pinned }))}
              />
              <IconButton
                icon={X}
                text={false}
                label={t('關閉元件資訊')}
                onClick={() => setRightVisible(false)}
              />
            </div>
            <h2>
              {selectedDef
                ? t(componentName(selectedDef))
                : selectedNet
                  ? t('接線')
                  : selectedZone
                    ? t('區域')
                    : t('選取項目')}
            </h2>
          </div>
          <div className="inspector-content">
            {selectedIds.length > 1 && (
              <div>
                <h3>{t('已選取 {count} 個項目', { count: selectedIds.length })}</h3>
                <IconButton
                  icon={Copy}
                  label={t('複製選取項目')}
                  disabled={!!blocked}
                  onClick={() => void editCommand('copy')}
                />
                <IconButton
                  icon={Trash2}
                  label={t('刪除選取項目')}
                  disabled={!!blocked}
                  onClick={() => void removeSelected()}
                />
              </div>
            )}
            {selectedInstance &&
              issues.some(
                (issue) =>
                  issue.target === selectedInstance.id ||
                  issue.target.startsWith(selectedInstance.id + '.'),
              ) && (
                <div className="component-checks">
                  <h3>{t('檢查結果')}</h3>
                  {checking || ctx.report?.sourceDigest !== ctx.sourceDigest ? (
                    <p>{t('正在檢查最新來源…')}</p>
                  ) : (
                    ctx.report?.diagnostics
                      .filter(
                        (item) =>
                          item.state !== 'pass' &&
                          (item.target === selectedInstance.id ||
                            item.target.startsWith(selectedInstance.id + '.')) &&
                          item.ruleId !== 'i2c-address',
                      )
                      .map((item, index) => <p key={index}>{t(item.reason)}</p>)
                  )}
                </div>
              )}
            {formDrafts.current.get(zoneId ?? target?.id ?? '')?.digest &&
              formDrafts.current.get(zoneId ?? target?.id ?? '')!.digest !== ctx.sourceDigest && (
                <button
                  onClick={() => {
                    if (!window.confirm(t('放棄尚未儲存的設定，讀取專案最新內容？'))) return;
                    formDrafts.current.delete(zoneId ?? target?.id ?? '');
                    inspector.current?.querySelectorAll('form').forEach((form) => form.reset());
                    setError('');
                  }}
                >
                  {t('放棄草稿，讀取最新設定')}
                </button>
              )}
            {selectedDef && selectedInstance ? (
              <>
                <ComponentParameters
                  key={selectedInstance.id + ':' + ctx.sourceDigest}
                  definition={selectedDef}
                  instance={selectedInstance}
                  onSave={(parameters) =>
                    void run('儲存設定', () =>
                      saveCircuit({
                        ...s.circuit,
                        instances: s.circuit.instances.map((instance) =>
                          instance.id === selectedInstance.id
                            ? { ...instance, parameters }
                            : instance,
                        ),
                      }),
                    )
                  }
                />
                {selectedInstance.typeId === 'official:buzzer' && (
                  <BuzzerPanel
                    key={selectedInstance.id}
                    id={selectedInstance.id}
                    device={runtimeState?.simulation?.peripherals?.[selectedInstance.id]}
                    running={!!runtimeState?.simulation?.running}
                  />
                )}
                <div hidden>
                  <div className={'inspector-art ' + selectedDef.category}>
                    <HardwareArt definition={selectedDef} />
                    <strong>{selectedDef.model}</strong>
                    {moreTools && <small>{selectedDef.typeId}</small>}
                  </div>
                  {selectedDef.category === 'controller' && selectedDef.compileProfile && (
                    <button
                      disabled={selectedInstance.id === s.project.board || !!busy || frozen}
                      onClick={() =>
                        run('設定編譯用板子', () =>
                          save({
                            'project.json': j({
                              ...s.project,
                              board: selectedInstance.id,
                              profile: 'custom',
                            }),
                            'dependencies.lock.json': j({
                              ...s.dependencies,
                              fqbn: selectedDef.compileProfile,
                              core:
                                boards[selectedDef.compileProfile as keyof typeof boards]?.core ??
                                s.dependencies.core,
                            }),
                          }),
                        )
                      }
                    >
                      {selectedInstance.id === s.project.board
                        ? '目前編譯用板子'
                        : '設為編譯用板子'}
                    </button>
                  )}
                </div>
                <fieldset
                  disabled={!!busy || frozen || lockedIds.includes(selectedInstance.id)}
                  style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                >
                  <AppearanceSettings
                    entry={s.layout[selectedInstance.id] ?? { x: 0, y: 0 }}
                    onSave={(patch) => void saveLayoutEntry(selectedInstance.id, patch)}
                  />
                </fieldset>
                <div hidden>
                  <details>
                    <summary>詳細設定</summary>
                    <dl className="specs">
                      <div>
                        <dt>模組版本</dt>
                        <dd>{selectedDef.moduleVersion}</dd>
                      </div>
                      <div>
                        <dt>定義版本</dt>
                        <dd>{selectedDef.version}</dd>
                      </div>
                      <div>
                        <dt>單位</dt>
                        <dd>{selectedDef.unit}</dd>
                      </div>
                    </dl>
                    <h3>可用功能</h3>
                    <div className="capability-list">
                      <span>
                        ✓ 材料清單 <em>{catalogPrice(selectedDef) ? '目錄估價' : '待估價'}</em>
                      </span>
                      <span>
                        {selectedDef.pins.length ? '✓' : '?'} 接線{' '}
                        <em>{selectedDef.pins.length ? '可接線' : '尚無接腳資料'}</em>
                      </span>
                      <span>
                        {selectedDef.compileProfile ? '◌' : '?'} 範例程式{' '}
                        <em>
                          {selectedDef.compileProfile && !selectedDef.typeId.startsWith('custom:')
                            ? '有範例'
                            : '未驗證'}
                        </em>
                      </span>
                      <span>
                        ○ 模擬 <em>支援情況見「模擬紀錄」</em>
                      </span>
                    </div>
                    <h3>元件設定</h3>
                    <form
                      key={selectedInstance.id + ctx.sourceDigest}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const text = String(new FormData(e.currentTarget).get('params'));
                        void run('儲存參數', async () => {
                          const parameters = JSON.parse(text);
                          await saveCircuit({
                            ...s.circuit,
                            instances: s.circuit.instances.map((i) =>
                              i.id === selectedInstance.id ? { ...i, parameters } : i,
                            ),
                          });
                        });
                      }}
                    >
                      <textarea
                        aria-label={t('元件參數')}
                        name="params"
                        className="small-code"
                        defaultValue={j({
                          ...selectedDef.parameters,
                          ...selectedInstance.parameters,
                        })}
                      />
                      <button>儲存設定</button>
                    </form>
                  </details>
                  <h3>
                    接腳 <span>{selectedDef.pins.length}</span>
                  </h3>
                  <div className="pin-inspector">
                    {selectedDef.pins.map((p) => (
                      <button
                        key={p.id}
                        className={target?.id === selectedInstance.id + '.' + p.id ? 'active' : ''}
                        onClick={() =>
                          select({ kind: 'pin', id: selectedInstance.id + '.' + p.id })
                        }
                      >
                        <code>{p.name}</code>
                        <span>
                          {{
                            input: '輸入',
                            output: '輸出',
                            bidirectional: '雙向',
                            power: '電源',
                            passive: '連接',
                            ground: '接地',
                          }[p.direction] ?? '連接'}{' '}
                          {p.required ? '＊' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="source-note">
                    規格來源：
                    {selectedDef.source.startsWith('https://') ? (
                      <a href={selectedDef.source} target="_blank" rel="noreferrer">
                        查看官方文件 ↗
                      </a>
                    ) : (
                      selectedDef.source
                    )}
                  </p>
                  <details>
                    <summary>更換或移除元件</summary>
                    <p className="muted">換型號後會移除無法保留的接線，請重新檢查。</p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = String(new FormData(e.currentTarget).get('definition'));
                        const [typeId, version] = value.split('@');
                        void run('更換型號', () =>
                          api('replace', {
                            instanceId: selectedInstance.id,
                            typeId,
                            version,
                            expectedDigest: ctx.sourceDigest,
                          }),
                        );
                      }}
                    >
                      <select
                        aria-label={t('替換型號')}
                        name="definition"
                        defaultValue={selectedDef.typeId + '@' + selectedDef.version}
                      >
                        {defs.map((d) => (
                          <option
                            key={d.typeId + '@' + d.version}
                            value={d.typeId + '@' + d.version}
                          >
                            {d.name} @{d.version}
                          </option>
                        ))}
                      </select>
                      <button>更換為此型號</button>
                    </form>
                    <button
                      onClick={() => {
                        setCustomSeed({
                          ...selectedDef,
                          visual: componentVisual(selectedDef),
                          typeId: selectedDef.typeId.startsWith('custom:')
                            ? selectedDef.typeId
                            : 'custom:' + selectedDef.typeId.split(':')[1],
                          version: selectedDef.typeId.startsWith('custom:')
                            ? selectedDef.version.replace(/\d+$/, (n) => String(Number(n) + 1))
                            : '1.0.0',
                        });
                        setModal('custom');
                      }}
                    >
                      複製成自訂元件
                    </button>
                    <button onClick={() => download(selectedDef)}>下載元件資料</button>
                    <button className="danger" onClick={() => run('移除元件', remove)}>
                      移除元件
                    </button>
                  </details>
                </div>
              </>
            ) : selectedNet ? (
              <>
                {selectedBranch && (
                  <p className="muted">
                    {selectedBranch.from} → {selectedBranch.to}
                  </p>
                )}
                <label>
                  {t('接線名稱')}
                  <input
                    key={
                      selectedNet.id +
                      (selectedBranch ? selectedBranch.from + selectedBranch.to : '') +
                      (selectedBranch?.name ?? selectedNet.name)
                    }
                    defaultValue={selectedBranch?.name ?? selectedNet.name}
                    onBlur={(e) => {
                      if (!e.target.value.trim()) {
                        e.target.value = selectedBranch?.name ?? selectedNet.name;
                        return;
                      }
                      if (selectedBranch) {
                        if (e.target.value !== (selectedBranch.name ?? selectedNet.name))
                          void updateSelectedWire({ name: e.target.value });
                        return;
                      }
                      if (e.target.value !== selectedNet.name)
                        void run('更新網路', () =>
                          saveCircuit({
                            ...s.circuit,
                            nets: s.circuit.nets.map((n) =>
                              n.id === selectedNet.id ? { ...n, name: e.target.value } : n,
                            ),
                          }),
                        );
                    }}
                  />
                </label>
                <h3>{t('接線外觀')}</h3>
                <label>
                  {t('接線顏色')}
                  <input
                    type="color"
                    aria-label={t('接線顏色')}
                    value={
                      selectedBranch?.color ??
                      selectedWire?.color ??
                      automaticWireColor(s, selectedNet.endpoints)
                    }
                    onChange={(e) => void updateSelectedWire({ color: e.target.value })}
                  />
                </label>
                <label>
                  {t('接線粗細')}
                  <select
                    aria-label={t('接線粗細')}
                    value={selectedBranch?.wireWidth ?? selectedWire?.wireWidth ?? 3}
                    onChange={(e) =>
                      void updateSelectedWire({
                        wireWidth: Number(e.target.value),
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} px
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() =>
                    void run('整理接線', () =>
                      save({ 'layout.json': j(arrangeWires(s, selectedNet.id, selectedBranch)) }),
                    )
                  }
                >
                  {t('重新整理走線')}
                </button>
                <button className="danger" onClick={() => void removeSelected()}>
                  {t('刪除此接線')}
                </button>
              </>
            ) : selectedZone && zoneId ? (
              <form
                key={zoneId + ctx.sourceDigest}
                className="zone-editor"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void saveLayoutEntry(zoneId, {
                    label: String(f.get('label')),
                    color: String(f.get('color')),
                    width: Number(f.get('width')),
                    height: Number(f.get('height')),
                  });
                }}
              >
                <p className="muted">
                  {t('用區域整理供電、輸入與輸出模組。拖曳可移動；區域只做視覺整理。')}
                </p>
                <label>
                  {t('區域名稱')}
                  <input
                    name="label"
                    aria-label={t('區域名稱')}
                    defaultValue={selectedZone.label}
                    maxLength={120}
                  />
                </label>
                <label>
                  {t('區域顏色')}
                  <input
                    type="color"
                    name="color"
                    aria-label={t('區域顏色')}
                    defaultValue={selectedZone.color ?? '#8dbfa5'}
                  />
                </label>
                <label>
                  {t('區域寬度')}
                  <input
                    type="number"
                    name="width"
                    aria-label={t('區域寬度')}
                    min="100"
                    max="2000"
                    defaultValue={selectedZone.width ?? 460}
                  />
                </label>
                <label>
                  {t('區域高度')}
                  <input
                    type="number"
                    name="height"
                    aria-label={t('區域高度')}
                    min="80"
                    max="2000"
                    defaultValue={selectedZone.height ?? 300}
                  />
                </label>
                <button className="primary">{t('儲存區域')}</button>
                <button
                  type="button"
                  className="danger"
                  onClick={() =>
                    run('移除工作區域', async () => {
                      const layout = { ...s.layout };
                      delete layout[zoneId];
                      await save({ 'layout.json': j(layout) });
                      setZoneId(null);
                    })
                  }
                >
                  {t('移除此區域')}
                </button>
              </form>
            ) : (
              <div className="selection-empty">
                <span>⌖</span>
                <p>
                  {t('點選元件、接腳或連線')}
                  <br />
                  {t('查看規格與留下需求')}
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>◉ {t('本機專案')} {moreTools && <code>{ctx.root}</code>}</span>
        <span>
          {!s.project.board
            ? t('尚未選板子')
            : s.dependencies.fqbn === 'arduino:avr:uno'
              ? 'Arduino Uno R3'
              : 'ESP32'}{' '}
          · Arduino framework <i /> {t('無硬體實測結果')}
        </span>
      </footer>
      {updateOpen && <UpdateDialog onClose={() => setUpdateOpen(false)} />}
      {moreTools && previewOpen && (
        <CodePreview
          files={Object.fromEntries(
            Object.entries(sourceFiles).map(([file, content]) => [
              file,
              editorDrafts[file]?.text ?? content,
            ]),
          )}
          onClose={() => setPreviewOpen(false)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
      {boardReplacement && (
        <Dialog
          title={t('改用 {name}？', { name: componentName(boardReplacement) })}
          onClose={() => setBoardReplacement(null)}
        >
          <p>
            {t('此專案已使用')}{' '}
            {s.circuit.instances
              .filter((instance) => defFor(s, instance).category === 'controller')
              .map((instance) => componentName(defFor(s, instance)))
              .join('、')}
            {t('。一個專案只能使用一個主控制器。')}
          </p>
          <p>
            {t('會保留能對應的接線。無法對應時會停止更換，保留原電路並列出需要先修改的接腳；電壓與程式相容性仍需檢查。')}
          </p>
          <div className="form-actions">
            <button disabled={!!busy} onClick={() => setBoardReplacement(null)}>
              {t('取消')}
            </button>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                void run('更換主控制器', async () => {
                  await runtimePost('board', {
                    fqbn: boardReplacement.compileProfile,
                    expectedDigest: ctx.sourceDigest,
                    baseRevision: c.revision,
                  });
                  receive(await api('context'));
                  setBoardReplacement(null);
                })
              }
            >
              {t('改用 {name}', { name: componentName(boardReplacement) })}
            </button>
          </div>
        </Dialog>
      )}
      {settingsOpen && (
        <Dialog title={t('工具與裝置設定')} onClose={() => setSettingsOpen(false)}>
          <LocalTools
            root={ctx.root}
            source={s}
            sourceDigest={ctx.sourceDigest}
            baseRevision={c.revision}
            compact
            initialSection="environment"
          />
        </Dialog>
      )}
      {displayOpen && (
        <Dialog title={t('畫布顯示設定')} onClose={() => setDisplayOpen(false)}>
          {(
            [
              { key: 'names', label: '元件名稱' },
              { key: 'pins', label: '接腳標籤' },
              { key: 'grid', label: '座標網格' },
            ] as const
          ).map(({ key, label }) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) =>
                  setPreferences((previous) => ({ ...previous, [key]: event.target.checked }))
                }
              />
              {t(label)}
            </label>
          ))}
        </Dialog>
      )}
      {exportOpen && (
        <Dialog
          title={t('匯出')}
          onClose={() => {
            if (!busy) {
              setExportOpen(false);
              setExportKind(null);
            }
          }}
        >
          <p>
            {t('已儲存存來源：')}
            {ctx.sourceDigest.slice(0, 12)}
          </p>
          {exportKind && Object.keys(editorDrafts).length ? (
            <>
              <p>{t('程式仍有未儲存內容。')}</p>
              <button disabled={!!busy} onClick={() => exportProject(exportKind, 'save')}>
                {t('儲存全部程式後匯出')}
              </button>
              <button disabled={!!busy} onClick={() => exportProject(exportKind, 'saved')}>
                {t('匯出已儲存版本')}
              </button>
            </>
          ) : (
            <div className="export-choices">
              {(['svg', 'png', 'program', 'project'] as const).map((kind) => (
                <button key={kind} disabled={!!busy} onClick={() => exportProject(kind)}>
                  {
                    {
                      svg: t('電路圖 SVG'),
                      png: t('電路圖 PNG'),
                      program: t('程式 ZIP'),
                      project: t('完整可編輯專案 ZIP'),
                    }[kind]
                  }
                </button>
              ))}
              <button
                disabled={!!busy || !!activeJob}
                onClick={() => {
                  setExportOpen(false);
                  runtimeCommands.current?.exportSimulator();
                }}
              >
                {t('外部模擬器專用 ZIP（需編譯）')}
              </button>
            </div>
          )}
        </Dialog>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === 'custom'
                ? t('自訂元件')
                : modal === 'project'
                  ? t('開啟專案')
                  : t('套用範例')
            }
            className={'modal ' + (modal === 'custom' ? 'wide' : '')}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" aria-label={t('關閉')} onClick={() => setModal(null)}>
              ×
            </button>
            {modal === 'custom' ? (
              <CustomForm
                seed={customSeed}
                onSave={(d) =>
                  run('儲存自訂定義', async () => {
                    await api('custom', { definition: d, expectedDigest: ctx.sourceDigest });
                    setModal(null);
                    setNotice(t('定義已新增；現有元件版本不會自動改寫'));
                  })
                }
              />
            ) : modal === 'project' ? (
              <>
                <span className="eyebrow">YOUR WORKBENCH</span>
                <h2>{t('本機專案')}</h2>
                <p>{t('在伺服器設定的專案工作區內建立或開啟資料夾。')}</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
                    void run('開啟專案', async () => {
                      await api('project', {
                        name: data.get('name'),
                        profile: data.get('profile'),
                        create: submitter.value === 'create',
                      });
                      setModal(null);
                      setTarget(null);
                      setDiffRev('');
                      setDirtyEditor(false);
                    });
                  }}
                >
                  <label>
                    {t('資料夾名稱')}
                    <input name="name" required placeholder="my-circuit" />
                  </label>
                  <label>
                    {t('初始範例')}
                    <select name="profile">
                      <option value="led">{t('LED 閃爍')}</option>
                      <option value="oled">{t('OLED 顯示器')}</option>
                      <option value="temperature">{t('溫度警示器')}</option>
                    </select>
                  </label>
                  <div className="form-actions">
                    <button name="action" value="open">
                      {t('開啟現有專案')}
                    </button>
                    <button name="action" value="create" className="primary">
                      {t('建立專案')}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <>
                <span className="eyebrow">START WITH A CIRCUIT</span>
                <h2>{t('可重現的範例')}</h2>
                <p>
                  {t(
                    '替換目前草稿的電路、版面、韌體與依賴。保留採購設定與自訂定義；已套用版本仍可從歷史還原。',
                  )}
                </p>
                {[
                  ['led', 'LED 閃爍', 'GPIO25 → 220Ω → 紅色 LED'],
                  ['oled', 'OLED 顯示器', 'I²C · GPIO21 / 22 · SSD1306'],
                  ['temperature', '溫度警示器', 'DHT22 溫度 > 30°C 時亮燈'],
                ].map(([profile, title, desc]) => (
                  <button
                    className="template-option"
                    key={profile}
                    onClick={() =>
                      run('載入完整範例', async () => {
                        await api('template', { profile, expectedDigest: ctx.sourceDigest });
                        setModal(null);
                        select(null);
                        setNotice(t('完整範例草稿已載入，請重新檢查及編譯'));
                        setTimeout(() => void flow.fitView({ padding: 0.2 }), 150);
                      })
                    }
                  >
                    <span>{profile === 'led' ? '◉' : profile === 'oled' ? '▣' : '♨'}</span>
                    <div>
                      <strong>{t(title)}</strong>
                      <small>{t(desc)}</small>
                    </div>
                    <b>→</b>
                  </button>
                ))}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function download(d: Definition) {
  const url = URL.createObjectURL(new Blob([j(d)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = d.typeId.replace(':', '-') + '-' + d.version + '.json';
  a.click();
  URL.revokeObjectURL(url);
}
function BomPanel({
  bom,
  source,
  save,
}: {
  bom: Bom;
  source: Source;
  save: (p: Source['procurement']) => Promise<void>;
}) {
  const t = useT();
  const p = source.procurement;
  const [validation, setValidation] = useState('');
  const [saving, setSaving] = useState(false);
  const [materialChoices, setMaterialChoices] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setMaterialChoices({});
  }, [JSON.stringify(p.manual)]);
  const [materialQuantities, setMaterialQuantities] = useState<Record<string, number>>({});
  const update = async (fn: () => Source['procurement']) => {
    setSaving(true);
    try {
      setValidation('');
      await save(fn());
      return true;
    } catch (e) {
      setValidation((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const budgetText = {
    unset: t('尚未設定預算'),
    within: t('概估符合預算'),
    possible: t('可能超支'),
    over: t('超出預算'),
    incomplete: t('估算未完整'),
  }[bom.budgetState];
  return (
    <>
      <div className="cost-summary">
        <div>
          <span className="eyebrow">
            {bom.incomplete ? t('目前已知價格小計') : t('目前推估成本')}
          </span>
          <strong>
            {moneyRange(bom.spend, bom.currency)}
          </strong>
          <p>
            {t('新增採購支出 · 已含預留')} {money(bom.reserve, bom.currency)}
          </p>
        </div>
        <div>
          <span className={'budget-status ' + (bom.overBudget ? 'over' : '')}>{budgetText}</span>
          {bom.incomplete && <span className="unknown-label">{t('估算未完整')}</span>}
          <p>
            {t('材料總值')} {moneyRange(bom.materialValue, bom.currency)}
            {bom.materialValueIncomplete ? t('（不完整）') : ''}
          </p>
        </div>
      </div>
      {bom.rows.some((row) => row.price) && (
        <p className="estimate-notice">
          {bom.rows.some((row) => row.price?.demo)
            ? t('價格自動帶入並依數量與包裝量計算；內建資料為示範預算區間，非即時市場報價，未含運費。')
            : t('價格自動帶入單一參考價，依實際包裝量計算。來源與查核日期列於各材料；為查核時的頁面售價，非即時報價，庫存與稅運費依來源頁面。')}
        </p>
      )}
      {validation && (
        <p role="alert" className="error-text">
          {validation}
        </p>
      )}
      <form
        key={source.procurement.currency + String(p.budget) + p.reserve}
        className="budget-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          update(() => ({
            ...p,
            currency: String(f.get('currency')),
            budget: f.get('budget') ? minor(String(f.get('budget'))) : null,
            reserve: minor(String(f.get('reserve'))),
          }));
        }}
      >
        <label>
          {t('幣別')}
          <select name="currency" defaultValue={p.currency}>
            <option>TWD</option>
            <option>USD</option>
            <option>EUR</option>
            <option>HKD</option>
          </select>
        </label>
        <label>
          {t('總預算')}
          <input
            name="budget"
            aria-label={t('總預算')}
            inputMode="decimal"
            placeholder={t('未設定')}
            defaultValue={p.budget === null ? '' : p.budget / 100}
          />
        </label>
        <label>
          {t('預留費用')}
          <input
            name="reserve"
            aria-label={t('預留費用')}
            inputMode="decimal"
            defaultValue={p.reserve / 100}
          />
        </label>
        <button>{t('儲存預算')}</button>
      </form>
      <section className="consumable-choices">
        <h3>{t('耗材')}</h3>
        {estimatedConsumables(source).map((suggestion) => {
          const definition = [...source.catalog.definitions, ...source.custom].find(
            (definition) => definition.typeId === suggestion.typeId,
          )!;
          const id = 'estimate_' + suggestion.typeId.split(':')[1];
          const existing = p.manual.find((material) => material.id === id);
          const quantity = materialQuantities[id] ?? existing?.quantity ?? suggestion.quantity ?? 1;
          const chosen = !!existing;
          const include = (enabled: boolean, count = quantity) =>
            update(() => ({
              ...p,
              manual: [
                ...p.manual.filter((material) => material.id !== id),
                ...(enabled
                  ? [
                      {
                        id,
                        typeId: definition.typeId,
                        definitionVersion: definition.version,
                        parameters: { ...definition.parameters },
                        quantity: count,
                        instanceRefs: source.circuit.instances
                          .filter(
                            (instance) =>
                              instance.typeId === definition.typeId &&
                              instance.definitionVersion === definition.version,
                          )
                          .map((instance) => instance.id),
                      },
                    ]
                  : []),
              ],
            }));
          return (
            <div key={id}>
              <label className="checkbox">
                <input
                  aria-label={t('計入{name}', { name: t(definition.name) })}
                  type="checkbox"
                  checked={materialChoices[id] ?? chosen}
                  disabled={saving}
                  onChange={async (event) => {
                    const enabled = event.target.checked;
                    setMaterialChoices((current) => ({ ...current, [id]: enabled }));
                    if (!(await include(enabled)))
                      setMaterialChoices((current) => ({ ...current, [id]: chosen }));
                  }}
                />
                {t(definition.name)}
              </label>
              <input
                aria-label={t('{name}估算數量', { name: t(definition.name) })}
                type="number"
                min="0"
                step="1"
                value={quantity}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isSafeInteger(value) || value < 0) return;
                  setMaterialQuantities((current) => ({ ...current, [id]: value }));
                }}
                onBlur={() => {
                  if (chosen && existing.quantity !== quantity) include(true);
                }}
              />
              <span>
                {t(definition.unit)} ·{' '}
                {suggestion.quantity === null
                  ? t('數量待確認')
                  : t('目前估計 {count} {unit}', {
                      count: suggestion.quantity,
                      unit: t(definition.unit),
                    })}
              </span>
              <small>{t(suggestion.note)}</small>
            </div>
          );
        })}
      </section>
      {bom.missing.length > 0 && (
        <div className="missing-prices">
          {t('待補：{items}。目前尚無同幣別價格資料，系統不會自動換匯。', {
            items: bom.missing.map((item) => t(item)).join(t('、')),
          })}
        </div>
      )}
      <div className="table-scroll">
        <table className="bom-table">
          <thead>
            <tr>
              <th>{t('材料 / 來源')}</th>
              <th>{t('需求')}</th>
              <th>{t('可用已有量')}</th>
              <th>{t('待購')}</th>
              <th>{t('每包概估價格 / 包裝量')}</th>
              <th>{t('採購小計')}</th>
              <th>{t('型號')}</th>
            </tr>
          </thead>
          <tbody>
            {bom.rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <strong>{t(row.name)}</strong>
                  <small>
                    {row.model} · {row.moduleVersion}
                  </small>
                  <details>
                    <summary>{t('{count} 個來源', { count: row.sources.length })}</summary>
                    {row.sources.map((ref) => (
                      <code key={ref}>
                        {ref}
                        <br />
                      </code>
                    ))}
                  </details>
                </td>
                <td>
                  {row.demand} {t(row.unit)}
                </td>
                <td>
                  <input
                    aria-label={t('{name}已有量', { name: t(row.name) })}
                    type="number"
                    min="0"
                    step="1"
                    key={row.key + String(p.inventory[row.key]?.quantity)}
                    defaultValue={p.inventory[row.key]?.quantity ?? 0}
                    onBlur={(e) => {
                      const quantity = Number(e.target.value);
                      if (quantity !== (p.inventory[row.key]?.quantity ?? 0))
                        update(() => ({
                          ...p,
                          inventory: {
                            ...p.inventory,
                            [row.key]: { quantity, usable: p.inventory[row.key]?.usable ?? true },
                          },
                        }));
                    }}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={p.inventory[row.key]?.usable ?? true}
                      onChange={(e) =>
                        update(() => ({
                          ...p,
                          inventory: {
                            ...p.inventory,
                            [row.key]: {
                              quantity: p.inventory[row.key]?.quantity ?? 0,
                              usable: e.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    {t('可用')}
                  </label>
                </td>
                <td>
                  <strong>{row.toBuy}</strong>
                  <small>
                    {row.packages ?? '—'} {t('包')}
                  </small>
                </td>
                <td>
                  <strong>
                    {row.price
                      ? moneyRange([row.price.low, row.price.high], p.currency)
                      : t('尚無同幣別參考資料')}
                  </strong>
                  {row.price && (
                    <small>
                      {t('每包 {count} {unit}', { count: row.price.packSize, unit: t(row.unit) })}
                    </small>
                  )}
                  <PriceAttribution price={row.price} />
                </td>
                <td>
                  {row.subtotal
                    ? moneyRange(row.subtotal, p.currency)
                    : t('待估價')}
                </td>
                <td>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={row.locked}
                      onChange={(e) =>
                        update(() => ({
                          ...p,
                          locked: e.target.checked
                            ? [...p.locked, row.key]
                            : p.locked.filter((k) => k !== row.key),
                        }))
                      }
                    />
                    {t('鎖定')}
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={p.substitutable.includes(row.key)}
                      onChange={(e) =>
                        update(() => ({
                          ...p,
                          substitutable: e.target.checked
                            ? [...p.substitutable, row.key]
                            : p.substitutable.filter((k) => k !== row.key),
                        }))
                      }
                    />
                    {t('允許替換')}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="procurement-advanced">
        <summary>{t('補充材料與採購條件')}</summary>
        <p className="muted">
          {t(
            '手動補充列視為額外需求；若代表既有電路元件，輸入 instance ID 引用以避免重複計算。',
          )}
        </p>
        <form
          className="manual-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const [typeId, definitionVersion] = String(f.get('definition')).split('@');
            update(() => ({
              ...p,
              manual: [
                ...p.manual,
                {
                  id: id('manual'),
                  typeId,
                  definitionVersion,
                  parameters: {},
                  quantity: Number(f.get('quantity')),
                  instanceRefs: String(f.get('refs'))
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              ],
            }));
          }}
        >
          <label>
            {t('手動材料')}
            <select name="definition">
              {[...source.catalog.definitions, ...source.custom]
                .filter((d) => d.physical)
                .map((d) => (
                  <option key={d.typeId + '@' + d.version} value={d.typeId + '@' + d.version}>
                    {t(d.name)} · {d.moduleVersion}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('需求量')}
            <input type="number" name="quantity" defaultValue="1" min="1" step="1" required />
          </label>
          <label>
            {t('已有來源引用（選填）')}
            <input name="refs" placeholder="led1, r1" />
          </label>
          <button>{t('新增材料')}</button>
        </form>
        {p.manual.map((m) => (
          <p key={m.id}>
            {m.id} · {m.typeId} × {m.quantity} {m.instanceRefs.join(', ')}{' '}
            <button
              onClick={() =>
                update(() => ({ ...p, manual: p.manual.filter((i) => i.id !== m.id) }))
              }
            >
              {t('移除')}
            </button>
          </p>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            update(() => ({
              ...p,
              requiredFeatures: String(f.get('features')).split('\n').filter(Boolean),
              missingMaterials: String(f.get('missing')).split('\n').filter(Boolean),
            }));
          }}
        >
          <label>
            {t('必備功能（每行一項）')}
            <textarea name="features" defaultValue={p.requiredFeatures.join('\n')} />
          </label>
          <label>
            {t('尚待補齊材料（每行一項）')}
            <textarea name="missing" defaultValue={p.missingMaterials.join('\n')} />
          </label>
          <button>{t('儲存條件')}</button>
        </form>
      </details>
      <p className="muted">
        {t('所有金額以最小貨幣單位儲存（此介面採兩位小數）。沒有價格的已有零件不增加新增支出。未設定預留費用時不假設已含運費。')}
      </p>
    </>
  );
}
function CustomForm({
  seed,
  onSave,
}: {
  seed: Definition | null;
  onSave: (d: Definition) => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Definition>(
    seed ?? {
      typeId: 'custom:my-component',
      version: '1.0.0',
      category: 'sensor',
      name: '',
      model: '',
      moduleVersion: '1',
      unit: '個',
      source: '使用者自行定義，規格尚待核對',
      physical: true,
      pins: [],
      parameters: {},
      price: null,
    },
  );
  const [pins, setPins] = useState(j(draft.pins)),
    [parameters, setParameters] = useState(j(draft.parameters)),
    [price, setPrice] = useState(j(draft.price)),
    [err, setErr] = useState('');
  const update = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }));
  let visualPins = draft.pins;
  try {
    const parsed = JSON.parse(pins);
    if (
      Array.isArray(parsed) &&
      parsed.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    )
      visualPins = parsed;
  } catch {}
  return (
    <>
      <span className="eyebrow">MAKE IT YOUR OWN</span>
      <h2>{seed ? t('複製 / 編輯定義新版本') : t('新增自訂元件')}</h2>
      <p>{t('即使尚無接脚或模擬規格，也能儲存並列入材料清單。更新版本不會自動改寫既有元件。')}</p>
      <label className="import-control">
        {t('匯入定義 JSON')}
        <input
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            try {
              const file = e.target.files?.[0];
              if (file) {
                const d = JSON.parse(await file.text());
                if (!d || typeof d !== 'object' || Array.isArray(d) || typeof d.typeId !== 'string')
                  throw new Error(t('請匯入單一有效元件定義物件'));
                setDraft(d);
                setPins(j(d.pins ?? []));
                setParameters(j(d.parameters ?? {}));
                setPrice(j(d.price ?? null));
                setErr('');
              }
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        />
      </label>
      {err && (
        <p role="alert" className="error-text">
          {err}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            setErr('');
            const parsedPins = JSON.parse(pins);
            void onSave({
              ...draft,
              ...(draft.visual
                ? {
                    visual: {
                      ...draft.visual,
                      pinPositions: Object.fromEntries(
                        Object.entries(draft.visual.pinPositions).filter(([id]) =>
                          parsedPins.some((p: any) => p.id === id),
                        ),
                      ),
                    },
                  }
                : {}),
              pins: parsedPins,
              parameters: JSON.parse(parameters),
              price: JSON.parse(price),
            });
          } catch (e) {
            setErr((e as Error).message);
          }
        }}
      >
        <div className="form-grid">
          {[
            ['name', '元件名稱'],
            ['model', '型號 / 自訂名稱'],
            ['typeId', '穩定 type ID（custom:）'],
            ['version', '定義版本'],
            ['moduleVersion', '模組版本'],
            ['unit', '數量單位'],
          ].map(([key, label]) => (
            <label key={key}>
              {t(label)}
              <input
                required
                value={String((draft as any)[key] ?? '')}
                onChange={(e) => update(key, e.target.value)}
              />
            </label>
          ))}
          <label>
            {t('分類')}
            <select value={draft.category} onChange={(e) => update('category', e.target.value)}>
              {Object.entries(categories).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('規格來源')}
            <input
              required
              value={draft.source}
              onChange={(e) => update('source', e.target.value)}
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.physical}
            onChange={(e) => update('physical', e.target.checked)}
          />
          {t('實體材料（虛擬電源符號請取消）')}
        </label>
        <label>
          {t('具名接腳（JSON）')}
          <textarea
            className="code-editor short"
            value={pins}
            onChange={(e) => setPins(e.target.value)}
          />
        </label>
        <p className="muted">
          {t('範例：')}
          {`[{"id":"SIG","name":"SIG","direction":"input","interfaces":["digital"],"required":true,"voltage":[3.3,3.3]}]`}
        </p>
        <CustomVisualEditor
          definition={{ ...draft, pins: visualPins }}
          onChange={(visual) =>
            setDraft((d) => {
              const next = { ...d };
              if (visual) next.visual = visual;
              else delete next.visual;
              return next;
            })
          }
        />
        <div className="form-grid">
          <label>
            {t('可調參數（JSON）')}
            <textarea
              className="small-code"
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
            />
          </label>
          <label>
            {t('概估價格（JSON，未知為 null）')}
            <textarea
              className="small-code"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        </div>
        <p className="muted">
          {t(
            '價格包含 low、high（整數最小單位）、currency、packSize、basis（pack / piece）、date、source、demo；範例價格必須標記 demo: true。',
          )}
        </p>
        <details>
          <summary>{t('驅動及進階能力')}</summary>
          <div className="form-grid">
            <label>
              {t('驅動名稱')}
              <input
                value={draft.driver?.name ?? ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    const d = { ...draft };
                    delete d.driver;
                    setDraft(d);
                  } else
                    update('driver', {
                      name: e.target.value,
                      version: draft.driver?.version ?? '1.0.0',
                    });
                }}
              />
            </label>
            <label>
              {t('驅動版本')}
              <input
                value={draft.driver?.version ?? ''}
                onChange={(e) =>
                  update('driver', { name: draft.driver?.name ?? '', version: e.target.value })
                }
              />
            </label>
            <label>
              {t('程式範例類型')}
              <input
                value={draft.compileProfile ?? ''}
                onChange={(e) => {
                  const d = { ...draft };
                  if (e.target.value) d.compileProfile = e.target.value;
                  else delete d.compileProfile;
                  setDraft(d);
                }}
              />
            </label>
            <label>
              {t('模擬工具代碼')}
              <input
                value={draft.simulationAdapter ?? ''}
                onChange={(e) => {
                  const d = { ...draft };
                  if (e.target.value) d.simulationAdapter = e.target.value;
                  else delete d.simulationAdapter;
                  setDraft(d);
                }}
              />
            </label>
          </div>
          <p className="muted">{t('填入代碼不代表可以模擬，支援情況請查看「模擬與裝置」。')}</p>
        </details>
        <div className="form-actions">
          <button
            type="button"
            onClick={() => {
              try {
                download({
                  ...draft,
                  pins: JSON.parse(pins),
                  parameters: JSON.parse(parameters),
                  price: JSON.parse(price),
                });
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            {t('匯出 JSON')}
          </button>
          <button className="primary">{t('儲存自訂定義')}</button>
        </div>
      </form>
    </>
  );
}
