import { appUrl } from './deployment';
import { t } from './i18n';

export async function api(route: string, body?: unknown) {
  const response = await fetch(
    appUrl('/api/' + route),
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(t('專案服務尚未更新或連線不正確，請重新啟動服務後再試。'));
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(t('服務回傳的資料不完整，請重新整理後再試。'));
  }
  if (!response.ok) throw new Error(t(result?.error ?? '操作未完成，請稍後再試。'));
  return result;
}
