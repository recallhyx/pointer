import { motion, useReducedMotion } from "motion/react";

import { CARD_GROW, INSTANT } from "@/components/motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { resolveLocale, setLocale } from "@/i18n";
import { actionById } from "./actions";
import { PanelFace } from "./faces";
import { markPanelHover } from "./hover";
import { PANEL_WIDTH } from "./placement";
import { isLimitError, PIN_HINT_MS, PIN_MARGIN, presentPinned, type PinInit, type PinnedBridge } from "./pins";
import { requestAnswer } from "./requestAnswer";
import { panelHeightFor, type Session } from "./session";
import { isAnswering, useAnswer, type Answer, type StartAnswer } from "./useAnswer";

const noop = () => {};

/** A detached panel retains its webview when persistence is toggled. */
export function Pinned({ bridge }: { bridge: PinnedBridge }) {
  const [init, setInit] = useState<PinInit | null>(null);
  useEffect(() => {
    void bridge
      .init()
      .then((i) => {
        if (i) {
          setLocale(resolveLocale(i.session.payload.uiLanguage));
          setInit(i);
        } else void bridge.close();
      })
      .catch((e) => {
        console.warn("[pointer] pin initialization failed", e);
        void bridge.close().catch(noop);
      });
  }, [bridge]);
  if (!init) return null;
  return <PinnedPanel bridge={bridge} init={init} />;
}

