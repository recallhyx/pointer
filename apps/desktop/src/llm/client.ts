/**
 * The thin interface we own around pi-ai (ADR 0003). Callers never import pi-ai directly, so the
 * library can be swapped for the Vercel AI SDK by rewriting this file only.
 */
import type {
  AssistantMessage,
  Message,
  Model,
  OpenAICompletionsCompat,
  SimpleStreamOptions,
  StreamFunction,
} from "@earendil-works/pi-ai";

import type { ApiKind } from "./endpoint";
import { answerError, classifyError, type AnswerError } from "./errors";

export interface ModelTarget {
  baseUrl: string;
  api: ApiKind;
  model: string;
  /** Null for local servers that take no key. */
  apiKey: string | null;
  headers?: Record<string, string>;
  /** User-supplied JSON merged into the request body (高级选项: 额外请求参数). */
  extraBody?: Record<string, unknown> | null;
  compat?: OpenAICompletionsCompat;
}

/** One round of 追问: the answer the model gave, then what the user asked about it. */
export interface FollowUp {
  previousAnswer: string;
  question: string;
}

export interface StreamRequest {
  target: ModelTarget;
  systemPrompt: string;
  userMessage: string;
  /** Earlier rounds of the same conversation, oldest first; the last question is the one to answer. */
  followUps?: FollowUp[];
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  timeouts?: Timeouts;
}

export interface Timeouts {
  firstTokenMs: number;
  totalMs: number;
}

/** ADR 0003 网络设置. */
export const DEFAULT_TIMEOUTS: Timeouts = { firstTokenMs: 15_000, totalMs: 120_000 };
/** Fetching the model list in settings: long enough for a slow gateway, short enough to give up. */
const LIST_MODELS_TIMEOUT_MS = 15_000;

export type StreamResult =
  | { status: "done"; text: string; firstTokenMs: number | null; totalMs: number; message: AssistantMessage }
  | { status: "aborted"; text: string }
  | { status: "error"; text: string; error: AnswerError };

/**
 * pi-ai assumes OpenAI's own dialect (developer role, `store`, `max_completion_tokens`) for hosts
 * it does not recognise. Most OpenAI-compatible servers only accept the classic one.
 */
const CLASSIC_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
};

const PROVIDER = "pointer";

function isOpenAIHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api.openai.com" || host.endsWith(".openai.azure.com");
  } catch {
    return false;
  }
}

function toModel(t: ModelTarget): Model<ApiKind> {
  const compat = { ...(isOpenAIHost(t.baseUrl) ? {} : CLASSIC_COMPAT), ...t.compat };
  return {
    id: t.model,
    name: t.model,
    api: t.api,
    provider: PROVIDER,
    baseUrl: t.baseUrl,
    // Unknown models are treated as reasoning-capable so pi-ai sends the vendor's "thinking off"
    // parameter where it knows one; non-reasoning models ignore it.
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    // Answers are short; a large cap makes small local models reject the request.
    maxTokens: MAX_TOKENS,
    ...(t.api === "openai-completions" ? { compat } : {}),
  } as Model<ApiKind>;
}

/** Earlier answers are replayed as if this model wrote them, so pi-ai sends them unchanged. */
function conversation(req: StreamRequest, now: number): Message[] {
  const user = (content: string): Message => ({ role: "user", content, timestamp: now });
  const assistant = (text: string): Message => ({
    role: "assistant",
    content: [{ type: "text", text }],
    api: req.target.api,
    provider: PROVIDER,
    model: req.target.model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: now,
  });
  return [
    user(req.userMessage),
    ...(req.followUps ?? []).flatMap((f) => [assistant(f.previousAnswer), user(f.question)]),
  ];
}

/** Each protocol is its own chunk, loaded the first time it is used. */
async function loadStreamSimple(api: ApiKind): Promise<StreamFunction<ApiKind, SimpleStreamOptions>> {
  const mod =
    api === "openai-completions"
      ? await import("@earendil-works/pi-ai/api/openai-completions")
      : api === "anthropic-messages"
        ? await import("@earendil-works/pi-ai/api/anthropic-messages")
        : await import("@earendil-works/pi-ai/api/openai-responses");
  return mod.streamSimple as StreamFunction<ApiKind, SimpleStreamOptions>;
}

