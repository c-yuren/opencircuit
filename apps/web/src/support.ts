// Injected by vite.config.ts at build time; absent when the module runs outside a Vite build.
declare const __APP_VERSION__: string | undefined;

// Feedback and update checks go to the public repository. Nothing here runs on its own: each
// request starts from a button, and no project content or local path is ever sent.
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const REPOSITORY = 'c-yuren/opencircuit';

export function issueUrl(environment: string, version = APP_VERSION) {
  const params = new URLSearchParams({ template: 'bug_report.yml', version, environment });
  return `https://github.com/${REPOSITORY}/issues/new?${params}`;
}

export function browserEnvironment() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

const numbers = (version: string) =>
  version
    .match(/(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1)
    .map(Number);

// Compares the numeric x.y.z part only, so a tag such as v0.1.0-portable equals 0.1.0.
export function compareVersions(a: string, b: string): number | null {
  const left = numbers(a),
    right = numbers(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export type UpdateResult =
  | { state: 'current'; latest: string; url: string }
  | { state: 'available'; latest: string; url: string }
  | { state: 'error'; error: string };

export async function checkForUpdate(
  request: typeof fetch = fetch,
  version = APP_VERSION,
): Promise<UpdateResult> {
  try {
    const response = await request(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) return { state: 'error', error: '尚未發佈任何版本' };
    if (!response.ok) return { state: 'error', error: 'GitHub 暫時無法回應' };
    const release = await response.json();
    const latest = String(release.tag_name ?? '');
    const url = String(release.html_url ?? '');
    const order = compareVersions(latest, version);
    if (order === null || !url.startsWith(`https://github.com/${REPOSITORY}/`))
      return { state: 'error', error: '無法辨識最新版本資訊' };
    return { state: order > 0 ? 'available' : 'current', latest, url };
  } catch {
    return { state: 'error', error: '無法連線到 GitHub' };
  }
}
