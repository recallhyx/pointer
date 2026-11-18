import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { answerFor, FOLLOW_UP_REPLY, type ActionId, type PromptActionId } from "./answers";
import { DemoContext, type DemoKey } from "./context";
import { BarFace, BubbleFace, DoneFace, FaceSwap, FollowUpBox, PanelView } from "./faces";
import { CursorGlyph } from "./icons";
import {
  barFrame,
  bubbleFrame,
  doneFrame,
  panelFrame,
  PANEL_MAX_HEIGHT,
  type Frame,
  type Point,
  type Span,
} from "./geometry";
import { CARD_COLLAPSE, CARD_ENTER, CARD_EXPAND, CARD_GROW, CARD_LEAVE, INSTANT } from "./tokens";
import { useStickToBottom } from "./useStickToBottom";
import { useStream } from "./useStream";
import { useLang } from "@/i18n";

/**
 * The page's own Pointer: select text anywhere in `[data-selectable]` and the overlay appears,
 * following the app's rules (CONTEXT.md 浮标 / 消失 / 驻留). It lives in page coordinates, so it
 * scrolls with the text. A scripted run plays the same overlay with a fake cursor, for touch
 * screens and for the "watch it once" link.
 */

type Phase = "bubble" | "bar" | "panel" | "done";

interface Session {
  id: number;
  text: string;
  mouse: Point;
  selectionBottom: number;
  view: Span;
  /** Driven by the script: none of the bubble's auto-dismiss rules apply. */
  scripted: boolean;
}

interface Exchange {
  question?: string;
  full: string;
}

/** CONTEXT.md 消失: the bubble fades after this long untouched, or once the mouse is this far away. */
const BUBBLE_IDLE_MS = 3000;
const BUBBLE_LEAVE_PX = 150;
/** CONTEXT.md 展开方式: hover rests this long before the bubble opens. */
const HOVER_EXPAND_MS = 150;
const HEADER = 44;
const FOOTER = 45;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const viewSpan = (): Span => ({ left: window.scrollX, width: document.documentElement.clientWidth });
const plain = (markdown: string) => markdown.replace(/\*+/g, "");

