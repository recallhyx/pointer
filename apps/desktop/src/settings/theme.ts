import type { Theme } from "@/shared/settings";

/** Resolve preference to a concrete light/dark for the settings window. */
export function resolveTheme(
  theme: Theme,
  prefersDark: boolean = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return prefersDark ? "dark" : "light";
}

/**
 * Force settings-window appearance via root `.dark` / `.light`.
 * Call again when the preference changes, and when system theme changes if preference is `system`.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.dataset.theme = theme;
}

/** Listen for OS appearance changes (only useful while preference is `system`). */
export function subscribeSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => onChange();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