const MAX_TOKENS = 4_096;

type StreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; reason: string; error: { errorMessage?: string } }
  | { type: string };

async function openStream(req: StreamRequest, signal: AbortSignal): Promise<AsyncIterable<StreamEvent>> {
  const extra = req.target.extraBody;
  if (req.target.api === "google-generative-ai") {
    const { streamGemini } = await import("./gemini");
    return streamGemini({
      baseUrl: req.target.baseUrl,
      model: req.target.model,
      apiKey: req.target.apiKey,
      headers: req.target.headers,
      extraBody: extra,
      systemPrompt: req.systemPrompt,
      turns: [
        { role: "user", text: req.userMessage },
        ...(req.followUps ?? []).flatMap((f) => [
          { role: "assistant" as const, text: f.previousAnswer },
          { role: "user" as const, text: f.question },
        ]),
      ],
      maxTokens: MAX_TOKENS,
      fetch: req.fetch,
      signal,
    });
  }
  const streamSimple = await loadStreamSimple(req.target.api);
  const { normalizeContext } = await import("@earendil-works/pi-ai/utils/transcript");
  const context = normalizeContext({
    systemPrompt: req.systemPrompt,
    messages: conversation(req, Date.now()),
  });
  return streamSimple(toModel(req.target), context, {
    apiKey: req.target.apiKey || "not-needed",
    headers: req.target.headers,
    fetch: req.fetch,
    signal,
    maxRetries: 1,
    onPayload: extra ? (payload) => ({ ...(payload as object), ...extra }) : undefined,
  });
}

/**
 * Streams one answer with thinking off. Never throws: failures, cancellation and timeouts come
 * back as a result so the panel can show them inline.
 */
export async function streamAnswer(req: StreamRequest): Promise<StreamResult> {
  const timeouts = req.timeouts ?? DEFAULT_TIMEOUTS;
  const started = performance.now();
  const controller = new AbortController();
  let timedOut: AnswerError | null = null;
  const abort = () => controller.abort();
  req.signal?.addEventListener("abort", abort);
  if (req.signal?.aborted) controller.abort();
  const expire = (kind: "first-token-timeout" | "total-timeout") => () => {
    timedOut = answerError(kind);
    controller.abort();
  };
  let firstTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
    expire("first-token-timeout"),
    timeouts.firstTokenMs,
  );
  const totalTimer = setTimeout(expire("total-timeout"), timeouts.totalMs);
  let firstTokenMs: number | null = null;
  let text = "";
  const firstToken = () => {
    if (firstTimer === undefined) return;
    clearTimeout(firstTimer);
    firstTimer = undefined;
    firstTokenMs = Math.round(performance.now() - started);
  };

  try {
    const stream = await openStream(req, controller.signal);
    for await (const event of stream as AsyncIterable<
      Extract<StreamEvent, { type: "text_delta" | "thinking_delta" | "done" | "error" }>
    >) {
      if (event.type === "text_delta") {
        firstToken();
        text += event.delta;
        req.onText?.(event.delta);
      } else if (event.type === "thinking_delta") {
        firstToken();
        req.onThinking?.(event.delta);
      } else if (event.type === "done") {
        return {
          status: "done",
          text,
          firstTokenMs,
          totalMs: Math.round(performance.now() - started),
          message: event.message,
        };
      } else if (event.type === "error") {
        if (timedOut) return { status: "error", text, error: timedOut };
        if (event.reason === "aborted") return { status: "aborted", text };
        return { status: "error", text, error: classifyError(event.error.errorMessage ?? "") };
      }
    }
    return { status: "error", text, error: answerError("unknown", "stream ended without a result") };
  } catch (e) {
    if (timedOut) return { status: "error", text, error: timedOut };
    if (controller.signal.aborted) return { status: "aborted", text };
    return { status: "error", text, error: classifyError(e instanceof Error ? e.message : String(e)) };
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    req.signal?.removeEventListener("abort", abort);
  }
}

