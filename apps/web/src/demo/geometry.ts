/**
 * Placement for the in-page overlay, in page coordinates (the overlay scrolls with the article).
 * Sizes mirror apps/desktop/src/overlay/placement.ts so the demo matches the app. The page can
 * scroll, so unlike the desktop the panel never has to move above the selection.
 */

export const BUBBLE_SIZE = 28;
export const BAR_HEIGHT = 40;
export const PANEL_WIDTH = 420;
export const PANEL_MAX_HEIGHT = 480;
/** Bubble offset from the mouse-up point (CONTEXT.md 放置). */
export const GAP = 14;
/** Minimum distance from the viewport edges. */
export const MARGIN = 12;

export interface Point {
  x: number;
  y: number;
}

/** A surface frame: position, size and corner radius. */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** Horizontal extent of the visible page area, in page coordinates. */
export interface Span {
  left: number;
  width: number;
}

/** Which way the bar grew out of the bubble; the panel keeps the same leading edge. */
export type Direction = "right" | "left";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const right = (view: Span) => view.left + view.width - MARGIN;

export function bubbleFrame(mouse: Point, view: Span): Frame {
  const x = clamp(mouse.x + GAP, view.left + MARGIN, right(view) - BUBBLE_SIZE);
  return { x, y: mouse.y + GAP, w: BUBBLE_SIZE, h: BUBBLE_SIZE, r: BUBBLE_SIZE / 2 };
}

/**
 * The bar grows right out of the bubble's top-left corner, or left from its top-right corner when
 * the right side has no room. Sharing the bubble's top edge keeps the taller bar from jumping up.
 */
export function barFrame(bubble: Frame, width: number, view: Span): { frame: Frame; dir: Direction } {
  const frame = (x: number) => ({ x, y: bubble.y, w: width, h: BAR_HEIGHT, r: BAR_HEIGHT / 2 });
  if (bubble.x + width <= right(view)) return { frame: frame(bubble.x), dir: "right" };
  return { frame: frame(Math.max(bubble.x + bubble.w - width, view.left + MARGIN)), dir: "left" };
}

export function panelWidth(view: Span): number {
  return Math.min(PANEL_WIDTH, view.width - 2 * MARGIN);
}

/** The panel starts below the selection's bottom, so it never covers what was selected. */
export function panelFrame(bar: Frame, dir: Direction, height: number, selectionBottom: number, view: Span): Frame {
  const w = panelWidth(view);
  const x = clamp(dir === "right" ? bar.x : bar.x + bar.w - w, view.left + MARGIN, right(view) - w);
  const y = Math.max(bar.y, selectionBottom + 6);
  return { x, y, w, h: Math.min(height, PANEL_MAX_HEIGHT), r: 12 };
}

/** The local-action check: the surface shrinks back to a bubble where the bar started. */
export function doneFrame(bar: Frame, dir: Direction): Frame {
  const x = dir === "right" ? bar.x : bar.x + bar.w - BUBBLE_SIZE;
  return { x, y: bar.y, w: BUBBLE_SIZE, h: BUBBLE_SIZE, r: BUBBLE_SIZE / 2 };
}
