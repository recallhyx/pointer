import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";

import {
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  MarkIcon,
  PinIcon,
  PinnedIcon,
  RotateCWIcon,
  SettingsIcon,
  XIcon,
  useIconAnimation,
  useIconPlaying,
  type AnimatedIcon,
} from "@/components/animated-icons";
import {
  FADE,
  FADE_REVEAL,
  IconMorph,
  IconSwap,
  PILL_FADE,
  PILL_SPRING,
  Reveal,
  REVEAL,
  SHAKE,
  SHAKE_X,
  SkeletonReveal,
  STOP_REGENERATE,
} from "@/components/motion";
import { useT } from "@/i18n";
import { isImeKey } from "@/lib/ime";
import { LANGUAGES, type Language } from "@/llm/language";
import { ACTIONS, type ActionDef, type ActionId } from "./actions";
import { Markdown } from "./MarkdownView";
import { OcrSourceBlock } from "./OcrSource";
import { PANEL_HEADER_HEIGHT } from "./placement";
import type { Exchange } from "./session";
import { isAnswering, type Answer } from "./useAnswer";

/** A button whose animated icon plays while the button itself is hovered or focused. */
function GlyphButton({
  icon: Icon,
  size = 15,
  playOnMount,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: AnimatedIcon;
  size?: number;
  playOnMount?: boolean;
  children?: ReactNode;
}) {
  const { ref, hover } = useIconAnimation(playOnMount);
  return (
    <button {...props} {...hover}>
      <Icon ref={ref} size={size} className="glyph" />
      {children}
    </button>
  );
}

/**
 * Whether a panel button is hovered. The overlay never activates, so on macOS DOM hover is
 * unreliable: Overlay marks the button under the native pointer with `data-hover`. In the
 * browser, mouseenter / mouseleave still work. Do not also trust CSS `:hover` — on a
 * non-activating WKWebView it can stick after the pointer leaves, which would leave the
 * lucide-animated icon on its last frame (settings avoids this by driving start/stop from
 * real enter/leave only).
 */
function useButtonHover() {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fromAttr = () => el.hasAttribute("data-hover");
    const sync = () => setHovered(fromAttr());
    const onEnter = () => setHovered(true);
    // Leave only if native hover is gone too (data-hover may still be set).
    const onLeave = () => setHovered(fromAttr());
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["data-hover"] });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    sync();
    return () => {
      observer.disconnect();
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return { ref, hovered };
}

/**
 * Same pattern as settings' IconButton: `useIconAnimation` drives start/stop from enter/leave
 * so the glyph always returns to rest. The overlay also gets `data-hover` from the native
 * pointer (window never activates); that path calls the same start/stop directly.
 */
function PanelIconButton({
  icon: Icon,
  size = 15,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: AnimatedIcon; size?: number }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const { ref, hover } = useIconAnimation();
  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const sync = () => {
      if (el.hasAttribute("data-hover")) ref.current?.startAnimation();
      else ref.current?.stopAnimation();
    };
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["data-hover"] });
    return () => observer.disconnect();
  }, [ref]);
  return (
    <button
      ref={btnRef}
      {...props}
      onMouseEnter={(e) => {
        hover.onMouseEnter();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        // Keep playing if the native pointer is still over us.
        if (!btnRef.current?.hasAttribute("data-hover")) hover.onMouseLeave();
        onMouseLeave?.(e);
      }}
      onFocus={(e) => {
        hover.onFocus();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        if (!btnRef.current?.hasAttribute("data-hover")) hover.onBlur();
        onBlur?.(e);
      }}
    >
      <Icon ref={ref} size={size} className="glyph" />
    </button>
  );
}

/** Copy crossfades into a check that draws itself, and back once `copied` clears. */
function CopyButton(props: { copied: boolean; disabled: boolean; onCopy: () => void }) {
  const t = useT();
  const { ref, hovered } = useButtonHover();
  const copyRef = useIconPlaying(hovered && !props.copied);
  const { ref: checkRef } = useIconAnimation(props.copied);
  return (
    <button
      ref={ref}
      className="icon-button"
      title={t("panel.copy")}
      aria-label={t("panel.copy")}
      disabled={props.disabled}
      onClick={props.onCopy}
    >
      <IconSwap swapKey={props.copied}>
        {props.copied ? (
          <CheckIcon ref={checkRef} size={15} className="glyph" />
        ) : (
          <CopyIcon ref={copyRef} size={15} className="glyph" />
        )}
      </IconSwap>
    </button>
  );
}

