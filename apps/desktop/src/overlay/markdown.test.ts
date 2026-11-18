import { describe, expect, it } from "vitest";

import { parseExtraBody, parseHeaders } from "@/settings/fields";
import { isOpenableUrl, normalizeMath } from "./markdown";

describe("normalizeMath", () => {
  it("rewrites LaTeX delimiters", () => {
    expect(normalizeMath("面积 \\(\\pi r^2\\) 和")).toBe("面积 $\\pi r^2$ 和");
    expect(normalizeMath("\\[ a^2 + b^2 \\]")).toBe("\n$$\na^2 + b^2\n$$\n");
  });

  it("leaves code alone", () => {
    const code = "```latex\n\\[ x \\]\n```";
    expect(normalizeMath(code)).toBe(code);
    expect(normalizeMath("use `\\(x\\)` here")).toBe("use `\\(x\\)` here");
  });

  it("leaves an unfinished fence alone while streaming", () => {
    const partial = "text\n```\n\\(x\\)";
    expect(normalizeMath(partial)).toBe(partial);
  });
});

describe("isOpenableUrl", () => {
  it("only opens web links", () => {
    expect(isOpenableUrl("https://example.com")).toBe(true);
    expect(isOpenableUrl("http://example.com")).toBe(true);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl(undefined)).toBe(false);
  });
});

describe("settings fields", () => {
  it("parses headers", () => {
    expect(parseHeaders("X-Org: team\n\n  X-Trace :  1 ")).toEqual({
      ok: true,
      value: { "X-Org": "team", "X-Trace": "1" },
    });
    expect(parseHeaders("no colon").ok).toBe(false);
    expect(parseHeaders("Authorization: Bearer x").ok).toBe(false);
  });

  it("refuses every header that carries the API key", () => {
    for (const name of ["x-api-key", "X-Goog-Api-Key", "api-key"]) {
      expect(parseHeaders(`${name}: sk-123`).ok).toBe(false);
    }
  });

  it("refuses body fields that would replace the system prompt on any protocol", () => {
    for (const key of ["system", "instructions", "contents", "systemInstruction"]) {
      expect(parseExtraBody(JSON.stringify({ [key]: "x" })).ok).toBe(false);
    }
  });

  it("parses the extra body", () => {
    expect(parseExtraBody("")).toEqual({ ok: true, value: null });
    expect(parseExtraBody('{"temperature": 0.3}')).toEqual({ ok: true, value: { temperature: 0.3 } });
    expect(parseExtraBody("[1]").ok).toBe(false);
    expect(parseExtraBody("{").ok).toBe(false);
    expect(parseExtraBody('{"model": "x"}').ok).toBe(false);
  });
});
