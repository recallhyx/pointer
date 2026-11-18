import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import * as React from "react";

import { GlidePillGroup, useGlidePillTarget } from "@/components/motion";
import { cn } from "@/lib/utils";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";

/**
 * A free-text input with a filtered suggestion list (shadcn Combobox: Popover + Command).
 * Typing anything is allowed; suggestions only help. Arrow keys move, Enter picks, Esc closes.
 * Open list uses a shared glide pill (lighter than sidebar); checkmark stays on the selected value.
 */
function Combobox(props: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  // Show every option right after opening; filter once the user starts typing.
  const [typed, setTyped] = React.useState(false);
  const q = props.value.trim().toLowerCase();
  const shown = typed && q ? props.options.filter((o) => o.toLowerCase().includes(q)) : props.options;
  const visible = open && shown.length > 0;
  const [anchor, setAnchor] = React.useState<HTMLDivElement | null>(null);
  // Exact (fractional) anchor width, so the list lines up with the input to the subpixel.
  const [width, setWidth] = React.useState<number | undefined>(undefined);
  React.useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => setWidth(anchor.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [anchor]);

  return (
    <Command shouldFilter={false} loop className={cn("overflow-visible bg-transparent", props.className)}>
      <Popover
        open={visible}
        onOpenChange={(next, details) => {
          if (!next && anchor && outsideInsideAnchor(details, anchor)) {
            details.cancel();
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverAnchor render={<div ref={setAnchor} className="relative w-full" />}>
          <CommandInput
            id={props.id}
            value={props.value}
            spellCheck={false}
            autoComplete="off"
            placeholder={props.placeholder}
            onValueChange={(v) => {
              setTyped(true);
              setOpen(true);
              props.onChange(v);
            }}
            onFocus={() => {
              setTyped(false);
              setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && visible) {
                e.preventDefault();
                setOpen(false);
              } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
                setOpen(true);
              }
            }}
            className={cn(
              "h-9 w-full min-w-0 rounded-md border border-input bg-transparent py-1 pr-8 pl-3 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground md:text-sm dark:bg-input/30",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/80",
            )}
          />
          {props.options.length > 0 && (
            <ChevronDownIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 opacity-50"
            />
          )}
        </PopoverAnchor>
        <PopoverContent
          align="start"
          fade={false}
          className="p-0"
          style={{ width }}
          initialFocus={false}
          finalFocus={false}
          // Keep focus in the input when clicking an item.
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* The surface is opaque from its first frame; only the items fade, so nothing behind shows through. */}
          <CommandList className="animate-in duration-150 fade-in-0">
            <CommandGroup>
              <GlidePillGroup
                activeId={props.value}
                leaveMode="return"
                /* Slightly lighter than sidebar accent pill. */
                pillClassName="bg-muted"
                className="flex flex-col"
              >
                {shown.map((o) => (
                  <ComboboxOption
                    key={o}
                    value={o}
                    selected={o === props.value}
                    onPick={() => {
                      props.onChange(o);
                      setOpen(false);
                    }}
                  />
                ))}
              </GlidePillGroup>
            </CommandGroup>
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}

/** Keep the list open while the pointer or focus is still on the text field that anchors it. */
function outsideInsideAnchor(details: PopoverPrimitive.Root.ChangeEventDetails, anchor: HTMLElement) {
  if (details.reason !== "outside-press" && details.reason !== "focus-out") return false;
  const event = details.event;
  if (event.target instanceof Node && anchor.contains(event.target)) return true;
  if ("relatedTarget" in event && event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) {
    return true;
  }
  return false;
}

function ComboboxOption(props: { value: string; selected: boolean; onPick: () => void }) {
  const { ref, point } = useGlidePillTarget(props.value);
  const itemRef = React.useRef<HTMLDivElement | null>(null);

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      itemRef.current = el;
      ref(el);
    },
    [ref],
  );

  // cmdk toggles data-selected for keyboard highlight — keep the pill in sync.
  React.useEffect(() => {
    const el = itemRef.current;
    if (!el) return;
    const sync = () => {
      if (el.getAttribute("data-selected") === "true") point(el);
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ["data-selected"] });
    return () => mo.disconnect();
  }, [point, props.value]);

  return (
    <CommandItem
      ref={setRef}
      value={props.value}
      onSelect={props.onPick}
      onMouseEnter={(e) => point(e.currentTarget)}
      className={cn("rounded-lg data-[selected=true]:bg-transparent data-[selected=true]:text-accent-foreground")}
    >
      <span className="min-w-0 flex-1 truncate">{props.value}</span>
      <CheckIcon className={cn(props.selected ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );
}

export { Combobox };
