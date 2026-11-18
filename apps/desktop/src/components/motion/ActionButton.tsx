import { Loader2 } from "lucide-react";
import { useEffect, useReducer, useRef, type ComponentProps } from "react";

import { CheckIcon, XIcon, useIconAnimation, type AnimatedIcon } from "@/components/animated-icons";
import { Button } from "@/components/ui/button";
import { actionReducer, type ActionPhase } from "./actionState";
import { ContentSwap } from "./ContentSwap";

export type { ActionPhase } from "./actionState";

type Props = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  icon: AnimatedIcon;
  label: string;
  pendingLabel: string;
  doneLabel: string;
  errorLabel?: string;
  /** Resolve for success; reject (throw) for failure. Pending lasts until it settles. */
  onAction: () => Promise<unknown>;
  /** Back to idle after a result; 0 keeps the result. */
  resetAfterMs?: number;
};

/**
 * Async button that morphs idle -> pending (spinner) -> done (check) / error (x) -> idle. The
 * content crossfades and the width springs; text itself only fades (WebKit-safe).
 */
export function ActionButton({
  icon: Icon,
  label,
  pendingLabel,
  doneLabel,
  errorLabel,
  onAction,
  resetAfterMs = 1600,
  disabled,
  className,
  ...props
}: Props) {
  const [phase, dispatch] = useReducer(actionReducer, "idle" as ActionPhase);
  const alive = useRef(true);
  const { ref, hover } = useIconAnimation();
  useEffect(() => () => void (alive.current = false), []);
  useEffect(() => {
    if ((phase !== "done" && phase !== "error") || resetAfterMs <= 0) return;
    const timer = setTimeout(() => dispatch({ type: "reset" }), resetAfterMs);
    return () => clearTimeout(timer);
  }, [phase, resetAfterMs]);

  const run = () => {
    if (phase === "pending" || disabled) return;
    dispatch({ type: "start" });
    onAction().then(
      () => alive.current && dispatch({ type: "resolve" }),
      () => alive.current && dispatch({ type: "reject" }),
    );
  };

  const text = { idle: label, pending: pendingLabel, done: doneLabel, error: errorLabel ?? label }[phase];
  return (
    <Button
      {...props}
      {...hover}
      disabled={disabled}
      aria-busy={phase === "pending" || undefined}
      aria-disabled={phase === "pending" || undefined}
      aria-label={label}
      className={className}
      onClick={run}
    >
      <ContentSwap swapKey={phase}>
        <span aria-hidden className="inline-flex items-center gap-2">
          {phase === "idle" && <Icon ref={ref} size={16} />}
          {phase === "pending" && <Loader2 className="size-4 animate-spin" />}
          {phase === "done" && <Settled icon={CheckIcon} className="text-success" />}
          {phase === "error" && <Settled icon={XIcon} className="text-destructive" />}
          {text}
        </span>
      </ContentSwap>
      <span role="status" className="sr-only">
        {phase === "idle" ? "" : text}
      </span>
    </Button>
  );
}

function Settled({ icon: Icon, className }: { icon: AnimatedIcon; className: string }) {
  const { ref } = useIconAnimation(true);
  return <Icon ref={ref} size={16} className={className} />;
}
