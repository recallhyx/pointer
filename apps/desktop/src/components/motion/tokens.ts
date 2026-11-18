import type { Transition } from "motion/react";

/**
 * Shared motion timings. WebKit rule: text only ever animates `opacity`; sizes animate real
 * `width`/`height`, never `layout` transforms, which blur or shake text on macOS.
 */
export const EASE = [0.2, 0, 0, 1] as const;
export const FADE: Transition = { duration: 0.2, ease: EASE };
export const FADE_QUICK: Transition = { duration: 0.1, ease: EASE };
/** Skeleton → content / page crossfade (transitions.dev ~reveal-dur, opacity only). */
export const FADE_REVEAL: Transition = { duration: 0.28, ease: EASE };
export const REVEAL: Transition = { duration: 0.18, ease: EASE };
export const SIZE_SPRING: Transition = { type: "spring", bounce: 0, duration: 0.3 };
/** Instant, for prefers-reduced-motion. */
export const INSTANT: Transition = { duration: 0 };

/** Overlay surface: bubble → bar → panel card resize (aligned across Overlay + Pinned). */
export const CARD_ENTER: Transition = { type: "spring", visualDuration: 0.12, bounce: 0.3 };
export const CARD_EXPAND: Transition = { type: "spring", visualDuration: 0.34, bounce: 0.22 };
export const CARD_COLLAPSE: Transition = { type: "spring", visualDuration: 0.26, bounce: 0 };
export const CARD_GROW: Transition = { type: "spring", visualDuration: 0.22, bounce: 0 };
export const CARD_LEAVE: Transition = { duration: 0.14, ease: "easeOut" };

/** Settings glide pill: slide between rows (Design: 220ms). */
export const PILL_EASE = [0.23, 1, 0.32, 1] as const;
export const PILL_GLIDE: Transition = { duration: 0.22, ease: PILL_EASE };
/** HoverPill / tabs sliding underline (legacy spring). */
export const PILL_SPRING: Transition = { type: "spring", visualDuration: 0.2, bounce: 0.18 };
export const PILL_FADE: Transition = { duration: 0.1, ease: EASE };

/** Notification badge / default-provider dot. */
export const BADGE_POP: Transition = { type: "spring", bounce: 0.2, duration: 0.35 };

/** Success check path draw. */
export const CHECK_DRAW: Transition = { delay: 0.08, duration: 0.28, ease: "easeOut" };

/** Error notice shake (container chrome only when possible). */
export const SHAKE_X = [0, -3, 3, -2, 2, 0] as const;
export const SHAKE: Transition = { duration: 0.38, ease: "easeInOut" };

/** Props for a list item that grows in and collapses out; put padding on an inner element. */
export const LIST_ITEM_MOTION = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: REVEAL,
  style: { overflow: "hidden" },
} as const;
