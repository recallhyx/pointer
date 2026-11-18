import type { Transition } from "motion/react";

/**
 * The overlay's motion, copied from apps/desktop/src/components/motion/tokens.ts so the demo
 * moves exactly like the app. Expanding overshoots a little; shrinking settles without bounce.
 */
export const EASE = [0.2, 0, 0, 1] as const;
export const FADE: Transition = { duration: 0.2, ease: EASE };
export const INSTANT: Transition = { duration: 0 };

export const CARD_ENTER: Transition = { type: "spring", visualDuration: 0.12, bounce: 0.3 };
export const CARD_EXPAND: Transition = { type: "spring", visualDuration: 0.34, bounce: 0.22 };
export const CARD_COLLAPSE: Transition = { type: "spring", visualDuration: 0.26, bounce: 0 };
export const CARD_GROW: Transition = { type: "spring", visualDuration: 0.22, bounce: 0 };
export const CARD_LEAVE: Transition = { duration: 0.14, ease: "easeOut" };
export const PILL_SPRING: Transition = { type: "spring", visualDuration: 0.2, bounce: 0.18 };
