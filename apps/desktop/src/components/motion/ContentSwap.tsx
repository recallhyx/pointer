import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FADE_QUICK, INSTANT, SIZE_SPRING } from "./tokens";

/**
 * Fades the old `children` out, then the new in (never both at once, so no ghosting), whenever `swapKey` changes while the box springs its real `width` to
 * the new content (measured with a ResizeObserver). Only opacity touches the content, so text
 * stays on the pixel grid in WebKit.
 */
export function ContentSwap(props: { swapKey: string | number | boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const innerRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.ceil(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.span
      className={cn("relative inline-flex shrink-0 overflow-hidden", props.className)}
      initial={false}
      animate={width === null ? undefined : { width }}
      transition={reduce ? INSTANT : SIZE_SPRING}
    >
      <span ref={innerRef} className="relative inline-flex shrink-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={String(props.swapKey)}
            className="inline-flex shrink-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? INSTANT : FADE_QUICK}
          >
            {props.children}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.span>
  );
}
