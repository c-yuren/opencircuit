import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { gunzipSync, unzipSync } from 'fflate';
import { fetch as httpFetch, ProxyAgent } from 'undici';
import { createHash } from 'node:crypto';
import type { Source } from './model';
import { digest } from './analysis';
import { runProcess, type ProcessOptions } from './process';
import { boards } from './boards';
import { removeDirectory } from './maintenance';
import {
  esp32EngineInstalled,
  esp32EngineInstallable,
  checkSimulationPython,
  installEsp32Engine,
  installSimulationPython,
  simulationPythonInstallable,
} from './esp32-engine';
export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CLI_VERSION = '1.3.1';
export const approvedLibraries: Record<string, string> = {
  'Adafruit SSD1306': '2.5.13',
  'Adafruit GFX Library': '1.12.1',
  'Adafruit BusIO': '1.17.2',
  'DHT sensor library': '1.4.6',
  'Adafruit Unified Sensor': '1.1.15',
  U8g2: '2.36.12',
};

let asciiDrivePrefix: string | null = null;
let asciiDriveTarget: string | null = null;

export function getAsciiPath(targetPath: string): string {
  if (process.platform !== 'win32' || !/[^\x00-\x7F]/.test(targetPath)) {
    return targetPath;
  }
  const resolved = path.resolve(targetPath);
  if (
    asciiDriveTarget &&
    asciiDrivePrefix &&
    resolved.toLowerCase().startsWith(asciiDriveTarget.toLowerCase())
  ) {
    const rel = resolved.slice(asciiDriveTarget.length).replace(/^[\\/]+/, '');
    return rel ? path.join(asciiDrivePrefix, rel) : asciiDrivePrefix;
  }

  const mapFolder =
    appRoot && resolved.toLowerCase().startsWith(appRoot.toLowerCase()) ? appRoot : resolved;
  try {
    const out = execSync('subst', { encoding: 'utf8', windowsHide: true });
    // SUBST's legacy code page can corrupt Unicode targets, so existing mappings are matched by
    // file index against both the app folder and the folder this call would map; otherwise
    // every run would create another drive letter for the same folder. (A SUBST drive may
    // report a different device number, so only the file index is compared.)
    const identity = (target: string) => {
      const stat = fsSync.statSync(target, { bigint: true });
      return stat.ino ? String(stat.ino) : null;
    };
    const known = new Map<string, string>();
    for (const folder of new Set([appRoot, mapFolder])) {
      const id = identity(folder);
      if (id) known.set(id, folder);
    }
    for (const line of out.split(/\r?\n/)) {
      const match = line.match(/^([A-Z]):\\:\s*=>\s*(.+)$/i);
      if (match) {
        const drive = match[1].toUpperCase() + ':\\';
        const dest = known.get(identity(drive) ?? '') ?? path.resolve(match[2].trim());
        if (resolved.toLowerCase().startsWith(dest.toLowerCase())) {
          asciiDrivePrefix = drive;
          asciiDriveTarget = dest;
          const rel = resolved.slice(dest.length).replace(/^[\\/]+/, '');
          return rel ? path.join(drive, rel) : drive;
        }
      }
    }
  } catch {}

  const drives = 'ZYXWVUTSRQPONMLKJIHGFED'.split('');
  for (const d of drives) {
    const drivePath = d + ':\\';
    if (!fsSync.existsSync(drivePath)) {
      try {
        execSync(`subst ${d}: "${mapFolder}"`, { windowsHide: true });
        asciiDrivePrefix = drivePath;
        asciiDriveTarget = path.resolve(mapFolder);
        const rel = resolved.slice(asciiDriveTarget.length).replace(/^[\\/]+/, '');
        return rel ? path.join(drivePath, rel) : drivePath;
      } catch {}
    }
  }
  return targetPath;
}

