import { useCallback, useEffect, useRef, useState } from "react";

/** Characters per second; CJK carries more per character, so it streams slower. */
const CPS_LATIN = 110;
const CPS_CJK = 42;
/** The one-line skeleton shows this long before the first character. */
const FIRST_CHAR_DELAY = 480;

export interface Stream {
  text: string;
  /** Still before the first character. */
  waiting: boolean;
  done: boolean;
  stop: () => void;
}

interface State {
  key: string;
  pos: number;
  waiting: boolean;
  stopped: boolean;
}

const fresh = (key: string): State => ({ key, pos: 0, waiting: true, stopped: false });

/**
 * Plays `full` out character by character like a model reply. A new `run` restarts it, which is
 * how regenerate and each follow-up begin streaming. With `instant` (reduced motion), it shows the
 * whole answer at once after the same short wait.
 */
export function useStream(full: string, run: number, instant = false): Stream {
  const key = `${run}\n${instant}\n${full}`;
  const [stored, setState] = useState(() => fresh(key));
  // A new key starts over without an extra render: state from the previous run is ignored.
  const state = stored.key === key ? stored : fresh(key);
  const frame = useRef(0);
  const timer = useRef(0);

  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current);
    clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    const cps = /[\u3000-\u9fff]/.test(full) ? CPS_CJK : CPS_LATIN;
    timer.current = window.setTimeout(() => {
      if (instant) {
        setState({ key, pos: full.length, waiting: false, stopped: false });
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const pos = Math.min(full.length, Math.floor(((now - start) / 1000) * cps) + 1);
        setState({ key, pos, waiting: false, stopped: false });
        if (pos < full.length) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    }, FIRST_CHAR_DELAY);
    return halt;
  }, [key, full, instant, halt]);

  const stop = useCallback(() => {
    halt();
    setState((s) => ({ ...(s.key === key ? s : fresh(key)), waiting: false, stopped: true }));
  }, [halt, key]);

  return {
    text: full.slice(0, state.pos),
    waiting: state.waiting && !state.stopped,
    done: state.stopped || state.pos >= full.length,
    stop,
  };
}
