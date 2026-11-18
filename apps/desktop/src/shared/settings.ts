import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";

import { sanitizeUiLanguage, type UiLanguage } from "@/i18n";
import { isApiKind, type ApiKind } from "@/llm/endpoint";
import { DEFAULT_SEARCH_ENGINE, sanitizeSearchEngine, type SearchEngine } from "./search";
import DEFAULT_EXCLUDED from "./default-excluded-apps.json";
import { isTauri } from "./runtime";

/** One configured service. v1 keeps a single model per service. */
export interface ProviderConfig {
  id: string;
  name: string;
  /** Preset id it was created from (`custom` when typed in by hand). */
  preset: string;
  /** Normalized base URL, without `/chat/completions` (or `/v1/messages`, `/v1beta/...`). */
  baseUrl: string;
  api: ApiKind;
  model: string;
  /** Extra request headers, e.g. for gateways. */
  headers: Record<string, string>;
  /** JSON merged into every request body. */
  extraBody: Record<string, unknown> | null;
  compat?: OpenAICompletionsCompat;
}

/** Matched against the bundle id on macOS and the executable name on Windows, ignoring case. */
export interface ExcludedApp {
  id: string;
  name: string;
  /** Set on built-in entries, so each platform only lists its own. */
  platform?: "macos" | "windows";
}

export const DEFAULT_SHORTCUT = "Alt+Backquote";
/** Wireframe default: ⌥⌘O (Alt+Super+KeyO in Tauri). */
export const DEFAULT_OCR_SHORTCUT = "Alt+Super+KeyO";

export type OcrLanguage = "system" | "zh-Hans" | "en-US";

export const OCR_LANGUAGES: OcrLanguage[] = ["system", "zh-Hans", "en-US"];

export function sanitizeOcrLanguage(raw: unknown): OcrLanguage {
  return raw === "zh-Hans" || raw === "en-US" || raw === "system" ? raw : "system";
}

/** CONTEXT.md 展开方式. */
export type ExpandMode = "hover" | "click" | "skip";

export const EXPAND_MODES: ExpandMode[] = ["hover", "click", "skip"];

export function sanitizeExpandMode(raw: unknown): ExpandMode {
  return raw === "click" || raw === "skip" || raw === "hover" ? raw : "hover";
}

/** Settings window appearance; overlay keeps its hand-written light styles. */
export type Theme = "system" | "light" | "dark";

export const THEMES: Theme[] = ["system", "light", "dark"];

