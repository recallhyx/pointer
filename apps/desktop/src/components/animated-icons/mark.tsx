"use client";

// The app mark (a selected word with the bubble's dot at its lower right) as a bubble glyph, in
// lucide-animated's component shape. Hover pops the dot. Filled, not stroked: it matches the app
// and menu-bar icons drawn from `src-tauri/icons/source.svg`.

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useId, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface MarkIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MarkIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const MarkIcon = forwardRef<MarkIconHandle, MarkIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);
    // Mask ids are document-global; several bubbles (overlay + harness) can share a page.
    const cut = useId();

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
        <svg fill="currentColor" height={size} viewBox="2 10 90 90" width={size} xmlns="http://www.w3.org/2000/svg">
          <mask id={cut}>
            <rect fill="#fff" height="100" width="100" />
            <circle cx="70" cy="66" fill="#000" r="25" />
          </mask>
          <rect fillOpacity={0.32} height="38" mask={`url(#${cut})`} rx="11" width="70" x="8" y="22" />
          <motion.circle
            animate={controls}
            cx="70"
            cy="66"
            r="17"
            transition={{ duration: 0.4, ease: "easeOut" }}
            variants={{ normal: { scale: 1 }, animate: { scale: [1, 1.18, 1] } }}
          />
        </svg>
      </div>
    );
  },
);

MarkIcon.displayName = "MarkIcon";

export { MarkIcon };
