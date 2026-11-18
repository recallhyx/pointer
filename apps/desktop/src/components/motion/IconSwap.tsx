import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { FADE } from "./tokens";

/**
 * Crossfades icons in place (both stacked in one grid cell, so neither leaves the flow) when `swapKey` changes. Icons are small and text-free, so a slight
 * scale is allowed here (MotionConfig reducedMotion="user" drops it). Give the entering icon
 * `useIconAnimation(true)` to play its own draw-in.
 */
export function IconSwap(props: { swapKey: string | number | boolean; children: ReactNode }) {
  return (
    <span style={{ display: "inline-grid", placeItems: "center" }}>
      <AnimatePresence initial={false}>
        <motion.span
          key={String(props.swapKey)}
          className="inline-flex items-center justify-center"
          style={{ gridArea: "1 / 1" }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={FADE}
        >
          {props.children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
