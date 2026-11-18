import { inflate, intersect, type Point, type Rect, union } from "./types";

/** Sizes from CONTEXT.md (界面细则 / 结果面板). */
export const BUBBLE_SIZE = 28;
export const BAR_HEIGHT = 40;
export const PANEL_WIDTH = 420;
export const PANEL_MAX_HEIGHT = 480;
export const PANEL_MIN_HEIGHT = 96;
export const PANEL_HEADER_HEIGHT = 44;
/** Offset of the bubble from the mouse-up point, far enough to clear the cursor and the text under it. */
export const GAP = 14;
/** Distance kept from the work area edges. */
export const EDGE = 8;
/** Room around surfaces for the shadow. */
export const SHADOW_MARGIN = 24;
/** Extra room for the spring overshoot when growing (ADR 0001: 5–8%). */
export const OVERSHOOT = 0.08;
/** Below this much room under the bar, the panel grows upward instead. */
const MIN_ROOM_BELOW = 240;
/** CONTEXT.md 消失: how far the pointer may wander before the bubble fades. */
const AWAY_PX = 150;

export interface PanelPlacement {
  x: number;
  direction: "down" | "up";
  /** Top edge when growing down, bottom edge when growing up. */
  anchorY: number;
  maxHeight: number;
}

export interface Placement {
  bubble: Rect;
  bar: Rect;
  barDirection: "right" | "left";
  panel: PanelPlacement;
}

export interface PlacementInput {
  workArea: { width: number; height: number };
  mouse: Point;
  barWidth: number;
  /**
   * Selected text bounds in work-area coordinates. When present, prefer a bubble/bar/panel that
   * does not cover the selection (CONTEXT: 不压选区). Optional so callers without a rect keep the
   * old mouse-only placement.
   */
  selectionRect?: Rect | null;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

function overlapArea(a: Rect, b: Rect): number {
  const i = intersect(a, b);
  return i.width * i.height;
}

function placeBubble(W: number, H: number, mouse: Point, selection: Rect | null): Rect {
  // Default: below-right of the mouse (same as before). Extra candidates kick in near edges and
  // when a selection rect would otherwise be covered by the bubble.
  const candidates: Point[] = [
    { x: mouse.x + GAP, y: mouse.y + GAP },
    { x: mouse.x - GAP - BUBBLE_SIZE, y: mouse.y + GAP },
    { x: mouse.x + GAP, y: mouse.y - GAP - BUBBLE_SIZE },
    { x: mouse.x - GAP - BUBBLE_SIZE, y: mouse.y - GAP - BUBBLE_SIZE },
  ];
  if (selection) {
    const cx = clamp(mouse.x, selection.x, selection.x + Math.max(0, selection.width - 1));
    const cy = clamp(mouse.y, selection.y, selection.y + Math.max(0, selection.height - 1));
    // Prefer selection edges first (OCR / 不压选区): below → above → sides.
    candidates.unshift(
      { x: cx, y: selection.y + selection.height + GAP },
      { x: cx, y: selection.y - GAP - BUBBLE_SIZE },
      { x: selection.x + selection.width + GAP, y: cy },
      { x: selection.x - GAP - BUBBLE_SIZE, y: cy },
    );
  }

  let best: Rect | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    // Mirror the original edge flip: when the preferred below-right spot would leave the
    // work area, park the bubble on the opposite side of the mouse (not merely clamped).
    // Skip mouse-relative edge flips for selection-edge candidates so a large OCR region
    // does not yank the bubble back onto the capture center.
    let bx = c.x;
    let by = c.y;
    const fromSelection = selection != null && i < 4;
    if (!fromSelection) {
      if (bx + BUBBLE_SIZE > W - EDGE) bx = mouse.x - GAP - BUBBLE_SIZE;
      if (by + BAR_HEIGHT > H - EDGE) by = mouse.y - GAP - BUBBLE_SIZE;
    }
    const bubble = {
      x: clamp(bx, EDGE, W - EDGE - BUBBLE_SIZE),
      // Leave room for the taller bar below the bubble's top edge, so expanding never shifts it up.
      y: clamp(by, EDGE, H - EDGE - BAR_HEIGHT),
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
    };
    const hit = selection ? overlapArea(bubble, selection) : 0;
    // Prefer no overlap; then selection-edge rank; then closeness to preferred / mouse.
    const preferred = selection
      ? {
          x: clamp(mouse.x, selection.x, selection.x + Math.max(0, selection.width - 1)),
          y: selection.y + selection.height + GAP,
        }
      : { x: mouse.x + GAP, y: mouse.y + GAP };
    const score =
      hit * 1e6 +
      (fromSelection ? i * 500 : 5000) +
      Math.hypot(bubble.x - preferred.x, bubble.y - preferred.y) * 10 +
      Math.hypot(bubble.x - mouse.x, bubble.y - mouse.y);
    if (score < bestScore) {
      bestScore = score;
      best = bubble;
    }
  }
  return best!;
}

