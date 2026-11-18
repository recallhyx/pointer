import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserPinHost,
  createBrowserPinnedBridge,
  isLimitError,
  PIN_LIMIT,
  presentPinned,
  type PinInit,
  type PinnedBridge,
} from "./pins";
import type { Answer } from "./useAnswer";

const surface = { x: 10, y: 20, width: 380, height: 160 };
const init = (text: string): PinInit => ({
  session: { panelHeight: 160 } as PinInit["session"],
  answer: { key: "1:1", text, status: "streaming", error: null, reason: null },
  relaying: true,
});
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("browser pin host", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal("window", { open: vi.fn(() => ({ close: vi.fn() })), close: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hands the session to the pinned page exactly once", async () => {
    const host = createBrowserPinHost();
    const label = await host.open(1, surface, 400, init("你好"));
    expect(window.open).toHaveBeenCalledWith(`#${label}`, label, expect.stringContaining("height=432"));
    const pinned = createBrowserPinnedBridge(label);
    expect((await pinned.init())?.answer?.text).toBe("你好");
    expect(await pinned.init()).toBeNull();
  });

  it("hands OCR crop data URL through to the pinned page", async () => {
    const host = createBrowserPinHost();
    const ocrInit: PinInit = {
      ...init("识别文字"),
      session: {
        panelHeight: 160,
        payload: {
          method: "ocr",
          text: "识别文字",
          ocrImage: "data:image/png;base64,abc",
          uiLanguage: "zh",
        },
      } as PinInit["session"],
    };
    const label = await host.open(1, surface, 400, ocrInit);
    const pinned = createBrowserPinnedBridge(label);
    const got = await pinned.init();
    expect(got?.session.payload.method).toBe("ocr");
    expect(got?.session.payload.ocrImage).toBe("data:image/png;base64,abc");
    expect(got?.session.payload.text).toBe("识别文字");
  });

  it("notifies the host only after the visible page acknowledges its paint", async () => {
    const host = createBrowserPinHost();
    const label = await host.open(1, surface, 400, init("ready"));
    const pinned = createBrowserPinnedBridge(label);
    const shown = vi.fn();
    host.onShown(shown);
    await pinned.show();
    await tick();
    expect(shown).not.toHaveBeenCalled();
    await pinned.painted();
    await tick();
    expect(shown).toHaveBeenCalledExactlyOnceWith(label);
  });

  it("preserves upward placement, scroll position, draft and focus in the snapshot", async () => {
    const host = createBrowserPinHost();
    const snapshot = {
      ...init("ready"),
      session: {
        ...init("ready").session,
        placement: { panel: { direction: "up", maxHeight: 400, anchorY: 880 } },
      } as PinInit["session"],
      scrollTop: 0,
      draft: "unsent follow-up",
      focus: true,
    };
    const label = await host.open(1, surface, 400, snapshot);
    expect(await createBrowserPinnedBridge(label).init()).toEqual(snapshot);
  });

  it("unpins and repins without closing the window or stopping its relayed stream", async () => {
    const host = createBrowserPinHost();
    const label = await host.open(1, surface, 400, init("answer"));
    const pinned = createBrowserPinnedBridge(label);
    const stop = vi.fn();
    host.onStop(stop);
    const answers: string[] = [];
    pinned.onAnswer((answer) => answers.push(answer.text));
    await pinned.setFixed(false);
    await pinned.setFixed(true);
    host.send(label, init("continued answer").answer!);
    await tick();
    expect(window.close).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(answers).toEqual(["continued answer"]);
  });

  it("releases a fixed slot on unpin but keeps the conversation alive", async () => {
    const host = createBrowserPinHost();
    const labels: string[] = [];
    for (let i = 0; i < PIN_LIMIT; i++) labels.push(await host.open(i, surface, 400, init("answer")));
    await createBrowserPinnedBridge(labels[0]!).setFixed(false);
    await tick();
    await expect(host.open(9, surface, 400, init("new"))).resolves.toBeTypeOf("string");
    expect(window.close).not.toHaveBeenCalled();
  });

  it("dismisses an unpinned panel outside, while engaged panels retain their conversation", async () => {
    const events = new EventTarget();
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    });
    const pinned = createBrowserPinnedBridge("pinned-test");
    const dismissed = vi.fn();
    const off = pinned.onDismiss(dismissed);
    events.dispatchEvent(new Event("blur"));
    expect(dismissed).not.toHaveBeenCalled();
    await pinned.setFixed(false);
    events.dispatchEvent(new Event("blur"));
    expect(dismissed).toHaveBeenCalledOnce();
    await pinned.engage();
    events.dispatchEvent(new Event("blur"));
    expect(dismissed).toHaveBeenCalledOnce();
    off();
    events.dispatchEvent(new Event("blur"));
    expect(dismissed).toHaveBeenCalledOnce();
  });

  it("relays snapshots after hello and forwards stop", async () => {
    const host = createBrowserPinHost();
    const label = await host.open(1, surface, 400, init(""));
    const pinned = createBrowserPinnedBridge(label);
    const got: Answer[] = [];
    pinned.onAnswer((a) => got.push(a));
    const hello = vi.fn((l: string) => host.send(l, { ...init("ab").answer! }));
    const stop = vi.fn();
    host.onHello(hello);
    host.onStop(stop);
    pinned.hello();
    await tick();
    expect(hello).toHaveBeenCalledWith(label);
    expect(got.at(-1)?.text).toBe("ab");
    // Another pinned panel's answers are not ours.
    host.send("pinned-other", { ...init("x").answer! });
    pinned.stop();
    await tick();
    expect(got).toHaveLength(1);
    expect(stop).toHaveBeenCalledWith(label);
  });

  it("keeps each pinned panel's answer stream independent", async () => {
    const host = createBrowserPinHost();
    const a = await host.open(1, surface, 400, init("甲"));
    const b = await host.open(2, surface, 400, init("乙"));
    const pinA = createBrowserPinnedBridge(a);
    const pinB = createBrowserPinnedBridge(b);
    const gotA: string[] = [];
    const gotB: string[] = [];
    pinA.onAnswer((ans) => gotA.push(ans.text));
    pinB.onAnswer((ans) => gotB.push(ans.text));
    host.send(a, { ...init("甲完").answer!, status: "done", text: "甲完" });
    host.send(b, { ...init("乙完").answer!, status: "done", text: "乙完" });
    await tick();
    expect(gotA).toEqual(["甲完"]);
    expect(gotB).toEqual(["乙完"]);
    // A late update for B must not land on A.
    host.send(b, { ...init("乙改").answer!, status: "done", text: "乙改" });
    await tick();
    expect(gotA).toEqual(["甲完"]);
    expect(gotB).toEqual(["乙完", "乙改"]);
  });
  it(`refuses a pin past ${PIN_LIMIT}`, async () => {
    const host = createBrowserPinHost();
    for (let i = 0; i < PIN_LIMIT; i++) await host.open(i, surface, 400, init(""));
    const err = await host.open(9, surface, 400, init("")).catch((e: unknown) => e);
    expect(isLimitError(err)).toBe(true);
  });

  it("releases a blocked popup without consuming a fixed slot", async () => {
    vi.mocked(window.open).mockReturnValueOnce(null);
    const host = createBrowserPinHost();
    await expect(host.open(1, surface, 400, init("answer"))).rejects.toThrow("popup-blocked");
    for (let i = 0; i < PIN_LIMIT; i++) {
      await expect(host.open(i, surface, 400, init("answer"))).resolves.toBeTypeOf("string");
    }
  });

  it("cancels pending windows but never closes a completed handoff", async () => {
    const host = createBrowserPinHost();
    const pending = await host.open(1, surface, 400, init("pending"));
    const popup = vi.mocked(window.open).mock.results[0]!.value;
    const closed = vi.fn();
    host.onClosed(closed);
    await host.cancel(pending);
    await tick();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledWith(pending);
    const complete = await host.open(2, surface, 400, init("complete"));
    const completePopup = vi.mocked(window.open).mock.results[1]!.value;
    await createBrowserPinnedBridge(complete).painted();
    await tick();
    await host.cancel(complete);
    expect(completePopup.close).not.toHaveBeenCalled();
  });
});

