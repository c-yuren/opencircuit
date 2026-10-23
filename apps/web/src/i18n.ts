import { useSyncExternalStore } from 'react';
import { english } from './i18n.en';
import { messageEnglish, messagePatterns } from './i18n.messages.en';

// The Chinese source text is the lookup key, so zh-Hant needs no table and any text without an
// English entry keeps its Chinese form. Placeholders use {name} and are filled from `values`.
export type Locale = 'zh-Hant' | 'en';

const STORAGE_KEY = 'opencircuit.locale';
const titles: Record<Locale, string> = {
  'zh-Hant': 'OpenCircuit · 電子原型工作區',
  en: 'OpenCircuit · Electronics prototyping workspace',
};
const listeners = new Set<() => void>();

function storedLocale(): Locale {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh-Hant';
  } catch {
    return 'zh-Hant';
  }
}

let current: Locale = storedLocale();

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = titles[locale];
}
applyDocumentLocale(current);

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* The switch still applies to this window when storage is unavailable. */
  }
  applyDocumentLocale(next);
  for (const listener of listeners) listener();
}

// Interface text first, then messages from core and the server, then value-based patterns.
// Anything not covered is returned unchanged.
function translateEnglish(text: string): string {
  const exact = english[text] ?? messageEnglish[text];
  if (exact !== undefined) return exact;
  for (const [pattern, template] of messagePatterns) {
    const match = pattern.exec(text);
    if (match)
      return template.replace(/\$(\d+)/g, (_, index: string) => match[Number(index)] ?? '');
  }
  return text;
}

export function t(text: string, values?: Record<string, string | number>): string {
  const translated = current === 'en' ? translateEnglish(text) : text;
  if (!values) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

// Job logs mix tool output with lines written by the service; translate each line on its own.
export function translateLog(text: string): string {
  return text
    .split('\n')
    .map((line) => t(line))
    .join('\n');
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

// Components call this hook so they re-render when the language changes.
export function useT() {
  useLocale();
  return t;
}

// Locale tag for Intl and toLocale* formatting.
export const intlLocale = () => (current === 'en' ? 'en-US' : 'zh-TW');
