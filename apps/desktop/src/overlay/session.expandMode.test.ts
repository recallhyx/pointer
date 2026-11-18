import { describe, expect, it } from "vitest";

import type { Placement } from "./placement";
import { initialSession } from "./session";
import type { ShowPayload } from "./types";

const bubble = { x: 100, y: 100, width: 28, height: 28 };
const bar = { x: 80, y: 100, width: 260, height: 36 };
const placement: Placement = {
  bubble,
  bar,
  barDirection: "right",
  panel: { x: 80, direction: "down", anchorY: 140, maxHeight: 400 },
};

function payload(trigger: ShowPayload["trigger"] = "auto"): ShowPayload {
  return {
    session: 1,
    trigger,
    gesture: "mouseup",
    uiLanguage: "zh",
    pointerEvents: true,
    platform: "macos",
    workArea: { width: 1200, height: 800 },
    mouse: { x: 110, y: 110 },
    selectionRect: null,
    text: "hello",
    contextBefore: null,
    contextAfter: null,
    app: { name: null, id: null },
    captureMs: 1,
    method: "ax",
    ocrImage: null,
  };
}

describe("initialSession expandMode", () => {
  it("starts on the bubble for hover and click (auto trigger)", () => {
    expect(initialSession(payload(), placement, "hover").phase).toBe("bubble");
    expect(initialSession(payload(), placement, "click").phase).toBe("bubble");
  });

  it("skips the bubble when expandMode is skip", () => {
    expect(initialSession(payload(), placement, "skip").phase).toBe("bar");
  });

  it("always starts on the bar for the global shortcut", () => {
    expect(initialSession(payload("shortcut"), placement, "hover").phase).toBe("bar");
    expect(initialSession(payload("shortcut"), placement, "click").phase).toBe("bar");
    expect(initialSession(payload("shortcut"), placement, "skip").phase).toBe("bar");
  });
});