/**
 * One slot whose glyph morphs between Stop and Regenerate, so the footer never jumps. Once the
 * morph lands on Regenerate, the lucide-animated rotate-cw (identical outline) takes over, so
 * hover plays its stock animation like every other icon.
 */
function StopOrRegenerate(props: { answering: boolean; onStop: () => void; onRegenerate: () => void }) {
  const t = useT();
  const { ref, hovered } = useButtonHover();
  // Which state the morph last finished in; the lucide icon shows only once it reached Regenerate.
  const [settledRegenerate, setSettledRegenerate] = useState(!props.answering);
  const showLucide = !props.answering && settledRegenerate;
  const iconRef = useIconPlaying(hovered && showLucide);
  return (
    <button
      ref={ref}
      className="icon-button"
      title={props.answering ? t("panel.stop") : t("panel.regenerate")}
      aria-label={props.answering ? t("panel.stop") : t("panel.regenerate")}
      onClick={props.answering ? props.onStop : props.onRegenerate}
    >
      {showLucide ? (
        <RotateCWIcon ref={iconRef} size={15} className="glyph" />
      ) : (
        <IconMorph
          shape={STOP_REGENERATE}
          state={!props.answering}
          size={15}
          onAnimationComplete={() => setSettledRegenerate(!props.answering)}
        />
      )}
    </button>
  );
}

export function BubbleFace() {
  const { ref, hover } = useIconAnimation();
  return (
    <div className="bubble-face" {...hover}>
      <MarkIcon ref={ref} size={18} className="glyph" />
    </div>
  );
}

const BAR_ICON_SIZE = 16;

function BarButton(props: { action: ActionDef; hovered: boolean; onAction?: (id: ActionId) => void }) {
  const t = useT();
  const { action: a } = props;
  const Icon = a.icon;
  const iconRef = useIconPlaying(props.hovered);
  return (
    <button data-action={a.id} className="bar-button" onClick={() => props.onAction?.(a.id)}>
      <span className="action-title">
        <Icon ref={iconRef} size={BAR_ICON_SIZE} className="glyph" />
        <span>{t(a.labelKey)}</span>
      </span>
    </button>
  );
}

/**
 * The hover highlight, one per bar, sliding between buttons by animating `left` and `width`.
 *
 * It used to be a `layoutId` element inside each button, which slides with a transform. A transformed
 * element is a GPU layer, and when it passes under a later button WebKit promotes that button's label
 * and icon to their own layers and back, so they shake. Animating geometry keeps everything on one layer.
 */
function HoverPill(props: { container: React.RefObject<HTMLDivElement | null>; hovered: ActionId | null }) {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const shown = useRef(false);
  useLayoutEffect(() => {
    const pill = scope.current;
    const button = props.hovered
      ? props.container.current?.querySelector<HTMLElement>(`[data-action="${props.hovered}"]`)
      : null;
    if (!pill) return;
    if (!button) {
      shown.current = false;
      void animate(pill, { opacity: 0 }, PILL_FADE);
      return;
    }
    const box = { left: button.offsetLeft, width: button.offsetWidth };
    // Appearing fades in at the button; only moving between visible buttons slides.
    if (shown.current) void animate(pill, { ...box, opacity: 1 }, PILL_SPRING);
    else {
      Object.assign(pill.style, { left: `${box.left}px`, width: `${box.width}px` });
      void animate(pill, { opacity: 1 }, PILL_FADE);
    }
    shown.current = true;
  }, [animate, props.container, props.hovered, scope]);
  return <span ref={scope} className="hover-pill" style={{ opacity: 0 }} />;
}

export function BarFace(props: {
  hovered: ActionId | null;
  direction: "right" | "left";
  measuring?: boolean;
  onAction?: (id: ActionId) => void;
}) {
  const t = useT();
  const faceRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={faceRef} className={`bar-face ${props.direction}`}>
      {!props.measuring && <HoverPill container={faceRef} hovered={props.hovered} />}
      {ACTIONS.map((a) => {
        if (props.measuring) {
          const Icon = a.icon;
          return (
            <button key={a.id} className="bar-button" tabIndex={-1}>
              <span className="action-title">
                <Icon size={BAR_ICON_SIZE} className="glyph" />
                <span>{t(a.labelKey)}</span>
              </span>
            </button>
          );
        }
        return <BarButton key={a.id} action={a} hovered={props.hovered === a.id} onAction={props.onAction} />;
      })}
    </div>
  );
}

