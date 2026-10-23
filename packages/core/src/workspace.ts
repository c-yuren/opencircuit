import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { capture, json, safePath, withLock } from './files';
import { ConflictError, current, getContext, initProject, saveFiles } from './project';

export type ProjectSummary = {
  folder: string;
  name: string;
  modifiedAt: string;
  components: number;
  board: string;
  status: string;
  error: string | null;
  sourceDigest: string;
  revision: string;
};

function projectName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80)
    throw new Error('請輸入專案名稱，最多 80 個字');
  return value.trim();
}

export async function projectPath(workspace: string, folder: unknown) {
  if (typeof folder !== 'string' || !/^[A-Za-z0-9_\-\u3400-\u9fff ]{1,80}$/.test(folder))
    throw new Error('專案資料夾名稱無效');
  const next = await safePath(workspace, folder);
  const real = await fs.realpath(next);
  if (!real.startsWith((await fs.realpath(workspace)) + path.sep))
    throw new Error('專案必須在工作區內');
  return real;
}

export async function listProjects(workspace: string): Promise<ProjectSummary[]> {
  const entries = await fs.readdir(workspace, { withFileTypes: true });
  const projects: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_\-\u3400-\u9fff ]{1,80}$/.test(entry.name)) continue;
    try {
      const root = await projectPath(workspace, entry.name);
      await fs.access(await safePath(root, 'project.json'));
      let context;
      try {
        context = await getContext(root);
      } catch (error) {
        projects.push({
          folder: entry.name,
          name: entry.name,
          modifiedAt: '',
          components: 0,
          board: '',
          status: 'invalid',
          error: (error as Error).message,
          sourceDigest: '',
          revision: '',
        });
        continue;
      }
      const stats = await Promise.all(
        Object.keys(context.files).map(async (file) => fs.stat(await safePath(root, file))),
      );
      projects.push({
        folder: entry.name,
        name: context.source.project.name,
        modifiedAt: new Date(Math.max(...stats.map((stat) => stat.mtimeMs))).toISOString(),
        components: context.source.circuit.instances.length,
        board: context.source.circuit.instances.some(
          (instance) => instance.id === context.source.project.board,
        )
          ? context.source.dependencies.fqbn
          : '',
        status: context.current.status,
        error: null,
        sourceDigest: context.sourceDigest,
        revision: context.current.revision,
      });
    } catch (error) {
      // A folder without project.json is not a project. Any other problem (a symlink or
      // junction, missing permission) is listed for that folder only, not for the whole list.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      projects.push({
        folder: entry.name,
        name: entry.name,
        modifiedAt: '',
        components: 0,
        board: '',
        status: 'invalid',
        error: (error as Error).message,
        sourceDigest: '',
        revision: '',
      });
    }
  }
  return projects.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function createWorkspaceProject(
  workspace: string,
  name: unknown,
  profile: unknown = 'blank',
) {
  const title = projectName(name);
  if (!['blank', 'led', 'oled', 'temperature'].includes(String(profile)))
    throw new Error('請選擇有效的範本');
  const folder = 'project_' + randomUUID().slice(0, 8);
  const destination = await safePath(workspace, folder);
  await createOrDiscard(destination, () =>
    initProject(destination, title, profile as 'led' | 'oled' | 'temperature' | 'blank').then(
      () => {},
    ),
  );
  return { folder };
}

export async function renameWorkspaceProject(
  workspace: string,
  body: {
    folder: string;
    name: string;
    expectedDigest: string;
    baseRevision: string;
  },
) {
  const root = await projectPath(workspace, body.folder);
  const context = await getContext(root);
  await saveFiles(
    root,
    { 'project.json': json({ ...context.source.project, name: projectName(body.name) }) },
    body.expectedDigest,
    body.baseRevision,
  );
}

export async function copyWorkspaceProject(
  workspace: string,
  body: {
    folder: string;
    name: string;
    expectedDigest: string;
    baseRevision: string;
  },
) {
  const title = projectName(body.name);
  const sourceRoot = await projectPath(workspace, body.folder);
  const source = await withLock(sourceRoot, async () => {
    const captured = await capture(sourceRoot);
    if (
      captured.sourceDigest !== body.expectedDigest ||
      (await current(sourceRoot)).revision !== body.baseRevision
    )
      throw new ConflictError('專案已更新，請重新整理後再複製');
    return captured;
  });
  const folder = 'project_' + randomUUID().slice(0, 8);
  const destination = await safePath(workspace, folder);
  await createOrDiscard(destination, async () => {
    await initProject(destination, title);
    const context = await getContext(destination);
    await saveFiles(
      destination,
      {
        ...source.files,
        'project.json': json({ ...source.source.project, name: title }),
        'comments.json': json(
          source.source.comments.map((comment) => ({
            ...comment,
            baseRevision: context.current.revision,
          })),
        ),
      },
      context.sourceDigest,
      context.current.revision,
    );
  });
  return { folder };
}
export const TRASH_FOLDER = '.trash';

// Deleting moves the folder into the workspace's hidden trash instead of erasing it, so a
// mistaken click can be undone by moving the folder back. Listing skips dot folders.
export async function deleteWorkspaceProject(
  workspace: string,
  body: { folder: string; expectedDigest: string; baseRevision: string },
) {
  const root = await projectPath(workspace, body.folder);
  // A project whose source cannot be read has no digest to compare, so it may be removed as is.
  await withLock(root, async () => {
    let captured;
    try {
      captured = await capture(root);
    } catch {
      return;
    }
    if (
      captured.sourceDigest !== body.expectedDigest ||
      (await current(root)).revision !== body.baseRevision
    )
      throw new ConflictError('專案已更新，請重新整理後再刪除');
  });
  const trash = path.join(await fs.realpath(workspace), TRASH_FOLDER);
  await fs.mkdir(trash, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(trash, path.basename(root) + '-' + stamp);
  // Windows can briefly keep a file watcher's handle on the folder after it is unwatched.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(root, destination);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EBUSY' && code !== 'EPERM')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  return { folder: body.folder, trash: path.join(TRASH_FOLDER, path.basename(destination)) };
}

// A new project folder is either completed or removed, never left half-initialised.
async function createOrDiscard(destination: string, create: () => Promise<void>) {
  try {
    await create();
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}
