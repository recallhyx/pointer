import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type Transition,
  type Variants,
} from "motion/react";

import { CARD_COLLAPSE, CARD_ENTER, CARD_EXPAND, CARD_GROW, CARD_LEAVE, FADE, FADE_QUICK } from "@/components/motion";
import { resolveLocale, setLocale } from "@/i18n";
import { afterFrames } from "@/lib/frames";
import { detectLanguage, translationTarget } from "@/llm/language";
import { secondLanguage, userLanguage } from "@/llm/prepare";
import { DEFAULT_SETTINGS, loadSettings, type Settings } from "@/shared/settings";
import { searchUrl } from "@/shared/search";
import { actionById, type ActionId } from "./actions";
import type { Bridge } from "./bridge";
import { BarFace, BubbleFace, CheckFace, PanelFace } from "./faces";
import { markPanelHover } from "./hover";
import { isLimitError, PIN_HINT_MS, readPanelState, type PinHost, type PinInit } from "./pins";
import { BAR_HEIGHT, PANEL_MIN_HEIGHT, PANEL_WIDTH, panelRect, place, pointerLeftBubble } from "./placement";
import { requestAnswer } from "./requestAnswer";
import {
  initialSession,
  morphStep,
  panelHeightFor,
  surfaceRadius,
  surfaceRect,
  type Phase,
  type Session,
} from "./session";
import { contains, union, type Point, type ShowPayload } from "./types";
import { isAnswering, useAnswer, type Answer, type DetachedAnswer, type StartAnswer } from "./useAnswer";
import { useOverlayTimers } from "./useOverlayTimers";
import { useSessionStore } from "./useSessionStore";
import { useWindowFrame } from "./useWindowFrame";

/** CONTEXT.md 消失 / 展开. */
const DWELL_MS = 150;
const IDLE_MS = 3000;
const CHECK_MS = 650;
/** In case the exit animation never reports completion. */
const LEAVE_FALLBACK_MS = 600;

const LEAVE: Transition = CARD_LEAVE;

/**
 * Stable transition identities: a fresh object each render restarts Motion's springs (that was
 * the first-click bounce on 继续追问).
 *
 * Morphs spring left/top with the size, so a bar that opens leftward grows out of the bubble
 * instead of jumping to its final x first. In-panel growth pins the anchored edge while the
 * height springs: top for downward panels, bottom for upward panels.
 */
const PIN = { duration: 0 } as const;
const SURFACE_TRANSITIONS = {
  enter: CARD_ENTER,
  expand: CARD_EXPAND,
  collapse: CARD_COLLAPSE,
  grow: { ...CARD_GROW, left: PIN, top: PIN, bottom: PIN },
} as const;

/** Face swap is opacity-only; the surface spring owns bubble→bar→panel card resize (no text translate). */
const faceVariants: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { ...FADE, delay: 0.04 } },
  exit: { opacity: 0, transition: FADE_QUICK },
};

// The expanding clip already reveals the bar. A second opacity animation can switch WebKit's
// SVG rasterization at fade completion, moving glyphs by a device pixel while labels stay put.
const barFaceVariants: Variants = {
  enter: { opacity: 1 },
  center: { opacity: 1 },
  exit: { opacity: 0, transition: FADE_QUICK },
};

const noop = () => {};

/**
 * Rounds a CSS length to a whole device pixel. Selection-derived positions are fractional, and a
 * fractional translate makes WebKit rasterize the whole surface (all its text) off the pixel grid.
 */
function snapToDevicePixel(v: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(v * dpr) / dpr;
}

/** Stage-space size the clipped content layer spans: up to the window's far edges. */
function stageExtent(s: Session) {
  return { width: s.frame.x + s.frame.width, height: s.frame.y + s.frame.height };
}

/**
 * Where a phase's content sits, in stage (work-area) coordinates. Bubble, check and bar content is
 * laid out once at its final place and never moves: the card springs underneath and only the clip
 * around the content follows it, so nothing inside rides the spring's overshoot. The panel keeps
 * following the card's top and height, so its composer stays on the edge while answers stream in.
 */
