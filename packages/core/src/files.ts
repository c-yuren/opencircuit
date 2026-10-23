import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, stable } from './analysis';
import { validateSource } from './schema';
import type { Source } from './model';
export const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export const fixedSources = [
  'project.json',
  'circuit.json',
  'layout.json',
  'components/catalog.json',
  'procurement.json',
  'comments.json',
  'dependencies.lock.json',
  'firmware/main/main.ino',
  'AGENTS.md',
];
export function isFirmwareSource(name: string) {
  return (
    /^firmware\/main\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(ino|h|hpp|c|cpp)$/.test(name) &&
    name !== 'firmware/main/pinmap.h'
  );
}
export function isSourceFile(name: string) {
  return (
    fixedSources.includes(name) ||
    isFirmwareSource(name) ||
    /^components\/custom\/[A-Za-z0-9_-]+\.json$/.test(name)
  );
}
export async function safePath(root: string, relative: string, write = false) {
  if (
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((x) => x === '..') ||
    relative.includes('\\') ||
    relative.includes('\0')
  )
    throw new Error('拒絕路徑跳脫');
  const base = await fs.realpath(root);
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('拒絕路徑跳脫');
  let current = base;
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part);
    try {
      const st = await fs.lstat(current);
      if (st.isSymbolicLink()) throw new Error('拒絕 symlink 路徑：' + relative);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw e;
    }
  }
  if (write) await fs.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}
export async function readText(root: string, file: string) {
  return fs.readFile(await safePath(root, file), 'utf8');
}
export async function readJson<T>(root: string, file: string): Promise<T> {
  try {
    return JSON.parse(await readText(root, file));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}
export async function atomicWrite(root: string, file: string, text: string) {
  const dest = await safePath(root, file, true);
  const tmp = dest + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(tmp, text, { flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, dest);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') ||
          attempt >= 7
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export async function sourceNames(root: string) {
  const dir = await safePath(root, 'components/custom');
  const names = await fs.readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  const firmware: string[] = [];
  async function walk(relative: string) {
    const dir = await safePath(root, relative);
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return [];
        throw e;
      });
    for (const entry of entries) {
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(name);
      else if (isFirmwareSource(name)) {
        await safePath(root, name);
        firmware.push(name);
      }
    }
  }
  await walk('firmware/main');
  return [
    ...new Set([
      ...fixedSources,
      ...firmware,
      ...names.map((n) => 'components/custom/' + n).filter(isSourceFile),
    ]),
  ].sort();
}
// Files in components/custom that look like definitions but cannot be source files. They are
// left untouched and reported, so one stray file does not make the whole project unreadable.
export async function ignoredSourceFiles(root: string) {
  const names = await fs.readdir(await safePath(root, 'components/custom')).catch(() => []);
  return names
    .map((n) => 'components/custom/' + n)
    .filter((n) => n.endsWith('.json') && !isSourceFile(n))
    .sort();
}
async function readPass(root: string) {
  const names = await sourceNames(root);
  const files: Record<string, string> = {};
  for (const name of names) {
    if (!isSourceFile(name)) throw new Error('不支援的來源檔案 ' + name);
    files[name] = await readText(root, name);
  }
  return files;
}
export async function capture(root: string) {
  for (let i = 0; i < 5; i++) {
    const a = await readPass(root);
    const b = await readPass(root);
    if (stable(a) === stable(b)) {
      const source = parseFiles(a);
      return { files: a, source, sourceDigest: digest(a) };
    }
  }
  throw new Error('擷取期間來源持續變動，請稍後重試');
}
export function parseFiles(f: Record<string, string>): Source {
  const get = (name: string) => {
    try {
      return JSON.parse(f[name]);
    } catch (e) {
      throw new Error(name + ': ' + (e as Error).message);
    }
  };
  const s: Source = {
    project: get('project.json'),
    circuit: get('circuit.json'),
    layout: get('layout.json'),
    catalog: get('components/catalog.json'),
    custom: Object.keys(f)
      .filter((n) => n.startsWith('components/custom/'))
      .sort()
      .map(get),
    procurement: get('procurement.json'),
    comments: get('comments.json'),
    dependencies: get('dependencies.lock.json'),
    firmware: f['firmware/main/main.ino'],
    extraFirmware: Object.fromEntries(
      Object.entries(f).filter(
        ([name]) => isFirmwareSource(name) && name !== 'firmware/main/main.ino',
      ),
    ),
  };
  validateSource(s);
  return s;
}
export function sourceFiles(s: Source, agents: string): Record<string, string> {
  return {
    'project.json': json(s.project),
    'circuit.json': json(s.circuit),
    'layout.json': json(s.layout),
    'components/catalog.json': json(s.catalog),
    'procurement.json': json(s.procurement),
    'comments.json': json(s.comments),
    'dependencies.lock.json': json(s.dependencies),
    'firmware/main/main.ino': s.firmware,
    ...s.extraFirmware,
    'AGENTS.md': agents,
    ...Object.fromEntries(
      s.custom.map((d) => [
        'components/custom/' +
          d.typeId.split(':')[1] +
          '-' +
          d.version.replaceAll('.', '_') +
          '.json',
        json(d),
      ]),
    ),
  };
}
// Patch for whole-source operations that do not change custom definitions. Existing definition
// files keep their own names; regenerating them under the canonical name would duplicate them.
export function sourcePatch(s: Source, agents: string): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(sourceFiles(s, agents)).filter(
      ([name]) => !name.startsWith('components/custom/'),
    ),
  );
}
// While a simulation runs the sources are frozen: the simulator executes one compiled snapshot,
// so an edit would only make it stale. The lock file names its owner process, and every source
// writer (the UI, `hw` and anything else that goes through replaceSources) is refused. A writer
// that goes around the service, such as an editor or an agent writing the files directly, cannot
// be refused, so the owner watches for it and ends the simulation instead (see changedSources).
export const SIMULATION_LOCK = '.hw/simulation.lock';
export const PROJECT_LOCKED_MESSAGE =
  '模擬進行中，專案已鎖定：請先停止模擬，再修改畫布、接線或程式。';
