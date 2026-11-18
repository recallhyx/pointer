import { describe, expect, it } from "vitest";

import {
  BUBBLE_SIZE,
  EDGE,
  GAP,
  PANEL_MAX_HEIGHT,
  PANEL_WIDTH,
  panelRect,
  place,
  pointerLeftBubble,
  sessionFrame,
} from "./placement";
import { contains, intersect, type Rect } from "./types";

const workArea = { width: 1440, height: 875 };
const barWidth = 300;

const inside = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

describe("place", () => {
  it("puts the bubble below-right of the mouse and expands the bar to the right", () => {
    const p = place({ workArea, mouse: { x: 200, y: 200 }, barWidth });
    expect(p.bubble).toEqual({ x: 200 + GAP, y: 200 + GAP, width: BUBBLE_SIZE, height: BUBBLE_SIZE });
    expect(p.barDirection).toBe("right");
    expect(p.bar.x).toBe(p.bubble.x);
    expect(p.bar.y).toBe(p.bubble.y);
  });

  it("flips the bubble and bar near the right and bottom edges", () => {
    const p = place({ workArea, mouse: { x: 1430, y: 870 }, barWidth });
    expect(p.bubble.x + BUBBLE_SIZE).toBeLessThanOrEqual(1430);
    expect(p.bubble.y + BUBBLE_SIZE).toBeLessThanOrEqual(870);
    expect(p.barDirection).toBe("left");
    expect(p.bar.x + p.bar.width).toBe(p.bubble.x + BUBBLE_SIZE);
    expect(p.bar.y).toBe(p.bubble.y);
  });

  it("keeps the bar's top on the bubble's top even at the bottom edge", () => {
    for (const mouse of [
      { x: 500, y: 875 },
      { x: 500, y: 860 },
      { x: 1440, y: 875 },
    ]) {
      const p = place({ workArea, mouse, barWidth });
      expect(p.bar.y).toBe(p.bubble.y);
    }
  });

  it("keeps every surface inside the work area", () => {
    for (const mouse of [
      { x: 0, y: 0 },
      { x: 1440, y: 0 },
      { x: 0, y: 875 },
      { x: 1440, y: 875 },
      { x: 720, y: 437 },
    ]) {
      const p = place({ workArea, mouse, barWidth });
      const screen = { x: EDGE, y: EDGE, width: workArea.width - EDGE * 2, height: workArea.height - EDGE * 2 };
      expect(inside(screen, p.bubble)).toBe(true);
      expect(inside(screen, p.bar)).toBe(true);
      expect(inside(screen, panelRect(p.panel, p.panel.maxHeight))).toBe(true);
    }
  });

  it("grows the panel down from the bar's top edge, in place", () => {
    const p = place({ workArea, mouse: { x: 500, y: 220 }, barWidth });
    expect(p.panel.direction).toBe("down");
    const panel = panelRect(p.panel, p.panel.maxHeight);
    expect(panel.y).toBe(p.bar.y);
    expect(panel.height).toBe(PANEL_MAX_HEIGHT);
  });

  it("grows the panel up from the bar's bottom edge near the bottom of the screen", () => {
    const p = place({ workArea, mouse: { x: 500, y: 800 }, barWidth });
    expect(p.panel.direction).toBe("up");
    const panel = panelRect(p.panel, 120);
    expect(panel.y + panel.height).toBe(p.bar.y + p.bar.height);
  });

  it("shifts the panel left when it would overflow the right edge", () => {
    const p = place({ workArea, mouse: { x: 1200, y: 200 }, barWidth });
    expect(p.panel.x + PANEL_WIDTH).toBeLessThanOrEqual(workArea.width - EDGE);
  });
});

describe("windows", () => {
  it("session frame covers the bubble, bar and the tallest panel", () => {
    const p = place({ workArea, mouse: { x: 300, y: 300 }, barWidth });
    const frame = sessionFrame(p, workArea);
    for (const r of [p.bubble, p.bar, panelRect(p.panel, p.panel.maxHeight)]) {
      expect(inside(frame, r)).toBe(true);
    }
    expect(contains(frame, { x: p.bubble.x - 10, y: p.bubble.y - 10 })).toBe(true);
  });

  it("is clamped to the work area", () => {
    const p = place({ workArea, mouse: { x: 2, y: 2 }, barWidth });
    const w = sessionFrame(p, workArea);
    expect(w.x).toBe(0);
    expect(w.y).toBe(0);
  });
});

