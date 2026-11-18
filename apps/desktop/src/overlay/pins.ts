/**
 * 固定浮层: a pinned panel lives in its own window. The overlay hands it the session and, if an
 * answer is still streaming, keeps that request running and relays it (cumulative snapshots, so
 * a late or dropped event can never lose text).
 */
import type { Session } from "./session";
import type { Answer } from "./useAnswer";
import type { Point, Rect } from "./types";
import { afterFrames } from "@/lib/frames";

type Unlisten = () => void;

export const PIN_LIMIT = 5;
export const PIN_HINT_MS = 2200;

export interface PinInit {
  session: Session;
  answer: Answer | null;
  /** The overlay still runs the request and will relay it. */
  relaying: boolean;
  /** The panel as the user left it, so the new window looks exactly like the old one. */
  scrollTop?: number;
  draft?: string;
  /** The follow-up input had the caret: it keeps it in the new window. */
  focus?: boolean;
}

/** The overlay's side. */
export interface PinHost {
  /** Native code has already hidden the old window when onShown arrives. */
  nativeHandoff?: boolean;
  /** Creates the pinned window, hidden until its page paints. Rejects with "limit" at {@link PIN_LIMIT}. */
  open(session: number, surface: Rect, maxHeight: number, init: PinInit): Promise<string>;
  /** The pinned window is on screen, so the overlay can disappear without a gap. */
  onShown(cb: (label: string) => void): Unlisten;
  /** A pinned page is listening and wants the current snapshot. */
  onHello(cb: (label: string) => void): Unlisten;
  /** A pinned page stopped (or closed) its relayed request. */
  onStop(cb: (label: string) => void): Unlisten;
  onClosed(cb: (label: string) => void): Unlisten;
  /** Cancel a window that has not completed the handoff; never closes a completed pin. */
  cancel(label: string): Promise<void>;
  send(label: string, answer: Answer): void;
}

/** The pinned window's side. */
export interface PinnedBridge {
  init(): Promise<PinInit | null>;
  show(): Promise<void>;
  /** Acknowledges frames painted after show; only then may the old panel disappear. */
  painted(): Promise<void>;
  /** Height of the surface in logical pixels; the window keeps a shadow margin around it. */
  resize(height: number): Promise<void>;
  /** The pointer went down on the header: the native side moves the window until it goes up. */
  drag(): Promise<void>;
  engage(): Promise<void>;
  /** Toggle persistence in the same window without losing the conversation. */
  setFixed(fixed: boolean): Promise<void>;
  close(): Promise<void>;
  onDismiss(cb: () => void): Unlisten;
  hello(): void;
  stop(): void;
  onAnswer(cb: (a: Answer) => void): Unlisten;
  /** Native pointer in viewport coordinates, null once it leaves (the window never activates). */
  onPointer(cb: (p: Point | null) => void): Unlisten;
  copy(text: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  openSettings(page?: string): Promise<void>;
}

/** Margin around the surface inside a pinned window, in logical pixels (matches `PIN_MARGIN`). */
export const PIN_MARGIN = 16;

/** Lay out the masked window, then let native code reveal it and hide the old window together. */
export function presentPinned(
  bridge: PinnedBridge,
  onShown: () => void,
  onError: (e: unknown) => void,
  onPresented: () => void = () => {},
): Unlisten {
  let cancelled = false;
  const failed = (e: unknown) => {
    if (cancelled) return;
    cancelled = true;
    cancelFrames();
    onError(e);
    void bridge.close().catch(onError);
  };
  let cancelFrames = afterFrames(2, () => {
    void bridge
      .show()
      .then(() => {
        if (cancelled) return;
        cancelFrames = afterFrames(
          2,
          () => {
            onShown();
            cancelFrames = afterFrames(
              2,
              () => {
                void bridge
                  .painted()
                  .then(() => {
                    if (!cancelled) onPresented();
                  })
                  .catch(failed);
              },
              null,
            );
          },
          null,
        );
      })
      .catch(failed);
  });
  return () => {
    cancelled = true;
    cancelFrames();
  };
}

/** What a panel being pinned hands over besides its answer: scroll position and unsent text. */
export function readPanelState(): { scrollTop: number; draft: string } {
  return {
    scrollTop: document.querySelector<HTMLElement>(".panel-body")?.scrollTop ?? 0,
    draft: document.querySelector<HTMLTextAreaElement>(".follow-up-input")?.value ?? "",
  };
}

export function isLimitError(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)) === "limit";
}

