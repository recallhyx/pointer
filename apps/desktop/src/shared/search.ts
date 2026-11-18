/** Websites the 搜索 action can open. `%s` is replaced by the URL-encoded query. */
export const SEARCH_PRESETS = {
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  baidu: "https://www.baidu.com/s?wd=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
} as const;

export type SearchPreset = keyof typeof SEARCH_PRESETS;
export type SearchEngineId = SearchPreset | "custom";

export interface SearchEngine {
  id: SearchEngineId;
  /** Only used when `id` is `custom`; kept otherwise so switching back restores it. */
  customUrl: string;
}

export const DEFAULT_SEARCH_ENGINE: SearchEngine = { id: "google", customUrl: "" };
export const SEARCH_ENGINE_IDS: SearchEngineId[] = [...(Object.keys(SEARCH_PRESETS) as SearchPreset[]), "custom"];

const MAX_QUERY = 500;

/** A custom template must be an http(s) URL containing `%s`. */
export function isValidSearchTemplate(template: string): boolean {
  const t = template.trim();
  if (!t.includes("%s")) return false;
  try {
    const u = new URL(t.replaceAll("%s", "q"));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeSearchEngine(raw: unknown): SearchEngine {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SEARCH_ENGINE };
  const r = raw as Partial<SearchEngine>;
  const id = SEARCH_ENGINE_IDS.includes(r.id as SearchEngineId) ? (r.id as SearchEngineId) : "google";
  return { id, customUrl: typeof r.customUrl === "string" ? r.customUrl : "" };
}

/** The template actually used; an invalid custom one falls back to Google. */
export function searchTemplate(engine: SearchEngine): string {
  if (engine.id !== "custom") return SEARCH_PRESETS[engine.id];
  return isValidSearchTemplate(engine.customUrl) ? engine.customUrl.trim() : SEARCH_PRESETS.google;
}

export function searchUrl(text: string, engine: SearchEngine = DEFAULT_SEARCH_ENGINE): string {
  // By code point: slicing UTF-16 units can split an emoji, and encodeURIComponent throws on a lone surrogate.
  const q = encodeURIComponent([...text.trim()].slice(0, MAX_QUERY).join(""));
  return searchTemplate(engine).replaceAll("%s", q);
}