function selectionInPage(): { text: string; bottom: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el?.closest("[data-selectable]") || el.closest("[data-no-overlay], input, textarea")) return null;
  return { text, bottom: sel.getRangeAt(0).getBoundingClientRect().bottom + window.scrollY };
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const lang = useLang();
  const reduced = useReducedMotion() ?? false;
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("bubble");
  const [hovered, setHovered] = useState<number | null>(null);
  const [action, setAction] = useState<PromptActionId>("explain");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [run, setRun] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number; ms: number; visible: boolean; down: boolean }>({
    x: 0,
    y: 0,
    ms: 0,
    visible: false,
    down: false,
  });

  const surfaceRef = useRef<HTMLDivElement>(null);
  const barMeasure = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(300);
  const script = useRef(0);
  const sessionIds = useRef(0);

  // The bar is as wide as its buttons, which depends on the language.
  useLayoutEffect(() => {
    if (barMeasure.current) setBarWidth(Math.ceil(barMeasure.current.getBoundingClientRect().width));
  }, [lang]);

  const clearDemoHighlight = () =>
    document.querySelectorAll("[data-demo-active]").forEach((el) => el.removeAttribute("data-demo-active"));

  const dismiss = useCallback(() => {
    setSession(null);
    setEngaged(false);
    setHovered(null);
    clearDemoHighlight();
  }, []);

  const stopScript = useCallback(() => {
    script.current++;
    setCursor((c) => ({ ...c, visible: false, down: false }));
  }, []);

  const open = useCallback((s: Omit<Session, "id" | "view">) => {
    setSession({ ...s, id: ++sessionIds.current, view: viewSpan() });
    setPhase("bubble");
    setHovered(null);
    setEngaged(false);
    setExchanges([]);
  }, []);

  const startAnswer = useCallback(
    (text: string, id: PromptActionId) => {
      setAction(id);
      setExchanges([{ full: answerFor(text, id, lang) }]);
      setRun((r) => r + 1);
      setPhase("panel");
    },
    [lang],
  );

  const runAction = useCallback(
    (id: ActionId) => {
      if (!session) return;
      if (id === "explain" || id === "translate") return startAnswer(session.text, id);
      if (id === "copy") navigator.clipboard?.writeText(session.text).catch(() => {});
      else window.open(`https://www.google.com/search?q=${encodeURIComponent(session.text)}`, "_blank", "noopener");
      // CONTEXT.md 内容切换: a local action shrinks back to the bubble, draws a check, then leaves.
      setPhase("done");
      const sid = session.id;
      setTimeout(() => setSession((s) => (s?.id === sid ? null : s)), 900);
    },
    [session, startAnswer],
  );

  // Selecting text with the mouse opens the bubble (CONTEXT.md 触发: drag, double / triple click, shift-click).
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === "touch" || engaged) return;
      if (surfaceRef.current?.contains(e.target as Node)) return;
      // The selection settles after the event; a double-click's word is there by the next frame.
      requestAnimationFrame(() => {
        const sel = selectionInPage();
        if (!sel) return;
        stopScript();
        clearDemoHighlight();
        open({ text: sel.text, mouse: { x: e.pageX, y: e.pageY }, selectionBottom: sel.bottom, scripted: false });
      });
    };
    document.addEventListener("pointerup", onUp);
    return () => document.removeEventListener("pointerup", onUp);
  }, [engaged, open, stopScript]);

  // Click outside, Esc, or resizing dismisses; an engaged panel only closes with Esc or ×.
  useEffect(() => {
    if (!session) return;
    const onDown = (e: PointerEvent) => {
      if (surfaceRef.current?.contains(e.target as Node)) return;
      stopScript();
      if (!engaged) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopScript();
        dismiss();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
    };
  }, [session, engaged, dismiss, stopScript]);

  const bubble = session ? bubbleFrame(session.mouse, session.view) : null;
  const touching = useRef(false);

  // The bubble alone fades on its own: idle, scrolled away from, or left behind by the mouse.
  useEffect(() => {
    if (!session || session.scripted || phase !== "bubble" || !bubble) return;
    const cx = bubble.x + bubble.w / 2;
    const cy = bubble.y + bubble.h / 2;
    const idle = setTimeout(() => !touching.current && dismiss(), BUBBLE_IDLE_MS);
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.pageX - cx, e.pageY - cy) > BUBBLE_LEAVE_PX) dismiss();
    };
    window.addEventListener("scroll", dismiss, { passive: true });
    document.addEventListener("pointermove", onMove);
    return () => {
      clearTimeout(idle);
      window.removeEventListener("scroll", dismiss);
      document.removeEventListener("pointermove", onMove);
    };
    // `bubble` is derived from `session`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, phase, dismiss]);

  const play = useCallback(
    async (key: DemoKey, act: PromptActionId) => {
      const token = ++script.current;
      const live = () => script.current === token;
      setSession(null);
      setEngaged(false);
      clearDemoHighlight();
      window.getSelection()?.removeAllRanges();
      const span = document.querySelector<HTMLElement>(`[data-demo="${key}"]`);
      if (!span) return;

      const box = span.getBoundingClientRect();
      if (box.top < 96 || box.bottom > window.innerHeight - 320) {
        span.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        await wait(reduced ? 50 : 600);
        if (!live()) return;
      }
      const move = async (to: Point, ms: number) => {
        setCursor((c) => ({ ...c, ...to, ms: reduced ? 0 : ms, visible: true }));
        await wait(reduced ? 60 : ms + 60);
        return live();
      };
      const rects = span.getClientRects();
      const first = rects[0];
      const last = rects[rects.length - 1];
      const start = { x: first.left + window.scrollX, y: first.top + window.scrollY + first.height / 2 };
      const end = { x: last.right + window.scrollX, y: last.top + window.scrollY + last.height / 2 };

      setCursor({ x: start.x + 90, y: start.y + 120, ms: 0, visible: true, down: false });
      await wait(30);
      if (!(await move(start, 650))) return;
      setCursor((c) => ({ ...c, down: true }));
      span.setAttribute("data-demo-active", "");
      if (!(await move(end, 480))) return;
      setCursor((c) => ({ ...c, down: false }));
      const text = span.textContent ?? "";
      open({ text, mouse: end, selectionBottom: last.bottom + window.scrollY, scripted: true });

      await wait(700);
      if (!live()) return;
      const b = bubbleFrame(end, viewSpan());
      if (!(await move({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, 420))) return;
      await wait(HOVER_EXPAND_MS + 120);
      if (!live()) return;
      setPhase("bar");
      await wait(520);
      if (!live()) return;

      const index = act === "explain" ? 0 : 1;
      const button = surfaceRef.current?.querySelectorAll(".bar-button")[index]?.getBoundingClientRect();
      if (
        button &&
        !(await move({ x: button.left + window.scrollX + 22, y: button.top + window.scrollY + button.height / 2 }, 420))
      )
        return;
      setHovered(index);
      await wait(450);
      if (!live()) return;
      setCursor((c) => ({ ...c, down: true }));
      await wait(120);
      if (!live()) return;
      setCursor((c) => ({ ...c, down: false }));
      startAnswer(text, act);
      await wait(500);
      if (live()) setCursor((c) => ({ ...c, visible: false }));
    },
    [open, reduced, startAnswer],
  );

  const api = useMemo(() => ({ play }), [play]);

  return (
    <DemoContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="overlay-layer" data-ui lang={lang === "zh" ? "zh-CN" : "en"}>
          <div className="measure" aria-hidden>
            <BarFace ref={barMeasure} hovered={null} still pillId="measure-pill" />
          </div>
          <AnimatePresence>
            {session && bubble && (
              <Surface
                key={session.id}
                surfaceRef={surfaceRef}
                session={session}
                phase={phase}
                bubble={bubble}
                barWidth={barWidth}
                hovered={hovered}
                action={action}
                exchanges={exchanges}
                run={run}
                engaged={engaged}
                reduced={reduced}
                onTouch={(on) => (touching.current = on)}
                onExpand={() => setPhase((p) => (p === "bubble" ? "bar" : p))}
                onHover={setHovered}
                onAction={(id) => {
                  stopScript();
                  runAction(id);
                }}
                onRegenerate={() => setRun((r) => r + 1)}
                onFollowUp={(question, shown) => {
                  setExchanges((list) => [
                    ...list.slice(0, -1),
                    { ...list[list.length - 1], full: shown },
                    { question, full: FOLLOW_UP_REPLY[lang] },
                  ]);
                  setRun((r) => r + 1);
                }}
                onEngage={() => {
                  stopScript();
                  setEngaged(true);
                }}
                onClose={dismiss}
              />
            )}
          </AnimatePresence>
          <motion.div
            className="demo-cursor"
            aria-hidden
            initial={false}
            animate={{ x: cursor.x, y: cursor.y, opacity: cursor.visible ? 1 : 0, scale: cursor.down ? 0.88 : 1 }}
            transition={{
              x: { duration: cursor.ms / 1000, ease: [0.45, 0, 0.2, 1] },
              y: { duration: cursor.ms / 1000, ease: [0.45, 0, 0.2, 1] },
              opacity: { duration: 0.2 },
              scale: { duration: 0.1 },
            }}
          >
            <CursorGlyph />
          </motion.div>
        </div>,
        document.body,
      )}
    </DemoContext.Provider>
  );
}