async function tauriEvents() {
  const [{ listen, emitTo }, { invoke }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/core"),
  ]);
  /**
   * Tauri's `listen` defaults to `{ kind: "Any" }`, which receives events emitted to every
   * window. Pin answer/pointer must be scoped to this window's label or every pinned panel
   * would share one stream.
   */
  const on = <T>(event: string, target: string, cb: (p: T) => void): Unlisten => {
    let unlisten: Unlisten | null = null;
    let cancelled = false;
    void listen<T>(event, (e) => cb(e.payload), { target }).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  };
  return { on, emitTo, invoke };
}

export async function createTauriPinHost(): Promise<PinHost> {
  const { on, emitTo, invoke } = await tauriEvents();
  return {
    nativeHandoff: true,
    open: (session, surface, maxHeight, init) =>
      invoke<string>("pin_open", {
        session,
        surface,
        maxHeight,
        direction: init.session.placement.panel.direction,
        init,
      }),
    onShown: (cb) => on("pin://shown", "overlay", cb),
    onHello: (cb) => on("pin://hello", "overlay", cb),
    onStop: (cb) => on("pin://stop", "overlay", cb),
    onClosed: (cb) => on("pin://closed", "overlay", cb),
    cancel: (label) => invoke("pin_cancel", { label }),
    send: (label, answer) => void emitTo(label, "pin://answer", answer).catch(() => {}),
  };
}

export async function createTauriPinnedBridge(label: string): Promise<PinnedBridge> {
  const { on, emitTo, invoke } = await tauriEvents();
  const [{ writeText }, { openUrl }] = await Promise.all([
    import("@tauri-apps/plugin-clipboard-manager"),
    import("@tauri-apps/plugin-opener"),
  ]);
  return {
    init: () => invoke<PinInit | null>("pin_init"),
    show: () => invoke("pin_show"),
    painted: () => invoke("pin_painted"),
    resize: (height) => invoke("pin_resize", { height }),
    drag: () => invoke("pin_drag"),
    engage: () => invoke("pin_engage"),
    setFixed: (fixed) => invoke("pin_set_fixed", { fixed }),
    close: () => invoke("pin_close"),
    onDismiss: (cb) => on("pin://dismiss", label, cb),
    hello: () => void emitTo("overlay", "pin://hello", label).catch(() => {}),
    stop: () => void emitTo("overlay", "pin://stop", label).catch(() => {}),
    onAnswer: (cb) => on("pin://answer", label, cb),
    onPointer: (cb) => on("pin://pointer", label, cb),
    copy: (text) => writeText(text),
    openUrl: (url) => openUrl(url),
    openSettings: (page) => invoke("open_settings", { page: page ?? null }),
  };
}

/**
 * The browser harness: a pinned panel is a popup page and messages go over a BroadcastChannel.
 * Only for checking the flow and the visuals; positioning and dragging are native-only.
 */
const CHANNEL = "pointer-pins";
type Message =
  | { type: "shown" | "hello" | "stop" | "close" | "unpin" | "repin"; label: string }
  | { type: "answer"; label: string; answer: Answer };

