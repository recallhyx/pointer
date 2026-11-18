"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@animate-ui/react/primitives/base-ui/select";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

/**
 * Base UI's Select.Value prints the raw value unless Root receives `items`.
 * Settings labels are translated text, so collect them from SelectItem children
 * and keep the existing `<SelectValue />` call sites.
 */
export function selectItemsFromChildren(children: React.ReactNode): Record<string, React.ReactNode> | undefined {
  const items: Record<string, React.ReactNode> = {};
  let found = false;
  const walk = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children);
        return;
      }
      if (child.type === SelectItem) {
        const props = child.props as { value?: unknown; children?: React.ReactNode };
        if (typeof props.value === "string") {
          items[props.value] = props.children;
          found = true;
        }
        return;
      }
      const nested = (child.props as { children?: React.ReactNode }).children;
      if (nested != null) walk(nested);
    });
  };
  walk(children);
  return found ? items : undefined;
}

/**
 * Base UI 1.9 unmounts a closing Select as soon as `getAnimations()` comes back
 * empty. Motion starts the exit a frame later, so the popup vanished with no
 * fade. Animate UI's Menu opts out of that unmount but its Select does not, so
 * opt out here and let the popup's `onAnimationComplete` unmount it.
 */
function Select({ items, children, onOpenChange, ...props }: SelectPrimitive.Root.Props<string>) {
  return (
    <SelectPrimitive.Root
      items={items ?? selectItemsFromChildren(children)}
      onOpenChange={(open, details) => {
        onOpenChange?.(open, details);
        if (!open && !details.isCanceled) details.preventUnmountOnClose();
      }}
      {...props}
    >
      {children}
    </SelectPrimitive.Root>
  );
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" className={className} {...props} />;
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" className={className} {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/80 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-disabled-foreground aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className="size-4 opacity-50" />} />
    </SelectPrimitive.Trigger>
  );
}

const highlightHolds = new WeakMap<HTMLElement, MutationObserver>();

/**
 * Animate UI keeps the highlight on the last hovered row and finishes its
 * spring even after Base UI clears `data-highlighted` on pointer leave. Leaving
 * mid-glide freezes the pill between rows or parks it on an item that is no
 * longer highlighted. Fade that in-flight pill out where it is.
 */
function parkTravelingHighlight(popup: HTMLElement) {
  const traveling = [...popup.querySelectorAll<HTMLElement>("[data-slot='item-highlight']")].filter((el) => {
    const moving = el
      .getAnimations()
      .some((animation) => animation.playState === "running" || animation.playState === "paused");
    return moving || getComputedStyle(el).transform !== "none";
  });
  if (traveling.length === 0) return;

  for (const el of traveling) {
    const transform = getComputedStyle(el).transform;
    const opacity = getComputedStyle(el).opacity;
    for (const animation of el.getAnimations()) animation.cancel();
    if (transform !== "none") el.style.transform = transform;
    el.animate([{ opacity }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
  }

  highlightHolds.get(popup)?.disconnect();
  const observer = new MutationObserver(() => {
    if (!popup.querySelector("[data-highlighted]")) return;
    releaseHighlightHold(popup);
  });
  highlightHolds.set(popup, observer);
  observer.observe(popup, { subtree: true, attributes: true, attributeFilter: ["data-highlighted"] });
}

function releaseHighlightHold(popup: HTMLElement) {
  highlightHolds.get(popup)?.disconnect();
  highlightHolds.delete(popup);
  for (const el of popup.querySelectorAll<HTMLElement>("[data-slot='item-highlight']")) {
    for (const animation of el.getAnimations()) animation.cancel();
    el.style.transform = "";
    el.style.opacity = "";
  }
}

/**
 * Positioning matches the Animate UI docs demo: a dropdown under the trigger
 * (`alignItemWithTrigger={false}`, `sideOffset={4}`), so the popup fades and
 * scales. Base UI's own default overlays the selected item and only fades.
 * Popup `transition` is left unset so Animate UI's 220ms menu ease applies.
 */
function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = false,
  onPointerLeave,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger">) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        // Base UI sets `hidden` as soon as it sees no CSS animation. Motion
        // registers the exit a frame later, so the attribute would hide the
        // fade and scale. The closed popup settles at opacity 0.
        hidden={false}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          onPointerLeave={(event) => {
            onPointerLeave?.(event);
            if (event.defaultPrevented) return;
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) return;
            parkTravelingHighlight(event.currentTarget);
          }}
          className={cn(
            "relative z-50 max-h-(--available-height) min-w-[max(8rem,var(--anchor-width))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List className="p-1">{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:text-disabled-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({ className, ...props }: SelectPrimitive.ScrollUpArrow.Props) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn("top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1", className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({ className, ...props }: SelectPrimitive.ScrollDownArrow.Props) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn("bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1", className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
