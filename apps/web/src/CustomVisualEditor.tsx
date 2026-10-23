import { useRef, useState } from 'react';
import type { Definition, ComponentVisual } from '../../../packages/core/src/model';
import { componentVisual } from '../../../packages/core/src/graphics';
import { HardwareArt } from './HardwareArt';
import { useT } from './i18n';

export function CustomVisualEditor({
  definition,
  onChange,
}: {
  definition: Definition;
  onChange: (visual: ComponentVisual | undefined) => void;
}) {
  const t = useT();
  const v = componentVisual(definition),
    [pinId, setPinId] = useState(''),
    [error, setError] = useState(''),
    stage = useRef<HTMLDivElement>(null);
  const currentPin = definition.pins.some((p) => p.id === pinId) ? pinId : definition.pins[0]?.id;
  const save = (patch: Partial<ComponentVisual>) => onChange({ ...v, ...patch });
  function place(clientX: number, clientY: number) {
    if (!currentPin || !stage.current) return;
    const r = stage.current.getBoundingClientRect(),
      x = Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    const nearest = [
      { side: 'left' as const, d: x },
      { side: 'right' as const, d: 1 - x },
      { side: 'top' as const, d: y },
      { side: 'bottom' as const, d: 1 - y },
    ].sort((a, b) => a.d - b.d)[0];
    save({
      pinPositions: {
        ...v.pinPositions,
        [currentPin]: {
          x: Math.round(x * 1000) / 1000,
          y: Math.round(y * 1000) / 1000,
          side: nearest.side,
        },
      },
    });
  }
  return (
    <details className="custom-visual-editor" open>
      <summary>{t('自訂元件圖片與接腳位置')}</summary>
      <p className="muted">
        {t(
          '上傳俯視照片或去背圖片，再選接腳並點圖片定位。位置只控制圖形，不會改變電氣 pin ID。',
        )}
      </p>
      <label>
        {t('元件圖片（PNG / JPEG / WebP，最大 2 MB）')}
        <input
          type="file"
          aria-label={t('自訂元件圖片')}
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            try {
              setError('');
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2 * 1024 * 1024) throw new Error(t('圖片不可超過 2 MB'));
              if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
                throw new Error(t('請使用 PNG、JPEG 或 WebP'));
              const image = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error(t('圖片讀取失敗')));
                reader.readAsDataURL(file);
              });
              await new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  if (img.width > 4096 || img.height > 4096)
                    reject(new Error(t('圖片尺寸不可超過 4096 × 4096')));
                  else resolve();
                };
                img.onerror = () => reject(new Error(t('圖片無法解碼')));
                img.src = image;
              });
              save({ image });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="visual-editor-controls">
        <label>
          {t('圖形寬度')}
          <input
            aria-label={t('圖形寬度')}
            type="number"
            min="40"
            max="600"
            value={v.width}
            onChange={(e) => save({ width: Math.max(40, Math.min(600, Number(e.target.value))) })}
          />
        </label>
        <label>
          {t('圖形高度')}
          <input
            aria-label={t('圖形高度')}
            type="number"
            min="40"
            max="600"
            value={v.height}
            onChange={(e) => save({ height: Math.max(40, Math.min(600, Number(e.target.value))) })}
          />
        </label>
        <label>
          {t('定位接腳')}
          <select
            aria-label={t('圖片定位接腳')}
            value={currentPin ?? ''}
            onChange={(e) => setPinId(e.target.value)}
          >
            {!definition.pins.length && <option value="">{t('先定義具名接腳')}</option>}
            {definition.pins.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="visual-editor-stage"
        ref={stage}
        style={{ aspectRatio: `${v.width}/${v.height}`, maxWidth: Math.min(420, v.width * 1.4) }}
        onClick={(e) => place(e.clientX, e.clientY)}
        role="button"
        tabIndex={0}
        aria-label={t('自訂圖片接腳定位區')}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && stage.current) {
            e.preventDefault();
            const r = stage.current.getBoundingClientRect();
            place(r.x + r.width / 2, r.y + r.height / 2);
          }
        }}
      >
        <HardwareArt definition={definition} />
        {definition.pins.map((p) => {
          const point = v.pinPositions[p.id];
          return point ? (
            <span
              key={p.id}
              className={'visual-pin-marker ' + (p.id === currentPin ? 'selected' : '')}
              style={{ left: point.x * 100 + '%', top: point.y * 100 + '%' }}
            >
              <b />
              <small>{p.name}</small>
            </span>
          ) : null;
        })}
      </div>
      {currentPin && v.pinPositions[currentPin] && (
        <div className="pin-position-inputs">
          <label>
            {t('X 位置（%）')}
            <input
              aria-label={t('接腳 X 百分比')}
              type="number"
              min="0"
              max="100"
              step=".1"
              value={Math.round(v.pinPositions[currentPin].x * 1000) / 10}
              onChange={(e) =>
                save({
                  pinPositions: {
                    ...v.pinPositions,
                    [currentPin]: {
                      ...v.pinPositions[currentPin],
                      x: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                    },
                  },
                })
              }
            />
          </label>
          <label>
            {t('Y 位置（%）')}
            <input
              aria-label={t('接腳 Y 百分比')}
              type="number"
              min="0"
              max="100"
              step=".1"
              value={Math.round(v.pinPositions[currentPin].y * 1000) / 10}
              onChange={(e) =>
                save({
                  pinPositions: {
                    ...v.pinPositions,
                    [currentPin]: {
                      ...v.pinPositions[currentPin],
                      y: Math.max(0, Math.min(100, Number(e.target.value))) / 100,
                    },
                  },
                })
              }
            />
          </label>
        </div>
      )}
      <button type="button" onClick={() => onChange(undefined)}>
        {t('恢復預設元件圖與接腳')}
      </button>
    </details>
  );
}
