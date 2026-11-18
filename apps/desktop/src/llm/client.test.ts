import { describe, expect, it } from "vitest";

import { listModels, streamAnswer, testConnection, type ModelTarget } from "./client";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

const completion = (...parts: string[]) => [
  ...parts.map((p) => chunk({ content: p })),
  chunk({}, "stop"),
  "data: [DONE]\n\n",
];

/** A fetch that records requests and replays canned SSE events, honoring abort. */
function fakeFetch(reply: (sent: Sent) => { status?: number; events?: string[]; body?: string; delayMs?: number }) {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const s: Sent = {
      url: req.url,
      headers: Object.fromEntries(req.headers.entries()),
      body: req.method === "POST" ? JSON.parse(await req.text()) : {},
    };
    sent.push(s);
    const r = reply(s);
    if (r.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, r.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if (r.events) return new Response(r.events.join(""), { headers: { "content-type": "text/event-stream" } });
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const target = (patch: Partial<ModelTarget> = {}): ModelTarget => ({
  baseUrl: "https://api.deepseek.com/v1",
  api: "openai-completions",
  model: "deepseek-chat",
  apiKey: "sk-test",
  ...patch,
});

const ask = (t: ModelTarget, fetch: typeof globalThis.fetch, extra: Partial<Parameters<typeof streamAnswer>[0]> = {}) =>
  streamAnswer({ target: t, systemPrompt: "SYSTEM", userMessage: "<selection>borrowing</selection>", fetch, ...extra });

describe("streamAnswer", () => {
  it("streams text and turns thinking off with the vendor's parameter", async () => {
    const { fetch, sent } = fakeFetch(() => ({ events: completion("借用", "是", "引用。") }));
    const deltas: string[] = [];
    const r = await ask(target(), fetch, { onText: (d) => deltas.push(d) });
    expect(r.status).toBe("done");
    expect(r.text).toBe("借用是引用。");
    expect(deltas).toEqual(["借用", "是", "引用。"]);
    expect(sent[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(sent[0].headers.authorization).toBe("Bearer sk-test");
    expect(sent[0].body).toMatchObject({
      model: "deepseek-chat",
      stream: true,
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "<selection>borrowing</selection>" },
      ],
    });
  });

  it("speaks the classic dialect to hosts pi-ai does not know", async () => {
    const { fetch, sent } = fakeFetch(() => ({ events: completion("ok") }));
    await ask(target({ baseUrl: "http://127.0.0.1:11434/v1", apiKey: null }), fetch);
    const body = sent[0].body;
    expect((body.messages as { role: string }[])[0].role).toBe("system");
    expect(body).not.toHaveProperty("store");
    expect(body).toHaveProperty("max_tokens");
    expect(sent[0].headers.authorization).toBe("Bearer not-needed");
  });

  it("uses preset compat, extra body and custom headers", async () => {
    const { fetch, sent } = fakeFetch(() => ({ events: completion("ok") }));
    await ask(
      target({
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        compat: { thinkingFormat: "qwen" },
        extraBody: { temperature: 0.2 },
        headers: { "X-Team": "pointer" },
      }),
      fetch,
    );
    expect(sent[0].body).toMatchObject({ enable_thinking: false, temperature: 0.2 });
    expect(sent[0].headers["x-team"]).toBe("pointer");
  });

  it("does not count thinking as answer text", async () => {
    const { fetch } = fakeFetch(() => ({
      events: [chunk({ reasoning_content: "hmm" }), ...completion("答案")],
    }));
    const thinking: string[] = [];
    const r = await ask(target(), fetch, { onThinking: (d) => thinking.push(d) });
    expect(r.text).toBe("答案");
    expect(thinking.join("")).toBe("hmm");
  });

  it("maps a 401 to a key error", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 401,
      body: JSON.stringify({ error: { message: "Incorrect API key provided." } }),
    }));
    const r = await ask(target(), fetch);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error.kind).toBe("auth");
  });

  it("gives up when the first token is late", async () => {
    const { fetch } = fakeFetch(() => ({ delayMs: 5_000, events: completion("late") }));
    const r = await ask(target(), fetch, { timeouts: { firstTokenMs: 50, totalMs: 1_000 } });
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error.kind).toBe("first-token-timeout");
  });

  it("reports a caller abort as aborted, not an error", async () => {
    const { fetch } = fakeFetch(() => ({ delayMs: 5_000, events: completion("late") }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const r = await ask(target(), fetch, { signal: controller.signal });
    expect(r.status).toBe("aborted");
  });

  it("supports the Responses API", async () => {
    const ev = (e: Record<string, unknown>) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
    const item = { type: "message", id: "m1", role: "assistant", content: [] };
    const { fetch, sent } = fakeFetch(() => ({
      events: [
        ev({ type: "response.created", response: { id: "r1", status: "in_progress", output: [] } }),
        ev({ type: "response.output_item.added", output_index: 0, item }),
        ev({ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "m1", delta: "Hel" }),
        ev({ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "m1", delta: "lo" }),
        ev({
          type: "response.output_item.done",
          output_index: 0,
          item: { ...item, content: [{ type: "output_text", text: "Hello" }] },
        }),
        ev({ type: "response.completed", response: { id: "r1", status: "completed", output: [] } }),
      ],
    }));
    const r = await ask(
      target({ baseUrl: "https://api.openai.com/v1", api: "openai-responses", model: "gpt-5-mini" }),
      fetch,
    );
    expect(sent[0].url).toBe("https://api.openai.com/v1/responses");
    expect(r.status).toBe("done");
    expect(r.text).toBe("Hello");
  });
});

