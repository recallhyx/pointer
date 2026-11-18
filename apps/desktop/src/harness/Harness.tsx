import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { UiLanguage } from "@/i18n";
import type { Bridge } from "@/overlay/bridge";
import { createBrowserPinHost } from "@/overlay/pins";
import { Overlay } from "@/overlay/Overlay";
import type { DismissPayload, EnvPayload, Point, Rect, ShowPayload } from "@/overlay/types";
import "./harness.css";

class Emitter<T> {
  private listeners = new Set<(p: T) => void>();
  on = (cb: (p: T) => void) => {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  };
  emit(p: T) {
    this.listeners.forEach((cb) => cb(p));
  }
}

interface WindowState {
  frame: Rect;
  hit: Rect | null;
  visible: boolean;
}

interface Settings {
  outline: boolean;
  autoDismiss: boolean;
  /** The overlay's interface language, as in the real settings. */
  uiLanguage: UiLanguage;
}

const CONTEXT_CHARS = 300;

/** Reads the selection the way the native side would: text, bounds and surrounding context. */
function readSelection(origin: Point) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const range = sel.getRangeAt(0);
  const block =
    (range.commonAncestorContainer as Element).closest?.("p, li, pre") ??
    range.commonAncestorContainer.parentElement?.closest("p, li, pre");
  let before: string | null = null;
  let after: string | null = null;
  if (block) {
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    before = pre.toString().slice(-CONTEXT_CHARS) || null;
    const post = document.createRange();
    post.selectNodeContents(block);
    post.setStart(range.endContainer, range.endOffset);
    after = post.toString().slice(0, CONTEXT_CHARS) || null;
  }
  const r = range.getBoundingClientRect();
  const app = (range.startContainer.parentElement?.closest("[data-app]") as HTMLElement | null)?.dataset;
  return {
    text,
    before,
    after,
    rect: r.width || r.height ? { x: r.left - origin.x, y: r.top - origin.y, width: r.width, height: r.height } : null,
    app,
  };
}

