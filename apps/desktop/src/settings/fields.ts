import { t } from "@/i18n";
import { isKeyHeader, reservedBodyKey } from "@/shared/settings";

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/** One `Name: value` per line; blank lines are ignored. */
export function parseHeaders(text: string): Parsed<Record<string, string>> {
  const headers: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
      return { ok: false, reason: t("fields.headerLine", { line: i + 1 }) };
    if (isKeyHeader(name)) return { ok: false, reason: t("fields.headerAuth", { name }) };
    headers[name] = line.slice(colon + 1).trim();
  }
  return { ok: true, value: headers };
}

export function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** A JSON object merged into the request body; empty means none. */
export function parseExtraBody(text: string): Parsed<Record<string, unknown> | null> {
  if (!text.trim()) return { ok: true, value: null };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: t("fields.notJson") };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: t("fields.notObject") };
  const key = reservedBodyKey(value as Record<string, unknown>);
  if (key) return { ok: false, reason: t("fields.reservedKey", { key }) };
  return { ok: true, value: value as Record<string, unknown> };
}

export function formatExtraBody(body: Record<string, unknown> | null): string {
  return body ? JSON.stringify(body, null, 2) : "";
}
