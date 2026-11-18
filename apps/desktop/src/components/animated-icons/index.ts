import { useEffect, useMemo, useRef, type ForwardRefExoticComponent, type RefAttributes } from "react";

export { ArrowUpIcon } from "./arrow-up";
export { BanIcon } from "./ban";
export { BotIcon } from "./bot";
export { CheckIcon } from "./check";
export { CircleCheckIcon } from "./circle-check";
export { CircleHelpIcon } from "./circle-help";
export { CopyIcon } from "./copy";
export { DeleteIcon } from "./delete";
export { EyeIcon } from "./eye";
export { EyeOffIcon } from "./eye-off";
export { FileTextIcon } from "./file-text";
export { KeyboardIcon } from "./keyboard";
export { LanguagesIcon } from "./languages";
export { MarkIcon } from "./mark";
export { MessageCircleQuestionIcon } from "./message-circle-question";
export { PinIcon, PinnedIcon } from "./pin";
export { PlusIcon } from "./plus";
export { RefreshCWIcon } from "./refresh-cw";
export { RotateCWIcon } from "./rotate-cw";
export { ScanTextIcon } from "./scan-text";
export { SearchIcon } from "./search";
export { SettingsIcon } from "./settings";
export { SlidersHorizontalIcon } from "./sliders-horizontal";
export { XIcon } from "./x";
export { ZapIcon } from "./zap";

/** Every lucide-animated icon exposes this handle. */
export interface AnimatedIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export type AnimatedIcon = ForwardRefExoticComponent<
  { size?: number; className?: string } & RefAttributes<AnimatedIconHandle>
>;

/**
 * The icons animate on their own hover by default. This lets a whole button drive the icon
 * instead, and optionally play it once whenever `playWhen` turns true.
 */
export function useIconAnimation(playWhen?: boolean) {
  const ref = useRef<AnimatedIconHandle>(null);
  useEffect(() => {
    if (playWhen) ref.current?.startAnimation();
  }, [playWhen]);
  return useMemo(
    () => ({
      ref,
      hover: {
        onMouseEnter: () => ref.current?.startAnimation(),
        onMouseLeave: () => ref.current?.stopAnimation(),
        onFocus: () => ref.current?.startAnimation(),
        onBlur: () => ref.current?.stopAnimation(),
      },
    }),
    [],
  );
}

/** Plays the icon while `active` is true, for hover that the page computes itself rather than the DOM. */
export function useIconPlaying(active: boolean) {
  const ref = useRef<AnimatedIconHandle>(null);
  useEffect(() => {
    if (active) ref.current?.startAnimation();
    else ref.current?.stopAnimation();
  }, [active]);
  return ref;
}
