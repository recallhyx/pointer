import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { animate, motion, useReducedMotion, type Transition } from "motion/react";

import { cn } from "@/lib/utils";

/**
 * Adapted from Arc's Radio Group (https://uiarc.dev/components/radio-group): the motion is kept,
 * the CSS module is rewritten with this theme's Tailwind tokens.
 */

/** The highlight's glide between rows: no overshoot, so it lands on the row's border exactly. */
const GLIDE: Transition = { type: "spring", visualDuration: 0.42, bounce: 0 };
/** The dot springing in and out. */
const SNAP: Transition = { type: "spring", visualDuration: 0.26, bounce: 0 };

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
}

/** Sizes the highlight to the chosen row. A new choice glides; the first paint and resizes place it at once. */
function place(
  highlight: HTMLElement | null,
  row: HTMLElement | null | undefined,
  at: { current: string },
  glide: boolean,
) {
  const next = row ? `${row.offsetTop} ${row.offsetHeight}` : "";
  if (!highlight || next === at.current) return;
  const visible = at.current !== "";
  at.current = next;
  if (!row) {
    animate(highlight, { opacity: 0 }, { duration: 0 });
    return;
  }
  const target = { y: row.offsetTop, height: row.offsetHeight, opacity: 1 };
  if (glide && visible) {
    animate(highlight, target, { ...GLIDE, opacity: { duration: 0 } });
    return;
  }
  animate(highlight, target, { duration: 0 });
}

/**
 * One highlight travels to the chosen row while the new dot springs in and the old one shrinks
 * away, so a change reads as a single move. Arrow keys take the same path (native radios). Rows
 * and text never resize.
 */
export function RadioGroup<T extends string>({
  label,
  description,
  options,
  value,
  onValueChange,
  name,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  options: RadioOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  name?: string;
  className?: string;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const rows = useRef<(HTMLLabelElement | null)[]>([]);
  const shown = useRef<number | null>(null);
  const at = useRef("");
  const selected = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    place(
      highlightRef.current,
      rows.current[selected],
      at,
      shown.current !== null && shown.current !== selected && !reduced,
    );
    shown.current = selected;
  }, [selected, reduced]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      place(highlightRef.current, rows.current[shown.current ?? -1], at, false),
    );
    observer.observe(list);
    rows.current.forEach((row) => row && observer.observe(row));
    return () => observer.disconnect();
  }, [options.length]);

  return (
    <fieldset className={cn("m-0 grid min-w-0 border-0 p-0", className)}>
      <legend className="p-0 text-sm font-medium">{label}</legend>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div ref={listRef} className="relative mt-2 grid gap-2">
        {/* Above the rows' borders and fills, below their text, so it never crosses a label. */}
        <span
          ref={highlightRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-[1] rounded-md border border-primary bg-primary/5 opacity-0"
        />
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              ref={(node) => {
                rows.current[index] = node;
              }}
              className="group relative flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 transition-colors duration-150 hover:bg-accent/60 active:bg-accent/60"
            >
              <input
                type="radio"
                name={name ?? id}
                value={option.value}
                checked={checked}
                onChange={() => onValueChange(option.value)}
                className="peer absolute opacity-0"
              />
              {/* The mark alone answers a press: a quick dip, then a spring back. */}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-[2] grid size-[17px] shrink-0 place-items-center rounded-full border transition-[border-color,background-color,transform] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-active:scale-[0.88] group-active:duration-100 group-active:ease-out peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50",
                  checked ? "border-primary bg-primary" : "border-ring/60",
                  // A faint dot previews the choice while the pointer is down.
                  !checked &&
                    "after:col-start-1 after:row-start-1 after:size-[7px] after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity after:duration-100 after:content-[''] group-active:after:opacity-[0.22]",
                )}
              >
                <motion.span
                  className="col-start-1 row-start-1 size-[7px] rounded-full bg-primary-foreground"
                  initial={false}
                  animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                  transition={reduced ? { duration: 0 } : { ...SNAP, opacity: { duration: checked ? 0.16 : 0.12 } }}
                />
              </span>
              <span className="relative z-[2] min-w-0">
                <span
                  className={cn(
                    "block text-sm font-medium transition-colors duration-200",
                    checked ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {option.label}
                </span>
                {option.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