const PANEL_BODY_PADDING = 14;
/** The input grows with its text up to about four lines, then scrolls. */
const INPUT_MAX_HEIGHT = 96;

/** One-shot: undo accidental document scroll without a fighting rAF loop (that loop was the snap-back). */
function resetOverlayScroll() {
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
}

export function PanelFace(props: {
  action: ActionDef;
  thread: Exchange[];
  question: string | null;
  answer: Answer | null;
  /** Cropped OCR screenshot; shown above the recognized source text. */
  ocrImage?: string | null;
  ocrText?: string | null;
  /** Translate only: the detected language of the selection, left out of the picker. */
  source: Language | null;
  target: Language | null;
  onPickTarget: (target: Language) => void;
  onCopy: (text: string) => void;
  onOpenUrl: (url: string) => void;
  onRegenerate: () => void;
  onStop: () => void;
  onClose: () => void;
  onOpenSettings: () => void;
  onContentHeight: (h: number) => void;
  /**
   * True once the panel has reached its maximum height. Before that the panel grows to fit, so the
   * body never scrolls; letting it scroll while the height animation catches up flashes a scrollbar
   * that narrows the text, and its disappearance re-wraps the answer (a visible jump).
   */
  scrollable: boolean;
  onEngage: () => Promise<void>;
  onFollowUp: (question: string) => void;
  /** 固定浮层: detach this panel into its own window. Omitted where pinning is unavailable. */
  onPin?: () => void;
  /** This panel is a pinned one: the pin button becomes a solid, accent-colored pin that unpins. */
  onUnpin?: () => void;
  /** The pinned-panel limit was hit; shown briefly next to the pin button. */
  pinHint?: boolean;
  /** Pressing the header outside its buttons (pinned panels drag from there). */
  onHeaderPointerDown?: () => void;
  /** A panel taking over from another window starts where that one was. */
  initialScrollTop?: number;
  initialDraft?: string;
  /** Put the caret in the follow-up input (the window must already be able to take the keyboard). */
  focusInput?: boolean;
}) {
  const t = useT();
  const Icon = props.action.icon;
  const bodyRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(props.initialDraft ?? "");
  const { onContentHeight, focusInput } = props;
  const hasFooter = props.answer?.status !== "not-configured";
  const answering = isAnswering(props.answer);

  // Follow the streaming answer down unless the user has scrolled up to read; scrolling back to
  // the bottom (or asking a follow-up) resumes following.
  const following = useRef(true);
  const answeringRef = useRef(answering);
  const scrollableRef = useRef(props.scrollable);
  useLayoutEffect(() => {
    answeringRef.current = answering;
    scrollableRef.current = props.scrollable;
  }, [answering, props.scrollable]);
  const followBottom = () => {
    const body = bodyRef.current;
    // overflow:hidden still permits programmatic scrolling. While height catches up to a
    // new line, scrolling it into view would move earlier text up, then back down on growth.
    if (body && scrollableRef.current && following.current && answeringRef.current) {
      body.scrollTop = body.scrollHeight;
    }
  };

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const report = () => {
      onContentHeight(el.offsetHeight + (footerRef.current?.offsetHeight ?? 0));
      followBottom();
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    if (footerRef.current) ro.observe(footerRef.current);
    return () => ro.disconnect();
  }, [onContentHeight, hasFooter]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1000);
    return () => clearTimeout(t);
  }, [copied]);

  useLayoutEffect(() => {
    // nearest: avoid walking scroll into the document (that nudged the stage like focus jitter).
    // A new question starts a new turn: jump to the bottom and follow the answer from there.
    // (scrollIntoView on the question alone would leave the answer below the fold, and the
    // resulting scroll event would read as the user scrolling away.)
    const body = bodyRef.current;
    if (props.question) {
      following.current = true;
      if (body && scrollableRef.current) body.scrollTop = body.scrollHeight;
    }
  }, [props.question, props.thread.length]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || props.initialScrollTop === undefined) return;
    body.scrollTop = props.initialScrollTop;
    following.current = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the mount snapshot matters
  }, []);

  useEffect(() => {
    if (focusInput) inputRef.current?.focus({ preventScroll: true });
  }, [focusInput]);

  // The body only becomes scrollable once the panel hits its maximum height; catch up then.
  useLayoutEffect(followBottom, [props.scrollable]);

  const a = props.answer;
  const text = a?.text ?? "";
  const canAsk = !answering && text !== "" && (a?.status === "done" || a?.status === "stopped");

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    // Avoid height:"auto" collapse flash (with a flex footer that used to be flex-end, that
    // read as the input jumping up). Measure from the reserved single-line height.
    el.style.height = "28px";
    const next = Math.min(Math.max(el.scrollHeight, 28), INPUT_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = next >= INPUT_MAX_HEIGHT ? "auto" : "hidden";
  };

  useLayoutEffect(() => {
    if (props.initialDraft) resizeInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const submit = () => {
    const q = draft.trim();
    if (!q || !canAsk) return;
    props.onFollowUp(q);
    setDraft("");
    requestAnimationFrame(resizeInput);
  };

  // The action's icon plays as the panel opens and the answer starts, and again on hover.
  const { ref: titleIconRef, hover: titleHover } = useIconAnimation(isAnswering(props.answer));

  return (
    <div className="panel-face">
      <div
        className="panel-header"
        style={{ height: PANEL_HEADER_HEIGHT }}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest("button, .panel-actions")) return;
          props.onHeaderPointerDown?.();
        }}
      >
        <span className="action-title panel-title" {...titleHover}>
          <Icon ref={titleIconRef} size={15} className="glyph" />
          <span>{t(props.action.labelKey)}</span>
        </span>
        <AnimatePresence initial={false}>
          {props.target && props.thread.length === 0 && (
            <motion.button
              key="target"
              className="chip"
              onClick={() => {
                setPicking((p) => !p);
                bodyRef.current?.scrollTo({ top: 0 });
              }}
              title={t("panel.switchTarget")}
              aria-expanded={picking}
              data-open={picking ? "" : undefined}
              style={{ overflow: "hidden", whiteSpace: "nowrap" }}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0, paddingLeft: 0, paddingRight: 0 }}
              transition={REVEAL}
            >
              {props.source && props.source.prompt !== props.target.prompt && (
                <span className="chip-source">{props.source.label} </span>
              )}
              → {props.target.label}
            </motion.button>
          )}
        </AnimatePresence>
        <span className="spacer" />
        <div className="panel-actions">
          <CopyButton
            copied={copied}
            disabled={!text}
            onCopy={() => {
              props.onCopy(text);
              setCopied(true);
            }}
          />
          <StopOrRegenerate answering={answering} onStop={props.onStop} onRegenerate={props.onRegenerate} />
          {props.onUnpin ? (
            <PanelIconButton
              className="icon-button is-pinned"
              title={t("panel.unpin")}
              aria-label={t("panel.unpin")}
              icon={PinnedIcon}
              onClick={props.onUnpin}
            />
          ) : (
            props.onPin && (
              <PanelIconButton
                className="icon-button"
                title={t("panel.pin")}
                aria-label={t("panel.pin")}
                icon={PinIcon}
                onClick={props.onPin}
              />
            )
          )}
          <PanelIconButton
            className="icon-button"
            title={t("panel.close")}
            aria-label={t("panel.close")}
            icon={XIcon}
            size={16}
            onClick={props.onClose}
          />
        </div>
      </div>
      <AnimatePresence>
        {props.pinHint && (
          <motion.div
            key="pin-hint"
            className="pin-hint"
            role="status"
            style={{ top: PANEL_HEADER_HEIGHT - 2 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE_REVEAL}
          >
            {t("panel.pinLimit")}
          </motion.div>
        )}
      </AnimatePresence>
      <div
        ref={bodyRef}
        className="panel-body"
        style={{ overflowY: props.scrollable ? "auto" : "hidden" }}
        onScroll={(e) => {
          if (!props.scrollable) return;
          const b = e.currentTarget;
          following.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24;
        }}
      >
        <div
          ref={innerRef}
          className="panel-body-inner"
          style={{ padding: `2px ${PANEL_BODY_PADDING}px ${PANEL_BODY_PADDING}px` }}
        >
          <Reveal show={picking && !!props.target && props.thread.length === 0} after={10}>
            <TargetPicker
              source={props.source}
              target={props.target}
              onPick={(l) => {
                setPicking(false);
                if (l.prompt !== props.target?.prompt) props.onPickTarget(l);
              }}
            />
          </Reveal>
          {props.ocrImage && props.ocrText != null && props.thread.length === 0 && !props.question && (
            <OcrSourceBlock image={props.ocrImage} text={props.ocrText} />
          )}
          {props.thread.map((e, i) => (
            <div key={i} className="exchange">
              {e.question && <div className="question">{e.question}</div>}
              <Markdown text={e.answer} onOpenUrl={props.onOpenUrl} onCopy={props.onCopy} />
            </div>
          ))}
          {props.question && <div className="question">{props.question}</div>}
          {a?.status === "not-configured" ? (
            <div className="notice">
              <span>{a.reason}</span>
              <GlyphButton className="text-button" icon={SettingsIcon} size={13} onClick={props.onOpenSettings}>
                {t("panel.openSettings")}
              </GlyphButton>
            </div>
          ) : (
            <SkeletonReveal loading={text === "" && answering}>
              <>
                {text && <Markdown text={text} onOpenUrl={props.onOpenUrl} onCopy={props.onCopy} />}
                {a?.status === "stopped" && (
                  <motion.div
                    className="answer-note"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={FADE}
                  >
                    {t("panel.stopped")}
                  </motion.div>
                )}
                {a?.status === "error" && a.error && (
                  <motion.div
                    className="notice error"
                    title={a.error.detail}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, x: [...SHAKE_X] }}
                    transition={{ opacity: FADE, x: SHAKE }}
                  >
                    <span>{a.error.message}</span>
                    <GlyphButton className="text-button" icon={RotateCWIcon} size={13} onClick={props.onRegenerate}>
                      {t("panel.retry")}
                    </GlyphButton>
                  </motion.div>
                )}
              </>
            </SkeletonReveal>
          )}
        </div>
      </div>
      {hasFooter && (
        <div ref={footerRef} className="panel-footer">
          <textarea
            ref={inputRef}
            className="follow-up-input"
            rows={1}
            value={draft}
            aria-label={t("panel.followUp")}
            placeholder={canAsk || draft ? t("panel.followUp") : t("panel.followUpLater")}
            onPointerDown={(e) => {
              // Only the click that engages is taken over: the window may not be key yet, and the
              // browser's own focus would scroll the caret into view. While the input has focus,
              // clicks and drags place the caret and select text as usual.
              if (e.button !== 0 || document.activeElement === e.currentTarget) return;
              e.preventDefault();
              e.stopPropagation();
              void props.onEngage().then(() => {
                inputRef.current?.focus({ preventScroll: true });
                resetOverlayScroll();
              });
            }}
            onMouseDown={(e) => {
              // Chrome: canceling mousedown reliably suppresses default focus scroll.
              if (e.button === 0 && document.activeElement !== e.currentTarget) e.preventDefault();
            }}
            onFocus={resetOverlayScroll}
            onChange={(e) => {
              setDraft(e.target.value);
              resizeInput();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey || isImeKey(e)) return;
              e.preventDefault();
              submit();
            }}
          />
          <PanelIconButton
            className="icon-button send"
            title={t("panel.send")}
            aria-label={t("panel.send")}
            icon={ArrowUpIcon}
            disabled={!canAsk || !draft.trim()}
            onClick={submit}
          />
        </div>
      )}
    </div>
  );
}

/**
 * CONTEXT.md 回答语言: the languages a translation can be switched to, minus the one the selection
 * is already in. It opens inside the panel, which grows to fit it: anything floating outside the
 * card would be clipped and could not take clicks.
 */
function TargetPicker(props: { source: Language | null; target: Language | null; onPick: (l: Language) => void }) {
  const t = useT();
  return (
    <div className="target-picker" role="listbox" aria-label={t("panel.switchTarget")}>
      {LANGUAGES.filter((l) => l.prompt !== props.source?.prompt).map((l) => {
        const selected = l.prompt === props.target?.prompt;
        return (
          <button
            key={l.prompt}
            className="target-option"
            role="option"
            aria-selected={selected}
            data-selected={selected ? "" : undefined}
            onClick={() => props.onPick(l)}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}

export function CheckFace() {
  const { ref } = useIconAnimation(true);
  return (
    <div className="bubble-face">
      <CheckIcon ref={ref} size={16} className="glyph" />
    </div>
  );
}
