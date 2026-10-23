import { useEffect, useRef } from 'react';
import { useT } from './i18n';

const names: Record<string, string> = {
  simulate: '模擬',
  compile: '編譯',
  upload: '寫入板子',
  export: '匯出',
};
// Stages follow the phases Runtime.execute actually reports; no invented percentages.
const finalStage: Record<string, [string, RegExp] | undefined> = {
  simulate: ['載入韌體並開始模擬', /載入已編譯韌體/],
  upload: ['寫入板子', /燒錄/],
  export: ['打包匯出', /匯出外部/],
};
function stagesFor(kind: string) {
  const stages: [string, RegExp][] = [
    ['準備', /已建立工作/],
    ['檢查與編譯', /編譯/],
  ];
  const last = finalStage[kind];
  return last ? [...stages, last] : stages;
}

// Modal while a compile-based job runs: edits wait until it finishes or is cancelled.
export function JobProgress({
  job,
  esp32,
  onCancel,
}: {
  job: { id: string; kind: string; phase: string; startedAt?: string };
  esp32: boolean;
  onCancel: () => void;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  const stages = stagesFor(job.kind);
  let current = 0;
  stages.forEach(([, pattern], index) => {
    if (pattern.test(job.phase ?? '')) current = index;
  });
  const elapsed = job.startedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(job.startedAt)) / 1000))
    : null;
  const compiling = stages[current][0] === '檢查與編譯';
  return (
    <dialog
      ref={dialog}
      className="project-dialog job-progress"
      aria-labelledby="job-progress-title"
      onCancel={(event) => event.preventDefault()}
    >
      <h2 id="job-progress-title">{t('{name}進行中', { name: t(names[job.kind] ?? job.kind) })}</h2>
      <ol className="job-stages" aria-label={t('工作階段')}>
        {stages.map(([label], index) => (
          <li
            key={label}
            className={index < current ? 'done' : index === current ? 'active' : ''}
            aria-current={index === current ? 'step' : undefined}
          >
            <span className="job-stage-bar" />
            <small>{t(label)}</small>
          </li>
        ))}
      </ol>
      <p>
        {t('第 {current}／{total} 階段：{phase}', {
          current: current + 1,
          total: stages.length,
          phase: t(job.phase ?? ''),
        })}
        {elapsed !== null && t(' · 已 {seconds} 秒', { seconds: elapsed })}
      </p>
      {compiling && (
        <p className="muted">
          {t(esp32 ? 'ESP32 首次編譯約需 1–2 分鐘' : '通常不到 30 秒')}
          {t('；內容沒變時會沿用上次的編譯結果。完成或取消後才能繼續修改。')}
        </p>
      )}
      <div className="form-actions">
        <button className="danger" onClick={onCancel}>
          {t('取消工作')}
        </button>
      </div>
    </dialog>
  );
}
