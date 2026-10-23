import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { safePath } from './files';
import { runProcess, type ProcessOptions } from './process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ESP32_ENGINE_VERSION = '0.9.3';
const localPython = path.join(root, '.local/python/python.exe');
export function pythonExecutable() {
  if (process.env.OPENCIRCUIT_PYTHON) return process.env.OPENCIRCUIT_PYTHON;
  if (process.platform !== 'win32') return 'python3';
  if (fsSync.existsSync(localPython)) return localPython;
  // Launch the interpreter directly; WindowsApps aliases can create a second process.
  const installed = path.join(process.env.LOCALAPPDATA ?? '', 'Programs/Python');
  try {
    for (const name of fsSync
      .readdirSync(installed)
      .filter((name) => /^Python3\d+$/.test(name))
      .sort((a, b) => Number(b.slice(6)) - Number(a.slice(6)))) {
      const executable = path.join(installed, name, 'python.exe');
      if (fsSync.existsSync(executable)) return executable;
    }
  } catch {}
  return 'python';
}
export const simulationPythonInstallable = () =>
  process.platform === 'win32' && process.arch === 'x64' && !process.env.OPENCIRCUIT_PYTHON;
export const esp32EnginePath = () =>
  process.env.OPENCIRCUIT_ESP32_ENGINE ??
  path.join(root, '.local/esp32-engine/picsimlab_win64/lib/qemu');
export const esp32EngineInstallable = () =>
  process.platform === 'win32' && process.arch === 'x64' && !process.env.OPENCIRCUIT_ESP32_ENGINE;
// The bridge loads only libqemu-xtensa.dll and the ESP32 ROMs. The DLLs are its non-system
// imports (resolved transitively from the PE import tables of PICSimLab 0.9.3); the rest of
// the PICSimLab package (GUI, other MCU engines, parts) is not used and is not installed.
const ENGINE_QEMU_FILES = [
  'lib/qemu/libqemu-xtensa.dll',
  'lib/qemu/fw/esp32-v3-rom.bin',
  'lib/qemu/fw/esp32-v3-rom-app.bin',
];
const ENGINE_DLLS = [
  'libgcrypt-20.dll',
  'libglib-2.0-0.dll',
  'libgpg-error-0.dll',
  'libiconv-2.dll',
  'libintl-8.dll',
  'libpcre2-8-0.dll',
  'libwinpthread-1.dll',
  'zlib1.dll',
];
// Paths relative to picsimlab_win64/ that the local engine keeps, including its GPL notice.
export function esp32EngineFile(name: string) {
  return (
    ENGINE_QEMU_FILES.includes(name) || ENGINE_DLLS.includes(name) || /^COPYING[^/]*$/.test(name)
  );
}
const defaultEngineRoot = () => path.join(root, '.local/esp32-engine/picsimlab_win64');
export function esp32EngineInstalled() {
  const engine = esp32EnginePath();
  return (
    [
      process.platform === 'win32' ? 'libqemu-xtensa.dll' : 'libqemu-xtensa.so',
      'fw/esp32-v3-rom.bin',
      'fw/esp32-v3-rom-app.bin',
    ].every((name) => fsSync.existsSync(path.join(engine, name))) &&
    // A managed Windows install must also contain the DLLs the engine imports.
    (!!process.env.OPENCIRCUIT_ESP32_ENGINE ||
      process.platform !== 'win32' ||
      ENGINE_DLLS.every((name) => fsSync.existsSync(path.join(defaultEngineRoot(), name))))
  );
}
// Removes files of a managed engine install that the bridge never loads. Returns bytes freed.
export async function pruneEsp32Engine(base = defaultEngineRoot()) {
  if (process.env.OPENCIRCUIT_ESP32_ENGINE && base === defaultEngineRoot()) return 0;
  let freed = 0;
  async function walk(relative: string): Promise<boolean> {
    const dir = path.join(base, relative);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let kept = false;
    for (const entry of entries) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (await walk(name)) kept = true;
        else await fs.rm(path.join(base, name), { recursive: true, force: true });
      } else if (esp32EngineFile(name)) kept = true;
      else {
        freed += (await fs.stat(path.join(base, name))).size;
        await fs.rm(path.join(base, name), { force: true });
      }
    }
    return kept;
  }
  await walk('');
  return freed;
}
export async function checkSimulationPython(options: ProcessOptions = {}) {
  const result = await runProcess(
    pythonExecutable(),
    [
      '-c',
      'import sys,ctypes,json; print(json.dumps({"version":list(sys.version_info[:3]),"bits":ctypes.sizeof(ctypes.c_void_p)*8}))',
    ],
    { ...options, timeout: 5000 },
  );
  try {
    const info = JSON.parse(result.stdout);
    const ready =
      result.exitCode === 0 && info.version[0] === 3 && info.version[1] >= 10 && info.bits === 64;
    return { ready, reason: `Python ${info.version.join('.')} · ${info.bits} 位元` };
  } catch {
    return {
      ready: false,
      reason: '需要 64 位元 Python 3.10+；安裝後重新檢查工具，或設定 OPENCIRCUIT_PYTHON。',
    };
  }
}
export async function installEsp32Engine(options: ProcessOptions = {}) {
  if (esp32EngineInstalled()) {
    options.onOutput?.('stdout', 'ESP32 QEMU 引擎已就緒，略過下載。\n');
    const freed = await pruneEsp32Engine();
    if (freed)
      options.onOutput?.(
        'stdout',
        `移除引擎未使用的 PICSimLab 檔案 ${(freed / 1048576).toFixed(0)} MB。\n`,
      );
    return;
  }
  if (!esp32EngineInstallable())
    throw new Error('目前引擎自動安裝支援 Windows x64；自訂引擎路徑請自行安裝並重新檢查。');
  const { downloadToFile } = await import('./environment');
  const archive = await safePath(root, '.local/downloads/picsimlab-0.9.3-win64.zip', true);
  options.onOutput?.('stdout', '下載 ESP32 QEMU 引擎 0.9.3，驗證官方 SHA-256（約 100 MB）。\n');
  await downloadToFile(
    'https://github.com/lcgamboa/picsimlab/releases/download/v0.9.3/PICSimLab_0.9.3_260920_win64.zip',
    archive,
    {
      checksum: 'SHA-256:b7014c97a839dc388a253fde10c1914ccb5f9a691e58e540831ba1e6bb208138',
      size: 100521245,
    },
    options,
  );
  options.signal?.throwIfAborted();
  const files = unzipSync(await fs.readFile(archive), {
    filter: (file) =>
      file.name.startsWith('picsimlab_win64/') &&
      esp32EngineFile(file.name.slice('picsimlab_win64/'.length)),
  });
  options.onOutput?.('stdout', '解壓本機引擎、ESP32 ROM 與必要 DLL（約 53 MB）。\n');
  for (const [name, bytes] of Object.entries(files)) {
    options.signal?.throwIfAborted();
    const output = await safePath(root, '.local/esp32-engine/' + name, true);
    await fs.writeFile(output, bytes);
  }
  if (!esp32EngineInstalled()) throw new Error('引擎封包缺少 QEMU、ROM 或 DLL，請重新安裝。');
  // The verified files are extracted; the 100 MB archive is only needed to reinstall.
  await fs.rm(archive, { force: true });
  options.onOutput?.('stdout', 'ESP32 QEMU 引擎安裝完成。\n');
}

