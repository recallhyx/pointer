import { describe, expect, it } from "vitest";

import {
  defaultSecondLanguage,
  detectLanguage,
  languageByPrompt,
  nativeLanguage,
  translationTarget,
  type Language,
} from "./language";
import { firstUserMessage, formatDate } from "./message";

describe("firstUserMessage", () => {
  it("follows docs/prompts.md", () => {
    const msg = firstUserMessage({
      environment: {
        appName: "Google Chrome",
        windowTitle: "References and Borrowing - The Rust Programming Language",
        url: "https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html",
        documentName: null,
      },
      date: new Date(2026, 9, 12),
      contextBefore: "We call the action of creating a reference ",
      selection: "borrowing",
      contextAfter: ".",
    });
    expect(msg).toBe(
      [
        "<environment>",
        "<app>Google Chrome</app>",
        "<window_title>References and Borrowing - The Rust Programming Language</window_title>",
        "<url>https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html</url>",
        "<date>2026-10-12</date>",
        "</environment>",
        "<context_before>We call the action of creating a reference </context_before>",
        "<selection>borrowing</selection>",
        "<context_after>.</context_after>",
      ].join("\n"),
    );
  });

  it("omits missing values", () => {
    const msg = firstUserMessage({
      environment: null,
      date: new Date(2026, 0, 5),
      contextBefore: null,
      selection: "hello",
      contextAfter: "",
    });
    expect(msg).toBe("<environment>\n<date>2026-01-05</date>\n</environment>\n<selection>hello</selection>");
  });

  it("pads dates", () => {
    expect(formatDate(new Date(2026, 2, 7))).toBe("2026-03-07");
  });
});

describe("translationTarget", () => {
  const zh = nativeLanguage("zh-CN");
  const en = nativeLanguage("en-US");
  const target = (text: string, native: Language, second = defaultSecondLanguage(native)) =>
    translationTarget(detectLanguage(text, native), native, second).prompt;

  it("detects the native language from the locale", () => {
    expect(zh.prompt).toBe("Simplified Chinese");
    expect(nativeLanguage("zh-Hant-TW").prompt).toBe("Simplified Chinese");
    expect(nativeLanguage("ja-JP").prompt).toBe("Japanese");
    expect(nativeLanguage("fr-FR").prompt).toBe("French");
    expect(nativeLanguage("es-MX").prompt).toBe("Spanish");
    expect(nativeLanguage("nl-NL").prompt).toBe("English");
  });

  it("translates foreign text into the native language", () => {
    expect(target("Ownership is a set of rules", zh)).toBe("Simplified Chinese");
    expect(target("所有権は規則です", zh)).toBe("Simplified Chinese");
  });

  it("translates native text into English, or Chinese for English speakers", () => {
    expect(target("借用", zh)).toBe("English");
    expect(target("borrowing", en)).toBe("Simplified Chinese");
  });

  it("translates native text into the chosen second language", () => {
    expect(target("借用", zh, languageByPrompt("Japanese")!)).toBe("Japanese");
    // A second language equal to the native one falls back to the default.
    expect(target("借用", zh, zh)).toBe("English");
  });

  it("tells Latin-script languages apart, so an English speaker's French is not native", () => {
    expect(target("La propriété est un ensemble de règles qui régissent la mémoire", en)).toBe("English");
    const fr = nativeLanguage("fr-FR");
    expect(target("Ownership is a set of rules that govern memory", fr)).toBe("French");
    expect(target("La propriété est un ensemble de règles qui régissent la mémoire", fr)).toBe("English");
  });
});

describe("detectLanguage", () => {
  const zh = nativeLanguage("zh-CN");
  const detect = (text: string, native = zh) => detectLanguage(text, native)?.prompt ?? null;

  it("reads short selections as English unless their accents say otherwise", () => {
    expect(detect("hello world")).toBe("English");
    expect(detect("idempotent")).toBe("English");
    // franc alone reads these as Spanish.
    expect(detect("general")).toBe("English");
    expect(detect("capital")).toBe("English");
    expect(detect("déjà vu")).toBe("French");
    expect(detect("s'il vous plaît")).toBe("French");
    expect(detect("très bien")).toBe("French");
    expect(detect("mañana")).toBe("Spanish");
    expect(detect("¿qué tal?")).toBe("Spanish");
    expect(detect("está bien")).toBe("Spanish");
  });

  it("detects longer Latin-script text", () => {
    expect(detect("La propriété est un ensemble de règles qui régissent la mémoire.")).toBe("French");
    expect(detect("La propiedad es un conjunto de reglas que rigen la memoria.")).toBe("Spanish");
    expect(detect("Ownership is a set of rules that govern how a program manages memory.")).toBe("English");
  });

  it("goes by script for the rest", () => {
    expect(detect("所有権は規則です")).toBe("Japanese");
    expect(detect("소유권은 규칙입니다")).toBe("Korean");
    expect(detect("借用")).toBe("Simplified Chinese");
    expect(detect("Владение — это набор правил")).toBeNull();
    expect(detect("12345 + — !")).toBeNull();
  });

  it("reads kana-less Han text as Japanese for Japanese speakers unless it is simplified", () => {
    const ja = nativeLanguage("ja-JP");
    expect(detect("東京", ja)).toBe("Japanese");
    expect(detect("問題", ja)).toBe("Japanese");
    expect(detect("这个问题", ja)).toBe("Simplified Chinese");
  });
});
