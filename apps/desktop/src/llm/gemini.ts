/**
 * Native Gemini (Generative Language API) streaming. pi-ai's Google adapter goes through
 * `@google/genai`, which always uses the page's own `fetch` and refuses a custom one, so in Tauri
 * it would skip the HTTP plugin the other providers use (no CORS, same proxy and TLS behaviour on
 * macOS and Windows). The protocol is small enough to speak directly.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";

export interface GeminiTurn {
  role: "user" | "assistant";
  text: string;
}

export interface GeminiRequest {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown> | null;
  systemPrompt: string;
  turns: GeminiTurn[];
  maxTokens: number;
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
}

/** The subset of pi-ai's stream events `streamAnswer` reads. */
export type GeminiEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: { errorMessage?: string } };

export function geminiModelId(model: string): string {
  return model.trim().replace(/^models\//, "");
}

/**
 * Thinking off where the model allows it: 2.5 Flash/Flash-Lite take a zero budget, 3.x the lowest
 * level. 2.5 Pro cannot turn it off, so it gets nothing and the thoughts stay hidden.
 */
export function geminiThinkingConfig(model: string): Record<string, unknown> | undefined {
  const id = geminiModelId(model).toLowerCase();
  if (/gemini-2\.5-flash/.test(id)) return { thinkingBudget: 0 };
  if (/gemini-[3-9]/.test(id)) return { thinkingLevel: "low" };
  return undefined;
}

export function geminiBody(req: Pick<GeminiRequest, "model" | "systemPrompt" | "turns" | "maxTokens" | "extraBody">) {
  const thinkingConfig = geminiThinkingConfig(req.model);
  const { generationConfig: extraConfig, ...extra } = req.extraBody ?? {};
  return {
    ...(req.systemPrompt ? { systemInstruction: { parts: [{ text: req.systemPrompt }] } } : {}),
    contents: req.turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
    ...extra,
    // Merged one level down, so `{"generationConfig":{"temperature":0.3}}` keeps thinking off and the token cap.
    generationConfig: {
      maxOutputTokens: req.maxTokens,
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(isObject(extraConfig) ? extraConfig : {}),
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function geminiStreamUrl(baseUrl: string, model: string): string {
  return `${baseUrl}/v1beta/models/${encodeURIComponent(geminiModelId(model))}:streamGenerateContent?alt=sse`;
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string };
}

/**
 * A candidate stopped by these comes back with no text; reported as an error so the panel does not
 * show an empty answer as if it had succeeded.
 */
const BLOCKED_FINISH = ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"];

/** Text and thought deltas in one SSE chunk; `blocked` when the prompt or the answer was refused. */
export function parseGeminiChunk(chunk: GeminiChunk): { text: string; thinking: string; blocked?: string } {
  let text = "";
  let thinking = "";
  const candidate = chunk.candidates?.[0];
  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part.text !== "string") continue;
    if (part.thought) thinking += part.text;
    else text += part.text;
  }
  const finish = candidate?.finishReason;
  const blocked = chunk.promptFeedback?.blockReason ?? (finish && BLOCKED_FINISH.includes(finish) ? finish : undefined);
  return { text, thinking, blocked };
}

/** Turns an error body into pi-ai's `"<status> <message>"` shape so `classifyError` reads it. */
export function geminiHttpError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as GeminiChunk | GeminiChunk[];
    const err = (Array.isArray(parsed) ? parsed[0] : parsed)?.error;
    if (err?.message) return `${status} ${err.message}`;
  } catch {
    // not JSON
  }
  return `${status} ${body.trim() || "request failed"}`;
}

async function* sseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
      if (done) break;
    }
    const rest = buf.trim();
    if (rest.startsWith("data:")) yield rest.slice(5).trim();
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function message(model: string, text: string, chunk: GeminiChunk | null, stopped: boolean): AssistantMessage {
  const u = chunk?.usageMetadata;
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "google-generative-ai",
    provider: "pointer",
    model,
    usage: {
      input: u?.promptTokenCount ?? 0,
      output: u?.candidatesTokenCount ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: u?.totalTokenCount ?? 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: stopped ? "length" : "stop",
    timestamp: Date.now(),
  };
}

export async function* streamGemini(req: GeminiRequest): AsyncGenerator<GeminiEvent> {
  const fail = (errorMessage: string): GeminiEvent =>
    req.signal.aborted
      ? { type: "error", reason: "aborted", error: {} }
      : { type: "error", reason: "error", error: { errorMessage } };
  try {
    const res = await req.fetch(geminiStreamUrl(req.baseUrl, req.model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.apiKey ? { "x-goog-api-key": req.apiKey } : {}),
        ...req.headers,
      },
      body: JSON.stringify(geminiBody(req)),
      signal: req.signal,
    });
    if (!res.ok || !res.body) {
      yield fail(geminiHttpError(res.status, await res.text().catch(() => "")));
      return;
    }
    let text = "";
    let last: GeminiChunk | null = null;
    for await (const data of sseData(res.body, req.signal)) {
      if (!data || data === "[DONE]") continue;
      const chunk = JSON.parse(data) as GeminiChunk;
      if (chunk.error) {
        yield fail(`${chunk.error.code ?? 500} ${chunk.error.message ?? "error"}`);
        return;
      }
      last = chunk;
      const parsed = parseGeminiChunk(chunk);
      if (parsed.blocked) {
        yield fail(`400 Blocked by Gemini: ${parsed.blocked}`);
        return;
      }
      if (parsed.thinking) yield { type: "thinking_delta", delta: parsed.thinking };
      if (parsed.text) {
        text += parsed.text;
        yield { type: "text_delta", delta: parsed.text };
      }
    }
    if (req.signal.aborted) {
      yield fail("aborted");
      return;
    }
    const finish = last?.candidates?.[0]?.finishReason;
    yield { type: "done", message: message(geminiModelId(req.model), text, last, finish === "MAX_TOKENS") };
  } catch (e) {
    yield fail(e instanceof Error ? e.message : String(e));
  }
}
