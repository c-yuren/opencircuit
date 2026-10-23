import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arduino, environment, getAsciiPath } from './environment';
import type { ProcessOptions } from './process';
import type { BuildResult, Source } from './model';
import { digest, electricalDigest, generatePinmap } from './analysis';
import { safePath, atomicWrite } from './files';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function notBuilt(s: Source, reason = '尚未執行 Arduino CLI'): BuildResult {
  return {
    state: 'not_run',
    version: null,
    fqbn: s.dependencies.fqbn,
    dependencies: s.dependencies,
    stdout: '',
    stderr: '',
    exitCode: null,
    inputDigest: electricalDigest(s),
    durationMs: 0,
    artifacts: [],
    startedAt: new Date().toISOString(),
    reason,
  };
}
export async function command(
  args: string[],
  timeout = 600000,
  options: ProcessOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number | null; missing?: boolean }> {
  return arduino(args, { ...options, timeout });
}
export async function compile(
  root: string,
  id: string,
  s: Source,
  options: ProcessOptions = {},
): Promise<BuildResult> {
  const result = notBuilt(s);
  const start = Date.now();
  const env = await environment(s, options);
  result.toolDigest = env.fingerprint;
  if (!env.compileReady)
    return {
      ...result,
      reason: '環境未就緒',
      stderr: env.items
        .filter((i) => !i.ready && i.id !== 'simulation')
        .map((i) => i.name + ': ' + i.reason)
        .join('\n'),
      durationMs: Date.now() - start,
    };
  const ver = await command(['version', '--format', 'json'], 30000, options);
  result.version = ver.exitCode === 0 ? ver.stdout.trim() : null;
  if (ver.exitCode !== 0) {
    return {
      ...result,
      state: ver.missing ? 'not_run' : 'fail',
      stdout: ver.stdout,
      stderr: ver.stderr,
      exitCode: ver.exitCode,
      durationMs: Date.now() - start,
      reason: ver.missing ? '找不到 arduino-cli；請依 README 安裝' : 'Arduino CLI 無法啟動',
    };
  }
  const [coreList, libList] = await Promise.all([
    command(['core', 'list', '--format', 'json'], 60000, options),
    command(['lib', 'list', '--format', 'json'], 60000, options),
  ]);
  try {
    if (coreList.exitCode !== 0 || libList.exitCode !== 0)
      throw new Error(coreList.stderr + '\n' + libList.stderr);
    const cores = JSON.parse(coreList.stdout);
    const platforms = Array.isArray(cores) ? cores : (cores.platforms ?? []);
    if (
      !platforms.some(
        (p: any) =>
          p.id === s.dependencies.core.name &&
          (p.installed_version ?? p.installed) === s.dependencies.core.version,
      )
    )
      throw new Error(`未安裝鎖定 core ${s.dependencies.core.name}@${s.dependencies.core.version}`);
    const libs = JSON.parse(libList.stdout);
    const installed = Array.isArray(libs) ? libs : (libs.installed_libraries ?? []);
    for (const lib of s.dependencies.libraries)
      if (
        !installed.some(
          (x: any) =>
            (x.library ?? x).name === lib.name && (x.library ?? x).version === lib.version,
        )
      )
        throw new Error(`未安裝鎖定函式庫 ${lib.name}@${lib.version}`);
  } catch (e) {
    return {
      ...result,
      version: result.version,
      state: 'not_run',
      reason: '依賴未就緒',
      stdout: coreList.stdout + '\n' + libList.stdout,
      stderr: (e as Error).message,
      durationMs: Date.now() - start,
    };
  }
  const base = `.hw/builds/${id}`;
  await atomicWrite(root, base + '/main/main.ino', s.firmware);
  for (const [name, text] of Object.entries(s.extraFirmware))
    await atomicWrite(root, base + '/main/' + name.slice('firmware/main/'.length), text);
  await atomicWrite(root, base + '/main/pinmap.h', generatePinmap(s));
  const sketch = await safePath(root, base + '/main');
  const output = await safePath(root, base + '/artifacts', true);
  await fs.mkdir(output, { recursive: true });
  const r = await arduino(
    [
      'compile',
      '--fqbn',
      s.dependencies.fqbn,
      '--output-dir',
      getAsciiPath(output),
      ...s.dependencies.buildProperties.flatMap((v) => ['--build-property', v]),
      getAsciiPath(sketch),
    ],
    { ...options, timeout: options.timeout ?? 600000 },
  );
  const artifacts: BuildResult['artifacts'] = [];
  if (r.exitCode === 0)
    for (const name of await fs.readdir(output)) {
      const p = await safePath(root, base + '/artifacts/' + name);
      const stat = await fs.stat(p);
      if (stat.isFile()) {
        const bytes = await fs.readFile(p);
        artifacts.push({
          path: base + '/artifacts/' + name,
          size: bytes.length,
          sha256: digest(bytes),
        });
      }
    }
  return {
    ...result,
    state: r.exitCode === 0 && !r.cancelled && !r.timedOut ? 'pass' : 'fail',
    cancelled: r.cancelled,
    timedOut: r.timedOut,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.exitCode,
    durationMs: Date.now() - start,
    artifacts,
    reason: r.cancelled
      ? '編譯已取消'
      : r.timedOut
        ? '編譯逾時'
        : r.exitCode === 0
          ? undefined
          : 'Arduino CLI 編譯失敗',
  };
}
export async function validBuildArtifacts(root: string, build: BuildResult) {
  if (build.state !== 'pass' || !build.artifacts.length) return false;
  try {
    for (const a of build.artifacts) {
      if (!/^\.hw\/builds\/[A-Za-z0-9_-]+\/artifacts\/[A-Za-z0-9_.-]+$/.test(a.path)) return false;
      const bytes = await fs.readFile(await safePath(root, a.path));
      if (bytes.length !== a.size || digest(bytes) !== a.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}
