#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../apps/server/index';
import {
  initProject,
  getContext,
  current,
  inspect,
  applyRevision,
  rollback,
  diffRevision,
  recover,
} from '../core/src/project';
import { capture, atomicWrite, json } from '../core/src/files';
import { calculateBom } from '../core/src/analysis';
import { environment, installMissing } from '../core/src/environment';
import { Runtime } from '../core/src/runtime';
import { runSimulationScenario } from '../core/src/simulation-scenario';
const argv = process.argv.slice(2);
const projectArg = argv.indexOf('--project');
const root = path.resolve(projectArg >= 0 ? argv[projectArg + 1] : process.cwd());
if (projectArg >= 0) argv.splice(projectArg, 2);
const asJson = argv.includes('--json');
// --brief prints only what an agent needs to decide the next step; full records stay in .hw/.
const brief = argv.includes('--brief');
const args = argv.filter((a) => a !== '--json' && a !== '--brief');
const [cmd, arg] = args;
const output = (v: unknown) => process.stdout.write(json(v));
const tail = (text: string, lines = 30) => text.trim().split('\n').slice(-lines).join('\n');
function briefContext(c: Awaited<ReturnType<typeof getContext>>) {
  return {
    root: c.root,
    project: {
      name: c.source.project.name,
      board: c.source.project.board,
      profile: c.source.project.profile,
    },
    current: { revision: c.current.revision, draft: c.current.draft, status: c.current.status },
    sourceDigest: c.sourceDigest,
    instances: c.source.circuit.instances.map((i) => ({ id: i.id, typeId: i.typeId })),
    nets: c.source.circuit.nets.map((n) => ({ id: n.id, endpoints: n.endpoints })),
    bindings: c.source.circuit.bindings,
    files: Object.keys(c.files),
    warnings: c.warnings,
  };
}
function briefSnapshot(r: Awaited<ReturnType<typeof inspect>>) {
  return {
    id: r.id,
    status: r.status,
    baseRevision: r.baseRevision,
    sourceDigest: r.sourceDigest,
    rulesPassed: r.diagnostics.filter((d) => d.state === 'pass').length,
    diagnostics: r.diagnostics
      .filter((d) => d.state !== 'pass')
      .map((d) => ({
        ruleId: d.ruleId,
        state: d.state,
        target: d.target,
        reason: d.reason,
        action: d.action,
      })),
    build: {
      state: r.build.state,
      reason: r.build.reason,
      exitCode: r.build.exitCode,
      fqbn: r.build.fqbn,
      cachedFrom: r.build.cachedFrom,
      // Arduino CLI localizes these two lines (e.g. "Sketch 使用 ... 位元組"), so match both.
      sizes: r.build.stdout
        .split('\n')
        .filter((l) => /^(Sketch (uses|使用)|Global variables|全域變數)/.test(l))
        .map((l) => l.trim()),
      errors: r.build.state === 'pass' ? undefined : tail(r.build.stderr || r.build.stdout) || undefined,
    },
  };
}
async function main() {
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  if (cmd === 'init') {
    if (!arg) throw new Error('用法：hw init <name> [--template led|oled|temperature]');
    const template = args[args.indexOf('--template') + 1];
    output(
      await initProject(
        path.resolve(root, arg),
        path.basename(arg),
        args.includes('--template') ? (template as any) : 'led',
      ),
    );
    return;
  }
  if (cmd === 'dev' || cmd === 'serve') {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    let selected = root;
    if (
      projectArg < 0 &&
      !(await fs
        .access(path.join(root, 'project.json'))
        .then(() => true)
        .catch(() => false))
    ) {
      selected = path.join(appRoot, '.local/projects/demo');
      if (
        !(await fs
          .access(path.join(selected, 'project.json'))
          .then(() => true)
          .catch(() => false))
      )
        await initProject(selected, 'OpenCircuit 實驗室');
    }
    if (args.includes('--install-tools')) {
      process.stdout.write('檢查並安裝目前專案的板子與模擬工具；首次下載可能需要數分鐘。\n');
      const setupLog = path.join(appRoot, '.local/setup-tools.log');
      await fs.mkdir(path.dirname(setupLog), { recursive: true });
      await fs.writeFile(setupLog, '');
      process.stdout.write(`詳細安裝記錄：${setupLog}\n`);
      const ready = await installMissing((await capture(selected)).source, {
        signal: abort.signal,
        onOutput: (channel, text) => {
          appendFileSync(setupLog, text);
          if (channel === 'stderr' || /^(arduino-cli |下載|安裝|解壓|驗證)/.test(text))
            process.stdout.write(text);
        },
      });
      if (!ready.compileReady) throw new Error('工具安裝尚未就緒，請檢查上方錯誤後重試。');
    }
    const port = Number(process.env.PORT ?? 4318);
    const service = await startServer(selected, port);
    if (cmd === 'serve') {
      process.stdout.write(`OpenCircuit 本機服務 http://127.0.0.1:${port}\nProject ${selected}\n`);
      if (args.includes('--open') && process.platform === 'win32') {
        const { spawn } = await import('node:child_process');
        const browser = spawn('explorer.exe', [`http://127.0.0.1:${port}/#workspace`], {
          stdio: 'ignore',
          detached: true,
        });
        browser.on('error', () => process.stderr.write('請用瀏覽器開啟上方本機網址。\n'));
        browser.unref();
      }
      const close = async () => {
        await service.close();
        process.exit();
      };
      process.on('SIGINT', close);
      process.on('SIGTERM', close);
      return;
    }
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: path.join(appRoot, 'vite.config.ts') });
    await vite.listen();
    process.stdout.write(
      `OpenCircuit http://127.0.0.1:5173\nAPI http://127.0.0.1:${port}\nProject ${selected}\n`,
    );
    const close = async () => {
      await vite.close();
      await service.close();
      process.exit();
    };
    process.on('SIGINT', close);
    process.on('SIGTERM', close);
    return;
  }
  if (
    ![
      'context',
      'check',
      'build',
      'bom',
      'diff',
      'apply',
      'rollback',
      'doctor',
      'install',
      'scan',
      'simulate',
      'upload',
      'export',
    ].includes(cmd)
  ) {
    process.stdout.write(
      'hw init <name> | dev | serve | doctor | install | scan | simulate | upload --port <device> | export | context | check | build | bom | diff <revision> | apply <revision> | rollback <revision>\nOptions: --project <directory>, --json, --brief (compact output for context/check/build/bom)\n',
    );
    process.exitCode = cmd ? 2 : 0;
    return;
  }
  await recover(root);
  if (cmd === 'doctor')
    output(await environment((await capture(root)).source, { signal: abort.signal }));
  if (cmd === 'install')
    output(
      await installMissing((await capture(root)).source, {
        signal: abort.signal,
        onOutput: (_c, t) => process.stderr.write(t),
      }),
    );
  if (['scan', 'simulate', 'upload', 'export'].includes(cmd)) {
    const runtime = new Runtime();
    process.on('SIGINT', () => void runtime.close());
    if (cmd === 'scan') {
      output(await runtime.devices.scan());
      await runtime.close();
      return;
    }
    const ctx = await getContext(root),
      job = await runtime.start(root, {
        kind: cmd === 'simulate' ? 'simulate' : cmd === 'upload' ? 'upload' : 'export',
        port: args[args.indexOf('--port') + 1],
        expectedDigest: ctx.sourceDigest,
        baseRevision: ctx.current.revision,
      });
    while (job.state === 'running') await new Promise((r) => setTimeout(r, 200));
    if (!(cmd === 'simulate' && args.includes('--headless') && job.state === 'pass')) output(job);
    if (job.state !== 'pass') process.exitCode = 1;
    if (cmd === 'simulate' && job.state === 'pass') {
      if (args.includes('--headless')) {
        try {
          const scenarioAt = args.indexOf('--scenario');
          const durationAt = args.indexOf('--duration');
          const steps =
            scenarioAt >= 0
              ? JSON.parse(await fs.readFile(args[scenarioAt + 1], 'utf8')).steps
              : [{ wait: durationAt >= 0 ? Number(args[durationAt + 1]) : 2 }];
          const report = await runSimulationScenario(runtime.simulation!, steps, 120000);
          const vcdAt = args.indexOf('--vcd');
          if (vcdAt >= 0) await fs.writeFile(args[vcdAt + 1], runtime.simulation!.vcd());
          output({
            ...report,
            sourceDigest: job.sourceDigest,
            snapshot: runtime.simulationSnapshot?.id,
          });
        } finally {
          await runtime.close();
        }
        return;
      }
      let length = 0;
      while (!abort.signal.aborted) {
        const log = runtime.simulation?.log ?? '';
        if (log.length > length) process.stderr.write(log.slice(length));
        length = log.length;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    await runtime.close();
    return;
  }
  if (cmd === 'context') {
    const c = await getContext(root);
    output(brief ? briefContext(c) : c);
  }
  if (cmd === 'bom') {
    const bom = calculateBom((await capture(root)).source);
    await atomicWrite(root, 'bom.json', json(bom));
    output(
      brief
        ? {
            currency: bom.currency,
            rows: bom.rows.map((x) => ({
              name: x.name,
              model: x.model,
              demand: x.demand,
              toBuy: x.toBuy,
              price: x.price,
            })),
            spend: bom.spend,
            incomplete: bom.incomplete,
            missing: bom.missing,
          }
        : bom,
    );
  }
  if (cmd === 'check' || cmd === 'build') {
    const r = await inspect(root, cmd === 'build', { signal: abort.signal });
    output(brief ? briefSnapshot(r) : r);
    if (r.status === 'conflict') process.exitCode = 3;
    else if (r.diagnostics.some((d) => d.state === 'fail') || r.build.state === 'fail')
      process.exitCode = 1;
    else if (
      r.diagnostics.some((d) => d.state === 'unknown') ||
      (cmd === 'build' && r.build.state !== 'pass')
    )
      process.exitCode = 2;
  }
  if (cmd === 'diff' || cmd === 'apply' || cmd === 'rollback') {
    if (!arg) throw new Error(`${cmd} 需要 revision`);
    if (cmd === 'diff') output(await diffRevision(root, arg));
    if (cmd === 'apply') output(await applyRevision(root, arg));
    if (cmd === 'rollback') {
      const cap = await capture(root);
      const c = await current(root);
      output(await rollback(root, arg, cap.sourceDigest, c.revision));
    }
  }
}
main().catch((e) => {
  if (asJson) output({ error: e.message, code: e.code ?? 'ERROR' });
  else process.stderr.write(e.message + '\n');
  process.exitCode = e.code === 'CONFLICT' ? 3 : 1;
});