/** Prefer bar below the selection, then above, then sides — never centered on the capture. */
function placeBarNearSelection(W: number, H: number, barWidth: number, selection: Rect, mouse: Point): Rect {
  const preferredX = clamp(selection.x + selection.width / 2 - barWidth / 2, EDGE, W - EDGE - barWidth);
  const midY = clamp(selection.y + selection.height / 2 - BAR_HEIGHT / 2, EDGE, H - EDGE - BAR_HEIGHT);
  const candidates: { x: number; y: number; rank: number }[] = [
    { x: preferredX, y: selection.y + selection.height + GAP, rank: 0 },
    { x: preferredX, y: selection.y - GAP - BAR_HEIGHT, rank: 1 },
    { x: selection.x + selection.width + GAP, y: midY, rank: 2 },
    { x: selection.x - GAP - barWidth, y: midY, rank: 3 },
    {
      x: clamp(mouse.x - barWidth / 2, EDGE, W - EDGE - barWidth),
      y: selection.y + selection.height + GAP,
      rank: 4,
    },
    {
      x: clamp(mouse.x - barWidth / 2, EDGE, W - EDGE - barWidth),
      y: selection.y - GAP - BAR_HEIGHT,
      rank: 5,
    },
  ];

  let best: Rect | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const bar = {
      x: clamp(c.x, EDGE, W - EDGE - barWidth),
      y: clamp(c.y, EDGE, H - EDGE - BAR_HEIGHT),
      width: barWidth,
      height: BAR_HEIGHT,
    };
    const hit = overlapArea(bar, selection);
    const score = hit * 1e6 + c.rank * 1000;
    if (score < bestScore) {
      bestScore = score;
      best = bar;
    }
  }
  return best!;
}

