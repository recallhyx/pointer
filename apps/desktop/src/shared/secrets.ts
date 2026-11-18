import { isTauri } from "./runtime";

/**
 * API keys live in the OS keychain (ADR 0003 Key 存储) and are read per request, never cached in
 * settings. The browser harness keeps them in localStorage, which is fine for a dev page only.
 */
const account = (providerId: string) => `provider:${providerId}`;
const BROWSER_PREFIX = "pointer.secret.";

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export async function getApiKey(providerId: string): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(BROWSER_PREFIX + account(providerId));
  return invoke<string | null>("secret_get", { account: account(providerId) });
}

export async function setApiKey(providerId: string, value: string): Promise<void> {
  const v = value.trim();
  if (!v) return deleteApiKey(providerId);
  if (!isTauri()) {
    localStorage.setItem(BROWSER_PREFIX + account(providerId), v);
    return;
  }
  await invoke("secret_set", { account: account(providerId), value: v });
}

export async function deleteApiKey(providerId: string): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(BROWSER_PREFIX + account(providerId));
    return;
  }
  await invoke("secret_delete", { account: account(providerId) });
}
