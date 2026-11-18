import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterFrames } from "./frames";

describe("afterFrames", () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const tick = () => frames.splice(0).forEach((f) => f(0));

  it("runs after the requested number of frames", () => {
    const cb = vi.fn();
    afterFrames(2, cb);
    tick();
    expect(cb).not.toHaveBeenCalled();
    tick();
    expect(cb).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("falls back to a timer when frames are suspended (hidden WKWebView)", () => {
    const cb = vi.fn();
    afterFrames(2, cb, 50);
    vi.advanceTimersByTime(49);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledOnce();
    tick();
    tick();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("can be cancelled", () => {
    const cb = vi.fn();
    afterFrames(1, cb)();
    tick();
    vi.runAllTimers();
    expect(cb).not.toHaveBeenCalled();
  });

  it("never substitutes a timer for a visible paint when fallback is disabled", () => {
    const cb = vi.fn();
    afterFrames(2, cb, null);
    vi.advanceTimersByTime(10_000);
    expect(cb).not.toHaveBeenCalled();
    tick();
    expect(cb).not.toHaveBeenCalled();
    tick();
    expect(cb).toHaveBeenCalledOnce();
  });
});
