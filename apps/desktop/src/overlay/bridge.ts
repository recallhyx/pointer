import type { DismissPayload, EnvPayload, Point, Rect, ShowPayload } from "./types";

type Unlisten = () => void;

/** What the overlay needs from its host: the Tauri app, or the browser harness. */
export interface Bridge {
  onShow(cb: (p: ShowPayload) => void): Unlisten;
  onEnv(cb: (p: EnvPayload) => void): Unlisten;
  /** Pointer position in work-area coordinates, including outside the window. */
  onPointer(cb: (p: Point) => void): Unlisten;
  onDismiss(cb: (p: DismissPayload) => void): Unlisten;
  onWheel(cb: (session: number) => void): Unlisten;
  /** Converts a work-area point into this document's viewport coordinates. */
  toViewport(p: Point, frame: Rect): Point;
  fromViewport(p: Point, frame: Rect): Point;
  present(session: number, frame: Rect, hit: Rect): Promise<void>;
  setHit(session: number, hit: Rect): Promise<void>;
  /** Resize the overlay window without resetting engage. */
  setFrame(session: number, frame: Rect): Promise<void>;
  /** Returns the show latency in ms measured from mouse-up, when known. */
  painted(session: number): Promise<number | null>;
  hide(session: number): Promise<void>;
  /** Takes keyboard focus for the follow-up input and enters 驻留 (ADR 0002). */
  engage(session: number): Promise<void>;
  copy(text: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  /** Optional settings page id (`models`, `trigger`, …). */
  openSettings(page?: string): Promise<void>;
}

export async function createTauriBridge(): Promise<Bridge> {
  const [{ listen }, { invoke }, { writeText }, { openUrl }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
    import("@tauri-apps/plugin-clipboard-manager"),
    import("@tauri-apps/plugin-opener"),
  ]);

  // Scope to this window. `listen` defaults to Any and would also see pin://* emitTos.
  const on = <T>(event: string, cb: (p: T) => void): Unlisten => {
    let unlisten: Unlisten | null = null;
    let cancelled = false;
    listen<T>(event, (e) => cb(e.payload), { target: "overlay" }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  };

  return {
    onShow: (cb) => on("overlay://show", cb),
    onEnv: (cb) => on("overlay://env", cb),
    onPointer: (cb) => on("overlay://pointer", cb),
    onDismiss: (cb) => on("overlay://dismiss", cb),
    onWheel: (cb) => on("overlay://wheel", cb),
    toViewport: (p, frame) => ({ x: p.x - frame.x, y: p.y - frame.y }),
    fromViewport: (p, frame) => ({ x: p.x + frame.x, y: p.y + frame.y }),
    present: (session, frame, hit) => invoke("overlay_present", { session, frame, hit }),
    setHit: (session, hit) => invoke("overlay_set_hit", { session, hit }),
    setFrame: (session, frame) => invoke("overlay_set_frame", { session, frame }),
    painted: (session) => invoke<number | null>("overlay_painted", { session }),
    hide: (session) => invoke("overlay_hide", { session }),
    engage: (session) => invoke("overlay_engage", { session }),
    copy: (text) => writeText(text),
    openUrl: (url) => openUrl(url),
    openSettings: (page) => invoke("open_settings", { page: page ?? null }),
  };
}
