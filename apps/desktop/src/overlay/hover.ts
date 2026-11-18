import type { Point } from "./types";

/**
 * WKWebView drops `:hover` while the panel window is resized under a still pointer (every
 * streamed chunk resizes it), and a window that never activates often gets no mouseenter at all,
 * so panel buttons also get `data-hover` from the native pointer.
 */
let hoveredButton: Element | null = null;
export function markPanelHover(v: Point | null) {
  const el = v ? (document.elementFromPoint(v.x, v.y)?.closest("button") ?? null) : null;
  if (el === hoveredButton) return;
  hoveredButton?.removeAttribute("data-hover");
  el?.setAttribute("data-hover", "");
  hoveredButton = el;
}
