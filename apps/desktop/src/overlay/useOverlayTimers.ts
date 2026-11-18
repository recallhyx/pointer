import { useEffect, useMemo, useRef } from "react";

/**
 * `dwell`: hover time before the bubble expands. `idle`: the bubble fades when untouched.
 * `check`: how long the check mark stays. `leave`: fallback in case the exit animation never ends.
 */
export type TimerName = "dwell" | "idle" | "check" | "leave";

/** One pending timeout per name. All of them are cleared on unmount. */
export function useOverlayTimers() {
  const timers = useRef<Partial<Record<TimerName, number>>>({});

  const api = useMemo(() => {
    const clear = (name: TimerName) => {
      clearTimeout(timers.current[name]);
      delete timers.current[name];
    };
    /** Replaces any pending timer with the same name. */
    const set = (name: TimerName, ms: number, fn: () => void) => {
      clear(name);
      timers.current[name] = window.setTimeout(() => {
        delete timers.current[name];
        fn();
      }, ms);
    };
    return {
      set,
      /** Keeps a pending timer with the same name instead of restarting it. */
      ensure: (name: TimerName, ms: number, fn: () => void) => {
        if (timers.current[name] === undefined) set(name, ms, fn);
      },
      clear,
      clearAll: () => {
        for (const t of Object.values(timers.current)) clearTimeout(t);
        timers.current = {};
      },
    };
  }, []);

  useEffect(() => () => api.clearAll(), [api]);
  return api;
}