export function sanitizeTheme(raw: unknown): Theme {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/**
 * `src-tauri/src/prefs.rs` reads `autoTrigger`, `clipboardFallback`, `shortcut`, `ocrShortcut`,
 * `ocrAutoFallback`, `ocrLanguage`, `excludedApps` and `uiLanguage` from the same file and applies them whenever it changes.
 */
export interface Settings {
  version: 1;
  providers: ProviderConfig[];
  defaultProviderId: string | null;
  /** `Language.prompt`; null follows the system locale. */
  nativeLanguage: string | null;
  /** CONTEXT.md 回答语言: what native text is translated into. `Language.prompt`; null picks English (Chinese for English speakers). */
  secondLanguage: string | null;
  /** CONTEXT.md 上下文: send the text around the selection. */
  sendContext: boolean;
  /** Send window title, URL and document name. Off also when `sendContext` is off. */
  sendWindowInfo: boolean;
  /** CONTEXT.md 触发: show the bubble after a mouse selection. */
  autoTrigger: boolean;
  /**
   * CONTEXT.md 展开方式: how the bubble becomes the Action Bar.
   * `hover` dwells then expands (click still works); `click` only expands on click; `skip` shows the bar at once.
   */
  expandMode: ExpandMode;
  /** Copy the selection via the clipboard (then restore it) when accessibility finds no text. */
  clipboardFallback: boolean;
  /** Tauri accelerator such as `Alt+Backquote`; null turns the global shortcut off. */
  shortcut: string | null;
  /** Screen-region OCR shortcut; null turns it off. */
  ocrShortcut: string | null;
  /** When selection text is unavailable, OCR near the selection. Default off; auto path may be settings-only in v1. */
  ocrAutoFallback: boolean;
  /** Vision recognition languages. */
  ocrLanguage: OcrLanguage;
  excludedApps: ExcludedApp[];
  /** Language of the interface; `system` follows the OS (its language when there is a catalog for it, else en). */
  uiLanguage: UiLanguage;
  /** Settings window theme; `system` follows prefers-color-scheme. Overlay is unchanged. */
  theme: Theme;
  /** Website the 搜索 action opens. */
  searchEngine: SearchEngine;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  providers: [],
  defaultProviderId: null,
  nativeLanguage: null,
  secondLanguage: null,
  sendContext: true,
  sendWindowInfo: true,
  autoTrigger: true,
  expandMode: "hover",
  clipboardFallback: true,
  shortcut: DEFAULT_SHORTCUT,
  ocrShortcut: DEFAULT_OCR_SHORTCUT,
  ocrAutoFallback: false,
  ocrLanguage: "system",
  excludedApps: DEFAULT_EXCLUDED as ExcludedApp[],
  uiLanguage: "system",
  theme: "system",
  searchEngine: DEFAULT_SEARCH_ENGINE,
};

const FILE = "settings.json";
const KEY = "settings";
const BROWSER_KEY = "pointer.settings";

/**
 * Headers that carry the API key. It lives in the keychain; written here it would be saved in
 * plain text in settings.json and win over the keychain one.
 */
const KEY_HEADERS = ["authorization", "x-api-key", "x-goog-api-key", "api-key"];

/**
 * Body fields Pointer fills in, across every protocol: the model, the conversation, the system
 * prompt (and with it the "context is data" rule) and streaming.
 */
const RESERVED_BODY_KEYS = [
  "model",
  "messages",
  "input",
  "stream",
  "system",
  "instructions",
  "contents",
  "systemInstruction",
  "system_instruction",
];

export function isKeyHeader(name: string): boolean {
  return KEY_HEADERS.includes(name.trim().toLowerCase());
}

export function reservedBodyKey(body: Record<string, unknown>): string | undefined {
  return RESERVED_BODY_KEYS.find((key) => key in body);
}

/** String values only, minus the key headers; anything else in the file is dropped. */
function sanitizeHeaders(raw: unknown): Record<string, string> {
  if (!isPlainObject(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(([name, value]) => typeof value === "string" && !isKeyHeader(name)),
  ) as Record<string, string>;
}

/** An object without reserved keys, else none. */
function sanitizeExtraBody(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  const body = Object.fromEntries(Object.entries(raw).filter(([key]) => !reservedBodyKey({ [key]: true })));
  return Object.keys(body).length ? body : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Fills in fields added after the file was written; drops anything unreadable. */
export function sanitize(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<Settings>;
  const providers = Array.isArray(r.providers) ? r.providers.filter(isProvider) : [];
  const defaultProviderId = providers.some((p) => p.id === r.defaultProviderId)
    ? (r.defaultProviderId as string)
    : (providers[0]?.id ?? null);
  return {
    version: 1,
    providers: providers.map(({ compat, ...p }) => ({
      ...p,
      headers: sanitizeHeaders(p.headers),
      extraBody: sanitizeExtraBody(p.extraBody),
      ...(isPlainObject(compat) ? { compat } : {}),
    })),
    defaultProviderId,
    nativeLanguage: typeof r.nativeLanguage === "string" ? r.nativeLanguage : null,
    secondLanguage: typeof r.secondLanguage === "string" ? r.secondLanguage : null,
    sendContext: r.sendContext !== false,
    sendWindowInfo: r.sendWindowInfo !== false,
    autoTrigger: r.autoTrigger !== false,
    expandMode: sanitizeExpandMode(r.expandMode),
    clipboardFallback: r.clipboardFallback !== false,
    shortcut: typeof r.shortcut === "string" || r.shortcut === null ? r.shortcut : DEFAULT_SHORTCUT,
    ocrShortcut: typeof r.ocrShortcut === "string" || r.ocrShortcut === null ? r.ocrShortcut : DEFAULT_OCR_SHORTCUT,
    ocrAutoFallback: r.ocrAutoFallback === true,
    ocrLanguage: sanitizeOcrLanguage(r.ocrLanguage),
    excludedApps: Array.isArray(r.excludedApps) ? r.excludedApps.filter(isExcludedApp) : DEFAULT_SETTINGS.excludedApps,
    uiLanguage: sanitizeUiLanguage(r.uiLanguage),
    theme: sanitizeTheme(r.theme),
    searchEngine: sanitizeSearchEngine(r.searchEngine),
  };
}

function isExcludedApp(a: unknown): a is ExcludedApp {
  if (!a || typeof a !== "object") return false;
  const c = a as Partial<ExcludedApp>;
  return typeof c.id === "string" && c.id.trim() !== "" && typeof c.name === "string";
}

function isProvider(p: unknown): p is ProviderConfig {
  if (!p || typeof p !== "object") return false;
  const c = p as Partial<ProviderConfig>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    typeof c.baseUrl === "string" &&
    typeof c.model === "string" &&
    isApiKind(c.api)
  );
}

async function tauriStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  // The backend keeps one instance per path, so the overlay and settings windows share it.
  return load(FILE, { autoSave: false, defaults: {} });
}

export async function loadSettings(): Promise<Settings> {
  try {
    if (!isTauri()) return sanitize(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null"));
    const store = await tauriStore();
    return sanitize(await store.get(KEY));
  } catch (e) {
    console.warn("[pointer] settings unreadable, using defaults", e);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(s));
    return;
  }
  const store = await tauriStore();
  await store.set(KEY, s);
  await store.save();
}

export function defaultProvider(s: Settings): ProviderConfig | null {
  return s.providers.find((p) => p.id === s.defaultProviderId) ?? null;
}

export function newProviderId(): string {
  return crypto.randomUUID();
}
