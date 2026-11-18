import { francAll } from "franc-min";

export interface Language {
  /** Name used inside prompts (docs/prompts.md: `{native_language}`). Also the stored setting. */
  prompt: string;
  /** Name shown in the UI, always in the language itself so it can be found from any locale. */
  label: string;
}

/** Every language the user can pick. */
export const LANGUAGES: Language[] = [
  { prompt: "Simplified Chinese", label: "简体中文" },
  { prompt: "English", label: "English" },
  { prompt: "Japanese", label: "日本語" },
  { prompt: "Korean", label: "한국어" },
  { prompt: "French", label: "Français" },
  { prompt: "Spanish", label: "Español" },
];

const byPrompt = (prompt: string): Language => LANGUAGES.find((l) => l.prompt === prompt)!;

export const SIMPLIFIED_CHINESE = byPrompt("Simplified Chinese");
export const ENGLISH = byPrompt("English");

export function languageByPrompt(prompt: string | null | undefined): Language | null {
  return LANGUAGES.find((l) => l.prompt === prompt) ?? null;
}

/** BCP 47 primary subtag → language. Every Chinese locale gets Simplified Chinese. */
const BY_LOCALE: Record<string, string> = {
  zh: "Simplified Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  es: "Spanish",
};

export function nativeLanguage(locale: string = navigator.language): Language {
  return byPrompt(BY_LOCALE[locale.toLowerCase().split(/[-_]/)[0]] ?? "English");
}

/** CONTEXT.md 回答语言: what native text is translated into unless the user picks another. */
export function defaultSecondLanguage(native: Language): Language {
  return native.prompt === "English" ? SIMPLIFIED_CHINESE : ENGLISH;
}

type Script = "han" | "kana" | "hangul" | "latin";

function scriptCounts(text: string): Record<Script, number> {
  const counts: Record<Script, number> = { han: 0, kana: 0, hangul: 0, latin: 0 };
  for (const ch of text) {
    if (/\p{Script=Han}/u.test(ch)) counts.han++;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) counts.kana++;
    else if (/\p{Script=Hangul}/u.test(ch)) counts.hangul++;
    else if (/\p{Script=Latin}/u.test(ch)) counts.latin++;
  }
  return counts;
}

/**
 * Common simplified characters Japanese never writes (it uses 這, 時, 東, 問 or its own 関, 実).
 * Shared forms such as 国, 学, 会 are left out.
 */
const CHINESE_ONLY = "这们个时说为对开关过还么样现实经问题动种见长东车书话语门间无网电认识让应该进观";

/**
 * Han characters without kana. For a Japanese speaker they are a Japanese term unless they
 * contain simplified characters; for everyone else they are Chinese.
 */
function hanLanguage(text: string, native: Language): Language {
  if (native.prompt !== "Japanese") return SIMPLIFIED_CHINESE;
  return [...text].some((ch) => CHINESE_ONLY.includes(ch)) ? SIMPLIFIED_CHINESE : native;
}

/** franc's ISO 639-3 codes for the Latin-script languages above. */
const LATIN: Record<string, string> = {
  eng: "English",
  fra: "French",
  spa: "Spanish",
};

/** Below this many letters, franc's trigrams are close to guessing. */
const SHORT_TEXT = 30;
/** For short text, English wins when it scores at least this close to the best guess. */
const ENGLISH_PRIOR = 0.7;
/** Marks only one of the two languages writes (both use é and ü). */
const SPANISH_ONLY = /[áíóúñ¿¡]/iu;
const FRENCH_ONLY = /[àâçèêëîïôùûÿœ]/iu;
/** A Latin letter outside plain ASCII. */
const ACCENTED = /(?![a-z])\p{Script=Latin}/iu;

function latinLanguage(text: string): Language {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < SHORT_TEXT) {
    // Short selections are mostly English words and phrases, and franc reads many of them
    // ("general", "radio", "capital") as Spanish or French. Accents are the better signal there.
    if (!ACCENTED.test(text)) return ENGLISH;
    const spanish = SPANISH_ONLY.test(text);
    const french = FRENCH_ONLY.test(text);
    if (spanish !== french) return byPrompt(spanish ? "Spanish" : "French");
  }
  const scores = francAll(text, { only: Object.keys(LATIN), minLength: 1 });
  const [best] = scores[0] ?? ["und", 0];
  if (best === "und") return ENGLISH;
  const english = scores.find(([code]) => code === "eng")?.[1] ?? 0;
  if (letters < SHORT_TEXT && english >= ENGLISH_PRIOR) return ENGLISH;
  return byPrompt(LATIN[best]);
}

/**
 * docs/prompts.md 翻译方向: the selection's main language, or null when it has no letters in a
 * script we know. Mixed text goes by whichever script has more characters.
 */
export function detectLanguage(text: string, native: Language): Language | null {
  const counts = scriptCounts(text);
  if (counts.kana > 0 && counts.kana + counts.han >= counts.latin) return byPrompt("Japanese");
  const [script, count] = (Object.entries(counts) as [Script, number][]).sort((a, b) => b[1] - a[1])[0];
  if (count === 0) return null;
  switch (script) {
    case "han":
      return hanLanguage(text, native);
    case "kana":
      return byPrompt("Japanese");
    case "hangul":
      return byPrompt("Korean");
    case "latin":
      return latinLanguage(text);
  }
}

/** CONTEXT.md 回答语言: native text goes into the second language, anything else into the native one. */
export function translationTarget(source: Language | null, native: Language, second: Language): Language {
  if (source?.prompt !== native.prompt) return native;
  return second.prompt !== native.prompt ? second : defaultSecondLanguage(native);
}