async function ensureAsciiConfig(configPath: string, root: string) {
  if (process.platform !== 'win32') return;
  try {
    const text = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(text);
    let changed = false;
    const base = path.join(root, '.local/arduino');
    for (const key of ['data', 'downloads', 'user'] as const) {
      const expected = path.join(base, key);
      if (parsed.directories?.[key] !== expected) {
        parsed.directories = parsed.directories || {};
        parsed.directories[key] = expected;
        changed = true;
      }
    }
    const expectedCache = path.join(base, 'cache');
    if (parsed.build_cache?.path !== expectedCache) {
      parsed.build_cache = parsed.build_cache || {};
      parsed.build_cache.path = expectedCache;
      changed = true;
    }
    if (changed) {
      await fs.writeFile(configPath, JSON.stringify(parsed, null, 2), 'utf8');
    }
  } catch {}
}

export async function cliPaths() {
  const root = getAsciiPath(appRoot);
  const local = path.join(
    root,
    '.local/bin/arduino-cli' + (process.platform === 'win32' ? '.exe' : ''),
  );
  let binary = await fs
    .access(local)
    .then(() => local)
    .catch(() => 'arduino-cli');
  if (binary === 'arduino-cli') {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const candidate = path.resolve(
        dir,
        'arduino-cli' + (process.platform === 'win32' ? '.exe' : ''),
      );
      if (
        await fs
          .access(candidate)
          .then(() => true)
          .catch(() => false)
      ) {
        binary = candidate;
        break;
      }
    }
  }
  const configPath = path.join(root, '.local/arduino/arduino-cli.yaml');
  let config = process.env.ARDUINO_CONFIG_FILE;
  if (!config) {
    try {
      await fs.access(configPath);
      await ensureAsciiConfig(configPath, root);
      config = configPath;
    } catch {}
  }
  return { binary, config };
}
export async function arduino(args: string[], options: ProcessOptions = {}) {
  const { binary, config } = await cliPaths();
  return runProcess(binary, [...(config ? ['--config-file', config] : []), ...args], options);
}
export async function environment(s: Source, options: ProcessOptions = {}) {
  const version = await arduino(['version', '--format', 'json'], { ...options, timeout: 30000 });
  let cliVersion: string | null = null;
  try {
    cliVersion = JSON.parse(version.stdout).VersionString ?? JSON.parse(version.stdout).version;
  } catch {}
  const items: {
    id: string;
    name: string;
    ready: boolean;
    installable: boolean;
    reason: string;
  }[] = [
    {
      id: 'node',
      name: 'Node.js ≥22.12',
      ready:
        Number(process.versions.node.split('.')[0]) > 22 ||
        (Number(process.versions.node.split('.')[0]) === 22 &&
          Number(process.versions.node.split('.')[1]) >= 12),
      installable: false,
      reason: process.versions.node,
    },
    {
      id: 'cli',
      name: 'Arduino CLI ' + CLI_VERSION,
      ready: cliVersion === CLI_VERSION,
      installable: true,
      reason: cliVersion ?? version.stderr ?? '未安裝',
    },
  ];
  const [cr, lr] =
    version.exitCode === 0
      ? await Promise.all([
          arduino(['core', 'list', '--format', 'json'], { ...options, timeout: 60000 }),
          arduino(['lib', 'list', '--format', 'json'], { ...options, timeout: 60000 }),
        ])
      : [
          { stdout: '', exitCode: null },
          { stdout: '', exitCode: null },
        ];
  const parse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  const c = parse(cr.stdout),
    l = parse(lr.stdout),
    cores = Array.isArray(c) ? c : (c.platforms ?? []),
    libs = Array.isArray(l) ? l : (l.installed_libraries ?? []);
  const coreReady =
    cr.exitCode === 0 &&
    cores.some(
      (p: any) =>
        p.id === s.dependencies.core.name &&
        (p.installed_version ?? p.installed) === s.dependencies.core.version,
    );
  items.push({
    id: 'core',
    name: s.dependencies.core.name + '@' + s.dependencies.core.version,
    ready: coreReady,
    installable: Object.values(boards).some(
      (b) =>
        b.core.name === s.dependencies.core.name && b.core.version === s.dependencies.core.version,
    ),
    reason: coreReady ? '已安裝' : '缺少鎖定板型套件或工具無法列出套件',
  });
  for (const lib of s.dependencies.libraries) {
    const ready =
      lr.exitCode === 0 &&
      libs.some(
        (x: any) => (x.library ?? x).name === lib.name && (x.library ?? x).version === lib.version,
      );
    items.push({
      id: 'lib:' + lib.name,
      name: lib.name + '@' + lib.version,
      ready,
      installable: approvedLibraries[lib.name] === lib.version,
      reason: ready ? '已安裝' : '未安裝鎖定版本',
    });
  }
  items.push({
    id: 'simulation',
    name:
      s.dependencies.fqbn === 'arduino:avr:uno' ? 'AVR8js 0.21.0 · 完全本機' : 'ESP32 · 本機 QEMU',
    ready:
      s.dependencies.fqbn === 'arduino:avr:uno' ||
      (s.dependencies.fqbn === 'esp32:esp32:esp32' && esp32EngineInstalled()),
    installable: s.dependencies.fqbn === 'esp32:esp32:esp32' && esp32EngineInstallable(),
    reason:
      s.dependencies.fqbn === 'arduino:avr:uno'
        ? '隨 npm ci 安裝；LED／按鈕／UART 子集'
        : esp32EngineInstalled()
          ? 'QEMU 與 ROM 已安裝；GPIO／按鈕／UART 子集'
          : '缺少 QEMU 引擎或 ROM，可安裝缺少套件',
  });
  if (s.dependencies.fqbn === 'esp32:esp32:esp32') {
    const python = await checkSimulationPython(options);
    items.push({
      id: 'simulation:python',
      name: 'Python 3.10+ · 64 位元',
      ready: python.ready,
      installable: simulationPythonInstallable(),
      reason: python.reason,
    });
  }
  const paths = await cliPaths();
  const binaryDigest = await fs
      .readFile(paths.binary)
      .then(digest)
      .catch(() => null),
    configDigest = paths.config
      ? await fs
          .readFile(paths.config)
          .then(digest)
          .catch(() => null)
      : null;
  const fingerprint = digest({
    cliVersion,
    core: s.dependencies.core,
    libraries: s.dependencies.libraries,
    fqbn: s.dependencies.fqbn,
    buildProperties: s.dependencies.buildProperties,
    binary: paths.binary,
    config: paths.config,
    binaryDigest,
    configDigest,
  });
  return {
    checkedAt: new Date().toISOString(),
    items,
    compileReady: items.filter((i) => !i.id.startsWith('simulation')).every((i) => i.ready),
    simulationReady: items.filter((i) => i.id.startsWith('simulation')).every((i) => i.ready),
    fingerprint,
    cliVersion,
    editing: true,
    uploadRequiresDevice: true,
  };
}
async function download(url: string, signal?: AbortSignal) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const agent = proxy ? new ProxyAgent(proxy) : undefined;
  try {
    const r = await httpFetch(url, { signal, dispatcher: agent });
    if (!r.ok) throw new Error('官方下載失敗 ' + r.status + ' ' + url);
    return new Uint8Array(await r.arrayBuffer());
  } finally {
    await agent?.close();
  }
}
function tarBinary(tar: Uint8Array, name: string) {
  for (let i = 0; i + 512 <= tar.length; ) {
    const n = Buffer.from(tar.slice(i, i + 100))
      .toString()
      .replace(/\0.*$/, '');
    const size =
      parseInt(
        Buffer.from(tar.slice(i + 124, i + 136))
          .toString()
          .replace(/\0.*$/, '')
          .trim(),
        8,
      ) || 0;
    if (n.split('/').at(-1) === name) return tar.slice(i + 512, i + 512 + size);
    i += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('官方壓縮檔沒有 CLI');
}

async function verifyChecksum(filePath: string, expectedChecksum?: string): Promise<boolean> {
  if (!expectedChecksum) return true;
  const [algo, hex] = expectedChecksum.toLowerCase().split(':');
  if (algo !== 'sha-256' && algo !== 'sha256') return true;
  try {
    const hash = createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    return hash.digest('hex').toLowerCase() === hex.toLowerCase();
  } catch {
    return false;
  }
}

export function getCandidateDownloadUrls(originalUrl: string): string[] {
  const urls: string[] = [];
  if (process.env.OPENCIRCUIT_DOWNLOAD_MIRROR) {
    const mirror = process.env.OPENCIRCUIT_DOWNLOAD_MIRROR.replace(/\/$/, '');
    urls.push(`${mirror}/${originalUrl}`);
  }
  if (originalUrl.includes('github.com')) {
    urls.push(`https://gh-proxy.com/${originalUrl}`);
  }
  urls.push(originalUrl);
  return Array.from(new Set(urls));
}

export async function downloadToFile(
  url: string,
  destPath: string,
  expected: { size?: number; checksum?: string } = {},
  options: ProcessOptions = {},
) {
  const fileName = path.basename(destPath);
  const stat = await fs.stat(destPath).catch(() => null);
  if (stat && stat.size > 0) {
    if (expected.size && stat.size === expected.size) {
      if (await verifyChecksum(destPath, expected.checksum)) {
        options.onOutput?.('stdout', `已快取 ${fileName}（校驗符合）\n`);
        return;
      } else {
        options.onOutput?.('stderr', `快取檔案 ${fileName} 校驗不符，重新下載\n`);
        await fs.unlink(destPath).catch(() => {});
      }
    } else if (expected.size && stat.size > expected.size) {
      options.onOutput?.('stderr', `快取檔案 ${fileName} 超出預期大小，重新下載\n`);
      await fs.unlink(destPath).catch(() => {});
    }
  }

  const maxRetries = 25;
  let attempt = 0;
  let checksumFailures = 0;
  const candidateUrls = getCandidateDownloadUrls(url);

  while (attempt < maxRetries) {
    if (options.signal?.aborted) throw new Error('下載已取消');
    attempt++;
    const currentStat = await fs.stat(destPath).catch(() => null);
    let curSize = currentStat ? currentStat.size : 0;
    if (expected.size && curSize === expected.size) {
      if (await verifyChecksum(destPath, expected.checksum)) {
        options.onOutput?.('stdout', `已下載並通過校驗：${fileName}\n`);
        return;
      } else {
        await fs.unlink(destPath).catch(() => {});
        curSize = 0;
      }
    }

    const headers: Record<string, string> = {};
    if (curSize > 0) {
      headers['Range'] = `bytes=${curSize}-`;
    }
    const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    const agent = proxy ? new ProxyAgent(proxy) : undefined;
    let fileStream: fsSync.WriteStream | null = null;
    const currentUrl = candidateUrls[(attempt - 1) % candidateUrls.length];

    try {
      options.onOutput?.(
        'stdout',
        curSize > 0
          ? `續傳 ${fileName}（從 ${(curSize / (1024 * 1024)).toFixed(1)} MB 開始）...\n`
          : `開始下載 ${fileName}...\n`,
      );
      const res = await httpFetch(currentUrl, {
        headers,
        signal: options.signal,
        dispatcher: agent,
      });
      if (res.status === 416) {
        await fs.unlink(destPath).catch(() => {});
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const isPartial = res.status === 206;
      if (!isPartial && curSize > 0) {
        curSize = 0;
      }
      fileStream = fsSync.createWriteStream(destPath, { flags: isPartial ? 'a' : 'w' });
      const total =
        expected.size ??
        (isPartial
          ? curSize + Number(res.headers.get('content-length') || 0)
          : Number(res.headers.get('content-length') || 0));
      let downloaded = curSize;
      let lastReportTime = Date.now();

      if (!res.body) throw new Error('沒有回傳資料流');
      for await (const chunk of res.body) {
        if (options.signal?.aborted) throw new Error('下載已取消');
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        fileStream.write(buf);
        downloaded += buf.length;
        const now = Date.now();
        if (now - lastReportTime > 2000) {
          lastReportTime = now;
          const curMb = (downloaded / (1024 * 1024)).toFixed(1);
          const totalMb = total ? (total / (1024 * 1024)).toFixed(1) : '?';
          const pct = total ? ` (${((downloaded / total) * 100).toFixed(1)}%)` : '';
          options.onOutput?.('stdout', `下載中 ${fileName}: ${curMb} / ${totalMb} MB${pct}\n`);
        }
      }
      await new Promise<void>((resolve, reject) => {
        fileStream!.end(() => resolve());
        fileStream!.on('error', reject);
      });
      fileStream = null;

      const finalStat = await fs.stat(destPath).catch(() => null);
      if (expected.size && finalStat && finalStat.size !== expected.size) {
        throw new Error(`下載大小不符 (預期 ${expected.size}，實際 ${finalStat.size})`);
      }
      if (!(await verifyChecksum(destPath, expected.checksum))) {
        await fs.unlink(destPath).catch(() => {});
        checksumFailures++;
        if (checksumFailures >= 2) {
          throw new Error(`檔案校驗不符：${fileName}`);
        }
        throw new Error(`檔案校驗不符，準備重試：${fileName}`);
      }
      options.onOutput?.('stdout', `下載完成並通過校驗：${fileName}\n`);
      return;
    } catch (err) {
      if (fileStream) {
        try {
          fileStream.destroy();
        } catch {}
      }
      if (options.signal?.aborted) throw err;
      if (attempt >= maxRetries || (err as Error).message.includes('檔案校驗不符：')) throw err;
      const delay = Math.min(2000 * Math.pow(1.3, attempt - 1), 10000);
      options.onOutput?.(
        'stderr',
        `下載中斷，${Math.round(delay / 1000)} 秒後自動續傳 (${attempt}/${maxRetries}): ${(err as Error).message}\n`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      await agent?.close();
    }
  }
}

function matchHostSystem(systems: any[], platform: string, arch: string) {
  const patterns: RegExp[] = [];
  if (platform === 'win32') {
    if (arch === 'x64') {
      patterns.push(/(amd64|x86_64)-.*(mingw32|cygwin)/i, /i[3456]86-.*(mingw32|cygwin)/i);
    } else {
      patterns.push(/i[3456]86-.*(mingw32|cygwin)/i);
    }
  } else if (platform === 'darwin') {
    if (arch === 'arm64') {
      patterns.push(/arm64-apple-darwin/i, /x86_64-apple-darwin/i);
    } else {
      patterns.push(/x86_64-apple-darwin/i);
    }
  } else if (platform === 'linux') {
    if (arch === 'x64') patterns.push(/x86_64-.*linux-gnu/i);
    else if (arch === 'arm64') patterns.push(/(aarch64|arm64)-linux-gnu/i);
    else if (arch === 'arm') patterns.push(/arm.*-linux-gnueabihf/i);
  }
  for (const pat of patterns) {
    const found = systems.find((s: any) => pat.test(s.host));
    if (found) return found;
  }
  return null;
}

export async function prefetchCore(
  coreName: string,
  coreVersion: string,
  options: ProcessOptions = {},
) {
  const [packager, arch] = coreName.split(':');
  const root = getAsciiPath(appRoot);
  const dataDir = path.join(root, '.local/arduino/data');
  const downloadsDir = path.join(root, '.local/arduino/downloads/packages');
  await fs.mkdir(downloadsDir, { recursive: true });

  const files = await fs.readdir(dataDir).catch(() => []);
  const indexFiles = files.filter(
    (f) => (f.startsWith('package_') && f.endsWith('_index.json')) || f === 'package_index.json',
  );
  const allPackages: any[] = [];
  for (const file of indexFiles) {
    try {
      const text = await fs.readFile(path.join(dataDir, file), 'utf8');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.packages)) {
        allPackages.push(...parsed.packages);
      }
    } catch {}
  }

  const targetPkg = allPackages.find((p) => p.name === packager);
  if (!targetPkg) {
    options.onOutput?.('stderr', `未在 index 找到 ${packager} 套件定義，略過預先下載\n`);
    return;
  }
  const platform = (targetPkg.platforms ?? []).find(
    (p: any) => p.architecture === arch && p.version === coreVersion,
  );
  if (!platform) {
    options.onOutput?.(
      'stderr',
      `未在 index 找到 ${coreName}@${coreVersion} 平台定義，略過預先下載\n`,
    );
    return;
  }

  interface DownloadItem {
    url: string;
    archiveFileName: string;
    size: number;
    checksum: string;
  }
  const queue: DownloadItem[] = [];
  if (platform.url && platform.archiveFileName) {
    queue.push({
      url: platform.url,
      archiveFileName: platform.archiveFileName,
      size: Number(platform.size),
      checksum: platform.checksum,
    });
  }
  for (const td of platform.toolsDependencies ?? []) {
    const pkg = allPackages.find((p) => p.name === td.packager);
    const tool = (pkg?.tools ?? []).find(
      (t: any) => t.name === td.name && t.version === td.version,
    );
    if (!tool) {
      options.onOutput?.(
        'stderr',
        `依賴工具未在 index 找到: ${td.packager}:${td.name}@${td.version}\n`,
      );
      continue;
    }
    const matched = matchHostSystem(tool.systems ?? [], process.platform, process.arch);
    if (!matched) {
      options.onOutput?.('stderr', `依賴工具無符合當前作業系統的封包: ${td.name}\n`);
      continue;
    }
    queue.push({
      url: matched.url,
      archiveFileName: matched.archiveFileName,
      size: Number(matched.size),
      checksum: matched.checksum,
    });
  }

  options.onOutput?.(
    'stdout',
    `開始預先下載與校驗 ${coreName}@${coreVersion} 封包（共 ${queue.length} 件）...\n`,
  );
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    options.onOutput?.('stdout', `[${i + 1}/${queue.length}] 處理 ${item.archiveFileName}\n`);
    const dest = path.join(downloadsDir, item.archiveFileName);
    await downloadToFile(item.url, dest, { size: item.size, checksum: item.checksum }, options);
  }
  options.onOutput?.('stdout', `所有核心封包已就緒！\n`);
}

