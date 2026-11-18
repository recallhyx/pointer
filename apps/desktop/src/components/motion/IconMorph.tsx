import { motion, useReducedMotion, type Transition } from "motion/react";
import type { SVGProps } from "react";

import type { MorphShape } from "./iconShapes";
import { INSTANT } from "./tokens";

const MORPH: Transition = { type: "spring", bounce: 0.15, duration: 0.45 };

export function IconMorph({
  shape,
  state,
  size = 16,
  strokeWidth = 2,
  onAnimationComplete,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "ref" | "children"> & {
  shape: MorphShape;
  state: boolean;
  size?: number;
  onAnimationComplete?: () => void;
}) {
  const reduce = useReducedMotion();
  const transition = reduce ? INSTANT : MORPH;
  const i = state ? 1 : 0;
  return (
    <motion.svg
      {...(props as object)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      initial={false}
      animate={{ rotate: shape.rotate?.[i] ?? 0 }}
      transition={transition}
      onAnimationComplete={onAnimationComplete}
    >
      {shape.paths.map((p, k) => (
        <motion.path
          key={k}
          initial={false}
          animate={{
            d: state ? p.to : p.from,
            fillOpacity: p.fill?.[i] ?? 0,
            opacity: p.opacity?.[i] ?? 1,
          }}
          fill="currentColor"
          transition={transition}
        />
      ))}
    </motion.svg>
  );
}
