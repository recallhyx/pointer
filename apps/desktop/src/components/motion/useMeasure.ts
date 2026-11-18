import { useLayoutEffect, useState } from "react";

/**
 * Measures an element's natural size (height or width) with a ResizeObserver. Animating to a
 * measured number instead of motion's `"auto"` keeps expand as smooth as collapse: `"auto"`
 * targets are resolved lazily and could land in one frame on the first open.
 *
 * Returns a callback ref, so it keeps working when the element unmounts and mounts again.
 * Sizes are exact (fractional) so the animation ends where layout would put it.
 */
export function useMeasure<T extends HTMLElement>(axis: "y" | "x" = "y") {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize(axis === "x" ? r.width : r.height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, axis]);
  return [setEl, size] as const;
}
