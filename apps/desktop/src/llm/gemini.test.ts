import { describe, expect, it } from "vitest";

import { geminiBody, geminiHttpError, geminiModelId, geminiThinkingConfig, parseGeminiChunk } from "./gemini";

describe("geminiBody", () => {
  const base = { model: "gemini-2.5-flash", systemPrompt: "", turns: [], maxTokens: 4096 };

  it("merges extra generationConfig instead of replacing it", () => {
    const body = geminiBody({ ...base, extraBody: { generationConfig: { temperature: 0.3 }, safetySettings: [] } });
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0.3,
    });
    expect(body).toHaveProperty("safetySettings", []);
  });

  it("lets extra generationConfig override a default on purpose", () => {
    const body = geminiBody({ ...base, extraBody: { generationConfig: { maxOutputTokens: 512 } } });
    expect(body.generationConfig.maxOutputTokens).toBe(512);
  });
});

describe("gemini mapping", () => {
  it("strips the models/ prefix", () => expect(geminiModelId(" models/gemini-2.5-pro ")).toBe("gemini-2.5-pro"));

  it("turns thinking off only where the model allows it", () => {
    expect(geminiThinkingConfig("gemini-2.5-flash-lite")).toEqual({ thinkingBudget: 0 });
    expect(geminiThinkingConfig("gemini-3-pro-preview")).toEqual({ thinkingLevel: "low" });
    expect(geminiThinkingConfig("gemini-2.5-pro")).toBeUndefined();
    expect(geminiThinkingConfig("gemini-2.0-flash")).toBeUndefined();
  });

  it("separates thoughts from text and notices blocked prompts", () => {
    expect(
      parseGeminiChunk({
        candidates: [{ content: { parts: [{ text: "hm", thought: true }, { text: "A" }, { text: "B" }] } }],
      }),
    ).toEqual({ text: "AB", thinking: "hm", blocked: undefined });
    expect(parseGeminiChunk({ promptFeedback: { blockReason: "SAFETY" } }).blocked).toBe("SAFETY");
  });

  it("treats an answer stopped for safety as blocked, not as an empty success", () => {
    expect(parseGeminiChunk({ candidates: [{ finishReason: "SAFETY" }] }).blocked).toBe("SAFETY");
    expect(parseGeminiChunk({ candidates: [{ finishReason: "RECITATION" }] }).blocked).toBe("RECITATION");
    expect(parseGeminiChunk({ candidates: [{ finishReason: "STOP" }] }).blocked).toBeUndefined();
    expect(parseGeminiChunk({ candidates: [{ finishReason: "MAX_TOKENS" }] }).blocked).toBeUndefined();
  });

  it("formats errors like pi-ai", () => {
    expect(geminiHttpError(404, '[{"error":{"message":"models/x is not found"}}]')).toBe("404 models/x is not found");
    expect(geminiHttpError(500, "")).toBe("500 request failed");
  });
});