function faceStyle(s: Session, extent: { width: number }, box: Record<"top" | "height", MotionValue<number>>) {
  const { bubble, bar, panel } = s.placement;
  switch (s.phase) {
    case "bubble":
    case "check":
      return {
        left: snapToDevicePixel(bubble.x),
        top: snapToDevicePixel(bubble.y),
        width: bubble.width,
        height: bubble.height,
      };
    case "bar": {
      const left = snapToDevicePixel(bar.x);
      // Hug the edge the bar grows from; the measured width has a pixel of slack at the other end.
      const x = s.placement.barDirection === "right" ? { left } : { right: extent.width - (left + bar.width) };
      return { ...x, top: snapToDevicePixel(bar.y), height: BAR_HEIGHT };
    }
    case "panel":
      return { left: snapToDevicePixel(panel.x), width: PANEL_WIDTH, top: box.top, height: box.height };
  }
}

/**
 * The action under a viewport point. Over the bar's gaps and padding it is the nearest button, so the
 * hover highlight keeps sliding between buttons instead of dropping out and reappearing without motion.
 */
function actionAt(v: Point): ActionId | null {
  const el = document.elementFromPoint(v.x, v.y);
  const button = el?.closest("[data-action]");
  if (button) return button.getAttribute("data-action") as ActionId;
  const bar = el?.closest(".bar-face");
  if (!bar) return null;
  let nearest: Element | null = null;
  let best = Infinity;
  for (const b of bar.querySelectorAll("[data-action]")) {
    const r = b.getBoundingClientRect();
    const d = v.x < r.left ? r.left - v.x : v.x > r.right ? v.x - r.right : 0;
    if (d < best) {
      best = d;
      nearest = b;
    }
  }
  return (nearest?.getAttribute("data-action") as ActionId | undefined) ?? null;
}

const PIN_HANDOFF_TIMEOUT_MS = 8000;

/** A request the overlay keeps running for a pinned panel (固定浮层). */
interface Relay {
  latest: Answer | null;
  detached: DetachedAnswer | null;
  off: () => void;
  /** The pinned page said hello, so it receives what is sent from now on. */
  ready: boolean;
}

