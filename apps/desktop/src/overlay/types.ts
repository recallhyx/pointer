export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sent by the native side when a selection was captured. Coordinates are logical pixels
 * relative to the top-left of the work area of the display under the mouse. */
export interface ShowPayload {
  session: number;
  trigger: "auto" | "shortcut";
  gesture: string;
  /** The `uiLanguage` setting: `zh`, `en`, `ja`, `ko`, `es`, `fr` or `system`. Sent along so the first frame is already translated. */
  uiLanguage: string;
  /** Whether pointer moves outside the window are reported (false on the Linux stub). */
  pointerEvents: boolean;
  platform: string;
  workArea: { width: number; height: number };
  mouse: Point;
  selectionRect: Rect | null;
  text: string;
  contextBefore: string | null;
  contextAfter: string | null;
  app: { name: string | null; id: string | null };
  captureMs: number;
  method: string;
  /** Cropped OCR screenshot as a data URL; omitted for non-OCR captures. */
  ocrImage?: string | null;
}

export interface Environment {
  appName: string | null;
  windowTitle: string | null;
  url: string | null;
  documentName: string | null;
}

export interface EnvPayload {
  session: number;
  environment: Environment;
  envMs: number;
}

export interface DismissPayload {
  session: number;
  reason: "outside" | "escape";
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

export function contains(r: Rect, p: Point, slack = 0): boolean {
  return p.x >= r.x - slack && p.x < r.x + r.width + slack && p.y >= r.y - slack && p.y < r.y + r.height + slack;
}

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function roundRect(r: Rect): Rect {
  const x = Math.floor(r.x);
  const y = Math.floor(r.y);
  return { x, y, width: Math.ceil(r.x + r.width) - x, height: Math.ceil(r.y + r.height) - y };
}
