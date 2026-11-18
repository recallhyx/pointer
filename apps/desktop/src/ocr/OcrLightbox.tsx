import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { EASE, INSTANT } from "@/components/motion";
import { useT } from "@/i18n";
import { isTauri } from "@/shared/runtime";

const LIGHTBOX_T = { duration: 0.15, ease: EASE } as const;

/**
 * Separate-window OCR crop viewer. Covers the display work area without resizing the overlay,
 * so the result panel never jumps when enlarging a thumbnail.
 */
export function OcrLightbox() {
  const t = useT();
  const reduce = useReducedMotion();
  const [image, setImage] = useState<string | null>(null);
  const tMotion = reduce ? INSTANT : LIGHTBOX_T;

  useEffect(() => {
    document.documentElement.classList.add("ocr-lightbox-page");
    document.body.classList.add("ocr-lightbox-page");
    return () => {
      document.documentElement.classList.remove("ocr-lightbox-page");
      document.body.classList.remove("ocr-lightbox-page");
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const [{ listen }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@tauri-apps/api/core"),
      ]);
      unlisten = await listen<{ image: string | null }>("ocr-lightbox://show", (e) => {
        setImage(e.payload?.image ?? null);
      });
      // After subscribe: pick up image stored before this webview was ready.
      const peek = await invoke<string | null>("ocr_lightbox_peek").catch(() => null);
      if (!cancelled && peek) setImage(peek);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const close = async () => {
    setImage(null);
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ocr_lightbox_close").catch(() => {});
  };

  useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      void close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [image]);

  // Window is only shown while the lightbox is open — always paint the dim so a slow peek
  // never leaves a tiny transparent hole beside the Explain panel.
  return (
    <div
      className="ocr-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t("ocr.enlarge")}
      onClick={() => void close()}
    >
      <AnimatePresence>
        {image && (
          <motion.img
            key={image.slice(0, 64)}
            src={image}
            alt=""
            draggable={false}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={tMotion}
            style={{ originX: 0.5, originY: 0.5 }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
