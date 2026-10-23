import { appUrl } from './deployment';
import { useEffect, useRef, useState } from 'react';
import type { Source } from '../../../packages/core/src/model';
import { boards } from '../../../packages/core/src/boards';
import { SerialConsole } from './SerialConsole';
import { SimulationPeripherals } from './SimulationPeripherals';
import { t, translateLog, useLocale } from './i18n';
let token = '';
export async function runtimePost(name: string, body: unknown) {
  const getToken = async () => {
    const r = await fetch(appUrl('/api/runtime/session'));
    if (!r.ok) throw new Error(t('本機服務未連線'));
    token = (await r.json()).token;
  };
  if (!token) await getToken();
  const send = () =>
    fetch(appUrl('/api/runtime/' + name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
  let r = await send();
  if (r.status === 403) {
    await getToken();
    r = await send();
  }
  const result = await r.json();
  if (!r.ok) throw new Error(t(result.error ?? '本機工作失敗'));
  return result;
}
export function downloadText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const jobStates: Record<string, string> = {
  running: '進行中',
  pass: '完成',
  fail: '失敗',
  cancelled: '已取消',
};
export function LocalTools({
  source,
  sourceDigest,
  baseRevision,
  root,
  initialSection = 'simulation',
  compact = false,
  onHelp,
}: {
  source: Source;
  sourceDigest: string;
  baseRevision: string;
  root: string;
  initialSection?: string;
  compact?: boolean;
  onHelp?: () => void;
}) {
  // Subscribes to language changes; `t` always reads the current locale.
  useLocale();
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [working, setWorking] = useState(false),
    [port, setPort] = useState(''),
    [baud, setBaud] = useState(115200),
    [section, setSection] = useState(initialSection),
    [autoInstall, setAutoInstall] = useState<boolean>(() => {
      try {
        return localStorage.getItem('opencircuit_auto_install') === 'true';
      } catch {
        return false;
      }
    });
  const active = useRef(true);
  const autoTriggeredRef = useRef(false);
  useEffect(() => {
    autoTriggeredRef.current = false;
  }, [root, source.dependencies.fqbn]);
  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);
  const refresh = async () => {
    try {
      const r = await fetch(appUrl('/api/runtime/state'));
      if (!r.ok) throw new Error('服務回應失敗');
      const data = await r.json();
      if (!Array.isArray(data.jobs) || !Array.isArray(data.devices))
        throw new Error('服務狀態尚未就緒');
      if (active.current) {
        setState(data);
        setConnected(true);
      }
    } catch {
      if (active.current) setConnected(false);
    }
  };
  useEffect(() => {
    active.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (active.current) timer = setTimeout(poll, 600);
    };
    void poll();
    return () => {
      active.current = false;
      clearTimeout(timer);
    };
  }, [root]);
  const act = async (name: string, body: any = {}) => {
    setWorking(true);
    setError('');
    try {
      const result = await runtimePost(name, body);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const revision = { expectedDigest: sourceDigest, baseRevision };
  const busy = working || state?.jobs.some((j: any) => j.state === 'running');
  const job = (kind: string) => act('job', { ...revision, kind, port });
  const env = state?.environment,
    simulation = state?.simulation,
    plan = state?.simulationPlan;
  useEffect(() => {
    if (section !== 'device') return;
    let cancelled = false;
    void runtimePost('scan', {})
      .then(() => {
        if (!cancelled) return refresh();
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [section, root]);
  const deviceChoices = JSON.stringify(state?.devices ?? []);
  useEffect(() => {
    const devices = JSON.parse(deviceChoices) as { address: string; boards: { fqbn: string }[] }[];
    const matches = devices.filter((device) =>
      device.boards.some((board) => board.fqbn === source.dependencies.fqbn),
    );
    setPort((current) =>
      current === '@simulation' && state?.simulation
        ? current
        : devices.some((device) => device.address === current)
          ? current
          : matches.length === 1
            ? matches[0].address
            : '',
    );
  }, [deviceChoices, source.dependencies.fqbn]);

  useEffect(() => {
    if (!connected || busy || !autoInstall || autoTriggeredRef.current) return;
    const hasMissing = env?.items?.some((i: any) => !i.ready && i.installable);
    if (hasMissing) {
      autoTriggeredRef.current = true;
      void job('install');
    }
  }, [connected, busy, autoInstall, env]);

  const runningInstallJob = state?.jobs?.find(
    (j: any) => j.kind === 'install' && j.state === 'running',
  );
  const missingInstallable = env?.items?.filter((i: any) => !i.ready && i.installable) ?? [];
  const pythonMissing = env?.items?.some(
    (item: any) => item.id === 'simulation:python' && !item.ready,
  );
  const esp32 = plan?.mode === 'local-esp32-qemu';
  const esp32NeedsEngine = esp32 && (!state?.esp32Engine?.installed || pythonMissing);
  const setupReason = (reason: string) => /DIO|數位模擬啟動/.test(reason);
  const esp32NeedsSetup = esp32 && (plan?.reasons ?? []).some(setupReason);
  const blockingReasons = (plan?.reasons ?? []).filter((r: string) => !setupReason(r));

  if (section === 'serial')
    return (
      <SerialConsole
        state={state}
        root={root}
        port={port}
        baud={baud}
        busy={!!busy}
        error={error}
        setPort={setPort}
        setBaud={setBaud}
        act={act}
        onHelp={onHelp}
        onSend={
          port === '@simulation'
            ? async (text) => {
                await runtimePost('simulation/serial', { text: text + '\n' });
              }
            : undefined
        }
        onDownload={(text) => downloadText('OpenCircuit-serial.txt', text)}
      />
    );
  return (
    <div className="local-tools">
      <div
        className="local-service-heading"
        hidden={compact && section !== 'environment' && connected}
      >
        <div>
          <h3>
            {compact
              ? (
                  {
                    output: t('輸出'),
                    simulation: t('模擬紀錄'),
                    serial: t('序列埠'),
                    environment: t('工具設定'),
                  } as Record<string, string>
                )[section]
              : t('模擬與裝置')}
          </h3>
        </div>
        <strong className={connected ? 'service-connected' : 'error-text'}>
          {connected ? t('● 本機服務已連線') : t('○ 本機服務未連線')}
        </strong>
      </div>
      {!compact && (
        <nav className="local-subtabs">
          {[
            ['simulation', '模擬'],
            ['device', '寫入板子'],
            ['serial', '裝置訊息'],
            ['environment', '工具設定'],
          ].map(([id, name]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              {t(name)}
            </button>
          ))}
        </nav>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {runningInstallJob && (
        <div className="install-banner installing">
          <div className="install-banner-header">
            <strong>
              {t('⚙ 正在安裝環境與核心套件（{phase}）...', {
                phase: t(runningInstallJob.phase ?? ''),
              })}
            </strong>
            <button onClick={() => act('cancel', { id: runningInstallJob.id })}>
              {t('取消安裝')}
            </button>
          </div>
          {runningInstallJob.log && (
            <pre className="install-banner-log">
              {translateLog(runningInstallJob.log.trim().split('\n').slice(-4).join('\n'))}
            </pre>
          )}
        </div>
      )}
      {!runningInstallJob && connected && missingInstallable.length > 0 && (
        <div className="install-banner">
          <div className="install-banner-header">
            <div>
              <strong>{t('提示：缺少編譯或模擬所需套件')}</strong>
              <small style={{ display: 'block', color: '#666' }}>
                {missingInstallable.map((i: any) => i.name).join('、')}
              </small>
            </div>
            <div className="install-banner-actions">
              <label
                style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <input
                  type="checkbox"
                  checked={autoInstall}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setAutoInstall(val);
                    try {
                      localStorage.setItem('opencircuit_auto_install', String(val));
                    } catch {}
                    if (val && !busy) {
                      autoTriggeredRef.current = true;
                      void job('install');
                    }
                  }}
                />
                {t('偵測缺少時自動安裝')}
              </label>
              <button disabled={busy} onClick={() => job('install')}>
                {t('立即安裝')}
              </button>
            </div>
          </div>
        </div>
      )}
      {!compact && (
        <div className="local-primary-actions">
          <button disabled={busy || !connected} onClick={() => job('compile')}>
            {t('準備程式')}
          </button>
          <button disabled={busy || !connected} onClick={() => act('environment')}>
            {t('檢查工具')}
          </button>
          <label>
            {t('使用的板子')}
            <select
              aria-label={t('專案板型')}
              value={source.dependencies.fqbn}
              disabled={busy}
              onChange={(e) => act('board', { ...revision, fqbn: e.target.value })}
            >
              {Object.entries(boards).map(([fqbn, b]) => (
                <option key={fqbn} value={fqbn}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {section === 'environment' && (
        <>
          <p className="muted">
            {t(
              '編輯與材料清單可獨立使用。缺少工具時，編譯與裝置功能會回報缺項。安裝會連線到 Arduino／Espressif 官方來源；ESP32 引擎與 Python 使用官方發行並校驗 SHA-256。',
            )}
          </p>
          <div className="environment-list">
            {env?.items.map((item: any) => (
              <div key={item.id}>
                <span>
                  {item.ready ? '✓' : '○'} {t(item.name).replace(/Wokwi/gi, t('外部模擬器'))}
                </span>
                <small>{t(item.reason).replace(/Wokwi/gi, t('外部模擬器'))}</small>
              </div>
            )) ?? <p>{t('正在檢查工具…')}</p>}
          </div>
          {pythonMissing && (
            <p role="alert">
              {t('ESP32 模擬需要 64 位元 Python 3.10+。')}
              <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">
                {t('開啟 Python 官方下載')}
              </a>
              {t('。Windows x64 可按「安裝缺少套件」安裝專案專用 Python。')}
            </p>
          )}
          <button disabled={busy || !connected} onClick={() => job('install')}>
            {t('安裝缺少套件')}
          </button>
          <button disabled={busy || !connected} onClick={() => act('environment')}>
            {t('重新檢查工具')}
          </button>
        </>
      )}
      {(section === 'simulation' ||
        (section === 'output' && (simulation || plan?.mode === 'local-esp32-qemu'))) && (
        <>
          {!plan?.mode?.startsWith('local-') && (
            <p>
              <strong>{t('這款板子暫不支援本機模擬')}</strong>
            </p>
          )}
          {esp32NeedsEngine && (
            <div role="alert" className="install-banner">
              <p>
                {t('ESP32 模擬需要本機引擎（約 53 MB）')}
                {pythonMissing ? t('與 64 位元 Python 3.10+') : ''}
                {t('，安裝後即可離線使用。')}
              </p>
              <button disabled={busy || !connected} onClick={() => job('install')}>
                {t('安裝 ESP32 模擬環境')}
              </button>
            </div>
          )}
          {esp32NeedsSetup && (
            <div className="install-banner">
              <p>
                {t(
                  'ESP32 需要先套用數位模擬設定：改用 DIO / 4MB Flash，並加入數位啟動檔直接執行 setup / loop。不支援 OTA、NVS、Wi-Fi 或儲存。',
                )}
              </p>
              <button disabled={busy} onClick={() => act('simulation/prepare', revision)}>
                {t('套用 ESP32 數位模擬設定')}
              </button>
            </div>
          )}
          {!plan?.supported && blockingReasons.length > 0 && (
            <ul className="simulation-reasons" role="alert">
              {blockingReasons.map((reason: string) => (
                <li key={reason}>{t(reason)}</li>
              ))}
            </ul>
          )}
          <div className="local-actions">
            <button
              className="primary"
              disabled={busy || (!simulation?.running && (!plan?.supported || esp32NeedsEngine))}
              onClick={() => (simulation?.running ? act('simulation/stop') : job('simulate'))}
            >
              {simulation?.running ? t('停止模擬') : t('開始本機模擬')}
            </button>
            {simulation && !simulation.stale && (
              <button disabled={busy} onClick={() => act('simulation/reset')}>
                {t('重設模擬')}
              </button>
            )}
            {simulation?.running && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    act('simulation/control', { action: simulation.paused ? 'resume' : 'pause' })
                  }
                >
                  {simulation.paused ? t('繼續') : t('暫停')}
                </button>
                {simulation.paused && (
                  <button
                    disabled={busy}
                    onClick={() => act('simulation/control', { action: 'step' })}
                  >
                    {t('步進 10 ms')}
                  </button>
                )}
                <select
                  aria-label={t('模擬速度')}
                  disabled={busy}
                  value={simulation.speed ?? 1}
                  onChange={(e) =>
                    act('simulation/control', { action: 'speed', value: Number(e.target.value) })
                  }
                >
                  {[1, 2, 10, 100].map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}×
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {simulation && (
            <div className="simulation-output">
              <p>
                {t(!simulation.running ? '已停止' : simulation.paused ? '已暫停' : '執行中')} ·
                {t('模擬時間')} {Number(simulation.simulatedSeconds ?? 0).toFixed(3)} s
                {simulation.running &&
                  !simulation.paused &&
                  typeof simulation.effectiveSpeed === 'number' &&
                  simulation.effectiveSpeed < simulation.speed * 0.9 &&
                  t(' · 實際約 {speed}×（本機運算上限）', {
                    speed: simulation.effectiveSpeed.toFixed(1),
                  })}{' '}
                · {t('快照')} {simulation.snapshot?.slice(-8)}
                {simulation.stale && <b className="error-text">{t(' · 專案已修改，正在顯示舊快照')}</b>}
              </p>
              {simulation.error && <p role="alert">{t(simulation.error)}</p>}
              <div className="simulation-leds">
                {Object.entries(simulation.outputs ?? {}).map(([id, on]) => (
                  <span key={id}>
                    <i className={on ? 'on' : ''} />
                    {id}：{on ? t('HIGH／亮') : t('LOW／熄')}
                  </span>
                ))}
              </div>
              <SimulationPeripherals
                peripherals={simulation.peripherals}
                disabled={!simulation.running}
                send={(id, values) =>
                  void runtimePost('simulation/sensor', { id, values }).catch((e) =>
                    setError((e as Error).message),
                  )
                }
              />
              <label hidden={section === 'output'}>
                {t('模擬訊息')}
                <pre className="runtime-console" aria-label={t('模擬器序列輸出')}>
                  {simulation.serial || t('尚無訊息')}
                </pre>
              </label>
              <p className="muted">{t('模擬結果僅供參考，仍需要在實體板子上測試。')}</p>
            </div>
          )}
          <details className="simulation-advanced">
            <summary>{t('進階')}</summary>
            <div className="local-actions">
              {simulation && (
                <a href="/api/runtime/simulation/vcd" download>
                  {t('下載 GPIO 波形（VCD）')}
                </a>
              )}
              {simulation && (
                <button
                  onClick={() =>
                    downloadText('OpenCircuit-simulator-serial.txt', simulation.serial ?? '')
                  }
                >
                  {t('下載模擬紀錄')}
                </button>
              )}
              {source.extraFirmware['firmware/main/opencircuit_sim_compat.cpp'] && (
                <button
                  disabled={busy}
                  onClick={() => act('simulation/restore-startup', revision)}
                >
                  {t('還原標準 Arduino 啟動')}
                </button>
              )}
              {!compact && (
                <button disabled={busy} onClick={() => act('button-template', revision)}>
                  {t('換成 Uno 按鈕範例（取代目前接線與程式）')}
                </button>
              )}
            </div>
            <table className="capability-table">
              <thead>
                <tr>
                  <th>{t('元件')}</th>
                  <th>{t('本機模擬')}</th>
                </tr>
              </thead>
              <tbody>
                {plan?.capabilities.map((c: any) => (
                  <tr key={c.instance}>
                    <td>{c.instance}</td>
                    <td>{c.unused ? t('尚未使用') : c.local ? t('支援') : t(c.note)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      {(section === 'device' || section === 'serial') && (
        <>
          <div className="local-actions">
            <button disabled={working} onClick={() => act('scan')}>
              {t('尋找裝置')}
            </button>
            <label>
              {t('連接的裝置')}
              <select
                aria-label={t('裝置序列埠')}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              >
                <option value="">{t('請選擇裝置')}</option>
                {state?.devices.map((d: any) => (
                  <option key={d.address} value={d.address}>
                    {d.address} ·{' '}
                    {d.boards.map((b: any) => b.name).join(', ') ||
                      t('{label}（板型需手動核對）', { label: d.label })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!state?.devices.length && (
            <p>{t('未發現裝置；檢查 USB 資料線、驅動與系統權限，再重新掃描。')}</p>
          )}
          {state?.deviceWarnings?.map((warning: string) => (
            <p key={warning} className="error-text">
              {t(warning)}
            </p>
          ))}
          {section === 'device' && (
            <>
              <p className="muted">
                {t('請選擇裝置並確認板子型號。按下「寫入板子」後會先準備程式，成功才會寫入。')}
              </p>
              <button className="primary" disabled={busy || !port} onClick={() => job('upload')}>
                {t('寫入板子')}
              </button>
              <p>
                {t('目前專案版本：')}<code>{baseRevision.slice(-8)}</code>
              </p>
              <p>
                {t('最後燒錄：')}
                {state?.lastUpload
                  ? `${state.lastUpload.state} · ${state.lastUpload.board} · ${state.lastUpload.device?.address} · 快照 ${state.lastUpload.sourceRevision?.slice(-8)}`
                  : t('尚無燒錄紀錄')}
              </p>
              <p className="muted">
                {t('專案還原不會自動重刷硬體。取消燒錄可能留下未完整寫入的韌體，需重新燒錄。')}
              </p>
            </>
          )}
          {section === 'serial' && (
            <>
              <div className="local-actions">
                <label>
                  {t('傳輸速度')}
                  <select
                    aria-label={t('序列 baud rate')}
                    value={baud}
                    onChange={(e) => setBaud(Number(e.target.value))}
                  >
                    {[9600, 19200, 38400, 57600, 115200, 230400].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!port || busy}
                  onClick={() => act('monitor/start', { port, baud })}
                >
                  {t('查看訊息')}
                </button>
                <button onClick={() => act('monitor/stop')}>{t('停止接收')}</button>
                <button onClick={() => act('monitor/clear')}>{t('清除訊息')}</button>
                <button
                  onClick={() =>
                    downloadText('OpenCircuit-hardware-serial.txt', state?.monitor?.output ?? '')
                  }
                >
                  {t('下載訊息')}
                </button>
              </div>
              <p>
                {t('實機序列：')}
                {state?.monitor?.state} · {state?.monitor?.port}
              </p>
              <pre className="runtime-console" aria-label={t('實機序列輸出')}>
                {state?.monitor?.output || t('尚無實機序列輸出')}
              </pre>
              {state?.monitor?.stderr && <pre className="error-text">{translateLog(state.monitor.stderr)}</pre>}
              <p className="muted">
                {t('開始監看可能重設部分板子。燒錄前會停止監看並釋放埠，完成後嘗試恢復。')}
              </p>
            </>
          )}
        </>
      )}
      <div className="runtime-jobs">
        {section === 'serial' && simulation && (
          <label>
            {t('模擬裝置訊息')}
            <pre className="runtime-console" aria-label={t('模擬器序列輸出')}>
              {simulation.serial || ''}
            </pre>
          </label>
        )}
        {[...(state?.jobs ?? [])]
          .filter(
            (j: any) =>
              section === 'output' ||
              j.kind ===
                (
                  {
                    build: 'compile',
                    upload: 'upload',
                    simulation: 'simulate',
                    environment: 'install',
                  } as Record<string, string>
                )[section],
          )
          .reverse()
          .map((j: any) => (
            <details
              key={j.id}
              data-state={j.state}
              open={j.state === 'running' || j.state === 'fail'}
            >
              <summary>
                <span className="job-kind">
                  {t(
                    (
                      {
                        compile: '編譯',
                        simulate: '模擬',
                        upload: '寫入',
                        install: '安裝',
                        export: '匯出',
                      } as Record<string, string>
                    )[j.kind] ?? j.kind,
                  )}
                </span>
                {j.phase && j.phase !== jobStates[j.state] && (
                  <span className="job-phase">
                    {t(j.phase).replace(/Wokwi/gi, t('外部模擬器'))}
                  </span>
                )}
                <span className={'job-state ' + j.state}>{t(jobStates[j.state] ?? j.state)}</span>
              </summary>
              {j.state === 'running' && (
                <button onClick={() => act('cancel', { id: j.id })}>{t('取消工作')}</button>
              )}
              {j.error && (
                <p role="alert" className="error-text">
                  {t(j.error)}
                </p>
              )}
              <pre className="runtime-console">{translateLog(j.log ?? '') || t('工具尚無輸出')}</pre>
              {j.result?.build && (
                <p>
                  {t('exit code：')}
                  {String(j.result.build.exitCode)} · {t('工具設定雜湊')}{' '}
                  {j.result.build.toolDigest?.slice(0, 12)} ·{' '}
                  {t('產物 {count} 件', { count: j.result.build.artifacts.length })}
                  {j.result.build.cachedFrom && t(' · 已驗證快取')}
                </p>
              )}
              {j.sourceDigest && (
                <p>
                  {t('來源')} {j.sourceDigest.slice(0, 12)}
                  {j.sourceDigest !== sourceDigest && t(' · 舊版本結果')}
                </p>
              )}
            </details>
          ))}
        {section === 'output' && !simulation && !(state?.jobs ?? []).length && (
          <p className="output-empty muted">
            {t('尚無輸出。開始編譯、模擬或寫入後，紀錄會顯示在這裡。')}
          </p>
        )}
      </div>
    </div>
  );
}
