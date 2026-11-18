import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { INSTANT, REVEAL } from "./tokens";
import { useMeasure } from "./useMeasure";

/**
 * A list row for use directly inside `AnimatePresence`: grows from 0 to its measured height and
 * fades in, then collapses out. Put padding/borders on `innerClassName`, not on the row.
 */
export function CollapseItem(props: {
  as?: "div" | "li";
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const [ref, height] = useMeasure<HTMLDivElement>("y");
  const Tag = props.as === "li" ? motion.li : motion.div;
  const t = reduce ? INSTANT : { ...REVEAL, delay: props.delay ?? 0 };
  return (
    <Tag
      className={props.className}
      style={{ overflow: "hidden" }}
      initial={{ height: 0, opacity: 0 }}
      animate={height === null ? { opacity: 1, transition: t } : { height, opacity: 1, transition: t }}
      exit={{ height: 0, opacity: 0, transition: reduce ? INSTANT : REVEAL }}
    >
      <div ref={ref} className={props.innerClassName} style={{ display: "flow-root" }}>
        {props.children}
      </div>
    </Tag>
  );
}
