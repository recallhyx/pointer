import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { FADE_QUICK, INSTANT } from "./tokens";

/** Fades the old content out, then the new one in, when `swapKey` changes. Opacity only. */
export function Crossfade(props: { swapKey: string | number | boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const t = reduce ? INSTANT : FADE_QUICK;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={String(props.swapKey)}
        className={props.className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={t}
      >
        {props.children}
      </motion.div>
    </AnimatePresence>
  );
}
