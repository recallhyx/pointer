/** ADR 0003 测试连接和错误文案: map provider failures to a short line the panel can show. */

import { t, type MessageKey } from "@/i18n";

export type ErrorKind =
  | "auth"
  | "not-found"
  | "rate-limit"
  | "bad-request"
  | "server"
  | "network"
  | "first-token-timeout"
  | "total-timeout"
  | "unknown";

export interface AnswerError {
  kind: ErrorKind;
  message: string;
  /** Raw provider text, for the tooltip and the settings window. */
  detail?: string;
}

const MESSAGES: Record<ErrorKind, MessageKey> = {
  auth: "error.auth",
  "not-found": "error.notFound",
  "rate-limit": "error.rateLimit",
  "bad-request": "error.badRequest",
  server: "error.server",
  network: "error.network",
  "first-token-timeout": "error.firstTokenTimeout",
  "total-timeout": "error.totalTimeout",
  unknown: "error.unknown",
};

export function answerError(kind: ErrorKind, detail?: string): AnswerError {
  return { kind, message: t(MESSAGES[kind]), detail: detail?.slice(0, 500) };
}

/** pi-ai formats HTTP failures as `"<status> <message>"` or `"<status>: <body>"`. */
export function classifyError(raw: string): AnswerError {
  const text = raw.trim();
  const status = Number(/^(\d{3})\b/.exec(text)?.[1] ?? NaN);
  const lower = text.toLowerCase();
  let kind: ErrorKind;
  if (
    status === 401 ||
    status === 403 ||
    /invalid.{0,10}api.?key|api.?key not valid|incorrect api key|unauthorized|authentication_error/.test(lower)
  )
    kind = "auth";
  else if (status === 404 || /model.{0,40}(not exist|not found)|no such model/.test(lower)) kind = "not-found";
  else if (
    status === 429 ||
    status === 402 ||
    /rate.?limit|quota|insufficient.{0,10}(balance|credit|quota)/.test(lower)
  )
    kind = "rate-limit";
  else if (status >= 500) kind = "server";
  else if (status >= 400) kind = "bad-request";
  else if (
    /connection error|failed to fetch|fetch failed|network|dns|econn|enotfound|certificate|tls|timed out|error sending request/.test(
      lower,
    )
  )
    kind = "network";
  else kind = "unknown";
  return answerError(kind, text);
}
