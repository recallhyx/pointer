/**
 * Browser-harness window label from `location.hash`.
 * Pinned popups use `#pinned-…`; settings use `#settings` or `#settings?page=…`.
 * Anything else is the harness.
 */
export function browserWindowLabelFromHash(hash: string): string {
  if (hash.startsWith("#pinned-")) return hash.slice(1);
  // Exact `#settings` or `#settings?…` only — not `#settingsfoo`.
  if (hash === "#settings" || hash.startsWith("#settings?")) return "settings";
  if (hash === "#ocr-picker" || hash.startsWith("#ocr-picker?")) return "ocr-picker";
  return "harness";
}
