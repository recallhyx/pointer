/**
 * Turns key presses into Tauri accelerators (`Alt+Backquote`) and back into labels. Uses
 * `KeyboardEvent.code`, so the result does not depend on the keyboard layout or input method;
 * e.g. ⌥` on macOS types a dead key but still reports `Backquote`.
 */

import { t } from "@/i18n";

/** Keys the global-hotkey crate can register. */
const KEY =
  /^(Key[A-Z]|Digit\d|F([1-9]|1[0-2])|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/;

const MODIFIER_KEYS = new Set(["Alt", "Control", "Shift", "Meta", "OS", "AltGraph", "Fn", "CapsLock"]);

type Platform = "macos" | "other";

export function platform(): Platform {
  return /Mac/i.test(navigator.platform || navigator.userAgent) ? "macos" : "other";
}

export type Recording =
  { kind: "pending"; label: string } | { kind: "done"; accelerator: string } | { kind: "invalid"; reason: string };

export function recordKey(e: KeyboardEvent): Recording {
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
    (m): m is string => !!m,
  );
  if (MODIFIER_KEYS.has(e.key)) {
    return { kind: "pending", label: mods.length ? formatShortcut(mods.join("+")) : "" };
  }
  if (!KEY.test(e.code)) return { kind: "invalid", reason: t("shortcut.badKey") };
  if (!mods.length) return { kind: "invalid", reason: t("shortcut.needModifier") };
  if (mods.length === 1 && mods[0] === "Shift") return { kind: "invalid", reason: t("shortcut.shiftOnly") };
  return { kind: "done", accelerator: [...mods, e.code].join("+") };
}

const MAC_MODIFIERS: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Super: "⌘" };
const OTHER_MODIFIERS: Record<string, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Super: "Win" };
const SYMBOLS: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** Mirrors `display_shortcut` in `src-tauri/src/tray.rs`. */
export function formatShortcut(accelerator: string, on: Platform = platform()): string {
  const modifiers = on === "macos" ? MAC_MODIFIERS : OTHER_MODIFIERS;
  return accelerator
    .split("+")
    .map((token) =>
      token === "Space"
        ? t("shortcut.space")
        : (modifiers[token] ?? SYMBOLS[token] ?? token.replace(/^(Key|Digit)/, "")),
    )
    .join(" + ");
}