function PinnedPanel({ bridge, init }: { bridge: PinnedBridge; init: PinInit }) {
  const reduceMotion = useReducedMotion();
  const [session, setSession] = useState<Session>(init.session);
  // Mirrors `session` for request callbacks; only `restart` changes either.
  const ref = useRef(session);
  const [height, setHeight] = useState(init.session.panelHeight);
  // Run 0 is the answer the overlay handed over (relayed while it still streams); later runs are ours.
  const [run, setRun] = useState(0);
  const [relayed, setRelayed] = useState<Answer | null>(init.answer);
  const relaying = useRef(init.relaying);
  const [fixed, setFixed] = useState(true);
  const [pinHint, setPinHint] = useState(false);
  const toggling = useRef(false);

  useEffect(() => {
    if (!init.relaying) return;
    let off = () => {};
    off = bridge.onAnswer((a) => {
      setRelayed(a);
      if (!isAnswering(a)) {
        relaying.current = false;
        // Stop listening once settled so another pin's stream can never overwrite us
        // (defense in depth; listeners are also scoped to this window's label).
        off();
        off = () => {};
      }
    });
    // Ask for the snapshot only once listening, so nothing streamed before now is lost.
    bridge.hello();
    return () => off();
  }, [bridge, init.relaying]);

  useEffect(() => bridge.onPointer(markPanelHover), [bridge]);

  // The caret was in the follow-up input of the overlay being replaced: the new window takes the
  // keyboard once it is on screen and puts the caret back, so pinning never interrupts typing.
  const [focusInput, setFocusInput] = useState(false);
  const [shown, setShown] = useState(false);

  // Initial layout is instant; subsequent growth animates after the window is visible.
  useEffect(
    () =>
      presentPinned(
        bridge,
        () => {
          setShown(true);
        },
        (e) => console.warn("[pointer] pin presentation failed", e),
        () => {
          if (init.focus)
            void bridge
              .engage()
              .then(() => setFocusInput(true))
              .catch(noop);
        },
      ),
    [bridge, init.focus],
  );

  const start = useCallback<StartAnswer>(
    (signal, onText) => requestAnswer({ current: () => ref.current, signal, onText, onSettings: noop }),
    [],
  );
  const { answer: own, stop: stopOwn } = useAnswer({ key: run > 0 ? `pinned:${run}` : null, start });
  const answer = run > 0 ? own : relayed;
  const stopOwnRef = useRef(stopOwn);
  const fixedRef = useRef(fixed);
  useLayoutEffect(() => {
    stopOwnRef.current = stopOwn;
    fixedRef.current = fixed;
  }, [fixed, stopOwn]);

  const stopRelay = useCallback(() => {
    if (!relaying.current) return;
    relaying.current = false;
    bridge.stop();
  }, [bridge]);

  const restart = useCallback(
    (patch: Partial<Session> = {}) => {
      stopRelay();
      const next = { ...ref.current, ...patch };
      ref.current = next;
      setSession(next);
      setRun((r) => r + 1);
    },
    [stopRelay],
  );

  const close = useCallback(() => {
    stopRelay();
    stopOwnRef.current();
    void bridge.close().catch(noop);
  }, [bridge, stopRelay]);

  useEffect(
    () =>
      bridge.onDismiss(() => {
        if (!fixedRef.current) close();
      }),
    [bridge, close],
  );
  useEffect(() => {
    if (fixed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, fixed]);
  useEffect(() => {
    if (!pinHint) return;
    const timer = setTimeout(() => setPinHint(false), PIN_HINT_MS);
    return () => clearTimeout(timer);
  }, [pinHint]);

  const toggleFixed = useCallback(async () => {
    if (toggling.current) return;
    toggling.current = true;
    try {
      await bridge.setFixed(!fixed);
      setFixed(!fixed);
    } catch (e) {
      if (isLimitError(e)) setPinHint(true);
      else console.warn("[pointer] toggle pin failed", e);
    } finally {
      toggling.current = false;
    }
  }, [bridge, fixed]);

  const onContentHeight = useCallback((h: number) => {
    const next = panelHeightFor(ref.current, h);
    setHeight((cur) => (Math.abs(cur - next) < 1 ? cur : next));
  }, []);
  useEffect(() => void bridge.resize(height).catch(noop), [bridge, height]);

  const s = session;
  return (
    <>
      <div className={["overlay-root", fixed ? "pinned-root" : ""].filter(Boolean).join(" ")}>
        <motion.div
          className="surface phase-panel"
          style={{
            left: PIN_MARGIN,
            ...(s.placement.panel.direction === "up" ? { top: "auto", bottom: PIN_MARGIN } : { top: PIN_MARGIN }),
            width: PANEL_WIDTH,
            borderRadius: 12,
            visibility: shown ? "visible" : "hidden",
          }}
          initial={false}
          animate={{ height }}
          transition={!shown || reduceMotion ? INSTANT : CARD_GROW}
          onPointerMove={(e) => markPanelHover({ x: e.clientX, y: e.clientY })}
          onPointerLeave={() => markPanelHover(null)}
        >
          <div className="face face-panel anchor-left" style={{ width: PANEL_WIDTH }}>
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
              onCopy={(text) => void bridge.copy(text).catch(noop)}
              onOpenUrl={(url) => void bridge.openUrl(url).catch(noop)}
              onRegenerate={() => restart()}
              onStop={run > 0 ? stopOwn : stopRelay}
              onClose={close}
              onOpenSettings={() => void bridge.openSettings().catch(noop)}
              onContentHeight={onContentHeight}
              scrollable={height >= Math.round(s.placement.panel.maxHeight)}
              onUnpin={fixed ? () => void toggleFixed() : undefined}
              onPin={!fixed ? () => void toggleFixed() : undefined}
              pinHint={pinHint}
              onEngage={() => bridge.engage().catch(noop)}
              initialScrollTop={init.scrollTop}
              initialDraft={init.draft}
              focusInput={focusInput}
              onFollowUp={(question) => {
                if (!answer?.text) return;
                restart({ thread: [...s.thread, { question: s.question, answer: answer.text }], question });
              }}
              onHeaderPointerDown={fixed ? () => void bridge.drag().catch(noop) : undefined}
            />
          </div>
        </motion.div>
      </div>
      <div id="overlay-lightbox-host" className="overlay-lightbox-host" />
    </>
  );
}