export function Overlay({
  bridge,
  pins,
  autoDismiss = true,
}: {
  bridge: Bridge;
  /** Omitted where pinning is not available: no pin button. */
  pins?: PinHost;
  /** `false` keeps the bubble until it is used or dismissed explicitly (harness only). */
  autoDismiss?: boolean;
}) {
  const autoDismissRef = useRef(autoDismiss);
  useEffect(() => {
    autoDismissRef.current = autoDismiss;
  }, [autoDismiss]);
  const { session, ref, commit, update } = useSessionStore();
  const [hovered, setHovered] = useState<ActionId | null>(null);
  /** Bumped under flushSync after setLocale so the hidden bar measurer paints the new labels. */
  const [, setLocaleEpoch] = useState(0);
  const reduceMotion = useReducedMotion();
  // The card's animated box. The content layer above it is clipped to the same box every frame.
  const box = {
    left: useMotionValue(0),
    top: useMotionValue(0),
    bottom: useMotionValue(0),
    width: useMotionValue(0),
    height: useMotionValue(0),
    borderRadius: useMotionValue(0),
  };
  const extent = session ? stageExtent(session) : { width: 0, height: 0 };
  const upward = session?.phase === "panel" && session.placement.panel.direction === "up";
  // A single height animation drives both the background and the content's top. Animating top
  // independently would let each streaming update move the bottom edge until height catches up.
  const renderedTop = useTransform([box.top, box.bottom, box.height], ([top, bottom, height]: number[]) =>
    upward ? extent.height - bottom - height : top,
  );
  const clipPath = useMotionValue("none");
  // Subscribed after commit, so it also catches the values the card sets while it first renders.
  useLayoutEffect(() => {
    const update = () => {
      const left = box.left.get();
      const top = upward ? extent.height - box.bottom.get() - box.height.get() : box.top.get();
      const right = extent.width - left - box.width.get();
      const bottom = extent.height - top - box.height.get();
      clipPath.set(`inset(${top}px ${right}px ${bottom}px ${left}px round ${box.borderRadius.get()}px)`);
    };
    update();
    const off = Object.values(box).map((v) => v.on("change", update));
    return () => off.forEach((f) => f());
  });
  const measureRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  /** Bumped on each onShow so a slow settings load cannot apply to a superseded selection. */
  const showGenRef = useRef(0);
  const timers = useOverlayTimers();
  const frame = useWindowFrame(bridge);

  const finishLeave = useCallback(
    (id: number) => {
      timers.clear("leave");
      if (ref.current?.payload.session !== id) return;
      commit(null);
      setHovered(null);
      // Hide only after a transparent frame is painted, so the next show cannot flash stale content.
      afterFrames(2, () => void bridge.hide(id).catch(noop));
    },
    [bridge, commit, ref, timers],
  );

  const leave = useCallback(
    (_reason: string) => {
      const s = ref.current;
      if (!s || s.leaving) return;
      timers.clearAll();
      const id = s.payload.session;
      if (!s.presented || reduceMotion) {
        finishLeave(id);
        return;
      }
      update(id, { leaving: true });
      timers.set("leave", LEAVE_FALLBACK_MS, () => finishLeave(id));
    },
    [finishLeave, reduceMotion, ref, timers, update],
  );

  const morph = useCallback(
    (to: Phase, patch: Partial<Session> = {}) => {
      const s = ref.current;
      if (!s || s.leaving || !s.presented) return;
      const id = s.payload.session;
      timers.clear("dwell");
      timers.clear("idle");
      const step = morphStep(s, to, patch);
      frame.beginMotion(id, union(step.from, step.to));
      flushSync(() => {
        if (to === "panel" && s.placement.panel.direction === "up") {
          // Rebase the new bottom coordinate from the on-screen box before switching anchors.
          box.bottom.set(stageExtent(s).height - renderedTop.get() - box.height.get());
        }
        update(id, step.next);
      });
    },
    [box.bottom, box.height, frame, ref, renderedTop, timers, update],
  );

  const updateHover = useCallback(
    (p: Point) => {
      const s = ref.current;
      if (!s || s.phase !== "bar" || s.leaving) return;
      const v = bridge.toViewport(p, s.frame);
      const id = actionAt(v);
      setHovered((h) => (h === id ? h : id));
    },
    [bridge, ref],
  );

  const onPointer = useCallback(
    (p: Point) => {
      const s = ref.current;
      if (!s || !s.presented || s.leaving) return;
      if (s.phase === "bubble") {
        const b = s.placement.bubble;
        if (contains(b, p, 4)) {
          // CONTEXT.md 展开方式: dwell only in hover mode.
          if (settingsRef.current.expandMode === "hover") {
            timers.ensure("dwell", DWELL_MS, () => morph("bar"));
          }
        } else {
          timers.clear("dwell");
          if (autoDismissRef.current && pointerLeftBubble(p, b, s.payload.selectionRect)) leave("away");
        }
      } else if (s.phase === "bar") {
        updateHover(p);
      } else {
        markPanelHover(bridge.toViewport(p, s.frame));
      }
    },
    [bridge, leave, morph, ref, timers, updateHover],
  );

  // Warm the cache; onShow still awaits a fresh read so expandMode cannot lag a settings change.
  useEffect(() => {
    void loadSettings().then((st) => (settingsRef.current = st));
  }, []);

  const onShow = useCallback(
    (p: ShowPayload) => {
      setLocale(resolveLocale(p.uiLanguage));
      // useT() in the measurer only updates on the next React commit. Without flushSync we would
      // size the bar for the previous locale (Chinese fits in less width → English labels clip).
      flushSync(() => setLocaleEpoch((n) => n + 1));
      timers.clearAll();
      setHovered(null);
      const id = p.session;
      const gen = ++showGenRef.current;
      // Must await settings before initialSession: a fire-and-forget load left expandMode stale
      // (always the previous save), so 点击/跳过 looked like they did nothing.
      void (async () => {
        const st = await loadSettings();
        if (showGenRef.current !== gen) return;
        settingsRef.current = st;
        // +1px slack for subpixel rounding between the hidden measurer and the live surface.
        const barWidth = Math.ceil((measureRef.current?.offsetWidth ?? 260) + 2);
        const placement = place({
          workArea: p.workArea,
          mouse: p.mouse,
          barWidth,
          selectionRect: p.selectionRect,
        });
        const s = initialSession(p, placement, st.expandMode);
        const hit = surfaceRect(s);
        // Render synchronously and present right away. Waiting for an animation frame here would
        // deadlock on macOS: WKWebView suspends rAF while the panel is hidden, and only `present`
        // shows the panel.
        flushSync(() => commit(s));
        if (ref.current?.payload.session !== id) return;
        try {
          await bridge.present(id, s.frame, hit);
        } catch (e) {
          console.warn("[pointer] present failed", e);
          commit(null);
          return;
        }
        update(id, { presented: true });
        if (s.phase === "bubble" && autoDismissRef.current) timers.set("idle", IDLE_MS, () => leave("idle"));
        afterFrames(2, async () => {
          const latency = await bridge.painted(id).catch(() => null);
          if (latency != null) update(id, { showLatency: latency });
        });
      })();
    },
    [bridge, commit, leave, ref, timers, update],
  );

  useEffect(() => {
    const offs = [
      bridge.onShow(onShow),
      bridge.onEnv((e) => update(e.session, { env: e })),
      bridge.onPointer(onPointer),
      bridge.onDismiss((d) => {
        if (ref.current?.payload.session === d.session) leave(d.reason);
      }),
      bridge.onWheel((id) => {
        const s = ref.current;
        if (s?.payload.session === id && s.phase === "bubble" && autoDismissRef.current) leave("scroll");
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bridge, leave, onPointer, onShow, ref, update]);

  const onAnimationComplete = useCallback(
    (def: unknown) => {
      const s = ref.current;
      if (!s || !s.presented || s.leaving) return;
      const rect = surfaceRect(s);
      const up = s.phase === "panel" && s.placement.panel.direction === "up";
      const d = def as { left?: number; top?: number; bottom?: number; width?: number; height?: number } | undefined;
      if (
        d &&
        (d.left !== snapToDevicePixel(rect.x) ||
          (up
            ? d.bottom !== stageExtent(s).height - snapToDevicePixel(s.placement.panel.anchorY)
            : d.top !== snapToDevicePixel(rect.y)) ||
          d.width !== rect.width ||
          d.height !== rect.height)
      )
        return;
      frame.settle(s);
      // The morph has landed: from now on height changes grow without overshoot.
      if (!s.settled) update(s.payload.session, { settled: true });
    },
    [frame, ref, update],
  );

  /** The group's fade-out has finished: the session can go. */
  const onGroupAnimationComplete = useCallback(() => {
    const s = ref.current;
    if (s?.presented && s.leaving) finishLeave(s.payload.session);
  }, [finishLeave, ref]);

  const onContentHeight = useCallback(
    (h: number) => {
      const s = ref.current;
      if (!s || s.phase !== "panel" || s.leaving) return;
      const height = panelHeightFor(s, h);
      if (Math.abs(height - s.panelHeight) < 1) return;
      const before = surfaceRect(s);
      const after = panelRect(s.placement.panel, height);
      frame.beginMotion(s.payload.session, union(before, after));
      // The bar→panel morph is still running (the panel measures itself as it mounts): retarget
      // it and keep its overshoot (CONTEXT.md 回弹). Later growth, while the answer streams or
      // the user types a follow-up, is bounce-free so the composer at the edge never jumps.
      const motion = s.motion === "expand" && !s.settled ? "expand" : "grow";
      update(s.payload.session, { panelHeight: height, motion });
    },
    [frame, ref, update],
  );

  const onAction = useCallback(
    (id: ActionId) => {
      const s = ref.current;
      if (!s || s.leaving || s.phase !== "bar") return;
      const action = actionById(id);
      if (action.kind === "local") {
        if (id === "copy") void bridge.copy(s.payload.text).catch(noop);
        else void bridge.openUrl(searchUrl(s.payload.text, settingsRef.current.searchEngine)).catch(noop);
        morph("check");
        timers.set("check", CHECK_MS, () => leave("done"));
        return;
      }
      const native = userLanguage(settingsRef.current);
      const source = id === "translate" ? detectLanguage(s.payload.text, native) : null;
      morph("panel", {
        action: id,
        panelHeight: PANEL_MIN_HEIGHT,
        run: s.run + 1,
        source,
        target: id === "translate" ? translationTarget(source, native, secondLanguage(settingsRef.current)) : null,
      });
    },
    [bridge, leave, morph, ref, timers],
  );

  /** Restarts the answer. */
  const restart = useCallback(
    (patch: Partial<Session> = {}) => {
      const s = ref.current;
      if (!s || s.phase !== "panel") return;
      update(s.payload.session, { ...patch, run: s.run + 1 });
    },
    [ref, update],
  );

  const startAnswer = useCallback<StartAnswer>(
    (signal, onText) => {
      // Reads the live session (the environment arrives on it), but keeps the last one if the
      // overlay lets go while the request still runs for a pinned panel.
      const id = ref.current?.payload.session;
      let last = ref.current;
      return requestAnswer({
        current: () => {
          if (ref.current?.payload.session === id) last = ref.current;
          return last;
        },
        signal,
        onText,
        onSettings: (st) => {
          settingsRef.current = st;
        },
      });
    },
    [ref],
  );

  const answerKey = session?.phase === "panel" ? `${session.payload.session}:${session.run}` : null;
  const { answer, stop, detach } = useAnswer({
    key: answerKey,
    start: startAnswer,
  });
  const answerRef = useRef(answer);
  useLayoutEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  // 固定浮层: relays for pinned panels, and the session waiting for its pinned window to show.
  const relays = useRef(new Map<string, Relay>());
  const pendingPin = useRef<{ label: string; id: number } | null>(null);
  const [pinHint, setPinHint] = useState(false);
  const pinning = useRef(false);
  const earlyShown = useRef(new Set<string>());
  const earlyHello = useRef(new Set<string>());
  const earlyClosed = useRef(new Set<string>());
  const pinTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pinTimeout.current !== null) clearTimeout(pinTimeout.current);
    },
    [],
  );

  useEffect(() => {
    if (!pinHint) return;
    const t = setTimeout(() => setPinHint(false), PIN_HINT_MS);
    return () => clearTimeout(t);
  }, [pinHint]);

  const finishPin = useCallback(
    (label: string) => {
      const p = pendingPin.current;
      if (!p || p.label !== label) {
        if (pinning.current) earlyShown.current.add(label);
        return;
      }
      pendingPin.current = null;
      pinning.current = false;
      if (pinTimeout.current !== null) clearTimeout(pinTimeout.current);
      pinTimeout.current = null;
      const relay = relays.current.get(label);
      if (relay?.latest && !isAnswering(relay.latest)) {
        relay.off();
        relays.current.delete(label);
      }
      if (pins?.nativeHandoff) {
        // Native code already swapped the windows. Clear stale DOM only after it is off-screen.
        timers.clear("leave");
        if (ref.current?.payload.session === p.id) {
          commit(null);
          setHovered(null);
        }
      } else {
        finishLeave(p.id);
      }
    },
    [commit, finishLeave, pins, ref, timers],
  );

  const closePin = useCallback(
    (label: string) => {
      const p = pendingPin.current;
      const relay = relays.current.get(label);
      if (p?.label === label) {
        pendingPin.current = null;
        pinning.current = false;
        if (pinTimeout.current !== null) clearTimeout(pinTimeout.current);
        pinTimeout.current = null;
        if (
          ref.current?.phase === "panel" &&
          `${ref.current.payload.session}:${ref.current.run}` === relay?.latest?.key
        ) {
          relay?.detached?.reattach();
        } else relay?.detached?.abort();
      } else {
        if (pinning.current) earlyClosed.current.add(label);
        relay?.detached?.abort();
      }
      relay?.off();
      relays.current.delete(label);
    },
    [ref],
  );

  useEffect(() => {
    if (!pins) return;
    const map = relays.current;
    const offs = [
      pins.onShown(finishPin),
      pins.onClosed(closePin),
      pins.onHello((label) => {
        const r = map.get(label);
        if (!r) {
          if (pinning.current) earlyHello.current.add(label);
          return;
        }
        r.ready = true;
        if (r.latest) pins.send(label, r.latest);
        // A pinned panel never sends stop for a settled answer, so the relay ends here once
        // the final answer has been delivered.
        if (r.latest && !isAnswering(r.latest) && pendingPin.current?.label !== label) {
          r.off();
          map.delete(label);
        }
      }),
      pins.onStop((label) => {
        const r = map.get(label);
        r?.detached?.abort();
        r?.off();
        map.delete(label);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [closePin, finishPin, pins]);

  /**
   * Pins the panel: it carries on in its own window. Returns false when no window was opened.
   */
  const pin = useCallback(async (): Promise<boolean> => {
    const s = ref.current;
    if (!pins || !s || s.phase !== "panel" || s.leaving || pinning.current) return false;
    pinning.current = true;
    const id = s.payload.session;
    const relaying = isAnswering(answerRef.current);
    const init: PinInit = {
      session: { ...s, engaged: false },
      answer: answerRef.current,
      relaying,
      ...readPanelState(),
      focus: s.engaged,
    };
    let label: string;
    try {
      label = await pins.open(id, surfaceRect(s), s.placement.panel.maxHeight, init);
    } catch (e) {
      pinning.current = false;
      if (isLimitError(e)) setPinHint(true);
      else console.warn("[pointer] pin failed", e);
      return false;
    }
    if (earlyClosed.current.delete(label)) {
      pinning.current = false;
      earlyHello.current.delete(label);
      earlyShown.current.delete(label);
      return false;
    }
    pendingPin.current = { label, id };
    if (relaying) {
      // Hand the running request over; if it settled meanwhile, relay its final state instead.
      const sameSession =
        ref.current?.phase === "panel" && ref.current.payload.session === id && ref.current.run === s.run;
      const detached = sameSession ? detach() : null;
      const relay: Relay = {
        latest: sameSession
          ? answerRef.current
          : {
              key: `${id}:${s.run}`,
              text: init.answer?.text ?? "",
              status: "stopped",
              error: null,
              reason: null,
            },
        detached,
        off: noop,
        ready: earlyHello.current.has(label),
      };
      relays.current.set(label, relay);
      if (detached)
        relay.off = detached.subscribe((a) => {
          relay.latest = a;
          pins.send(label, a);
          if (isAnswering(a)) return;
          // Settled. If the page is listening it just got the final answer; otherwise onHello
          // delivers it and ends the relay.
          queueMicrotask(() => relay.off());
          if (relay.ready && pendingPin.current?.label !== label) relays.current.delete(label);
        });
      if (relay.ready && relay.latest) {
        pins.send(label, relay.latest);
        if (!isAnswering(relay.latest) && ref.current?.payload.session !== id) {
          relay.off();
          relays.current.delete(label);
        }
      }
    }
    earlyHello.current.delete(label);
    pinTimeout.current = setTimeout(() => {
      void pins.cancel(label).catch((e) => console.warn("[pointer] cancel pending pin failed", e));
    }, PIN_HANDOFF_TIMEOUT_MS);
    if (earlyShown.current.delete(label)) finishPin(label);
    return true;
  }, [detach, finishPin, pins, ref]);

  const followUp = useCallback(
    (question: string) => {
      const s = ref.current;
      if (!s || s.phase !== "panel" || !answer?.text) return;
      restart({ thread: [...s.thread, { question: s.question, answer: answer.text }], question });
    },
    [answer, ref, restart],
  );

  const engage = useCallback(async () => {
    const s = ref.current;
    if (!s || s.phase !== "panel" || s.leaving) return;
    const id = s.payload.session;
    timers.clearAll();
    try {
      await bridge.engage(id);
      // First click only: engaged false→true used to schedule a React re-render AFTER faces
      // focused the textarea. That commit restarted Motion springs (composer jumped up, then
      // settled). Second click skips update — no bounce. flushSync so layout/class settle
      // before the caller runs focus({ preventScroll }).
      if (!ref.current?.engaged) {
        flushSync(() => update(id, { engaged: true }));
      }
    } catch (e) {
      console.warn("[pointer] engage failed", e);
    }
  }, [bridge, ref, timers, update]);

  const engaged = session?.engaged ?? false;
  useEffect(() => {
    if (!engaged) return;
    // The native Esc shortcut is off while engaged so that an input method can use Esc.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) leave("escape");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [engaged, leave]);

  const copy = useCallback((text: string) => void bridge.copy(text).catch(noop), [bridge]);
  const openUrl = useCallback((url: string) => void bridge.openUrl(url).catch(noop), [bridge]);

  const measurer = (
    <div className="measure" ref={measureRef} aria-hidden>
      <BarFace hovered={null} direction="right" measuring />
    </div>
  );

  if (!session || !session.presented) {
    return (
      <>
        <div className="overlay-root">{measurer}</div>
        <div id="overlay-lightbox-host" className="overlay-lightbox-host" />
      </>
    );
  }

  const s = session;
  const rect = surfaceRect(s);
  // Layout left/top (not Motion x/y transforms) so focus-scroll offsetTop matches visuals.
  const target = {
    left: snapToDevicePixel(rect.x),
    ...(upward
      ? { bottom: extent.height - snapToDevicePixel(s.placement.panel.anchorY) }
      : { top: snapToDevicePixel(rect.y) }),
    width: rect.width,
    height: rect.height,
    borderRadius: surfaceRadius(s),
  };
  const transition: Transition = reduceMotion ? { duration: 0 } : SURFACE_TRANSITIONS[s.motion];
  const groupTransition: Transition = reduceMotion ? { duration: 0 } : s.leaving ? LEAVE : FADE_QUICK;

  let face: ReactNode;
  switch (s.phase) {
    case "bubble":
      face = <BubbleFace />;
      break;
    case "check":
      face = <CheckFace />;
      break;
    case "bar":
      face = <BarFace hovered={hovered} direction={s.placement.barDirection} onAction={onAction} />;
      break;
    case "panel":
      face = (
        <PanelFace
          action={actionById(s.action ?? "explain")}
          thread={s.thread}
          question={s.question}
          answer={answer}
          ocrImage={s.payload.method === "ocr" ? s.payload.ocrImage : null}
          ocrText={s.payload.method === "ocr" ? s.payload.text : null}
          source={s.source}
          target={s.target}
          onPickTarget={(target) => restart({ target })}
          onCopy={copy}
          onOpenUrl={openUrl}
          onRegenerate={() => restart()}
          onStop={stop}
          onClose={() => leave("close")}
          onOpenSettings={() => {
            void bridge.openSettings("models").catch(noop);
            leave("settings");
          }}
          onContentHeight={onContentHeight}
          scrollable={s.panelHeight >= Math.round(s.placement.panel.maxHeight)}
          onEngage={engage}
          onFollowUp={followUp}
          onPin={pins ? () => void pin() : undefined}
          pinHint={pinHint}
        />
      );
      break;
  }

  return (
    <>
      <div className="overlay-root">
        {measurer}
        <div
          className="stage"
          style={{
            left: -snapToDevicePixel(s.frame.x),
            top: -snapToDevicePixel(s.frame.y),
          }}
        >
          <motion.div
            key={s.payload.session}
            className={["surface-group", `phase-${s.phase}`, s.engaged ? "engaged" : null].filter(Boolean).join(" ")}
            // A quick click can interrupt entry. Scaling this group would move every glyph
            // when the new phase changes its origin; only the background should resize.
            style={{ width: extent.width, height: extent.height }}
            initial={{ opacity: 0 }}
            animate={{ opacity: s.leaving ? 0 : 1 }}
            transition={groupTransition}
            onAnimationComplete={onGroupAnimationComplete}
            onPointerMove={(e) => onPointer(bridge.fromViewport({ x: e.clientX, y: e.clientY }, s.frame))}
            onPointerLeave={() => {
              setHovered(null);
              markPanelHover(null);
            }}
            onClick={() => {
              if (ref.current?.phase === "bubble") morph("bar");
            }}
          >
            <motion.div
              className="surface"
              style={{
                left: box.left,
                top: upward ? "auto" : box.top,
                bottom: upward ? box.bottom : undefined,
                width: box.width,
                height: box.height,
                borderRadius: box.borderRadius,
              }}
              initial={target}
              animate={target}
              transition={transition}
              onAnimationComplete={onAnimationComplete}
            />
            <motion.div className="surface-content" style={{ width: extent.width, height: extent.height, clipPath }}>
              <AnimatePresence initial={false}>
                <motion.div
                  key={s.phase}
                  className="face"
                  variants={s.phase === "bar" ? barFaceVariants : faceVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  style={faceStyle(s, extent, { top: upward ? renderedTop : box.top, height: box.height })}
                >
                  {face}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>
      </div>
      {/* Outside .overlay-root overflow / the clipped content layer so OCR lightbox is never cropped. */}
      <div id="overlay-lightbox-host" className="overlay-lightbox-host" />
    </>
  );
}