export async function installMissing(s: Source, options: ProcessOptions = {}) {
  let env = await environment(s, options);
  if (!env.items.find((i) => i.id === 'cli')!.ready) {
    const platforms: Record<string, string> = {
      'linux:x64': 'Linux_64bit.tar.gz',
      'linux:arm64': 'Linux_ARM64.tar.gz',
      'darwin:x64': 'macOS_64bit.tar.gz',
      'darwin:arm64': 'macOS_ARM64.tar.gz',
      'win32:x64': 'Windows_64bit.zip',
    };
    const suffix = platforms[process.platform + ':' + process.arch];
    if (!suffix) throw new Error('此作業系統請手動安裝 Arduino CLI ' + CLI_VERSION);
    const name = 'arduino-cli_' + CLI_VERSION + '_' + suffix,
      base = 'https://github.com/arduino/arduino-cli/releases/download/v' + CLI_VERSION + '/';
    options.onOutput?.('stdout', '下載官方 Arduino CLI ' + CLI_VERSION + '，驗證 SHA-256\n');
    const checks = Buffer.from(
      await download(base + CLI_VERSION + '-checksums.txt', options.signal),
    ).toString();
    const expected = checks
      .split('\n')
      .find((l) => l.trim().endsWith(name))
      ?.trim()
      .split(/\s+/)[0];
    if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('找不到官方 checksum');
    const bytes = await download(base + name, options.signal);
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error('CLI checksum 不符');
    const executable = 'arduino-cli' + (process.platform === 'win32' ? '.exe' : '');
    const binary = suffix.endsWith('.zip')
      ? unzipSync(bytes)[executable]
      : tarBinary(gunzipSync(bytes), executable);
    if (!binary) throw new Error('CLI 解壓失敗');
    await fs.mkdir(path.join(appRoot, '.local/bin'), { recursive: true });
    await fs.writeFile(path.join(appRoot, '.local/bin', executable), binary, { mode: 0o755 });
  }
  if (!(await cliPaths()).config) {
    const root = getAsciiPath(appRoot);
    const base = path.join(root, '.local/arduino');
    for (const dir of ['data', 'downloads', 'user', 'cache'])
      await fs.mkdir(path.join(base, dir), { recursive: true });
    await fs.writeFile(
      path.join(base, 'arduino-cli.yaml'),
      JSON.stringify(
        {
          board_manager: {
            additional_urls: ['https://espressif.github.io/arduino-esp32/package_esp32_index.json'],
          },
          directories: {
            data: path.join(base, 'data'),
            downloads: path.join(base, 'downloads'),
            user: path.join(base, 'user'),
          },
          build_cache: { path: path.join(base, 'cache') },
        },
        null,
        2,
      ),
    );
  }
  const run = async (args: string[]) => {
    options.onOutput?.('stdout', 'arduino-cli ' + args.join(' ') + '\n');
    const r = await arduino(args, { ...options, timeout: 1200000 });
    if (r.exitCode !== 0 || r.cancelled || r.timedOut)
      throw new Error(r.stderr || '安裝失敗或已取消');
  };
  env = await environment(s, options);
  if (!env.items.find((i) => i.id === 'core')!.ready) {
    if (!env.items.find((i) => i.id === 'core')!.installable)
      throw new Error('未允許自動安裝此 core 版本');
    await run(['core', 'update-index']);
    await prefetchCore(s.dependencies.core.name, s.dependencies.core.version, options);
    await run(['core', 'install', s.dependencies.core.name + '@' + s.dependencies.core.version]);
  }
  const missing = env.items.filter((i) => i.id.startsWith('lib:') && !i.ready);
  if (missing.length) {
    if (missing.some((i) => !i.installable))
      throw new Error('部分函式庫不在官方鎖定安裝清單，請人工核對');
    await run(['lib', 'update-index']);
    await run(['lib', 'install', '--no-deps', ...missing.map((i) => i.name)]);
  }
  // Installs a missing engine, or prunes unused PICSimLab files from an existing one.
  if (s.dependencies.fqbn === 'esp32:esp32:esp32') await installEsp32Engine(options);
  if (s.dependencies.fqbn === 'esp32:esp32:esp32') await installSimulationPython(options);
  const after = await environment(s, options);
  if (!after.compileReady) throw new Error('安裝後環境仍未就緒，請檢視檢查結果');
  // Installed cores and libraries no longer need their downloaded archives (often > 1 GB for
  // ESP32). Only the managed configuration is cleaned; a user-supplied one is left untouched.
  if (!process.env.ARDUINO_CONFIG_FILE) {
    const freed = await removeDirectory(path.join(appRoot, '.local/arduino/downloads'));
    if (freed)
      options.onOutput?.(
        'stdout',
        `清除已安裝套件的下載封包 ${(freed / 1048576).toFixed(0)} MB。\n`,
      );
  }
  return after;
}
