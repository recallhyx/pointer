import { t } from "@/i18n";
import { defaultProvider, type Settings } from "@/shared/settings";
import type { ModelTarget } from "./client";
import { defaultSecondLanguage, languageByPrompt, nativeLanguage, type Language } from "./language";
import { firstUserMessage, type FirstMessageInput } from "./message";
import { presetById } from "./presets";
import { systemPrompt, type PromptActionId } from "./prompts";

export interface AnswerInput extends FirstMessageInput {
  action: PromptActionId;
  /** Translate only. */
  target: Language | null;
}

export interface PreparedAnswer {
  target: ModelTarget;
  systemPrompt: string;
  userMessage: string;
}

export type Prepared = { ok: true; answer: PreparedAnswer } | { ok: false; reason: string };

export function userLanguage(settings: Pick<Settings, "nativeLanguage">): Language {
  return languageByPrompt(settings.nativeLanguage) ?? nativeLanguage();
}

/** CONTEXT.md 回答语言: what native text is translated into. */
export function secondLanguage(settings: Pick<Settings, "nativeLanguage" | "secondLanguage">): Language {
  const native = userLanguage(settings);
  const second = languageByPrompt(settings.secondLanguage);
  return second && second.prompt !== native.prompt ? second : defaultSecondLanguage(native);
}

/** Picks the default service and builds both messages. Fails with a reason the panel shows. */
export function prepareAnswer(settings: Settings, apiKey: string | null, input: AnswerInput): Prepared {
  const provider = defaultProvider(settings);
  if (!provider) return { ok: false, reason: t("prepare.noProvider") };
  if (!provider.model.trim()) return { ok: false, reason: t("prepare.noModel", { name: provider.name }) };
  if (!apiKey && presetById(provider.preset).needsKey)
    return { ok: false, reason: t("prepare.noKey", { name: provider.name }) };
  const native = userLanguage(settings);
  return {
    ok: true,
    answer: {
      target: {
        baseUrl: provider.baseUrl,
        api: provider.api,
        model: provider.model.trim(),
        apiKey,
        headers: provider.headers,
        extraBody: provider.extraBody,
        compat: provider.compat,
      },
      systemPrompt: systemPrompt(input.action, {
        nativeLanguage: native.prompt,
        targetLanguage: input.target?.prompt,
      }),
      userMessage: firstUserMessage(input, {
        sendContext: settings.sendContext,
        sendWindowInfo: settings.sendWindowInfo,
      }),
    },
  };
}
