import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { setLocale, useLocale, useT } from './i18n';

export function IconButton({
  icon: Icon,
  label,
  detail = label,
  text = true,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  detail?: string;
  text?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      {...props}
      aria-label={label}
      title={detail}
      className={'icon-command ' + (props.className ?? '')}
    >
      <Icon size={17} aria-hidden="true" />
      {text && <span>{label}</span>}
      {children}
      <span className="command-tooltip" role="tooltip">
        {detail}
      </span>
    </button>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null),
    previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={'workspace-dialog ' + className}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label={t('關閉{title}', { title })} title={t('關閉')} onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}

// Language choice is saved for later visits; each language name is shown in its own script.
export function LanguageSwitch() {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="language-switch" role="group" aria-label={t('介面語言')}>
      <button aria-pressed={locale === 'zh-Hant'} onClick={() => setLocale('zh-Hant')}>
        中文
      </button>
      <button aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>
        English
      </button>
    </div>
  );
}

export function usePreference<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem('opencircuit.' + key);
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('opencircuit.' + key, JSON.stringify(value));
    } catch {
      /* Preferences still work for this window when storage is unavailable. */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