export function createBrowserPinHost(): PinHost {
  const channel = new BroadcastChannel(CHANNEL);
  const open = new Set<string>();
  const windows = new Map<string, Window>();
  const shown = new Set<string>();
  const closedListeners = new Set<(label: string) => void>();
  let next = 0;
  const on = (type: Message["type"], cb: (label: string) => void): Unlisten => {
    const handler = (e: MessageEvent<Message>) => e.data.type === type && cb(e.data.label);
    channel.addEventListener("message", handler);
    return () => channel.removeEventListener("message", handler);
  };
  on("close", (label) => {
    open.delete(label);
    windows.delete(label);
    shown.delete(label);
    closedListeners.forEach((cb) => cb(label));
  });
  on("shown", (label) => shown.add(label));
  on("unpin", (label) => open.delete(label));
  on("repin", (label) => open.add(label));
  return {
    open: async (_session, surface, maxHeight, init) => {
      if (open.size >= PIN_LIMIT) throw new Error("limit");
      const label = `pinned-${Date.now()}-${++next}`;
      open.add(label);
      localStorage.setItem(`pin:${label}`, JSON.stringify(init));
      const popup = window.open(
        `#${label}`,
        label,
        `popup,width=${surface.width + PIN_MARGIN * 2},height=${Math.max(surface.height, maxHeight) + PIN_MARGIN * 2}`,
      );
      if (!popup) {
        open.delete(label);
        localStorage.removeItem(`pin:${label}`);
        throw new Error("popup-blocked");
      }
      windows.set(label, popup);
      return label;
    },
    onShown: (cb) => on("shown", cb),
    onHello: (cb) => on("hello", cb),
    onStop: (cb) => on("stop", cb),
    onClosed: (cb) => {
      closedListeners.add(cb);
      return () => void closedListeners.delete(cb);
    },
    cancel: async (label) => {
      if (shown.has(label)) return;
      windows.get(label)?.close();
      windows.delete(label);
      open.delete(label);
      localStorage.removeItem(`pin:${label}`);
      closedListeners.forEach((cb) => cb(label));
      channel.postMessage({ type: "close", label } satisfies Message);
    },
    send: (label, answer) => channel.postMessage({ type: "answer", label, answer } satisfies Message),
  };
}

export function createBrowserPinnedBridge(label: string): PinnedBridge {
  const channel = new BroadcastChannel(CHANNEL);
  const post = (type: "shown" | "hello" | "stop" | "close" | "unpin" | "repin") =>
    channel.postMessage({ type, label } satisfies Message);
  let fixed = true;
  let engaged = false;
  return {
    init: async () => {
      const raw = localStorage.getItem(`pin:${label}`);
      localStorage.removeItem(`pin:${label}`);
      return raw ? (JSON.parse(raw) as PinInit) : null;
    },
    show: async () => {},
    painted: async () => post("shown"),
    resize: async () => {},
    drag: async () => {},
    engage: async () => {
      engaged = true;
    },
    setFixed: async (value) => {
      fixed = value;
      post(value ? "repin" : "unpin");
    },
    onDismiss: (cb) => {
      const outside = (e: PointerEvent) => {
        if (!fixed && !engaged && !(e.target as Element | null)?.closest(".surface")) cb();
      };
      const blur = () => {
        if (!fixed && !engaged) cb();
      };
      window.addEventListener("pointerdown", outside);
      window.addEventListener("blur", blur);
      return () => {
        window.removeEventListener("pointerdown", outside);
        window.removeEventListener("blur", blur);
      };
    },
    close: async () => {
      post("close");
      window.close();
    },
    hello: () => post("hello"),
    stop: () => post("stop"),
    onAnswer: (cb) => {
      const handler = (e: MessageEvent<Message>) => {
        if (e.data.type === "answer" && e.data.label === label) cb(e.data.answer);
      };
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
    onPointer: () => () => {},
    copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
    openUrl: async (url) => void window.open(url, "_blank", "noopener"),
    openSettings: async (page) => void window.open(page ? `#settings?page=${page}` : "#settings", "_blank"),
  };
}
