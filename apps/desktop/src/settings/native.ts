import { isTauri } from "@/shared/runtime";

/** Commands only the settings window uses. In the browser they do nothing. */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export interface RecentApp {
  id: string | null;
  name: string | null;
}

/** Host apps of the last few captures, newest first. */
export async function recentApps(): Promise<RecentApp[]> {
  return isTauri() ? invoke<RecentApp[]>("recent_apps") : [];
}

// Each invoke runs on its own thread, so a quick pause-then-resume could otherwise arrive reversed.
let shortcutQueue: Promise<unknown> = Promise.resolve();
function queued<T>(run: () => Promise<T>): Promise<T> {
  const next = shortcutQueue.then(run, run);
  shortcutQueue = next.catch(() => {});
  return next;
}

/** Rejects with a readable reason when the shortcut is taken or malformed; the old one then stays. */
export function setTriggerShortcut(accelerator: string | null): Promise<void> {
  return queued(async () => {
    if (isTauri()) await invoke("set_trigger_shortcut", { accelerator });
  });
}

/** Stops the current shortcut from firing while a new one is being recorded. */
export function pauseTriggerShortcut(paused: boolean): Promise<void> {
  return queued(async () => {
    if (isTauri()) await invoke("pause_trigger_shortcut", { paused });
  });
}

/** null when the browser harness cannot tell. */
export async function autostartEnabled(): Promise<boolean | null> {
  return isTauri() ? invoke<boolean>("autostart_enabled") : null;
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (isTauri()) await invoke("set_autostart", { enabled });
}

/** Opens the capture diagnostics folder in the system file manager. */
export async function openLogs(): Promise<void> {
  if (isTauri()) await invoke("open_logs");
  else throw new Error("unavailable");
}

/** App version from Tauri, or the package placeholder in the browser. */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return "0.0.0";
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Registers the screen-OCR shortcut immediately (also persisted via settings.json). */
export function setOcrShortcut(accelerator: string | null): Promise<void> {
  return queued(async () => {
    if (isTauri()) await invoke("set_ocr_shortcut", { accelerator });
  });
}

export async function ocrScreenPermission(): Promise<boolean | null> {
  return isTauri() ? invoke<boolean>("ocr_screen_permission") : null;
}

export async function ocrRequestScreenPermission(): Promise<boolean> {
  return isTauri() ? invoke<boolean>("ocr_request_screen_permission") : false;
}

export async function ocrOpenScreenSettings(): Promise<void> {
  if (isTauri()) await invoke("ocr_open_screen_settings");
}

export async function accessibilityPermission(): Promise<boolean | null> {
  return isTauri() ? invoke<boolean>("accessibility_permission") : null;
}

export async function accessibilityRequest(): Promise<boolean> {
  return isTauri() ? invoke<boolean>("accessibility_request") : false;
}

export async function accessibilityOpenSettings(): Promise<void> {
  if (isTauri()) await invoke("accessibility_open_settings");
}

export async function startOcr(): Promise<void> {
  if (isTauri()) await invoke("ocr_start");
}
