import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Keeps a scrolled panel pinned to its newest line while it streams, unless the reader scrolled up.
 * Only once the panel is `scrollable` (at its maximum height), as in apps/desktop/src/overlay/faces.tsx:
 * before that the panel is still growing to fit, and scrolling a new line into view would move the
 * earlier text up, then back down when the height catches up.
 */
export function useStickToBottom(dep: unknown, scrollable: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollHeight <= el.clientHeight) return;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!scrollable) el.scrollTop = 0;
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [dep, scrollable]);
  return ref;
}
