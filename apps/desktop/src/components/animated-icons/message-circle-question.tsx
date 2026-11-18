"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface MessageCircleQuestionIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface MessageCircleQuestionIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const GROUP_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: {
    transformOrigin: "bottom left",
    rotate: [0, 8, -8, 2, 0],
    transition: {
      ease: "easeInOut",
      duration: 0.8,
      times: [0, 0.4, 0.6, 0.8, 1],
    },
  },
};

const MARK_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: {
    y: [0, 1, -0.25, 0],
    transition: {
      ease: "easeInOut",
      duration: 0.8,
      times: [0, 0.4, 0.7, 1],
    },
  },
};

const MessageCircleQuestionIcon = forwardRef<MessageCircleQuestionIconHandle, MessageCircleQuestionIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
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
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.g animate={controls} initial="normal" variants={GROUP_VARIANTS}>
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            <motion.path
              animate={controls}
              d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
              initial="normal"
              variants={MARK_VARIANTS}
            />
            <path d="M12 17h.01" />
          </motion.g>
        </svg>
      </div>
    );
  },
);

MessageCircleQuestionIcon.displayName = "MessageCircleQuestionIcon";

export { MessageCircleQuestionIcon };
