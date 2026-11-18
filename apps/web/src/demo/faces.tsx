import { AnimatePresence, motion } from "motion/react";
import { useState, type ComponentType, type ReactNode, type Ref } from "react";

import type { ActionId, PromptActionId } from "./answers";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExplainIcon,
  MarkIcon,
  RegenerateIcon,
  SearchIcon,
  SendIcon,
  StopIcon,
  TranslateIcon,
  type IconProps,
} from "./icons";
import { Markdown } from "./markdown";
import { FADE, PILL_SPRING } from "./tokens";
import { useT, type MessageKey } from "@/i18n";

interface ActionDef {
  id: ActionId;
  label: MessageKey;
  icon: ComponentType<IconProps>;
}

/** CONTEXT.md 默认 Action, in the app's fixed order. */
const ACTIONS: ActionDef[] = [
  { id: "explain", label: "action.explain", icon: ExplainIcon },
  { id: "translate", label: "action.translate", icon: TranslateIcon },
  { id: "copy", label: "action.copy", icon: CopyIcon },
  { id: "search", label: "action.search", icon: SearchIcon },
];

const actionDef = (id: ActionId) => ACTIONS.find((a) => a.id === id)!;

export function BubbleFace({ play }: { play?: boolean }) {
  return (
    <div className="bubble-face">
      <MarkIcon size={18} play={play} />
    </div>
  );
}

export function DoneFace() {
  return (
    <div className="bubble-face">
      <CheckIcon size={15} play />
    </div>
  );
}

/**
 * The action bar. The hover highlight is one pill that glides between buttons (`layoutId`), not
 * one per button. Buttons fade in one after another when the bar opens, unless `still`.
 */
export function BarFace({
  ref,
  ...props
}: {
  hovered: number | null;
  onHover?: (index: number | null) => void;
  onAction?: (id: ActionId) => void;
  still?: boolean;
  pillId: string;
  ref?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  return (
    <div className="bar-face" ref={ref} onMouseLeave={() => props.onHover?.(null)}>
      {ACTIONS.map((action, i) => (
        <motion.button
          key={action.id}
          type="button"
          className="bar-button"
          tabIndex={props.onAction ? 0 : -1}
          initial={props.still ? false : { opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...FADE, delay: 0.04 + i * 0.03 }}
          onMouseEnter={() => props.onHover?.(i)}
          onFocus={() => props.onHover?.(i)}
          onClick={() => props.onAction?.(action.id)}
        >
          {props.hovered === i && (
            <motion.span layoutId={props.pillId} className="hover-pill" transition={PILL_SPRING} />
          )}
          <span className="action-title">
            <span className="glyph">
              <action.icon size={16} play={props.hovered === i} />
            </span>
            {t(action.label)}
          </span>
        </motion.button>
      ))}
    </div>
  );
}

function IconButton(props: {
  label: string;
  icon: ComponentType<IconProps>;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      className={`icon-button ${props.className ?? ""}`}
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      tabIndex={props.onClick ? 0 : -1}
      onClick={props.onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <props.icon size={15} play={hover} />
    </button>
  );
}

export interface ExchangeView {
  question?: string;
  text: string;
}

/**
 * The result panel as drawn: header (the clicked action as the title), the conversation and the
 * follow-up box. Stateless, so the page's static figures draw it too; LivePanel adds behavior.
 */
export function PanelView({
  bodyRef,
  innerRef,
  ...props
}: {
  action: PromptActionId;
  exchanges: ExchangeView[];
  waiting?: boolean;
  answering?: boolean;
  /** The body scrolls only once the panel is at its maximum height; until then it is still growing. */
  scrollable?: boolean;
  copied?: boolean;
  onCopy?: () => void;
  onStop?: () => void;
  onRegenerate?: () => void;
  onClose?: () => void;
  footer?: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  innerRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  const def = actionDef(props.action);
  const last = props.exchanges.length - 1;
  return (
    <div className="panel-face">
      <div className="panel-header">
        <span className="panel-title">
          <span className="glyph">
            <def.icon size={15} />
          </span>
          {t(def.label)}
        </span>
        {props.action === "translate" && <span className="chip">{t("panel.target")}</span>}
        <span className="spacer" />
        <IconButton
          label={props.copied ? t("panel.copied") : t("panel.copy")}
          icon={props.copied ? CheckIcon : CopyIcon}
          onClick={props.onCopy}
          disabled={props.waiting}
        />
        {props.answering ? (
          <IconButton label={t("panel.stop")} icon={StopIcon} onClick={props.onStop} />
        ) : (
          <IconButton label={t("panel.regenerate")} icon={RegenerateIcon} onClick={props.onRegenerate} />
        )}
        <IconButton label={t("panel.close")} icon={CloseIcon} onClick={props.onClose} />
      </div>
      <div className="panel-body" ref={bodyRef} style={{ overflowY: props.scrollable ? "auto" : "hidden" }}>
        <div className="panel-body-inner" ref={innerRef}>
          {props.exchanges.map((ex, i) => (
            <div className="exchange" key={i}>
              {ex.question && <div className="question">{ex.question}</div>}
              {i === last && props.waiting ? <div className="skeleton" aria-hidden /> : <Markdown text={ex.text} />}
            </div>
          ))}
        </div>
      </div>
      <div className="panel-footer">{props.footer}</div>
    </div>
  );
}

export function FollowUpBox({
  inputRef,
  ...props
}: {
  value: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onSend?: () => void;
  onFocus?: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const t = useT();
  return (
    <>
      <input
        ref={inputRef}
        className="follow-up-input"
        value={props.value}
        disabled={props.disabled}
        readOnly={!props.onChange}
        tabIndex={props.onChange ? 0 : -1}
        placeholder={props.disabled ? t("panel.followUpLater") : t("panel.followUp")}
        onChange={(e) => props.onChange?.(e.target.value)}
        onFocus={props.onFocus}
        onKeyDown={(e) => {
          // Enter that confirms an IME candidate must not send.
          if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            props.onSend?.();
          }
        }}
      />
      <IconButton
        label={t("panel.send")}
        icon={SendIcon}
        className="send"
        onClick={props.onSend}
        disabled={props.disabled || !props.value.trim()}
      />
    </>
  );
}

/** Cross-fades between the current face and the one leaving, sliding along the way the surface grows. */
export function FaceSwap(props: {
  faceKey: string;
  offset: { x?: number; y?: number };
  instant: boolean;
  anchor: "left" | "right";
  children: ReactNode;
}) {
  const from = props.instant ? { opacity: 0 } : { opacity: 0, x: props.offset.x ?? 0, y: props.offset.y ?? 0 };
  const to = props.instant
    ? { opacity: 0 }
    : { opacity: 0, x: -(props.offset.x ?? 0) / 2, y: -(props.offset.y ?? 0) / 2 };
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={props.faceKey}
        className="face"
        style={{ [props.anchor]: 0, top: 0 }}
        initial={from}
        animate={{ opacity: 1, x: 0, y: 0 }}
        exit={to}
        transition={FADE}
      >
        {props.children}
      </motion.div>
    </AnimatePresence>
  );
}