describe("testConnection", () => {
  it("stops at the first token", async () => {
    const { fetch } = fakeFetch(() => ({ events: completion("OK") }));
    const r = await testConnection(target(), fetch);
    expect(r.ok).toBe(true);
  });

  it("returns the mapped error", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 404,
      body: JSON.stringify({ error: { message: "model not found" } }),
    }));
    const r = await testConnection(target(), fetch);
    expect(r).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });
});

describe("listModels", () => {
  it("reads GET /models", async () => {
    const { fetch, sent } = fakeFetch(() => ({
      body: JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "b" }] }),
    }));
    expect(await listModels(target(), fetch)).toEqual({ status: "ok", ids: ["a", "b"] });
    expect(sent[0].url).toBe("https://api.deepseek.com/v1/models");
    expect(sent[0].headers.authorization).toBe("Bearer sk-test");
  });

  it("returns error when the service has no list endpoint", async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: "{}" }));
    const r = await listModels(target(), fetch);
    expect(r.status).toBe("error");
  });

  it("returns empty when the list is vacant", async () => {
    const { fetch } = fakeFetch(() => ({ body: JSON.stringify({ data: [] }) }));
    expect(await listModels(target(), fetch)).toEqual({ status: "empty" });
  });

  it("gives up on a server that never answers", async () => {
    const hang: typeof globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const r = await listModels(target(), hang, undefined, 20);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error.kind).toBe("network");
  });
});

describe("native Anthropic and Gemini", () => {
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const anthropicEvents = (...parts: string[]) => [
    sse("message_start", {
      type: "message_start",
      message: {
        id: "m1",
        type: "message",
        role: "assistant",
        model: "claude-x",
        content: [],
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ...parts.map((p) =>
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: p } }),
    ),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }),
    sse("message_stop", { type: "message_stop" }),
  ];
  const anthropic = (patch: Partial<ModelTarget> = {}) =>
    target({
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      model: "claude-x",
      apiKey: "sk-ant-1",
      ...patch,
    });
  const gemini = (patch: Partial<ModelTarget> = {}) =>
    target({
      baseUrl: "https://generativelanguage.googleapis.com",
      api: "google-generative-ai",
      model: "gemini-2.5-flash",
      apiKey: "AIza1",
      ...patch,
    });
  const geminiEvents = (...parts: string[]) => [
    ...parts.map(
      (p) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: p }] } }] })}\r\n\r\n`,
    ),
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 3 } })}\n\n`,
  ];

  it("streams Anthropic through the given fetch with x-api-key and follow-ups", async () => {
    const { fetch, sent } = fakeFetch(() => ({ events: anthropicEvents("借用", "是") }));
    const r = await ask(anthropic(), fetch, { followUps: [{ previousAnswer: "A1", question: "Q2" }] });
    expect(r.status).toBe("done");
    expect(r.text).toBe("借用是");
    expect(sent[0].url).toMatch(/^https:\/\/api.anthropic.com\/v1\/messages(\?|$)/);
    expect(sent[0].body.thinking).not.toMatchObject({ type: "enabled" });
    expect(sent[0].headers["x-api-key"]).toBe("sk-ant-1");
    expect(sent[0].body).toMatchObject({ model: "claude-x", stream: true, max_tokens: 4096 });
    const msgs = sent[0].body.messages as { role: string }[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("streams Gemini with system instruction, model turns and thinking off", async () => {
    const { fetch, sent } = fakeFetch(() => ({ events: geminiEvents("借用", "是") }));
    const deltas: string[] = [];
    const r = await ask(gemini({ extraBody: { safetySettings: [] } }), fetch, {
      onText: (d) => deltas.push(d),
      followUps: [{ previousAnswer: "A1", question: "Q2" }],
    });
    expect(r.status).toBe("done");
    expect(deltas).toEqual(["借用", "是"]);
    expect(sent[0].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    expect(sent[0].headers["x-goog-api-key"]).toBe("AIza1");
    expect(sent[0].body).toEqual({
      systemInstruction: { parts: [{ text: "SYSTEM" }] },
      contents: [
        { role: "user", parts: [{ text: "<selection>borrowing</selection>" }] },
        { role: "model", parts: [{ text: "A1" }] },
        { role: "user", parts: [{ text: "Q2" }] },
      ],
      generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
      safetySettings: [],
    });
  });

  it("maps Gemini HTTP errors and aborts", async () => {
    const bad = fakeFetch(() => ({
      status: 400,
      body: JSON.stringify({ error: { code: 400, message: "API key not valid." } }),
    }));
    const r = await ask(gemini(), bad.fetch);
    expect(r.status === "error" && r.error.kind).toBe("auth");

    const slow = fakeFetch(() => ({ events: geminiEvents("x"), delayMs: 1000 }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    expect((await ask(gemini(), slow.fetch, { signal: controller.signal })).status).toBe("aborted");
  });

  it("lists models with each vendor's auth", async () => {
    const a = fakeFetch(() => ({ body: JSON.stringify({ data: [{ id: "claude-b" }, { id: "claude-a" }] }) }));
    expect(await listModels({ ...anthropic(), api: "anthropic-messages" }, a.fetch)).toEqual({
      status: "ok",
      ids: ["claude-a", "claude-b"],
    });
    expect(a.sent[0].url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(a.sent[0].headers).toMatchObject({ "x-api-key": "sk-ant-1", "anthropic-version": "2023-06-01" });

    const g = fakeFetch(() => ({
      body: JSON.stringify({
        models: [
          { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    }));
    expect(await listModels({ ...gemini(), api: "google-generative-ai" }, g.fetch)).toEqual({
      status: "ok",
      ids: ["gemini-2.5-flash"],
    });
    expect(g.sent[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(g.sent[0].headers["x-goog-api-key"]).toBe("AIza1");
  });
});
