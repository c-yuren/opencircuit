import path from 'node:path';
import fs from 'node:fs/promises';
import type { Snapshot } from './model';
import { arduino, getAsciiPath } from './environment';
import type { ProcessOptions } from './process';
import { validBuildArtifacts } from './compiler';
import { safePath, atomicWrite, json } from './files';
import { digest } from './analysis';
export interface Device {
  address: string;
  label: string;
  protocol: 'serial';
  boards: { name: string; fqbn: string }[];
}
export const allowedBauds = [9600, 19200, 38400, 57600, 115200, 230400];
export class Devices {
  devices: Device[] = [];
  warnings: string[] = [];
  busyPort: string | null = null;
  monitor = { state: 'stopped', port: '', baud: 115200, output: '', stderr: '' };
  private monitorAbort?: AbortController;
  private monitorDone?: Promise<unknown>;
  constructor(
    readonly tool: typeof arduino = arduino,
    // Upload tools, like the compiler, cannot handle non-ASCII paths on Windows.
    readonly toolPath: (target: string) => string = getAsciiPath,
  ) {}
  async scan(options: ProcessOptions = {}) {
    const r = await this.tool(['board', 'list', '--format', 'json'], {
      ...options,
      timeout: 30000,
    });
    if (r.exitCode !== 0) throw new Error('裝置掃描失敗：' + r.stderr);
    const data = JSON.parse(r.stdout);
    this.warnings = data.warnings ?? [];
    this.devices = (data.detected_ports ?? [])
      .filter(
        (x: any) =>
          x.port?.protocol === 'serial' &&
          /^(COM[1-9][0-9]*|\/dev\/(tty|cu\.)[A-Za-z0-9_.-]+)$/.test(x.port.address),
      )
      .map((x: any) => ({
        address: x.port.address,
        label: x.port.label ?? x.port.address,
        protocol: 'serial',
        boards: (x.matching_boards ?? []).map((b: any) => ({ name: b.name, fqbn: b.fqbn })),
      }));
    return { devices: this.devices, warnings: this.warnings };
  }
  async selected(port: string, fqbn?: string) {
    await this.scan();
    const d = this.devices.find((d) => d.address === port);
    if (!d) throw new Error('裝置不存在、已拔除或未取得掃描權限；請重新掃描');
    if (fqbn && d.boards.length && !d.boards.some((b) => b.fqbn === fqbn))
      throw new Error('偵測板型與專案 FQBN 不一致，請核對板型');
    return d;
  }
  // Monitor start/stop mutate shared lifecycle state across awaits; run them one at a time so
  // a concurrent start cannot overwrite (and orphan) the other's abort controller.
  private monitorQueue: Promise<unknown> = Promise.resolve();
  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.monitorQueue.then(task);
    this.monitorQueue = run.catch(() => undefined);
    return run;
  }
  startMonitor(port: string, baud: number, fqbn: string) {
    return this.serialized(() => this.startMonitorExclusive(port, baud, fqbn));
  }
  stopMonitor() {
    return this.serialized(() => this.stopMonitorExclusive());
  }
  private async startMonitorExclusive(port: string, baud: number, fqbn: string) {
    if (!allowedBauds.includes(baud)) throw new Error('不支援此 baud rate');
    if (this.busyPort) throw new Error('燒錄占用序列埠');
    await this.selected(port, fqbn);
    if (this.busyPort) throw new Error('燒錄占用序列埠');
    await this.stopMonitorExclusive();
    if (this.busyPort) throw new Error('燒錄占用序列埠');
    this.monitor = { state: 'starting', port, baud, output: '', stderr: '' };
    const abort = new AbortController();
    this.monitorAbort = abort;
    this.monitorDone = this.tool(
      [
        'monitor',
        '--port',
        port,
        '--protocol',
        'serial',
        '--fqbn',
        fqbn,
        '--config',
        'baudrate=' + baud,
        '--quiet',
      ],
      {
        signal: abort.signal,
        timeout: 24 * 60 * 60 * 1000,
        onOutput: (channel, text) => {
          if (this.monitorAbort !== abort) return;
          if (channel === 'stdout') {
            this.monitor.state = 'connected';
            this.monitor.output = (this.monitor.output + text).slice(-1_000_000);
          } else this.monitor.stderr = (this.monitor.stderr + text).slice(-100_000);
        },
      },
    ).then((r) => {
      if (this.monitorAbort === abort) {
        this.monitor.state = abort.signal.aborted ? 'stopped' : 'disconnected';
        if (!abort.signal.aborted) this.monitor.stderr += r.stderr || '序列工具結束／裝置斷線';
      }
    });
    return this.monitor;
  }
  private async stopMonitorExclusive() {
    this.monitorAbort?.abort();
    await this.monitorDone;
    this.monitorAbort = undefined;
    this.monitorDone = undefined;
    this.monitor.state = 'stopped';
  }
  clearMonitor() {
    this.monitor.output = '';
    this.monitor.stderr = '';
  }
  async upload(
    root: string,
    jobId: string,
    snapshot: Snapshot,
    port: string,
    options: ProcessOptions = {},
  ) {
    if (this.busyPort) throw new Error('另一個燒錄工作占用序列埠');
    if (
      snapshot.build.state !== 'pass' ||
      snapshot.status === 'conflict' ||
      snapshot.diagnostics.some((d) => d.state === 'fail')
    )
      throw new Error('檢查／編譯失敗，不執行燒錄');
    if (!(await validBuildArtifacts(root, snapshot.build)))
      throw new Error('韌體產物遺失或 SHA-256 不符');
    const device = await this.selected(port, snapshot.build.fqbn),
      restore =
        this.monitor.port === port && ['starting', 'connected'].includes(this.monitor.state)
          ? { baud: this.monitor.baud }
          : null;
    if (this.busyPort) throw new Error('另一個燒錄工作占用序列埠');
    this.busyPort = port;
    const record: any = {
      id: jobId,
      sourceRevision: snapshot.id,
      baseRevision: snapshot.baseRevision,
      sourceDigest: snapshot.sourceDigest,
      board: snapshot.build.fqbn,
      device,
      artifacts: snapshot.build.artifacts,
      startedAt: new Date().toISOString(),
      state: 'failed',
    };
    try {
      await this.stopMonitor();
      const folder = '.hw/uploads/' + jobId + '/artifacts';
      const input = await safePath(root, folder, true);
      await fs.mkdir(input, { recursive: true });
      for (const a of snapshot.build.artifacts) {
        const bytes = await fs.readFile(await safePath(root, a.path));
        if (digest(bytes) !== a.sha256) throw new Error('燒錄前產物 SHA-256 不符');
        await fs.writeFile(await safePath(root, folder + '/' + path.basename(a.path), true), bytes);
      }
      if (options.signal?.aborted) throw new Error('燒錄已取消');
      options.onOutput?.('stdout', '燒錄已檢查的相同韌體產物至 ' + port + '\n');
      const result = await this.tool(
        [
          'upload',
          '--fqbn',
          snapshot.build.fqbn,
          '--port',
          port,
          '--protocol',
          'serial',
          '--input-dir',
          this.toolPath(input),
        ],
        { ...options, timeout: 120000 },
      );
      Object.assign(record, result, {
        state: result.cancelled
          ? 'cancelled'
          : result.timedOut
            ? 'timeout'
            : result.exitCode === 0
              ? 'pass'
              : 'fail',
        finishedAt: new Date().toISOString(),
      });
      if (result.exitCode !== 0 || result.cancelled || result.timedOut)
        throw new Error(result.stderr || '燒錄失敗；請檢查埠占用、USB、權限及 BOOT 按鈕');
      return record;
    } catch (e) {
      record.error = (e as Error).message;
      record.finishedAt = new Date().toISOString();
      throw e;
    } finally {
      this.busyPort = null;
      await atomicWrite(root, '.hw/uploads/' + jobId + '/record.json', json(record));
      await atomicWrite(root, '.hw/last-upload-attempt.json', json(record));
      if (record.state === 'pass') await atomicWrite(root, '.hw/last-upload.json', json(record));
      if (restore && !options.signal?.aborted) {
        try {
          await this.startMonitor(port, restore.baud, snapshot.build.fqbn);
        } catch (e) {
          this.monitor.state = 'disconnected';
          this.monitor.stderr += (e as Error).message;
        }
      }
    }
  }
}
