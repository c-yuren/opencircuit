import { zipSync, strToU8 } from 'fflate';
import { capture, json } from './files';
import { ConflictError, current, generatedFiles, makeSnapshot } from './project';
export async function exportSnapshot(
  root: string,
  kind: 'program' | 'project',
  expectedDigest: string,
  baseRevision: string,
) {
  if (!['program', 'project'].includes(kind)) throw new Error('不支援的匯出格式');
  const cap = await capture(root),
    revision = await current(root);
  if (cap.sourceDigest !== expectedDigest || revision.revision !== baseRevision)
    throw new ConflictError('匯出來源已更新，請重新確認版本');
  const files: Record<string, string> = { ...cap.files, ...generatedFiles(cap.source) };
  if (kind === 'program')
    for (const name of Object.keys(files))
      if (
        !name.startsWith('firmware/') &&
        !['dependencies.lock.json', 'project.json'].includes(name)
      )
        delete files[name];
  if (kind === 'project') {
    const snapshot = makeSnapshot(cap.files, '');
    files['.hw/current.json'] = json({
      revision: snapshot.id,
      draft: null,
      selection: null,
      status: 'draft',
    });
    files['.hw/history/' + snapshot.id + '/snapshot.json'] = json(snapshot);
  }
  files['OpenCircuit-export.json'] = json({
    format: 1,
    kind,
    sourceDigest: cap.sourceDigest,
    baseRevision,
    createdAt: new Date().toISOString(),
  });
  files['BUILD-README.txt'] =
    `OpenCircuit saved-source export\nTarget: ${cap.source.dependencies.fqbn}\nCore: ${cap.source.dependencies.core.name}@${cap.source.dependencies.core.version}\nLibraries: ${cap.source.dependencies.libraries.map((library) => library.name + '@' + library.version).join(', ')}\nInstall the locked Arduino core and libraries, then run:\narduino-cli compile --fqbn ${cap.source.dependencies.fqbn} firmware/main\nThis archive is not a successful compilation or hardware upload.\nSource digest: ${cap.sourceDigest}\n`;
  return {
    bytes: zipSync(
      Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])),
    ),
    sourceDigest: cap.sourceDigest,
  };
}
