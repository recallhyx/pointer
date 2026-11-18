import { describe, expect, it } from "vitest";

import { answerFor, normalize } from "./demo/answers";
import { barFrame, bubbleFrame, doneFrame, GAP, MARGIN, panelFrame, PANEL_MAX_HEIGHT } from "./demo/geometry";
import { closeMarkers, parseMarkdown } from "./demo/markdownParse";
import { detectPlatform } from "./downloads";
import { MESSAGES } from "./i18n";

const view = { left: 0, width: 1200 };

describe("placement", () => {
  it("puts the bubble 14px right and below the mouse-up point", () => {
    expect(bubbleFrame({ x: 100, y: 200 }, view)).toMatchObject({ x: 100 + GAP, y: 200 + GAP, w: 28, h: 28 });
  });

  it("keeps the bubble inside the viewport", () => {
    const b = bubbleFrame({ x: 1195, y: 10 }, view);
    expect(b.x + b.w).toBeLessThanOrEqual(view.width - MARGIN);
  });

  it("grows the bar right, or left when the right side has no room", () => {
    const bubbleR = bubbleFrame({ x: 100, y: 100 }, view);
    const right = barFrame(bubbleR, 300, view);
    expect(right.dir).toBe("right");
    expect(right.frame).toMatchObject({ x: bubbleR.x, y: bubbleR.y });

    const bubble = bubbleFrame({ x: 1100, y: 100 }, view);
    const left = barFrame(bubble, 300, view);
    expect(left.dir).toBe("left");
    expect(left.frame.x + left.frame.w).toBe(bubble.x + bubble.w);
    expect(left.frame.y).toBe(bubble.y);
    expect(left.frame.x + left.frame.w).toBeLessThanOrEqual(view.width - MARGIN);
  });

  it("starts the panel below the selection and caps its height", () => {
    const { frame, dir } = barFrame(bubbleFrame({ x: 100, y: 100 }, view), 300, view);
    const panel = panelFrame(frame, dir, 900, 160, view);
    expect(panel.y).toBeGreaterThan(160);
    expect(panel.h).toBe(PANEL_MAX_HEIGHT);
    expect(panel.w).toBe(420);
  });

  it("narrows the panel on a small screen", () => {
    const phone = { left: 0, width: 360 };
    const { frame, dir } = barFrame(bubbleFrame({ x: 40, y: 100 }, phone), 280, phone);
    const panel = panelFrame(frame, dir, 200, 110, phone);
    expect(panel.x).toBeGreaterThanOrEqual(MARGIN);
    expect(panel.x + panel.w).toBeLessThanOrEqual(phone.width - MARGIN);
  });

  it("shrinks a finished local action back to a bubble where the bar began", () => {
    const { frame, dir } = barFrame(bubbleFrame({ x: 100, y: 100 }, view), 300, view);
    expect(doneFrame(frame, dir)).toMatchObject(bubbleFrame({ x: 100, y: 100 }, view));
  });
});

describe("prepared answers", () => {
  it("matches a phrase however it was selected", () => {
    expect(normalize("  Goodhart’s\n law ")).toBe("goodhart's law");
    expect(answerFor("Goodhart’s law", "explain", "zh")).toContain("古德哈特定律");
    expect(answerFor("velocity", "explain", "en")).toContain("story points");
  });

  it("prefers the most specific entry", () => {
    const sentence = "When a measure becomes a target, it ceases to be a good measure.";
    expect(answerFor(sentence, "translate", "zh")).toBe("当一个指标变成目标，它就不再是一个好指标。");
  });

  it("translates into Chinese for both page languages", () => {
    expect(answerFor("inflate", "translate", "en")).toBe(answerFor("inflate", "translate", "zh"));
  });

  it("says it is a demo for anything else", () => {
    expect(answerFor("Privacy", "explain", "en")).toContain("demo");
    expect(answerFor("隐私", "translate", "zh")).toContain("演示");
  });
});

describe("streamed markdown", () => {
  it("never shows a half-streamed marker", () => {
    expect(closeMarkers("**Good")).toBe("**Good**");
    expect(closeMarkers("**Goodhart's law*")).toBe("**Goodhart's law**");
    expect(closeMarkers("a *cease")).toBe("a *cease*");
    expect(closeMarkers("done **bold**")).toBe("done **bold**");
  });

  it("parses paragraphs, lists and line breaks", () => {
    expect(parseMarkdown("**A**\nb\n\n- one\n- two")).toEqual([
      { kind: "p", lines: [[{ kind: "strong", text: "A" }], [{ kind: "text", text: "b" }]] },
      { kind: "ul", items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
    ]);
  });
});

describe("platform", () => {
  it("detects desktops and treats phones and iPads as other", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("other");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 15)")).toBe("other");
  });
});

describe("copy", () => {
  it("has every message in both languages", () => {
    for (const [key, text] of Object.entries(MESSAGES.en)) {
      expect(text, key).not.toBe("");
      expect(MESSAGES.zh[key as keyof typeof MESSAGES.zh], key).toBeTruthy();
    }
  });
});
