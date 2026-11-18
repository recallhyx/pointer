import { useEffect, useEffectEvent, useRef, useState } from "react";

import { t } from "@/i18n";
import type { AnswerError } from "@/llm/errors";

export type AnswerStatus = "waiting" | "streaming" | "done" | "stopped" | "error" | "not-configured";

export interface Answer {
  key: string;
  text: string;
  status: AnswerStatus;
  error: AnswerError | null;
  /** Why the request was not sent (status `not-configured`). */
  reason: string | null;
}

export type Outcome =
  | { status: "done" | "stopped" }
  | { status: "error"; error: AnswerError }
  | { status: "not-configured"; reason: string };

export type StartAnswer = (signal: AbortSignal, onText: (delta: string) => void) => Promise<Outcome>;

/** A request handed over to a pinned panel: it keeps streaming after the overlay lets go of it. */
export interface DetachedAnswer {
  /** Delivers the answer so far right away, then every change until it settles. */
  subscribe(cb: (a: Answer) => void): () => void;
  abort(): void;
  /** Returns ownership to the unchanged overlay after a failed window handoff. */
  reattach(): void;
}

/** No answer for the current key yet means it is still waiting for the first token. */
export const isAnswering = (a: Answer | null) => !a || a.status === "waiting" || a.status === "streaming";

/**
 * Runs one answer per `key`. Changing or clearing the key aborts the previous request, so a new
 * selection, regenerate, or dismiss all cancel for free. Text reaches React at most once a frame.
 */
export function useAnswer(opts: { key: string | null; start: StartAnswer }) {
  const { key } = opts;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const start = useEffectEvent(opts.start);
  const stopRef = useRef<() => void>(() => {});
  const runRef = useRef(0);
  const detachRef = useRef<() => DetachedAnswer | null>(() => null);

  useEffect(() => {
    if (!key) return;
    const run = ++runRef.current;
    const controller = new AbortController();
    let text = "";
    let raf = 0;
    // Once detached, this request belongs to a pinned panel: no abort on cleanup, and every
    // update goes to its listeners instead of this hook's state.
    let detached = false;
    let latest: Answer = { key, text: "", status: "waiting", error: null, reason: null };
    const listeners = new Set<(a: Answer) => void>();
    const publish = (a: Answer) => {
      latest = a;
      if (detached) listeners.forEach((cb) => cb(a));
      else if (run === runRef.current) setAnswer(a);
    };
    stopRef.current = () => controller.abort();
    detachRef.current = () => {
      if (detached || run !== runRef.current || (latest.status !== "waiting" && latest.status !== "streaming"))
        return null;
      detached = true;
      cancelAnimationFrame(raf);
      raf = 0;
      latest = { ...latest, text };
      return {
        subscribe(cb) {
          listeners.add(cb);
          cb(latest);
          return () => listeners.delete(cb);
        },
        abort: () => controller.abort(),
        reattach() {
          if (run !== runRef.current) return;
          detached = false;
          setAnswer(latest);
        },
      };
    };
    const flush = () => {
      raf = 0;
      publish({ key, text, status: "streaming", error: null, reason: null });
    };
    const onText = (delta: string) => {
      text += delta;
      // A hidden WKWebView suspends rAF, so a detached stream forwards every chunk directly.
      if (detached) flush();
      else raf ||= requestAnimationFrame(flush);
    };
    void start(controller.signal, onText)
      .catch((e): Outcome => {
        console.error("[pointer] answer failed", e);
        return { status: "error", error: { kind: "unknown", message: t("error.unknown"), detail: String(e) } };
      })
      .then((outcome) => {
        cancelAnimationFrame(raf);
        if (!detached && run !== runRef.current) return;
        publish({
          key,
          text,
          status: outcome.status,
          error: outcome.status === "error" ? outcome.error : null,
          reason: outcome.status === "not-configured" ? outcome.reason : null,
        });
      });
    return () => {
      if (!detached) controller.abort();
    };
  }, [key]);

  return {
    answer: answer && answer.key === key ? answer : null,
    stop: () => stopRef.current(),
    /** Hands the in-flight request over (null when nothing is in flight). */
    detach: () => detachRef.current(),
  };
}
