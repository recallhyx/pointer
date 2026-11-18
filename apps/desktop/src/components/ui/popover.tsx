import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Base UI has no Popover.Anchor part. The positioner takes an element, so the
 * anchor registers itself and the popup positions against that instead of a trigger.
 */
type PopoverAnchorContextValue = {
  anchor: HTMLElement | null;
  setAnchor: (node: HTMLElement | null) => void;
};

const PopoverAnchorContext = React.createContext<PopoverAnchorContextValue | null>(null);

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const value = React.useMemo(() => ({ anchor, setAnchor }), [anchor]);
  return (
    <PopoverAnchorContext.Provider value={value}>
      <PopoverPrimitive.Root {...props} />
    </PopoverAnchorContext.Provider>
  );
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const store = React.useContext(PopoverAnchorContext);
  return useRender({
    defaultTagName: "div",
    render,
    ref: store?.setAnchor,
    props: mergeProps<"div">(
      {
        "data-slot": "popover-anchor",
        className,
      } as React.ComponentProps<"div">,
      props,
    ),
  });
}

/** shadcn popover, but fade-only (no zoom/slide): transforms on text blur it in macOS WebKit. */
function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  fade = true,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> & {
    /** Fade the whole surface. Turn off to keep it opaque and animate inner content instead. */
    fade?: boolean;
  }) {
  const store = React.useContext(PopoverAnchorContext);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={store?.anchor ?? undefined}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden",
            fade && "transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
