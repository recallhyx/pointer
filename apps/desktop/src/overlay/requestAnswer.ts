import { streamAnswer } from "@/llm/client";
import { prepareAnswer } from "@/llm/prepare";
import { providerFetch } from "@/shared/runtime";
import { getApiKey } from "@/shared/secrets";
import { defaultProvider, loadSettings, type Settings } from "@/shared/settings";
import { followUps, type Session } from "./session";
import type { Outcome } from "./useAnswer";

/** ADR 0004: after an Action click, wait at most this long for the environment. */
const ENV_WAIT_MS = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ADR 0003/0004: waits briefly for the environment, reads the settings and the key, then streams.
 * `current` is read again after waiting because the environment arrives on the live session.
 */
export async function requestAnswer(opts: {
  current: () => Session | null;
  signal: AbortSignal;
  onText: (delta: string) => void;
  onSettings: (s: Settings) => void;
}): Promise<Outcome> {
  const { current, signal, onText } = opts;
  const t0 = performance.now();
  while (!current()?.env && performance.now() - t0 < ENV_WAIT_MS && !signal.aborted) await sleep(10);
  const s = current();
  if (!s || signal.aborted || (s.action !== "explain" && s.action !== "translate")) return { status: "stopped" };
  const settings = await loadSettings();
  opts.onSettings(settings);
  const provider = defaultProvider(settings);
  const apiKey = provider ? await getApiKey(provider.id).catch(() => null) : null;
  const p = s.payload;
  const prepared = prepareAnswer(settings, apiKey, {
    action: s.action,
    target: s.target,
    environment: s.env?.environment ?? { appName: p.app.name },
    date: new Date(),
    contextBefore: p.contextBefore,
    selection: p.text,
    contextAfter: p.contextAfter,
  });
  if (!prepared.ok) return { status: "not-configured", reason: prepared.reason };
  const result = await streamAnswer({
    ...prepared.answer,
    followUps: followUps(s),
    fetch: await providerFetch(),
    signal,
    onText,
  });
  const since = Math.round(performance.now() - t0);
  if (result.status === "done") {
    console.info(
      `[pointer] answer: first token ${result.firstTokenMs}ms, total ${since}ms, ${result.text.length} chars`,
    );
    return { status: "done" };
  }
  if (result.status === "aborted") return { status: "stopped" };
  console.warn("[pointer] answer failed", result.error);
  return { status: "error", error: result.error };
}
