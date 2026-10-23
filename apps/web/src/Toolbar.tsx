import { useState } from 'react';
import {
  CheckCheck,
  Hammer,
  Play,
  Square,
  Upload,
  Usb,
  Settings,
  Download,
  Undo2,
  Redo2,
  Scan,
  MoreHorizontal,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  FileCode2,
  History,
  Bug,
  RefreshCw,
} from 'lucide-react';
import { Dialog, IconButton, usePreference } from './Ui';
import { useT } from './i18n';

const definitions = [
  { id: 'check', label: '檢查', detail: '檢查接線與程式規則，不執行編譯', icon: CheckCheck },
  { id: 'compile', label: '編譯', detail: '使用本機工具鏈編譯，不寫入板子', icon: Hammer },
  { id: 'simulate', label: '模擬', detail: '編譯並執行支援板型的本機模擬', icon: Play },
  { id: 'upload', label: '寫入裝置', detail: '檢查並編譯成功後，選擇裝置寫入', icon: Upload },
  { id: 'history', label: '版本紀錄', detail: '查看與還原專案版本', icon: History },
  { id: 'export', label: '匯出', detail: '匯出電路圖、程式或完整可編輯專案', icon: Download },
  { id: 'serial', label: '序列埠', detail: '查看實體裝置訊息', icon: Usb },
  { id: 'settings', label: '工具設定', detail: '檢查工具鏈版本與裝置環境', icon: Settings },
  { id: 'undo', label: '復原', detail: '復原草稿修改 Ctrl+Z', icon: Undo2 },
  { id: 'redo', label: '重做', detail: '重做草稿修改 Ctrl+Shift+Z', icon: Redo2 },
  { id: 'preview', label: '程式碼預覽', detail: '全畫面唯讀程式碼預覽', icon: FileCode2 },
  {
    id: 'simulator-export',
    label: '模擬器專案',
    detail: '編譯並匯出外部模擬器專用 ZIP，不是本機模擬',
    icon: Download,
  },
  { id: 'report', label: '回報問題', detail: '在 GitHub 回報問題或提出建議', icon: Bug },
  { id: 'update', label: '檢查更新', detail: '連線到 GitHub 查詢最新版本', icon: RefreshCw },
];
const defaults = {
  iconsOnly: false,
  order: definitions.map((definition) => definition.id),
  visible: ['compile', 'simulate', 'upload', 'export', 'preview'],
};
export function Toolbar({
  commands,
  reasons = {},
  running = false,
}: {
  commands: Record<string, () => void>;
  reasons?: Record<string, string>;
  running?: boolean;
}) {
  const t = useT();
  const [preferences, setPreferences] = usePreference('toolbar', defaults);
  const [customizing, setCustomizing] = useState(false);
  const order = Array.isArray(preferences.order)
    ? [...new Set([...preferences.order, ...defaults.order])].filter((id) =>
        definitions.some((definition) => definition.id === id),
      )
    : defaults.order;
  const visible = ['simulate', 'upload', 'export'];
  const buttons = [...visible, ...order.filter((id) => !visible.includes(id))]
    .filter((id) => !['check', 'compile', 'preview', 'simulator-export', 'fit'].includes(id))
    .map((id) => definitions.find((definition) => definition.id === id)!);
  const command = (definition: (typeof definitions)[number], text = true) => (
    <IconButton
      key={definition.id}
      icon={definition.id === 'simulate' && running ? Square : definition.icon}
      label={definition.id === 'simulate' && running ? t('停止模擬') : t(definition.label)}
      detail={t(reasons[definition.id] || definition.detail)}
      text={text}
      disabled={!!reasons[definition.id]}
      onClick={(event) => {
        event.currentTarget.closest('details')?.removeAttribute('open');
        commands[definition.id]?.();
      }}
    />
  );
  return (
    <>
      <div className="command-toolbar" aria-label={t('主要工具列')}>
        {buttons
          .filter((definition) => visible.includes(definition.id))
          .map((definition) => command(definition))}
        <details className="toolbar-more">
          <summary
            aria-label={t('更多操作')}
            title={t('更多操作')}
            onClick={(event) => {
              const details = event.currentTarget.parentElement as HTMLDetailsElement | null;
              if (!details || details.open) return;
              requestAnimationFrame(() => {
                const menu = details.querySelector<HTMLElement>('.toolbar-menu');
                const summary = details.querySelector('summary');
                if (!menu || !summary) return;
                const anchor = summary.getBoundingClientRect();
                const margin = 8;
                const left = Math.max(
                  margin,
                  Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - margin),
                );
                const top = Math.max(
                  margin,
                  Math.min(anchor.bottom + 6, window.innerHeight - menu.offsetHeight - margin),
                );
                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
              });
            }}
          >
            <MoreHorizontal size={19} />
          </summary>
          <div className="toolbar-menu">
            {buttons
              .filter((definition) => !visible.includes(definition.id))
              .map((definition) => command(definition, true))}
          </div>
        </details>
      </div>
      {customizing && (
        <Dialog title={t('自訂工具列')} onClose={() => setCustomizing(false)}>
          <fieldset className="display-mode">
            <legend>{t('顯示模式')}</legend>
            <label>
              <input
                type="radio"
                name="toolbar-mode"
                checked={!preferences.iconsOnly}
                onChange={() => setPreferences({ ...preferences, iconsOnly: false })}
              />
              {t('圖示＋文字')}
            </label>
            <label>
              <input
                type="radio"
                name="toolbar-mode"
                checked={preferences.iconsOnly}
                onChange={() => setPreferences({ ...preferences, iconsOnly: true })}
              />
              {t('僅圖示')}
            </label>
          </fieldset>
          {buttons.map((definition, index) => (
            <div className="toolbar-choice" key={definition.id}>
              <label>
                <input
                  type="checkbox"
                  checked={visible.includes(definition.id)}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      visible: event.target.checked
                        ? [...visible, definition.id]
                        : visible.filter((id) => id !== definition.id),
                    })
                  }
                />
                {t(definition.label)}
              </label>
              {[-1, 1].map((delta) => (
                <IconButton
                  key={delta}
                  icon={delta < 0 ? ArrowUp : ArrowDown}
                  text={false}
                  label={t(delta < 0 ? '{name}往前' : '{name}往後', { name: t(definition.label) })}
                  disabled={index + delta < 0 || index + delta >= order.length}
                  onClick={() => {
                    const next = [...order];
                    [next[index], next[index + delta]] = [next[index + delta], next[index]];
                    setPreferences({ ...preferences, order: next });
                  }}
                />
              ))}
            </div>
          ))}
          <button onClick={() => setPreferences(defaults)}>{t('恢復預設工具列')}</button>
        </Dialog>
      )}
    </>
  );
}
