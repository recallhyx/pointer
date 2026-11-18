import { describe, expect, it } from "vitest";

import { isValidSearchTemplate, sanitizeSearchEngine, searchUrl } from "./search";

describe("searchUrl", () => {
  it("never splits an emoji at the length cap", () => {
    const text = "a".repeat(499) + "😀tail";
    expect(() => searchUrl(text)).not.toThrow();
    expect(searchUrl(text)).toContain(encodeURIComponent("😀"));
    expect(searchUrl(text)).not.toContain("tail");
  });

  it("defaults to Google and encodes the query", () => {
    expect(searchUrl("  a b&c ")).toBe("https://www.google.com/search?q=a%20b%26c");
  });
  it("uses presets", () => {
    expect(searchUrl("x", { id: "baidu", customUrl: "" })).toBe("https://www.baidu.com/s?wd=x");
    expect(searchUrl("x", { id: "bing", customUrl: "" })).toBe("https://www.bing.com/search?q=x");
    expect(searchUrl("x", { id: "duckduckgo", customUrl: "" })).toBe("https://duckduckgo.com/?q=x");
  });
  it("fills every %s in a custom template", () => {
    expect(searchUrl("中", { id: "custom", customUrl: " https://e.com/?q=%s&r=%s " })).toBe(
      "https://e.com/?q=%E4%B8%AD&r=%E4%B8%AD",
    );
  });
  it("falls back to Google for an invalid custom template", () => {
    expect(searchUrl("x", { id: "custom", customUrl: "javascript:alert(%s)" })).toBe(
      "https://www.google.com/search?q=x",
    );
    expect(searchUrl("x", { id: "custom", customUrl: "https://e.com/" })).toBe("https://www.google.com/search?q=x");
  });
  it("trims the query to 500 characters", () => {
    expect(searchUrl("a".repeat(600))).toBe(`https://www.google.com/search?q=${"a".repeat(500)}`);
  });
});

describe("isValidSearchTemplate", () => {
  it("requires http(s) and %s", () => {
    expect(isValidSearchTemplate("http://e.com/%s")).toBe(true);
    expect(isValidSearchTemplate("ftp://e.com/%s")).toBe(false);
    expect(isValidSearchTemplate("e.com/?q=%s")).toBe(false);
    expect(isValidSearchTemplate("")).toBe(false);
  });
});

describe("sanitizeSearchEngine", () => {
  it("drops unknown ids and bad values", () => {
    expect(sanitizeSearchEngine(undefined)).toEqual({ id: "google", customUrl: "" });
    expect(sanitizeSearchEngine({ id: "yahoo", customUrl: 3 })).toEqual({ id: "google", customUrl: "" });
    expect(sanitizeSearchEngine({ id: "custom", customUrl: "https://e.com/%s" })).toEqual({
      id: "custom",
      customUrl: "https://e.com/%s",
    });
  });
});
