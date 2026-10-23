import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useT } from './i18n';

export type MenuCommand = {
  label: string;
  icon?: ReactNode;
  action?: () => void;
  disabled?: string;
  shortcut?: string;
  group?: string;
  danger?: boolean;
};
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuCommand[];
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null),
    previous = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    node.style.left = Math.max(8, Math.min(x, window.innerWidth - node.offsetWidth - 8)) + 'px';
    node.style.top = Math.max(8, Math.min(y, window.innerHeight - node.offsetHeight - 8)) + 'px';
    previous.current = document.activeElement as HTMLElement;
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      if (previous.current?.isConnected) previous.current.focus();
    };
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={t('操作選單')}
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ],
          at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[index]?.focus();
        }
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          role="menuitem"
          disabled={!!item.disabled || !item.action}
          title={item.disabled ? t(item.disabled) : undefined}
          className={[
            index && item.group !== items[index - 1].group ? 'menu-divider' : '',
            item.danger ? 'danger-item' : '',
          ].join(' ')}
          onClick={() => {
            onClose();
            item.action?.();
          }}
        >
          {item.icon}
          <span>
            {t(item.label)}
            {item.disabled && <small>{t(item.disabled)}</small>}
          </span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}
