import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Disk maintenance for the managed `.local` tree. Every target here can be re-downloaded or
// regenerated; project sources, history and the active toolchain are never listed.
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export interface DiskTarget {
  path: string;
  reason: string;
  bytes: number;
}

export async function diskUsage(target: string): Promise<number> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await fs.readdir(target)) total += await diskUsage(path.join(target, entry));
  return total;
}
export async function removeDirectory(target: string) {
  const bytes = await diskUsage(target);
  await fs.rm(target, { recursive: true, force: true });
  return bytes;
}
async function existing(candidates: [string, string][]) {
  const targets: DiskTarget[] = [];
  for (const [target, reason] of candidates)
    if (await fs.lstat(target).catch(() => null))
      targets.push({ path: target, reason, bytes: await diskUsage(target) });
  return targets;
}

// A: leftovers and caches that are rebuilt or re-downloaded on demand.
export async function cacheTargets(app = appRoot) {
  const local = path.join(app, '.local');
  const candidates: [string, string][] = [];
  for (const name of (await fs.readdir(local).catch(() => [])).sort()) {
    const target = path.join(local, name);
    if (/^(hardware|runtime|esp32)-acceptance-\d+$/.test(name))
      candidates.push([target, '驗收腳本留下的暫存專案']);
    else if (/^node-v[\d.]+-win-(x64|arm64)\.zip$/.test(name))
      candidates.push([target, '已解壓的 Node.js 安裝封包']);
    else if (/^picsimlab[\w.-]*\.zip$/i.test(name)) candidates.push([target, 'PICSimLab 封包副本']);
    else if (name === 'esp32-native') candidates.push([target, '未使用的舊版完整 PICSimLab']);
    else if (name === 'downloads') candidates.push([target, '引擎與 Python 安裝封包']);
  }
  // A user-supplied Arduino configuration may share these folders with other tools.
  if (!process.env.ARDUINO_CONFIG_FILE)
    candidates.push(
      [path.join(local, 'arduino/downloads'), 'Arduino core／函式庫下載封包'],
      [path.join(local, 'arduino/cache'), 'Arduino 編譯快取（下次編譯會重新產生）'],
    );
  candidates.push([path.join(app, 'test-results'), 'Playwright 測試輸出']);
  return existing(candidates);
}

// B: parts of the esp32:esp32 platform that the ESP32-DevKitC (Xtensa) build never uses.
// Tool version folders stay in place (empty) so arduino-cli still sees the platform installed.
const UNUSED_ESP32_TOOLS: Record<string, string> = {
  'esp-rv32': 'RISC-V 編譯器（ESP32-C/H/P 系列）',
  'riscv32-esp-elf-gdb': 'RISC-V 除錯器',
  'xtensa-esp-elf-gdb': 'Xtensa 除錯器（不提供硬體除錯）',
  'openocd-esp32': 'OpenOCD 除錯伺服器',
};
export const managedArduinoData = (app = appRoot) => path.join(app, '.local/arduino/data');
export async function esp32ToolchainTargets(dataDir = managedArduinoData()) {
  const tools = path.join(dataDir, 'packages/esp32/tools');
  const candidates: [string, string][] = [];
  const dirs = async (dir: string) =>
    (await fs.readdir(dir, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  for (const [tool, reason] of Object.entries(UNUSED_ESP32_TOOLS))
    for (const version of await dirs(path.join(tools, tool)))
      for (const entry of (await fs.readdir(path.join(tools, tool, version))).sort())
        candidates.push([path.join(tools, tool, version, entry), reason]);
  for (const version of await dirs(path.join(tools, 'esp32-arduino-libs')))
    for (const mcu of await dirs(path.join(tools, 'esp32-arduino-libs', version)))
      if (mcu !== 'esp32')
        candidates.push([
          path.join(tools, 'esp32-arduino-libs', version, mcu),
          `${mcu} 晶片的預編譯 SDK`,
        ]);
  return existing(candidates);
}

interface Manifest {
  dataDir: string;
  moves: { from: string; to: string; bytes: number }[];
}
const manifestFile = (staging: string) => path.join(staging, 'manifest.json');
export const esp32Staging = (dataDir = managedArduinoData()) =>
  path.join(path.dirname(dataDir), 'slim-staging');

// Moves targets out of the Arduino data tree (same volume, so renames are instant). A failure
// part-way moves everything back, so the toolchain is never left half staged.
export async function stageTargets(targets: DiskTarget[], dataDir: string, staging: string) {
  if (await fs.lstat(staging).catch(() => null))
    throw new Error('已有暫存的精簡結果；請先 --commit 或 --restore');
  const manifest: Manifest = { dataDir, moves: [] };
  try {
    for (const target of targets) {
      const relative = path.relative(dataDir, target.path);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('拒絕移動 Arduino 資料夾以外的路徑：' + target.path);
      const to = path.join(staging, 'files', relative);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(target.path, to);
      manifest.moves.push({ from: target.path, to, bytes: target.bytes });
    }
    await fs.writeFile(manifestFile(staging), JSON.stringify(manifest, null, 2));
  } catch (error) {
    for (const move of manifest.moves.reverse()) await fs.rename(move.to, move.from);
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  return manifest.moves.reduce((sum, move) => sum + move.bytes, 0);
}
export async function restoreStaged(staging: string) {
  const manifest: Manifest = JSON.parse(await fs.readFile(manifestFile(staging), 'utf8'));
  for (const move of manifest.moves) {
    await fs.mkdir(path.dirname(move.from), { recursive: true });
    await fs.rename(move.to, move.from);
  }
  await fs.rm(staging, { recursive: true, force: true });
  return manifest.moves.length;
}
export async function commitStaged(staging: string) {
  await fs.access(manifestFile(staging));
  return removeDirectory(staging);
}
