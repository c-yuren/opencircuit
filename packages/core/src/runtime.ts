import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { environment, installMissing } from './environment';
import {
  capture,
  safePath,
  atomicWrite,
  json,
  sourcePatch,
  withLock,
  lockProject,
  unlockProject,
  changedSources,
  projectLock,
  ProjectLockedError,
} from './files';
import { getContext, inspect, current, saveFiles, ConflictError } from './project';
import { changeBoard, BUTTON_FIRMWARE } from './boards';
import { example } from './catalog';
import { Devices } from './devices';
import { AvrSimulation, simulationPlan, wokwiDiagram } from './simulation';
import { Esp32Simulation, esp32EngineInstalled } from './esp32-simulation';
import type { SimulationAdapter } from './digital-simulation';
import { ESP32_DIGITAL_STARTUP, ESP32_STARTUP_FILE, isEsp32DigitalStartup } from './esp32-startup';
import { validBuildArtifacts } from './compiler';
import type { Source, Snapshot } from './model';
export type JobKind = 'install' | 'compile' | 'upload' | 'simulate' | 'export';
export interface RuntimeJob {
  id: string;
  kind: JobKind;
  state: 'running' | 'pass' | 'fail' | 'cancelled';
  phase: string;
  startedAt: string;
  finishedAt?: string;
  log: string;
  error?: string;
  result?: any;
  root: string;
  sourceDigest: string;
  baseRevision: string;
  port?: string;
}
export class Runtime {
  jobs: RuntimeJob[] = [];
  readonly devices = new Devices();
  private aborts = new Map<string, AbortController>();
  private starting = false;
  private controlling = false;
  simulation: SimulationAdapter | null = null;
  simulationSnapshot: Snapshot | null = null;
  simulationRoot: string | null = null;
  simulationId: string | null = null;
  environmentResult: Awaited<ReturnType<typeof environment>> | null = null;
  busy() {
    return this.starting || this.controlling || this.jobs.some((j) => j.state === 'running');
  }
  // Polled several times per second by the UI; reads only the sources, not history or reports.
  async state(root: string) {
    const ctx = await capture(root),
      lastUpload = await fs
        .readFile(await safePath(root, '.hw/last-upload.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
    return {
      service: 'connected',
      projectRoot: root,
      environment: this.environmentFor(root),
      jobs: this.jobs.filter((j) => j.root === root).slice(-10),
      devices: this.devices.devices,
      deviceWarnings: this.devices.warnings,
      monitor: this.devices.monitor,
      lastUpload,
      simulationPlan: simulationPlan(ctx.source),
      // True while any process (this service or a headless `hw simulate`) has frozen the sources.
      simulationLocked: !!(await projectLock(root)),
      simulationExternalChange: this.simulationRoot === root ? this.externalChange : null,
      esp32Engine: { installed: esp32EngineInstalled() },
      simulation:
        this.simulationRoot === root
          ? {
              ...this.simulation?.state(),
              snapshot: this.simulationSnapshot?.id,
              sourceDigest: this.simulationSnapshot?.sourceDigest,
              stale: this.simulationSnapshot?.sourceDigest !== ctx.sourceDigest,
            }
          : null,
    };
  }
  // Environment results belong to one project root. A check that finishes after the project
  // was switched (or the result was reset) is returned to its caller but not published.
  environmentRoot: string | null = null;
  private environmentSeq = 0;
  environmentFor(root: string) {
    return this.environmentRoot === root ? this.environmentResult : null;
  }
  resetEnvironment() {
    this.environmentSeq++;
    this.environmentResult = null;
    this.environmentRoot = null;
  }
  async checkEnvironment(root: string) {
    const seq = ++this.environmentSeq;
    const result = await environment((await capture(root)).source);
    if (seq === this.environmentSeq) {
      this.environmentResult = result;
      this.environmentRoot = root;
    }
    return result;
  }
  // Finished jobs keep their (up to 1 MB) logs on disk; memory keeps the recent ones only.
  static readonly MAX_FINISHED_JOBS = 50;
  private pruneJobs() {
    const finished = this.jobs.filter((j) => j.state !== 'running');
    const excess = new Set(finished.slice(0, -Runtime.MAX_FINISHED_JOBS));
    if (excess.size) this.jobs = this.jobs.filter((j) => !excess.has(j));
  }
  async expect(root: string, body: { expectedDigest: string; baseRevision: string }) {
    const cap = await capture(root),
      c = await current(root);
    if (cap.sourceDigest !== body.expectedDigest || c.revision !== body.baseRevision)
      throw new ConflictError('來源或專案版本已更新；重新載入後重試');
    return cap;
  }
  async start(
    root: string,
    body: { kind: JobKind; expectedDigest: string; baseRevision: string; port?: string },
  ) {
    if (!['install', 'compile', 'upload', 'simulate', 'export'].includes(body.kind))
      throw new Error('不支援的工作');
    if (this.busy()) throw new Error('工具工作進行中，請先等待或取消');
    this.starting = true;
    try {
      const cap = await this.expect(root, body);
      if (body.kind === 'upload' && !body.port) throw new Error('請明確選擇要燒錄的裝置');
      if (body.kind === 'simulate') {
        const p = simulationPlan(cap.source);
        if (!p.supported) throw new Error(p.reasons.join('\n'));
      }
      if (body.kind === 'export') wokwiDiagram(cap.source);
      const job: RuntimeJob = {
        id: 'job_' + randomUUID().replaceAll('-', ''),
        kind: body.kind,
        sourceDigest: body.expectedDigest,
        baseRevision: body.baseRevision,
        port: body.port,
        state: 'running',
        phase: '已建立工作',
        startedAt: new Date().toISOString(),
        log: '',
        root,
      };
      const abort = new AbortController();
      this.jobs.push(job);
      this.pruneJobs();
      this.aborts.set(job.id, abort);
      void this.execute(job, body, cap.source, abort);
      return job;
    } finally {
      this.starting = false;
    }
  }
  private async execute(job: RuntimeJob, body: any, source: Source, abort: AbortController) {
    const options = {
      signal: abort.signal,
      onOutput: (channel: 'stdout' | 'stderr', text: string) => {
        job.log = (job.log + text).slice(-1_000_000);
      },
    };
    try {
      if (job.kind === 'install') {
        job.phase = '檢查並安裝官方鎖定套件';
        job.result = await installMissing(source, options);
        this.environmentSeq++;
        this.environmentResult = job.result;
        this.environmentRoot = job.root;
      } else {
        job.phase = '資料與電氣檢查 → 真實 Arduino CLI 編譯';
        const snapshot = await inspect(job.root, true, options);
        job.result = { snapshot: snapshot.id, build: snapshot.build };
        if (abort.signal.aborted) throw new Error('工作已取消');
        if (snapshot.build.state !== 'pass' || snapshot.status === 'conflict')
          throw new Error(snapshot.build.reason ?? '編譯／電氣檢查失敗或來源已更新');
        await this.expect(job.root, body);
        if (job.kind === 'upload') {
          job.phase = '釋放序列監看 → 燒錄相同產物';
          job.result = await this.devices.upload(job.root, job.id, snapshot, body.port, options);
        }
        if (job.kind === 'simulate') {
          job.phase = '載入已編譯韌體 → 執行本機 MCU';
          if (!(await validBuildArtifacts(job.root, snapshot.build)))
            throw new Error('模擬產物 SHA-256 不符');
          abort.signal.throwIfAborted();
          await this.stopSimulation();
          abort.signal.throwIfAborted();
          const plan = simulationPlan(source);
          let artifact;
          if (plan.mode === 'local-esp32-qemu') {
            this.simulation = await Esp32Simulation.create(
              job.root,
              source,
              snapshot,
              plan,
              abort.signal,
            );
            artifact = snapshot.build.artifacts.find((a) => a.path.endsWith('.ino.merged.bin'));
          } else {
            artifact = snapshot.build.artifacts.find((a) => a.path.endsWith('.ino.hex'));
            if (!artifact) throw new Error('沒有可用的 AVR HEX 產物');
            this.simulation = new AvrSimulation(
              await fs.readFile(await safePath(job.root, artifact.path), 'utf8'),
              plan,
            );
          }
          if (abort.signal.aborted) {
            await this.simulation.stop();
            throw new Error('工作已取消');
          }
          this.simulationSnapshot = snapshot;
          this.simulationRoot = job.root;
          this.simulationId = job.id;
          this.simulation.start();
          await this.saveSimulation();
          await this.acquireLock(job.root);
          abort.signal.throwIfAborted();
          job.result = {
            snapshot: snapshot.id,
            artifact,
            adapter: this.simulation.adapter,
            mode: '完全本機',
          };
        }
        if (job.kind === 'export') {
          job.phase = '匯出外部 Wokwi 專案';
          const files: Record<string, Uint8Array> = {
            'diagram.json': strToU8(json(wokwiDiagram(source))),
            'sketch.ino': strToU8(source.firmware),
            'pinmap.h': strToU8((await import('./analysis')).generatePinmap(source)),
            'libraries.txt': strToU8(
              source.dependencies.libraries.map((l) => l.name + '@' + l.version).join('\n'),
            ),
            'source-snapshot.json': strToU8(json(snapshot)),
            'README.txt': strToU8(
              '外部 Wokwi；需要網路。Wokwi CI／VS Code 依官方方案需要 token／授權。未在 OpenCircuit 內自動執行雲端模擬。參閱 https://docs.wokwi.com/wokwi-ci/getting-started\n啟動前核對 diagram.json 的板型、元件及接腳。韌體與 ELF 來自相同編譯快照。\n',
            ),
          };
          for (const [name, text] of Object.entries(source.extraFirmware))
            files[name.replace('firmware/main/', '')] = strToU8(text);
          if (!(await validBuildArtifacts(job.root, snapshot.build)))
            throw new Error('匯出產物 SHA-256 不符');
          for (const artifact of snapshot.build.artifacts)
            files['build/' + path.basename(artifact.path)] = new Uint8Array(
              await fs.readFile(await safePath(job.root, artifact.path)),
            );
          const firmware =
            source.dependencies.fqbn === 'arduino:avr:uno' ? 'main.ino.hex' : 'main.ino.bin';
          files['wokwi.toml'] = strToU8(
            `[wokwi]\nversion = 1\nfirmware = "build/${firmware}"\nelf = "build/main.ino.elf"\n`,
          );
          const dest = await safePath(job.root, '.hw/exports/' + job.id + '.zip', true);
          await fs.writeFile(dest, zipSync(files));
          job.result = {
            snapshot: snapshot.id,
            download: '/api/runtime/export/' + job.id,
            mode: '外部雲端匯出，需要網路；沒有雲端執行結果',
          };
        }
      }
      job.state = abort.signal.aborted ? 'cancelled' : 'pass';
      job.phase = job.state === 'pass' ? '完成' : '已取消';
    } catch (e) {
      if (job.kind === 'simulate' && this.simulationId === job.id) await this.stopSimulation();
      job.state = abort.signal.aborted ? 'cancelled' : 'fail';
      job.error = (e as Error).message;
      job.phase = job.state === 'cancelled' ? '已取消' : '失敗';
    } finally {
      job.finishedAt = new Date().toISOString();
      this.aborts.delete(job.id);
      await atomicWrite(job.root, '.hw/runtime/jobs/' + job.id + '.json', json(job)).catch((e) => {
        job.log += '\n保存工作紀錄失敗：' + e.message;
      });
    }
  }
  cancel(id: string) {
    const abort = this.aborts.get(id);
    if (!abort) throw new Error('工作已結束或不存在');
    abort.abort();
  }
  async saveSimulation() {
    if (this.simulation && this.simulationRoot && this.simulationId)
      await atomicWrite(
        this.simulationRoot,
        '.hw/simulations/' + this.simulationId + '.json',
        json({
          snapshot: this.simulationSnapshot,
          adapter: this.simulation.adapter,
          ...this.simulation.state(),
        }),
      );
  }
  async stopSimulation(keepLock = false) {
    await this.simulation?.stop();
    await this.saveSimulation();
    if (!keepLock) await this.releaseLock();
  }
  // A running simulation freezes the project sources (see files.ts). The lock follows the
  // simulation: it is taken when one starts and released when it stops or ends by itself.
  private lockTimer: ReturnType<typeof setInterval> | undefined;
  private lockedRoot: string | null = null;
  private frozenSources: Record<string, string> = {};
  // Set when the sources were changed behind the service's back and that ended the simulation.
  externalChange: { names: string[]; at: string } | null = null;
  private checkingSources = false;
  private async acquireLock(root: string) {
    this.frozenSources = await withLock(root, () => lockProject(root));
    this.lockedRoot = root;
    this.externalChange = null;
    this.lockTimer ??= setInterval(() => {
      const locked = this.lockedRoot;
      if (this.controlling || this.checkingSources || !locked) return;
      if (!this.simulation?.running) return void this.releaseLock().catch(() => {});
      this.checkingSources = true;
      void changedSources(locked, this.frozenSources)
        .then(async (names) => {
          if (!names.length || !this.simulation?.running) return;
          // Edits through the service are refused; a write that went around it (an editor, an
          // agent) cannot be, so the simulation, which no longer matches the sources, ends.
          this.externalChange = { names, at: new Date().toISOString() };
          this.simulation.error =
            '專案檔案在模擬中被修改（' + names.join('、') + '），模擬已停止；請重新編譯並開始';
          await this.stopSimulation();
        })
        .catch(() => {})
        .finally(() => {
          this.checkingSources = false;
        });
    }, 500);
    this.lockTimer.unref();
  }
  private async releaseLock() {
    clearInterval(this.lockTimer);
    this.lockTimer = undefined;
    const root = this.lockedRoot;
    this.lockedRoot = null;
    this.frozenSources = {};
    if (root) await withLock(root, () => unlockProject(root, process.pid));
  }
  // Operations here stop the simulation before they edit; while one runs they are refused instead.
  private assertNotSimulating(root: string) {
    if (this.simulationRoot === root && this.simulation?.running) throw new ProjectLockedError();
  }
  async resetSimulation(root: string) {
    if (this.busy()) throw new Error('工具工作進行中，請先等待或取消');
    this.controlling = true;
    try {
      if (!this.simulationSnapshot || this.simulationRoot !== root)
        throw new Error('沒有此專案模擬');
      const ctx = await getContext(root);
      if (ctx.sourceDigest !== this.simulationSnapshot.sourceDigest)
        throw new ConflictError('來源已更新，請重新編譯並開始');
      if (!(await validBuildArtifacts(root, this.simulationSnapshot.build)))
        throw new Error('產物已變動');
      await this.stopSimulation(true); // the project stays frozen across a reset
      const plan = simulationPlan(ctx.source);
      if (plan.mode === 'local-esp32-qemu')
        this.simulation = await Esp32Simulation.create(
          root,
          ctx.source,
          this.simulationSnapshot,
          plan,
        );
      else {
        const hex = this.simulationSnapshot.build.artifacts.find((a) =>
          a.path.endsWith('.ino.hex'),
        )!;
        this.simulation = new AvrSimulation(
          await fs.readFile(await safePath(root, hex.path), 'utf8'),
          plan,
        );
      }
      this.simulation.start();
      await this.saveSimulation();
    } catch (error) {
      await this.releaseLock(); // the reset did not bring a simulation back
      throw error;
    } finally {
      this.controlling = false;
    }
  }
  async prepareEsp32(root: string, body: { expectedDigest: string; baseRevision: string }) {
    this.assertNotSimulating(root);
    if (this.busy()) throw new Error('請先等待工具工作完成');
    const cap = await this.expect(root, body);
    if (cap.source.dependencies.fqbn !== 'esp32:esp32:esp32') throw new Error('此設定只支援 ESP32');
    const dependencies = {
      ...cap.source.dependencies,
      buildProperties: [
        ...cap.source.dependencies.buildProperties.filter(
          (p) => !/^build\.(boot|flash_mode|flash_size)=/.test(p),
        ),
        'build.boot=dio',
        'build.flash_mode=dio',
        'build.flash_size=4MB',
      ],
    };
    const existing = cap.source.extraFirmware[ESP32_STARTUP_FILE];
    if (existing && !isEsp32DigitalStartup(existing))
      throw new Error('同名啟動檔已存在；請先檢視並重新命名，避免覆蓋程式');
    return saveFiles(
      root,
      { 'dependencies.lock.json': json(dependencies), [ESP32_STARTUP_FILE]: ESP32_DIGITAL_STARTUP },
      body.expectedDigest,
      body.baseRevision,
    );
  }
  async restoreEsp32Startup(root: string, body: { expectedDigest: string; baseRevision: string }) {
    this.assertNotSimulating(root);
    if (this.busy()) throw new Error('請先等待工具工作完成');
    const cap = await this.expect(root, body);
    if (!isEsp32DigitalStartup(cap.source.extraFirmware[ESP32_STARTUP_FILE]))
      throw new Error('沒有可移除的 OpenCircuit 數位啟動檔');
    return saveFiles(root, { [ESP32_STARTUP_FILE]: null }, body.expectedDigest, body.baseRevision);
  }
  async controlSimulation(root: string, action: string, value?: number) {
    if (this.busy()) throw new Error('工具工作進行中，請先等待或取消');
    if (this.simulationRoot !== root || !this.simulation?.running)
      throw new Error('沒有此專案模擬');
    this.controlling = true;
    try {
      if (action === 'pause') await this.simulation.pause();
      else if (action === 'resume') await this.simulation.resume();
      else if (action === 'step') await this.simulation.step();
      else if (action === 'speed') await this.simulation.setSpeed(value!);
      else throw new Error('不支援的模擬控制');
      await this.saveSimulation();
    } finally {
      this.controlling = false;
    }
  }
  async setSimulationSensor(root: string, id: unknown, values: unknown) {
    if (this.simulationRoot !== root || !this.simulation?.running)
      throw new Error('沒有此專案模擬');
    if (!this.simulation.setSensor) throw new Error('此模擬引擎尚未支援感測器輸入');
    if (typeof id !== 'string' || !values || typeof values !== 'object' || Array.isArray(values))
      throw new Error('感測器輸入格式錯誤');
    await this.simulation.setSensor(id, values as Record<string, unknown>);
    return { ok: true };
  }
  async sendSimulationSerial(root: string, text: string) {
    if (this.busy() || this.simulationRoot !== root || !this.simulation?.running)
      throw new Error('沒有可接收輸入的執行中模擬');
    await this.simulation.sendSerial(text);
    return { ok: true };
  }
  async switchBoard(root: string, body: any) {
    this.assertNotSimulating(root);
    if (this.busy()) throw new Error('工作進行中，不能切換板型');
    const cap = await this.expect(root, body),
      next = changeBoard(cap.source, body.fqbn);
    await this.stopSimulation();
    await this.devices.stopMonitor();
    this.resetEnvironment();
    const patch = sourcePatch(next, cap.files['AGENTS.md']);
    for (const name of Object.keys(cap.source.extraFirmware))
      if (!(name in next.extraFirmware)) patch[name] = null;
    const saved = await saveFiles(root, patch, body.expectedDigest, body.baseRevision);
    await this.checkEnvironment(root);
    return saved;
  }
  async loadButton(root: string, body: any) {
    this.assertNotSimulating(root);
    if (this.busy()) throw new Error('工具工作進行中');
    const cap = await this.expect(root, body);
    const s = changeBoard(example('led', cap.source.project.name), 'arduino:avr:uno');
    s.procurement = cap.source.procurement;
    s.custom = cap.source.custom;
    s.comments = cap.source.comments;
    s.project.profile = 'custom';
    s.firmware = BUTTON_FIRMWARE;
    s.circuit.instances.push({
      id: 'button1',
      typeId: 'official:button',
      definitionVersion: '1.0.0',
      parameters: {},
      quantity: 1,
    });
    s.layout.button1 = { x: 460, y: 320 };
    s.circuit.nets.push({
      id: 'button-input',
      name: 'BUTTON',
      endpoints: ['esp1.D2', 'button1.A'],
    });
    s.circuit.nets.find((n) => n.id === 'ground')!.endpoints.push('button1.B');
    s.circuit.bindings.push({ name: 'BUTTON_PIN', kind: 'digitalInput', endpoint: 'button1.A' });
    const patch = sourcePatch(s, cap.files['AGENTS.md']);
    for (const name of Object.keys(cap.source.extraFirmware)) patch[name] = null;
    await this.stopSimulation();
    await this.devices.stopMonitor();
    this.resetEnvironment();
    await saveFiles(root, patch, body.expectedDigest, body.baseRevision);
    await this.checkEnvironment(root);
  }
  async close() {
    for (const a of this.aborts.values()) a.abort();
    await this.stopSimulation();
    await this.devices.stopMonitor();
  }
}
