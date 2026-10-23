import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import type { Source, Snapshot, Current, Comment, BuildResult } from './model';
import {
  calculateBom,
  checkRules,
  costDigest,
  digest,
  electricalDigest,
  generatePinmap,
  definitionFor,
  resolvePin,
} from './analysis';
import {
  atomicWrite,
  capture,
  json,
  parseFiles,
  readJson,
  replaceSources,
  projectLock,
  assertProjectUnlocked,
  safePath,
  sourceFiles,
  withLock,
  isSourceFile,
  isFirmwareSource,
  ignoredSourceFiles,
  sourcePatch,
} from './files';
import { compile, notBuilt } from './compiler';
import { example, projectAgentInstructions, agentPointerFiles } from './catalog';
import { validateDefinition, validateSource } from './schema';
import { estimatedConsumables, automaticWireColor } from './planning';
const newId = () =>
  new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + randomUUID().slice(0, 8);
export class ConflictError extends Error {
  code = 'CONFLICT';
}
export async function current(root: string) {
  return readJson<Current>(root, '.hw/current.json');
}
export async function revision(root: string, id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('無效版本 ID');
  return readJson<Snapshot>(root, `.hw/history/${id}/snapshot.json`);
}
// History is immutable: refuse to replace a record, and write through temp + rename so an
// interrupted write never leaves a truncated snapshot.json behind.
async function saveSnapshot(root: string, snapshot: Snapshot) {
  const file = `.hw/history/${snapshot.id}/snapshot.json`;
  if (
    await fs
      .access(await safePath(root, file))
      .then(() => true)
      .catch(() => false)
  )
    throw new Error('版本紀錄已存在，拒絕覆寫：' + snapshot.id);
  await atomicWrite(root, file, json(snapshot));
}
export function generatedFiles(source: Source) {
  let pinmap: string;
  try {
    pinmap = generatePinmap(source);
  } catch {
    pinmap = '#error "OpenCircuit: unresolved pin binding; run hw check"\n';
  }
  return {
    'firmware/main/pinmap.h': pinmap,
    'bom.json': json(calculateBom(source)),
  };
}
async function generated(root: string, s: Source) {
  await atomicWrite(root, 'bom.json', json(calculateBom(s)));
  try {
    await atomicWrite(root, 'firmware/main/pinmap.h', generatePinmap(s));
  } catch {
    await atomicWrite(
      root,
      'firmware/main/pinmap.h',
      '#error "OpenCircuit: unresolved pin binding; run hw check"\n',
    );
  }
}
export function makeSnapshot(
  files: Record<string, string>,
  baseRevision: string,
  build?: BuildResult,
): Snapshot {
  const s = parseFiles(files);
  const diagnostics = checkRules(s);
  const b = build ?? notBuilt(s);
  const status =
    diagnostics.some((d) => d.state === 'fail') || b.state === 'fail'
      ? 'failed'
      : diagnostics.some((d) => d.state === 'unknown') || b.state !== 'pass'
        ? 'draft'
        : 'ready';
  return {
    id: newId(),
    baseRevision,
    sourceDigest: digest(files),
    electricalDigest: electricalDigest(s),
    costDigest: costDigest(s),
    createdAt: new Date().toISOString(),
    files,
    diagnostics,
    build: b,
    bom: calculateBom(s),
    status,
  };
}
// CLAUDE.md / GEMINI.md point agents that do not read AGENTS.md at the shared instructions. They
// are not project sources (no digest, snapshot or restore), are only created when missing and
// are never overwritten, so a user's own version survives.
export async function ensureAgentFiles(root: string) {
  for (const [name, text] of Object.entries(agentPointerFiles)) {
    const file = await safePath(root, name, true);
    await fs.writeFile(file, text, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'EEXIST') throw e;
    });
  }
}
export async function initProject(
  root: string,
  name: string,
  profile: 'led' | 'oled' | 'temperature' | 'blank' = 'led',
) {
  await fs.mkdir(root, { recursive: true });
  if ((await fs.readdir(root)).length) throw new Error('專案目錄必須為空，避免覆寫既有檔案');
  const s = example(profile === 'blank' ? 'led' : profile, name);
  if (profile === 'blank') {
    s.project.profile = 'custom';
    s.circuit.instances = [];
    s.project.board = '';
    s.circuit.nets = [];
    s.circuit.bindings = [];
    s.layout = {};
    s.firmware = 'void setup() {}\nvoid loop() {}\n';
  }
  validateSource(s);
  await fs.mkdir(path.join(root, 'components/custom'), { recursive: true });
  const files = sourceFiles(s, projectAgentInstructions);
  await replaceSources(root, files);
  await ensureAgentFiles(root);
  const snapshot = makeSnapshot(files, 'initial');
  snapshot.status = 'open';
  await saveSnapshot(root, snapshot);
  await generated(root, s);
  await atomicWrite(
    root,
    '.hw/current.json',
    json({ revision: snapshot.id, draft: null, selection: null, status: 'open' } satisfies Current),
  );
  return snapshot;
}
export interface HistoryEntry {
  id: string;
  baseRevision: string;
  createdAt: string;
  status: Snapshot['status'];
  restoredFrom?: string;
  sourceDigest: string;
  electricalDigest: string;
  buildState: BuildResult['state'];
  toolDigest?: string;
}
// Snapshots never change after they are written, so parsed summaries are reused until the
// file's size or mtime changes. Full snapshots are read only when actually needed.
const historyCache = new Map<
  string,
  { mtimeMs: number; size: number; entry: HistoryEntry | null; error: string | null }
