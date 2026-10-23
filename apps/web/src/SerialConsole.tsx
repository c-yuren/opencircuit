import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, MoreHorizontal, RefreshCw } from 'lucide-react';
import { IconButton } from './Ui';
import { intlLocale, useT } from './i18n';

type Line = { time: string; text: string };

export function SerialConsole({
  state,
  root,
  port,
  baud,
  busy,
  error,
  setPort,
  setBaud,
  act,
  onHelp,
  onSend,
  onDownload,
}: {
  state: any;
  root: string;
  port: string;
  baud: number;
  busy: boolean;
  error: string;
  setPort: (port: string) => void;
  setBaud: (baud: number) => void;
  act: (name: string, body?: any) => Promise<unknown>;
  onHelp?: () => void;
  onSend?: (text: string) => Promise<void>;
  onDownload: (text: string) => void;
}) {
  const t = useT();
  const monitor = state?.monitor;
  const simulated = port === '@simulation' && !!state?.simulation;
  const connected = !simulated && monitor?.state === 'connected';
  const starting = !simulated && monitor?.state === 'starting';
  const canSend = !!onSend && (connected || (simulated && state.simulation.running));
  const output = simulated ? (state.simulation.serial ?? '') : (monitor?.output ?? '');
  const consoleRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const scanPending = useRef(false);
  const previous = useRef({ key: '', raw: '', lines: [] as Line[] });
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const key = root + ':' + (simulated ? 'simulation' : (monitor?.port ?? ''));
  useEffect(() => {
    const stamp = new Date().toLocaleTimeString(intlLocale(), { hour12: false });
    let next: Line[];
    const before = previous.current;
    if (before.key !== key || !output.startsWith(before.raw)) {
      next = output ? output.split('\n').map((text: string) => ({ time: stamp, text })) : [];
      follow.current = true;
    } else if (output === before.raw) return;
    else {
      const last = before.lines.at(-1);
      const tail = ((last?.text ?? '') + output.slice(before.raw.length)).split('\n');
      next = [
        ...before.lines.slice(0, last ? -1 : undefined),
        ...tail.map((text: string, index: number) => ({
          time: index === 0 ? (last?.time ?? stamp) : stamp,
          text,
        })),
      ];
    }
    next = next.slice(-5000);
    previous.current = { key, raw: output, lines: next };
    setLines(next);
  }, [output, key]);
  useLayoutEffect(() => {
    if (follow.current && consoleRef.current)
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [lines]);
  const scan = async () => {
    if (scanPending.current) return;
    scanPending.current = true;
    try {
      await act('scan');
    } finally {
      scanPending.current = false;
    }
  };
  const device = state?.devices?.find((item: any) => item.address === monitor?.port);
  const deviceName = device?.boards?.[0]?.name ?? device?.label ?? t('開發板');
  const warning = sendError || error || monitor?.stderr || state?.deviceWarnings?.[0] || '';
  const send = async () => {
    if (!canSend || !onSend || sending || !input.length) return;
    setSending(true);
    setSendError('');
    try {
      await onSend(input);
      setInput('');
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="serial-console-panel" aria-label={t('序列埠主控台')}>
      <div className="serial-controls">
        <span
          className={
            'serial-connection ' +
            (connected || (simulated && state.simulation.running)
              ? 'connected'
              : starting
                ? 'starting'
                : '')
          }
        >
          <i aria-hidden="true" />
          {simulated
            ? state.simulation.running
              ? t('模擬裝置')
              : t('模擬已停止')
            : connected
              ? `${deviceName} / ${monitor.port}`
              : starting
                ? t('連線中 / {port}', { port: monitor.port })
                : t('未連線')}
        </span>
        {!connected && !starting && !simulated && (
          <select
            aria-label={t('選擇序列埠裝置')}
            value={port}
            disabled={busy}
            onFocus={() => void scan()}
            onPointerDown={() => void scan()}
            onChange={(event) => setPort(event.target.value)}
          >
            <option value="">{t('選擇裝置')}</option>
            {(state?.devices ?? []).map((item: any) => (
              <option key={item.address} value={item.address}>
                {item.boards?.[0]?.name ?? item.label} / {item.address}
              </option>
            ))}
            {state?.simulation && <option value="@simulation">{t('模擬裝置訊息')}</option>}
          </select>
        )}
        <select
          aria-label={t('序列 baud rate')}
          value={connected || starting ? monitor.baud : baud}
          disabled={busy || starting || simulated}
          onChange={(event) => {
            const next = Number(event.target.value);
            setBaud(next);
            if (connected) void act('monitor/start', { port: monitor.port, baud: next });
          }}
        >
          {[9600, 19200, 38400, 57600, 115200, 230400].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <IconButton
          icon={RefreshCw}
          label={t('重新掃描裝置')}
          text={false}
          disabled={busy}
          onClick={() => void scan()}
        />
        <div className="serial-control-end">
          <button
            disabled={busy || !lines.length}
            onClick={() => {
              if (simulated) {
                previous.current = { key, raw: output, lines: [] };
                setLines([]);
              } else void act('monitor/clear');
            }}
          >
            {t('清除')}
          </button>
          <details className="serial-more">
            <summary aria-label={t('序列埠更多操作')}>
              <MoreHorizontal size={18} />
            </summary>
            <button
              disabled={!lines.length}
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                onDownload(simulated ? lines.map((line) => line.text).join('\n') : output);
              }}
            >
              <Download size={15} />
              {t('下載訊息')}
            </button>
          </details>
          {simulated ? (
            <button onClick={() => setPort('')}>{t('裝置訊息')}</button>
          ) : connected || starting ? (
            <button disabled={busy} onClick={() => void act('monitor/stop')}>
              {t('中斷連線')}
            </button>
          ) : (
            <button
              disabled={busy || !port}
              onClick={() => void act('monitor/start', { port, baud })}
            >
              {t('連線')}
            </button>
          )}
        </div>
      </div>
      {warning && (
        <div className="serial-inline-alert" role="alert">
          <AlertTriangle size={15} />
          <span>
            {t(String(warning).replace(/spawn arduino-cli ENOENT/g, 'arduino-cli 未安裝'))}
          </span>
          {onHelp && <button onClick={onHelp}>{t('查看說明')}</button>}
        </div>
      )}
      <div
        className="serial-console"
        ref={consoleRef}
        role="log"
        aria-label={simulated ? t('模擬器序列輸出') : t('實機序列輸出')}
        onScroll={() => {
          const node = consoleRef.current;
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
        }}
      >
        {lines.some((line) => line.text.length) ? (
          lines.map((line, index) => (
            <div className="serial-line" key={index}>
              <time>{line.time}</time>
              <span>{line.text.replace(/\r$/, '')}</span>
            </div>
          ))
        ) : (
          <div className="serial-empty">
            <strong>
              {connected || starting || simulated
                ? t('等待裝置輸出')
                : t('尚未連接序列埠')}
            </strong>
            {!connected && !starting && !simulated && (
              <span>{t('連接開發板後即可查看輸出')}</span>
            )}
          </div>
        )}
      </div>
      <form
        className="serial-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          aria-label={t('傳送序列埠訊息')}
          placeholder={t('輸入要傳送的內容...')}
          value={input}
          maxLength={4096}
          disabled={!canSend || sending}
          title={connected && !onSend ? t('目前序列工具尚未提供傳送功能') : undefined}
          onChange={(event) => setInput(event.target.value)}
        />
        <button disabled={!canSend || sending || !input.length}>{t('傳送')}</button>
      </form>
    </section>
  );
}
