"use client";

// lucide-animated ships no plain `pin`; this follows its component shape (lucide `pin` outline).

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface PinIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface PinIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
  /** Solid pin, for "already pinned". */
  filled?: boolean;
}

const PinIcon = forwardRef<PinIconHandle, PinIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, filled = false, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseEnter?.(e);
        else controls.start("animate");
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) onMouseLeave?.(e);
        else controls.start("normal");
      },
      [controls, onMouseLeave],
    );

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <motion.svg
          animate={controls}
          fill={filled ? "currentColor" : "none"}
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          style={{ originX: 0.5, originY: 0.92 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          variants={{
            normal: { rotate: "0deg", y: 0 },
            animate: { rotate: "-28deg", y: [0, -1.5, 0] },
          }}
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </motion.svg>
      </div>
    );
  },
);

PinIcon.displayName = "PinIcon";

/** The pin drawn solid: a panel that is already pinned. */
const PinnedIcon = forwardRef<PinIconHandle, Omit<PinIconProps, "filled">>((props, ref) => (
  <PinIcon ref={ref} filled {...props} />
));
PinnedIcon.displayName = "PinnedIcon";

export { PinIcon, PinnedIcon };
