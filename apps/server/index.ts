import express from 'express';
import { createPreviewAuthorizer } from './preview-access';
import chokidar, { type ChokidarOptions } from 'chokidar';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  getContext,
  recover,
  saveFiles,
  inspect,
  applyRevision,
  rollback,
  diffRevision,
  setSelection,
  addCustom,
  replaceTemplate,
  replaceComponent,
  initProject,
  ensureAgentFiles,
  current,
} from '../../packages/core/src/project';
import { capture, isSourceFile, json, safePath } from '../../packages/core/src/files';
import { Runtime } from '../../packages/core/src/runtime';
import {
  DraftEdits,
  duplicateSelection,
  deleteSelection,
  organizeWorkspace,
} from '../../packages/core/src/editing';
import { exportSnapshot } from '../../packages/core/src/exports';
import { arrangeWires } from '../../packages/core/src/routing';
import {
  listProjects,
  createWorkspaceProject,
  renameWorkspaceProject,
  copyWorkspaceProject,
  deleteWorkspaceProject,
  projectPath,
} from '../../packages/core/src/workspace';
export async function startServer(initialRoot: string, port = 4318, workspace?: string) {
  let root = path.resolve(initialRoot);
  const projectWorkspace = path.resolve(workspace ?? path.dirname(root));
  await recover(root);
  await ensureAgentFiles(root);
  const app = express();
  const authorizePreview = await createPreviewAuthorizer();
  const runtime = new Runtime(),
    sessionToken = randomUUID() + randomUUID();
  const edits = new DraftEdits();
  const origins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
  const clients = new Set<express.Response>();
  let lastGood: Awaited<ReturnType<typeof getContext>> | null = null;
  let projectError: string | null = null;
  let refreshing: Promise<void> | null = null;
  let pending = false;
  app.use(async (req, res, next) => {
    const host = req.headers.host ?? '';
    const verifiedPreview = await authorizePreview(req);
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && !verifiedPreview)
      return void res.status(403).json({ error: '只接受 localhost Host' });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin) && !verifiedPreview)
      return void res.status(403).json({ error: '拒絕非本機 Origin' });
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && !req.is('application/json'))
      return void res.status(415).json({ error: '需要 application/json' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (
      req.path.startsWith('/api/runtime') &&
      ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) &&
      req.headers.authorization !== 'Bearer ' + sessionToken
    )
      return void res.status(403).json({ error: '需要本機服務工作階段 token' });
    next();
  });
  app.use(express.json({ limit: '4mb' }));
  const broadcast = (event: unknown) => {
    for (const client of clients) client.write('data: ' + JSON.stringify(event) + '\n\n');
  };
  // Every published state carries an increasing sequence number. SSE events and /api/context
  // responses travel on different connections, so a client keeps only the newest it has seen
  // (per server instance) instead of letting a late, older event overwrite newer state.
  const instance = randomUUID();
  let sequence = 0;
  const snapshot = () => ({ context: lastGood, error: projectError, instance, seq: sequence });
  function refresh(): Promise<void> {
    pending = true;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        do {
          pending = false;
          const refreshingRoot = root;
          try {
            const context = await getContext(refreshingRoot);
            if (refreshingRoot !== root) {
              pending = true;
              continue;
            }
            lastGood = context;
            projectError = null;
          } catch (e) {
            if (refreshingRoot !== root) {
              pending = true;
              continue;
            }
            projectError = (e as Error).message;
          }
          sequence++;
          broadcast({ ...snapshot(), at: Date.now() });
        } while (pending);
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }
  let timer: ReturnType<typeof setTimeout>;
  const watchOptions: ChokidarOptions = {
    ignoreInitial: true,
    ignored: (p) => {
      const relative = path.relative(root, p).replaceAll('\\', '/');
      return (
        (relative.startsWith('.hw/') && relative !== '.hw/current.json') ||
        relative === 'bom.json' ||
        relative === 'firmware/main/pinmap.h' ||
        relative.endsWith('.tmp')
      );
    },
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
  };
  // Changes are collected over the debounce window: a source edit must not be lost when a
  // later .hw/current.json event (e.g. from `hw check`) is the last one in the window.
  let sourceChanged = false;
  const onWatchEvent = (_event: string, file: string) => {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    if (isSourceFile(relative) || relative === '.hw/current.json') {
      if (relative !== '.hw/current.json') sourceChanged = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = sourceChanged;
        sourceChanged = false;
        if (!changed)
          void current(root)
            .then((c) => {
              if (
                c.revision !== lastGood?.current.revision ||
                c.draft !== lastGood?.current.draft ||
                c.status !== lastGood?.current.status
              )
                void refresh();
            })
            .catch(() => void refresh());
        else void refresh();
      }, 35);
    }
  };
  const createWatcher = (dir: string | string[]) => {
    const created = chokidar.watch(dir, watchOptions);
    created.on('all', onWatchEvent);
    return created;
  };
  let watcher = createWatcher(root);
  await refresh();
  app.get('/api/context', async (_req, res) => {
    await refresh();
    res.json(snapshot());
  });
  app.get('/api/events', (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
    clients.add(res);
    res.on('close', () => clients.delete(res));
  });
  const route = (name: string, fn: (body: any) => Promise<unknown>) =>
    app.post('/api/' + name, async (req, res, next) => {
      try {
        const data = await fn(req.body);
        await refresh();
        res.json(data ?? { ok: true });
      } catch (e) {
        next(e);
      }
    });
  app.get('/api/runtime/session', (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return void res.status(403).json({ error: '拒絕跨網站讀取' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ token: sessionToken });
  });
  app.get('/api/runtime/state', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.state(root));
    } catch (e) {
      next(e);
    }
  });
  route('runtime/environment', () => runtime.checkEnvironment(root));
  route('runtime/job', (b) => runtime.start(root, b));
  route('runtime/cancel', async (b) => {
    runtime.cancel(b.id);
    return { ok: true };
  });
  route('runtime/scan', () => runtime.devices.scan());
  route('runtime/board', (b) => runtime.switchBoard(root, b));
  route('runtime/button-template', (b) => runtime.loadButton(root, b));
  route('runtime/monitor/start', async (b) =>
    runtime.devices.startMonitor(
      b.port,
      Number(b.baud),
      (await capture(root)).source.dependencies.fqbn,
    ),
  );
  route('runtime/monitor/stop', () => runtime.devices.stopMonitor());
  route('runtime/monitor/clear', async () => runtime.devices.clearMonitor());
  route('runtime/simulation/stop', () => runtime.stopSimulation());
  route('runtime/simulation/reset', () => runtime.resetSimulation(root));
  route('runtime/simulation/prepare', (b) => runtime.prepareEsp32(root, b));
  route('runtime/simulation/restore-startup', (b) => runtime.restoreEsp32Startup(root, b));
  route('runtime/simulation/control', (b) => runtime.controlSimulation(root, b.action, b.value));
  route('runtime/simulation/serial', async (b) => runtime.sendSimulationSerial(root, b.text));
  route('runtime/simulation/sensor', (b) => runtime.setSimulationSensor(root, b.id, b.values));
  app.get('/api/runtime/simulation/vcd', (_req, res, next) => {
    try {
      if (runtime.simulationRoot !== root || !runtime.simulation) throw new Error('沒有此專案模擬');
      res.type('text/plain').attachment('OpenCircuit-logic.vcd').send(runtime.simulation.vcd());
    } catch (e) {
      next(e);
    }
  });
  route('runtime/simulation/input', async (b) => {
    if (runtime.simulationRoot !== root || !runtime.simulation) throw new Error('没有此專案模擬');
    if (typeof b.pressed !== 'boolean') throw new Error('輸入需為 boolean');
    runtime.simulation.button(b.id, b.pressed);
    return { ok: true };
  });
  app.get('/api/runtime/export/:id', async (req, res, next) => {
    try {
      if (!/^job_[a-f0-9]{32}$/.test(req.params.id)) throw new Error('無效匯出 ID');
      const file = await safePath(root, '.hw/exports/' + req.params.id + '.zip');
      res.download(file, 'OpenCircuit-Wokwi.zip');
    } catch (e) {
      next(e);
    }
  });
  void runtime.checkEnvironment(root).catch(() => {});
  route('save', (b) =>
    edits.record(root, () => saveFiles(root, b.files, b.expectedDigest, b.baseRevision)),
  );
  app.get('/api/edits', async (_req, res, next) => {
    try {
      res.json(await edits.state(root));
    } catch (error) {
      next(error);
    }
  });
  route('edits/undo', (b) => edits.move(root, 'undo', b.expectedDigest, b.baseRevision));
  route('edits/redo', (b) => edits.move(root, 'redo', b.expectedDigest, b.baseRevision));
  route('edit', async (b) => {
    if (!Array.isArray(b.ids) || !b.ids.every((id: unknown) => typeof id === 'string'))
      throw new Error('選取項目格式錯誤');
    const cap = await capture(root);
    let patch: Record<string, string | null>;
    if (b.action === 'copy') patch = duplicateSelection(cap.source, b.ids);
    else if (b.action === 'delete') patch = deleteSelection(cap.source, b.ids, b.netId, b.branch);
    else if (b.action === 'arrange')
      patch = { 'layout.json': json(arrangeWires(cap.source, b.netId, b.branch)) };
    else if (b.action === 'organize')
      patch = { 'layout.json': json(organizeWorkspace(cap.source)) };
    else if (b.action === 'rotate') {
      if (
        !b.ids.length ||
        b.ids.some(
          (id: string) => !cap.source.circuit.instances.some((instance) => instance.id === id),
        )
      )
        throw new Error('元件已不存在');
      const layout = { ...cap.source.layout };
      for (const id of b.ids)
        layout[id] = {
          ...(layout[id] ?? { x: 100, y: 100 }),
          rotation: (((layout[id]?.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270,
        };
      patch = { 'layout.json': json(layout) };
    } else throw new Error('不支援的編輯命令');
    return edits.record(root, () => saveFiles(root, patch, b.expectedDigest, b.baseRevision));
  });
  app.post('/api/export', async (req, res, next) => {
    try {
      const result = await exportSnapshot(
        root,
        req.body.kind,
        req.body.expectedDigest,
        req.body.baseRevision,
      );
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="OpenCircuit-${req.body.kind}.zip"`,
      );
      res.setHeader('X-OpenCircuit-Source-Digest', result.sourceDigest);
      res.send(Buffer.from(result.bytes));
    } catch (error) {
      next(error);
    }
  });
  route('check', () =>
    inspect(root, false, {}, runtime.environmentFor(root)?.fingerprint ?? undefined),
  );
  route('build', () => inspect(root, true));
  route('apply', (b) => applyRevision(root, b.revision));
  route('rollback', (b) => {
    if (!b.expectedDigest || !b.baseRevision)
      throw new Error('還原需要 expectedDigest 與 baseRevision');
    return rollback(root, b.revision, b.expectedDigest, b.baseRevision);
  });
  route('diff', (b) => diffRevision(root, b.revision));
  route('selection', (b) => setSelection(root, b.target));
  route('custom', (b) => addCustom(root, b.definition, b.expectedDigest));
  route('template', (b) => replaceTemplate(root, b.profile, b.expectedDigest));
  route('replace', (b) =>
    replaceComponent(root, b.instanceId, b.typeId, b.version, b.expectedDigest),
  );
  app.get('/api/projects', async (_req, res, next) => {
    try {
      res.json({
        projects: await listProjects(projectWorkspace),
        activeFolder: path.basename(root),
      });
    } catch (error) {
      next(error);
    }
  });
  route('projects/create', (body) =>
    createWorkspaceProject(projectWorkspace, body.name, body.profile),
  );
  route('projects/rename', (body) => {
    if (runtime.busy()) throw new Error('工作進行中，請完成後再改名');
    return renameWorkspaceProject(projectWorkspace, body);
  });
  route('projects/copy', (body) => copyWorkspaceProject(projectWorkspace, body));
  async function switchProject(real: string) {
    await recover(real);
    await ensureAgentFiles(real);
    await getContext(real);
    await runtime.stopSimulation();
    await runtime.devices.stopMonitor();
    runtime.resetEnvironment();
    watcher.unwatch(root);
    root = real;
    void runtime.checkEnvironment(root).catch(() => {});
    watcher.add(root);
    lastGood = null;
  }
  route('projects/delete', async (body) => {
    if (runtime.busy()) throw new Error('工作進行中，請完成後再刪除');
    const target = await projectPath(projectWorkspace, body.folder);
    const active = target === (await fs.realpath(root));
    if (active) {
      // The folder cannot be moved while the simulator, serial monitor or watcher uses it.
      // On Windows a watched directory is locked, so the watcher is closed and recreated.
      await runtime.stopSimulation();
      await runtime.devices.stopMonitor();
      await watcher.close();
    }
    let deleted;
    try {
      deleted = await deleteWorkspaceProject(projectWorkspace, body);
    } catch (error) {
      if (active) watcher = createWatcher(root);
      throw error;
    }
    if (active) {
      watcher = createWatcher([]);
      // The service always has an open project, so continue with the newest remaining one,
      // or a new blank one when the last project was deleted.
      const remaining = (await listProjects(projectWorkspace)).find((project) => !project.error);
      const folder =
        remaining?.folder ?? (await createWorkspaceProject(projectWorkspace, '我的專案')).folder;
      await switchProject(await projectPath(projectWorkspace, folder));
    }
    return { ...deleted, activeFolder: path.basename(root) };
  });
  // Opening is restricted to a configured workspace, independent of browser-provided paths.
  route('project', async (b) => {
    if (runtime.busy()) throw new Error('工具工作進行中，請先等待或取消再開啟其他專案');
    if (typeof b.name !== 'string' || !/^[A-Za-z0-9_\-\u3400-\u9fff ]{1,80}$/.test(b.name))
      throw new Error('專案資料夾名稱無效');
    const next = await safePath(projectWorkspace, b.name);
    if (b.create) await initProject(next, b.name, b.profile ?? 'led');
    const real = await projectPath(projectWorkspace, b.name);
    await switchProject(real);
    return { root };
  });
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/web');
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '找不到這項功能，請更新並重新啟動專案服務。' });
  });
  app.use(express.static(web));
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res
        .status((error as any).code === 'CONFLICT' ? 409 : 400)
        .json({ error: error.message, code: (error as any).code ?? 'INVALID' });
    },
  );
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });
  return {
    app,
    server,
    refresh,
    get root() {
      return root;
    },
    close: async () => {
      await runtime.close();
      clearTimeout(timer);
      for (const c of clients) c.end();
      await watcher.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