/** 测试连接: one tiny request, stopped as soon as the first token arrives. */
export async function testConnection(
  target: ModelTarget,
  fetch: typeof globalThis.fetch,
): Promise<{ ok: true; firstTokenMs: number } | { ok: false; error: AnswerError }> {
  const controller = new AbortController();
  let firstTokenMs = 0;
  const started = performance.now();
  const result = await streamAnswer({
    target,
    systemPrompt: "Reply with the single word OK.",
    userMessage: "ping",
    fetch,
    signal: controller.signal,
    onText: () => {
      firstTokenMs = Math.round(performance.now() - started);
      controller.abort();
    },
  });
  if (result.status === "error") return { ok: false, error: result.error };
  return { ok: true, firstTokenMs: result.status === "done" ? (result.firstTokenMs ?? result.totalMs) : firstTokenMs };
}

/** 模型列表: where each protocol lists models and how it wants the key. */
export function modelsRequest(target: Pick<ModelTarget, "baseUrl" | "apiKey" | "headers"> & { api?: ApiKind }): {
  url: string;
  headers: Record<string, string>;
} {
  const key = target.apiKey;
  switch (target.api) {
    case "anthropic-messages":
      return {
        url: `${target.baseUrl}/v1/models?limit=1000`,
        headers: {
          "anthropic-version": "2023-06-01",
          ...(key ? { "x-api-key": key } : {}),
          ...target.headers,
        },
      };
    case "google-generative-ai":
      return {
        url: `${target.baseUrl}/v1beta/models?pageSize=1000`,
        headers: { ...(key ? { "x-goog-api-key": key } : {}), ...target.headers },
      };
    default:
      return {
        url: `${target.baseUrl}/models`,
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...target.headers },
      };
  }
}

/** OpenAI and Anthropic answer `{data: [{id}]}`; Gemini `{models: [{name: "models/x", supportedGenerationMethods}]}`. */
export function parseModelIds(body: unknown): string[] {
  const b = (body ?? {}) as {
    data?: { id?: unknown }[];
    models?: { name?: unknown; supportedGenerationMethods?: unknown }[];
  };
  const ids = [
    ...(b.data ?? []).map((m) => m.id),
    ...(b.models ?? [])
      .filter(
        (m) => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes("generateContent"),
      )
      .map((m) => (typeof m.name === "string" ? m.name.replace(/^models\//, "") : m.name)),
  ].filter((id): id is string => typeof id === "string" && id !== "");
  return [...new Set(ids)].sort();
}

/** Outcome of GET /models (or vendor equivalent). */
export type ListModelsResult =
  { status: "ok"; ids: string[] } | { status: "empty" } | { status: "error"; error: AnswerError };

/**
 * Lists models from the provider.
 * - `ok` with ids when the endpoint returned at least one
 * - `empty` when the response was fine but listed nothing (caller should ask for a manual name)
 * - `error` when the host was unreachable or returned a failure (do not say "no models returned")
 */
export async function listModels(
  target: Pick<ModelTarget, "baseUrl" | "apiKey" | "headers"> & { api?: ApiKind },
  fetch: typeof globalThis.fetch,
  signal?: AbortSignal,
  timeoutMs = LIST_MODELS_TIMEOUT_MS,
): Promise<ListModelsResult> {
  // A hung server would otherwise keep the settings button busy until the address changes.
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const { url, headers } = modelsRequest(target);
    const res = await fetch(url, { headers, signal: combined });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { status: "error", error: classifyError(`${res.status} ${body}`.trim()) };
    }
    const ids = parseModelIds(await res.json());
    return ids.length ? { status: "ok", ids } : { status: "empty" };
  } catch (e) {
    if (timeout.aborted && !signal?.aborted) return { status: "error", error: answerError("network", "timed out") };
    const raw = e instanceof Error ? e.message : String(e);
    return { status: "error", error: classifyError(raw || "Connection error.") };
  }
}