describe("pinned presentation handoff", () => {
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
  const frame = () => frames.splice(0).forEach((cb) => cb(0));
  const bridge = () =>
    ({
      show: vi.fn(async () => {}),
      painted: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }) as unknown as PinnedBridge;

  it("shows a hidden WebKit page on timeout but waits for actual visible frames to hand over", async () => {
    const b = bridge();
    const shown = vi.fn();
    const error = vi.fn();
    presentPinned(b, shown, error);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.show).toHaveBeenCalledOnce();
    expect(shown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.painted).not.toHaveBeenCalled();
    // The first callback is the cancelled hidden frame; afterFrames guards it from firing twice.
    frame();
    expect(b.painted).not.toHaveBeenCalled();
    frame();
    expect(shown).toHaveBeenCalledOnce();
    expect(b.painted).not.toHaveBeenCalled();
    frame();
    frame();
    expect(b.painted).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it("does not hand over after unmount while show is still pending", async () => {
    let resolve!: () => void;
    const b = bridge();
    vi.mocked(b.show).mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const shown = vi.fn();
    const cancel = presentPinned(b, shown, vi.fn());
    frame();
    frame();
    cancel();
    resolve();
    await Promise.resolve();
    frame();
    frame();
    expect(shown).not.toHaveBeenCalled();
    expect(b.painted).not.toHaveBeenCalled();
    expect(b.close).not.toHaveBeenCalled();
  });

  it("closes a failed painted window without reporting a completed handoff", async () => {
    const b = bridge();
    const failure = new Error("painted failed");
    vi.mocked(b.painted).mockRejectedValue(failure);
    const error = vi.fn();
    const presented = vi.fn();
    presentPinned(b, vi.fn(), error, presented);
    await vi.advanceTimersByTimeAsync(100);
    frame();
    frame();
    frame();
    frame();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(failure);
    expect(b.close).toHaveBeenCalledOnce();
    expect(presented).not.toHaveBeenCalled();
  });

  it("reports show failure without removing the old panel", async () => {
    const b = bridge();
    const failure = new Error("show failed");
    vi.mocked(b.show).mockRejectedValue(failure);
    const error = vi.fn();
    const shown = vi.fn();
    presentPinned(b, shown, error);
    await vi.advanceTimersByTimeAsync(100);
    expect(error).toHaveBeenCalledWith(failure);
    expect(shown).not.toHaveBeenCalled();
    expect(b.painted).not.toHaveBeenCalled();
    expect(b.close).toHaveBeenCalledOnce();
  });

  it("restores keyboard focus only after the native swap completes", async () => {
    const b = bridge();
    let swapped!: () => void;
    vi.mocked(b.painted).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          swapped = resolve;
        }),
    );
    const focus = vi.fn();
    presentPinned(b, vi.fn(), vi.fn(), focus);
    await vi.advanceTimersByTimeAsync(100);
    frame();
    frame();
    frame();
    frame();
    expect(b.painted).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
    swapped();
    await Promise.resolve();
    expect(focus).toHaveBeenCalledOnce();
  });
});
