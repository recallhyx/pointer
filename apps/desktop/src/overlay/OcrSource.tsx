import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { EASE, INSTANT } from "@/components/motion";
import { useT } from "@/i18n";
import { isTauri } from "@/shared/runtime";

const LIGHTBOX_T = { duration: 0.15, ease: EASE } as const;

/** Prefer a screen-level host (harness desktop); fall back to overlay host / body. */
function lightboxHost(): HTMLElement {
  return (
    document.getElementById("ocr-lightbox-screen-host") ??
    document.getElementById("overlay-lightbox-host") ??
    document.body
  );
}

/**
 * Cropped screenshot above recognized source text.
 * Tauri: opens a separate fullscreen lightbox window (overlay sessionFrame unchanged — no panel jump).
 * Browser harness: portals a fullscreen dimmer onto the desktop host.
 */
export function OcrSourceBlock(props: { image: string; text: string }) {
  const t = useT();
  const reduce = useReducedMotion();
  const [enlarged, setEnlarged] = useState(false);
  const [opening, setOpening] = useState(false);
  const preview = props.text.replace(/\s+/g, " ").trim();
  const tMotion = reduce ? INSTANT : LIGHTBOX_T;

  useEffect(() => {
    if (!enlarged || isTauri()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setEnlarged(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enlarged]);

  const open = async () => {
    if (enlarged || opening) return;
    setOpening(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("ocr_lightbox_open", { image: props.image });
      } else {
        setEnlarged(true);
      }
    } catch (e) {
      console.warn("[pointer] ocr lightbox open failed", e);
    } finally {
      setOpening(false);
    }
  };

  const lightbox =
    !isTauri() &&
    typeof document !== "undefined" &&
    createPortal(
      <AnimatePresence>
        {enlarged && (
          <motion.div
            key="ocr-lightbox"
            className="ocr-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={t("ocr.enlarge")}
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={tMotion}
            onClick={(e) => {
              e.stopPropagation();
              setEnlarged(false);
            }}
          >
            <motion.img
              src={props.image}
              alt=""
              draggable={false}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={tMotion}
              style={{ originX: 0.5, originY: 0.5 }}
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>,
      lightboxHost(),
    );

  return (
    <>
      <div className="ocr-source">
        <button
          type="button"
          className="ocr-thumb"
          disabled={opening}
          onClick={(e) => {
            e.stopPropagation();
            void open();
          }}
          title={t("ocr.enlarge")}
          aria-label={t("ocr.enlarge")}
        >
          <img src={props.image} alt="" draggable={false} />
        </button>
        {preview ? (
          <span className="ocr-source-text" title={preview}>
            {preview}
          </span>
        ) : null}
      </div>
      {lightbox}
    </>
  );
}
