import { useState } from 'react';
import { oledImage } from './oled';
import {
  BUZZER_SEMITONE_RANGE,
  BUZZER_WAVES,
  buzzerAudio,
  useBuzzerAudio,
  type BuzzerWave,
} from './buzzerAudio';
import { useT } from './i18n';

type Field = { key: string; label: string; min: number; max: number; step: number; unit: string };
const fields: Record<string, Field[]> = {
  mpu6050: [
    { key: 'ax', label: '加速度 X', min: -2, max: 2, step: 0.05, unit: 'g' },
    { key: 'ay', label: '加速度 Y', min: -2, max: 2, step: 0.05, unit: 'g' },
    { key: 'az', label: '加速度 Z', min: -2, max: 2, step: 0.05, unit: 'g' },
    { key: 'gx', label: '角速度 X', min: -250, max: 250, step: 5, unit: '°/s' },
    { key: 'gy', label: '角速度 Y', min: -250, max: 250, step: 5, unit: '°/s' },
    { key: 'gz', label: '角速度 Z', min: -250, max: 250, step: 5, unit: '°/s' },
    { key: 'temperature', label: '晶片溫度', min: -20, max: 60, step: 0.5, unit: '°C' },
  ],
  dht22: [
    { key: 'temperature', label: '溫度', min: -40, max: 80, step: 0.1, unit: '°C' },
    { key: 'humidity', label: '濕度', min: 0, max: 100, step: 0.1, unit: '%' },
  ],
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (hz: number) => {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
};

// Sound settings are shared by every buzzer; the pitch itself always comes from the firmware.
export function BuzzerPanel({
  id,
  device,
  running,
}: {
  id: string;
  device: any;
  running: boolean;
}) {
  const t = useT();
  const audio = useBuzzerAudio();
  const [testHz, setTestHz] = useState(440);
  const sounding = running && device?.frequency > 0;
  return (
    <fieldset className="buzzer-panel">
      <legend>{t('{id} · 被動蜂鳴器', { id })}</legend>
      <p className={sounding ? 'buzzer-status on' : 'buzzer-status muted'} aria-live="off">
        {sounding
          ? t('發聲中 {hz} Hz（{note}）', {
              hz: Math.round(device.frequency),
              note: noteName(device.frequency),
            })
          : running
            ? t('靜音（韌體未輸出方波）')
            : t('模擬未執行')}
      </p>
      {audio.blocked && (
        <p className="muted">
          {t('瀏覽器尚未允許播放聲音，')}
          <button type="button" onClick={() => buzzerAudio.resume()}>
            {t('啟用聲音')}
          </button>
        </p>
      )}
      <label>
        {t('音量')}
        <input
          type="range"
          aria-label={t('蜂鳴器音量')}
          min={0}
          max={1}
          step={0.05}
          value={audio.volume}
          onChange={(e) => buzzerAudio.update({ volume: Number(e.target.value) })}
        />
        <output>{Math.round(audio.volume * 100)} %</output>
      </label>
      <label>
        {t('音高偏移')}
        <input
          type="range"
          aria-label={t('蜂鳴器音高偏移')}
          min={-BUZZER_SEMITONE_RANGE}
          max={BUZZER_SEMITONE_RANGE}
          step={1}
          value={audio.semitones}
          onChange={(e) => buzzerAudio.update({ semitones: Number(e.target.value) })}
        />
        <output>
          {audio.semitones > 0 ? '+' : ''}
          {t('{count} 半音', { count: audio.semitones })}
        </output>
      </label>
      <label>
        {t('音色')}
        <select
          aria-label={t('蜂鳴器波形')}
          value={audio.wave}
          onChange={(e) => buzzerAudio.update({ wave: e.target.value as BuzzerWave })}
        >
          {BUZZER_WAVES.map((w) => (
            <option key={w.id} value={w.id}>
              {t(w.label)}
            </option>
          ))}
        </select>
        <span />
      </label>
      <label>
        <span>{t('靜音')}</span>
        <input
          type="checkbox"
          aria-label={t('蜂鳴器靜音')}
          checked={audio.muted}
          onChange={(e) => buzzerAudio.update({ muted: e.target.checked })}
        />
        <span />
      </label>
      <label>
        {t('試聽頻率')}
        <input
          type="range"
          aria-label={t('試聽頻率')}
          min={100}
          max={4000}
          step={10}
          value={testHz}
          onChange={(e) => {
            const next = Number(e.target.value);
            setTestHz(next);
            buzzerAudio.setTestFrequency(next);
          }}
        />
        <output>{testHz} Hz</output>
      </label>
      <button
        type="button"
        aria-pressed={audio.testing}
        onClick={() => buzzerAudio.testTone(audio.testing ? null : testHz)}
      >
        {audio.testing ? t('停止試聽') : t('試聽')}
      </button>
    </fieldset>
  );
}

// Live module state from the local simulator: OLED panels and adjustable sensor inputs.
// Buzzers have their own panel in the inspector, next to the selected part.
export function SimulationPeripherals({
  peripherals,
  disabled,
  send,
}: {
  peripherals?: Record<string, any>;
  disabled: boolean;
  send: (id: string, values: Record<string, number>) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Record<string, Record<string, number>>>({});
  const entries = Object.entries(peripherals ?? {}).filter(
    ([, device]) => device.kind !== 'buzzer',
  );
  if (!entries.length) return null;
  return (
    <div className="simulation-peripherals">
      {entries.map(([id, device]) =>
        device.kind === 'oled' ? (
          <figure key={id}>
            <figcaption>{id} · OLED</figcaption>
            {device.on ? (
              <img
                src={oledImage(device.frame)}
                width={256}
                height={128}
                alt={t('{id} 模擬畫面', { id })}
              />
            ) : (
              <p className="muted">{t('顯示關閉（韌體尚未送出 Display ON）')}</p>
            )}
          </figure>
        ) : (
          <fieldset key={id} disabled={disabled}>
            <legend>
              {id} · {device.kind === 'dht22' ? 'DHT22' : 'MPU6050'}
            </legend>
            {device.kind === 'mpu6050' && !device.awake && (
              <p className="muted">{t('韌體尚未喚醒感測器（PWR_MGMT_1），讀值為 0')}</p>
            )}
            {device.kind === 'dht22' && (
              <p className="muted">{t('已讀取 {count} 次', { count: device.reads })}</p>
            )}
            {(fields[device.kind] ?? []).map((field) => {
              const value = draft[id]?.[field.key] ?? device.values[field.key];
              return (
                <label key={field.key}>
                  {t(field.label)}
                  <input
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={value}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setDraft((d) => ({ ...d, [id]: { ...d[id], [field.key]: next } }));
                      send(id, { [field.key]: next });
                    }}
                  />
                  <output>
                    {Number(value).toFixed(field.step < 1 ? (field.step < 0.1 ? 2 : 1) : 0)}{' '}
                    {field.unit}
                  </output>
                </label>
              );
            })}
          </fieldset>
        ),
      )}
    </div>
  );
}