function Surface({
  surfaceRef,
  ...props
}: {
  surfaceRef: React.RefObject<HTMLDivElement | null>;
  session: Session;
  phase: Phase;
  bubble: Frame;
  barWidth: number;
  hovered: number | null;
  action: PromptActionId;
  exchanges: Exchange[];
  run: number;
  engaged: boolean;
  reduced: boolean;
  onTouch: (on: boolean) => void;
  onExpand: () => void;
  onHover: (index: number | null) => void;
  onAction: (id: ActionId) => void;
  onRegenerate: () => void;
  onFollowUp: (question: string, shownAnswer: string) => void;
  onEngage: () => void;
  onClose: () => void;
}) {
  const { session, phase, bubble, reduced } = props;
  const [panelHeight, setPanelHeight] = useState(HEADER + FOOTER + 22);
  // Which phase's opening spring has finished; after that, size changes are the panel growing.
  const [settledPhase, setSettledPhase] = useState<Phase | null>(null);
  const settled = settledPhase === phase;
  const { frame: bar, dir } = barFrame(bubble, props.barWidth, session.view);
  const panel = panelFrame(bar, dir, panelHeight, session.selectionBottom, session.view);
  const frame = phase === "bubble" ? bubble : phase === "bar" ? bar : phase === "panel" ? panel : doneFrame(bar, dir);

  // CONTEXT.md 回弹: opening the bar or the panel overshoots, shrinking to the check settles, and
  // the panel growing as text streams in does neither.
  const transition: Transition = reduced
    ? INSTANT
    : phase === "bubble"
      ? CARD_ENTER
      : phase === "done"
        ? CARD_COLLAPSE
        : phase === "panel" && settled
          ? CARD_GROW
          : CARD_EXPAND;

  const hoverTimer = useRef(0);
  // Content sticks to the edge the surface grows away from, so it never slides with the resize.
  const anchor = dir === "right" ? "left" : "right";
  const grow = dir === "right" ? 12 : -12;

  return (
    <motion.div
      className="surface-group"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: reduced ? INSTANT : CARD_LEAVE }}
      transition={{ duration: 0.08 }}
    >
      <motion.div
        ref={surfaceRef}
        className={props.engaged ? "surface engaged" : "surface"}
        initial={
          reduced
            ? false
            : { x: bubble.x + bubble.w / 2, y: bubble.y + bubble.h / 2, width: 0, height: 0, borderRadius: bubble.r }
        }
        animate={{ x: frame.x, y: frame.y, width: frame.w, height: frame.h, borderRadius: frame.r }}
        transition={transition}
        onAnimationComplete={() => setSettledPhase(phase)}
        // Like the app's overlay, clicking it must not take the selection or focus away from the page.
        onPointerDown={(e) => {
          const t = e.target as HTMLElement;
          if (!t.closest("input, .panel-body")) e.preventDefault();
        }}
        onMouseEnter={() => {
          props.onTouch(true);
          if (phase === "bubble" && !session.scripted)
            hoverTimer.current = window.setTimeout(props.onExpand, HOVER_EXPAND_MS);
        }}
        onMouseLeave={() => {
          props.onTouch(false);
          clearTimeout(hoverTimer.current);
        }}
        onClick={() => phase === "bubble" && props.onExpand()}
      >
        <FaceSwap
          faceKey={phase}
          anchor={anchor}
          instant={reduced}
          offset={phase === "bar" ? { x: grow } : phase === "panel" ? { y: 12 } : {}}
        >
          {phase === "bubble" && (
            <div style={{ width: bubble.w, height: bubble.h }}>
              <BubbleFace />
            </div>
          )}
          {phase === "bar" && (
            <div style={{ width: props.barWidth, height: bar.h }}>
              <BarFace
                hovered={props.hovered}
                onHover={props.onHover}
                onAction={props.onAction}
                still={reduced}
                pillId={`pill-${session.id}`}
              />
            </div>
          )}
          {phase === "panel" && (
            <div style={{ width: panel.w, height: panel.h }}>
              <LivePanel {...props} scrollable={panelHeight >= PANEL_MAX_HEIGHT} onHeight={setPanelHeight} />
            </div>
          )}
          {phase === "done" && (
            <div style={{ width: 28, height: 28 }}>
              <DoneFace />
            </div>
          )}
        </FaceSwap>
      </motion.div>
    </motion.div>
  );
}

