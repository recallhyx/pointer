import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { useT } from "@/i18n";
import { isTauri } from "@/shared/runtime";

type Phase = "select" | "busy" | "cascade" | "leaving" | "error";

interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Vision box normalized to the selection (top-left, 0–1). */
interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OcrPreview {
  boxes: OcrBox[];
  confidence: number;
}

function normalize(d: Drag) {
  const x = Math.min(d.x0, d.x1);
  const y = Math.min(d.y0, d.y1);
  return { x, y, width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) };
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import("@tauri-apps/api/core");
  return inv<T>(cmd, args);
}

/** Brief hold so 「正在识别…」fades in before native hides for capture. */
const RECOGNIZING_HOLD_MS = 120;
/** Stagger between ghost boxes (Design: 40–60ms). */
const BOX_STAGGER_S = 0.05;
/** Opacity fade-in per box. */
const BOX_FADE_S = 0.15;
/** Fade picker out before present opens the result bar. */
const LEAVING_MS = 140;
/** Design: cascade total ~300–450ms. */
const CASCADE_MIN_MS = 300;
const CASCADE_MAX_MS = 450;
const EASE_OUT = [0.2, 0, 0, 1] as const;

function cascadeDurationMs(boxCount: number, reduce: boolean): number {
  if (reduce || boxCount <= 0) return reduce ? 40 : CASCADE_MIN_MS;
  const raw = (boxCount - 1) * BOX_STAGGER_S * 1000 + BOX_FADE_S * 1000;
  return Math.min(CASCADE_MAX_MS, Math.max(CASCADE_MIN_MS, raw));
}

/**
 * Fullscreen drag-to-select overlay for on-device OCR.
 * After confirm → busy (status outside selection) → capture → ghost-box cascade → result.
 * WebView stays mounted; selection resets on every open via `ocr://reset`.
 * Capture keeps the picker visible (NSWindowSharingNone), so there is no hide/show flash.
 *
 * Ghost cascade uses Motion opacity + a one-shot cascadeToken (not CSS @keyframes).
 */