export async function installSimulationPython(options: ProcessOptions = {}) {
  if ((await checkSimulationPython(options)).ready) return;
  options.signal?.throwIfAborted();
  if (!simulationPythonInstallable())
    throw new Error('請安裝 64 位元 Python 3.10+，或設定 OPENCIRCUIT_PYTHON 指向可執行檔。');
  const { downloadToFile } = await import('./environment');
  const archive = await safePath(root, '.local/downloads/python-3.13.16-embed-amd64.zip', true);
  options.onOutput?.('stdout', '下載官方 Python 3.13.16（64 位元），驗證 SHA-256。\n');
  await downloadToFile(
    'https://www.python.org/ftp/python/3.13.16/python-3.13.16-embed-amd64.zip',
    archive,
    { checksum: 'SHA-256:97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297' },
    options,
  );
  options.signal?.throwIfAborted();
  const files = unzipSync(await fs.readFile(archive), {
    filter: (file) => /^[^/\\]+$/.test(file.name) && file.name !== '..',
  });
  // Publish the executable last so interrupted extraction cannot appear complete.
  const executable = files['python.exe'];
  if (!executable) throw new Error('Python 封包缺少 python.exe');
  delete files['python.exe'];
  for (const [name, bytes] of Object.entries(files)) {
    options.signal?.throwIfAborted();
    await fs.writeFile(await safePath(root, '.local/python/' + name, true), bytes);
  }
  options.signal?.throwIfAborted();
  await fs.writeFile(await safePath(root, '.local/python/python.exe', true), executable);
  const python = await checkSimulationPython(options);
  if (!python.ready) throw new Error(python.reason);
  await fs.rm(archive, { force: true });
  options.onOutput?.('stdout', python.reason + ' · 專案本機環境已就緒。\n');
}
