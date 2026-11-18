import { useId, type ComponentProps, type ReactNode } from "react";

import { useIconAnimation, type AnimatedIcon } from "@/components/animated-icons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Settings } from "@/shared/settings";

export type Update = (fn: (s: Settings) => Settings) => void;

/** A shadcn button whose animated icon plays while the button is hovered or focused. */
export function IconButton({ icon: Icon, children, ...props }: ComponentProps<typeof Button> & { icon: AnimatedIcon }) {
  const { ref, hover } = useIconAnimation();
  return (
    <Button {...props} {...hover}>
      <Icon ref={ref} size={16} />
      {children}
    </Button>
  );
}

export function Field(props: {
  label: string;
  hint?: ReactNode;
  error?: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      {props.children(id)}
      {props.hint && (
        <div className={cn("text-xs break-words", props.error ? "text-destructive" : "text-muted-foreground")}>
          {props.hint}
        </div>
      )}
    </div>
  );
}

export function Toggle(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex items-start gap-3",
        props.disabled && "text-disabled-foreground [&_label]:text-disabled-foreground [&_p]:text-disabled-foreground",
      )}
    >
      <Switch
        id={id}
        className="mt-0.5"
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
      <div className="space-y-1">
        <Label htmlFor={id}>{props.label}</Label>
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      </div>
    </div>
  );
}
