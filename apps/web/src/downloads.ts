/**
 * Download links for the public repository. `recallhyx/pointer-app` is not a download target.
 * `releases/latest` skips drafts and prereleases, so these URLs have no files until a release is
 * published on `recallhyx/pointer`. The file names are what `package.yml` copies the Tauri
 * installers to; keep them identical to `STABLE_INSTALLERS`.
 */

export const RELEASE_REPO = "recallhyx/pointer";

export const RELEASES = `https://github.com/${RELEASE_REPO}/releases`;

/** Stable asset names on the published release. The versioned bundler names are not uploaded. */
export const STABLE_INSTALLERS = {
  mac: "Pointer-macos-universal.dmg",
  windows: "Pointer-windows-x64-setup.exe",
} as const;

export const DOWNLOADS = {
  mac: `${RELEASES}/latest/download/${STABLE_INSTALLERS.mac}`,
  windows: `${RELEASES}/latest/download/${STABLE_INSTALLERS.windows}`,
} as const;

export type Platform = keyof typeof DOWNLOADS | "other";

/** The visitor's desktop OS from the user agent; phones and tablets are "other". */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return "other";
  // iPadOS reports itself as a Mac; only real Macs have no touch points.
  if (/Macintosh|Mac OS X/i.test(userAgent)) return maxTouchPoints > 1 ? "other" : "mac";
  if (/Windows/i.test(userAgent)) return "windows";
  return "other";
}

/** The shortcut that opens the action bar directly, written for the visitor's OS. */
export function shortcutLabel(platform: Platform): string {
  return platform === "windows" ? "Alt + `" : "⌥ + `";
}
