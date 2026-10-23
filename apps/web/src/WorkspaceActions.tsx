import { useEffect, useRef, useState, type RefObject } from 'react';
import { runtimePost } from './LocalTools';
import { api } from './api';
import { X } from 'lucide-react';
import { IconButton } from './Ui';
import { useT } from './i18n';

export type WorkspaceRuntimeCommands = {
  compile: () => void;
  simulate: () => void;
  upload: () => void;
  exportSimulator: () => void;
};

export function WorkspaceActions({
  root,
  sourceDigest,
  baseRevision,
  onCheck,
  onSimulation,
  commands,
  onState,
  onResult,
  onError,
  hideButtons = false,
}: {
  root: string;
  sourceDigest: string;
  baseRevision: string;
  onCheck: () => void;
  onSimulation: () => void;
  commands?: RefObject<WorkspaceRuntimeCommands | null>;
  onState?: (state: any) => void;
  onResult?: (kind: string) => void;
  onError?: (message: string) => void;
  hideButtons?: boolean;
}) {
  const t = useT();
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [port, setPort] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [working, setWorking] = useState(false);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const tracked = useRef<string | null>(null);
  const prepareUpload = useRef(false);
  const preparedVersion = useRef<{ expectedDigest: string; baseRevision: string } | null>(null);
  const checked = useRef(new Set<string>());
  const [confirm, setConfirm] = useState<'setup' | 'install' | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const simulateAfterInstall = useRef(false);
  const startRef = useRef<((kind: 'simulate', override: { state?: any }) => Promise<void>) | null>(
    null,
  );
  const connectionFailures = useRef(0);
  const callbacks = useRef({ onState, onResult, onError });
  callbacks.current = { onState, onResult, onError };
  const failure = async (message: string) => {
    message = t(message).replace(/Wokwi/gi, t('外部模擬器'));
    setError(message);
    prepareUpload.current = false;
    setPending(false);
    callbacks.current.onError?.(message);
    try {
      await api('check', {});
    } catch (error) {
      setError(message + '；' + (error as Error).message);
    }
    onCheck();
  };
  useEffect(() => {
    tracked.current = null;
    setPending(false);
    setChoosing(false);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let pollInterval = 600;
    const poll = async () => {
      try {
        const next = await api('runtime/state');
        // A simulated buzzer is heard, so its key presses need a quicker state refresh.
        const buzzing = Object.values<any>(next.simulation?.peripherals ?? {}).some(
          (device) => device?.kind === 'buzzer',
        );
        pollInterval = next.simulation?.running ? (buzzing ? 100 : 200) : 600;
        if (!Array.isArray(next.jobs) || !Array.isArray(next.devices))
          throw new Error(t('服務狀態尚未就緒'));
        if (cancelled) return;
        connectionFailures.current = 0;
        setConnectionError('');
        setState(next);
        callbacks.current.onState?.(next);
        const job = next.jobs.find((job: any) => job.id === tracked.current);
        if (job?.state === 'cancelled' && !checked.current.has(job.id)) {
          checked.current.add(job.id);
          setPending(false);
          prepareUpload.current = false;
          simulateAfterInstall.current = false;
          callbacks.current.onResult?.(job.kind);
        }
        if (job?.state === 'fail' && !checked.current.has(job.id)) {
          checked.current.add(job.id);
          simulateAfterInstall.current = false;
          await failure(job.error ?? job.log ?? t('程式處理失敗'));
        }
        if (job?.state === 'pass' && !checked.current.has(job.id)) {
          checked.current.add(job.id);
          setPending(false);
          if (job.kind === 'install' && simulateAfterInstall.current) {
            simulateAfterInstall.current = false;
            await startRef.current?.('simulate', { state: next });
          }
          if (prepareUpload.current && job.kind === 'compile') {
            prepareUpload.current = false;
            preparedVersion.current = {
              expectedDigest: job.sourceDigest,
              baseRevision: job.baseRevision,
            };
            setWorking(true);
            try {
              await runtimePost('scan', {});
              setState(await api('runtime/state'));
              setPort('');
              setChoosing(true);
            } catch (error) {
              await failure((error as Error).message);
            } finally {
              setWorking(false);
            }
          }
          if (job.kind === 'export' && job.result?.download) {
            const link = document.createElement('a');
            link.href = job.result.download;
            link.download = 'OpenCircuit-simulator.zip';
            link.click();
          }
        }
      } catch (error) {
        if (!cancelled && ++connectionFailures.current >= 3)
          setConnectionError((error as Error).message);
      } finally {
        if (!cancelled) timer = setTimeout(poll, pollInterval);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [root, onCheck]);
  useEffect(() => {
    if (choosing) dialog.current?.showModal();
  }, [choosing]);
  useEffect(() => {
    if (confirm) confirmDialog.current?.showModal();
  }, [confirm]);
  const busy =
    working ||
    pending ||
    state?.jobs?.some((job: any) => ['running', 'queued'].includes(job.state));
  // `override` carries state fetched right after a preparatory step, before React re-renders.
  const start = async (
    kind: 'upload' | 'simulate' | 'compile' | 'export',
    override: { state?: any; sourceDigest?: string; baseRevision?: string } = {},
  ) => {
    if (busy && !override.state) return;
    const current = override.state ?? state,
      digest = override.sourceDigest ?? sourceDigest,
      revision = override.baseRevision ?? baseRevision;
    setWorking(true);
    setError('');
    callbacks.current.onError?.('');
    try {
      const report = await api('check', {});
      if (report.diagnostics?.some((item: any) => item.state === 'fail'))
        throw new Error(t('接線有問題，請先修正「問題」面板中的項目。'));
      if (kind === 'simulate' && current?.simulationPlan?.mode === 'local-esp32-qemu') {
        const pythonMissing = current.environment?.items?.some(
          (item: any) => item.id === 'simulation:python' && !item.ready,
        );
        // One confirmation instead of a detour through the settings panel.
        if (!current.esp32Engine?.installed || pythonMissing) {
          onSimulation();
          setConfirm('install');
          return;
        }
        if (current.simulationPlan.reasons.some((r: string) => /DIO|數位模擬啟動/.test(r))) {
          onSimulation();
          setConfirm('setup');
          return;
        }
      }
      const job = await runtimePost('job', {
        kind,
        port,
        expectedDigest:
          kind === 'upload' ? (preparedVersion.current?.expectedDigest ?? digest) : digest,
        baseRevision:
          kind === 'upload' ? (preparedVersion.current?.baseRevision ?? revision) : revision,
      });
      tracked.current = job.id;
      setPending(true);
      setChoosing(false);
      if (kind === 'simulate') onSimulation();
      else callbacks.current.onResult?.(kind);
    } catch (error) {
      await failure((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  startRef.current = start;
  const confirmSetup = async () => {
    setConfirm(null);
    setWorking(true);
    try {
      await runtimePost('simulation/prepare', { expectedDigest: sourceDigest, baseRevision });
      const fresh = (await api('context')).context,
        next = await api('runtime/state');
      setState(next);
      setWorking(false);
      await start('simulate', {
        state: next,
        sourceDigest: fresh.sourceDigest,
        baseRevision: fresh.current.revision,
      });
    } catch (error) {
      await failure((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const confirmInstall = async () => {
    setConfirm(null);
    setWorking(true);
    try {
      const job = await runtimePost('job', {
        kind: 'install',
        expectedDigest: sourceDigest,
        baseRevision,
      });
      simulateAfterInstall.current = true;
      tracked.current = job.id;
      setPending(true);
      onSimulation();
    } catch (error) {
      await failure((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const scan = async () => {
    setWorking(true);
    setError('');
    try {
      await runtimePost('scan', {});
      setState(await api('runtime/state'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  if (commands)
    commands.current = {
      compile: () => void start('compile'),
      upload: () => {
        if (!busy) {
          prepareUpload.current = true;
          void start('compile');
        }
      },
      simulate: () =>
        state?.simulation?.running
          ? void runtimePost('simulation/stop', {}).catch((error) => setError(error.message))
          : void start('simulate'),
      exportSimulator: () => void start('export'),
    };
  return (
    <>
      <button
        hidden={hideButtons}
        aria-label={t('編譯並寫入板子')}
        title={t('編譯並寫入板子')}
        disabled={busy}
        onClick={() => {
          setPort('');
          setChoosing(true);
          void scan();
        }}
      >
        ↑
      </button>
      <button
        hidden={hideButtons}
        aria-label={state?.simulation?.running ? t('停止模擬') : t('編譯並模擬')}
        title={state?.simulation?.running ? t('停止模擬') : t('編譯並模擬')}
        disabled={busy}
        onClick={() =>
          state?.simulation?.running
            ? void runtimePost('simulation/stop', {}).catch((error) => setError(error.message))
            : void start('simulate')
        }
      >
        {state?.simulation?.running ? '■' : '▶'}
      </button>
      {connectionError && !choosing && (
        <span className="quick-action-error" role="alert">
          {t(connectionError)}
        </span>
      )}
      {confirm && (
        <dialog
          ref={confirmDialog}
          className="project-dialog"
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setConfirm(null);
          }}
        >
          <h2>
            {confirm === 'setup'
              ? t('套用 ESP32 模擬設定並開始？')
              : t('安裝 ESP32 模擬環境並開始？')}
          </h2>
          <p>
            {confirm === 'setup'
              ? t(
                  '本機模擬需要把 Flash 改為 DIO／4MB，並加入 firmware/main/opencircuit_sim_compat.cpp，直接執行 setup / loop（不支援 Wi-Fi、OTA、NVS）。這會修改專案來源，之後可在模擬面板「進階」還原。',
                )
              : t(
                  '需要下載 ESP32 QEMU 引擎（約 53 MB）與專案專用 Python，並校驗 SHA-256；安裝完成後自動開始模擬，之後可離線使用。',
                )}
          </p>
          <div className="form-actions">
            <button onClick={() => setConfirm(null)}>{t('取消')}</button>
            <button
              className="primary"
              onClick={() => void (confirm === 'setup' ? confirmSetup() : confirmInstall())}
            >
              {confirm === 'setup' ? t('套用並開始') : t('安裝並開始')}
            </button>
          </div>
        </dialog>
      )}
      {choosing && (
        <dialog
          ref={dialog}
          className="project-dialog"
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) setChoosing(false);
          }}
        >
          <h2>{t('寫入哪個裝置？')}</h2>
          <p hidden>
            來源版本：{baseRevision.slice(-8)} · {sourceDigest.slice(0, 12)}
          </p>
          <label>
            {t('裝置')}
            <select
              aria-label={t('寫入裝置')}
              value={port}
              onChange={(event) => setPort(event.target.value)}
            >
              <option value="">{t('請選擇裝置')}</option>
              {state?.devices.map((device: any) => (
                <option key={device.address} value={device.address}>
                  {device.address} ·{' '}
                  {device.boards.map((board: any) => board.name).join('、') || device.label}
                </option>
              ))}
            </select>
          </label>
          {!state?.devices.length && <p>{t('尚未找到裝置，請接上 USB 資料線。')}</p>}
          {error && (
            <p className="error-text" role="alert">
              {t(error)}
            </p>
          )}
          <div className="form-actions">
            <button disabled={busy} onClick={() => void scan()}>
              {t('重新尋找')}
            </button>
            <button disabled={busy} onClick={() => setChoosing(false)}>
              {t('取消')}
            </button>
            <button
              className="primary"
              disabled={busy || !port}
              onClick={() => void start('upload')}
            >
              {t('寫入此裝置')}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}

export function ResizeHandle({
  direction,
  value,
  onChange,
}: {
  direction: 'left' | 'right' | 'bottom';
  value: number;
  onChange: (value: number) => void;
}) {
  const t = useT();
  const initial = useRef({ pointer: 0, value: 0 });
  const [narrow, setNarrow] = useState(window.innerWidth <= 900);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 900);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const horizontal = direction !== 'bottom' && !narrow;
  const handle = useRef<HTMLDivElement>(null);
  const adjust = (next: number) =>
    onChange(
      Math.max(
        horizontal ? 180 : 120,
        Math.min(
          horizontal
            ? Math.min(480, window.innerWidth * 0.4)
            : direction === 'bottom'
              ? Math.max(
                  120,
                  (handle.current?.closest('.main-area')?.getBoundingClientRect().height ??
                    window.innerHeight) - 335,
                )
              : window.innerHeight * 0.65,
          next,
        ),
      ),
    );
  return (
    <div
      ref={handle}
      className={'panel-resize ' + (horizontal ? 'horizontal' : 'vertical')}
      role="separator"
      aria-label={
        direction === 'left'
          ? t('調整左側寬度')
          : direction === 'right'
            ? t('調整右側寬度')
            : t('調整下方高度')
      }
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        initial.current = { pointer: horizontal ? event.clientX : event.clientY, value };
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = (horizontal ? event.clientX : event.clientY) - initial.current.pointer;
        adjust(initial.current.value + (direction === 'left' ? delta : -delta));
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        adjust(value + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 20 : -20));
      }}
    />
  );
}

export function CodePreview({
  files,
  onClose,
}: {
  files: Record<string, string>;
  onClose: () => void;
}) {
  const t = useT();
  const choices = Object.keys(files).filter((file) => file.startsWith('firmware/'));
  const [file, setFile] = useState(choices[0] ?? '');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="code-preview"
      aria-labelledby="code-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2 id="code-preview-title">
          {t('程式碼預覽')} <small>{t('唯讀')}</small>
        </h2>
        <select
          aria-label={t('預覽程式檔案')}
          value={file}
          onChange={(event) => setFile(event.target.value)}
        >
          {choices.map((file) => (
            <option key={file}>{file}</option>
          ))}
        </select>
        <IconButton icon={X} label={t('關閉程式碼預覽')} text={false} onClick={onClose} />
      </header>
      <pre aria-label={t('唯讀程式碼')} tabIndex={0}>
        <code>{files[file] ?? ''}</code>
      </pre>
    </dialog>
  );
}
