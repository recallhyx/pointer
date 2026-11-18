import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";

import type { ApiKind } from "./endpoint";
import { getLocale, LOCALES, translate, type Locale, type MessageKey } from "@/i18n";

/** ADR 0003 服务商预设: templates that fill in the endpoint; users can edit everything. */
export interface Preset {
  id: string;
  /** Brand name, used as is unless `nameKey` gives a translation. */
  name: string;
  nameKey?: MessageKey;
  baseUrl: string;
  /** Protocol it speaks; OpenAI Chat Completions unless set. */
  api?: ApiKind;
  /** Local servers usually accept any key. */
  needsKey: boolean;
  /** Only for vendors pi-ai cannot detect from the URL. */
  compat?: OpenAICompletionsCompat;
  /** Suggested model, shown as a placeholder. */
  modelHint?: string;
}

export const PRESETS: Preset[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true, modelHint: "gpt-5-mini" },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    needsKey: true,
    modelHint: "claude-haiku-4-5",
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    api: "google-generative-ai",
    needsKey: true,
    modelHint: "gemini-2.5-flash",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    modelHint: "deepseek-chat",
  },
  {
    id: "bailian",
    name: "Alibaba Bailian",
    nameKey: "preset.bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    compat: { thinkingFormat: "qwen" },
    modelHint: "qwen-plus",
  },
  {
    id: "ark",
    name: "Volcano Ark",
    nameKey: "preset.ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    needsKey: true,
    // Doubao takes the same `thinking: {type: "disabled"}` switch as DeepSeek.
    compat: { thinkingFormat: "deepseek" },
  },
  { id: "moonshot", name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", needsKey: true, modelHint: "kimi-latest" },
  {
    id: "zhipu",
    name: "Zhipu AI",
    nameKey: "preset.zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    needsKey: true,
    modelHint: "glm-4.6",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    nameKey: "preset.siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    needsKey: true,
  },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  {
    id: "gemini",
    name: "Gemini (OpenAI compatible)",
    nameKey: "preset.geminiOpenAI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    modelHint: "gemini-2.5-flash",
  },
  { id: "ollama", name: "Ollama", nameKey: "preset.ollama", baseUrl: "http://127.0.0.1:11434/v1", needsKey: false },
  {
    id: "lmstudio",
    name: "LM Studio",
    nameKey: "preset.lmstudio",
    baseUrl: "http://127.0.0.1:1234/v1",
    needsKey: false,
  },
  { id: "custom", name: "Custom", nameKey: "preset.custom", baseUrl: "", needsKey: true },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

export function presetName(p: Preset, locale: Locale = getLocale()): string {
  return p.nameKey ? translate(locale, p.nameKey) : p.name;
}

/** A service keeps the name it was created with; true while it is still some preset's name. */
export function isPresetName(p: Preset, name: string): boolean {
  return LOCALES.some((l) => presetName(p, l) === name);
}

export function presetApi(p: Preset): ApiKind {
  return p.api ?? "openai-completions";
}