describe("selection avoidance", () => {
  it("keeps the bubble off a selection that sits under the default below-right spot", () => {
    const selection = { x: 200, y: 200, width: 120, height: 24 };
    const mouse = { x: 260, y: 212 };
    const p = place({ workArea, mouse, barWidth, selectionRect: selection });
    expect(intersect(p.bubble, selection).width * intersect(p.bubble, selection).height).toBe(0);
  });

  it("prefers growing the panel away from the selection when both directions fit", () => {
    // Bar would sit just below the selection; growing down would cover it — prefer up if room.
    const selection = { x: 400, y: 100, width: 200, height: 40 };
    const mouse = { x: 480, y: 130 };
    const p = place({ workArea, mouse, barWidth, selectionRect: selection });
    const panel = panelRect(p.panel, Math.min(200, p.panel.maxHeight));
    const downWouldHit =
      p.panel.direction === "down" && intersect(panel, selection).width * intersect(panel, selection).height > 0;
    expect(downWouldHit).toBe(false);
  });

  it("parks the OCR action bar below a large capture instead of centering on it", () => {
    // Mouse is the capture center (native OCR path); bar must not sit on the region.
    const selection = { x: 300, y: 200, width: 400, height: 220 };
    const mouse = { x: 500, y: 310 };
    const p = place({ workArea, mouse, barWidth, selectionRect: selection });
    expect(intersect(p.bar, selection).width * intersect(p.bar, selection).height).toBe(0);
    // Bar top may sit in the GAP above the bubble anchor; it must still clear the capture.
    expect(p.bar.y).toBeGreaterThanOrEqual(selection.y + selection.height);
  });

  it("never grows the panel over a selection near the bottom of the screen", () => {
    // Selected word just above the bottom edge: the bar sits under it, and growing up from the
    // bar's bottom edge would run straight over the word. The panel moves above it instead.
    for (const selection of [
      { x: 1186, y: 738, width: 37, height: 18 },
      { x: 1156, y: 763, width: 62, height: 18 },
      { x: 300, y: 700, width: 600, height: 60 },
    ]) {
      const mouse = { x: selection.x + selection.width / 2, y: selection.y + selection.height / 2 };
      const p = place({ workArea, mouse, barWidth, selectionRect: selection });
      const panel = panelRect(p.panel, p.panel.maxHeight);
      expect(intersect(panel, selection).width * intersect(panel, selection).height).toBe(0);
      expect(p.panel.maxHeight).toBeGreaterThanOrEqual(240);
    }
  });

  it("keeps the panel in place, growing from the bar, whenever that clears the selection", () => {
    const selection = { x: 400, y: 200, width: 60, height: 18 };
    const p = place({ workArea, mouse: { x: 430, y: 209 }, barWidth, selectionRect: selection });
    expect(p.panel.direction).toBe("down");
    expect(p.panel.anchorY).toBe(p.bar.y);
  });

  it("falls back to growing from the bar when the selection fills the screen", () => {
    const selection = { x: 20, y: 20, width: 1400, height: 835 };
    const p = place({ workArea, mouse: { x: 700, y: 400 }, barWidth, selectionRect: selection });
    expect(p.panel.maxHeight).toBeGreaterThan(0);
  });
});

describe("pointerLeftBubble", () => {
  const bubble = { x: 100, y: 400, width: BUBBLE_SIZE, height: BUBBLE_SIZE };

  it("is 150px from the bubble without a selection", () => {
    expect(pointerLeftBubble({ x: 114, y: 300 }, bubble, null)).toBe(false);
    expect(pointerLeftBubble({ x: 114, y: 200 }, bubble, null)).toBe(true);
  });

  it("does not count the pointer still over a tall selection as gone", () => {
    // Triple-clicked paragraph from y=200 to 390, bubble under its last line, pointer on line one.
    const selection = { x: 60, y: 200, width: 700, height: 190 };
    expect(pointerLeftBubble({ x: 120, y: 210 }, bubble, selection)).toBe(false);
    expect(pointerLeftBubble({ x: 700, y: 210 }, bubble, selection)).toBe(false);
    // Well away from both.
    expect(pointerLeftBubble({ x: 1100, y: 600 }, bubble, selection)).toBe(true);
  });
});
