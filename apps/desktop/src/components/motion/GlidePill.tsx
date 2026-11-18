import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { INSTANT, PILL_FADE, PILL_GLIDE } from "./tokens";

export type GlideLeaveMode = "fade" | "return";

type PillBox = { top: number; height: number };

type GlideCtx = {
  /** Highlight this row's element (hover / focus / cmdk selected). */
  pointAt: (el: HTMLElement | null) => void;
  /** Register an item for leaveMode=return lookup. */
  register: (id: string, el: HTMLElement | null) => void;
  /** True while the pointer/focus is inside the group and the pill is shown. */
  arming: boolean;
};

const Ctx = createContext<GlideCtx | null>(null);

function useGlide(): GlideCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("GlidePillItem must be used inside GlidePillGroup");
  return ctx;
}

/** Row geometry relative to the group root (supports nested items + scrolled roots). */
export function offsetInRoot(el: HTMLElement, root: HTMLElement): PillBox {
  const er = el.getBoundingClientRect();
  const rr = root.getBoundingClientRect();
  return {
    top: er.top - rr.top + root.scrollTop,
    height: er.height,
  };
}

/**
 * One shared hover/focus pill for a list group. Measures the hovered row and slides a single
 * absolute pill (top/height). Leave: fade in place (`fade`) or glide to the active row then fade
 * (`return`, Combobox). Active row keeps its idle styles while the pill follows hover.
 */
export function GlidePillGroup(props: {
  activeId?: string | null;
  leaveMode?: GlideLeaveMode;
  /** Extra classes on the sliding pill (e.g. lighter accent for Combobox). */
  pillClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const leaveMode = props.leaveMode ?? "fade";
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(new Map<string, HTMLElement>());
  const leaveTimer = useRef<number | undefined>(undefined);
  const [box, setBox] = useState<PillBox | null>(null);
  const [visible, setVisible] = useState(false);
  const [arming, setArming] = useState(false);

  const clearLeave = useCallback(() => {
    if (leaveTimer.current !== undefined) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = undefined;
    }
  }, []);

  const pointAt = useCallback(
    (el: HTMLElement | null) => {
      const root = rootRef.current;
      if (!root || !el || !root.contains(el)) return;
      clearLeave();
      setBox(offsetInRoot(el, root));
      setVisible(true);
      setArming(true);
    },
    [clearLeave],
  );

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) itemsRef.current.set(id, el);
    else itemsRef.current.delete(id);
  }, []);

  const leaveGroup = useCallback(() => {
    clearLeave();
    setArming(false);
    const root = rootRef.current;
    const activeId = props.activeId;
    if (leaveMode === "return" && activeId && root) {
      const el = itemsRef.current.get(activeId);
      if (el && root.contains(el)) {
        setBox(offsetInRoot(el, root));
        setVisible(true);
        const delay = reduce ? 0 : 220;
        leaveTimer.current = window.setTimeout(() => setVisible(false), delay);
        return;
      }
    }
    setVisible(false);
  }, [clearLeave, leaveMode, props.activeId, reduce]);

  useEffect(() => () => clearLeave(), [clearLeave]);

  const onBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    leaveGroup();
  };

  const moveT = reduce ? INSTANT : PILL_GLIDE;
  const fadeT = reduce ? INSTANT : visible ? PILL_FADE : { ...PILL_FADE, duration: 0.18 };

  return (
    <div ref={rootRef} className={cn("relative", props.className)} onMouseLeave={leaveGroup} onBlur={onBlurCapture}>
      <motion.div
        aria-hidden
        className={cn("pointer-events-none absolute right-0 left-0 z-0 rounded-lg bg-accent", props.pillClassName)}
        initial={false}
        animate={{
          top: box?.top ?? 0,
          height: box?.height ?? 32,
          opacity: visible && box ? 1 : 0,
        }}
        transition={{ top: moveT, height: moveT, opacity: fadeT }}
      />
      <Ctx.Provider value={{ pointAt, register, arming }}>{props.children}</Ctx.Provider>
    </div>
  );
}

export function GlidePillItem(
  props: {
    id: string;
    active?: boolean;
    /** Active-row background + weight (nav uses surface, lists use accent); kept while pill moves. */
    activeClassName?: string;
    className?: string;
    children: ReactNode;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "id" | "children">,
) {
  const { id, active, activeClassName, className, children, onMouseEnter, onFocus, type, ...rest } = props;
  const ctx = useGlide();

  const setRefs = useCallback(
    (el: HTMLButtonElement | null) => {
      ctx.register(id, el);
    },
    [ctx, id],
  );

  return (
    <button
      {...rest}
      ref={setRefs}
      type={type ?? "button"}
      data-glide-id={id}
      data-active={active ? "true" : undefined}
      onMouseEnter={(e) => {
        ctx.pointAt(e.currentTarget);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        ctx.pointAt(e.currentTarget);
        onFocus?.(e);
      }}
      className={cn(
        "relative z-[1] flex w-full items-center rounded-lg outline-none",
        "origin-center transition-transform duration-150 ease-out",
        "active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:ring-2 focus-visible:ring-ring/80",
        // Keep active styles while armed — pill may sit on another row.
        active ? (activeClassName ?? "bg-accent") : "bg-transparent",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Optional hook for non-button rows (e.g. CommandItem) that still drive the shared pill. */
export function useGlidePillTarget(id: string) {
  const ctx = useContext(Ctx);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      ctx?.register(id, el);
    },
    [ctx, id],
  );
  const point = useCallback(
    (el: HTMLElement) => {
      ctx?.pointAt(el);
    },
    [ctx],
  );
  return { ref, point, arming: ctx?.arming ?? false, enabled: !!ctx };
}
