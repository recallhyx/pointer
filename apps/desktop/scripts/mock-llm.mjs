#!/usr/bin/env node
// A local OpenAI-compatible server for developing without a provider key.
//
//   pnpm mock            # http://127.0.0.1:8787/v1, any key (keys starting with "bad" get 401)
//
// Models: mock-chat (normal), mock-thinking (reasoning_content first), mock-slow (20s before the
// first token), mock-error-500, mock-429. Anything else is a 404. /chat/completions, /responses,
// Anthropic's /v1/messages (base http://127.0.0.1:8787) and Gemini's
// /v1beta/models/<model>:streamGenerateContent (same base) all stream. The answer echoes the selection and the thinking parameters it received.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8787);
const MODELS = ["mock-chat", "mock-thinking", "mock-slow", "mock-error-500", "mock-429"];
/** Body fields pi-ai always sends; anything else came from compat rules or 额外请求参数. */
const STANDARD = new Set([
  "model",
  "messages",
  "input",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
  "store",
  "instructions",
  "include",
  "prompt_cache_key",
  "temperature",
  "system",
  "contents",
  "systemInstruction",
  "generationConfig",
  "thinking",
  "metadata",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function errorBody(message, type) {
  return { error: { message, type, code: null } };
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? "").join("");
  return "";
}

/** Pulls the system prompt and the latest user message out of either protocol's body. */
function conversation(body) {
  const items = body.messages ?? (Array.isArray(body.input) ? body.input : []);
  const system = [
    body.instructions ?? "",
    textOf(body.system),
    ...items.filter((m) => m.role === "system" || m.role === "developer").map((m) => textOf(m.content)),
  ].join("\n");
  const user =
    items
      .filter((m) => m.role === "user")
      .map((m) => textOf(m.content))
      .pop() ?? "";
  const turns = items.filter((m) => m.role === "user").length;
  const replies = items.filter((m) => m.role === "assistant" || m.type === "message").length;
  return { system, user, turns, replies };
}

function answerFor(body) {
  const { system, user, turns, replies } = conversation(body);
  if (/single word OK/.test(system)) return "OK";
  const tag = (name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(user)?.[1] ?? null;
  const selection = tag("selection") ?? user;
  const task = /Task: translate the selected text into ([^.]+)\./.exec(system)?.[1];
  const extras = Object.fromEntries(Object.entries(body).filter(([k]) => !STANDARD.has(k)));
  const short = selection.length > 60 ? `${selection.slice(0, 60)}…` : selection;
  return [
    task
      ? `**模拟翻译**（目标：${task}）：${short}`
      : `**模拟解释**：「${short}」是一段被选中的文字，这里是本地 mock 服务返回的回答。`,
    "",
    "- 应用：" + (tag("app") ?? "未知") + (tag("url") ? `，网址 ${tag("url")}` : ""),
    "- 上下文：" + (tag("context_before") || tag("context_after") ? "已发送" : "未发送"),
    "- 收到的额外参数：" + (Object.keys(extras).length ? `\`${JSON.stringify(extras)}\`` : "无"),
    `- 对话：${turns} 条用户消息，${replies} 条之前的回答`,
    "",
    "| 项目 | 值 |",
    "| --- | --- |",
    `| 模型 | ${body.model} |`,
    `| 选中字数 | ${[...selection].length} |`,
    "",
    "行内公式 \\(E = mc^2\\)，独立公式：",
    "",
    "\\[ \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2} \\]",
    "",
    "```rust",
    'let s = String::from("hello");',
    "let r = &s; // 借用",
    "```",
    "",
    "[Rust 文档](https://doc.rust-lang.org/book/)",
  ].join("\n");
}

function chunks(text) {
  const out = [];
  for (let i = 0; i < text.length;) {
    const n = 2 + Math.floor(Math.random() * 5);
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  return (data, event) =>
    res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

async function streamCompletions(req, res, body, gone) {
  const send = sse(res);
  const id = `chatcmpl-mock-${Date.now()}`;
  const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
  const delta = (d, finish = null) => send({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish }] });
  delta({ role: "assistant", content: "" });
  if (body.model === "mock-thinking") {
    for (const t of chunks("先想一想这个词在上下文里的意思……")) {
      if (gone()) return;
      delta({ reasoning_content: t });
      await sleep(30);
    }
  }
  const text = answerFor(body);
  for (const t of chunks(text)) {
    if (gone()) return;
    delta({ content: t });
    await sleep(15);
  }
  delta({}, "stop");
  send({
    ...base,
    choices: [],
    usage: { prompt_tokens: 100, completion_tokens: text.length, total_tokens: 100 + text.length },
  });
  send("[DONE]");
  res.end();
}

async function streamAnthropic(req, res, body, gone) {
  const send = sse(res);
  send(
    {
      type: "message_start",
      message: {
        id: `msg_mock_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    },
    "message_start",
  );
  send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start");
  const text = answerFor(body);
  for (const t of chunks(text)) {
    if (gone()) return;
    send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }, "content_block_delta");
    await sleep(15);
  }
  send({ type: "content_block_stop", index: 0 }, "content_block_stop");
  send(
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: text.length } },
    "message_delta",
  );
  send({ type: "message_stop" }, "message_stop");
  res.end();
}

async function streamGemini(req, res, body, gone) {
  const send = sse(res);
  const text = answerFor(body);
  for (const t of chunks(text)) {
    if (gone()) return;
    send({ candidates: [{ content: { role: "model", parts: [{ text: t }] } }] });
    await sleep(15);
  }
  send({
    candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: text.length, totalTokenCount: 100 + text.length },
  });
  res.end();
}

/** Gemini's body in the OpenAI shape `answerFor` reads. */
function fromGemini(body, model) {
  const text = (c) => (c?.parts ?? []).map((p) => p.text ?? "").join("");
  return {
    ...body,
    model,
    messages: [
      ...(body.systemInstruction ? [{ role: "system", content: text(body.systemInstruction) }] : []),
      ...(body.contents ?? []).map((c) => ({ role: c.role === "model" ? "assistant" : "user", content: text(c) })),
    ],
  };
}

async function streamResponses(req, res, body, gone) {
  const send = sse(res);
  const id = `resp_mock_${Date.now()}`;
  const item = { type: "message", id: `msg_${Date.now()}`, role: "assistant", status: "in_progress", content: [] };
  send({ type: "response.created", response: { id, status: "in_progress", output: [] } }, "response.created");
  send({ type: "response.output_item.added", output_index: 0, item }, "response.output_item.added");
  const text = answerFor(body);
  for (const t of chunks(text)) {
    if (gone()) return;
    send(
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: item.id, delta: t },
      "response.output_text.delta",
    );
    await sleep(15);
  }
  const done = { ...item, status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
  send({ type: "response.output_item.done", output_index: 0, item: done }, "response.output_item.done");
  send(
    {
      type: "response.completed",
      response: {
        id,
        status: "completed",
        output: [done],
        usage: { input_tokens: 100, output_tokens: text.length, total_tokens: 100 + text.length },
      },
    },
    "response.completed",
  );
  res.end();
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const gemini = /^\/v1beta\/models\/([^/:]+):streamGenerateContent$/.exec(url.pathname);
  const path = gemini
    ? "/gemini"
    : url.pathname.startsWith("/v1beta/")
      ? url.pathname
      : url.pathname.replace(/^\/v1/, "");
  const auth =
    req.headers.authorization ??
    `Bearer ${req.headers["x-api-key"] ?? req.headers["x-goog-api-key"] ?? url.searchParams.get("key") ?? ""}`;
  const started = Date.now();
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  const log = (status, extra = "") =>
    console.log(
      `${new Date().toISOString().slice(11, 23)} ${req.method} ${url.pathname} → ${status} ${Date.now() - started}ms ${extra}`,
    );

  if (/^Bearer bad/.test(auth)) {
    json(res, 401, errorBody("Incorrect API key provided.", "invalid_request_error"));
    return log(401);
  }
  if (req.method === "GET" && path === "/models") {
    json(res, 200, { object: "list", data: MODELS.map((id) => ({ id, object: "model", owned_by: "mock" })) });
    return log(200);
  }
  if (req.method === "GET" && path === "/v1beta/models") {
    json(res, 200, {
      models: MODELS.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] })),
    });
    return log(200);
  }
  if (req.method !== "POST" || !["/chat/completions", "/responses", "/messages", "/gemini"].includes(path)) {
    json(res, 404, errorBody(`No route for ${req.method} ${url.pathname}`, "not_found"));
    return log(404);
  }

  let body;
  try {
    body = await readJson(req);
    if (gemini) body = fromGemini(body, decodeURIComponent(gemini[1]));
  } catch {
    json(res, 400, errorBody("Body is not valid JSON", "invalid_request_error"));
    return log(400);
  }
  const extras = Object.fromEntries(Object.entries(body).filter(([k]) => !STANDARD.has(k)));
  const summary = `model=${body.model} extras=${JSON.stringify(extras)}`;
  if (!MODELS.includes(body.model)) {
    json(res, 404, errorBody(`The model \`${body.model}\` does not exist`, "invalid_request_error"));
    return log(404, summary);
  }
  if (body.model === "mock-error-500") {
    json(res, 500, errorBody("Internal server error (mock)", "server_error"));
    return log(500, summary);
  }
  if (body.model === "mock-429") {
    json(res, 429, errorBody("Rate limit reached (mock)", "rate_limit_exceeded"));
    return log(429, summary);
  }
  if (body.model === "mock-slow") {
    for (let i = 0; i < 200 && !closed; i++) await sleep(100);
    if (closed) return log("aborted", summary);
  }
  if (body.stream === false) {
    json(res, 200, {
      id: "chatcmpl-mock",
      object: "chat.completion",
      model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: answerFor(body) }, finish_reason: "stop" }],
    });
    return log(200, summary);
  }
  const stream =
    { "/responses": streamResponses, "/messages": streamAnthropic, "/gemini": streamGemini }[path] ?? streamCompletions;
  await stream(req, res, body, () => closed);
  log(closed ? "aborted" : 200, summary);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock LLM on http://127.0.0.1:${PORT}/v1  (models: ${MODELS.join(", ")})`);
});
