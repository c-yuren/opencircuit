import { useState } from 'react';
import type { Definition, Instance } from '../../../packages/core/src/model';
import { useT } from './i18n';

export function ComponentParameters({
  definition,
  instance,
  onSave,
}: {
  definition: Definition;
  instance: Instance;
  onSave: (parameters: Instance['parameters']) => void;
}) {
  const t = useT();
  const p = { ...definition.parameters, ...instance.parameters };
  const kind = definition.typeId.split(':')[1];
  const raw =
    kind === 'resistor'
      ? Number(p.resistance ?? 220)
      : kind === 'usb-supply'
        ? Number(p.voltage ?? 5)
        : parseFloat(String(p.capacitance ?? '100nF'));
  const [value, setValue] = useState(String(raw));
  const [unit, setUnit] = useState(
    kind === 'capacitor'
      ? (String(p.capacitance ?? '100nF').match(/(?:pF|nF|uF)$/)?.[0] ?? 'nF')
      : '1',
  );
  const [color, setColor] = useState(String(p.color ?? 'red'));
  const [powerPreset, setPowerPreset] = useState(String(p.voltagePreset ?? raw));
  const [error, setError] = useState('');
  if (!['resistor', 'capacitor', 'led-red', 'usb-supply'].includes(kind)) return null;
  const save = (next = value, nextUnit = unit, preset = powerPreset) => {
    const number = Number(next);
    if (!Number.isFinite(number) || number <= 0) {
      setError(t('請輸入大於零的數字'));
      return;
    }
    setError('');
    onSave({
      ...instance.parameters,
      ...(kind === 'usb-supply' ? { voltagePreset: preset } : {}),
      [kind === 'resistor' ? 'resistance' : kind === 'usb-supply' ? 'voltage' : 'capacitance']:
        kind === 'capacitor' ? number + nextUnit : number * Number(nextUnit),
    });
  };
  if (kind === 'led-red')
    return (
      <section className="component-parameters">
        <label>
          {t('顏色')}
          <select
            aria-label={t('LED 顏色')}
            value={['red', 'green', 'blue', 'yellow', 'white'].includes(color) ? color : 'custom'}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setColor('#e45767');
                onSave({ ...instance.parameters, color: '#e45767' });
              } else {
                setColor(event.target.value);
                onSave({ ...instance.parameters, color: event.target.value });
              }
            }}
          >
            {[
              ['red', '紅色'],
              ['green', '綠色'],
              ['blue', '藍色'],
              ['yellow', '黃色'],
              ['white', '白色'],
              ['custom', '其他'],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {color.startsWith('#') && (
          <input
            aria-label={t('其他 LED 顏色')}
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
              onSave({ ...instance.parameters, color: event.target.value });
            }}
          />
        )}
      </section>
    );
  const options =
    kind === 'resistor'
      ? [
          [220, '220 Ω'],
          [330, '330 Ω'],
          [1000, '1 kΩ'],
          [4700, '4.7 kΩ'],
          [10000, '10 kΩ'],
        ]
      : kind === 'capacitor'
        ? [
            ['100nF', '100 nF'],
            ['1uF', '1 µF'],
            ['10uF', '10 µF'],
            ['100uF', '100 µF'],
          ]
        : [
            [3.3, '3.3V'],
            [5, '5V'],
            [9, '9V'],
            [12, '12V'],
            [3.7, '18650 (3.7V)'],
          ];
  const current = kind === 'capacitor' ? Number(value) + unit : Number(value) * Number(unit);
  const valueLabel = kind === 'resistor' ? '阻值' : kind === 'capacitor' ? '容量' : '電壓';
  return (
    <section className="component-parameters">
      <label>
        {t(kind === 'usb-supply' ? '電源預設' : '常用值')}
        <select
          aria-label={t('參數預設')}
          value={
            kind === 'usb-supply' && powerPreset === 'custom'
              ? 'custom'
              : options.some(([v]) => String(v) === String(current))
                ? String(current)
                : 'custom'
          }
          onChange={(event) => {
            if (event.target.value === 'custom') {
              setPowerPreset('custom');
              return;
            }
            const next = event.target.value;
            const nextUnit = kind === 'capacitor' ? next.match(/(?:pF|nF|uF)$/)![0] : '1';
            const nextValue = kind === 'capacitor' ? String(parseFloat(next)) : next;
            setValue(nextValue);
            setUnit(nextUnit);
            setPowerPreset(next);
            save(nextValue, nextUnit, next);
          }}
        >
          {options.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
          <option value="custom">{t('自訂值')}</option>
        </select>
      </label>
      <label>
        {t(valueLabel)}
        <div className="parameter-value">
          <input
            aria-label={t(valueLabel)}
            type="number"
            min="0.000001"
            step="any"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setPowerPreset('custom');
            }}
            onBlur={() => {
              if (
                String(current) !==
                String(
                  kind === 'resistor'
                    ? p.resistance
                    : kind === 'capacitor'
                      ? p.capacitance
                      : (p.voltage ?? 5),
                )
              )
                save();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          {kind === 'usb-supply' ? (
            <span>V</span>
          ) : (
            <select
              aria-label={t('參數單位')}
              value={unit}
              onChange={(event) => {
                setUnit(event.target.value);
                save(value, event.target.value);
              }}
            >
              {(kind === 'resistor'
                ? [
                    ['1', 'Ω'],
                    ['1000', 'kΩ'],
                    ['1000000', 'MΩ'],
                  ]
                : [
                    ['pF', 'pF'],
                    ['nF', 'nF'],
                    ['uF', 'µF'],
                  ]
              ).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
      </label>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
