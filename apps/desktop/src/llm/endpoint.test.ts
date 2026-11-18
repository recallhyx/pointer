import { describe, expect, it } from "vitest";

import { isLocalHost, normalizeEndpoint } from "./endpoint";
import { classifyError } from "./errors";

describe("normalizeEndpoint", () => {
  const ok = (input: string, api: "openai-completions" | "openai-responses" = "openai-completions") => {
    const r = normalizeEndpoint(input, api);
    if (!r.ok) throw new Error(r.reason);
    return r.endpoint;
  };

  it("trims spaces and trailing slashes, never adds /v1", () => {
    expect(ok("  https://api.deepseek.com/v1/ ")).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      requestUrl: "https://api.deepseek.com/v1/chat/completions",
    });
    expect(ok("https://api.deepseek.com").requestUrl).toBe("https://api.deepseek.com/chat/completions");
  });

  it("cuts a pasted full URL back to its base and takes the protocol from it", () => {
    expect(ok("https://api.openai.com/v1/chat/completions", "openai-responses")).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      api: "openai-completions",
    });
    expect(ok("https://api.openai.com/v1/responses/")).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      api: "openai-responses",
      requestUrl: "https://api.openai.com/v1/responses",
    });
  });

  it("takes the bare host for native Anthropic and Gemini", () => {
    expect(ok("https://api.anthropic.com/v1/messages")).toEqual({
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
      requestUrl: "https://api.anthropic.com/v1/messages",
    });
    const a = normalizeEndpoint("https://api.anthropic.com/v1/", "anthropic-messages");
    expect(a.ok && a.endpoint.baseUrl).toBe("https://api.anthropic.com");
    const g = normalizeEndpoint(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      "openai-completions",
      "gemini-2.5-flash",
    );
    expect(g.ok && g.endpoint).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com",
      api: "google-generative-ai",
      requestUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    });
    // The OpenAI-compatible Gemini endpoint stays what it is.
    expect(ok("https://generativelanguage.googleapis.com/v1beta/openai").api).toBe("openai-completions");
  });

  it("allows http only for this machine and the local network", () => {
    expect(ok("http://127.0.0.1:11434/v1").baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(ok("http://192.168.1.20:1234/v1").baseUrl).toBe("http://192.168.1.20:1234/v1");
    expect(normalizeEndpoint("http://api.example.com/v1", "openai-completions").ok).toBe(false);
  });

  it("rejects what it cannot use", () => {
    expect(normalizeEndpoint("", "openai-completions")).toEqual({ ok: false, reason: "请填写接口地址" });
    expect(normalizeEndpoint("api.example.com", "openai-completions").ok).toBe(false);
    expect(normalizeEndpoint("ftp://example.com", "openai-completions").ok).toBe(false);
    expect(normalizeEndpoint("https://example.com/v1?key=1", "openai-completions").ok).toBe(false);
  });

  it("knows local hosts", () => {
    for (const h of ["localhost", "mac.local", "[::1]", "10.0.0.2", "172.20.1.1", "127.0.0.1"])
      expect(isLocalHost(h)).toBe(true);
    for (const h of ["172.32.0.1", "8.8.8.8", "example.com"]) expect(isLocalHost(h)).toBe(false);
  });
});

describe("classifyError", () => {
  it.each([
    ["401 Incorrect API key provided.", "auth"],
    ['403: {"error":"forbidden"}', "auth"],
    ["404 The model `x` does not exist", "not-found"],
    ["429 Rate limit reached", "rate-limit"],
    ["402 Insufficient Balance", "rate-limit"],
    ["400 invalid parameter", "bad-request"],
    ["503 overloaded", "server"],
    ["Connection error.", "network"],
    ["error sending request for url (https://x)", "network"],
    ["something odd", "unknown"],
  ])("%s → %s", (raw, kind) => {
    const e = classifyError(raw);
    expect(e.kind).toBe(kind);
    expect(e.detail).toBe(raw);
    expect(e.message).toBeTruthy();
  });
});
