import { appUrl } from './deployment';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runtimePost } from './LocalTools';
import { api } from './api';
import { getLocale, translateLog, useT } from './i18n';

const STORAGE_KEY = 'opencircuit.onboarded';
export const onboardingSeen = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* The guide simply shows again next time when storage is unavailable. */
  }
};

type EnvItem = { id: string; name: string; ready: boolean; installable: boolean; reason: string };
type Job = { id: string; kind: string; state: string; phase: string; log: string; error?: string };
type RuntimeState = { environment?: { items: EnvItem[] } | null; jobs?: Job[] };

const steps = ['歡迎', '安裝環境', '認識介面', '開始'];
const templates = [
  { profile: 'led', name: 'LED 閃爍' },
  { profile: 'oled', name: '螢幕顯示' },
  { profile: 'temperature', name: '溫度提醒' },
];

function EnvironmentStep() {
  const t = useT();
  const [state, setState] = useState<RuntimeState | null>(null);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(appUrl('/api/runtime/state'));
      if (!response.ok) throw new Error('服務回應失敗');
      const data = await response.json();
      if (alive.current) {
        setState(data);
        setConnected(true);
      }
    } catch {
      if (alive.current) setConnected(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (alive.current) timer = setTimeout(poll, 800);
    };
    void poll();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  const act = async (name: string, body: unknown = {}) => {
    setWorking(true);
    setError('');
    try {
      await runtimePost(name, body);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const install = async () => {
    setWorking(true);
    setError('');
    try {
      // The install job is bound to the open project's board, so it carries that revision.
      const { context } = await api('context');
      await runtimePost('job', {
        kind: 'install',
        expectedDigest: context.sourceDigest,
        baseRevision: context.current.revision,
      });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const items = state?.environment?.items;
  const running = state?.jobs?.find((job) => job.kind === 'install' && job.state === 'running');
  const failed = [...(state?.jobs ?? [])].reverse().find((job) => job.kind === 'install');
  const missing = items?.filter((item) => !item.ready && item.installable) ?? [];
  const blocked = items?.filter((item) => !item.ready && !item.installable) ?? [];
  const busy = working || !!running;
  return (
    <div className="onboarding-env">
      <p>
        {t('編輯電路與材料清單不需要額外工具。若要')}
        <strong>{t('編譯、模擬或寫入板子')}</strong>
        {t('，需要 Arduino CLI、板子核心與模擬引擎，這裡可以一鍵檢查並安裝。')}
      </p>
      {!connected && (
        <p role="alert" className="error-text">
          {t('本機服務未連線，請確認終端機中的服務仍在執行。')}
        </p>
      )}
      <div className="environment-list" aria-label={t('環境檢查結果')}>
        {items ? (
          items.map((item) => (
            <div key={item.id}>
              <span>
                {item.ready ? '✓' : '○'} {t(item.name)}
              </span>
              <small>{t(item.reason)}</small>
            </div>
          ))
        ) : (
          <p role="status">{t('正在檢查環境…')}</p>
        )}
      </div>
      {items && !missing.length && !blocked.length && (
        <p role="status" className="onboarding-ok">
          ✓ {t('環境已就緒，可以編譯與模擬。')}
        </p>
      )}
      {blocked.length > 0 && (
        <p role="alert" className="error-text">
          {blocked.map((item) => item.name).join('、')} {t('無法自動安裝，請依')}{' '}
          <a href="https://nodejs.org/" target="_blank" rel="noreferrer">
            {t('官方說明')}
          </a>{' '}
          {t('手動處理。')}
        </p>
      )}
      {running && (
        <div className="install-banner installing">
          <div className="install-banner-header">
            <strong>⚙ {t('正在安裝（{phase}）…', { phase: t(running.phase ?? '') })}</strong>
            <button onClick={() => void act('cancel', { id: running.id })}>{t('取消安裝')}</button>
          </div>
          {running.log && (
            <pre className="install-banner-log">
              {translateLog(running.log.trim().split('\n').slice(-4).join('\n'))}
            </pre>
          )}
        </div>
      )}
      {!running && failed && failed.state === 'fail' && (
        <p role="alert" className="error-text">
          {t('上次安裝失敗：')}
          {t(failed.error ?? '請查看工具設定中的輸出')}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="form-actions onboarding-env-actions">
        <button disabled={busy || !connected} onClick={() => void act('environment')}>
          {t('重新檢查')}
        </button>
        {missing.length > 0 && (
          <button className="primary" disabled={busy || !connected} onClick={() => void install()}>
            {t('安裝缺少套件')}
          </button>
        )}
      </div>
      <p className="muted">
        {t(
          '安裝會連線到 Arduino／Espressif 官方來源並校驗 SHA-256，可能下載數百 MB 以上，需要網路；不需要管理員權限，工具只放在專案的',
        )}{' '}
        <code>.local</code>{' '}
        {t('資料夾。也可以先略過，之後從工作區的「工具設定」再安裝。')}
      </p>
    </div>
  );
}

export function Onboarding({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (profile: string) => void;
}) {
  const t = useT();
  const guide = getLocale() === 'en' ? '/interface-guide.en.svg' : '/interface-guide.svg';
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      previous.current?.focus();
    };
  }, []);
  const finish = (profile?: string) => {
    markSeen();
    onClose();
    if (profile) onStart(profile);
  };
  return (
    <dialog
      ref={dialog}
      className="project-dialog onboarding-dialog"
      aria-label={t('初始引導')}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        finish();
      }}
    >
      <ol className="onboarding-steps" aria-label={t('引導進度')}>
        {steps.map((name, index) => (
          <li
            key={name}
            className={index === step ? 'current' : index < step ? 'done' : ''}
            aria-current={index === step ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            {t(name)}
          </li>
        ))}
      </ol>
      {step === 0 && (
        <section>
          <h2>{t('歡迎使用 OpenCircuit')}</h2>
          <p>{t('在自己的電腦上完成電子原型：不需要帳號，也不會上傳你的專案。')}</p>
          <ul className="onboarding-list">
            <li>
              <strong>{t('接線')}</strong>
              {t('：在畫布上放元件、點接腳連線，並自動檢查電壓與接腳是否相容。')}
            </li>
            <li>
              <strong>{t('編譯與模擬')}</strong>
              {t('：用 Arduino CLI 真實編譯，在本機模擬 LED、按鈕、OLED 等行為。')}
            </li>
            <li>
              <strong>{t('寫入與記錄')}</strong>
              {t('：USB 燒錄、序列埠監看、版本還原與材料成本估算。')}
            </li>
          </ul>
          <p>{t('接下來花一分鐘，檢查環境並認識介面。')}</p>
        </section>
      )}
      {step === 1 && (
        <section>
          <h2>{t('檢查並安裝環境')}</h2>
          <EnvironmentStep />
        </section>
      )}
      {step === 2 && (
        <section>
          <h2>{t('認識介面')}</h2>
          <p>
            {t('下圖標出工作區八個區塊的用途，圖中編號對應右側說明。')}
            <a href={guide} target="_blank" rel="noreferrer">
              {t('開啟大圖')}
            </a>
          </p>
          <img
            className="onboarding-guide-image"
            src={guide}
            alt={t(
              'OpenCircuit 工作區介面功能說明：1 返回與專案、2 提醒、3 模擬・寫入裝置・匯出、4 分頁、5 元件庫、6 電路畫布、7 問題・輸出・序列埠、8 元件資訊',
            )}
          />
        </section>
      )}
      {step === 3 && (
        <section>
          <h2>{t('建立第一個專案')}</h2>
          <p>{t('選一個範本直接開始，或略過後自己建立空白專案。')}</p>
          <div className="onboarding-templates">
            {templates.map((template) => (
              <button key={template.profile} onClick={() => finish(template.profile)}>
                {t(template.name)}
              </button>
            ))}
          </div>
          <p className="muted">{t('之後可從專案主頁右上角的「新手引導」再次開啟。')}</p>
        </section>
      )}
      <div className="form-actions onboarding-nav">
        <button type="button" onClick={() => finish()}>
          {step === steps.length - 1 ? t('關閉') : t('略過引導')}
        </button>
        <span className="onboarding-nav-spacer" />
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)}>
            {t('上一步')}
          </button>
        )}
        {step < steps.length - 1 && (
          <button type="button" className="primary" onClick={() => setStep(step + 1)}>
            {t('下一步')}
          </button>
        )}
      </div>
    </dialog>
  );
}
