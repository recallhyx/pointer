import { useMemo, useSyncExternalStore } from "react";

import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { zh, type MessageKey } from "./zh";

export type { MessageKey };

export type Locale = "zh" | "en" | "ja" | "ko" | "es" | "fr";
/** The `uiLanguage` setting: follow the system or force one. */
export type UiLanguage = "system" | Locale;

export const LOCALES: Locale[] = ["zh", "en", "ja", "ko", "es", "fr"];

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { zh, en, ja, ko, es, fr };

/** `<html lang>` for each locale. */
const HTML_LANG: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en",
  ja: "ja",
  ko: "ko",
  es: "es",
  fr: "fr",
};

const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

/**
 * The system locale's language when there is a catalog for it (any Chinese locale gets Chinese);
 * everything else English.
 */
export function localeFromSystem(
  system: string | undefined = typeof navigator === "undefined" ? undefined : navigator.language,
): Locale {
  const primary = system?.toLowerCase().split(/[-_]/)[0];
  return isLocale(primary) ? primary : "en";
}

export function resolveLocale(pref: string | null | undefined, system?: string): Locale {
  return isLocale(pref) ? pref : localeFromSystem(system);
}

export function sanitizeUiLanguage(raw: unknown): UiLanguage {
  return isLocale(raw) ? raw : "system";
}

let current: Locale = localeFromSystem();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  const changed = next !== current;
  current = next;
  // Always sync <html lang>, even when the locale was already current (module init may have
  // matched system while index.html still said zh-CN).
  if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[next];
  if (changed) listeners.forEach((l) => l());
}

/** Align document lang with the locale resolved at module load (before any setLocale call). */
if (typeof document !== "undefined") {
  document.documentElement.lang = HTML_LANG[current];
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export type Params = Record<string, string | number>;

/** Looks `key` up in `locale` and fills `{name}` placeholders. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const text = CATALOGS[locale][key] ?? zh[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** For code that runs outside React: uses whichever locale is current at call time. */
export function t(key: MessageKey, params?: Params): string {
  return translate(current, key, params);
}

export type Translate = typeof t;

/** Re-renders the component when the locale changes. */
export function useT(): Translate {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return useMemo(() => (key, params) => translate(locale, key, params), [locale]);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
