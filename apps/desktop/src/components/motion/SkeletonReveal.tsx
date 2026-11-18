import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FADE_REVEAL, INSTANT } from "./tokens";

/**
 * Skeleton → content reveal (transitions.dev 14). Opacity-only on both layers — no blur/scale on
 * text (WebKit ghosting). The skeleton slot collapses out of flow when content arrives so streaming
 * markdown can grow the panel naturally.
 */
export function SkeletonReveal(props: {
  loading: boolean;
  children: ReactNode;
  /** Optional custom skeleton; defaults to the overlay shimmer bars. */
  skeleton?: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const t = reduce ? INSTANT : FADE_REVEAL;
  return (
    <div className={cn("skeleton-reveal", props.className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        {props.loading ? (
          <motion.div
            key="skeleton"
            className="skeleton-reveal-skel"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t}
            aria-hidden
          >
            {props.skeleton ?? <div className="placeholder is-pulsing" />}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            className="skeleton-reveal-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t}
          >
            {props.children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