export function OcrPicker() {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [phase, setPhase] = useState<Phase>("select");
  const [error, setError] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<OcrBox[]>([]);
  /** Bumps once per cascade so Motion mounts a single stagger run. */
  const [cascadeToken, setCascadeToken] = useState(0);
  const dragging = useRef(false);
  const cancelled = useRef(false);
  const busyGen = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  /** Stable key for recognizing status so Motion fades once per complete(). */
  const [statusKey, setStatusKey] = useState(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const reset = useCallback(() => {
    dragging.current = false;
    cancelled.current = false;
    busyGen.current += 1;
    setDrag(null);
    setPhase("select");
    setError(null);
    setBoxes([]);
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    busyGen.current += 1;
    dragging.current = false;
    setDrag(null);
    setPhase("select");
    setError(null);
    setBoxes([]);
    if (!isTauri()) return;
    void invoke("ocr_cancel").catch(() => {});
  }, []);

  const complete = useCallback(
    async (region: { x: number; y: number; width: number; height: number }) => {
      if (region.width < 4 || region.height < 4) {
        setDrag(null);
        return;
      }
      cancelled.current = false;
      const gen = ++busyGen.current;
      setBoxes([]);
      setStatusKey((k) => k + 1);
      setPhase("busy");
      setError(null);
      // Hold so recognizing status paints before native hides the picker.
      await new Promise<void>((r) => setTimeout(r, RECOGNIZING_HOLD_MS));
      if (cancelled.current || busyGen.current !== gen) return;
      try {
        if (!isTauri()) throw new Error("ocr-unsupported");
        const preview = await invoke<OcrPreview>("ocr_complete", { region });
        if (cancelled.current || busyGen.current !== gen) return;
        const nextBoxes = Array.isArray(preview?.boxes) ? preview.boxes : [];
        setBoxes(nextBoxes);
        setCascadeToken((n) => n + 1);
        setPhase("cascade");
        await new Promise<void>((r) => setTimeout(r, cascadeDurationMs(nextBoxes.length, !!reduceMotion)));
        if (cancelled.current || busyGen.current !== gen) return;
        setPhase("leaving");
        await new Promise<void>((r) => setTimeout(r, LEAVING_MS));
        if (cancelled.current || busyGen.current !== gen) return;
        await invoke("ocr_present");
        if (cancelled.current || busyGen.current !== gen) return;
        reset();
      } catch (e) {
        if (cancelled.current || busyGen.current !== gen) return;
        const msg = String(e);
        if (msg.includes("ocr-cancelled")) {
          reset();
          return;
        }
        setPhase("error");
        setError(
          msg.includes("screen-recording") || msg.includes("screencapture")
            ? t("ocr.error.permission")
            : msg.includes("no-text")
              ? t("ocr.error.empty")
              : msg.includes("ocr-unsupported")
                ? t("ocr.error.unsupported")
                : t("ocr.error.failed", { error: msg }),
        );
      }
    },
    [reset, reduceMotion, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel]);

  // WKWebView will otherwise select 「识别区域」 / hints while dragging.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("selectstart", block, true);
    document.addEventListener("dragstart", block, true);
    return () => {
      document.removeEventListener("selectstart", block, true);
      document.removeEventListener("dragstart", block, true);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (disposed) return;
      // open_picker emits reset. Ignore mid-flight so a stray reset cannot wipe cascade.
      unlisten = await listen("ocr://reset", () => {
        const p = phaseRef.current;
        if (p === "busy" || p === "cascade" || p === "leaving") return;
        reset();
      });
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [reset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (phase === "busy" || phase === "cascade" || phase === "leaving") return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    dragging.current = true;
    setPhase("select");
    setError(null);
    setBoxes([]);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !drag) return;
    setDrag({ ...drag, x1: e.clientX, y1: e.clientY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current || !drag) return;
    dragging.current = false;
    const next = { ...drag, x1: e.clientX, y1: e.clientY };
    setDrag(next);
    void complete(normalize(next));
  };

  const rect = drag ? normalize(drag) : null;
  const recognizing = phase === "busy" || phase === "cascade" || phase === "leaving";
  const showGhosts = (phase === "cascade" || phase === "leaving") && boxes.length > 0 && cascadeToken > 0;
  const pickerClass = ["ocr-picker", recognizing ? "is-busy" : "", phase === "leaving" ? "is-leaving" : ""]
    .filter(Boolean)
    .join(" ");
  const reduce = !!reduceMotion;

  return (
    <div
      className={pickerClass}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragging.current = false;
        setDrag(null);
      }}
    >
      {rect && rect.width > 0 && rect.height > 0 && (
        <div className="ocr-rect" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
          <span className="ocr-rect-label">{t("ocr.region")}</span>
          {showGhosts &&
            boxes.map((b, i) => (
              <motion.div
                key={`${cascadeToken}-${i}`}
                className="ocr-ghost"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.72 }}
                transition={
                  reduce ? { duration: 0 } : { duration: BOX_FADE_S, delay: i * BOX_STAGGER_S, ease: EASE_OUT }
                }
                style={{
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${Math.max(b.width * 100, 0.5)}%`,
                  height: `${Math.max(b.height * 100, 0.5)}%`,
                }}
                aria-hidden
              />
            ))}
          {recognizing && (
            <motion.div
              key={`status-${statusKey}`}
              className="ocr-status"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.15, ease: EASE_OUT }}
            >
              {t("ocr.recognizing")}
            </motion.div>
          )}
        </div>
      )}
      <div className="ocr-hint">{recognizing ? t("ocr.escCancel") : error ? error : t("ocr.dragHint")}</div>
      {phase === "error" && (
        <button type="button" className="ocr-dismiss" onClick={cancel}>
          {t("ocr.dismiss")}
        </button>
      )}
    </div>
  );
}