/** The panel with behavior: streaming, copy, stop / regenerate and the follow-up box. */
function LivePanel(props: {
  action: PromptActionId;
  exchanges: Exchange[];
  run: number;
  reduced: boolean;
  /** At its maximum height: only then does the body scroll and follow the stream down. */
  scrollable: boolean;
  onRegenerate: () => void;
  onFollowUp: (question: string, shownAnswer: string) => void;
  onEngage: () => void;
  onClose: () => void;
  onHeight: (height: number) => void;
}) {
  const last = props.exchanges[props.exchanges.length - 1];
  const stream = useStream(last?.full ?? "", props.run, props.reduced);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const bodyRef = useStickToBottom(stream.text, props.scrollable);
  const innerRef = useRef<HTMLDivElement>(null);
  const { onHeight } = props;

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const report = () => onHeight(HEADER + FOOTER + Math.ceil(el.getBoundingClientRect().height));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeight]);

  const views = props.exchanges.map((ex, i) =>
    i === props.exchanges.length - 1
      ? { question: ex.question, text: stream.text }
      : { question: ex.question, text: ex.full },
  );

  return (
    <PanelView
      action={props.action}
      exchanges={views}
      waiting={stream.waiting}
      answering={!stream.done}
      scrollable={props.scrollable}
      copied={copied}
      bodyRef={bodyRef}
      innerRef={innerRef}
      onCopy={() => {
        navigator.clipboard?.writeText(plain(stream.text)).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      onStop={stream.stop}
      onRegenerate={props.onRegenerate}
      onClose={props.onClose}
      footer={
        <FollowUpBox
          value={draft}
          disabled={!stream.done}
          onChange={setDraft}
          onFocus={props.onEngage}
          onSend={() => {
            const q = draft.trim();
            if (!q || !stream.done) return;
            setDraft("");
            props.onFollowUp(q, stream.text);
          }}
        />
      }
    />
  );
}