export function place({ workArea, mouse, barWidth, selectionRect = null }: PlacementInput): Placement {
  const W = workArea.width;
  const H = workArea.height;
  const selection = selectionRect && selectionRect.width > 0 && selectionRect.height > 0 ? selectionRect : null;

  let bubble = placeBubble(W, H, mouse, selection);

  // The bar grows out of the bubble's top corner (top-left, or top-right when it grows left), so
  // the taller bar never jumps above the bubble's top edge.
  let barDirection: "right" | "left" = bubble.x + barWidth <= W - EDGE ? "right" : "left";
  let bar = {
    x: clamp(barDirection === "right" ? bubble.x : bubble.x + BUBBLE_SIZE - barWidth, EDGE, W - EDGE - barWidth),
    y: clamp(bubble.y, EDGE, H - EDGE - BAR_HEIGHT),
    width: barWidth,
    height: BAR_HEIGHT,
  };

  // OCR / large selections: if the bar still covers the capture (e.g. mouse was centered on it),
  // park the bar below/above/beside the rect and re-anchor the bubble for morph consistency.
  if (selection && overlapArea(bar, selection) > 0) {
    bar = placeBarNearSelection(W, H, barWidth, selection, mouse);
    barDirection = bar.x + barWidth / 2 <= W / 2 ? "right" : "left";
    const bubbleX =
      barDirection === "right"
        ? clamp(bar.x, EDGE, W - EDGE - BUBBLE_SIZE)
        : clamp(bar.x + barWidth - BUBBLE_SIZE, EDGE, W - EDGE - BUBBLE_SIZE);
    bubble = {
      x: bubbleX,
      y: clamp(bar.y, EDGE, H - EDGE - BUBBLE_SIZE),
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
    };
  }

  const panelX = clamp(
    bar.x + PANEL_WIDTH <= W - EDGE ? bar.x : bar.x + bar.width - PANEL_WIDTH,
    EDGE,
    W - EDGE - PANEL_WIDTH,
  );
  // The panel morphs out of the bar in place: it keeps the bar's top edge when it grows down and
  // its bottom edge when it grows up, so the surface does not move when an action is picked.
  const downFrom = (top: number): PanelPlacement => ({
    x: panelX,
    direction: "down",
    anchorY: top,
    maxHeight: Math.min(PANEL_MAX_HEIGHT, H - EDGE - top),
  });
  const upFrom = (bottom: number): PanelPlacement => ({
    x: panelX,
    direction: "up",
    anchorY: bottom,
    maxHeight: Math.min(PANEL_MAX_HEIGHT, bottom - EDGE),
  });
  const down = downFrom(bar.y);
  const up = upFrom(bar.y + bar.height);
  const roomy = (p: PanelPlacement) => p.maxHeight >= MIN_ROOM_BELOW;
  const inPlace = roomy(down) || down.maxHeight >= up.maxHeight ? down : up;

  let panel = inPlace;
  if (selection) {
    // CONTEXT.md 放置: the panel never covers the selection. In place when it can; otherwise it
    // moves past the selection as a whole (the morph carries it there) rather than grow over it.
    const covers = (p: PanelPlacement) => overlapArea(panelRect(p, p.maxHeight), selection) > 0;
    const candidates = [
      down,
      up,
      ...(covers(down) ? [downFrom(Math.max(bar.y, selection.y + selection.height + GAP))] : []),
      ...(covers(up) ? [upFrom(Math.min(bar.y + bar.height, selection.y - GAP))] : []),
    ].filter((p) => !covers(p) && p.maxHeight >= PANEL_MIN_HEIGHT);
    const best =
      candidates.find(roomy) ??
      candidates.reduce<PanelPlacement | null>((a, p) => (!a || p.maxHeight > a.maxHeight ? p : a), null);
    // A selection too big to get around (most of the screen) keeps the in-place panel.
    if (best) panel = best;
  }

  return { bubble, bar, barDirection, panel };
}

/**
 * CONTEXT.md 消失: the bubble fades once the pointer is about 150px from it. The bubble can sit at
 * the far edge of a tall selection (a triple-clicked paragraph, a bottom-up drag), so the pointer
 * still over its own selection has not left.
 */
export function pointerLeftBubble(p: Point, bubble: Rect, selection: Rect | null): boolean {
  const fromBubble = Math.hypot(p.x - (bubble.x + bubble.width / 2), p.y - (bubble.y + bubble.height / 2));
  if (fromBubble <= AWAY_PX) return false;
  return !selection || distanceToRect(p, selection) > AWAY_PX;
}

function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

export function panelRect(p: PanelPlacement, height: number): Rect {
  const h = Math.min(height, p.maxHeight);
  return {
    x: p.x,
    y: p.direction === "down" ? p.anchorY : p.anchorY - h,
    width: PANEL_WIDTH,
    height: h,
  };
}

/**
 * The overlay window for a session: covers every surface the session can grow into, plus the
 * shadow and the spring overshoot, clamped to the work area (ADR 0001).
 */
export function sessionFrame(p: Placement, workArea: { width: number; height: number }): Rect {
  const all = [p.bubble, p.bar, panelRect(p.panel, p.panel.maxHeight)].reduce(union);
  const margin = SHADOW_MARGIN + Math.ceil(Math.max(all.width, all.height) * OVERSHOOT);
  const screen = { x: 0, y: 0, width: workArea.width, height: workArea.height };
  return intersect(inflate(all, margin), screen);
}