export function Harness() {
  const [settings, setSettings] = useState<Settings>({
    outline: true,
    autoDismiss: true,
    uiLanguage: "system",
  });
  const [win, setWin] = useState<WindowState>({
    frame: { x: 0, y: 0, width: 0, height: 0 },
    hit: null,
    visible: false,
  });
  const [stats, setStats] = useState({ latency: null as number | null, sessions: 0 });

  const desktopRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const state = useRef({
    session: 0,
    visible: false,
    /** Mirrors the native 驻留 rules: outside clicks and new selections are ignored. */
    engaged: false,
    mouseUpAt: 0,
    down: null as Point | null,
    pointer: { x: 0, y: 0 },
  });

  const emitters = useMemo(
    () => ({
      show: new Emitter<ShowPayload>(),
      env: new Emitter<EnvPayload>(),
      pointer: new Emitter<Point>(),
      dismiss: new Emitter<DismissPayload>(),
      wheel: new Emitter<number>(),
    }),
    [],
  );

  const origin = (): Point => {
    const r = desktopRef.current!.getBoundingClientRect();
    return { x: r.left, y: r.top };
  };

  const pinHost = useMemo(() => createBrowserPinHost(), []);

  const bridge = useMemo<Bridge>(() => {
    const check = (session: number) => {
      if (session !== state.current.session) throw new Error(`stale session ${session}`);
    };
    return {
      onShow: emitters.show.on,
      onEnv: emitters.env.on,
      onPointer: emitters.pointer.on,
      onDismiss: emitters.dismiss.on,
      onWheel: emitters.wheel.on,
      toViewport: (p) => {
        const o = origin();
        return { x: p.x + o.x, y: p.y + o.y };
      },
      fromViewport: (p) => {
        const o = origin();
        return { x: p.x - o.x, y: p.y - o.y };
      },
      present: async (session, frame, hit) => {
        check(session);
        state.current.visible = true;
        flushSync(() => setWin({ frame, hit, visible: true }));
      },
      setHit: async (session, hit) => {
        check(session);
        setWin((w) => ({ ...w, hit }));
      },
      setFrame: async (session, frame) => {
        check(session);
        setWin((w) => ({ ...w, frame }));
      },
      painted: async (session) => {
        if (session !== state.current.session) return null;
        const latency = Math.round((performance.now() - state.current.mouseUpAt) * 10) / 10;
        setStats((s) => ({ ...s, latency }));
        return latency;
      },
      hide: async (session) => {
        if (session !== state.current.session) return;
        state.current.visible = false;
        state.current.engaged = false;
        setWin((w) => ({ ...w, visible: false, hit: null }));
      },
      engage: async (session) => {
        check(session);
        state.current.engaged = true;
      },
      copy: (text) => navigator.clipboard.writeText(text).catch(() => {}),
      openUrl: async (url) => void window.open(url, "_blank", "noopener"),
      openSettings: async (page) => void window.open(page ? `#settings?page=${page}` : "#settings", "_blank"),
    };
  }, [emitters]);

  useEffect(() => {
    const st = state.current;
    const workArea = () => {
      const r = desktopRef.current!.getBoundingClientRect();
      return { width: r.width, height: r.height };
    };
    const onOverlay = (t: EventTarget | null) => t instanceof Element && !!t.closest(".surface-group, .surface");
    const inDesktop = (t: EventTarget | null) => t instanceof Element && !!t.closest(".desktop");

    const capture = (trigger: "auto" | "shortcut", gesture: string, at: Point) => {
      const sel = readSelection(origin());
      if (!sel) return;
      const session = ++st.session;
      setStats((s) => ({ ...s, latency: null, sessions: s.sessions + 1 }));
      const appName = sel.app?.app ?? null;
      emitters.show.emit({
        session,
        trigger,
        gesture,
        uiLanguage: settingsRef.current.uiLanguage,
        pointerEvents: true,
        platform: "browser",
        workArea: workArea(),
        mouse: at,
        selectionRect: sel.rect,
        text: sel.text,
        contextBefore: sel.before,
        contextAfter: sel.after,
        app: { name: appName, id: null },
        captureMs: Math.round((performance.now() - st.mouseUpAt) * 10) / 10,
        method: "dom-selection",
      });
      const started = performance.now();
      setTimeout(() => {
        if (session !== st.session) return;
        emitters.env.emit({
          session,
          environment: {
            appName,
            windowTitle: sel.app?.title ?? null,
            url: sel.app?.url ?? null,
            documentName: sel.app?.document ?? null,
          },
          envMs: Math.round((performance.now() - started) * 10) / 10,
        });
      }, 30);
    };

    const toWorkArea = (e: MouseEvent): Point => {
      const o = origin();
      return { x: e.clientX - o.x, y: e.clientY - o.y };
    };

    const onPointerDown = (e: PointerEvent) => {
      const p = toWorkArea(e);
      st.down = onOverlay(e.target) || st.engaged ? null : p;
      if (st.visible && !st.engaged && !onOverlay(e.target))
        emitters.dismiss.emit({ session: st.session, reason: "outside" });
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || onOverlay(e.target) || !inDesktop(e.target) || !st.down) return;
      const p = toWorkArea(e);
      const moved = Math.hypot(p.x - st.down.x, p.y - st.down.y) >= 5;
      const gesture =
        e.detail >= 3 ? "triple" : e.detail === 2 ? "double" : e.shiftKey ? "shift" : moved ? "drag" : null;
      st.down = null;
      if (!gesture) return;
      st.mouseUpAt = performance.now();
      setTimeout(() => capture("auto", gesture, p), 0);
    };
    const onPointerMove = (e: PointerEvent) => {
      st.pointer = toWorkArea(e);
      if (st.visible) emitters.pointer.emit(st.pointer);
    };
    const onWheel = () => {
      if (st.visible) emitters.wheel.emit(st.session);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && st.visible && !st.engaged)
        emitters.dismiss.emit({ session: st.session, reason: "escape" });
      if (e.altKey && e.code === "Backquote" && !st.engaged) {
        e.preventDefault();
        st.mouseUpAt = performance.now();
        capture("shortcut", "shortcut", st.pointer);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [emitters]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const f = win.frame;

  return (
    <div className="harness">
      <header className="toolbar">
        <strong>点拨 · 浏览器演示</strong>
        <label>
          界面语言
          <select value={settings.uiLanguage} onChange={(e) => set("uiLanguage", e.target.value as UiLanguage)}>
            <option value="system">跟随系统</option>
            <option value="zh">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={settings.outline} onChange={(e) => set("outline", e.target.checked)} />
          显示窗口边界
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.autoDismiss}
            onChange={(e) => set("autoDismiss", e.target.checked)}
          />
          气泡自动消失
        </label>
        <a className="settings-link" href="#settings" target="_blank" rel="noreferrer">
          模型设置
        </a>
        <span className="stats">
          出现 {stats.latency != null ? `${stats.latency}ms` : "—"} · 窗口 {Math.round(f.width)}×{Math.round(f.height)}
        </span>
      </header>

      <div className="desktop" ref={desktopRef}>
        <article
          className="app-window browser"
          data-app="Safari"
          data-title="What is Ownership? - The Rust Programming Language"
          data-url="https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html"
        >
          <div className="titlebar">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            <span className="address">doc.rust-lang.org/book/ch04-01-what-is-ownership.html</span>
          </div>
          <div className="page">
            <h1>What is Ownership?</h1>
            <p>
              <em>Ownership</em> is a set of rules that govern how a Rust program manages memory. All programs have to
              manage the way they use a computer's memory while running. Some languages have garbage collection that
              regularly looks for no-longer-used memory as the program runs; in other languages, the programmer must
              explicitly allocate and free the memory.
            </p>
            <p>
              Rust uses a third approach: memory is managed through a system of ownership with a set of rules that the
              compiler checks. If any of the rules are violated, the program won't compile. None of the features of
              ownership will slow down your program while it's running.
            </p>
            <p>
              我们把创建一个引用的行为称为<strong>借用</strong>
              （borrowing）。正如现实生活中，如果一个人拥有某样东西，你可以从他那里借来。当你使用完毕，必须还回去。我们并不拥有它。
            </p>
            <p>所有権は、Rustのプログラムがメモリをどのように管理するかを支配する一連の規則です。</p>
            <pre>{`let s1 = String::from("hello");
let s2 = s1;          // s1 is moved into s2
println!("{s1}");     // error[E0382]: borrow of moved value`}</pre>
          </div>
        </article>

        <article className="app-window notes" data-app="备忘录" data-title="读书笔记">
          <div className="titlebar">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            <span className="address">备忘录 — 读书笔记</span>
          </div>
          <div className="page">
            <p>贴着屏幕右下角，用来检查气泡、操作栏和面板在边缘处的翻转。</p>
            <p>The panel never covers the selection; near the bottom it opens upward instead.</p>
          </div>
        </article>

        <div
          className={`sim-window ${settings.outline ? "outlined" : ""}`}
          style={{
            left: f.x,
            top: f.y,
            width: f.width,
            height: f.height,
            visibility: win.visible ? "visible" : "hidden",
          }}
        >
          <Overlay bridge={bridge} pins={pinHost} autoDismiss={settings.autoDismiss} />
        </div>
        {settings.outline && win.visible && win.hit && (
          <div
            className="sim-hit"
            style={{ left: win.hit.x, top: win.hit.y, width: win.hit.width, height: win.hit.height }}
          />
        )}
        {/* Screen-level host so OCR lightbox covers the desktop, not the small sim-window. */}
        <div id="ocr-lightbox-screen-host" className="overlay-lightbox-host" />
      </div>
    </div>
  );
}
