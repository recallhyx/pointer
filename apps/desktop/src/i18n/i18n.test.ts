import { afterEach, describe, expect, it } from "vitest";

import { answerError } from "@/llm/errors";
import { presetById, presetName, isPresetName } from "@/llm/presets";
import { sanitize } from "@/shared/settings";
import { formatShortcut } from "@/settings/shortcut";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { getLocale, localeFromSystem, resolveLocale, sanitizeUiLanguage, setLocale, t, translate } from "./index";
import { zh } from "./zh";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale("zh"));

const CATALOGS = { en, ja, ko, es, fr };

describe("catalogs", () => {
  it.each(Object.entries(CATALOGS))("%s has exactly the keys Chinese has", (_, catalog) => {
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(zh).sort());
  });

  it.each(Object.entries(CATALOGS))("%s fills in the same placeholders as Chinese", (_, catalog) => {
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(placeholders(catalog[key]), key).toEqual(placeholders(zh[key]));
    }
  });

  it("has no empty text", () => {
    for (const catalog of [zh, ...Object.values(CATALOGS)]) {
      for (const [key, text] of Object.entries(catalog)) expect(text.trim(), key).not.toBe("");
    }
  });
});

describe("locale", () => {
  it("maps system locales to the nearest language", () => {
    expect(localeFromSystem("zh-CN")).toBe("zh");
    expect(localeFromSystem("zh-Hant-TW")).toBe("zh");
    expect(localeFromSystem("en-US")).toBe("en");
    expect(localeFromSystem("ja-JP")).toBe("ja");
    expect(localeFromSystem("ko_KR")).toBe("ko");
    expect(localeFromSystem("es-MX")).toBe("es");
    expect(localeFromSystem("fr-FR")).toBe("fr");
    expect(localeFromSystem("de-DE")).toBe("en");
    expect(localeFromSystem(undefined)).toBe("en");
  });

  it("lets an explicit choice win over the system", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh", "en-US")).toBe("zh");
    expect(resolveLocale("system", "zh-CN")).toBe("zh");
    expect(resolveLocale(null, "en-US")).toBe("en");
    expect(resolveLocale("fr", "en-US")).toBe("fr");
    expect(resolveLocale("pt", "en-US")).toBe("en");
  });

  it("falls back to following the system for unknown settings", () => {
    expect(sanitizeUiLanguage("en")).toBe("en");
    expect(sanitizeUiLanguage("zh")).toBe("zh");
    expect(sanitizeUiLanguage("ja")).toBe("ja");
    expect(sanitizeUiLanguage("es")).toBe("es");
    expect(sanitizeUiLanguage("de")).toBe("system");
    expect(sanitizeUiLanguage(undefined)).toBe("system");
    expect(sanitize({}).uiLanguage).toBe("system");
    expect(sanitize({ uiLanguage: "en" }).uiLanguage).toBe("en");
  });

  it("fills in {placeholders} and leaves unknown ones alone", () => {
    expect(translate("en", "provider.modelsFound", { count: 3 })).toContain("3");
    expect(translate("zh", "prepare.noModel", { name: "X" })).toBe("「X」还没填模型名");
    expect(translate("en", "prepare.noModel")).toContain("{name}");
  });

  it("translates at call time, so changing the locale changes the text", () => {
    expect(getLocale()).toBe("zh");
    const zhText = t("panel.stop");
    setLocale("en");
    expect(t("panel.stop")).toBe("Stop");
    expect(zhText).toBe("停止");
  });
});

describe("translated pieces", () => {
  it("builds error lines in the current language", () => {
    expect(answerError("auth").message).toBe(zh["error.auth"]);
    setLocale("en");
    expect(answerError("auth").message).toBe(en["error.auth"]);
  });

  it("names presets in the current language and recognises either as a preset name", () => {
    const custom = presetById("custom");
    expect(presetName(custom)).toBe("自定义");
    setLocale("en");
    expect(presetName(custom)).toBe("Custom");
    expect(isPresetName(custom, "自定义")).toBe(true);
    expect(isPresetName(custom, "Custom")).toBe(true);
    expect(isPresetName(custom, "My gateway")).toBe(false);
    expect(presetName(presetById("openai"))).toBe("OpenAI");
  });

  it("labels the Space key in the current language", () => {
    expect(formatShortcut("Alt+Space", "other")).toBe("Alt + 空格");
    setLocale("en");
    expect(formatShortcut("Alt+Space", "other")).toBe("Alt + Space");
  });
});