export class ProjectLockedError extends Error {
  readonly code = 'LOCKED';
  constructor(message = PROJECT_LOCKED_MESSAGE) {
    super(message);
  }
}
interface SimulationLock {
  pid: number;
  since: string;
}
async function readSimulationLock(root: string): Promise<SimulationLock | null> {
  try {
    const lock = JSON.parse(await fs.readFile(await safePath(root, SIMULATION_LOCK), 'utf8'));
    return Number.isInteger(lock?.pid) ? lock : null;
  } catch {
    return null;
  }
}
const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};
// The current lock, or null. A lock whose owner process is gone (crash, kill) is released here,
// so a dead simulator can never leave a project frozen.
export async function projectLock(root: string) {
  const lock = await readSimulationLock(root);
  if (!lock) return null;
  if (lock.pid !== process.pid && !processAlive(lock.pid)) {
    await unlockProject(root);
    return null;
  }
  return lock;
}
export async function assertProjectUnlocked(root: string) {
  if (await projectLock(root)) throw new ProjectLockedError();
}
// Returns the frozen sources (file name to text), which the owner keeps to notice later changes.
export async function lockProject(root: string) {
  const frozen: Record<string, string> = {};
  for (const name of await sourceNames(root))
    try {
      frozen[name] = await fs.readFile(await safePath(root, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  await atomicWrite(
    root,
    SIMULATION_LOCK,
    json({ pid: process.pid, since: new Date().toISOString() }),
  );
  return frozen;
}
// Source files that no longer match what was frozen: edited, deleted or newly added. Nothing is
// touched; the caller decides what a change means (the simulator stops, see runtime.ts).
export async function changedSources(root: string, frozen: Record<string, string>) {
  const changed: string[] = [];
  for (const name of await sourceNames(root)) {
    const now = await fs.readFile(await safePath(root, name), 'utf8').catch(() => null);
    if (name in frozen ? now !== frozen[name] : now !== null) changed.push(name);
  }
  return changed;
}
// `owner` restricts the release to a lock this process took, so one process never frees another's.
export async function unlockProject(root: string, owner?: number) {
  const lock = await readSimulationLock(root);
  if (!lock || (owner !== undefined && lock.pid !== owner)) return;
  await fs.rm(await safePath(root, SIMULATION_LOCK), { force: true });
}
export async function replaceSources(root: string, files: Record<string, string>) {
  await assertProjectUnlocked(root);
  parseFiles(files);
  for (const [name, text] of Object.entries(files)) {
    if (!isSourceFile(name)) throw new Error('拒絕非來源檔案 ' + name);
    await atomicWrite(root, name, text);
  }
  for (const name of await sourceNames(root))
    if (!(name in files)) await fs.unlink(await safePath(root, name));
}
// Cross-process lock protects CLI and server. An abandoned lock is recovered when its PID no
// longer exists, or when it never received a PID (writer died between create and write).
export const LOCK_WRITE_GRACE_MS = 5000;
export async function withLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const lock = await safePath(root, '.hw/commit.lock', true);
  const start = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(lock, 'wx');
      await handle.writeFile(json({ pid: process.pid }));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let pid: unknown;
      try {
        pid = JSON.parse(await fs.readFile(lock, 'utf8')).pid;
      } catch {}
      if (!Number.isInteger(pid)) {
        const stat = await fs.stat(lock).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > LOCK_WRITE_GRACE_MS) {
          await fs.rm(lock, { force: true });
          continue;
        }
      } else
        try {
          process.kill(pid as number, 0);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
            await fs.rm(lock, { force: true });
            continue;
          }
        }
      if (Date.now() - start > 10000) throw new Error('專案正在提交，請稍後重試');
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}
