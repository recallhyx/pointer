/** ADR 0003 地址规范化: the only URL handling we do ourselves. */

import { t } from "@/i18n";

export type ApiKind = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export const API_KINDS: readonly ApiKind[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

export function isApiKind(v: unknown): v is ApiKind {
  return typeof v === "string" && (API_KINDS as readonly string[]).includes(v);
}

export interface Endpoint {
  baseUrl: string;
  api: ApiKind;
  /** The URL requests will actually go to, shown under the input. */
  requestUrl: string;
}

export type EndpointResult = { ok: true; endpoint: Endpoint } | { ok: false; reason: string };

/** Longest first, so `/v1/messages` wins over anything shorter. */
const SUFFIXES: [RegExp, ApiKind][] = [
  [/\/chat\/completions$/i, "openai-completions"],
  [/\/responses$/i, "openai-responses"],
  [/\/v1\/messages$/i, "anthropic-messages"],
  // A pasted Gemini request URL: `/v1beta/models/<model>:streamGenerateContent` or just `/v1beta`.
  [/\/v1beta(\/models(\/[^/]*)?)?$/i, "google-generative-ai"],
];

/** Native vendor APIs take the bare host; their version prefix is part of the path we add. */
export function requestPath(api: ApiKind, model?: string): string {
  switch (api) {
    case "openai-completions":
      return "/chat/completions";
    case "openai-responses":
      return "/responses";
    case "anthropic-messages":
      return "/v1/messages";
    case "google-generative-ai":
      return `/v1beta/models/${model?.trim().replace(/^models\//, "") || "{model}"}:streamGenerateContent`;
  }
}

/** Plain http is only allowed for this machine and the local network. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1") return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * Trims spaces and trailing slashes. A pasted full `/chat/completions` or `/responses` URL is cut
 * back to its base and decides the protocol. `/v1` is never added.
 */
export function normalizeEndpoint(input: string, api: ApiKind, model?: string): EndpointResult {
  let base = input.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, reason: t("endpoint.empty") };
  // `?alt=sse` / `?key=` from a pasted Gemini URL are ours to add.
  if (/\/v1beta\//i.test(base)) base = base.replace(/[?#].*$/, "").replace(/\/+$/, "");
  for (const [suffix, kind] of SUFFIXES) {
    const m = suffix.exec(base);
    if (m) {
      base = base.slice(0, m.index).replace(/\/+$/, "");
      api = kind;
      break;
    }
  }
  // Anthropic's SDK appends `/v1/messages`, so a pasted `.../v1` base would double it.
  if (api === "anthropic-messages") base = base.replace(/\/v1$/i, "");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { ok: false, reason: t("endpoint.malformed") };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: t("endpoint.protocol") };
  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    return { ok: false, reason: t("endpoint.httpRemote") };
  }
  // `url.search` is "" for a bare trailing `?` (same for `#`), so check the text too: the path
  // appended below would end up in the query string.
  if (url.search || url.hash || /[?#]/.test(base)) return { ok: false, reason: t("endpoint.queryOrHash") };
  return { ok: true, endpoint: { baseUrl: base, api, requestUrl: base + requestPath(api, model) } };
}
