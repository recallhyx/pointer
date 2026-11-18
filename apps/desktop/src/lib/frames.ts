/**
 * `requestAnimationFrame` that still fires when the page cannot paint.
 *
 * WebKit (macOS WKWebView) suspends animation frames while the window is hidden or occluded, so a
 * callback that is meant to run "after the next paint" of the overlay would wait forever before the
 * overlay is shown. After `fallbackMs` the callback runs anyway; it runs exactly once.
 */
export function afterFrames(count: number, cb: () => void, fallbackMs: number | null = 100): () => void {
  let done = false;
  let raf = 0;
  const run = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    cb();
  };
  const step = (left: number) => {
    raf = requestAnimationFrame(() => (left <= 1 ? run() : step(left - 1)));
  };
  // A visible-window handoff must wait for actual frames, not the hidden-window timer.
  const timer = fallbackMs === null ? null : setTimeout(run, fallbackMs);
  step(Math.max(1, count));
  return () => {
    done = true;
    cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
  };
}
