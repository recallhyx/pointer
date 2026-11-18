import { motion, type Transition, type Variants } from "motion/react";
import { useId } from "react";

/**
 * The overlay's glyphs, drawn and animated like apps/desktop/src/components/animated-icons
 * (lucide-animated). The desktop drives them through refs because the native window owns hover;
 * here the page knows hover itself, so each icon just plays while `play` is true.
 */
export interface IconProps {
  size?: number;
  play?: boolean;
}

const state = (play?: boolean) => (play ? "animate" : "normal");

function Stroke({
  size = 16,
  play,
  children,
  ...rest
}: IconProps & { children: React.ReactNode } & Record<string, unknown>) {
  return (
    <motion.svg
      animate={state(play)}
      initial="normal"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      aria-hidden
      {...rest}
    >
      {children}
    </motion.svg>
  );
}

/** The app mark: a selected word with the bubble's dot at its lower right (src-tauri/icons/source.svg). */
export function MarkIcon({ size = 18, play }: IconProps) {
  const cut = useId();
  return (
    <svg fill="currentColor" height={size} viewBox="2 10 90 90" width={size} aria-hidden>
      <mask id={cut}>
        <rect fill="#fff" height="100" width="100" />
        <circle cx="70" cy="66" fill="#000" r="25" />
      </mask>
      <rect fillOpacity={0.32} height="38" mask={`url(#${cut})`} rx="11" width="70" x="8" y="22" />
      <motion.circle
        animate={state(play)}
        cx="70"
        cy="66"
        r="17"
        transition={{ duration: 0.4, ease: "easeOut" }}
        variants={{ normal: { scale: 1 }, animate: { scale: [1, 1.18, 1] } }}
      />
    </svg>
  );
}

export function ExplainIcon(props: IconProps) {
  const ease = { ease: "easeInOut", duration: 0.8 } as const;
  return (
    <Stroke {...props}>
      <motion.g
        variants={{
          normal: { rotate: 0 },
          animate: {
            transformOrigin: "bottom left",
            rotate: [0, 8, -8, 2, 0],
            transition: { ...ease, times: [0, 0.4, 0.6, 0.8, 1] },
          },
        }}
      >
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        <motion.path
          d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
          variants={{
            normal: { y: 0 },
            animate: { y: [0, 1, -0.25, 0], transition: { ...ease, times: [0, 0.4, 0.7, 1] } },
          }}
        />
        <path d="M12 17h.01" />
      </motion.g>
    </Stroke>
  );
}

const DRAW: Variants = {
  normal: { opacity: 1, pathLength: 1 },
  animate: (i: number) => ({
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      opacity: { duration: 0.01, delay: 0.2 + i * 0.1 },
      pathLength: { type: "spring", duration: 0.5, bounce: 0, delay: 0.2 + i * 0.1 },
    },
  }),
};

export function TranslateIcon(props: IconProps) {
  const paths: [string, number][] = [
    ["m5 8 6 6", 3],
    ["m4 14 6-6 3-3", 2],
    ["M2 5h12", 1],
    ["M7 2h1", 0],
    ["m22 22-5-10-5 10", 3],
    ["M14 18h6", 3],
  ];
  return (
    <Stroke {...props}>
      {paths.map(([d, i]) => (
        <motion.path key={d} custom={i} d={d} variants={DRAW} />
      ))}
    </Stroke>
  );
}

const NUDGE: Transition = { duration: 0.3, ease: "easeInOut" };

export function CopyIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <motion.rect
        height="14"
        rx="2"
        ry="2"
        width="14"
        x="8"
        y="8"
        transition={NUDGE}
        variants={{ normal: { x: 0, y: 0 }, animate: { x: 1, y: 1 } }}
      />
      <motion.path
        d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
        transition={NUDGE}
        variants={{ normal: { x: 0, y: 0 }, animate: { x: -1, y: -1 } }}
      />
    </Stroke>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Stroke
      {...props}
      variants={{
        normal: { x: 0, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
        animate: { x: [0, 0, -3, 0], y: [0, -4, 0, 0], transition: { duration: 1, ease: "easeInOut" } },
      }}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Stroke>
  );
}

/** Draws itself whenever it mounts with `play`. */
export function CheckIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <motion.path
        d="M4 12 9 17L20 6"
        variants={{
          normal: { opacity: 1, pathLength: 1, scale: 1 },
          animate: {
            opacity: [0, 1],
            pathLength: [0, 1],
            scale: [0.5, 1],
            transition: { duration: 0.4, opacity: { duration: 0.1 } },
          },
        }}
      />
    </Stroke>
  );
}

export function RegenerateIcon(props: IconProps) {
  return (
    <Stroke
      {...props}
      transition={{ type: "spring", stiffness: 250, damping: 25 }}
      variants={{ normal: { rotate: 0 }, animate: { rotate: 50 } }}
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Stroke>
  );
}

export function StopIcon({ size = 16 }: IconProps) {
  return (
    <svg fill="currentColor" height={size} viewBox="0 0 24 24" width={size} aria-hidden>
      <rect height="12" rx="2.5" width="12" x="6" y="6" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Stroke
      {...props}
      transition={{ type: "spring", stiffness: 120, damping: 16 }}
      variants={{ normal: { rotate: 0 }, animate: { rotate: 90 } }}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Stroke>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <motion.path
        d="m5 12 7-7 7 7"
        variants={{ normal: { y: 0 }, animate: { y: [0, -3, 0], transition: { duration: 0.4 } } }}
      />
      <motion.path
        d="M12 19V5"
        variants={{ normal: { y: 0 }, animate: { y: [0, -3, 0], transition: { duration: 0.4 } } }}
      />
    </Stroke>
  );
}

/** The scripted demo's mouse pointer. */
export function CursorGlyph() {
  return (
    <svg width="20" height="24" viewBox="0 0 20 24" aria-hidden>
      <path
        d="M2 1.5v18.2l4.6-4.3 3.1 7 3.3-1.5-3.1-6.8h6.4z"
        fill="#111"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowDownIcon({ size = 16 }: IconProps) {
  return (
    <svg
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

export function AppleIcon({ size = 16 }: IconProps) {
  return (
    <svg fill="currentColor" height={size} viewBox="0 0 24 24" width={size} aria-hidden>
      <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.59 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5ZM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
    </svg>
  );
}

export function WindowsIcon({ size = 16 }: IconProps) {
  return (
    <svg fill="currentColor" height={size} viewBox="0 0 24 24" width={size} aria-hidden>
      <path d="M3 5.5 10.4 4.5v7H3zM11.3 4.4 21 3v8.5h-9.7zM3 12.4h7.4v7.1L3 18.5zM11.3 12.4H21V21l-9.7-1.4z" />
    </svg>
  );
}
