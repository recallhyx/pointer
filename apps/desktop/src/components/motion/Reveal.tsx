import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FADE_QUICK, INSTANT, REVEAL } from "./tokens";

/** Standard ease-in-out: no fast first frame, so rows below start moving gently. */
const HEIGHT: Transition = { duration: 0.28, ease: [0.4, 0, 0.2, 1] };
import { useMeasure } from "./useMeasure";

/**
 * Mounts and unmounts `children` by animating real height (or width, with `axis="x"`) and
 * opacity, never transforms. The target size is measured, not `"auto"`, so opening is as
 * smooth as closing.
 *
 * Spacing: the outer wrapper always stays in the DOM with zero margin, so a parent `space-y-*`
 * (which puts its margin on every non-last child) never gains or loses a gap when this opens or
 * closes. Give the space this content needs as `before`/`after` instead: it becomes padding
 * inside the animated box and grows and shrinks with it.
 *
 * Horizontally, content fades out before the width closes (and the width opens before content
 * fades in), so text is never seen clipped mid-word.
 *
 * Not built on AnimatePresence: one element stays mounted through open/close cycles, so rapid
 * toggles retarget from the current size instead of restarting. Children are frozen while
 * closing, so content that disappears together with `show` still collapses smoothly.
 */
export function Reveal(props: {
  show: boolean;
  children: ReactNode;
  axis?: "y" | "x";
  /** Space above (y) or left of (x) the content, in px, animated with it. */
  before?: number;
  /** Space below (y) or right of (x) the content, in px, animated with it. */
  after?: number;
  /** Extra delay before entering, in seconds (for staggering, or waiting for a menu to close). */
  delay?: number;
  className?: string;
  id?: string;
}) {
  const reduce = useReducedMotion();
  const x = props.axis === "x";
  const [ref, size] = useMeasure<HTMLDivElement>(x ? "x" : "y");
  const [mounted, setMounted] = useState(props.show);
  const [skipInitial, setSkipInitial] = useState(props.show);
  const [kept, setKept] = useState(props.children);
  if (props.show && !mounted) setMounted(true);
  if (props.show && kept !== props.children) setKept(props.children);
  // Clip while animating; only a fully open, settled box shows overflow (so focus rings aren't cut).
  const [settled, setSettled] = useState(props.show);
  if (!props.show && settled) setSettled(false);

  const pad = x
    ? { paddingLeft: props.before, paddingRight: props.after }
    : { paddingTop: props.before, paddingBottom: props.after };
  const delay = props.delay ?? 0;
  const enter: Transition = reduce
    ? INSTANT
    : x
      ? { width: { ...REVEAL, delay }, opacity: { ...FADE_QUICK, delay: delay + 0.1 } }
      : // Height leads, text fades in only once there is room for it.
        { height: { ...HEIGHT, delay }, opacity: { duration: 0.16, ease: "easeOut", delay: delay + 0.12 } };
  const leave: Transition = reduce
    ? INSTANT
    : x
      ? { width: { ...REVEAL, delay: 0.08 }, opacity: FADE_QUICK }
      : // Text fades out first, then the box closes, so it never sits against the row below.
        { height: { ...HEIGHT, delay: 0.08 }, opacity: { duration: 0.1, ease: "easeOut" } };
  const sized = (v: number): TargetAndTransition => (x ? { width: v } : { height: v });
  const target: TargetAndTransition = props.show
    ? { ...(size === null ? {} : sized(size)), opacity: 1, transition: enter }
    : { ...sized(0), opacity: 0, transition: leave };

  return (
    <div id={props.id} className={cn(x && "inline-flex", props.className)} style={{ margin: 0 }}>
      {mounted && (
        <motion.div
          style={{ overflow: settled ? "visible" : "hidden", display: x ? "inline-flex" : undefined, flexShrink: 0 }}
          initial={skipInitial ? false : { ...sized(0), opacity: 0 }}
          animate={target}
          onAnimationStart={() => setSettled(false)}
          onAnimationComplete={() => {
            if (props.show) setSettled(true);
            else {
              setMounted(false);
              setSkipInitial(false);
            }
          }}
        >
          <div
            ref={ref}
            style={{ ...pad, display: x ? "inline-flex" : "flow-root" }}
            className={cn(x && "shrink-0 whitespace-nowrap")}
          >
            {props.show ? props.children : kept}
          </div>
        </motion.div>
      )}
    </div>
  );
}