>();
function summarizeSnapshot(id: string, value: unknown): HistoryEntry {
  const s = value as Partial<Snapshot> | null;
  if (
    !s ||
    typeof s !== 'object' ||
    s.id !== id ||
    typeof s.baseRevision !== 'string' ||
    typeof s.createdAt !== 'string' ||
    typeof s.sourceDigest !== 'string' ||
    typeof s.electricalDigest !== 'string' ||
    !s.files ||
    typeof s.files !== 'object' ||
    !s.build ||
    typeof s.build.state !== 'string'
  )
    throw new Error('版本紀錄格式不完整');
  return {
    id,
    baseRevision: s.baseRevision,
    createdAt: s.createdAt,
    status: s.status as Snapshot['status'],
    ...(s.restoredFrom ? { restoredFrom: s.restoredFrom } : {}),
    sourceDigest: s.sourceDigest,
    electricalDigest: s.electricalDigest,
    buildState: s.build.state,
    ...(s.build.toolDigest ? { toolDigest: s.build.toolDigest } : {}),
  };
}
// Unreadable records are reported in `issues` instead of making the whole project unopenable.
export async function history(root: string) {
  const names = (await fs.readdir(await safePath(root, '.hw/history'))).filter((n) =>
    /^[A-Za-z0-9_-]+$/.test(n),
  );
  const results = await Promise.all(
    names.map(async (id) => {
      try {
        const file = await safePath(root, `.hw/history/${id}/snapshot.json`);
        const stat = await fs.stat(file);
        let cached = historyCache.get(file);
        if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
          cached = { mtimeMs: stat.mtimeMs, size: stat.size, entry: null, error: null };
          try {
            cached.entry = summarizeSnapshot(id, JSON.parse(await fs.readFile(file, 'utf8')));
          } catch (e) {
            cached.error = (e as Error).message;
          }
          historyCache.set(file, cached);
        }
        return cached.entry ? { entry: cached.entry } : { issue: `${id}: ${cached.error}` };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
        return { issue: `${id}: ${(e as Error).message}` };
      }
    }),
  );
  return {
    entries: results
      .flatMap((r) => (r.entry ? [r.entry] : []))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    issues: results.flatMap((r) => (r.issue ? [r.issue] : [])),
  };
}
// A pointer update is the commit point. Recover an interrupted multi-file restore on the next open.
export async function recover(root: string) {
  await projectLock(root); // releases a lock left behind by a simulator that no longer exists
  await withLock(root, async () => {
    const p = await safePath(root, '.hw/transaction.json');
    let t: { before: Record<string, string>; after: Record<string, string>; newRevision: string };
    try {
      t = JSON.parse(await fs.readFile(p, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const c = await current(root);
    const files = c.revision === t.newRevision ? t.after : t.before;
    await replaceSources(root, files);
    await generated(root, parseFiles(files));
    await fs.unlink(p);
  });
}
export async function getContext(root: string) {
  if (
    await fs
      .access(await safePath(root, '.hw/transaction.json'))
      .then(() => true)
      .catch(() => false)
  )
    throw new Error('正在提交完整來源，請稍後重試');
  const c = await current(root);
  const cap = await capture(root);
  const diagnostics = checkRules(cap.source);
  if (diagnostics.some((d) => d.ruleId === 'reference' && d.state === 'fail'))
    throw new Error(
      diagnostics
        .filter((d) => d.ruleId === 'reference' && d.state === 'fail')
        .map((d) => d.target + ': ' + d.reason)
        .join('\n'),
    );
  const records = await history(root);
  const summaries = new Map(records.entries.map((entry) => [entry.id, entry]));
  const reportId = [c.draft, c.revision].find(
    (id) => id && summaries.get(id)?.sourceDigest === cap.sourceDigest,
  );
  const report = reportId ? await revision(root, reportId).catch(() => null) : null;
  if (!summaries.has(c.revision) && !records.issues.some((i) => i.startsWith(c.revision + ':')))
    records.issues.push(`${c.revision}: 目前選取版本的紀錄不存在`);
  const ignored = await ignoredSourceFiles(root);
  const status =
    c.status === 'checking'
      ? 'checking'
      : report?.id === c.revision
        ? c.status
        : (report?.status ?? 'draft');
  return {
    root: path.resolve(root),
    current: { ...c, status },
    source: cap.source,
    files: cap.files,
    generatedFiles: generatedFiles(cap.source),
    sourceDigest: cap.sourceDigest,
    electricalDigest: electricalDigest(cap.source),
    bom: calculateBom(cap.source),
    suggestions: {
      consumables: estimatedConsumables(cap.source),
      wireColors: Object.fromEntries(
        cap.source.circuit.nets.map((net) => [
          net.id,
          automaticWireColor(cap.source, net.endpoints),
        ]),
      ),
    },
    report,
    history: records.entries.map(({ id, baseRevision, createdAt, status, restoredFrom }) => ({
      id,
      baseRevision,
      createdAt,
      status,
      restoredFrom,
    })),
    warnings: [
      ...records.issues.map((issue) => '略過無法讀取的版本紀錄 ' + issue),
      ...ignored.map((name) => '略過不符合命名規則的檔案 ' + name + '（只允許英數、_、-）'),
    ],
  };
}
// `toolFingerprint` (the current environment fingerprint) lets a check reuse a passing build
// with the same electrical digest; without it a check never reuses builds, because the
// toolchain may have changed since. A build always compares against a fresh environment.
export async function inspect(
  root: string,
  doBuild = false,
  options: import('./process').ProcessOptions = {},
  toolFingerprint?: string,
) {
  type Prepared =
    | { reused: Snapshot }
    | {
        reused: null;
        cap: Awaited<ReturnType<typeof capture>>;
        c: Current;
        snapshot: Snapshot;
      };
  const { validBuildArtifacts } = await import('./compiler');
  // A cached build is a passing history record with the same electrical digest, an accepted
  // tool fingerprint and artifacts that still exist with matching SHA-256.
  const findCached = async (
    electricalDigest: string,
    accepts: (toolDigest: string | undefined) => boolean,
  ) => {
    for (const r of (await history(root)).entries) {
      if (
        r.electricalDigest !== electricalDigest ||
        r.buildState !== 'pass' ||
        !accepts(r.toolDigest)
      )
        continue;
      const full = await revision(root, r.id).catch(() => null);
      if (full && (await validBuildArtifacts(root, full.build))) return full;
    }
    return undefined;
  };
  const prepare = (allowReuse: boolean) =>
    withLock(root, async (): Promise<Prepared> => {
      const cap = await capture(root);
      const c = await current(root);
      // A check of unchanged sources reuses the current draft record instead of appending a
      // duplicate snapshot to the immutable history on every automatic check.
      if (allowReuse && !doBuild && c.draft) {
        const existing = await revision(root, c.draft).catch(() => null);
        if (
          existing &&
          existing.sourceDigest === cap.sourceDigest &&
          existing.baseRevision === c.revision &&
          existing.status !== 'conflict'
        )
          return { reused: existing };
      }
      const snapshot = makeSnapshot(cap.files, c.revision);
      await atomicWrite(root, '.hw/current.json', json({ ...c, status: 'checking' }));
      return { reused: null, cap, c, snapshot };
    });
  // The reuse is only valid while the draft's build result still matches the current
  // environment; this scans history and artifacts, so it runs outside the project lock.
  const draftStillValid = async (draft: Snapshot) =>
    draft.build.state === 'pass'
      ? Boolean(toolFingerprint) &&
        draft.build.toolDigest === toolFingerprint &&
        (await validBuildArtifacts(root, draft.build))
      : !toolFingerprint ||
        !(await findCached(draft.electricalDigest, (t) => t === toolFingerprint));
  let prepared = await prepare(true);
  if (prepared.reused !== null) {
    if (await draftStillValid(prepared.reused)) return prepared.reused;
    prepared = await prepare(false);
  }
  if (prepared.reused !== null) throw new Error('檢查準備失敗');
  const { cap, c, snapshot } = prepared;
  try {
    const { environment } = await import('./environment');
    const tool = doBuild ? await environment(cap.source, options) : null;
    const cached = await findCached(snapshot.electricalDigest, (t) =>
      doBuild
        ? Boolean(tool?.compileReady) && t === tool?.fingerprint
        : Boolean(toolFingerprint) && t === toolFingerprint,
    );
    if (cached) snapshot.build = { ...cached.build, cachedFrom: cached.id };
    else if (doBuild && !snapshot.diagnostics.some((d) => d.state === 'fail'))
      snapshot.build = await compile(root, snapshot.id, cap.source, options);
    else if (doBuild) snapshot.build = notBuilt(cap.source, '電氣規則失敗，尚未執行編譯');
    snapshot.status =
      snapshot.diagnostics.some((d) => d.state === 'fail') || snapshot.build.state === 'fail'
        ? 'failed'
        : snapshot.diagnostics.some((d) => d.state === 'unknown') || snapshot.build.state !== 'pass'
          ? 'draft'
          : 'ready';
    await withLock(root, async () => {
      const latest = await current(root);
      let same = false;
      try {
        same =
          (await capture(root)).sourceDigest === snapshot.sourceDigest &&
          latest.revision === c.revision;
      } catch {}
      if (!same) snapshot.status = 'conflict';
      await saveSnapshot(root, snapshot);
      if (same) await generated(root, cap.source);
      await atomicWrite(
        root,
        '.hw/current.json',
        json({ ...latest, draft: snapshot.id, status: same ? snapshot.status : 'conflict' }),
      );
    });
    return snapshot;
  } catch (e) {
    await withLock(root, async () => {
      const latest = await current(root);
      await atomicWrite(root, '.hw/current.json', json({ ...latest, status: 'failed' }));
    });
    throw e;
  }
}
export async function saveFiles(
  root: string,
  patch: Record<string, string | null>,
  expectedDigest: string,
  baseRevision?: string,
) {
  return withLock(root, async () => {
    const cap = await capture(root);
    const c = await current(root);
    if (cap.sourceDigest !== expectedDigest || (baseRevision && baseRevision !== c.revision))
      throw new ConflictError('來源或 base revision 已更新；請重新載入後合併');
    const files = { ...cap.files };
    for (const [name, value] of Object.entries(patch)) {
      if (!isSourceFile(name)) throw new Error('只能修改專案來源檔案');
      if (value === null) {
        if (
          !name.startsWith('components/custom/') &&
          !(isFirmwareSource(name) && name !== 'firmware/main/main.ino')
        )
          throw new Error('必要檔案不可刪除');
        delete files[name];
      } else files[name] = value;
    }
    const next = parseFiles(files);
    const controllerCount = (source: Source) =>
      source.circuit.instances.filter(
        (instance) => definitionFor(source, instance)?.category === 'controller',
      ).length;
    if (controllerCount(next) > 1 && controllerCount(next) > controllerCount(cap.source))
      throw new Error('一個專案只能使用一個主控制器');
    await transactionalWrite(root, files, cap.files, c, { ...c, draft: null, status: 'draft' });
    return { sourceDigest: digest(files) };
  });
}
async function transactionalWrite(
  root: string,
  after: Record<string, string>,
  before: Record<string, string>,
  oldCurrent: Current,
  newCurrent: Current,
) {
  // Refuse before the transaction marker exists: a refusal inside the transaction would leave the
  // marker behind and make the project unreadable ("正在提交完整來源") until the service restarts.
  await assertProjectUnlocked(root);
  // Draft edits use a unique marker which cannot match the committed revision; interrupted edits roll back.
  const marker =
    newCurrent.revision === oldCurrent.revision ? 'draft-' + newId() : newCurrent.revision;
  await atomicWrite(root, '.hw/transaction.json', json({ before, after, newRevision: marker }));
  try {
    await replaceSources(root, after);
    await generated(root, parseFiles(after));
    await atomicWrite(root, '.hw/current.json', json(newCurrent));
    await fs.unlink(await safePath(root, '.hw/transaction.json'));
  } catch (e) {
    await replaceSources(root, before);
    await generated(root, parseFiles(before));
    await atomicWrite(root, '.hw/current.json', json(oldCurrent));
    await fs.rm(await safePath(root, '.hw/transaction.json'), { force: true });
    throw e;
  }
}
export async function applyRevision(root: string, id: string) {
  return withLock(root, async () => {
    const target = await revision(root, id);
    const c = await current(root);
    const cap = await capture(root);
    if (target.baseRevision !== c.revision || target.sourceDigest !== cap.sourceDigest)
      throw new ConflictError('拒絕套用：base revision 過期或来源已變更');
    if (
      target.status !== 'ready' ||
      target.build.state !== 'pass' ||
      target.diagnostics.some((d) => d.state !== 'pass')
    )
      throw new Error('只能套用規則及實際編譯皆通過的 ready 快照');
    await generated(root, cap.source);
    await atomicWrite(
      root,
      '.hw/current.json',
      json({ ...c, revision: id, draft: null, status: 'applied' }),
    );
    return target;
  });
}
export async function rollback(
  root: string,
  id: string,
  expectedDigest?: string,
  expectedRevision?: string,
) {
  return withLock(root, async () => {
    const target = await revision(root, id);
    const c = await current(root);
    const cap = await capture(root);
    if (
      (expectedDigest && expectedDigest !== cap.sourceDigest) ||
      (expectedRevision && expectedRevision !== c.revision)
    )
      throw new ConflictError('還原前來源已變更，請重新檢視');
    const restored = makeSnapshot(target.files, c.revision, target.build);
    restored.restoredFrom = id;
    // Restoring always selects the record, but only a fully passing one counts as applied;
    // a failed or unchecked record keeps that status so the UI does not present it as ready.
    if (restored.status === 'ready') restored.status = 'applied';
    await saveSnapshot(root, restored);
    await transactionalWrite(root, target.files, cap.files, c, {
      ...c,
      revision: restored.id,
      draft: null,
      status: restored.status,
    });
    return restored;
  });
}
export async function diffRevision(root: string, id: string) {
  const old = await revision(root, id);
  const cap = await capture(root);
  const names = [...new Set([...Object.keys(old.files), ...Object.keys(cap.files)])].sort();
  return names
    .filter((n) => old.files[n] !== cap.files[n])
    .map((n) => ({
      file: n,
      patch: createTwoFilesPatch(n, n, old.files[n] ?? '', cap.files[n] ?? '', id, 'working draft'),
    }));
}
export async function setSelection(root: string, target: Comment['target'] | null) {
  return withLock(root, async () => {
    const { source } = await capture(root);
    if (target) validateTarget(source, target);
    const c = await current(root);
    await atomicWrite(root, '.hw/current.json', json({ ...c, selection: target }));
  });
}
export function validateTarget(s: Source, t: Comment['target']) {
  const valid =
    t.kind === 'instance'
      ? s.circuit.instances.some((i) => i.id === t.id)
      : t.kind === 'pin'
        ? !!resolvePin(s, t.id)
        : t.kind === 'net'
          ? s.circuit.nets.some((n) => n.id === t.id)
          : false;
  if (!valid) throw new Error('選取目標不存在');
}
export async function addCustom(root: string, value: unknown, expectedDigest: string) {
  validateDefinition(value);
  if (!value.typeId.startsWith('custom:')) throw new Error('自訂定義須使用 custom: 命名空間');
  const cap = await capture(root);
  if (
    [...cap.source.catalog.definitions, ...cap.source.custom].some(
      (d) => d.typeId === value.typeId && d.version === value.version,
    )
  )
    throw new Error('相同 type ID 與定義版本已存在；請建立新版本');
  const file =
    'components/custom/' +
    value.typeId.split(':')[1] +
    '-' +
    value.version.replaceAll('.', '_') +
    '.json';
  // A hand-named definition may already occupy the canonical file name; never overwrite it.
  if (file in cap.files) throw new Error('自訂定義檔 ' + file + ' 已被其他定義使用，請先改名');
  return saveFiles(root, { [file]: json(value) }, expectedDigest);
}
export async function replaceTemplate(
  root: string,
  profile: 'led' | 'oled' | 'temperature',
  expectedDigest: string,
) {
  if (!['led', 'oled', 'temperature'].includes(profile)) throw new Error('未知範本');
  const cap = await capture(root);
  const next = example(profile, cap.source.project.name);
  next.procurement = cap.source.procurement;
  next.custom = cap.source.custom;
  next.comments = cap.source.comments;
  const patch = sourcePatch(next, cap.files['AGENTS.md']);
  for (const name of Object.keys(cap.source.extraFirmware)) patch[name] = null;
  return saveFiles(root, patch, expectedDigest);
}
export async function replaceComponent(
  root: string,
  id: string,
  typeId: string,
  version: string,
  expectedDigest: string,
) {
  const cap = await capture(root);
  const s = cap.source;
  const i = s.circuit.instances.find((x) => x.id === id);
  const d = [...s.catalog.definitions, ...s.custom].find(
    (x) => x.typeId === typeId && x.version === version,
  );
  if (!i || !d) throw new Error('元件或定義不存在');
  const old = definitionFor(s, i);
  if (old && s.procurement.locked.includes((await import('./analysis')).bomKey(old, i)))
    throw new Error('此型號已鎖定，請先在採購設定解除');
  i.typeId = typeId;
  i.definitionVersion = version;
  i.parameters = { ...d.parameters };
  s.circuit.nets = s.circuit.nets
    .map((n) => ({
      ...n,
      endpoints: n.endpoints.filter(
        (e) => !e.startsWith(id + '.') || d.pins.some((p) => e === id + '.' + p.id),
      ),
    }))
    .filter((n) => n.endpoints.length >= 2);
  s.circuit.bindings = s.circuit.bindings.filter(
    (b) => !b.endpoint.startsWith(id + '.') || d.pins.some((p) => b.endpoint === id + '.' + p.id),
  );
  if (d.driver && !s.dependencies.libraries.some((l) => l.name === d.driver!.name))
    s.dependencies.libraries.push(d.driver);
  s.project.profile = 'custom';
  return saveFiles(
    root,
    {
      'circuit.json': json(s.circuit),
      'dependencies.lock.json': json(s.dependencies),
      'project.json': json(s.project),
    },
    expectedDigest,
  );
}
