import { useEffect, useState } from 'react';
import { Dialog } from './Ui';
import { useT } from './i18n';
import {
  APP_VERSION,
  browserEnvironment,
  checkForUpdate,
  issueUrl,
  type UpdateResult,
} from './support';

export function openIssueReport() {
  window.open(issueUrl(browserEnvironment()), '_blank', 'noopener,noreferrer');
}

// Mounting this dialog is the only thing that contacts GitHub for update information.
export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    void checkForUpdate().then((next) => {
      if (active) setResult(next);
    });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <Dialog title={t('檢查更新')} onClose={onClose} className="update-dialog">
      <p>{t('目前版本 {version}', { version: APP_VERSION })}</p>
      <div role="status" className="update-result">
        {!result && <p>{t('正在向 GitHub 查詢最新版本…')}</p>}
        {result?.state === 'current' && (
          <p>{t('已是最新版本（最新發佈 {latest}）', { latest: result.latest })}</p>
        )}
        {result?.state === 'available' && (
          <>
            <p>{t('有新版本 {latest}', { latest: result.latest })}</p>
            <a href={result.url} target="_blank" rel="noopener noreferrer">
              {t('前往下載頁面')}
            </a>
          </>
        )}
        {result?.state === 'error' && (
          <>
            <p>{t('無法查詢更新：{error}', { error: t(result.error) })}</p>
            <button onClick={() => setAttempt((value) => value + 1)}>{t('重試')}</button>
          </>
        )}
      </div>
      <p className="muted">{t('只有按下「檢查更新」時才會連線到 GitHub，不會傳送專案內容。')}</p>
    </Dialog>
  );
}
